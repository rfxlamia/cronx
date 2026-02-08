import { describe, it, expect } from 'vitest';
import { createRng, gaussianRandom, weightedRandom, uniformRandom, jitteredValue } from '../../../src/utils/random.js';

describe('createRng', () => {
  it('should create reproducible random with seed', () => {
    const rng1 = createRng('test-seed');
    const rng2 = createRng('test-seed');
    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
  });

  it('should create different sequences with different seeds', () => {
    const rng1 = createRng('seed-1');
    const rng2 = createRng('seed-2');
    expect(rng1()).not.toBe(rng2());
  });

  it('should return Math.random if no seed provided', () => {
    const rng = createRng();
    expect(typeof rng()).toBe('number');
  });
});

describe('gaussianRandom', () => {
  it('should return values mostly between -3 and 3', () => {
    const rng = createRng('gaussian-test');
    const values = Array.from({ length: 1000 }, () => gaussianRandom(rng));
    const inRange = values.filter(v => v >= -3 && v <= 3);
    expect(inRange.length / values.length).toBeGreaterThan(0.99);
  });
});

describe('weightedRandom', () => {
  it('should return index based on weights', () => {
    const rng = createRng('weighted-test');
    const weights = [0.1, 0.2, 0.4, 0.2, 0.1];
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      counts[weightedRandom(weights, rng)]++;
    }
    // Middle weight (0.4) should have most hits
    expect(counts[2]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[4]);
  });
});

describe('uniformRandom', () => {
  it('should return values within range', () => {
    const rng = createRng('uniform-test');
    for (let i = 0; i < 100; i++) {
      const val = uniformRandom(10, 20, rng);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(20);
    }
  });
});

describe('jitteredValue', () => {
  it('should return base value with jitter applied', () => {
    const rng = createRng('jitter-test');
    const base = 100;
    const jitter = 0.2; // +/-20%
    for (let i = 0; i < 100; i++) {
      const val = jitteredValue(base, jitter, rng);
      expect(val).toBeGreaterThanOrEqual(80);
      expect(val).toBeLessThanOrEqual(120);
    }
  });
});
