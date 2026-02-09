/**
 * CRONX Scheduler
 *
 * Main scheduler that manages job scheduling and execution.
 *
 * @packageDocumentation
 */

import type { Job, JobState } from '../types.js';
import type { SQLiteStore } from '../storage/sqlite.js';
import type { FileBridge } from '../gateway/file-bridge.js';
import type { GatewayClient } from '../gateway/client.js';
import { JobRunner } from './job-runner.js';
import { createStrategy, type StrategyWrapper } from '../strategies/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the Scheduler
 */
export interface SchedulerConfig {
  /** Array of jobs to schedule */
  jobs: Job[];
  /** SQLite store for persistence */
  store: SQLiteStore;
  /** File bridge for job execution (new path) */
  bridge?: FileBridge;
  /** Gateway client for job execution (legacy path) */
  gateway?: GatewayClient;
  /** Default timezone for jobs */
  timezone: string;
  /** Optional seed for reproducible randomness */
  seed?: string;
}

/**
 * Status information for a job
 */
export interface JobStatus {
  /** Job name */
  name: string;
  /** Next scheduled run time */
  nextRun: Date | null;
  /** Last run time */
  lastRun: Date | null;
  /** Whether job is enabled */
  enabled: boolean;
}

// =============================================================================
// Scheduler
// =============================================================================

/**
 * Main scheduler for CRONX jobs.
 *
 * Manages job scheduling, execution, and state persistence.
 *
 * @example
 * ```ts
 * const scheduler = new Scheduler({
 *   jobs,
 *   store,
 *   bridge, // or gateway
 *   timezone: 'Asia/Jakarta',
 * });
 *
 * await scheduler.start();
 * // ... later
 * await scheduler.stop();
 * ```
 */
export class Scheduler {
  private readonly config: SchedulerConfig;
  private readonly runner: JobRunner;
  private readonly strategies: Map<string, StrategyWrapper> = new Map();
  private readonly states: Map<string, JobState> = new Map();
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  /**
   * Create a new Scheduler.
   *
   * @param config - Scheduler configuration
   */
  constructor(config: SchedulerConfig) {
    this.config = config;
    if (config.bridge && config.gateway) {
      throw new Error('Scheduler accepts either bridge or gateway, not both');
    }
    const executor = config.bridge ?? config.gateway;
    if (!executor) {
      throw new Error('Scheduler requires either bridge or gateway');
    }
    this.runner = new JobRunner(executor, config.store);

    // Initialize strategies for each job
    for (const job of config.jobs) {
      const strategy = createStrategy(job, config.seed);
      this.strategies.set(job.name, strategy);
    }
  }

  /**
   * Start the scheduler.
   *
   * Loads job states from store and schedules next runs.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Initialize job states
    for (const job of this.config.jobs) {
      await this.initializeJobState(job);
    }

    // Schedule all enabled jobs
    for (const job of this.config.jobs) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
  }

  /**
   * Stop the scheduler.
   *
   * Cancels all pending timers and saves state.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Clear all timers
    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(name);
    }

    // Save all job states
    for (const [, state] of this.states) {
      this.config.store.saveJobState(state);
    }
  }

  /**
   * Get status of all jobs.
   *
   * @returns Array of job status objects
   */
  getStatus(): JobStatus[] {
    return this.config.jobs.map((job) => {
      const state = this.states.get(job.name);
      return {
        name: job.name,
        nextRun: state?.nextRun ? new Date(state.nextRun) : null,
        lastRun: state?.lastRun ? new Date(state.lastRun) : null,
        enabled: state?.enabled ?? job.enabled,
      };
    });
  }

  /**
   * Initialize job state from store or calculate new.
   */
  private async initializeJobState(job: Job): Promise<void> {
    // Try to load existing state
    let state = this.config.store.getJobState(job.name);

    if (!state) {
      // Calculate initial next run
      const strategy = this.strategies.get(job.name);
      const nextRun = strategy?.calculateNextRun(null) ?? null;

      state = {
        name: job.name,
        nextRun,
        lastRun: null,
        enabled: job.enabled,
        failCount: 0,
      };

      // Save initial state
      this.config.store.saveJobState(state);
    }

    this.states.set(job.name, state);
  }

  /**
   * Schedule a job's next execution.
   */
  private scheduleJob(job: Job): void {
    const state = this.states.get(job.name);
    if (!state || state.nextRun === null) {
      return;
    }

    const strategy = this.strategies.get(job.name);
    if (!strategy) {
      return;
    }

    const now = Date.now();
    const delay = Math.max(0, state.nextRun - now);

    // Clear existing timer
    const existingTimer = this.timers.get(job.name);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule next execution
    const timer = setTimeout(() => {
      this.executeJob(job).catch((error) => {
        console.error(`Error executing job ${job.name}:`, error);
      });
    }, delay);

    this.timers.set(job.name, timer);
  }

  /**
   * Execute a job and schedule its next run.
   */
  private async executeJob(job: Job): Promise<void> {
    if (!this.running) {
      return;
    }

    const strategy = this.strategies.get(job.name);
    const state = this.states.get(job.name);

    if (!strategy || !state) {
      return;
    }

    // For probabilistic strategy, check if we should actually run
    if (strategy.type === 'probabilistic' && strategy.shouldRun) {
      if (!strategy.shouldRun()) {
        // Schedule next check
        const nextCheck = strategy.getNextCheckTime?.() ?? Date.now() + 60000;
        state.nextRun = nextCheck;
        this.config.store.saveJobState(state);
        this.scheduleJob(job);
        return;
      }
    }

    // Execute the job
    const result = await this.runner.run(job);

    // Update state
    const now = Date.now();
    state.lastRun = now;

    if (result.status === 'success') {
      state.failCount = 0;
    } else {
      state.failCount++;
    }

    // Calculate next run
    state.nextRun = strategy.calculateNextRun(now);

    // Save state
    this.config.store.saveJobState(state);
    this.states.set(job.name, state);

    // Schedule next run
    if (this.running && state.enabled) {
      this.scheduleJob(job);
    }
  }
}
