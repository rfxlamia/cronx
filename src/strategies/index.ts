/**
 * CRONX Scheduling Strategies
 *
 * Provides strategies for generating random execution times.
 *
 * @packageDocumentation
 */
import type {
  Job,
  WindowConfig,
  IntervalConfig,
  ProbabilisticConfig,
  Strategy,
} from '../types.js';
import { WindowStrategy } from './window.js';
import { IntervalStrategy } from './interval.js';
import { ProbabilisticStrategy } from './probabilistic.js';

// =============================================================================
// Strategy Wrapper Interface
// =============================================================================

/**
 * Unified wrapper for all strategy types
 */
export interface StrategyWrapper {
  /** Strategy type identifier */
  type: Strategy;

  /**
   * Calculate the next run time
   * @param lastRun - Timestamp of last run (null if never run)
   * @returns Timestamp for next scheduled run
   */
  calculateNextRun(lastRun: number | null): number;

  /**
   * For probabilistic strategy: determine if job should run
   * @returns true if job should execute
   */
  shouldRun?(): boolean;

  /**
   * For probabilistic strategy: get next check time
   * @returns Timestamp for next probability check
   */
  getNextCheckTime?(): number;
}

// =============================================================================
// Strategy Factory
// =============================================================================

/**
 * Create a strategy wrapper for a job
 * @param job - Job definition
 * @param seed - Optional seed for reproducible randomness
 * @returns Strategy wrapper
 */
export function createStrategy(job: Job, seed?: string): StrategyWrapper {
  switch (job.strategy) {
    case 'window':
      return createWindowWrapper(job.config as WindowConfig, seed);

    case 'interval':
      return createIntervalWrapper(job.config as IntervalConfig, seed);

    case 'probabilistic':
      return createProbabilisticWrapper(job.config as ProbabilisticConfig, seed);

    default:
      throw new Error(`Unknown strategy type: ${(job as any).strategy}`);
  }
}

/**
 * Create wrapper for window strategy
 */
function createWindowWrapper(config: WindowConfig, seed?: string): StrategyWrapper {
  const strategy = new WindowStrategy(config, seed);

  return {
    type: 'window',
    calculateNextRun: (lastRun) => strategy.calculateNextRun(lastRun),
  };
}

/**
 * Create wrapper for interval strategy
 */
function createIntervalWrapper(config: IntervalConfig, seed?: string): StrategyWrapper {
  const strategy = new IntervalStrategy(config, seed);

  return {
    type: 'interval',
    calculateNextRun: (lastRun) => strategy.calculateNextRun(lastRun),
  };
}

/**
 * Create wrapper for probabilistic strategy
 */
function createProbabilisticWrapper(config: ProbabilisticConfig, seed?: string): StrategyWrapper {
  const strategy = new ProbabilisticStrategy(config, seed);

  return {
    type: 'probabilistic',
    calculateNextRun: () => strategy.getNextCheckTime(),
    shouldRun: () => strategy.shouldRun(),
    getNextCheckTime: () => strategy.getNextCheckTime(),
  };
}

// =============================================================================
// Re-export Strategy Classes
// =============================================================================

export { WindowStrategy } from './window.js';
export type { WindowStrategyOptions } from './window.js';

export { IntervalStrategy } from './interval.js';
export type { IntervalStrategyOptions } from './interval.js';

export { ProbabilisticStrategy } from './probabilistic.js';
export type { ProbabilisticStrategyOptions } from './probabilistic.js';
