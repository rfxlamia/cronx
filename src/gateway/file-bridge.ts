/**
 * CRONX File Bridge
 *
 * Writes trigger files and executes OpenClaw CLI.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import type { TriggerPayload, FileBridgeConfig } from '../types.js'
import { FileBridgeError, FileBridgeErrorCode } from '../types.js'

const execFileAsync = promisify(execFile)

/** Map errno codes to FileBridgeErrorCode */
const ERROR_CODE_MAP: Record<string, FileBridgeErrorCode> = {
  EACCES: FileBridgeErrorCode.PERMISSION_DENIED,
  EPERM: FileBridgeErrorCode.PERMISSION_DENIED,
  ENOSPC: FileBridgeErrorCode.DISK_FULL,
  EMFILE: FileBridgeErrorCode.TOO_MANY_FILES,
  ENFILE: FileBridgeErrorCode.TOO_MANY_FILES,
}

/**
 * Convert errno to FileBridgeError
 */
function toFileBridgeError(
  err: NodeJS.ErrnoException,
  context: string,
  defaultCode = FileBridgeErrorCode.DIR_NOT_WRITABLE
): FileBridgeError {
  const code = err.code ? ERROR_CODE_MAP[err.code] ?? defaultCode : defaultCode
  const messages: Record<FileBridgeErrorCode, string> = {
    [FileBridgeErrorCode.PERMISSION_DENIED]: `Permission denied: ${context}`,
    [FileBridgeErrorCode.DISK_FULL]: `Disk full: ${context}`,
    [FileBridgeErrorCode.TOO_MANY_FILES]: 'Too many open files: System resource limit reached',
    [FileBridgeErrorCode.DIR_NOT_WRITABLE]: `Failed: ${context} - ${err.message || 'unknown error'}`,
    [FileBridgeErrorCode.CLI_TIMEOUT]: `CLI timeout: ${context}`,
    [FileBridgeErrorCode.CLI_FAILED]: `CLI failed: ${context}`,
    [FileBridgeErrorCode.WRITE_TIMEOUT]: `Write timeout: ${context}`,
  }
  return new FileBridgeError(messages[code], code, err)
}

/**
 * File-based bridge for triggering OpenClaw via CLI.
 */
export class FileBridge {
  private readonly config: FileBridgeConfig

  constructor(config: Partial<FileBridgeConfig> = {}) {
    this.config = {
      triggerDir: config.triggerDir ?? '/root/.cronx/triggers',
      extension: config.extension ?? '.json',
      openclawPath: config.openclawPath ?? 'openclaw',
      defaultRecipient: config.defaultRecipient ?? '+6289648535538',
      cliTimeoutMs: config.cliTimeoutMs ?? 60000,
      writeTimeoutMs: config.writeTimeoutMs ?? 10000,
    }
  }

  /**
   * Validate trigger directory is writable.
   */
  async validateDirectory(): Promise<void> {
    try {
      if (!fs.existsSync(this.config.triggerDir)) {
        fs.mkdirSync(this.config.triggerDir, { recursive: true })
      }

      const testFile = path.join(this.config.triggerDir, `.writetest-${Date.now()}`)
      await fs.promises.writeFile(testFile, 'test', 'utf-8')
      await fs.promises.unlink(testFile)
    } catch (error) {
      throw toFileBridgeError(
        error as NodeJS.ErrnoException,
        `Cannot write to ${this.config.triggerDir}`
      )
    }
  }

  /**
   * Write a trigger file for job execution.
   */
  async trigger(payload: TriggerPayload): Promise<string> {
    const filename = this.generateFilename(payload.jobName)
    const filepath = path.join(this.config.triggerDir, filename)
    const tempPath = `${filepath}.tmp`
    const content = JSON.stringify(payload, null, 2)

    try {
      await this.writeFileWithTimeout(tempPath, content, this.config.writeTimeoutMs)
      await fs.promises.rename(tempPath, filepath)
      return filepath
    } catch (error) {
      if (error instanceof FileBridgeError) throw error

      await fs.promises.unlink(tempPath).catch(() => undefined)
      throw toFileBridgeError(error as NodeJS.ErrnoException, `writing trigger file: ${filepath}`)
    }
  }

  /**
   * Execute OpenClaw CLI command for a trigger.
   */
  async executeCLI(payload: TriggerPayload): Promise<{ success: boolean; output: string }> {
    const args = [
      'agent',
      '--to', payload.recipient ?? this.config.defaultRecipient,
      '--message', payload.message,
      '--thinking', payload.thinking ?? 'medium',
      '--deliver',
    ]

    try {
      const { stdout, stderr } = await execFileAsync(this.config.openclawPath, args, {
        timeout: this.config.cliTimeoutMs,
      })

      return {
        success: true,
        output: stdout || stderr || '',
      }
    } catch (error) {
      const err = error as Error & { killed?: boolean; code?: string; signal?: string }
      if (err.killed || err.signal === 'SIGTERM') {
        throw new FileBridgeError(
          `OpenClaw CLI timeout after ${this.config.cliTimeoutMs}ms`,
          FileBridgeErrorCode.CLI_TIMEOUT,
          err
        )
      }
      throw new FileBridgeError(
        `OpenClaw CLI failed: ${err.message}`,
        FileBridgeErrorCode.CLI_FAILED,
        err
      )
    }
  }

  /**
   * Test bridge readiness.
   */
  async healthCheck(): Promise<{ writable: boolean; cliAvailable: boolean }> {
    const writable = await this.validateDirectory().then(() => true).catch(() => false)
    const cliAvailable = await execFileAsync(this.config.openclawPath, ['--version'], { timeout: 5000 })
      .then(() => true)
      .catch(() => false)

    return { writable, cliAvailable }
  }

  private generateFilename(jobName?: string): string {
    const timestamp = Date.now()
    const random = randomBytes(4).toString('hex')
    const slug = (jobName ?? 'job').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)
    return `cronx-${slug}-${timestamp}-${random}${this.config.extension}`
  }

  private async writeFileWithTimeout(
    filepath: string,
    content: string,
    timeoutMs: number
  ): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      await fs.promises.writeFile(filepath, content, { encoding: 'utf-8', signal: controller.signal })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new FileBridgeError('Write timeout', FileBridgeErrorCode.WRITE_TIMEOUT)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }
  }
}
