/**
 * WindowStrategy Tests
 *
 * Tests for window-based scheduling with uniform, gaussian, and weighted distributions
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WindowStrategy } from '../../../src/strategies/window.js';
import type { WindowConfig } from '../../../src/types.js';
import { parseTime } from '../../../src/utils/time.js';

describe('WindowStrategy', () => {
  // Helper to get today's window boundaries
  const getWindowBoundaries = (start: string, end: string, timezone: string) => {
    let windowStart = parseTime(start, timezone);
    let windowEnd = parseTime(end, timezone);
    // Handle midnight spanning
    if (windowEnd <= windowStart) {
      windowEnd += 24 * 60 * 60 * 1000;
    }
    return { windowStart, windowEnd };
  };

  describe('constructor', () => {
    it('should create a strategy with valid config', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const strategy = new WindowStrategy(config);
      expect(strategy).toBeDefined();
    });

    it('should accept optional seed for reproducibility', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const strategy1 = new WindowStrategy(config, 'test-seed');
      const strategy2 = new WindowStrategy(config, 'test-seed');

      const result1 = strategy1.calculateNextRun(null);
      const result2 = strategy2.calculateNextRun(null);

      expect(result1).toBe(result2);
    });

    it('should accept options object with seed and getNow', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const fixedNow = Date.now();
      const strategy = new WindowStrategy(config, {
        seed: 'test-seed',
        getNow: () => fixedNow,
      });

      expect(strategy).toBeDefined();
    });
  });

  describe('calculateNextRun with uniform distribution', () => {
    it('should return timestamp within today window when window is active', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');

      // Set "now" to middle of window
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;

      const strategy = new WindowStrategy(config, {
        seed: 'test-seed',
        getNow: () => middleOfWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      expect(nextRun).toBeGreaterThanOrEqual(windowStart);
      expect(nextRun).toBeLessThanOrEqual(windowEnd);
    });

    it('should schedule for tomorrow when window has passed', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const DAY_MS = 24 * 60 * 60 * 1000;

      // Set "now" to 1 hour after window end
      const afterWindow = windowEnd + 60 * 60 * 1000;

      const strategy = new WindowStrategy(config, {
        seed: 'test-seed',
        getNow: () => afterWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      // Should be tomorrow's window
      expect(nextRun).toBeGreaterThanOrEqual(windowStart + DAY_MS);
      expect(nextRun).toBeLessThanOrEqual(windowEnd + DAY_MS);
    });

    it('should schedule for today when before window start', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');

      // Set "now" to 1 hour before window start
      const beforeWindow = windowStart - 60 * 60 * 1000;

      const strategy = new WindowStrategy(config, {
        seed: 'test-seed',
        getNow: () => beforeWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      // Should be today's window
      expect(nextRun).toBeGreaterThanOrEqual(windowStart);
      expect(nextRun).toBeLessThanOrEqual(windowEnd);
    });

    it('should produce uniform distribution across window', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;

      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = new WindowStrategy(config, {
          seed: `uniform-${i}`,
          getNow: () => middleOfWindow,
        });
        results.push(s.calculateNextRun(null));
      }

      // All should be within window
      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(windowStart);
        expect(r).toBeLessThanOrEqual(windowEnd);
      });

      // For uniform distribution, roughly equal in each half
      const firstHalf = results.filter(r => r < (windowStart + windowEnd) / 2);
      const secondHalf = results.filter(r => r >= (windowStart + windowEnd) / 2);

      // Both halves should have roughly 50% (allow 30-70 range for 100 samples)
      expect(firstHalf.length).toBeGreaterThan(30);
      expect(secondHalf.length).toBeGreaterThan(30);
    });
  });

  describe('calculateNextRun with gaussian distribution', () => {
    it('should return timestamp weighted towards middle of window', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'gaussian',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;
      const windowMiddle = (windowStart + windowEnd) / 2;
      const windowQuarter = (windowEnd - windowStart) / 4;

      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = new WindowStrategy(config, {
          seed: `gaussian-${i}`,
          getNow: () => middleOfWindow,
        });
        results.push(s.calculateNextRun(null));
      }

      // All should be within window
      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(windowStart);
        expect(r).toBeLessThanOrEqual(windowEnd);
      });

      // Most should be near the middle (within middle 50%)
      const nearMiddle = results.filter(r =>
        r >= windowMiddle - windowQuarter && r <= windowMiddle + windowQuarter
      );
      expect(nearMiddle.length).toBeGreaterThan(50); // >50% should be in middle 50%
    });
  });

  describe('calculateNextRun with weighted distribution', () => {
    it('should return timestamp using default weights', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'weighted',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;

      const strategy = new WindowStrategy(config, {
        seed: 'weighted-seed',
        getNow: () => middleOfWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      expect(nextRun).toBeGreaterThanOrEqual(windowStart);
      expect(nextRun).toBeLessThanOrEqual(windowEnd);
    });

    it('should produce weighted distribution towards middle', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'weighted',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;
      const windowMiddle = (windowStart + windowEnd) / 2;
      const windowQuarter = (windowEnd - windowStart) / 4;

      const results: number[] = [];
      for (let i = 0; i < 100; i++) {
        const s = new WindowStrategy(config, {
          seed: `weight-${i}`,
          getNow: () => middleOfWindow,
        });
        results.push(s.calculateNextRun(null));
      }

      // All should be within window
      results.forEach(r => {
        expect(r).toBeGreaterThanOrEqual(windowStart);
        expect(r).toBeLessThanOrEqual(windowEnd);
      });

      // With default weights [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05],
      // middle area should have more samples
      const nearMiddle = results.filter(r =>
        r >= windowMiddle - windowQuarter && r <= windowMiddle + windowQuarter
      );
      expect(nearMiddle.length).toBeGreaterThan(40); // Most should be in middle area
    });
  });

  describe('timezone handling', () => {
    it('should correctly calculate window in non-UTC timezone', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'Asia/Jakarta',
        distribution: 'uniform',
      };

      // Get Jakarta window boundaries
      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'Asia/Jakarta');

      // Set "now" to middle of Jakarta window
      const middleOfWindow = windowStart + (windowEnd - windowStart) / 2;

      const strategy = new WindowStrategy(config, {
        seed: 'tz-seed',
        getNow: () => middleOfWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      expect(nextRun).toBeGreaterThanOrEqual(windowStart);
      expect(nextRun).toBeLessThanOrEqual(windowEnd);
    });

    it('should schedule for tomorrow when window has passed in timezone', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'Asia/Jakarta',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'Asia/Jakarta');
      const DAY_MS = 24 * 60 * 60 * 1000;

      // Set "now" to 1 hour after Jakarta window end
      const afterWindow = windowEnd + 60 * 60 * 1000;

      const strategy = new WindowStrategy(config, {
        seed: 'tz-seed',
        getNow: () => afterWindow,
      });

      const nextRun = strategy.calculateNextRun(null);

      // Should be tomorrow's window
      expect(nextRun).toBeGreaterThanOrEqual(windowStart + DAY_MS);
      expect(nextRun).toBeLessThanOrEqual(windowEnd + DAY_MS);
    });
  });

  describe('reproducibility', () => {
    it('should produce same result with same seed', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const fixedNow = windowStart + (windowEnd - windowStart) / 2;

      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = new WindowStrategy(config, {
          seed: 'same-seed',
          getNow: () => fixedNow,
        });
        results.push(s.calculateNextRun(null));
      }

      // All results should be identical
      expect(new Set(results).size).toBe(1);
    });

    it('should produce different results with different seeds', () => {
      const config: WindowConfig = {
        start: '09:00',
        end: '17:00',
        timezone: 'UTC',
        distribution: 'uniform',
      };

      const { windowStart, windowEnd } = getWindowBoundaries('09:00', '17:00', 'UTC');
      const fixedNow = windowStart + (windowEnd - windowStart) / 2;

      const results: number[] = [];
      for (let i = 0; i < 10; i++) {
        const s = new WindowStrategy(config, {
          seed: `different-${i}`,
          getNow: () => fixedNow,
        });
        results.push(s.calculateNextRun(null));
      }

      // Should have multiple unique values
      expect(new Set(results).size).toBeGreaterThan(1);
    });
  });
});
