/**
 * CRONX Configuration Schema
 *
 * Zod schemas for validating CRONX configuration files.
 *
 * @packageDocumentation
 */

import { z } from 'zod'

// =============================================================================
// Retry & Circuit Breaker Schemas
// =============================================================================

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().min(1).default(3),
  backoff: z.enum(['fixed', 'linear', 'exponential']).default('exponential'),
  timeout: z.number().min(1).default(30),
})

export const CircuitBreakerConfigSchema = z.object({
  threshold: z.number().min(1).default(5),
  window: z.number().min(1).default(3600),
  recoveryTime: z.number().min(1).default(600),
})

// =============================================================================
// Strategy Config Schemas
// =============================================================================

export const WindowConfigSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  end: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format'),
  timezone: z.string().default('UTC'),
  distribution: z.enum(['uniform', 'gaussian', 'weighted']).default('uniform'),
})

export const IntervalConfigSchema = z.object({
  min: z.number().min(1),
  max: z.number().min(1),
  jitter: z.number().min(0).max(1).default(0.2),
})

export const ProbabilisticConfigSchema = z.object({
  checkInterval: z.number().min(1),
  probability: z.number().min(0).max(1),
})

// =============================================================================
// Action Schema
// =============================================================================

export const ActionSchema = z.object({
  message: z.string(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
})

// =============================================================================
// Job Schema
// =============================================================================

export const JobSchema = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  strategy: z.enum(['window', 'interval', 'probabilistic']),
  window: WindowConfigSchema.optional(),
  interval: IntervalConfigSchema.optional(),
  probabilistic: ProbabilisticConfigSchema.optional(),
  action: ActionSchema,
  enabled: z.boolean().default(true),
  retry: RetryConfigSchema.optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
  onFailure: z.enum(['notify', 'silent', 'escalate']).optional(),
})

// =============================================================================
// Root Config Schema
// =============================================================================

export const CronxConfigSchema = z.object({
  cronx: z.object({
    version: z.number().default(1),
    timezone: z.string().default('UTC'),
    gateway: z.object({
      url: z.string().url(),
      sessionKey: z.string(),
      timeout: z
        .string()
        .or(z.number())
        .transform((v) => {
          if (typeof v === 'number') return v
          const match = v.match(/^(\d+)s?$/)
          return match ? parseInt(match[1]) : 30
        })
        .default(30),
    }),
    defaults: z
      .object({
        retry: RetryConfigSchema.default({}),
        circuitBreaker: CircuitBreakerConfigSchema.default({}),
        onFailure: z.enum(['notify', 'silent', 'escalate']).default('notify'),
      })
      .default({}),
  }),
  jobs: z.record(z.string(), JobSchema),
})

// =============================================================================
// Type Exports
// =============================================================================

export type RetryConfigInput = z.input<typeof RetryConfigSchema>
export type RetryConfigOutput = z.output<typeof RetryConfigSchema>

export type CircuitBreakerConfigInput = z.input<typeof CircuitBreakerConfigSchema>
export type CircuitBreakerConfigOutput = z.output<typeof CircuitBreakerConfigSchema>

export type WindowConfigInput = z.input<typeof WindowConfigSchema>
export type WindowConfigOutput = z.output<typeof WindowConfigSchema>

export type IntervalConfigInput = z.input<typeof IntervalConfigSchema>
export type IntervalConfigOutput = z.output<typeof IntervalConfigSchema>

export type ProbabilisticConfigInput = z.input<typeof ProbabilisticConfigSchema>
export type ProbabilisticConfigOutput = z.output<typeof ProbabilisticConfigSchema>

export type ActionInput = z.input<typeof ActionSchema>
export type ActionOutput = z.output<typeof ActionSchema>

export type JobInput = z.input<typeof JobSchema>
export type JobOutput = z.output<typeof JobSchema>

export type CronxConfigInput = z.input<typeof CronxConfigSchema>
export type CronxConfigOutput = z.output<typeof CronxConfigSchema>
