/**
 * CRONX Job Runner
 *
 * Executes jobs with retry logic, backoff strategies, and failure handling.
 *
 * @packageDocumentation
 */

import type { Job, RunRecord, RunStatus, RetryConfig } from '../types.js';
import type { GatewayClient } from '../gateway/client.js';
import type { SQLiteStore } from '../storage/sqlite.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a job run
 */
export interface RunResult {
  /** Final status of the run */
  status: RunStatus;
  /** Number of attempts made */
  attempts: number;
  /** Error message if failed */
  error?: string;
  /** Total duration in milliseconds */
  durationMs: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Base delay for backoff calculations (1 second) */
const BASE_DELAY_MS = 1000;

/** Default retry configuration */
const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  backoff: 'exponential',
  timeout: 30,
};

// =============================================================================
// Job Runner
// =============================================================================

/**
 * Executes jobs with retry logic and failure handling.
 *
 * @example
 * ```ts
 * const runner = new JobRunner(gateway, store);
 * const result = await runner.run(job);
 * if (result.status === 'success') {
 *   console.log('Job completed successfully');
 * }
 * ```
 */
export class JobRunner {
  private readonly gateway: GatewayClient;
  private readonly store: SQLiteStore;

  /**
   * Create a new JobRunner.
   *
   * @param gateway - Gateway client for sending messages
   * @param store - SQLite store for recording runs
   */
  constructor(gateway: GatewayClient, store: SQLiteStore) {
    this.gateway = gateway;
    this.store = store;
  }

  /**
   * Run a job with retry logic.
   *
   * @param job - The job to execute
   * @returns Result of the job run
   */
  async run(job: Job): Promise<RunResult> {
    const startTime = Date.now();
    const scheduledAt = Date.now();
    const retryConfig = job.retry ?? DEFAULT_RETRY;

    let attempts = 0;
    let lastError: Error | null = null;
    let status: RunStatus = 'failed';

    while (attempts < retryConfig.maxAttempts) {
      attempts++;

      try {
        // Execute with timeout
        const response = await this.executeWithTimeout(job, retryConfig.timeout);

        if (response.success) {
          status = 'success';
          lastError = null;
          break;
        } else {
          lastError = new Error(response.error || 'Unknown gateway error');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          status = 'timeout';
          lastError = error;
          break; // Don't retry on timeout
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // If not the last attempt, wait before retry
      if (attempts < retryConfig.maxAttempts) {
        const delay = this.calculateBackoffDelay(attempts, retryConfig.backoff);
        await this.sleep(delay);
      }
    }

    const durationMs = Date.now() - startTime;

    // Record run
    const runRecord: RunRecord = {
      jobName: job.name,
      scheduledAt,
      triggeredAt: startTime,
      completedAt: Date.now(),
      durationMs,
      status,
      attempts,
      ...(lastError && { error: lastError.message }),
    };

    this.store.recordRun(runRecord);

    // Handle failure notification
    if (status !== 'success' && job.onFailure !== 'silent') {
      await this.handleFailure(job, lastError);
    }

    return {
      status,
      attempts,
      durationMs,
      ...(lastError && { error: lastError.message }),
    };
  }

  /**
   * Execute the job action with a timeout.
   */
  private async executeWithTimeout(
    job: Job,
    timeoutSeconds: number
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('TIMEOUT'));
      }, timeoutSeconds * 1000);

      this.gateway
        .trigger({
          message: job.action.message,
          priority: job.action.priority,
        })
        .then((response) => {
          clearTimeout(timeoutId);
          resolve(response);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Calculate backoff delay based on strategy.
   *
   * @param attempt - Current attempt number (1-indexed)
   * @param strategy - Backoff strategy
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(
    attempt: number,
    strategy: RetryConfig['backoff']
  ): number {
    switch (strategy) {
      case 'fixed':
        return BASE_DELAY_MS;
      case 'linear':
        return attempt * BASE_DELAY_MS;
      case 'exponential':
        return Math.pow(2, attempt) * BASE_DELAY_MS;
      default:
        return BASE_DELAY_MS;
    }
  }

  /**
   * Handle job failure notification.
   */
  private async handleFailure(job: Job, error: Error | null): Promise<void> {
    const errorMsg = error?.message || 'Unknown error';

    if (job.onFailure === 'escalate') {
      await this.gateway.notify(
        `[ESCALATE] Job '${job.name}' failed: ${errorMsg}`,
        'high'
      );
    } else {
      // Default: notify
      await this.gateway.notify(
        `Job '${job.name}' failed: ${errorMsg}`,
        'high'
      );
    }
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
