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
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new FileBridgeError(
          `Trigger directory not writable: ${this.config.triggerDir}. Check permissions.`,
          FileBridgeErrorCode.PERMISSION_DENIED,
          err
        )
      }
      if (err.code === 'ENOSPC') {
        throw new FileBridgeError(
          `Disk full: Cannot write to ${this.config.triggerDir}`,
          FileBridgeErrorCode.DISK_FULL,
          err
        )
      }
      throw new FileBridgeError(
        `Failed to validate trigger directory: ${err.message}`,
        FileBridgeErrorCode.DIR_NOT_WRITABLE,
        err
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
      if (error instanceof FileBridgeError) {
        throw error
      }

      await fs.promises.unlink(tempPath).catch(() => undefined)

      const err = error as NodeJS.ErrnoException
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        throw new FileBridgeError(
          `Permission denied writing trigger file: ${filepath}`,
          FileBridgeErrorCode.PERMISSION_DENIED,
          err
        )
      }
      if (err.code === 'ENOSPC') {
        throw new FileBridgeError(
          'Disk full: Cannot write trigger file',
          FileBridgeErrorCode.DISK_FULL,
          err
        )
      }
      if (err.code === 'EMFILE' || err.code === 'ENFILE') {
        throw new FileBridgeError(
          'Too many open files: System resource limit reached',
          FileBridgeErrorCode.TOO_MANY_FILES,
          err
        )
      }

      throw new FileBridgeError(
        `Failed to write trigger file: ${err.message || 'unknown error'}`,
        FileBridgeErrorCode.DIR_NOT_WRITABLE,
        err
      )
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
    let writable = false
    let cliAvailable = false

    try {
      await this.validateDirectory()
      writable = true
    } catch {
      writable = false
    }

    try {
      await execFileAsync(this.config.openclawPath, ['--version'], { timeout: 5000 })
      cliAvailable = true
    } catch {
      cliAvailable = false
    }

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
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new FileBridgeError('Write timeout', FileBridgeErrorCode.WRITE_TIMEOUT))
      }, timeoutMs)

      fs.promises
        .writeFile(filepath, content, 'utf-8')
        .then(() => {
          clearTimeout(timeoutId)
          resolve()
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }
}
