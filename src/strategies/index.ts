/**
 * CRONX Random Strategies
 *
 * Strategies for generating random execution times within time windows.
 *
 * @packageDocumentation
 */

// =============================================================================
// Strategy Interface
// =============================================================================

/**
 * Configuration options for random strategies
 */
export interface StrategyConfig {
  /** Seed for reproducible randomness (optional) */
  seed?: number
  /** Strategy-specific parameters */
  params?: Record<string, unknown>
}

/**
 * Interface for random time generation strategies
 */
export interface RandomStrategy {
  /** Strategy name identifier */
  readonly name: string

  /**
   * Generate a random timestamp within the given range
   * @param start - Start of the time window (ms since epoch)
   * @param end - End of the time window (ms since epoch)
   * @returns Random timestamp within the range
   */
  next(start: number, end: number): number

  /**
   * Reset the strategy state (e.g., for new seed)
   */
  reset(): void
}

// =============================================================================
// Strategy Implementations
// =============================================================================

export { UniformRandomStrategy } from './uniform.js'
export { GaussianRandomStrategy } from './gaussian.js'
export { PoissonRandomStrategy } from './poisson.js'
export { WeightedRandomStrategy } from './weighted.js'
