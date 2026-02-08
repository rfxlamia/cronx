/**
 * SQLite Storage Layer for CRONX
 *
 * Provides persistent storage for job states and run history.
 *
 * @packageDocumentation
 */

import Database from 'better-sqlite3';
import type { JobState, RunRecord } from '../types.js';

/**
 * SQLite-based storage for CRONX scheduler
 *
 * Stores job states and run history in a local SQLite database.
 * Uses WAL mode for better concurrent read performance.
 */
export class SQLiteStore {
  private db: Database.Database;

  /**
   * Create a new SQLiteStore instance
   *
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    // Disable foreign keys for flexibility - runs can be recorded
    // without a corresponding job entry in the jobs table
    this.db.pragma('foreign_keys = OFF');
    this.migrate();
  }

  /**
   * Create database tables if they don't exist
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        name TEXT PRIMARY KEY,
        next_run INTEGER,
        last_run INTEGER,
        enabled INTEGER DEFAULT 1,
        fail_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT NOT NULL,
        scheduled_at INTEGER,
        triggered_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,
        status TEXT,
        response TEXT,
        error TEXT,
        attempts INTEGER DEFAULT 1,
        FOREIGN KEY (job_name) REFERENCES jobs(name)
      );

      CREATE TABLE IF NOT EXISTS circuit_breakers (
        job_name TEXT PRIMARY KEY,
        state TEXT DEFAULT 'closed',
        failure_count INTEGER DEFAULT 0,
        last_failure_at INTEGER,
        opened_at INTEGER,
        FOREIGN KEY (job_name) REFERENCES jobs(name)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON jobs(next_run) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_runs_job_time ON runs(job_name, triggered_at);
    `);
  }

  /**
   * Save or update a job state
   *
   * @param state - The job state to save
   */
  saveJobState(state: JobState): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (name, next_run, last_run, enabled, fail_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        next_run = excluded.next_run,
        last_run = excluded.last_run,
        enabled = excluded.enabled,
        fail_count = excluded.fail_count,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      state.name,
      state.nextRun,
      state.lastRun,
      state.enabled ? 1 : 0,
      state.failCount,
      Date.now()
    );
  }

  /**
   * Get a job state by name
   *
   * @param name - The job name
   * @returns The job state or null if not found
   */
  getJobState(name: string): JobState | null {
    const stmt = this.db.prepare(`
      SELECT name, next_run, last_run, enabled, fail_count
      FROM jobs
      WHERE name = ?
    `);

    const row = stmt.get(name) as {
      name: string;
      next_run: number | null;
      last_run: number | null;
      enabled: number;
      fail_count: number;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      name: row.name,
      nextRun: row.next_run,
      lastRun: row.last_run,
      enabled: row.enabled === 1,
      failCount: row.fail_count,
    };
  }

  /**
   * Get all job states
   *
   * @returns Array of all job states
   */
  getAllJobStates(): JobState[] {
    const stmt = this.db.prepare(`
      SELECT name, next_run, last_run, enabled, fail_count
      FROM jobs
      ORDER BY name
    `);

    const rows = stmt.all() as Array<{
      name: string;
      next_run: number | null;
      last_run: number | null;
      enabled: number;
      fail_count: number;
    }>;

    return rows.map(row => ({
      name: row.name,
      nextRun: row.next_run,
      lastRun: row.last_run,
      enabled: row.enabled === 1,
      failCount: row.fail_count,
    }));
  }

  /**
   * Record a job run
   *
   * @param run - The run record to save
   * @returns The ID of the created run record
   */
  recordRun(run: RunRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO runs (job_name, scheduled_at, triggered_at, completed_at, duration_ms, status, response, error, attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      run.jobName,
      run.scheduledAt,
      run.triggeredAt,
      run.completedAt ?? null,
      run.durationMs ?? null,
      run.status,
      run.response !== undefined ? JSON.stringify(run.response) : null,
      run.error ?? null,
      run.attempts
    );

    return Number(result.lastInsertRowid);
  }

  /**
   * Get recent runs for a job
   *
   * @param jobName - The job name
   * @param limit - Maximum number of runs to return
   * @returns Array of run records, ordered by triggered_at descending
   */
  getRecentRuns(jobName: string, limit: number): RunRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, job_name, scheduled_at, triggered_at, completed_at, duration_ms, status, response, error, attempts
      FROM runs
      WHERE job_name = ?
      ORDER BY triggered_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(jobName, limit) as Array<{
      id: number;
      job_name: string;
      scheduled_at: number;
      triggered_at: number;
      completed_at: number | null;
      duration_ms: number | null;
      status: string;
      response: string | null;
      error: string | null;
      attempts: number;
    }>;

    return rows.map(row => {
      const record: RunRecord = {
        id: row.id,
        jobName: row.job_name,
        scheduledAt: row.scheduled_at,
        triggeredAt: row.triggered_at,
        status: row.status as RunRecord['status'],
        attempts: row.attempts,
      };

      if (row.completed_at !== null) {
        record.completedAt = row.completed_at;
      }

      if (row.duration_ms !== null) {
        record.durationMs = row.duration_ms;
      }

      if (row.response !== null) {
        try {
          record.response = JSON.parse(row.response);
        } catch {
          record.response = row.response;
        }
      }

      if (row.error !== null) {
        record.error = row.error;
      }

      return record;
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
