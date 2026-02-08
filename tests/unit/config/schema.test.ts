/**
 * Schema Validation Unit Tests
 *
 * Tests for Zod schemas including security validations.
 */
import { describe, it, expect } from 'vitest';
import {
  CronxConfigSchema,
  IntervalConfigSchema,
} from '../../../src/config/schema.js';

// =============================================================================
// Gateway URL Security Tests (Issue 1 - HTTPS Enforcement)
// =============================================================================

describe('CronxConfigSchema', () => {
  describe('gateway.url validation', () => {
    const validBaseConfig = {
      cronx: {
        version: 1,
        timezone: 'UTC',
        gateway: {
          url: 'https://gateway.example.com',
          sessionKey: 'valid-session-key-123',
          timeout: 30,
        },
      },
      jobs: {},
    };

    it('should accept HTTPS URLs', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            url: 'https://gateway.example.com',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject plain HTTP URLs for non-localhost', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            url: 'http://gateway.example.com',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('HTTPS');
      }
    });

    it('should allow HTTP for localhost', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            url: 'http://localhost:8080',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should allow HTTP for 127.0.0.1', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            url: 'http://127.0.0.1:8080',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid URLs', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            url: 'not-a-valid-url',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  // ===========================================================================
  // Session Key Validation Tests (Issue 2 - Minimum Length)
  // ===========================================================================

  describe('gateway.sessionKey validation', () => {
    const validBaseConfig = {
      cronx: {
        version: 1,
        timezone: 'UTC',
        gateway: {
          url: 'https://gateway.example.com',
          sessionKey: 'valid-session-key-123',
          timeout: 30,
        },
      },
      jobs: {},
    };

    it('should accept session keys with 8+ characters', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            sessionKey: '12345678',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject session keys shorter than 8 characters', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            sessionKey: '1234567', // 7 characters
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('8 characters');
      }
    });

    it('should reject empty session keys', () => {
      const config = {
        ...validBaseConfig,
        cronx: {
          ...validBaseConfig.cronx,
          gateway: {
            ...validBaseConfig.cronx.gateway,
            sessionKey: '',
          },
        },
      };

      const result = CronxConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// Interval Config Validation Tests (Issue 3 - min <= max)
// =============================================================================

describe('IntervalConfigSchema', () => {
  describe('min/max validation', () => {
    it('should accept when max >= min', () => {
      const config = {
        min: 60,
        max: 120,
        jitter: 0.2,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should accept when max equals min', () => {
      const config = {
        min: 60,
        max: 60,
        jitter: 0.2,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject when max < min', () => {
      const config = {
        min: 120,
        max: 60,
        jitter: 0.2,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('max');
        expect(result.error.issues[0].message).toContain('min');
      }
    });

    it('should still validate min >= 1', () => {
      const config = {
        min: 0,
        max: 10,
        jitter: 0.2,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should still validate max >= 1', () => {
      const config = {
        min: 1,
        max: 0,
        jitter: 0.2,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should use default jitter when not provided', () => {
      const config = {
        min: 60,
        max: 120,
      };

      const result = IntervalConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jitter).toBe(0.2);
      }
    });
  });
});
