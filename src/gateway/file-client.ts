/**
 * CRONX File-Based Gateway Client
 *
 * Drop-in replacement for HTTP GatewayClient that writes trigger files
 * instead of making HTTP requests (for OpenClaw integration).
 *
 * @packageDocumentation
 */

import type { GatewayResponse } from '../types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface FileGatewayConfig {
  /** Directory to write trigger files */
  triggerDir: string;
  /** Session key for identification */
  sessionKey: string;
}

export interface TriggerRequest {
  /** Message to send to the AI agent */
  message: string;
  /** Additional context for the request */
  context?: Record<string, unknown>;
  /** Priority of the message */
  priority?: 'low' | 'normal' | 'high';
}

interface TriggerPayload {
  message: string;
  priority: 'low' | 'normal' | 'high';
  timestamp: number;
  sessionKey: string;
  context?: Record<string, unknown>;
}

// =============================================================================
// Error Classes
// =============================================================================

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayError';
  }
}

// =============================================================================
// File Gateway Client
// =============================================================================

/**
 * File-based gateway client for OpenClaw integration.
 *
 * Instead of HTTP requests, writes trigger files to a directory
 * that the main agent polls or watches.
 *
 * @example
 * ```ts
 * const client = new FileGatewayClient({
 *   triggerDir: '/root/.cronx/triggers',
 *   sessionKey: 'agent:main:main',
 * });
 *
 * const response = await client.trigger({
 *   message: 'Check email and respond',
 *   priority: 'high',
 * });
 * ```
 */
export class FileGatewayClient {
  private readonly triggerDir: string;
  private readonly sessionKey: string;

  constructor(config: FileGatewayConfig) {
    this.triggerDir = config.triggerDir;
    this.sessionKey = config.sessionKey;

    // Ensure trigger directory exists
    if (!fs.existsSync(this.triggerDir)) {
      fs.mkdirSync(this.triggerDir, { recursive: true });
    }
  }

  /**
   * Trigger an action by writing a file.
   * Uses atomic write (temp + rename) to prevent race conditions.
   */
  async trigger(request: TriggerRequest): Promise<GatewayResponse> {
    const { message, context, priority = 'normal' } = request;

    const payload: TriggerPayload = {
      message,
      priority,
      timestamp: Date.now(),
      sessionKey: this.sessionKey,
      ...(context && { context }),
    };

    const filename = `cronx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    const filepath = path.join(this.triggerDir, filename);
    const temppath = filepath + '.tmp';

    try {
      // Atomic write: write to temp, then rename
      fs.writeFileSync(temppath, JSON.stringify(payload, null, 2));
      fs.renameSync(temppath, filepath);

      return {
        success: true,
        message: `Trigger written to ${filename}`,
      };
    } catch (error) {
      // Clean up temp file if exists
      try {
        if (fs.existsSync(temppath)) {
          fs.unlinkSync(temppath);
        }
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write trigger file',
      };
    }
  }

  /**
   * Send a notification (convenience method).
   */
  async notify(
    message: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<GatewayResponse> {
    return this.trigger({ message, priority });
  }

  /**
   * Check if the trigger directory is accessible.
   */
  async healthCheck(): Promise<boolean> {
    try {
      return fs.existsSync(this.triggerDir);
    } catch {
      return false;
    }
  }
}

// Export as GatewayClient for drop-in replacement
export { FileGatewayClient as GatewayClient };
