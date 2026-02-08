/**
 * WindowStrategy - Schedule jobs within time windows
 *
 * Supports uniform, gaussian, and weighted distributions
 */
import type { WindowConfig } from '../types.js';
import { parseTime } from '../utils/time.js';
import { gaussianRandom, weightedRandom, uniformRandom, parseStrategyOptions, type StrategyOptions } from '../utils/random.js';

/** One day in milliseconds */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Default weights for weighted distribution (bell-curve-like) */
const DEFAULT_WEIGHTS = [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];

/**
 * Options for WindowStrategy
 */
export type WindowStrategyOptions = StrategyOptions;

/**
 * Strategy for scheduling jobs within a time window
 */
export class WindowStrategy {
  private readonly config: WindowConfig;
  private readonly rng: () => number;
  private readonly getNow: () => number;

  /**
   * Create a new WindowStrategy
   * @param config - Window configuration
   * @param seedOrOptions - Optional seed string or options object
   */
  constructor(config: WindowConfig, seedOrOptions?: string | WindowStrategyOptions) {
    this.config = config;
    const { rng, getNow } = parseStrategyOptions(seedOrOptions);
    this.rng = rng;
    this.getNow = getNow;
  }

  /**
   * Calculate the next run time based on the window configuration
   * @param lastRun - Timestamp of last run (null if never run)
   * @returns Timestamp for next scheduled run
   */
  calculateNextRun(lastRun?: number | null): number {
    const now = this.getNow();

    // Get today's window boundaries
    let windowStart = parseTime(this.config.start, this.config.timezone);
    let windowEnd = parseTime(this.config.end, this.config.timezone);

    // If window end is before window start, it spans midnight
    // For simplicity, we'll handle this by adding a day to the end
    if (windowEnd <= windowStart) {
      windowEnd += DAY_MS;
    }

    // If current time is past the window end, schedule for tomorrow
    if (now > windowEnd) {
      windowStart += DAY_MS;
      windowEnd += DAY_MS;
    }

    // Calculate random time within window based on distribution
    return this.calculateTimeWithinWindow(windowStart, windowEnd);
  }

  /**
   * Calculate a random time within the window based on distribution type
   */
  private calculateTimeWithinWindow(windowStart: number, windowEnd: number): number {
    const windowDuration = windowEnd - windowStart;

    switch (this.config.distribution) {
      case 'uniform':
        return this.uniformTime(windowStart, windowEnd);

      case 'gaussian':
        return this.gaussianTime(windowStart, windowEnd, windowDuration);

      case 'weighted':
        return this.weightedTime(windowStart, windowEnd, windowDuration);

      default:
        // Default to uniform if unknown distribution
        return this.uniformTime(windowStart, windowEnd);
    }
  }

  /**
   * Uniform distribution - equal probability across the window
   */
  private uniformTime(windowStart: number, windowEnd: number): number {
    return Math.floor(uniformRandom(windowStart, windowEnd, this.rng));
  }

  /**
   * Gaussian distribution - bell curve centered in the middle
   */
  private gaussianTime(windowStart: number, windowEnd: number, windowDuration: number): number {
    // Get a gaussian random value (mean=0, stddev=1)
    const z = gaussianRandom(this.rng);

    // Scale to window: mean at center, stddev = 1/6 of window duration
    // This puts ~99.7% of values within the window (3 sigma rule)
    const mean = windowStart + windowDuration / 2;
    const stddev = windowDuration / 6;

    let time = mean + z * stddev;

    // Clamp to window bounds
    time = Math.max(windowStart, Math.min(windowEnd, time));

    return Math.floor(time);
  }

  /**
   * Weighted distribution - divide window into segments with weights
   */
  private weightedTime(windowStart: number, windowEnd: number, windowDuration: number): number {
    const weights = DEFAULT_WEIGHTS;
    const numSegments = weights.length;
    const segmentDuration = windowDuration / numSegments;

    // Pick a weighted segment
    const segmentIndex = weightedRandom(weights, this.rng);

    // Calculate segment boundaries
    const segmentStart = windowStart + segmentIndex * segmentDuration;
    const segmentEnd = segmentStart + segmentDuration;

    // Pick uniform time within segment
    return Math.floor(uniformRandom(segmentStart, segmentEnd, this.rng));
  }
}
