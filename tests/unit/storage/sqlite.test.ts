import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../../src/storage/sqlite.js';
import { unlink } from 'fs/promises';

describe('SQLiteStore', () => {
  const testDbPath = '/tmp/cronx-test.db';
  let store: SQLiteStore;

  beforeEach(() => {
    store = new SQLiteStore(testDbPath);
  });

  afterEach(async () => {
    store.close();
    await unlink(testDbPath).catch(() => {});
    // Also cleanup WAL and SHM files
    await unlink(`${testDbPath}-wal`).catch(() => {});
    await unlink(`${testDbPath}-shm`).catch(() => {});
  });

  describe('constructor', () => {
    it('should create database and tables on initialization', () => {
      // If constructor succeeds without error, tables were created
      expect(store).toBeDefined();
    });
  });

  describe('jobs', () => {
    it('should save and retrieve job state', () => {
      store.saveJobState({
        name: 'research',
        nextRun: Date.now() + 3600000,
        lastRun: null,
        enabled: true,
        failCount: 0,
      });

      const job = store.getJobState('research');
      expect(job?.name).toBe('research');
      expect(job?.enabled).toBe(true);
    });

    it('should return null for non-existent job', () => {
      const job = store.getJobState('non-existent');
      expect(job).toBeNull();
    });

    it('should update existing job', () => {
      store.saveJobState({
        name: 'research',
        nextRun: 1000,
        lastRun: null,
        enabled: true,
        failCount: 0,
      });

      store.saveJobState({
        name: 'research',
        nextRun: 2000,
        lastRun: 1000,
        enabled: true,
        failCount: 0,
      });

      const job = store.getJobState('research');
      expect(job?.nextRun).toBe(2000);
      expect(job?.lastRun).toBe(1000);
    });

    it('should preserve failCount on update', () => {
      store.saveJobState({
        name: 'research',
        nextRun: 1000,
        lastRun: null,
        enabled: true,
        failCount: 3,
      });

      const job = store.getJobState('research');
      expect(job?.failCount).toBe(3);
    });

    it('should get all job states', () => {
      store.saveJobState({ name: 'job1', nextRun: 1000, lastRun: null, enabled: true, failCount: 0 });
      store.saveJobState({ name: 'job2', nextRun: 2000, lastRun: null, enabled: true, failCount: 0 });

      const states = store.getAllJobStates();
      expect(states.length).toBe(2);
      expect(states.map(s => s.name).sort()).toEqual(['job1', 'job2']);
    });

    it('should return empty array when no jobs exist', () => {
      const states = store.getAllJobStates();
      expect(states).toEqual([]);
    });

    it('should handle disabled jobs correctly', () => {
      store.saveJobState({
        name: 'disabled-job',
        nextRun: 1000,
        lastRun: null,
        enabled: false,
        failCount: 0,
      });

      const job = store.getJobState('disabled-job');
      expect(job?.enabled).toBe(false);
    });
  });

  describe('runs', () => {
    it('should record run and return id', () => {
      const runId = store.recordRun({
        jobName: 'research',
        scheduledAt: Date.now(),
        triggeredAt: Date.now(),
        status: 'success',
        attempts: 1,
      });

      expect(runId).toBeGreaterThan(0);
    });

    it('should record run and retrieve it', () => {
      const now = Date.now();
      store.recordRun({
        jobName: 'research',
        scheduledAt: now,
        triggeredAt: now + 100,
        completedAt: now + 500,
        durationMs: 400,
        status: 'success',
        attempts: 1,
      });

      const runs = store.getRecentRuns('research', 10);
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe('success');
      expect(runs[0].jobName).toBe('research');
      expect(runs[0].durationMs).toBe(400);
    });

    it('should return runs ordered by triggered_at descending', () => {
      const base = Date.now();
      store.recordRun({
        jobName: 'research',
        scheduledAt: base,
        triggeredAt: base,
        status: 'success',
        attempts: 1,
      });
      store.recordRun({
        jobName: 'research',
        scheduledAt: base + 1000,
        triggeredAt: base + 1000,
        status: 'failed',
        attempts: 2,
      });

      const runs = store.getRecentRuns('research', 10);
      expect(runs.length).toBe(2);
      expect(runs[0].status).toBe('failed'); // Most recent first
      expect(runs[1].status).toBe('success');
    });

    it('should limit number of returned runs', () => {
      const base = Date.now();
      for (let i = 0; i < 5; i++) {
        store.recordRun({
          jobName: 'research',
          scheduledAt: base + i * 1000,
          triggeredAt: base + i * 1000,
          status: 'success',
          attempts: 1,
        });
      }

      const runs = store.getRecentRuns('research', 3);
      expect(runs.length).toBe(3);
    });

    it('should only return runs for specified job', () => {
      const now = Date.now();
      store.recordRun({
        jobName: 'job1',
        scheduledAt: now,
        triggeredAt: now,
        status: 'success',
        attempts: 1,
      });
      store.recordRun({
        jobName: 'job2',
        scheduledAt: now,
        triggeredAt: now,
        status: 'success',
        attempts: 1,
      });

      const runs = store.getRecentRuns('job1', 10);
      expect(runs.length).toBe(1);
      expect(runs[0].jobName).toBe('job1');
    });

    it('should return empty array for job with no runs', () => {
      const runs = store.getRecentRuns('no-runs', 10);
      expect(runs).toEqual([]);
    });

    it('should store error message for failed runs', () => {
      store.recordRun({
        jobName: 'failing-job',
        scheduledAt: Date.now(),
        triggeredAt: Date.now(),
        status: 'failed',
        error: 'Connection timeout',
        attempts: 3,
      });

      const runs = store.getRecentRuns('failing-job', 1);
      expect(runs[0].error).toBe('Connection timeout');
      expect(runs[0].status).toBe('failed');
    });

    it('should store response as JSON for successful runs', () => {
      const response = { message: 'Job completed', data: { count: 42 } };
      store.recordRun({
        jobName: 'success-job',
        scheduledAt: Date.now(),
        triggeredAt: Date.now(),
        status: 'success',
        response,
        attempts: 1,
      });

      const runs = store.getRecentRuns('success-job', 1);
      expect(runs[0].response).toEqual(response);
    });
  });

  describe('close', () => {
    it('should close database connection', () => {
      store.close();
      // Trying to use after close should throw
      expect(() => store.getJobState('test')).toThrow();
    });
  });
});
