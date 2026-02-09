/**
 * CRONX Job Runner
 *
 * Executes jobs with retry logic, backoff strategies, and failure handling.
 *
 * @packageDocumentation
 */

import type { Job, RunRecord, RunStatus, RetryConfig } from '../types.js';
import type { FileBridge } from '../gateway/file-bridge.js';
import type { GatewayClient } from '../gateway/client.js';
import type { SQLiteStore } from '../storage/sqlite.js';
import { FileBridgeError, FileBridgeErrorCode } from '../types.js';

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
  private readonly bridge?: FileBridge;
  private readonly gateway?: GatewayClient;
  private readonly store: SQLiteStore;

  /**
   * Create a new JobRunner.
   *
   * @param executor - File bridge (new path) or gateway client (legacy path)
   * @param store - SQLite store for recording runs
   */
  constructor(executor: FileBridge | GatewayClient, store: SQLiteStore) {
    if (this.isFileBridge(executor)) {
      this.bridge = executor
    } else {
      this.gateway = executor
    }
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
    const retryConfig = job.retry ?? DEFAULT_RETRY;

    let attempts = 0;
    let lastError: Error | null = null;
    let status: RunStatus = 'failed';

    while (attempts < retryConfig.maxAttempts) {
      attempts++;

      try {
        if (this.bridge) {
          const payload = {
            jobName: job.name,
            message: job.action.message,
            priority: job.action.priority,
            timestamp: Date.now(),
            sessionTarget: job.sessionTarget ?? 'isolated',
            recipient: job.recipient,
            thinking: job.thinking ?? 'medium',
          };

          await this.bridge.trigger(payload);

          if (job.action.deliver !== false) {
            await this.bridge.executeCLI(payload);
          }
        } else {
          const response = await this.executeWithTimeout(job, retryConfig.timeout);
          if (!response.success) {
            throw new Error(response.error || 'Unknown gateway error');
          }
        }

        status = 'success';
        lastError = null;
        break;
      } catch (error) {
        if (error instanceof Error && error.message === 'TIMEOUT') {
          status = 'timeout';
          lastError = error;
          break;
        }

        if (error instanceof FileBridgeError) {
          if (
            error.code === FileBridgeErrorCode.PERMISSION_DENIED ||
            error.code === FileBridgeErrorCode.DISK_FULL
          ) {
            lastError = error;
            break;
          }
          if (error.code === FileBridgeErrorCode.CLI_TIMEOUT) {
            status = 'timeout';
            lastError = error;
            break;
          }
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
      scheduledAt: startTime,
      triggeredAt: startTime,
      completedAt: Date.now(),
      durationMs,
      status,
      attempts,
      ...(lastError && { error: lastError.message }),
    };

    this.store.recordRun(runRecord);

    if (status !== 'success' && job.onFailure !== 'silent') {
      try {
        await this.handleFailure(job, lastError);
      } catch (err) {
        console.error('Failed to send failure notification:', err);
      }
    }

    return {
      status,
      attempts,
      durationMs,
      ...(lastError && { error: lastError.message }),
    };
  }

  private isFileBridge(executor: FileBridge | GatewayClient): executor is FileBridge {
    return (
      typeof (executor as FileBridge).trigger === 'function' &&
      typeof (executor as FileBridge).executeCLI === 'function'
    )
  }

  private async executeWithTimeout(
    job: Job,
    timeoutSeconds: number
  ): Promise<{ success: boolean; error?: string }> {
    const gateway = this.gateway
    if (!gateway) {
      throw new Error('Legacy gateway timeout path called with FileBridge')
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('TIMEOUT'));
      }, timeoutSeconds * 1000);

      gateway
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

  private async handleFailure(job: Job, error: Error | null): Promise<void> {
    const errorMsg = error?.message || 'Unknown error';
    const prefix = job.onFailure === 'escalate' ? '[ESCALATE] ' : '';
    const failureMessage = `${prefix}Job '${job.name}' failed: ${errorMsg}`

    if (this.gateway) {
      await this.gateway.notify(failureMessage, 'high');
      return
    }

    if (this.bridge) {
      await this.bridge.executeCLI({
        jobName: `${job.name}-failure-notify`,
        message: failureMessage,
        priority: 'high',
        timestamp: Date.now(),
        sessionTarget: job.sessionTarget ?? 'isolated',
        recipient: job.recipient,
        thinking: job.thinking ?? 'medium',
      })
    }
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
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
