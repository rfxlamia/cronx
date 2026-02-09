/**
 * CRONX - Random Job Scheduler for AI Agents
 *
 * Makes autonomous agents feel natural, not robotic.
 *
 * @packageDocumentation
 */

// =============================================================================
// Core Exports
// =============================================================================

// Scheduler
export { Scheduler } from './core/scheduler.js'
export type { SchedulerConfig, JobStatus } from './core/scheduler.js'

// Job Runner
export { JobRunner } from './core/job-runner.js'
export type { RunResult } from './core/job-runner.js'

// =============================================================================
// Strategy Exports
// =============================================================================

export {
  WindowStrategy,
  IntervalStrategy,
  ProbabilisticStrategy,
  createStrategy,
  type StrategyWrapper,
} from './strategies/index.js'

// =============================================================================
// Gateway Exports
// =============================================================================

export { GatewayClient, GatewayError, GatewayTimeoutError } from './gateway/client.js'
export type { GatewayClientConfig, TriggerRequest } from './gateway/client.js'
export { FileBridge } from './gateway/file-bridge.js'

// =============================================================================
// Storage Exports
// =============================================================================

export { SQLiteStore } from './storage/sqlite.js'

// =============================================================================
// Config Exports
// =============================================================================

export { loadConfigFromFile, loadConfigFromString, configToJobs, ConfigError, EnvVarError } from './config/loader.js'
export { CronxConfigSchema } from './config/schema.js'
export type { CronxConfigOutput, CronxConfigInput } from './config/schema.js'

// =============================================================================
// Type-only Exports
// =============================================================================

export type {
  // Core types
  Job,
  JobState,
  RunRecord,
  RunStatus,
  Strategy,
  Distribution,
  FailureAction,

  // Strategy configs
  WindowConfig,
  IntervalConfig,
  ProbabilisticConfig,
  StrategyConfig,

  // Retry & Circuit Breaker
  RetryConfig,
  CircuitBreakerConfig,
  CircuitState,

  // Gateway types
  GatewayRequest,
  GatewayResponse,
  FileBridgeConfig,
  TriggerPayload,
  FileBridgeErrorCode,

  // Config types
  CronxConfig,

  // Events
  JobEvent,
  SchedulerEvent,

  // Callbacks
  JobHandler,
  JobContext,
  ErrorHandler,

  // Common types
  Duration,
  Timestamp,
} from './types.js'
