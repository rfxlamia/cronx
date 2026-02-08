/**
 * ProbabilisticStrategy Tests
 *
 * Tests for probability-based execution decisions
 */
import { describe, it, expect } from 'vitest';
import { ProbabilisticStrategy } from '../../../src/strategies/probabilistic.js';
import type { ProbabilisticConfig } from '../../../src/types.js';

describe('ProbabilisticStrategy', () => {
  describe('constructor', () => {
    it('should create a strategy with valid config', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 300, // 5 minutes
        probability: 0.3,   // 30% chance
      };

      const strategy = new ProbabilisticStrategy(config);
      expect(strategy).toBeDefined();
    });

    it('should accept optional seed for reproducibility', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 300,
        probability: 0.5,
      };

      const strategy1 = new ProbabilisticStrategy(config, 'test-seed');
      const strategy2 = new ProbabilisticStrategy(config, 'test-seed');

      // With same seed, should produce same results
      const results1 = Array.from({ length: 10 }, () => strategy1.shouldRun());
      const results2 = Array.from({ length: 10 }, () => strategy2.shouldRun());

      expect(results1).toEqual(results2);
    });
  });

  describe('shouldRun', () => {
    it('should return true approximately according to probability', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.5, // 50% chance
      };

      // Run many trials
      const trials = 1000;
      let trueCount = 0;

      for (let i = 0; i < trials; i++) {
        const strategy = new ProbabilisticStrategy(config, `trial-${i}`);
        if (strategy.shouldRun()) {
          trueCount++;
        }
      }

      // With 50% probability, expect ~500 trues (allow 40-60% range)
      const rate = trueCount / trials;
      expect(rate).toBeGreaterThan(0.4);
      expect(rate).toBeLessThan(0.6);
    });

    it('should return true with probability 1.0', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 1.0, // 100% chance
      };

      const strategy = new ProbabilisticStrategy(config, 'test-seed');

      // All calls should return true
      for (let i = 0; i < 10; i++) {
        expect(strategy.shouldRun()).toBe(true);
      }
    });

    it('should return false with probability 0.0', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.0, // 0% chance
      };

      const strategy = new ProbabilisticStrategy(config, 'test-seed');

      // All calls should return false
      for (let i = 0; i < 10; i++) {
        expect(strategy.shouldRun()).toBe(false);
      }
    });

    it('should respect low probability', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.1, // 10% chance
      };

      const trials = 1000;
      let trueCount = 0;

      for (let i = 0; i < trials; i++) {
        const strategy = new ProbabilisticStrategy(config, `low-${i}`);
        if (strategy.shouldRun()) {
          trueCount++;
        }
      }

      // With 10% probability, expect ~100 trues (allow 5-15% range)
      const rate = trueCount / trials;
      expect(rate).toBeGreaterThan(0.05);
      expect(rate).toBeLessThan(0.15);
    });

    it('should respect high probability', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.9, // 90% chance
      };

      const trials = 1000;
      let trueCount = 0;

      for (let i = 0; i < trials; i++) {
        const strategy = new ProbabilisticStrategy(config, `high-${i}`);
        if (strategy.shouldRun()) {
          trueCount++;
        }
      }

      // With 90% probability, expect ~900 trues (allow 85-95% range)
      const rate = trueCount / trials;
      expect(rate).toBeGreaterThan(0.85);
      expect(rate).toBeLessThan(0.95);
    });
  });

  describe('getNextCheckTime', () => {
    it('should return now + checkInterval in milliseconds', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 300, // 5 minutes
        probability: 0.5,
      };

      const now = Date.now();
      const strategy = new ProbabilisticStrategy(config, {
        seed: 'test-seed',
        getNow: () => now,
      });

      const nextCheck = strategy.getNextCheckTime();

      expect(nextCheck).toBe(now + 300 * 1000);
    });
  });

  describe('getCheckIntervalMs', () => {
    it('should return checkInterval in milliseconds', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 300, // 5 minutes in seconds
        probability: 0.5,
      };

      const strategy = new ProbabilisticStrategy(config);

      expect(strategy.getCheckIntervalMs()).toBe(300 * 1000);
    });

    it('should handle fractional seconds', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 1.5, // 1.5 seconds
        probability: 0.5,
      };

      const strategy = new ProbabilisticStrategy(config);

      expect(strategy.getCheckIntervalMs()).toBe(1500);
    });
  });

  describe('edge cases', () => {
    it('should handle very small probability', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.001, // 0.1% chance
      };

      const trials = 10000;
      let trueCount = 0;

      for (let i = 0; i < trials; i++) {
        const strategy = new ProbabilisticStrategy(config, `tiny-${i}`);
        if (strategy.shouldRun()) {
          trueCount++;
        }
      }

      // With 0.1% probability, expect ~10 trues (allow 0-30 range for variance)
      expect(trueCount).toBeGreaterThanOrEqual(0);
      expect(trueCount).toBeLessThan(50);
    });

    it('should handle very short checkInterval', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 1, // 1 second
        probability: 0.5,
      };

      const strategy = new ProbabilisticStrategy(config);

      expect(strategy.getCheckIntervalMs()).toBe(1000);
    });

    it('should handle very long checkInterval', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 86400, // 24 hours
        probability: 0.5,
      };

      const strategy = new ProbabilisticStrategy(config);

      expect(strategy.getCheckIntervalMs()).toBe(86400 * 1000);
    });
  });

  describe('reproducibility', () => {
    it('should produce deterministic sequence with same seed', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.5,
      };

      const results1: boolean[] = [];
      const results2: boolean[] = [];

      const strategy1 = new ProbabilisticStrategy(config, 'same-seed');
      const strategy2 = new ProbabilisticStrategy(config, 'same-seed');

      for (let i = 0; i < 20; i++) {
        results1.push(strategy1.shouldRun());
        results2.push(strategy2.shouldRun());
      }

      expect(results1).toEqual(results2);
    });

    it('should produce different sequences with different seeds', () => {
      const config: ProbabilisticConfig = {
        checkInterval: 60,
        probability: 0.5,
      };

      const results1: boolean[] = [];
      const results2: boolean[] = [];

      const strategy1 = new ProbabilisticStrategy(config, 'seed-a');
      const strategy2 = new ProbabilisticStrategy(config, 'seed-b');

      for (let i = 0; i < 20; i++) {
        results1.push(strategy1.shouldRun());
        results2.push(strategy2.shouldRun());
      }

      // Very unlikely to be exactly the same with different seeds
      expect(results1).not.toEqual(results2);
    });
  });
});
