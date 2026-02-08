/**
 * Gateway Client Tests
 *
 * TDD: RED phase - these tests should FAIL initially
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { GatewayClient, GatewayError, GatewayTimeoutError } from '../../../src/gateway/client'
import type { GatewayResponse } from '../../../src/types'

describe('GatewayClient', () => {
  let mockFetch: MockInstance<typeof fetch>

  beforeEach(() => {
    // Stub global fetch
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should create client with config', () => {
      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'test-key',
        timeout: 30,
      })

      expect(client).toBeDefined()
    })

    it('should throw error for invalid URL', () => {
      expect(
        () =>
          new GatewayClient({
            url: 'not-a-url',
            sessionKey: 'key',
            timeout: 30,
          })
      ).toThrow()
    })
  })

  describe('trigger', () => {
    it('should send message to gateway and return response', async () => {
      const mockResponse: GatewayResponse = {
        success: true,
        message: 'Task executed successfully',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'test-session-key',
        timeout: 30,
      })

      const result = await client.trigger({
        message: 'Hello, AI Agent!',
        priority: 'normal',
      })

      expect(result.success).toBe(true)
      expect(result.message).toBe('Task executed successfully')

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-session-key',
        },
        body: JSON.stringify({
          message: 'Hello, AI Agent!',
          priority: 'normal',
        }),
        signal: expect.any(AbortSignal),
      })
    })

    it('should include context in request when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      await client.trigger({
        message: 'Check status',
        context: {
          jobId: 'morning-check',
          attempt: 1,
          scheduledAt: 1234567890,
        },
        priority: 'high',
      })

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)

      expect(body.context).toEqual({
        jobId: 'morning-check',
        attempt: 1,
        scheduledAt: 1234567890,
      })
      expect(body.priority).toBe('high')
    })

    it('should use default priority when not specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      await client.trigger({ message: 'Test' })

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)

      expect(body.priority).toBe('normal')
    })

    it('should throw GatewayError on HTTP error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Server error occurred' }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      await expect(client.trigger({ message: 'Test' })).rejects.toThrow(GatewayError)
    })

    it('should throw GatewayTimeoutError on timeout', async () => {
      // Simulate a timeout by never resolving
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            // Create an abort error
            const error = new DOMException('The operation was aborted.', 'AbortError')
            setTimeout(() => reject(error), 10)
          })
      )

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 1, // 1 second timeout
      })

      await expect(client.trigger({ message: 'Test' })).rejects.toThrow(GatewayTimeoutError)
    })

    it('should throw GatewayError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      await expect(client.trigger({ message: 'Test' })).rejects.toThrow(GatewayError)
    })

    it('should return error response when gateway returns success:false', async () => {
      const errorResponse: GatewayResponse = {
        success: false,
        error: 'Agent is busy',
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => errorResponse,
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      const result = await client.trigger({ message: 'Test' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Agent is busy')
    })
  })

  describe('notify', () => {
    it('should send notification with message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      const result = await client.notify('System notification')

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)

      expect(body.message).toBe('System notification')
      expect(body.priority).toBe('normal')
    })

    it('should send notification with specified priority', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      await client.notify('Urgent notification', 'high')

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1]?.body as string)

      expect(body.priority).toBe('high')
    })
  })

  describe('health check', () => {
    it('should check if gateway is reachable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok' }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      const isHealthy = await client.healthCheck()

      expect(isHealthy).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com/health',
        expect.objectContaining({
          method: 'GET',
        })
      )
    })

    it('should return false when gateway is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      const isHealthy = await client.healthCheck()

      expect(isHealthy).toBe(false)
    })

    it('should return false when gateway returns non-ok status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com',
        sessionKey: 'key',
        timeout: 30,
      })

      const isHealthy = await client.healthCheck()

      expect(isHealthy).toBe(false)
    })
  })

  describe('URL handling', () => {
    it('should handle URL with trailing slash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com/',
        sessionKey: 'key',
        timeout: 30,
      })

      await client.trigger({ message: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com',
        expect.any(Object)
      )
    })

    it('should handle URL with path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response)

      const client = new GatewayClient({
        url: 'https://gateway.example.com/api/v1/trigger',
        sessionKey: 'key',
        timeout: 30,
      })

      await client.trigger({ message: 'Test' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://gateway.example.com/api/v1/trigger',
        expect.any(Object)
      )
    })
  })
})
