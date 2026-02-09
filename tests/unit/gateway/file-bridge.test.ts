import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileBridge } from '../../../src/gateway/file-bridge.js'
import { FileBridgeError, FileBridgeErrorCode } from '../../../src/types.js'

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  promises: {
    writeFile: vi.fn(),
    unlink: vi.fn(),
    rename: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

import * as fs from 'node:fs'
import { execFile } from 'node:child_process'

describe('FileBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined)
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined)
    vi.mocked(execFile).mockImplementation((_, __, ___, callback) => {
      callback?.(null, 'ok', '')
      return {} as never
    })
  })

  it('menulis file trigger secara atomic (tmp + rename)', async () => {
    const bridge = new FileBridge({ triggerDir: '/tmp/cronx-test' })

    const filePath = await bridge.trigger({
      jobName: 'job.test',
      message: 'hello',
      timestamp: Date.now(),
    })

    expect(filePath).toContain('cronx-job-test-')
    expect(filePath).toContain('.json')
    expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      expect.any(String),
      'utf-8'
    )
    expect(vi.mocked(fs.promises.rename)).toHaveBeenCalledOnce()
  })

  it('map error permission denied saat trigger()', async () => {
    vi.mocked(fs.promises.writeFile).mockRejectedValueOnce({ code: 'EACCES', message: 'denied' })
    const bridge = new FileBridge({ triggerDir: '/tmp/cronx-test' })

    await expect(() =>
      bridge.trigger({
        jobName: 'job',
        message: 'hello',
        timestamp: Date.now(),
      })
    ).rejects.toMatchObject({
      code: FileBridgeErrorCode.PERMISSION_DENIED,
    })
  })

  it('map timeout CLI ke CLI_TIMEOUT', async () => {
    vi.mocked(execFile).mockImplementation((_, __, ___, callback) => {
      callback?.({ message: 'timeout', killed: true } as Error, '', '')
      return {} as never
    })
    const bridge = new FileBridge()

    await expect(() =>
      bridge.executeCLI({
        jobName: 'job',
        message: 'hello',
        timestamp: Date.now(),
      })
    ).rejects.toEqual(expect.any(FileBridgeError))

    await expect(() =>
      bridge.executeCLI({
        jobName: 'job',
        message: 'hello',
        timestamp: Date.now(),
      })
    ).rejects.toMatchObject({
      code: FileBridgeErrorCode.CLI_TIMEOUT,
    })
  })

  it('healthCheck melaporkan cliAvailable=false jika exec --version gagal', async () => {
    vi.mocked(execFile).mockImplementation((_, __, ___, callback) => {
      callback?.(new Error('not found'), '', '')
      return {} as never
    })
    const bridge = new FileBridge()

    const result = await bridge.healthCheck()
    expect(result.writable).toBe(true)
    expect(result.cliAvailable).toBe(false)
  })
})
