/**
 * Strategy Factory Tests
 *
 * Tests for unified strategy creation from job definitions
 */
import { describe, it, expect } from 'vitest';
import { createStrategy, type StrategyWrapper } from '../../../src/strategies/index.js';
import type { Job, WindowConfig, IntervalConfig, ProbabilisticConfig } from '../../../src/types.js';

describe('createStrategy', () => {
  describe('window strategy jobs', () => {
    it('should create StrategyWrapper for window job', () => {
      const job: Job = {
        name: 'test-window-job',
        strategy: 'window',
        config: {
          start: '09:00',
          end: '17:00',
          timezone: 'UTC',
          distribution: 'uniform',
        } as WindowConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job);

      expect(wrapper).toBeDefined();
      expect(wrapper.type).toBe('window');
      expect(typeof wrapper.calculateNextRun).toBe('function');
    });

    it('should calculate next run for window strategy', () => {
      const job: Job = {
        name: 'test-window-job',
        strategy: 'window',
        config: {
          start: '09:00',
          end: '17:00',
          timezone: 'UTC',
          distribution: 'uniform',
        } as WindowConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job, 'test-seed');
      const nextRun = wrapper.calculateNextRun(null);

      expect(nextRun).toBeGreaterThan(0);
      expect(typeof nextRun).toBe('number');
    });
  });

  describe('interval strategy jobs', () => {
    it('should create StrategyWrapper for interval job', () => {
      const job: Job = {
        name: 'test-interval-job',
        strategy: 'interval',
        config: {
          min: 300,
          max: 600,
          jitter: 0.1,
        } as IntervalConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job);

      expect(wrapper).toBeDefined();
      expect(wrapper.type).toBe('interval');
      expect(typeof wrapper.calculateNextRun).toBe('function');
    });

    it('should calculate next run for interval strategy', () => {
      const now = Date.now();
      const job: Job = {
        name: 'test-interval-job',
        strategy: 'interval',
        config: {
          min: 300,
          max: 600,
          jitter: 0,
        } as IntervalConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job, 'test-seed');
      const nextRun = wrapper.calculateNextRun(null);

      expect(nextRun).toBeGreaterThan(now);
    });
  });

  describe('probabilistic strategy jobs', () => {
    it('should create StrategyWrapper for probabilistic job', () => {
      const job: Job = {
        name: 'test-prob-job',
        strategy: 'probabilistic',
        config: {
          checkInterval: 300,
          probability: 0.3,
        } as ProbabilisticConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job);

      expect(wrapper).toBeDefined();
      expect(wrapper.type).toBe('probabilistic');
      expect(typeof wrapper.calculateNextRun).toBe('function');
      expect(typeof wrapper.shouldRun).toBe('function');
      expect(typeof wrapper.getNextCheckTime).toBe('function');
    });

    it('should delegate shouldRun to probabilistic strategy', () => {
      const job: Job = {
        name: 'test-prob-job',
        strategy: 'probabilistic',
        config: {
          checkInterval: 300,
          probability: 1.0, // Always run
        } as ProbabilisticConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job, 'test-seed');

      expect(wrapper.shouldRun?.()).toBe(true);
    });

    it('should calculate next check time for probabilistic strategy', () => {
      const now = Date.now();
      const job: Job = {
        name: 'test-prob-job',
        strategy: 'probabilistic',
        config: {
          checkInterval: 300,
          probability: 0.5,
        } as ProbabilisticConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job, 'test-seed');
      const nextCheck = wrapper.getNextCheckTime?.();

      expect(nextCheck).toBeDefined();
      expect(nextCheck).toBeGreaterThan(now);
    });

    it('calculateNextRun should return next check time for probabilistic', () => {
      const job: Job = {
        name: 'test-prob-job',
        strategy: 'probabilistic',
        config: {
          checkInterval: 300,
          probability: 0.5,
        } as ProbabilisticConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper = createStrategy(job, 'test-seed');
      const nextRun = wrapper.calculateNextRun(null);
      const nextCheck = wrapper.getNextCheckTime?.();

      // For probabilistic, calculateNextRun returns next check time
      expect(nextRun).toBe(nextCheck);
    });
  });

  describe('reproducibility', () => {
    it('should produce same results with same seed for window', () => {
      const job: Job = {
        name: 'test-job',
        strategy: 'window',
        config: {
          start: '09:00',
          end: '17:00',
          timezone: 'UTC',
          distribution: 'uniform',
        } as WindowConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper1 = createStrategy(job, 'same-seed');
      const wrapper2 = createStrategy(job, 'same-seed');

      expect(wrapper1.calculateNextRun(null)).toBe(wrapper2.calculateNextRun(null));
    });

    it('should produce same results with same seed for interval', () => {
      const job: Job = {
        name: 'test-job',
        strategy: 'interval',
        config: {
          min: 300,
          max: 600,
          jitter: 0.1,
        } as IntervalConfig,
        enabled: true,
        action: { message: 'test' },
      };

      const wrapper1 = createStrategy(job, 'same-seed');
      const wrapper2 = createStrategy(job, 'same-seed');

      expect(wrapper1.calculateNextRun(null)).toBe(wrapper2.calculateNextRun(null));
    });
  });

  describe('error handling', () => {
    it('should throw error for unknown strategy type', () => {
      const job = {
        name: 'test-job',
        strategy: 'unknown' as any,
        config: {},
        enabled: true,
        action: { message: 'test' },
      } as Job;

      expect(() => createStrategy(job)).toThrow(/unknown strategy/i);
    });
  });
});
