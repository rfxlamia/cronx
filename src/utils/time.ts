/**
 * Time utility functions for CRONX scheduler
 */

/**
 * Parse a time string in HH:mm format to a timestamp for today in the given timezone
 * @param timeStr - Time string in HH:mm format (e.g., "09:00", "14:30")
 * @param timezone - IANA timezone string (e.g., "Asia/Jakarta", "UTC")
 * @returns Timestamp in milliseconds
 * @throws Error if timeStr is not in valid HH:mm format
 */
export function parseTime(timeStr: string, timezone: string): number {
  const timeRegex = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const match = timeStr.match(timeRegex);

  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}. Expected HH:mm format.`);
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  // Get current date in the target timezone
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateParts = dateFormatter.format(now).split('-');
  const year = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1;
  const day = parseInt(dateParts[2], 10);

  // We need to find the UTC timestamp such that when formatted in the target timezone, it shows the desired time
  const targetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  // Calculate the offset by comparing UTC interpretation with timezone interpretation
  // Create a reference date and see how it differs
  const refDate = new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
  const parts = targetFormatter.formatToParts(refDate);

  const tzHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const tzMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

  // Calculate the difference between what we want and what we got
  const wantedMinutes = hours * 60 + minutes;
  const gotMinutes = tzHour * 60 + tzMinute;
  const diffMinutes = gotMinutes - wantedMinutes;

  // Adjust the UTC timestamp to get the correct time in the target timezone
  const adjustedMs = refDate.getTime() - diffMinutes * 60 * 1000;

  return adjustedMs;
}

/**
 * Clamp a value between min and max bounds
 * @param value - The value to clamp
 * @param min - Minimum bound
 * @param max - Maximum bound
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Parse a duration string to seconds
 * Supported formats: "2h", "30m", "45s", "1h30m", "2h15m30s"
 * @param duration - Duration string
 * @returns Duration in seconds
 * @throws Error if duration format is invalid
 */
export function parseDuration(duration: string): number {
  if (!duration || duration.trim() === '') {
    throw new Error('Duration string cannot be empty');
  }

  const regex = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
  const match = duration.match(regex);

  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    throw new Error(`Invalid duration format: ${duration}. Expected format like "2h", "30m", "45s", or "1h30m".`);
  }

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format a timestamp to HH:mm:ss in the given timezone
 * @param timestamp - Timestamp in milliseconds
 * @param timezone - IANA timezone string
 * @returns Formatted time string in HH:mm:ss format
 */
export function formatTime(timestamp: number, timezone: string): string {
  const date = new Date(timestamp);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return formatter.format(date);
}
