/**
 * Config Loader Tests
 *
 * TDD: RED phase - these tests should FAIL initially
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { loadConfigFromString, loadConfigFromFile, configToJobs } from '../../../src/config/loader'
import type { Job } from '../../../src/types'
import * as fs from 'node:fs'

// Mock fs module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}))

describe('Config Loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadConfigFromString', () => {
    it('should parse valid YAML config', () => {
      const yamlConfig = `
cronx:
  version: 1
  timezone: UTC
  gateway:
    url: https://gateway.example.com
    sessionKey: test-session-key
    timeout: 30
  defaults:
    retry:
      maxAttempts: 3
      backoff: exponential
      timeout: 30
    circuitBreaker:
      threshold: 5
      window: 3600
      recoveryTime: 600
    onFailure: notify

jobs:
  morning-check:
    description: Morning check job
    strategy: window
    window:
      start: "09:00"
      end: "10:00"
      timezone: UTC
      distribution: uniform
    action:
      message: "Good morning! Time for daily check."
      priority: normal
    enabled: true
`

      const config = loadConfigFromString(yamlConfig)

      expect(config).toBeDefined()
      expect(config.cronx.version).toBe(1)
      expect(config.cronx.timezone).toBe('UTC')
      expect(config.cronx.gateway.url).toBe('https://gateway.example.com')
      expect(config.cronx.gateway.sessionKey).toBe('test-session-key')
      expect(config.cronx.gateway.timeout).toBe(30)
      expect(config.cronx.defaults.retry.maxAttempts).toBe(3)
      expect(config.cronx.defaults.retry.backoff).toBe('exponential')
      expect(config.jobs['morning-check']).toBeDefined()
      expect(config.jobs['morning-check'].strategy).toBe('window')
      expect(config.jobs['morning-check'].window?.start).toBe('09:00')
    })

    it('should apply default values for optional fields', () => {
      const yamlConfig = `
cronx:
  gateway:
    url: https://gateway.example.com
    sessionKey: test-key

jobs:
  simple-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Simple job message"
`

      const config = loadConfigFromString(yamlConfig)

      // Check defaults are applied
      expect(config.cronx.version).toBe(1)
      expect(config.cronx.timezone).toBe('UTC')
      expect(config.cronx.gateway.timeout).toBe(30)
      expect(config.cronx.defaults.retry.maxAttempts).toBe(3)
      expect(config.cronx.defaults.retry.backoff).toBe('exponential')
      expect(config.cronx.defaults.circuitBreaker.threshold).toBe(5)
      expect(config.cronx.defaults.onFailure).toBe('notify')
      expect(config.jobs['simple-job'].enabled).toBe(true)
      expect(config.jobs['simple-job'].interval?.jitter).toBe(0.2)
    })

    it('should throw error for invalid YAML', () => {
      const invalidYaml = `
cronx:
  gateway:
    url: "unclosed string
`

      expect(() => loadConfigFromString(invalidYaml)).toThrow()
    })

    it('should throw error when required fields are missing', () => {
      const missingGateway = `
cronx:
  version: 1
jobs:
  test:
    strategy: window
    action:
      message: test
`

      expect(() => loadConfigFromString(missingGateway)).toThrow()
    })

    it('should throw error for invalid strategy type', () => {
      const invalidStrategy = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  bad-job:
    strategy: invalid-strategy
    action:
      message: test
`

      expect(() => loadConfigFromString(invalidStrategy)).toThrow()
    })

    it('should validate window time format', () => {
      const invalidWindowTime = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  window-job:
    strategy: window
    window:
      start: "9:00"
      end: "10:00"
    action:
      message: test
`

      expect(() => loadConfigFromString(invalidWindowTime)).toThrow()
    })

    it('should validate probability range 0-1', () => {
      const invalidProbability = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  prob-job:
    strategy: probabilistic
    probabilistic:
      checkInterval: 60
      probability: 1.5
    action:
      message: test
`

      expect(() => loadConfigFromString(invalidProbability)).toThrow()
    })

    it('should parse timeout as number or string with s suffix', () => {
      const configWithStrTimeout = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key
    timeout: "60s"

jobs:
  test:
    strategy: interval
    interval:
      min: 10
      max: 20
    action:
      message: test
`

      const config = loadConfigFromString(configWithStrTimeout)
      expect(config.cronx.gateway.timeout).toBe(60)
    })

    it('should parse interval strategy config', () => {
      const intervalConfig = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  interval-job:
    strategy: interval
    interval:
      min: 300
      max: 600
      jitter: 0.1
    action:
      message: "Interval job"
`

      const config = loadConfigFromString(intervalConfig)
      expect(config.jobs['interval-job'].interval?.min).toBe(300)
      expect(config.jobs['interval-job'].interval?.max).toBe(600)
      expect(config.jobs['interval-job'].interval?.jitter).toBe(0.1)
    })

    it('should parse probabilistic strategy config', () => {
      const probConfig = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  prob-job:
    strategy: probabilistic
    probabilistic:
      checkInterval: 3600
      probability: 0.3
    action:
      message: "Maybe run this"
`

      const config = loadConfigFromString(probConfig)
      expect(config.jobs['prob-job'].probabilistic?.checkInterval).toBe(3600)
      expect(config.jobs['prob-job'].probabilistic?.probability).toBe(0.3)
    })
  })

  describe('loadConfigFromFile', () => {
    it('should load config from file path', () => {
      const yamlContent = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: my-secret-key

jobs:
  file-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Job from file"
`

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(yamlContent)

      const config = loadConfigFromFile('/path/to/config.yaml')

      expect(fs.readFileSync).toHaveBeenCalledWith('/path/to/config.yaml', 'utf-8')
      expect(config.jobs['file-job']).toBeDefined()
    })

    it('should throw error when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(() => loadConfigFromFile('/nonexistent/config.yaml')).toThrow()
    })

    it('should expand environment variables in config', () => {
      const yamlWithEnvVars = `
cronx:
  gateway:
    url: \${GATEWAY_URL}
    sessionKey: \${SESSION_KEY}

jobs:
  env-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Job with env vars"
`

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(yamlWithEnvVars)

      // Set environment variables
      const originalEnv = process.env
      process.env = {
        ...originalEnv,
        GATEWAY_URL: 'https://from-env.example.com',
        SESSION_KEY: 'secret-from-env',
      }

      try {
        const config = loadConfigFromFile('/path/to/config.yaml')

        expect(config.cronx.gateway.url).toBe('https://from-env.example.com')
        expect(config.cronx.gateway.sessionKey).toBe('secret-from-env')
      } finally {
        process.env = originalEnv
      }
    })

    it('should expand env vars with default values', () => {
      const yamlWithDefaults = `
cronx:
  gateway:
    url: \${GATEWAY_URL:-https://default.example.com}
    sessionKey: \${SESSION_KEY:-default-key}

jobs:
  default-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Job with defaults"
`

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(yamlWithDefaults)

      // Clear env vars to test defaults
      const originalEnv = process.env
      process.env = { ...originalEnv }
      delete process.env.GATEWAY_URL
      delete process.env.SESSION_KEY

      try {
        const config = loadConfigFromFile('/path/to/config.yaml')

        expect(config.cronx.gateway.url).toBe('https://default.example.com')
        expect(config.cronx.gateway.sessionKey).toBe('default-key')
      } finally {
        process.env = originalEnv
      }
    })

    it('should throw error for undefined env vars without defaults', () => {
      const yamlWithUndefinedEnv = `
cronx:
  gateway:
    url: \${UNDEFINED_VAR}
    sessionKey: key

jobs:
  test:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "test"
`

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(yamlWithUndefinedEnv)

      // Ensure the env var is not set
      const originalEnv = process.env
      process.env = { ...originalEnv }
      delete process.env.UNDEFINED_VAR

      try {
        expect(() => loadConfigFromFile('/path/to/config.yaml')).toThrow()
      } finally {
        process.env = originalEnv
      }
    })
  })

  describe('configToJobs', () => {
    it('should convert config to Job array', () => {
      const yamlConfig = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key
  defaults:
    retry:
      maxAttempts: 5
      backoff: linear
      timeout: 60
    circuitBreaker:
      threshold: 3
      window: 1800
      recoveryTime: 300
    onFailure: escalate

jobs:
  job-1:
    description: First job
    tags:
      - tag1
      - tag2
    strategy: window
    window:
      start: "09:00"
      end: "10:00"
      timezone: America/New_York
      distribution: gaussian
    action:
      message: "Job 1 message"
      priority: high
    enabled: true

  job-2:
    strategy: interval
    interval:
      min: 100
      max: 200
    action:
      message: "Job 2 message"
    retry:
      maxAttempts: 10
      backoff: fixed
      timeout: 120
`

      const config = loadConfigFromString(yamlConfig)
      const jobs = configToJobs(config)

      expect(jobs).toHaveLength(2)

      // Check job-1
      const job1 = jobs.find(j => j.name === 'job-1')
      expect(job1).toBeDefined()
      expect(job1?.description).toBe('First job')
      expect(job1?.tags).toEqual(['tag1', 'tag2'])
      expect(job1?.strategy).toBe('window')
      expect(job1?.config).toEqual({
        start: '09:00',
        end: '10:00',
        timezone: 'America/New_York',
        distribution: 'gaussian',
      })
      expect(job1?.action.message).toBe('Job 1 message')
      expect(job1?.action.priority).toBe('high')
      expect(job1?.enabled).toBe(true)
      // Should use defaults
      expect(job1?.retry).toEqual({
        maxAttempts: 5,
        backoff: 'linear',
        timeout: 60,
      })
      expect(job1?.circuitBreaker).toEqual({
        threshold: 3,
        window: 1800,
        recoveryTime: 300,
      })
      expect(job1?.onFailure).toBe('escalate')

      // Check job-2
      const job2 = jobs.find(j => j.name === 'job-2')
      expect(job2).toBeDefined()
      expect(job2?.strategy).toBe('interval')
      expect(job2?.config).toEqual({
        min: 100,
        max: 200,
        jitter: 0.2, // default
      })
      // Should use job-specific retry
      expect(job2?.retry).toEqual({
        maxAttempts: 10,
        backoff: 'fixed',
        timeout: 120,
      })
    })

    it('should filter out disabled jobs when requested', () => {
      const yamlConfig = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  enabled-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Enabled"
    enabled: true

  disabled-job:
    strategy: interval
    interval:
      min: 60
      max: 120
    action:
      message: "Disabled"
    enabled: false
`

      const config = loadConfigFromString(yamlConfig)
      const allJobs = configToJobs(config)
      const enabledJobs = configToJobs(config, { enabledOnly: true })

      expect(allJobs).toHaveLength(2)
      expect(enabledJobs).toHaveLength(1)
      expect(enabledJobs[0].name).toBe('enabled-job')
    })

    it('should correctly map probabilistic strategy config', () => {
      const yamlConfig = `
cronx:
  gateway:
    url: https://example.com
    sessionKey: key

jobs:
  prob-job:
    strategy: probabilistic
    probabilistic:
      checkInterval: 1800
      probability: 0.5
    action:
      message: "Maybe run"
`

      const config = loadConfigFromString(yamlConfig)
      const jobs = configToJobs(config)

      expect(jobs[0].strategy).toBe('probabilistic')
      expect(jobs[0].config).toEqual({
        checkInterval: 1800,
        probability: 0.5,
      })
    })
  })
})
