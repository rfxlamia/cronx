import { describe, it, expect } from 'vitest';
import { parseTime, clamp, parseDuration, formatTime } from '../../../src/utils/time.js';

describe('parseTime', () => {
  it('should parse HH:mm format to timestamp for today', () => {
    const result = parseTime('09:00', 'Asia/Jakarta');
    const date = new Date(result);
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  it('should handle different timezones', () => {
    const jakarta = parseTime('09:00', 'Asia/Jakarta');
    const utc = parseTime('09:00', 'UTC');
    expect(jakarta).not.toBe(utc);
  });

  it('should throw error for invalid time format', () => {
    expect(() => parseTime('invalid', 'UTC')).toThrow();
    expect(() => parseTime('25:00', 'UTC')).toThrow();
    expect(() => parseTime('12:60', 'UTC')).toThrow();
  });
});

describe('clamp', () => {
  it('should return value when within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('should return min when value is below bounds', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('should return max when value is above bounds', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('should handle equal min and max', () => {
    expect(clamp(5, 5, 5)).toBe(5);
    expect(clamp(0, 5, 5)).toBe(5);
    expect(clamp(10, 5, 5)).toBe(5);
  });
});

describe('parseDuration', () => {
  it('should parse hours only', () => {
    expect(parseDuration('2h')).toBe(7200);
    expect(parseDuration('1h')).toBe(3600);
  });

  it('should parse minutes only', () => {
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('1m')).toBe(60);
  });

  it('should parse seconds only', () => {
    expect(parseDuration('45s')).toBe(45);
    expect(parseDuration('1s')).toBe(1);
  });

  it('should parse combined duration', () => {
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('2h15m30s')).toBe(8130);
  });

  it('should throw error for invalid duration format', () => {
    expect(() => parseDuration('invalid')).toThrow();
    expect(() => parseDuration('')).toThrow();
  });
});

describe('formatTime', () => {
  it('should format timestamp to HH:mm:ss', () => {
    // Create a known timestamp for testing
    const date = new Date('2024-01-15T09:30:45Z');
    const result = formatTime(date.getTime(), 'UTC');
    expect(result).toBe('09:30:45');
  });

  it('should respect timezone', () => {
    const date = new Date('2024-01-15T09:00:00Z');
    const utcResult = formatTime(date.getTime(), 'UTC');
    const jakartaResult = formatTime(date.getTime(), 'Asia/Jakarta');
    // Jakarta is UTC+7, so 09:00 UTC = 16:00 Jakarta
    expect(utcResult).toBe('09:00:00');
    expect(jakartaResult).toBe('16:00:00');
  });
});
