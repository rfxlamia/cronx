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
// Strategy Types
// =============================================================================

/**
 * Scheduling strategy type
 * - window: Execute within a time window
 * - interval: Execute at random intervals
 * - probabilistic: Execute based on probability
 */
export type Strategy = 'window' | 'interval' | 'probabilistic'

/**
 * Distribution type for randomization
 * - uniform: Equal probability across range
 * - gaussian: Normal distribution (bell curve)
 * - weighted: Custom weighted distribution
 */
export type Distribution = 'uniform' | 'gaussian' | 'weighted'

/**
 * Circuit breaker state
 * - closed: Normal operation, requests pass through
 * - open: Circuit tripped, requests fail fast
 * - half_open: Testing if service recovered
 */
export type CircuitState = 'closed' | 'open' | 'half_open'

/**
 * Job run status
 */
export type RunStatus = 'success' | 'failed' | 'timeout'

/**
 * Action to take on job failure
 * - notify: Send notification about failure
 * - silent: Log but don't notify
 * - escalate: Escalate to higher priority
 */
export type FailureAction = 'notify' | 'silent' | 'escalate'

// =============================================================================
// Strategy Configs
// =============================================================================

/**
 * Configuration for window-based scheduling
 * Executes job at random time within a time window
 */
export interface WindowConfig {
  /** Start time in HH:MM format */
  start: string
  /** End time in HH:MM format */
  end: string
  /** IANA timezone identifier */
  timezone: string
  /** Distribution for random selection within window */
  distribution: Distribution
}

/**
 * Configuration for interval-based scheduling
 * Executes job at random intervals between min and max
 */
export interface IntervalConfig {
  /** Minimum interval in seconds */
  min: number
  /** Maximum interval in seconds */
  max: number
  /** Jitter factor (0-1) for additional randomness */
  jitter: number
}

/**
 * Configuration for probabilistic scheduling
 * Checks at regular intervals with probability to execute
 */
export interface ProbabilisticConfig {
  /** Interval between probability checks in seconds */
  checkInterval: number
  /** Probability of execution (0-1) */
  probability: number
}

/**
 * Union type for all strategy configurations
 */
export type StrategyConfig = WindowConfig | IntervalConfig | ProbabilisticConfig

// =============================================================================
// Retry & Circuit Breaker
// =============================================================================

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number
  /** Backoff strategy between retries */
  backoff: 'fixed' | 'linear' | 'exponential'
  /** Timeout for each attempt in seconds */
  timeout: number
}

/**
 * Configuration for circuit breaker pattern
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  threshold: number
  /** Time window for counting failures in seconds */
  window: number
  /** Time to wait before attempting recovery in seconds */
  recoveryTime: number
}

// =============================================================================
// Job Definition
// =============================================================================

/**
 * Complete job definition
 */
export interface Job {
  /** Unique job name */
  name: string
  /** Human-readable description */
  description?: string
  /** Tags for categorization */
  tags?: string[]
  /** Scheduling strategy */
  strategy: Strategy
  /** Strategy-specific configuration */
  config: StrategyConfig
  /** Whether job is enabled */
  enabled: boolean
  /** Action to execute */
  action: {
    /** Message to send */
    message: string
    /** Message priority */
    priority?: 'low' | 'normal' | 'high'
  }
  /** Retry configuration (optional, uses defaults if not set) */
  retry?: RetryConfig
  /** Circuit breaker configuration (optional, uses defaults if not set) */
  circuitBreaker?: CircuitBreakerConfig
  /** Action on failure (optional, uses defaults if not set) */
  onFailure?: FailureAction
}

// =============================================================================
// Job State (Runtime)
// =============================================================================

/**
 * Runtime state of a job
 */
export interface JobState {
  /** Job name */
  name: string
  /** Next scheduled run timestamp (null if not scheduled) */
  nextRun: number | null
  /** Last run timestamp (null if never run) */
  lastRun: number | null
  /** Whether job is currently enabled */
  enabled: boolean
  /** Consecutive failure count */
  failCount: number
}

// =============================================================================
// Run Record
// =============================================================================

/**
 * Record of a job execution
 */
export interface RunRecord {
  /** Unique record ID (set by database) */
  id?: number
  /** Name of the job that ran */
  jobName: string
  /** When the run was scheduled */
  scheduledAt: number
  /** When the run actually started */
  triggeredAt: number
  /** When the run completed (if completed) */
  completedAt?: number
  /** Total duration in milliseconds */
  durationMs?: number
  /** Run status */
  status: RunStatus
  /** Response from gateway (if successful) */
  response?: unknown
  /** Error message (if failed) */
  error?: string
  /** Number of attempts made */
  attempts: number
}

// =============================================================================
// Gateway Types
// =============================================================================

/**
 * Request to send to the gateway
 */
export interface GatewayRequest {
  /** Session key for authentication */
  sessionKey: string
  /** Message to send */
  message: string
  /** Additional context */
  context?: Record<string, unknown>
}

/**
 * Response from the gateway
 */
export interface GatewayResponse {
  /** Whether the request succeeded */
  success: boolean
  /** Response message (if successful) */
  message?: string
  /** Error message (if failed) */
  error?: string
}

// =============================================================================
// Config Types
// =============================================================================

/**
 * Complete CRONX configuration
 */
export interface CronxConfig {
  /** Configuration version */
  version: number
  /** Default timezone for jobs */
  timezone: string
  /** Gateway configuration */
  gateway: {
    /** Gateway URL */
    url: string
    /** Session key for authentication */
    sessionKey: string
    /** Request timeout in milliseconds */
    timeout: number
  }
  /** Default configurations */
  defaults: {
    /** Default retry configuration */
    retry: RetryConfig
    /** Default circuit breaker configuration */
    circuitBreaker: CircuitBreakerConfig
    /** Default failure action */
    onFailure: FailureAction
  }
  /** Job definitions (keyed by job name) */
  jobs: Record<string, Omit<Job, 'name'>>
}

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
