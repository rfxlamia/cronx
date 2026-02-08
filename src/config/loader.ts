/**
 * CRONX Configuration Loader
 *
 * Functions for loading and parsing CRONX configuration files.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as yaml from 'yaml'
import { CronxConfigSchema, type CronxConfigOutput } from './schema.js'
import type { Job, WindowConfig, IntervalConfig, ProbabilisticConfig } from '../types.js'

// =============================================================================
// Error Classes
// =============================================================================

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class EnvVarError extends ConfigError {
  constructor(varName: string) {
    super(`Environment variable '${varName}' is not defined and has no default value`)
    this.name = 'EnvVarError'
  }
}

// =============================================================================
// Environment Variable Expansion
// =============================================================================

/**
 * Expand environment variables in a string.
 *
 * Supports:
 * - ${VAR} - throws if VAR is not defined
 * - ${VAR:-default} - uses default if VAR is not defined
 *
 * @param input - String with potential env vars
 * @returns String with env vars expanded
 * @throws EnvVarError if required env var is not defined
 */
export function expandEnvVars(input: string): string {
  // Pattern: ${VAR} or ${VAR:-default}
  const envVarPattern = /\$\{([^}:]+)(?::-([^}]*))?\}/g

  return input.replace(envVarPattern, (match, varName: string, defaultValue?: string) => {
    const value = process.env[varName]

    if (value !== undefined) {
      return value
    }

    if (defaultValue !== undefined) {
      return defaultValue
    }

    throw new EnvVarError(varName)
  })
}

// =============================================================================
// Config Loading Functions
// =============================================================================

/**
 * Load and validate config from a YAML string.
 *
 * @param yamlStr - YAML configuration string
 * @returns Validated configuration object
 * @throws ConfigError on invalid YAML
 * @throws ZodError on validation failure
 */
export function loadConfigFromString(yamlStr: string): CronxConfigOutput {
  try {
    const parsed = yaml.parse(yamlStr)
    return CronxConfigSchema.parse(parsed)
  } catch (error) {
    if (error instanceof yaml.YAMLParseError) {
      throw new ConfigError(`Invalid YAML: ${error.message}`)
    }
    throw error
  }
}

/**
 * Load and validate config from a file path.
 *
 * Environment variables in the config will be expanded.
 *
 * @param filePath - Path to the YAML configuration file
 * @returns Validated configuration object
 * @throws ConfigError if file doesn't exist or is invalid
 * @throws EnvVarError if required env vars are not defined
 */
export function loadConfigFromFile(filePath: string): CronxConfigOutput {
  if (!fs.existsSync(filePath)) {
    throw new ConfigError(`Configuration file not found: ${filePath}`)
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const expandedContent = expandEnvVars(content)

  return loadConfigFromString(expandedContent)
}

// =============================================================================
// Config to Jobs Conversion
// =============================================================================

export interface ConfigToJobsOptions {
  /** If true, only return enabled jobs */
  enabledOnly?: boolean
}

/**
 * Convert a CRONX configuration to an array of Job objects.
 *
 * @param config - Validated CRONX configuration
 * @param options - Conversion options
 * @returns Array of Job objects
 */
export function configToJobs(config: CronxConfigOutput, options: ConfigToJobsOptions = {}): Job[] {
  const { enabledOnly = false } = options
  const jobs: Job[] = []

  for (const [name, jobConfig] of Object.entries(config.jobs)) {
    // Skip disabled jobs if enabledOnly is true
    if (enabledOnly && !jobConfig.enabled) {
      continue
    }

    // Get strategy-specific config
    let strategyConfig: WindowConfig | IntervalConfig | ProbabilisticConfig

    switch (jobConfig.strategy) {
      case 'window':
        if (!jobConfig.window) {
          throw new ConfigError(`Job '${name}' has strategy 'window' but no window config`)
        }
        strategyConfig = {
          start: jobConfig.window.start,
          end: jobConfig.window.end,
          timezone: jobConfig.window.timezone,
          distribution: jobConfig.window.distribution,
        }
        break

      case 'interval':
        if (!jobConfig.interval) {
          throw new ConfigError(`Job '${name}' has strategy 'interval' but no interval config`)
        }
        strategyConfig = {
          min: jobConfig.interval.min,
          max: jobConfig.interval.max,
          jitter: jobConfig.interval.jitter,
        }
        break

      case 'probabilistic':
        if (!jobConfig.probabilistic) {
          throw new ConfigError(`Job '${name}' has strategy 'probabilistic' but no probabilistic config`)
        }
        strategyConfig = {
          checkInterval: jobConfig.probabilistic.checkInterval,
          probability: jobConfig.probabilistic.probability,
        }
        break
    }

    // Build the Job object
    const job: Job = {
      name,
      description: jobConfig.description,
      tags: jobConfig.tags,
      strategy: jobConfig.strategy,
      config: strategyConfig,
      enabled: jobConfig.enabled,
      action: {
        message: jobConfig.action.message,
        priority: jobConfig.action.priority,
      },
      // Use job-specific config or fall back to defaults
      retry: jobConfig.retry ?? config.cronx.defaults.retry,
      circuitBreaker: jobConfig.circuitBreaker ?? config.cronx.defaults.circuitBreaker,
      onFailure: jobConfig.onFailure ?? config.cronx.defaults.onFailure,
    }

    jobs.push(job)
  }

  return jobs
}
