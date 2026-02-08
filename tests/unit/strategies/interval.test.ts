/**
 * IntervalStrategy Tests
 *
 * Tests for interval-based scheduling with jitter
 */
import { describe, it, expect } from 'vitest';
import { IntervalStrategy } from '../../../src/strategies/interval.js';
import type { IntervalConfig } from '../../../src/types.js';

describe('IntervalStrategy', () => {
  describe('constructor', () => {
    it('should create a strategy with valid config', () => {
      const config: IntervalConfig = {
        min: 300,  // 5 minutes
        max: 600,  // 10 minutes
        jitter: 0.1,
      };

      const strategy = new IntervalStrategy(config);
      expect(strategy).toBeDefined();
    });

    it('should accept optional seed for reproducibility', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0.1,
      };

      const now = Date.now();
      const strategy1 = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });
      const strategy2 = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const result1 = strategy1.calculateNextRun(null);
      const result2 = strategy2.calculateNextRun(null);

      expect(result1).toBe(result2);
    });
  });

  describe('calculateNextRun with null lastRun', () => {
    it('should schedule first run within interval from now', () => {
      const config: IntervalConfig = {
        min: 300,  // 5 minutes in seconds
        max: 600,  // 10 minutes in seconds
        jitter: 0,
      };

      const now = Date.now();
      const strategy = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const nextRun = strategy.calculateNextRun(null);

      // Should be between now + min and now + max (in ms)
      const minTime = now + config.min * 1000;
      const maxTime = now + config.max * 1000;

      expect(nextRun).toBeGreaterThanOrEqual(minTime);
      expect(nextRun).toBeLessThanOrEqual(maxTime);
    });

    it('should apply jitter to first run', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0.2, // 20% jitter
      };

      const now = Date.now();
      const results: number[] = [];

      for (let i = 0; i < 20; i++) {
        const strategy = new IntervalStrategy(config, {
          seed: `jitter-${i}`,
          getNow: () => now,
        });
        results.push(strategy.calculateNextRun(null));
      }

      // With jitter, base interval gets +/- 20%, so range expands
      // Base range: 300-600s
      // With jitter: could be 300*0.8=240s to 600*1.2=720s
      const minPossible = now + 300 * 0.8 * 1000;
      const maxPossible = now + 600 * 1.2 * 1000;

      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(minPossible);
        expect(r).toBeLessThanOrEqual(maxPossible);
      });

      // Should have variance (not all same)
      expect(new Set(results).size).toBeGreaterThan(1);
    });
  });

  describe('calculateNextRun with previous lastRun', () => {
    it('should schedule next run relative to lastRun', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0,
      };

      const now = Date.now();
      const lastRun = now - 60 * 1000; // 1 minute ago

      const strategy = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const nextRun = strategy.calculateNextRun(lastRun);

      // Should be between lastRun + min and lastRun + max
      const minTime = lastRun + config.min * 1000;
      const maxTime = lastRun + config.max * 1000;

      expect(nextRun).toBeGreaterThanOrEqual(minTime);
      expect(nextRun).toBeLessThanOrEqual(maxTime);
    });

    it('should apply jitter to interval from lastRun', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0.2,
      };

      const now = Date.now();
      const lastRun = now - 60 * 1000;

      const results: number[] = [];
      for (let i = 0; i < 20; i++) {
        const strategy = new IntervalStrategy(config, {
          seed: `jitter-last-${i}`,
          getNow: () => now,
        });
        results.push(strategy.calculateNextRun(lastRun));
      }

      // With 20% jitter, range expands
      const minPossible = lastRun + 300 * 0.8 * 1000;
      const maxPossible = lastRun + 600 * 1.2 * 1000;

      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(minPossible);
        expect(r).toBeLessThanOrEqual(maxPossible);
      });
    });

    it('should ensure next run is in the future if calculated time is past', () => {
      const config: IntervalConfig = {
        min: 300,  // 5 minutes
        max: 600,  // 10 minutes
        jitter: 0,
      };

      const now = Date.now();
      // Last run was 20 minutes ago, so calculated next would be in the past
      const lastRun = now - 20 * 60 * 1000;

      const strategy = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const nextRun = strategy.calculateNextRun(lastRun);

      // Even though lastRun + interval is in the past,
      // we should schedule from now
      expect(nextRun).toBeGreaterThanOrEqual(now);
    });
  });

  describe('edge cases', () => {
    it('should handle min equals max (fixed interval)', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 300,  // Same as min
        jitter: 0,
      };

      const now = Date.now();
      const strategy = new IntervalStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const nextRun = strategy.calculateNextRun(null);

      // Should be exactly now + 300 seconds
      expect(nextRun).toBe(now + 300 * 1000);
    });

    it('should handle zero jitter', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0,
      };

      const now = Date.now();
      const results: number[] = [];

      for (let i = 0; i < 10; i++) {
        const strategy = new IntervalStrategy(config, {
          seed: `no-jitter-${i}`,
          getNow: () => now,
        });
        results.push(strategy.calculateNextRun(null));
      }

      // All should be within base range (no expansion from jitter)
      const minTime = now + config.min * 1000;
      const maxTime = now + config.max * 1000;

      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(minTime);
        expect(r).toBeLessThanOrEqual(maxTime);
      });
    });

    it('should handle maximum jitter (1.0)', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 1.0, // 100% jitter
      };

      const now = Date.now();
      const results: number[] = [];

      for (let i = 0; i < 20; i++) {
        const strategy = new IntervalStrategy(config, {
          seed: `max-jitter-${i}`,
          getNow: () => now,
        });
        results.push(strategy.calculateNextRun(null));
      }

      // With 100% jitter, range is 300*0=0 to 600*2=1200
      // But we should clamp to at least 0 (or some minimum)
      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(now);
        expect(r).toBeLessThanOrEqual(now + 600 * 2 * 1000);
      });
    });
  });

  describe('reproducibility', () => {
    it('should produce same result with same seed and lastRun', () => {
      const config: IntervalConfig = {
        min: 300,
        max: 600,
        jitter: 0.2,
      };

      const now = Date.now();
      const lastRun = now - 60 * 1000;

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const strategy = new IntervalStrategy(config, {
          seed: 'same-seed',
          getNow: () => now,
        });
        results.push(strategy.calculateNextRun(lastRun));
      }

      // All results should be identical
      expect(new Set(results).size).toBe(1);
    });
  });
});
