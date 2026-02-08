/**
 * Random utilities with seedable PRNG support
 * Uses Linear Congruential Generator (LCG) for reproducible random sequences
 */

/**
 * Simple hash function to convert string seed to number
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Creates a seedable pseudo-random number generator (PRNG)
 * Uses Linear Congruential Generator (LCG) algorithm
 *
 * @param seed - Optional string seed for reproducible sequences
 * @returns A function that returns random numbers between 0 and 1
 */
export function createRng(seed?: string): () => number {
  if (seed === undefined) {
    return () => Math.random();
  }

  // LCG parameters (same as glibc)
  const a = 1103515245;
  const c = 12345;
  const m = 2 ** 31;

  let state = hashString(seed);

  return () => {
    state = (a * state + c) % m;
    return state / m;
  };
}

/**
 * Generates a random number with Gaussian (normal) distribution
 * Uses Box-Muller transform, resamples if |z| > 3
 *
 * @param rng - Optional RNG function, defaults to Math.random
 * @returns A random number from standard normal distribution (mean=0, stddev=1)
 */
export function gaussianRandom(rng: () => number = Math.random): number {
  // Box-Muller transform
  let z: number;
  do {
    const u1 = rng();
    const u2 = rng();
    // Avoid log(0)
    const safeU1 = Math.max(u1, 1e-10);
    z = Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);
  } while (Math.abs(z) > 3); // Resample if outside 3 standard deviations

  return z;
}

/**
 * Selects an index based on weighted probabilities
 *
 * @param weights - Array of weights (do not need to sum to 1)
 * @param rng - Optional RNG function, defaults to Math.random
 * @returns Index of selected weight
 */
export function weightedRandom(weights: number[], rng: () => number = Math.random): number {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = rng() * totalWeight;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return i;
    }
  }

  // Fallback to last index (should not happen with valid weights)
  return weights.length - 1;
}

/**
 * Generates a uniform random number within a range
 *
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @param rng - Optional RNG function, defaults to Math.random
 * @returns Random number between min and max
 */
export function uniformRandom(min: number, max: number, rng: () => number = Math.random): number {
  return min + rng() * (max - min);
}

/**
 * Applies jitter to a base value
 *
 * @param base - The base value
 * @param jitter - Jitter factor (0.2 = +/-20%)
 * @param rng - Optional RNG function, defaults to Math.random
 * @returns Base value with random jitter applied
 */
export function jitteredValue(base: number, jitter: number, rng: () => number = Math.random): number {
  // Generate value between -1 and 1
  const jitterMultiplier = (rng() * 2 - 1) * jitter;
  return base * (1 + jitterMultiplier);
}
