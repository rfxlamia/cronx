/**
 * IntervalStrategy - Schedule jobs at random intervals with jitter
 *
 * Schedules the next run at a random interval between min and max,
 * with optional jitter for additional randomness.
 */
import type { IntervalConfig } from '../types.js';
import { createRng, uniformRandom, jitteredValue } from '../utils/random.js';

/**
 * Options for IntervalStrategy
 */
export interface IntervalStrategyOptions {
  /** Optional seed for reproducible randomness */
  seed?: string;
  /** Custom function to get current time (for testing) */
  getNow?: () => number;
}

/**
 * Strategy for scheduling jobs at random intervals
 */
export class IntervalStrategy {
  private readonly config: IntervalConfig;
  private readonly rng: () => number;
  private readonly getNow: () => number;

  /**
   * Create a new IntervalStrategy
   * @param config - Interval configuration
   * @param seedOrOptions - Optional seed string or options object
   */
  constructor(config: IntervalConfig, seedOrOptions?: string | IntervalStrategyOptions) {
    this.config = config;

    // Handle both old API (seed string) and new API (options object)
    if (typeof seedOrOptions === 'string') {
      this.rng = createRng(seedOrOptions);
      this.getNow = () => Date.now();
    } else if (seedOrOptions) {
      this.rng = createRng(seedOrOptions.seed);
      this.getNow = seedOrOptions.getNow ?? (() => Date.now());
    } else {
      this.rng = createRng();
      this.getNow = () => Date.now();
    }
  }

  /**
   * Calculate the next run time based on the interval configuration
   * @param lastRun - Timestamp of last run (null if never run)
   * @returns Timestamp for next scheduled run
   */
  calculateNextRun(lastRun: number | null): number {
    const now = this.getNow();

    // Calculate base interval (random between min and max)
    const baseIntervalSeconds = uniformRandom(
      this.config.min,
      this.config.max,
      this.rng
    );

    // Apply jitter if configured
    let intervalSeconds = baseIntervalSeconds;
    if (this.config.jitter > 0) {
      intervalSeconds = jitteredValue(baseIntervalSeconds, this.config.jitter, this.rng);
      // Ensure interval doesn't go negative
      intervalSeconds = Math.max(0, intervalSeconds);
    }

    // Convert to milliseconds
    const intervalMs = intervalSeconds * 1000;

    // Calculate next run time
    let nextRun: number;
    if (lastRun === null) {
      // First run: schedule from now
      nextRun = now + intervalMs;
    } else {
      // Subsequent run: schedule from lastRun
      nextRun = lastRun + intervalMs;

      // If calculated time is in the past, schedule from now instead
      if (nextRun <= now) {
        nextRun = now + intervalMs;
      }
    }

    return Math.floor(nextRun);
  }
}
