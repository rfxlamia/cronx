/**
 * Scheduler Unit Tests
 *
 * Tests for the main Scheduler class including lifecycle,
 * job initialization, execution, and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job, JobState } from '../../../src/types.js';
import { Scheduler, type SchedulerConfig, type JobStatus } from '../../../src/core/scheduler.js';
import type { SQLiteStore } from '../../../src/storage/sqlite.js';
import type { GatewayClient } from '../../../src/gateway/client.js';

// =============================================================================
// Test Helpers
// =============================================================================

function createMockJob(overrides: Partial<Job> = {}): Job {
  return {
    name: 'test-job',
    strategy: 'interval',
    config: { min: 60, max: 120, jitter: 0.1 },
    enabled: true,
    action: {
      message: 'Test message',
      priority: 'normal',
    },
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      timeout: 30,
    },
    onFailure: 'notify',
    ...overrides,
  };
}

function createMockStore(): SQLiteStore {
  return {
    recordRun: vi.fn().mockReturnValue(1),
    saveJobState: vi.fn(),
    getJobState: vi.fn().mockReturnValue(null),
    getAllJobStates: vi.fn().mockReturnValue([]),
    getRecentRuns: vi.fn().mockReturnValue([]),
    close: vi.fn(),
  } as unknown as SQLiteStore;
}

function createMockGateway(): GatewayClient {
  return {
    trigger: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
    notify: vi.fn().mockResolvedValue({ success: true }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as GatewayClient;
}

function createSchedulerConfig(
  jobs: Job[],
  store: SQLiteStore,
  gateway: GatewayClient
): SchedulerConfig {
  return {
    jobs,
    store,
    gateway,
    timezone: 'UTC',
    seed: 'test-seed',
  };
}

// =============================================================================
// Lifecycle Tests
// =============================================================================

describe('Scheduler', () => {
  let store: SQLiteStore;
  let gateway: GatewayClient;

  beforeEach(() => {
    vi.useFakeTimers();
    store = createMockStore();
    gateway = createMockGateway();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a Scheduler instance', () => {
      const job = createMockJob();
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      expect(scheduler).toBeInstanceOf(Scheduler);
    });

    it('should initialize strategies for each job', () => {
      const job1 = createMockJob({ name: 'job1' });
      const job2 = createMockJob({ name: 'job2', strategy: 'window', config: { start: '09:00', end: '17:00', timezone: 'UTC', distribution: 'uniform' } });
      const config = createSchedulerConfig([job1, job2], store, gateway);

      // Should not throw
      const scheduler = new Scheduler(config);
      expect(scheduler).toBeInstanceOf(Scheduler);
    });
  });

  describe('start()', () => {
    it('should initialize job states on start', async () => {
      const job = createMockJob({ name: 'init-test-job' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      expect(store.saveJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'init-test-job',
          enabled: true,
          failCount: 0,
        })
      );
    });

    it('should set nextRun for new jobs', async () => {
      const job = createMockJob({ name: 'new-job' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      expect(store.saveJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'new-job',
          nextRun: expect.any(Number),
        })
      );
    });

    it('should load existing state from store', async () => {
      const existingState: JobState = {
        name: 'existing-job',
        nextRun: Date.now() + 60000,
        lastRun: Date.now() - 60000,
        enabled: true,
        failCount: 2,
      };
      vi.mocked(store.getJobState).mockReturnValue(existingState);

      const job = createMockJob({ name: 'existing-job' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      // Should not overwrite existing state
      const status = scheduler.getStatus();
      const jobStatus = status.find(s => s.name === 'existing-job');
      expect(jobStatus?.lastRun).not.toBeNull();
    });

    it('should not re-initialize if already running', async () => {
      const job = createMockJob();
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();
      const firstCallCount = vi.mocked(store.saveJobState).mock.calls.length;

      await scheduler.start();
      const secondCallCount = vi.mocked(store.saveJobState).mock.calls.length;

      // Should not have been called again
      expect(secondCallCount).toBe(firstCallCount);
    });
  });

  describe('stop()', () => {
    it('should clear all timers when stopped', async () => {
      const job = createMockJob();
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();
      await scheduler.stop();

      // Advance time significantly - job should not execute
      vi.mocked(gateway.trigger).mockClear();
      await vi.advanceTimersByTimeAsync(1000000);

      expect(gateway.trigger).not.toHaveBeenCalled();
    });

    it('should save all job states when stopped', async () => {
      const job1 = createMockJob({ name: 'job1' });
      const job2 = createMockJob({ name: 'job2' });
      const config = createSchedulerConfig([job1, job2], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();
      vi.mocked(store.saveJobState).mockClear();

      await scheduler.stop();

      // Both jobs should have their states saved
      expect(store.saveJobState).toHaveBeenCalledTimes(2);
    });

    it('should be idempotent - multiple stops should not error', async () => {
      const job = createMockJob();
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();
      await scheduler.stop();

      // Should not throw
      await scheduler.stop();
    });
  });

  describe('getStatus()', () => {
    it('should return status for all jobs', async () => {
      const job1 = createMockJob({ name: 'status-job1' });
      const job2 = createMockJob({ name: 'status-job2', enabled: false });
      const config = createSchedulerConfig([job1, job2], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();

      expect(statuses).toHaveLength(2);
      expect(statuses.map(s => s.name)).toContain('status-job1');
      expect(statuses.map(s => s.name)).toContain('status-job2');
    });

    it('should return correct enabled status', async () => {
      const job = createMockJob({ name: 'enabled-check', enabled: true });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'enabled-check');

      expect(jobStatus?.enabled).toBe(true);
    });

    it('should return nextRun as Date object', async () => {
      const job = createMockJob({ name: 'date-check' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'date-check');

      expect(jobStatus?.nextRun).toBeInstanceOf(Date);
    });

    it('should return null for lastRun when job has never run', async () => {
      const job = createMockJob({ name: 'never-run' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'never-run');

      expect(jobStatus?.lastRun).toBeNull();
    });
  });

  // =============================================================================
  // Job Execution Tests
  // =============================================================================

  describe('job execution', () => {
    it('should execute job at scheduled time', async () => {
      const job = createMockJob({ name: 'scheduled-exec' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      // Get the scheduled next run time
      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'scheduled-exec');
      const nextRun = jobStatus!.nextRun!.getTime();

      // Advance time to just past the scheduled time
      const now = Date.now();
      const delay = nextRun - now;
      await vi.advanceTimersByTimeAsync(delay + 100);

      expect(gateway.trigger).toHaveBeenCalled();
    });

    it('should update state after successful execution', async () => {
      const job = createMockJob({ name: 'state-update' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'state-update');
      const nextRun = jobStatus!.nextRun!.getTime();

      vi.mocked(store.saveJobState).mockClear();

      // Advance to execution time
      const now = Date.now();
      await vi.advanceTimersByTimeAsync(nextRun - now + 100);

      // State should be saved after execution
      expect(store.saveJobState).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'state-update',
          lastRun: expect.any(Number),
        })
      );
    });

    it('should calculate new nextRun after execution', async () => {
      const job = createMockJob({ name: 'next-calc' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const firstNextRun = statuses.find(s => s.name === 'next-calc')!.nextRun!.getTime();

      // Execute the job
      const now = Date.now();
      await vi.advanceTimersByTimeAsync(firstNextRun - now + 100);

      // Check that a new nextRun was scheduled (saveJobState called with new nextRun)
      const lastCall = vi.mocked(store.saveJobState).mock.calls.pop();
      expect(lastCall?.[0].nextRun).toBeGreaterThan(firstNextRun);
    });
  });

  // =============================================================================
  // Probabilistic Strategy Tests
  // =============================================================================

  describe('probabilistic job execution', () => {
    it('should respect shouldRun() for probabilistic jobs', async () => {
      const job = createMockJob({
        name: 'prob-job',
        strategy: 'probabilistic',
        config: { checkInterval: 60, probability: 0.0 }, // 0% probability - never runs
      });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(300000); // 5 minutes

      // Job should never execute because probability is 0
      // But the scheduler should keep checking and re-scheduling
      expect(gateway.trigger).not.toHaveBeenCalled();
    });
  });

  // =============================================================================
  // Error Handling Tests
  // =============================================================================

  describe('error handling', () => {
    it('should increment failCount on failed execution', async () => {
      const job = createMockJob({
        name: 'fail-count',
        retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 },
      });
      vi.mocked(gateway.trigger).mockRejectedValue(new Error('Gateway error'));

      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const nextRun = statuses.find(s => s.name === 'fail-count')!.nextRun!.getTime();

      vi.mocked(store.saveJobState).mockClear();

      // Execute the job
      const now = Date.now();
      await vi.advanceTimersByTimeAsync(nextRun - now + 100);

      // Give time for async execution
      await vi.advanceTimersByTimeAsync(100);

      // Check that failCount was incremented
      const saveStateCalls = vi.mocked(store.saveJobState).mock.calls;
      const lastState = saveStateCalls[saveStateCalls.length - 1]?.[0];
      expect(lastState?.failCount).toBeGreaterThan(0);
    });

    it('should not crash scheduler on job execution error', async () => {
      const job1 = createMockJob({ name: 'error-job', retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 } });
      const job2 = createMockJob({ name: 'normal-job' });

      vi.mocked(gateway.trigger)
        .mockRejectedValueOnce(new Error('Job 1 failed'))
        .mockResolvedValue({ success: true, message: 'OK' });

      const config = createSchedulerConfig([job1, job2], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      // Get next run times
      const statuses = scheduler.getStatus();
      const errorJobNextRun = statuses.find(s => s.name === 'error-job')!.nextRun!.getTime();
      const normalJobNextRun = statuses.find(s => s.name === 'normal-job')!.nextRun!.getTime();
      const maxNextRun = Math.max(errorJobNextRun, normalJobNextRun);

      // Advance past both scheduled times
      const now = Date.now();
      await vi.advanceTimersByTimeAsync(maxNextRun - now + 5000);

      // Scheduler should still be operational
      const newStatuses = scheduler.getStatus();
      expect(newStatuses).toHaveLength(2);
    });

    it('should reset failCount on successful execution after failures', async () => {
      // Start with existing failed state
      const existingState: JobState = {
        name: 'recovery-job',
        nextRun: Date.now() + 1000,
        lastRun: Date.now() - 60000,
        enabled: true,
        failCount: 5, // Previous failures
      };
      vi.mocked(store.getJobState).mockReturnValue(existingState);

      const job = createMockJob({ name: 'recovery-job' });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();
      vi.mocked(store.saveJobState).mockClear();

      // Execute successfully
      await vi.advanceTimersByTimeAsync(2000);

      // failCount should be reset to 0
      const lastCall = vi.mocked(store.saveJobState).mock.calls.pop();
      expect(lastCall?.[0].failCount).toBe(0);
    });
  });

  // =============================================================================
  // Disabled Jobs Tests
  // =============================================================================

  describe('disabled jobs', () => {
    it('should not schedule disabled jobs', async () => {
      const job = createMockJob({ name: 'disabled-job', enabled: false });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(1000000);

      // Job should never execute
      expect(gateway.trigger).not.toHaveBeenCalled();
    });

    it('should still track state for disabled jobs', async () => {
      const job = createMockJob({ name: 'disabled-tracked', enabled: false });
      const config = createSchedulerConfig([job], store, gateway);
      const scheduler = new Scheduler(config);

      await scheduler.start();

      const statuses = scheduler.getStatus();
      const jobStatus = statuses.find(s => s.name === 'disabled-tracked');

      expect(jobStatus).toBeDefined();
      expect(jobStatus?.enabled).toBe(false);
    });
  });
});
