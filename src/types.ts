/**
 * CRONX Common Types
 *
 * Shared type definitions used across the library.
 *
 * @packageDocumentation
 */

// =============================================================================
// Time Types
// =============================================================================

/**
 * Duration in milliseconds
 */
export type Duration = number

/**
 * Unix timestamp in milliseconds since epoch
 */
export type Timestamp = number

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted by jobs during execution
 */
export interface JobEvent {
  /** Type of the event */
  type: 'scheduled' | 'started' | 'completed' | 'failed' | 'retrying' | 'cancelled'
  /** Job identifier */
  jobId: string
  /** When the event occurred */
  timestamp: Timestamp
  /** Additional event data */
  data?: unknown
  /** Error information (for failed events) */
  error?: Error
}

/**
 * Events emitted by the scheduler
 */
export interface SchedulerEvent {
  /** Type of the event */
  type: 'started' | 'stopped' | 'paused' | 'resumed' | 'job-added' | 'job-removed'
  /** When the event occurred */
  timestamp: Timestamp
  /** Additional event data */
  data?: unknown
}

// =============================================================================
// Callback Types
// =============================================================================

/**
 * Handler function for job execution
 *
 * @param context - Execution context with job metadata
 * @returns Promise that resolves when job completes
 */
export type JobHandler<T = unknown> = (context: JobContext) => Promise<T>

/**
 * Context passed to job handlers
 */
export interface JobContext {
  /** Job identifier */
  jobId: string
  /** Current attempt number (1-indexed) */
  attempt: number
  /** Scheduled execution time */
  scheduledAt: Timestamp
  /** Actual execution start time */
  startedAt: Timestamp
  /** Abort signal for cancellation */
  signal: AbortSignal
}

/**
 * Handler for errors during job execution
 *
 * @param error - The error that occurred
 * @param context - Job context at time of error
 */
export type ErrorHandler = (error: Error, context: JobContext) => void | Promise<void>

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Make specific properties optional
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Make specific properties required
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
