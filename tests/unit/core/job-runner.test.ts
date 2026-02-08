/**
 * JobRunner Unit Tests
 *
 * Tests for job execution with retry, backoff, and failure handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job, RetryConfig } from '../../../src/types.js';
import { JobRunner, type RunResult } from '../../../src/core/job-runner.js';
import type { GatewayClient } from '../../../src/gateway/client.js';
import type { SQLiteStore } from '../../../src/storage/sqlite.js';

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

function createMockGateway(): GatewayClient {
  return {
    trigger: vi.fn().mockResolvedValue({ success: true, message: 'OK' }),
    notify: vi.fn().mockResolvedValue({ success: true }),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as GatewayClient;
}

function createMockStore(): SQLiteStore {
  return {
    recordRun: vi.fn().mockReturnValue(1),
    saveJobState: vi.fn(),
    getJobState: vi.fn(),
    getAllJobStates: vi.fn(),
    getRecentRuns: vi.fn(),
    close: vi.fn(),
  } as unknown as SQLiteStore;
}

// =============================================================================
// Tests
// =============================================================================

describe('JobRunner', () => {
  let gateway: GatewayClient;
  let store: SQLiteStore;
  let runner: JobRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    gateway = createMockGateway();
    store = createMockStore();
    runner = new JobRunner(gateway, store);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a JobRunner instance', () => {
      expect(runner).toBeInstanceOf(JobRunner);
    });
  });

  describe('run', () => {
    describe('successful execution', () => {
      it('should return success status when gateway call succeeds', async () => {
        const job = createMockJob();

        const result = await runner.run(job);

        expect(result.status).toBe('success');
        expect(result.attempts).toBe(1);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.error).toBeUndefined();
      });

      it('should call gateway.trigger with correct parameters', async () => {
        const job = createMockJob({
          action: { message: 'Check email', priority: 'high' },
        });

        await runner.run(job);

        expect(gateway.trigger).toHaveBeenCalledWith({
          message: 'Check email',
          priority: 'high',
        });
      });

      it('should record run to SQLite store', async () => {
        const job = createMockJob();

        await runner.run(job);

        expect(store.recordRun).toHaveBeenCalledWith(
          expect.objectContaining({
            jobName: 'test-job',
            status: 'success',
            attempts: 1,
          })
        );
      });
    });

    describe('retry behavior', () => {
      it('should retry on failure up to maxAttempts', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 3, backoff: 'fixed', timeout: 30 },
        });

        vi.mocked(gateway.trigger)
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({ success: true, message: 'OK' });

        const resultPromise = runner.run(job);

        // Advance time for retries
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1000);

        const result = await resultPromise;

        expect(result.status).toBe('success');
        expect(result.attempts).toBe(3);
      });

      it('should return failed status after exhausting retries', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 3, backoff: 'fixed', timeout: 30 },
        });

        vi.mocked(gateway.trigger).mockRejectedValue(new Error('Persistent error'));

        const resultPromise = runner.run(job);

        // Advance time for all retry attempts
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(1000);

        const result = await resultPromise;

        expect(result.status).toBe('failed');
        expect(result.attempts).toBe(3);
        expect(result.error).toBe('Persistent error');
      });

      it('should record failed run to SQLite store', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 },
        });

        vi.mocked(gateway.trigger).mockRejectedValue(new Error('Gateway down'));

        const result = await runner.run(job);

        expect(store.recordRun).toHaveBeenCalledWith(
          expect.objectContaining({
            jobName: 'test-job',
            status: 'failed',
            error: 'Gateway down',
            attempts: 1,
          })
        );
      });
    });

    describe('backoff strategies', () => {
      it('should apply fixed backoff (1 second delay)', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 3, backoff: 'fixed', timeout: 30 },
        });

        vi.mocked(gateway.trigger)
          .mockRejectedValueOnce(new Error('Error 1'))
          .mockResolvedValueOnce({ success: true, message: 'OK' });

        const runPromise = runner.run(job);

        // First attempt fails immediately
        await vi.advanceTimersByTimeAsync(0);

        // Fixed backoff should wait 1 second
        expect(gateway.trigger).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000);

        const result = await runPromise;
        expect(gateway.trigger).toHaveBeenCalledTimes(2);
        expect(result.attempts).toBe(2);
      });

      it('should apply linear backoff (n * 1 second delay)', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 4, backoff: 'linear', timeout: 30 },
        });

        vi.mocked(gateway.trigger)
          .mockRejectedValueOnce(new Error('Error 1'))
          .mockRejectedValueOnce(new Error('Error 2'))
          .mockRejectedValueOnce(new Error('Error 3'))
          .mockResolvedValueOnce({ success: true, message: 'OK' });

        const runPromise = runner.run(job);

        // First attempt fails
        await vi.advanceTimersByTimeAsync(0);
        expect(gateway.trigger).toHaveBeenCalledTimes(1);

        // Linear: 1 * 1000ms = 1s
        await vi.advanceTimersByTimeAsync(1000);
        expect(gateway.trigger).toHaveBeenCalledTimes(2);

        // Linear: 2 * 1000ms = 2s
        await vi.advanceTimersByTimeAsync(2000);
        expect(gateway.trigger).toHaveBeenCalledTimes(3);

        // Linear: 3 * 1000ms = 3s
        await vi.advanceTimersByTimeAsync(3000);

        const result = await runPromise;
        expect(gateway.trigger).toHaveBeenCalledTimes(4);
        expect(result.attempts).toBe(4);
      });

      it('should apply exponential backoff (2^n * 1 second delay)', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 4, backoff: 'exponential', timeout: 30 },
        });

        vi.mocked(gateway.trigger)
          .mockRejectedValueOnce(new Error('Error 1'))
          .mockRejectedValueOnce(new Error('Error 2'))
          .mockRejectedValueOnce(new Error('Error 3'))
          .mockResolvedValueOnce({ success: true, message: 'OK' });

        const runPromise = runner.run(job);

        // First attempt fails
        await vi.advanceTimersByTimeAsync(0);
        expect(gateway.trigger).toHaveBeenCalledTimes(1);

        // Exponential: 2^1 * 1000ms = 2s
        await vi.advanceTimersByTimeAsync(2000);
        expect(gateway.trigger).toHaveBeenCalledTimes(2);

        // Exponential: 2^2 * 1000ms = 4s
        await vi.advanceTimersByTimeAsync(4000);
        expect(gateway.trigger).toHaveBeenCalledTimes(3);

        // Exponential: 2^3 * 1000ms = 8s
        await vi.advanceTimersByTimeAsync(8000);

        const result = await runPromise;
        expect(gateway.trigger).toHaveBeenCalledTimes(4);
        expect(result.attempts).toBe(4);
      });
    });

    describe('timeout handling', () => {
      it('should timeout if gateway call takes too long', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 1, backoff: 'fixed', timeout: 5 },
        });

        // Gateway call that never resolves
        vi.mocked(gateway.trigger).mockImplementation(
          () => new Promise(() => {})
        );

        const runPromise = runner.run(job);

        // Advance past timeout (5 seconds)
        await vi.advanceTimersByTimeAsync(5000);

        const result = await runPromise;

        expect(result.status).toBe('timeout');
        expect(result.attempts).toBe(1);
      });
    });

    describe('failure notification', () => {
      it('should notify on failure when onFailure is "notify"', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 },
          onFailure: 'notify',
        });

        vi.mocked(gateway.trigger).mockRejectedValue(new Error('Job failed'));

        await runner.run(job);

        expect(gateway.notify).toHaveBeenCalledWith(
          expect.stringContaining('test-job'),
          'high'
        );
      });

      it('should escalate on failure when onFailure is "escalate"', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 },
          onFailure: 'escalate',
        });

        vi.mocked(gateway.trigger).mockRejectedValue(new Error('Critical failure'));

        await runner.run(job);

        expect(gateway.notify).toHaveBeenCalledWith(
          expect.stringContaining('ESCALATE'),
          'high'
        );
      });

      it('should not notify when onFailure is "silent"', async () => {
        const job = createMockJob({
          retry: { maxAttempts: 1, backoff: 'fixed', timeout: 30 },
          onFailure: 'silent',
        });

        vi.mocked(gateway.trigger).mockRejectedValue(new Error('Silent failure'));

        await runner.run(job);

        expect(gateway.notify).not.toHaveBeenCalled();
      });
    });

    describe('default retry config', () => {
      it('should use default retry config when job has no retry config', async () => {
        const job = createMockJob();
        delete job.retry;

        vi.mocked(gateway.trigger)
          .mockRejectedValueOnce(new Error('Error'))
          .mockResolvedValueOnce({ success: true, message: 'OK' });

        const runPromise = runner.run(job);

        // Default is exponential, so 2^1 * 1000ms = 2s
        await vi.advanceTimersByTimeAsync(2000);

        const result = await runPromise;

        expect(result.status).toBe('success');
        expect(result.attempts).toBe(2);
      });
    });
  });
});
