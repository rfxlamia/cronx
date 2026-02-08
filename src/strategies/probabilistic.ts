/**
 * ProbabilisticStrategy - Execute jobs based on probability
 *
 * Checks at regular intervals and decides whether to run
 * based on configured probability.
 */
import type { ProbabilisticConfig } from '../types.js';
import { createRng } from '../utils/random.js';

/**
 * Options for ProbabilisticStrategy
 */
export interface ProbabilisticStrategyOptions {
  /** Optional seed for reproducible randomness */
  seed?: string;
  /** Custom function to get current time (for testing) */
  getNow?: () => number;
}

/**
 * Strategy for probabilistic job execution
 */
export class ProbabilisticStrategy {
  private readonly config: ProbabilisticConfig;
  private readonly rng: () => number;
  private readonly getNow: () => number;

  /**
   * Create a new ProbabilisticStrategy
   * @param config - Probabilistic configuration
   * @param seedOrOptions - Optional seed string or options object
   */
  constructor(config: ProbabilisticConfig, seedOrOptions?: string | ProbabilisticStrategyOptions) {
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
   * Determine whether the job should run based on probability
   * @returns true if job should run, false otherwise
   */
  shouldRun(): boolean {
    // Handle edge cases
    if (this.config.probability <= 0) {
      return false;
    }
    if (this.config.probability >= 1) {
      return true;
    }

    // Generate random number and compare with probability
    const roll = this.rng();
    return roll < this.config.probability;
  }

  /**
   * Get the next time to check probability
   * @returns Timestamp for next check
   */
  getNextCheckTime(): number {
    return this.getNow() + this.getCheckIntervalMs();
  }

  /**
   * Get the check interval in milliseconds
   * @returns Check interval in milliseconds
   */
  getCheckIntervalMs(): number {
    return this.config.checkInterval * 1000;
  }
}
