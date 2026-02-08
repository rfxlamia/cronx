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
export type { SchedulerOptions, SchedulerState } from './core/scheduler.js'

// Job
export { Job } from './core/job.js'
export type { JobConfig, JobState, JobResult } from './core/job.js'

// Window
export { TimeWindow } from './core/window.js'
export type { TimeWindowConfig, WindowBoundary } from './core/window.js'

// =============================================================================
// Strategy Exports
// =============================================================================

export {
  UniformRandomStrategy,
  GaussianRandomStrategy,
  PoissonRandomStrategy,
  WeightedRandomStrategy,
  type RandomStrategy,
  type StrategyConfig,
} from './strategies/index.js'

// =============================================================================
// Gateway Exports
// =============================================================================

export { Gateway } from './gateway/gateway.js'
export type { GatewayConfig, GatewayHandler } from './gateway/gateway.js'

// =============================================================================
// Storage Exports
// =============================================================================

export { Storage } from './storage/storage.js'
export type { StorageAdapter, StorageOptions } from './storage/storage.js'

// =============================================================================
// Config Exports
// =============================================================================

export { loadConfig, parseConfig, validateConfig } from './config/loader.js'
export type { CronxConfig, JobDefinition } from './config/schema.js'

// =============================================================================
// Utility Exports
// =============================================================================

export { createLogger } from './utils/logger.js'
export type { Logger, LogLevel } from './utils/logger.js'

// =============================================================================
// Type-only Exports
// =============================================================================

export type {
  // Events
  JobEvent,
  SchedulerEvent,

  // Callbacks
  JobHandler,
  ErrorHandler,

  // Common types
  Duration,
  Timestamp,
} from './types.js'
