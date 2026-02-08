/**
 * CRONX Gateway Client
 *
 * Client for communicating with the AI agent gateway (OpenClaw compatible).
 *
 * @packageDocumentation
 */

import type { GatewayResponse } from '../types.js'

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Base error for gateway-related issues
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

/**
 * Error thrown when gateway request times out
 */
export class GatewayTimeoutError extends GatewayError {
  constructor(timeout: number) {
    super(`Gateway request timed out after ${timeout} seconds`)
    this.name = 'GatewayTimeoutError'
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for GatewayClient
 */
export interface GatewayClientConfig {
  /** Gateway URL */
  url: string
  /** Session key for authentication */
  sessionKey: string
  /** Request timeout in seconds */
  timeout: number
}

/**
 * Request to trigger an action
 */
export interface TriggerRequest {
  /** Message to send to the AI agent */
  message: string
  /** Additional context for the request */
  context?: Record<string, unknown>
  /** Priority of the message */
  priority?: 'low' | 'normal' | 'high'
}

// =============================================================================
// Gateway Client
// =============================================================================

/**
 * Client for communicating with the AI gateway.
 *
 * @example
 * ```ts
 * const client = new GatewayClient({
 *   url: 'https://gateway.example.com',
 *   sessionKey: 'my-session-key',
 *   timeout: 30,
 * });
 *
 * const response = await client.trigger({
 *   message: 'Check email and respond',
 *   priority: 'high',
 * });
 * ```
 */
export class GatewayClient {
  private readonly url: string
  private readonly sessionKey: string
  private readonly timeout: number

  /**
   * Create a new GatewayClient.
   *
   * @param config - Client configuration
   * @throws Error if URL is invalid
   */
  constructor(config: GatewayClientConfig) {
    // Validate URL
    try {
      new URL(config.url)
    } catch {
      throw new Error(`Invalid gateway URL: ${config.url}`)
    }

    // Normalize URL (remove trailing slash)
    this.url = config.url.replace(/\/$/, '')
    this.sessionKey = config.sessionKey
    this.timeout = config.timeout
  }

  /**
   * Trigger an action on the AI agent.
   *
   * @param request - The trigger request
   * @returns Response from the gateway
   * @throws GatewayError on request failure
   * @throws GatewayTimeoutError on timeout
   */
  async trigger(request: TriggerRequest): Promise<GatewayResponse> {
    const { message, context, priority = 'normal' } = request

    const body = JSON.stringify({
      message,
      priority,
      ...(context && { context }),
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000)

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionKey}`,
        },
        body,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string }
        throw new GatewayError(
          errorBody.error || `Gateway request failed: ${response.statusText}`,
          response.status
        )
      }

      return (await response.json()) as GatewayResponse
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof GatewayError) {
        throw error
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new GatewayTimeoutError(this.timeout)
      }

      throw new GatewayError(
        error instanceof Error ? error.message : 'Unknown gateway error'
      )
    }
  }

  /**
   * Send a notification to the AI agent.
   *
   * This is a convenience method that wraps trigger() for simple notifications.
   *
   * @param message - The notification message
   * @param priority - Priority of the notification (default: 'normal')
   * @returns Response from the gateway
   */
  async notify(
    message: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<GatewayResponse> {
    return this.trigger({ message, priority })
  }

  /**
   * Check if the gateway is reachable.
   *
   * @returns true if gateway is healthy, false otherwise
   */
  async healthCheck(): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout * 1000)

    try {
      const response = await fetch(`${this.url}/health`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.sessionKey}`,
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch {
      clearTimeout(timeoutId)
      return false
    }
  }
}
