# CRONX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a random job scheduler daemon for AI agents with configurable randomness strategies, SQLite persistence, and OpenClaw integration.

**Architecture:** Standalone TypeScript daemon that reads config from YAML + HEARTBEAT.md, schedules jobs using randomness strategies (window/interval/probabilistic), triggers AI agent via OpenClaw Gateway HTTP API, and persists state to SQLite with human-readable logs to OpenClaw memory.

**Tech Stack:** TypeScript, better-sqlite3, zod, yaml, chokidar, pino, commander

---

## Phase 1: Foundation (Types & Utils)

### Task 1: Core Type Definitions

**Files:**
- Create: `src/types.ts`
- Test: `tests/unit/types.test.ts`

**Step 1: Create type definitions**

```typescript
// src/types.ts

// Strategy types
export type Strategy = 'window' | 'interval' | 'probabilistic';
export type Distribution = 'uniform' | 'gaussian' | 'weighted';
export type CircuitState = 'closed' | 'open' | 'half_open';
export type RunStatus = 'success' | 'failed' | 'timeout';
export type FailureAction = 'notify' | 'silent' | 'escalate';

// Strategy configs
export interface WindowConfig {
  start: string;          // "09:00"
  end: string;            // "11:00"
  timezone: string;       // "Asia/Jakarta"
  distribution: Distribution;
}

export interface IntervalConfig {
  min: number;            // seconds
  max: number;            // seconds
  jitter: number;         // 0-1
}

export interface ProbabilisticConfig {
  checkInterval: number;  // seconds
  probability: number;    // 0-1
}

export type StrategyConfig = WindowConfig | IntervalConfig | ProbabilisticConfig;

// Retry & Circuit Breaker
export interface RetryConfig {
  maxAttempts: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  timeout: number;        // seconds
}

export interface CircuitBreakerConfig {
  threshold: number;
  window: number;         // seconds
  recoveryTime: number;   // seconds
}

// Job definition
export interface Job {
  name: string;
  description?: string;
  tags?: string[];
  strategy: Strategy;
  config: StrategyConfig;
  enabled: boolean;
  action: {
    message: string;
    priority?: 'low' | 'normal' | 'high';
  };
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  onFailure?: FailureAction;
}

// Job state (runtime)
export interface JobState {
  name: string;
  nextRun: number | null;
  lastRun: number | null;
  enabled: boolean;
  failCount: number;
}

// Run record
export interface RunRecord {
  id?: number;
  jobName: string;
  scheduledAt: number;
  triggeredAt: number;
  completedAt?: number;
  durationMs?: number;
  status: RunStatus;
  response?: unknown;
  error?: string;
  attempts: number;
}

// Gateway types
export interface GatewayRequest {
  sessionKey: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface GatewayResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Config types
export interface CronxConfig {
  version: number;
  timezone: string;
  gateway: {
    url: string;
    sessionKey: string;
    timeout: number;
  };
  defaults: {
    retry: RetryConfig;
    circuitBreaker: CircuitBreakerConfig;
    onFailure: FailureAction;
  };
  jobs: Record<string, Omit<Job, 'name'>>;
}
```

**Step 2: Commit foundation types**

```bash
git add src/types.ts
git commit -m "feat: add core type definitions for jobs, strategies, and config"
```

---

### Task 2: Time Utilities

**Files:**
- Create: `src/utils/time.ts`
- Test: `tests/unit/utils/time.test.ts`

**Step 1: Write failing test for parseTime**

```typescript
// tests/unit/utils/time.test.ts
import { describe, it, expect } from 'vitest';
import { parseTime, clamp } from '../../src/utils/time.js';

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
    // Jakarta is UTC+7, so same local time = different unix timestamp
    expect(jakarta).not.toBe(utc);
  });
});

describe('clamp', () => {
  it('should clamp value within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/utils/time.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Implement time utilities**

```typescript
// src/utils/time.ts

/**
 * Parse HH:mm time string to unix timestamp for today in given timezone
 */
export function parseTime(timeStr: string, timezone: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);

  // Get today's date in the target timezone
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayStr = formatter.format(now); // YYYY-MM-DD

  // Create date string and parse
  const dateStr = `${todayStr}T${timeStr.padStart(5, '0')}:00`;

  // Use timezone-aware parsing
  const date = new Date(
    new Date(dateStr).toLocaleString('en-US', { timeZone: timezone })
  );

  // Adjust for timezone offset
  const targetDate = new Date(dateStr);
  const tzOffset = getTimezoneOffset(timezone, targetDate);

  return targetDate.getTime() - tzOffset;
}

/**
 * Get timezone offset in milliseconds
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return tzDate.getTime() - utcDate.getTime();
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Parse duration string (e.g., "2h", "30m", "1h30m") to seconds
 */
export function parseDuration(duration: string): number {
  let seconds = 0;
  const hourMatch = duration.match(/(\d+)h/);
  const minMatch = duration.match(/(\d+)m/);
  const secMatch = duration.match(/(\d+)s/);

  if (hourMatch) seconds += parseInt(hourMatch[1]) * 3600;
  if (minMatch) seconds += parseInt(minMatch[1]) * 60;
  if (secMatch) seconds += parseInt(secMatch[1]);

  return seconds;
}

/**
 * Format timestamp to human-readable string
 */
export function formatTime(timestamp: number, timezone: string): string {
  return new Date(timestamp).toLocaleString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/utils/time.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/time.ts tests/unit/utils/time.test.ts
git commit -m "feat: add time parsing and utility functions"
```

---

### Task 3: Random Utilities

**Files:**
- Create: `src/utils/random.ts`
- Test: `tests/unit/utils/random.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/utils/random.test.ts
import { describe, it, expect } from 'vitest';
import { createRng, gaussianRandom, weightedRandom } from '../../src/utils/random.js';

describe('createRng', () => {
  it('should create reproducible random with seed', () => {
    const rng1 = createRng('test-seed');
    const rng2 = createRng('test-seed');

    expect(rng1()).toBe(rng2());
    expect(rng1()).toBe(rng2());
  });

  it('should create different sequences with different seeds', () => {
    const rng1 = createRng('seed-1');
    const rng2 = createRng('seed-2');

    expect(rng1()).not.toBe(rng2());
  });
});

describe('gaussianRandom', () => {
  it('should return values mostly between -3 and 3', () => {
    const rng = createRng('gaussian-test');
    const values = Array.from({ length: 1000 }, () => gaussianRandom(rng));

    const inRange = values.filter(v => v >= -3 && v <= 3);
    expect(inRange.length / values.length).toBeGreaterThan(0.99);
  });
});

describe('weightedRandom', () => {
  it('should return index based on weights', () => {
    const rng = createRng('weighted-test');
    const weights = [0.1, 0.2, 0.4, 0.2, 0.1];

    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) {
      counts[weightedRandom(weights, rng)]++;
    }

    // Middle weight (0.4) should have most hits
    expect(counts[2]).toBeGreaterThan(counts[0]);
    expect(counts[2]).toBeGreaterThan(counts[4]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/utils/random.test.ts`
Expected: FAIL

**Step 3: Implement random utilities**

```typescript
// src/utils/random.ts

/**
 * Simple seedable PRNG (Linear Congruential Generator)
 */
export function createRng(seed?: string): () => number {
  if (!seed) {
    return Math.random;
  }

  // Convert seed string to number
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = ((state << 5) - state + seed.charCodeAt(i)) | 0;
  }
  state = Math.abs(state) || 1;

  // LCG parameters (same as glibc)
  const a = 1103515245;
  const c = 12345;
  const m = 2 ** 31;

  return () => {
    state = (a * state + c) % m;
    return state / m;
  };
}

/**
 * Box-Muller transform for Gaussian random
 * Returns value with mean=0, stddev=1
 * Resamples if |z| > 3 (for natural distribution)
 */
export function gaussianRandom(rng: () => number = Math.random): number {
  let z: number;
  do {
    const u1 = rng();
    const u2 = rng();
    z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  } while (Math.abs(z) > 3);

  return z;
}

/**
 * Weighted random selection
 * Returns index based on weight distribution
 */
export function weightedRandom(
  weights: number[],
  rng: () => number = Math.random
): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let random = rng() * total;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return i;
    }
  }

  return weights.length - 1;
}

/**
 * Uniform random in range [min, max]
 */
export function uniformRandom(
  min: number,
  max: number,
  rng: () => number = Math.random
): number {
  return min + rng() * (max - min);
}

/**
 * Jittered value: base ± (base * jitter)
 */
export function jitteredValue(
  base: number,
  jitter: number,
  rng: () => number = Math.random
): number {
  const variance = base * jitter;
  return base + (rng() * 2 - 1) * variance;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/utils/random.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/random.ts tests/unit/utils/random.test.ts
git commit -m "feat: add seedable RNG and random distribution utilities"
```

---

## Phase 2: Randomness Strategies

### Task 4: Window Strategy

**Files:**
- Create: `src/strategies/window.ts`
- Test: `tests/unit/strategies/window.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/strategies/window.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowStrategy } from '../../src/strategies/window.js';
import type { WindowConfig } from '../../src/types.js';

describe('WindowStrategy', () => {
  beforeEach(() => {
    // Mock Date.now() to 2026-02-08 08:00:00 Jakarta time
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T01:00:00Z')); // 08:00 Jakarta
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should calculate next run within window', () => {
    const config: WindowConfig = {
      start: '09:00',
      end: '11:00',
      timezone: 'Asia/Jakarta',
      distribution: 'uniform',
    };

    const strategy = new WindowStrategy(config, 'test-seed');
    const nextRun = strategy.calculateNextRun();

    // Should be between 09:00 and 11:00 Jakarta
    const date = new Date(nextRun);
    const hours = date.getUTCHours() + 7; // Jakarta is UTC+7

    expect(hours).toBeGreaterThanOrEqual(9);
    expect(hours).toBeLessThan(11);
  });

  it('should schedule for tomorrow if window passed', () => {
    vi.setSystemTime(new Date('2026-02-08T05:00:00Z')); // 12:00 Jakarta

    const config: WindowConfig = {
      start: '09:00',
      end: '11:00',
      timezone: 'Asia/Jakarta',
      distribution: 'uniform',
    };

    const strategy = new WindowStrategy(config, 'test-seed');
    const nextRun = strategy.calculateNextRun();

    // Should be tomorrow
    const date = new Date(nextRun);
    expect(date.getUTCDate()).toBe(9); // Feb 9
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/strategies/window.test.ts`
Expected: FAIL

**Step 3: Implement window strategy**

```typescript
// src/strategies/window.ts
import type { WindowConfig } from '../types.js';
import { parseTime, clamp } from '../utils/time.js';
import { createRng, gaussianRandom, weightedRandom, uniformRandom } from '../utils/random.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export class WindowStrategy {
  private config: WindowConfig;
  private rng: () => number;

  constructor(config: WindowConfig, seed?: string) {
    this.config = config;
    this.rng = createRng(seed);
  }

  calculateNextRun(lastRun?: number): number {
    const { start, end, timezone, distribution } = this.config;

    let windowStart = parseTime(start, timezone);
    let windowEnd = parseTime(end, timezone);

    const now = Date.now();

    // If window already passed today, schedule for tomorrow
    if (windowEnd < now) {
      windowStart += DAY_MS;
      windowEnd += DAY_MS;
    }

    // If we're in the middle of window and already ran today, schedule tomorrow
    if (lastRun && lastRun > windowStart - DAY_MS && windowStart < now) {
      windowStart += DAY_MS;
      windowEnd += DAY_MS;
    }

    const windowDuration = windowEnd - windowStart;
    let offset: number;

    switch (distribution) {
      case 'uniform':
        offset = uniformRandom(0, windowDuration, this.rng);
        break;

      case 'gaussian':
        // Bell curve centered at middle of window
        const z = gaussianRandom(this.rng);
        offset = (0.5 + z * 0.15) * windowDuration;
        offset = clamp(offset, 0, windowDuration);
        break;

      case 'weighted':
        // TODO: Implement activity-based weighting
        // For now, use slight bias toward middle
        const weights = [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];
        const bucket = weightedRandom(weights, this.rng);
        const bucketSize = windowDuration / weights.length;
        offset = bucket * bucketSize + uniformRandom(0, bucketSize, this.rng);
        break;

      default:
        offset = uniformRandom(0, windowDuration, this.rng);
    }

    return windowStart + Math.floor(offset);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/strategies/window.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/window.ts tests/unit/strategies/window.test.ts
git commit -m "feat: implement window strategy with uniform/gaussian/weighted distribution"
```

---

### Task 5: Interval Strategy

**Files:**
- Create: `src/strategies/interval.ts`
- Test: `tests/unit/strategies/interval.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/strategies/interval.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntervalStrategy } from '../../src/strategies/interval.js';
import type { IntervalConfig } from '../../src/types.js';

describe('IntervalStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should schedule immediately for first run', () => {
    const config: IntervalConfig = {
      min: 7200,  // 2 hours
      max: 14400, // 4 hours
      jitter: 0.2,
    };

    const strategy = new IntervalStrategy(config, 'test-seed');
    const nextRun = strategy.calculateNextRun(null);

    const now = Date.now();
    const diff = (nextRun - now) / 1000;

    // First run should be within interval range
    expect(diff).toBeGreaterThanOrEqual(7200);
    expect(diff).toBeLessThanOrEqual(14400);
  });

  it('should schedule based on last run with jitter', () => {
    const config: IntervalConfig = {
      min: 7200,
      max: 14400,
      jitter: 0.2,
    };

    const strategy = new IntervalStrategy(config, 'test-seed');
    const lastRun = Date.now() - 3600000; // 1 hour ago
    const nextRun = strategy.calculateNextRun(lastRun);

    const diff = (nextRun - lastRun) / 1000;

    // Should be within min-max range (with some jitter tolerance)
    expect(diff).toBeGreaterThanOrEqual(7200 * 0.8);
    expect(diff).toBeLessThanOrEqual(14400 * 1.2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/strategies/interval.test.ts`
Expected: FAIL

**Step 3: Implement interval strategy**

```typescript
// src/strategies/interval.ts
import type { IntervalConfig } from '../types.js';
import { clamp } from '../utils/time.js';
import { createRng, jitteredValue, uniformRandom } from '../utils/random.js';

export class IntervalStrategy {
  private config: IntervalConfig;
  private rng: () => number;

  constructor(config: IntervalConfig, seed?: string) {
    this.config = config;
    this.rng = createRng(seed);
  }

  calculateNextRun(lastRun: number | null): number {
    const { min, max, jitter } = this.config;
    const now = Date.now();

    // First run: schedule within the interval from now
    if (lastRun === null) {
      const interval = uniformRandom(min, max, this.rng);
      return now + interval * 1000;
    }

    // Calculate base interval (midpoint)
    const baseInterval = (min + max) / 2;

    // Apply jitter
    const jitteredInterval = jitteredValue(baseInterval, jitter, this.rng);

    // Clamp to min-max bounds
    const finalInterval = clamp(jitteredInterval, min, max);

    // Calculate next run from last run
    const nextRun = lastRun + finalInterval * 1000;

    // If next run is in the past, schedule from now
    if (nextRun < now) {
      return now + uniformRandom(min, max, this.rng) * 1000;
    }

    return nextRun;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/strategies/interval.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/interval.ts tests/unit/strategies/interval.test.ts
git commit -m "feat: implement jittered interval strategy"
```

---

### Task 6: Probabilistic Strategy

**Files:**
- Create: `src/strategies/probabilistic.ts`
- Test: `tests/unit/strategies/probabilistic.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/strategies/probabilistic.test.ts
import { describe, it, expect } from 'vitest';
import { ProbabilisticStrategy } from '../../src/strategies/probabilistic.js';
import type { ProbabilisticConfig } from '../../src/types.js';

describe('ProbabilisticStrategy', () => {
  it('should return true approximately probability% of the time', () => {
    const config: ProbabilisticConfig = {
      checkInterval: 3600, // 1 hour
      probability: 0.3,
    };

    const strategy = new ProbabilisticStrategy(config, 'test-seed');

    let hits = 0;
    const trials = 1000;

    for (let i = 0; i < trials; i++) {
      if (strategy.shouldRun()) hits++;
    }

    const ratio = hits / trials;
    // Should be roughly 30% (±5%)
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.35);
  });

  it('should calculate next check time based on interval', () => {
    const config: ProbabilisticConfig = {
      checkInterval: 3600,
      probability: 0.3,
    };

    const strategy = new ProbabilisticStrategy(config, 'test-seed');
    const now = Date.now();
    const nextCheck = strategy.getNextCheckTime();

    expect(nextCheck - now).toBe(3600 * 1000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/strategies/probabilistic.test.ts`
Expected: FAIL

**Step 3: Implement probabilistic strategy**

```typescript
// src/strategies/probabilistic.ts
import type { ProbabilisticConfig } from '../types.js';
import { createRng } from '../utils/random.js';

export class ProbabilisticStrategy {
  private config: ProbabilisticConfig;
  private rng: () => number;

  constructor(config: ProbabilisticConfig, seed?: string) {
    this.config = config;
    this.rng = createRng(seed);
  }

  /**
   * Determine if job should run this check
   */
  shouldRun(): boolean {
    return this.rng() < this.config.probability;
  }

  /**
   * Get next check time (interval from now)
   */
  getNextCheckTime(): number {
    return Date.now() + this.config.checkInterval * 1000;
  }

  /**
   * Get the check interval in milliseconds
   */
  getCheckIntervalMs(): number {
    return this.config.checkInterval * 1000;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/strategies/probabilistic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/probabilistic.ts tests/unit/strategies/probabilistic.test.ts
git commit -m "feat: implement probabilistic strategy"
```

---

### Task 7: Strategy Factory

**Files:**
- Create: `src/strategies/index.ts`
- Test: `tests/unit/strategies/factory.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/strategies/factory.test.ts
import { describe, it, expect } from 'vitest';
import { createStrategy } from '../../src/strategies/index.js';
import type { Job } from '../../src/types.js';

describe('createStrategy', () => {
  it('should create WindowStrategy for window type', () => {
    const job: Job = {
      name: 'test',
      strategy: 'window',
      config: {
        start: '09:00',
        end: '11:00',
        timezone: 'UTC',
        distribution: 'uniform',
      },
      enabled: true,
      action: { message: 'test' },
    };

    const strategy = createStrategy(job);
    expect(strategy.type).toBe('window');
  });

  it('should create IntervalStrategy for interval type', () => {
    const job: Job = {
      name: 'test',
      strategy: 'interval',
      config: {
        min: 3600,
        max: 7200,
        jitter: 0.2,
      },
      enabled: true,
      action: { message: 'test' },
    };

    const strategy = createStrategy(job);
    expect(strategy.type).toBe('interval');
  });

  it('should create ProbabilisticStrategy for probabilistic type', () => {
    const job: Job = {
      name: 'test',
      strategy: 'probabilistic',
      config: {
        checkInterval: 3600,
        probability: 0.3,
      },
      enabled: true,
      action: { message: 'test' },
    };

    const strategy = createStrategy(job);
    expect(strategy.type).toBe('probabilistic');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/strategies/factory.test.ts`
Expected: FAIL

**Step 3: Implement strategy factory**

```typescript
// src/strategies/index.ts
import type { Job, WindowConfig, IntervalConfig, ProbabilisticConfig } from '../types.js';
import { WindowStrategy } from './window.js';
import { IntervalStrategy } from './interval.js';
import { ProbabilisticStrategy } from './probabilistic.js';

export interface StrategyWrapper {
  type: 'window' | 'interval' | 'probabilistic';
  calculateNextRun(lastRun: number | null): number;
  // For probabilistic
  shouldRun?(): boolean;
  getNextCheckTime?(): number;
}

export function createStrategy(job: Job, seed?: string): StrategyWrapper {
  switch (job.strategy) {
    case 'window': {
      const strategy = new WindowStrategy(job.config as WindowConfig, seed);
      return {
        type: 'window',
        calculateNextRun: (lastRun) => strategy.calculateNextRun(lastRun),
      };
    }

    case 'interval': {
      const strategy = new IntervalStrategy(job.config as IntervalConfig, seed);
      return {
        type: 'interval',
        calculateNextRun: (lastRun) => strategy.calculateNextRun(lastRun),
      };
    }

    case 'probabilistic': {
      const strategy = new ProbabilisticStrategy(job.config as ProbabilisticConfig, seed);
      return {
        type: 'probabilistic',
        calculateNextRun: () => strategy.getNextCheckTime(),
        shouldRun: () => strategy.shouldRun(),
        getNextCheckTime: () => strategy.getNextCheckTime(),
      };
    }

    default:
      throw new Error(`Unknown strategy: ${job.strategy}`);
  }
}

export { WindowStrategy } from './window.js';
export { IntervalStrategy } from './interval.js';
export { ProbabilisticStrategy } from './probabilistic.js';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/strategies/factory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/strategies/index.ts tests/unit/strategies/factory.test.ts
git commit -m "feat: add strategy factory for unified job scheduling"
```

---

## Phase 3: Storage Layer

### Task 8: SQLite Storage

**Files:**
- Create: `src/storage/sqlite.ts`
- Test: `tests/unit/storage/sqlite.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/storage/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStore } from '../../src/storage/sqlite.js';
import { unlink } from 'fs/promises';

describe('SQLiteStore', () => {
  const testDbPath = '/tmp/cronx-test.db';
  let store: SQLiteStore;

  beforeEach(() => {
    store = new SQLiteStore(testDbPath);
  });

  afterEach(async () => {
    store.close();
    await unlink(testDbPath).catch(() => {});
  });

  describe('jobs', () => {
    it('should save and retrieve job state', () => {
      store.saveJobState({
        name: 'research',
        nextRun: Date.now() + 3600000,
        lastRun: null,
        enabled: true,
        failCount: 0,
      });

      const job = store.getJobState('research');
      expect(job?.name).toBe('research');
      expect(job?.enabled).toBe(true);
    });

    it('should update existing job', () => {
      store.saveJobState({
        name: 'research',
        nextRun: 1000,
        lastRun: null,
        enabled: true,
        failCount: 0,
      });

      store.saveJobState({
        name: 'research',
        nextRun: 2000,
        lastRun: 1000,
        enabled: true,
        failCount: 0,
      });

      const job = store.getJobState('research');
      expect(job?.nextRun).toBe(2000);
      expect(job?.lastRun).toBe(1000);
    });
  });

  describe('runs', () => {
    it('should record run and retrieve it', () => {
      const runId = store.recordRun({
        jobName: 'research',
        scheduledAt: Date.now(),
        triggeredAt: Date.now(),
        status: 'success',
        attempts: 1,
      });

      expect(runId).toBeGreaterThan(0);

      const runs = store.getRecentRuns('research', 10);
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe('success');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/storage/sqlite.test.ts`
Expected: FAIL

**Step 3: Implement SQLite storage**

```typescript
// src/storage/sqlite.ts
import Database from 'better-sqlite3';
import type { JobState, RunRecord } from '../types.js';

export class SQLiteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        name TEXT PRIMARY KEY,
        next_run INTEGER,
        last_run INTEGER,
        enabled INTEGER DEFAULT 1,
        fail_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT NOT NULL,
        scheduled_at INTEGER,
        triggered_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER,
        status TEXT,
        response TEXT,
        error TEXT,
        attempts INTEGER DEFAULT 1,
        FOREIGN KEY (job_name) REFERENCES jobs(name)
      );

      CREATE TABLE IF NOT EXISTS circuit_breakers (
        job_name TEXT PRIMARY KEY,
        state TEXT DEFAULT 'closed',
        failure_count INTEGER DEFAULT 0,
        last_failure_at INTEGER,
        opened_at INTEGER,
        FOREIGN KEY (job_name) REFERENCES jobs(name)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_next_run
        ON jobs(next_run) WHERE enabled = 1;

      CREATE INDEX IF NOT EXISTS idx_runs_job_time
        ON runs(job_name, triggered_at);
    `);
  }

  saveJobState(state: JobState): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (name, next_run, last_run, enabled, fail_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        next_run = excluded.next_run,
        last_run = excluded.last_run,
        enabled = excluded.enabled,
        fail_count = excluded.fail_count,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      state.name,
      state.nextRun,
      state.lastRun,
      state.enabled ? 1 : 0,
      state.failCount,
      Date.now()
    );
  }

  getJobState(name: string): JobState | null {
    const stmt = this.db.prepare(`
      SELECT name, next_run, last_run, enabled, fail_count
      FROM jobs WHERE name = ?
    `);

    const row = stmt.get(name) as any;
    if (!row) return null;

    return {
      name: row.name,
      nextRun: row.next_run,
      lastRun: row.last_run,
      enabled: Boolean(row.enabled),
      failCount: row.fail_count,
    };
  }

  getAllJobStates(): JobState[] {
    const stmt = this.db.prepare(`
      SELECT name, next_run, last_run, enabled, fail_count FROM jobs
    `);

    return (stmt.all() as any[]).map(row => ({
      name: row.name,
      nextRun: row.next_run,
      lastRun: row.last_run,
      enabled: Boolean(row.enabled),
      failCount: row.fail_count,
    }));
  }

  recordRun(run: RunRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO runs (job_name, scheduled_at, triggered_at, completed_at, duration_ms, status, response, error, attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      run.jobName,
      run.scheduledAt,
      run.triggeredAt,
      run.completedAt ?? null,
      run.durationMs ?? null,
      run.status,
      run.response ? JSON.stringify(run.response) : null,
      run.error ?? null,
      run.attempts
    );

    return Number(result.lastInsertRowid);
  }

  getRecentRuns(jobName: string, limit: number): RunRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM runs WHERE job_name = ?
      ORDER BY triggered_at DESC LIMIT ?
    `);

    return (stmt.all(jobName, limit) as any[]).map(row => ({
      id: row.id,
      jobName: row.job_name,
      scheduledAt: row.scheduled_at,
      triggeredAt: row.triggered_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      status: row.status,
      response: row.response ? JSON.parse(row.response) : undefined,
      error: row.error,
      attempts: row.attempts,
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/storage/sqlite.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/sqlite.ts tests/unit/storage/sqlite.test.ts
git commit -m "feat: implement SQLite storage for job state and run history"
```

---

## Phase 4: Config & Gateway

### Task 9: Config Loader with Zod Validation

**Files:**
- Create: `src/config/loader.ts`
- Create: `src/config/schema.ts`
- Test: `tests/unit/config/loader.test.ts`

**Step 1: Create Zod schema**

```typescript
// src/config/schema.ts
import { z } from 'zod';

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().min(1).default(3),
  backoff: z.enum(['fixed', 'linear', 'exponential']).default('exponential'),
  timeout: z.number().min(1).default(30),
});

export const CircuitBreakerConfigSchema = z.object({
  threshold: z.number().min(1).default(5),
  window: z.number().min(1).default(3600),
  recoveryTime: z.number().min(1).default(600),
});

export const WindowConfigSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('UTC'),
  distribution: z.enum(['uniform', 'gaussian', 'weighted']).default('uniform'),
});

export const IntervalConfigSchema = z.object({
  min: z.number().min(1),
  max: z.number().min(1),
  jitter: z.number().min(0).max(1).default(0.2),
});

export const ProbabilisticConfigSchema = z.object({
  checkInterval: z.number().min(1),
  probability: z.number().min(0).max(1),
});

export const ActionSchema = z.object({
  message: z.string(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
});

export const JobSchema = z.object({
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  strategy: z.enum(['window', 'interval', 'probabilistic']),
  window: WindowConfigSchema.optional(),
  interval: IntervalConfigSchema.optional(),
  probabilistic: ProbabilisticConfigSchema.optional(),
  action: ActionSchema,
  enabled: z.boolean().default(true),
  retry: RetryConfigSchema.optional(),
  circuitBreaker: CircuitBreakerConfigSchema.optional(),
  onFailure: z.enum(['notify', 'silent', 'escalate']).optional(),
});

export const CronxConfigSchema = z.object({
  cronx: z.object({
    version: z.number().default(1),
    timezone: z.string().default('UTC'),
    gateway: z.object({
      url: z.string().url(),
      sessionKey: z.string(),
      timeout: z.string().or(z.number()).transform(v => {
        if (typeof v === 'number') return v;
        const match = v.match(/^(\d+)s?$/);
        return match ? parseInt(match[1]) : 30;
      }).default(30),
    }),
    defaults: z.object({
      retry: RetryConfigSchema.default({}),
      circuitBreaker: CircuitBreakerConfigSchema.default({}),
      onFailure: z.enum(['notify', 'silent', 'escalate']).default('notify'),
    }).default({}),
  }),
  jobs: z.record(z.string(), JobSchema),
});

export type CronxConfigInput = z.input<typeof CronxConfigSchema>;
export type CronxConfigOutput = z.output<typeof CronxConfigSchema>;
```

**Step 2: Write failing test**

```typescript
// tests/unit/config/loader.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfigFromString } from '../../src/config/loader.js';

describe('loadConfigFromString', () => {
  it('should parse valid YAML config', () => {
    const yaml = `
cronx:
  version: 1
  timezone: Asia/Jakarta
  gateway:
    url: http://127.0.0.1:18789/api/v1/sessions/send
    sessionKey: agent:main:main
    timeout: 30s

jobs:
  research:
    strategy: window
    window:
      start: "09:00"
      end: "11:00"
      timezone: Asia/Jakarta
      distribution: weighted
    action:
      message: "Run research"
    enabled: true
`;

    const config = loadConfigFromString(yaml);

    expect(config.cronx.timezone).toBe('Asia/Jakarta');
    expect(config.jobs.research.strategy).toBe('window');
    expect(config.jobs.research.enabled).toBe(true);
  });

  it('should apply defaults', () => {
    const yaml = `
cronx:
  gateway:
    url: http://localhost:18789/api
    sessionKey: test

jobs:
  test:
    strategy: interval
    interval:
      min: 3600
      max: 7200
    action:
      message: test
`;

    const config = loadConfigFromString(yaml);

    expect(config.cronx.defaults.retry.maxAttempts).toBe(3);
    expect(config.cronx.defaults.retry.backoff).toBe('exponential');
  });

  it('should throw on invalid config', () => {
    const yaml = `
cronx:
  gateway:
    url: not-a-url
    sessionKey: test
jobs: {}
`;

    expect(() => loadConfigFromString(yaml)).toThrow();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npm test -- tests/unit/config/loader.test.ts`
Expected: FAIL

**Step 4: Implement config loader**

```typescript
// src/config/loader.ts
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { CronxConfigSchema, type CronxConfigOutput } from './schema.js';
import type { Job } from '../types.js';

/**
 * Load config from YAML string
 */
export function loadConfigFromString(yamlStr: string): CronxConfigOutput {
  const raw = parseYaml(yamlStr);
  return CronxConfigSchema.parse(raw);
}

/**
 * Load config from file path
 */
export function loadConfigFromFile(filePath: string): CronxConfigOutput {
  const content = readFileSync(filePath, 'utf-8');
  // Expand environment variables
  const expanded = content.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const [varName, defaultValue] = expr.split(':-');
    return process.env[varName] ?? defaultValue ?? '';
  });
  return loadConfigFromString(expanded);
}

/**
 * Convert parsed config to Job objects
 */
export function configToJobs(config: CronxConfigOutput): Job[] {
  const { cronx, jobs } = config;

  return Object.entries(jobs).map(([name, jobConfig]) => {
    // Determine strategy config based on strategy type
    let strategyConfig;
    switch (jobConfig.strategy) {
      case 'window':
        strategyConfig = {
          ...jobConfig.window!,
          timezone: jobConfig.window?.timezone ?? cronx.timezone,
        };
        break;
      case 'interval':
        strategyConfig = jobConfig.interval!;
        break;
      case 'probabilistic':
        strategyConfig = jobConfig.probabilistic!;
        break;
    }

    return {
      name,
      description: jobConfig.description,
      tags: jobConfig.tags,
      strategy: jobConfig.strategy,
      config: strategyConfig,
      enabled: jobConfig.enabled,
      action: jobConfig.action,
      retry: jobConfig.retry ?? cronx.defaults.retry,
      circuitBreaker: jobConfig.circuitBreaker ?? cronx.defaults.circuitBreaker,
      onFailure: jobConfig.onFailure ?? cronx.defaults.onFailure,
    } as Job;
  });
}
```

**Step 5: Run test to verify it passes**

Run: `npm test -- tests/unit/config/loader.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/schema.ts src/config/loader.ts tests/unit/config/loader.test.ts
git commit -m "feat: add config loader with Zod validation and env variable expansion"
```

---

### Task 10: Gateway Client

**Files:**
- Create: `src/gateway/client.ts`
- Test: `tests/unit/gateway/client.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/gateway/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayClient } from '../../src/gateway/client.js';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('GatewayClient', () => {
  let client: GatewayClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new GatewayClient({
      url: 'http://localhost:18789/api/v1/sessions/send',
      sessionKey: 'agent:main:main',
      timeout: 30,
    });
  });

  it('should send trigger request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await client.trigger({
      message: 'Run research',
      context: { source: 'cronx' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:18789/api/v1/sessions/send',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    expect(result.success).toBe(true);
  });

  it('should handle gateway errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await client.trigger({ message: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await client.trigger({ message: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/gateway/client.test.ts`
Expected: FAIL

**Step 3: Implement gateway client**

```typescript
// src/gateway/client.ts
import type { GatewayRequest, GatewayResponse } from '../types.js';

export interface GatewayClientConfig {
  url: string;
  sessionKey: string;
  timeout: number;
}

export class GatewayClient {
  private config: GatewayClientConfig;

  constructor(config: GatewayClientConfig) {
    this.config = config;
  }

  async trigger(request: {
    message: string;
    context?: Record<string, unknown>;
    priority?: 'low' | 'normal' | 'high';
  }): Promise<GatewayResponse> {
    const { url, sessionKey, timeout } = this.config;

    const body: GatewayRequest = {
      sessionKey,
      message: request.message,
      context: {
        triggeredBy: 'cronx',
        ...request.context,
      },
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `Gateway returned ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        message: data.message,
      };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: `Request timed out after ${timeout}s`,
          };
        }
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: 'Unknown error',
      };
    }
  }

  async notify(message: string, priority: 'low' | 'normal' | 'high' = 'high'): Promise<GatewayResponse> {
    return this.trigger({
      message: `[CRONX ALERT] ${message}`,
      priority,
      context: {
        type: 'alert',
      },
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/gateway/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway/client.ts tests/unit/gateway/client.test.ts
git commit -m "feat: implement Gateway client for triggering AI agent"
```

---

## Phase 5: Core Scheduler

### Task 11: Job Runner

**Files:**
- Create: `src/core/job-runner.ts`
- Test: `tests/unit/core/job-runner.test.ts`

**Step 1: Write failing test**

```typescript
// tests/unit/core/job-runner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobRunner } from '../../src/core/job-runner.js';
import type { Job, GatewayResponse } from '../../src/types.js';

describe('JobRunner', () => {
  const mockGateway = {
    trigger: vi.fn<[], Promise<GatewayResponse>>(),
    notify: vi.fn<[], Promise<GatewayResponse>>(),
  };

  const mockStore = {
    recordRun: vi.fn(),
    saveJobState: vi.fn(),
    getJobState: vi.fn(),
  };

  let runner: JobRunner;

  const testJob: Job = {
    name: 'test-job',
    strategy: 'window',
    config: { start: '09:00', end: '11:00', timezone: 'UTC', distribution: 'uniform' },
    enabled: true,
    action: { message: 'Run test' },
    retry: { maxAttempts: 3, backoff: 'exponential', timeout: 30 },
    onFailure: 'notify',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new JobRunner(mockGateway as any, mockStore as any);
  });

  it('should run job successfully', async () => {
    mockGateway.trigger.mockResolvedValueOnce({ success: true });

    const result = await runner.run(testJob);

    expect(result.status).toBe('success');
    expect(mockGateway.trigger).toHaveBeenCalledWith({
      message: 'Run test',
      context: expect.objectContaining({ jobName: 'test-job' }),
    });
    expect(mockStore.recordRun).toHaveBeenCalled();
  });

  it('should retry on failure', async () => {
    mockGateway.trigger
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValueOnce({ success: true });

    const result = await runner.run(testJob);

    expect(result.status).toBe('success');
    expect(mockGateway.trigger).toHaveBeenCalledTimes(2);
  });

  it('should fail after max retries', async () => {
    mockGateway.trigger.mockResolvedValue({ success: false, error: 'error' });
    mockGateway.notify.mockResolvedValue({ success: true });

    const result = await runner.run(testJob);

    expect(result.status).toBe('failed');
    expect(mockGateway.trigger).toHaveBeenCalledTimes(3);
    expect(mockGateway.notify).toHaveBeenCalled(); // onFailure: notify
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/core/job-runner.test.ts`
Expected: FAIL

**Step 3: Implement job runner**

```typescript
// src/core/job-runner.ts
import type { Job, RunRecord, RunStatus } from '../types.js';
import type { GatewayClient } from '../gateway/client.js';
import type { SQLiteStore } from '../storage/sqlite.js';

export interface RunResult {
  status: RunStatus;
  attempts: number;
  error?: string;
  durationMs: number;
}

export class JobRunner {
  constructor(
    private gateway: GatewayClient,
    private store: SQLiteStore
  ) {}

  async run(job: Job): Promise<RunResult> {
    const startTime = Date.now();
    const scheduledAt = Date.now();
    let attempts = 0;
    let lastError: string | undefined;

    const maxAttempts = job.retry?.maxAttempts ?? 3;
    const backoff = job.retry?.backoff ?? 'exponential';

    while (attempts < maxAttempts) {
      attempts++;

      const response = await this.gateway.trigger({
        message: job.action.message,
        priority: job.action.priority,
        context: {
          jobName: job.name,
          scheduledAt,
          attempt: attempts,
        },
      });

      if (response.success) {
        const durationMs = Date.now() - startTime;

        this.store.recordRun({
          jobName: job.name,
          scheduledAt,
          triggeredAt: startTime,
          completedAt: Date.now(),
          durationMs,
          status: 'success',
          attempts,
        });

        return { status: 'success', attempts, durationMs };
      }

      lastError = response.error;

      // Wait before retry (unless last attempt)
      if (attempts < maxAttempts) {
        const delay = this.calculateBackoff(attempts, backoff);
        await this.sleep(delay);
      }
    }

    // All attempts failed
    const durationMs = Date.now() - startTime;

    this.store.recordRun({
      jobName: job.name,
      scheduledAt,
      triggeredAt: startTime,
      completedAt: Date.now(),
      durationMs,
      status: 'failed',
      error: lastError,
      attempts,
    });

    // Handle failure notification
    if (job.onFailure === 'notify' || job.onFailure === 'escalate') {
      await this.gateway.notify(
        `Job '${job.name}' failed after ${attempts} attempts. Error: ${lastError}`
      );
    }

    return { status: 'failed', attempts, error: lastError, durationMs };
  }

  private calculateBackoff(attempt: number, strategy: 'fixed' | 'linear' | 'exponential'): number {
    const baseMs = 60_000; // 1 minute

    switch (strategy) {
      case 'fixed':
        return baseMs;
      case 'linear':
        return baseMs * attempt;
      case 'exponential':
        return baseMs * Math.pow(2, attempt - 1); // 1m, 2m, 4m, 8m...
      default:
        return baseMs;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/core/job-runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/core/job-runner.ts tests/unit/core/job-runner.test.ts
git commit -m "feat: implement job runner with retry and backoff"
```

---

### Task 12: Main Scheduler

**Files:**
- Create: `src/core/scheduler.ts`
- Create: `src/daemon.ts`

**Step 1: Implement scheduler core**

```typescript
// src/core/scheduler.ts
import type { Job, JobState } from '../types.js';
import type { SQLiteStore } from '../storage/sqlite.js';
import type { GatewayClient } from '../gateway/client.js';
import { JobRunner } from './job-runner.js';
import { createStrategy } from '../strategies/index.js';
import pino from 'pino';

export interface SchedulerConfig {
  jobs: Job[];
  store: SQLiteStore;
  gateway: GatewayClient;
  timezone: string;
  seed?: string;
}

export class Scheduler {
  private jobs: Map<string, Job> = new Map();
  private states: Map<string, JobState> = new Map();
  private runner: JobRunner;
  private store: SQLiteStore;
  private timezone: string;
  private seed?: string;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private logger = pino({ name: 'cronx-scheduler' });

  constructor(config: SchedulerConfig) {
    this.store = config.store;
    this.timezone = config.timezone;
    this.seed = config.seed;
    this.runner = new JobRunner(config.gateway, config.store);

    // Load jobs
    for (const job of config.jobs) {
      this.jobs.set(job.name, job);
    }
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.info('Scheduler starting...');

    // Initialize job states
    await this.initializeStates();

    // Start the scheduling loop
    this.scheduleNext();

    this.logger.info({ jobCount: this.jobs.size }, 'Scheduler started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info('Scheduler stopped');
  }

  private async initializeStates(): Promise<void> {
    for (const [name, job] of this.jobs) {
      if (!job.enabled) continue;

      // Try to load existing state
      let state = this.store.getJobState(name);

      if (!state) {
        // Create new state with calculated next run
        const strategy = createStrategy(job, this.seed);
        const nextRun = strategy.calculateNextRun(null);

        state = {
          name,
          nextRun,
          lastRun: null,
          enabled: true,
          failCount: 0,
        };

        this.store.saveJobState(state);
      }

      this.states.set(name, state);
      this.logger.debug({ job: name, nextRun: new Date(state.nextRun!) }, 'Job initialized');
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;

    // Find next job to run
    let nextJob: string | null = null;
    let nextTime = Infinity;

    for (const [name, state] of this.states) {
      if (!state.enabled || state.nextRun === null) continue;
      if (state.nextRun < nextTime) {
        nextTime = state.nextRun;
        nextJob = name;
      }
    }

    if (!nextJob) {
      this.logger.warn('No jobs scheduled');
      return;
    }

    const delay = Math.max(0, nextTime - Date.now());
    this.logger.info({ job: nextJob, runAt: new Date(nextTime), delayMs: delay }, 'Next job scheduled');

    this.timer = setTimeout(() => this.runJob(nextJob!), delay);
  }

  private async runJob(jobName: string): Promise<void> {
    const job = this.jobs.get(jobName);
    const state = this.states.get(jobName);

    if (!job || !state) {
      this.logger.error({ job: jobName }, 'Job not found');
      this.scheduleNext();
      return;
    }

    // For probabilistic, check if should actually run
    const strategy = createStrategy(job, this.seed);
    if (job.strategy === 'probabilistic' && strategy.shouldRun && !strategy.shouldRun()) {
      this.logger.debug({ job: jobName }, 'Probabilistic job skipped');
      state.nextRun = strategy.calculateNextRun(state.lastRun);
      this.store.saveJobState(state);
      this.states.set(jobName, state);
      this.scheduleNext();
      return;
    }

    this.logger.info({ job: jobName }, 'Running job');

    const result = await this.runner.run(job);

    // Update state
    state.lastRun = Date.now();
    state.nextRun = strategy.calculateNextRun(state.lastRun);
    state.failCount = result.status === 'failed' ? state.failCount + 1 : 0;

    this.store.saveJobState(state);
    this.states.set(jobName, state);

    this.logger.info({
      job: jobName,
      status: result.status,
      attempts: result.attempts,
      nextRun: new Date(state.nextRun!),
    }, 'Job completed');

    // Schedule next
    this.scheduleNext();
  }

  getStatus(): { name: string; nextRun: Date | null; lastRun: Date | null; enabled: boolean }[] {
    return Array.from(this.states.values()).map(state => ({
      name: state.name,
      nextRun: state.nextRun ? new Date(state.nextRun) : null,
      lastRun: state.lastRun ? new Date(state.lastRun) : null,
      enabled: state.enabled,
    }));
  }
}
```

**Step 2: Create daemon entry point**

```typescript
// src/daemon.ts
#!/usr/bin/env node
import { Scheduler } from './core/scheduler.js';
import { loadConfigFromFile, configToJobs } from './config/loader.js';
import { SQLiteStore } from './storage/sqlite.js';
import { GatewayClient } from './gateway/client.js';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ name: 'cronx' });

async function main() {
  const cronxDir = join(homedir(), '.cronx');

  // Ensure .cronx directory exists
  if (!existsSync(cronxDir)) {
    mkdirSync(cronxDir, { recursive: true });
  }

  // Load config
  const configPath = process.env.CRONX_CONFIG ?? join(cronxDir, 'cronx.config.yaml');

  if (!existsSync(configPath)) {
    logger.error({ path: configPath }, 'Config file not found');
    process.exit(1);
  }

  logger.info({ configPath }, 'Loading config');
  const config = loadConfigFromFile(configPath);
  const jobs = configToJobs(config);

  // Initialize store
  const dbPath = join(cronxDir, 'cronx.db');
  const store = new SQLiteStore(dbPath);
  logger.info({ dbPath }, 'Database initialized');

  // Initialize gateway client
  const gateway = new GatewayClient({
    url: config.cronx.gateway.url,
    sessionKey: config.cronx.gateway.sessionKey,
    timeout: config.cronx.gateway.timeout,
  });

  // Create scheduler
  const scheduler = new Scheduler({
    jobs,
    store,
    gateway,
    timezone: config.cronx.timezone,
    seed: process.env.CRONX_SEED,
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await scheduler.stop();
    store.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start scheduler
  await scheduler.start();

  logger.info('CRONX daemon running. Press Ctrl+C to stop.');
}

main().catch(err => {
  logger.error(err, 'Fatal error');
  process.exit(1);
});
```

**Step 3: Commit**

```bash
git add src/core/scheduler.ts src/daemon.ts
git commit -m "feat: implement main scheduler and daemon entry point"
```

---

### Task 13: CLI Interface

**Files:**
- Create: `src/cli.ts`

**Step 1: Implement CLI**

```typescript
// src/cli.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { SQLiteStore } from './storage/sqlite.js';
import { loadConfigFromFile, configToJobs } from './config/loader.js';
import { createStrategy } from './strategies/index.js';
import { spawn } from 'child_process';

const program = new Command();

const cronxDir = join(homedir(), '.cronx');
const dbPath = join(cronxDir, 'cronx.db');
const configPath = process.env.CRONX_CONFIG ?? join(cronxDir, 'cronx.config.yaml');

program
  .name('cronx')
  .description('Random job scheduler for AI agents')
  .version('0.1.0');

program
  .command('start')
  .description('Start the CRONX daemon')
  .option('-d, --daemon', 'Run as background daemon')
  .option('--seed <seed>', 'Random seed for reproducible scheduling')
  .action((options) => {
    if (options.daemon) {
      const child = spawn(process.execPath, [join(__dirname, 'daemon.js')], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CRONX_SEED: options.seed },
      });
      child.unref();
      console.log(`CRONX daemon started (PID: ${child.pid})`);
    } else {
      // Run in foreground
      if (options.seed) {
        process.env.CRONX_SEED = options.seed;
      }
      import('./daemon.js');
    }
  });

program
  .command('status')
  .description('Show scheduler status and next runs')
  .action(() => {
    if (!existsSync(dbPath)) {
      console.log('CRONX not initialized. Run "cronx start" first.');
      return;
    }

    const store = new SQLiteStore(dbPath);
    const states = store.getAllJobStates();
    store.close();

    if (states.length === 0) {
      console.log('No jobs configured.');
      return;
    }

    console.log('\nJob Status:');
    console.log('─'.repeat(60));

    for (const state of states) {
      const status = state.enabled ? '✓' : '✗';
      const nextRun = state.nextRun ? new Date(state.nextRun).toLocaleString() : 'N/A';
      const lastRun = state.lastRun ? new Date(state.lastRun).toLocaleString() : 'Never';

      console.log(`${status} ${state.name}`);
      console.log(`  Next: ${nextRun}`);
      console.log(`  Last: ${lastRun}`);
      console.log(`  Fails: ${state.failCount}`);
    }
  });

program
  .command('list')
  .description('List all configured jobs')
  .action(() => {
    if (!existsSync(configPath)) {
      console.log(`Config not found at ${configPath}`);
      return;
    }

    const config = loadConfigFromFile(configPath);
    const jobs = configToJobs(config);

    console.log('\nConfigured Jobs:');
    console.log('─'.repeat(60));

    for (const job of jobs) {
      console.log(`\n${job.name} (${job.strategy})`);
      if (job.description) console.log(`  ${job.description}`);
      console.log(`  Enabled: ${job.enabled}`);
      console.log(`  Action: ${job.action.message}`);
    }
  });

program
  .command('next [job]')
  .description('Show next scheduled run times')
  .option('--count <n>', 'Number of next runs to show', '5')
  .action((jobName, options) => {
    if (!existsSync(configPath)) {
      console.log(`Config not found at ${configPath}`);
      return;
    }

    const config = loadConfigFromFile(configPath);
    const jobs = configToJobs(config);
    const count = parseInt(options.count);

    const targetJobs = jobName
      ? jobs.filter(j => j.name === jobName)
      : jobs;

    for (const job of targetJobs) {
      console.log(`\n${job.name}:`);
      const strategy = createStrategy(job);
      let lastRun: number | null = null;

      for (let i = 0; i < count; i++) {
        const nextRun = strategy.calculateNextRun(lastRun);
        console.log(`  ${i + 1}. ${new Date(nextRun).toLocaleString()}`);
        lastRun = nextRun;
      }
    }
  });

program.parse();
```

**Step 2: Update package.json bin entry**

The bin entry is already correct in package.json pointing to `./dist/cli.js`.

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI interface with start, status, list, and next commands"
```

---

## Phase 6: Final Integration

### Task 14: Example Config & Documentation

**Files:**
- Create: `cronx.config.example.yaml`
- Create: `README.md`

**Step 1: Create example config**

```yaml
# cronx.config.example.yaml
# Copy this to ~/.cronx/cronx.config.yaml

cronx:
  version: 1
  timezone: "Asia/Jakarta"

  gateway:
    url: "${CRONX_GATEWAY_URL:-http://127.0.0.1:18789/api/v1/sessions/send}"
    sessionKey: "agent:main:main"
    timeout: 30s

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
  # Window strategy: Run once within a time window
  research:
    description: "Daily AI research and learning"
    tags: [learning, morning]
    strategy: window
    window:
      start: "09:00"
      end: "11:00"
      distribution: weighted  # More likely when handler is active
    action:
      message: "Run skill: phd-research --topic 'trending AI'"
    enabled: true

  # Interval strategy: Run every N hours with jitter
  check_email:
    description: "Periodic email monitoring"
    tags: [communication]
    strategy: interval
    interval:
      min: 7200   # 2 hours
      max: 14400  # 4 hours
      jitter: 0.2 # ±20% variance
    action:
      message: "Check gmail for important messages"
    enabled: true

  # Probabilistic strategy: Random chance each interval
  social_pulse:
    description: "Random social media check"
    tags: [social, optional]
    strategy: probabilistic
    probabilistic:
      checkInterval: 3600  # Check every hour
      probability: 0.3     # 30% chance to run
    action:
      message: "Quick scan Twitter/X for AI news"
      priority: low
    retry:
      maxAttempts: 1
    onFailure: silent
    enabled: true
```

**Step 2: Create README**

```markdown
# CRONX

Random job scheduler for AI agents - making autonomous agents feel natural, not robotic.

## Installation

```bash
npm install -g cronx
```

## Quick Start

1. Create config file:
```bash
mkdir -p ~/.cronx
cp cronx.config.example.yaml ~/.cronx/cronx.config.yaml
```

2. Edit config with your jobs

3. Start daemon:
```bash
cronx start
```

## Configuration

See `cronx.config.example.yaml` for full configuration options.

### Strategies

- **window**: Run once within a time window (e.g., 9-11 AM)
- **interval**: Run every N hours with jitter
- **probabilistic**: Random chance each check interval

### Distribution Types (for window strategy)

- `uniform`: Equal probability across window
- `gaussian`: Bell curve, more likely in middle
- `weighted`: Based on handler activity patterns

## CLI Commands

```bash
cronx start           # Start daemon (foreground)
cronx start --daemon  # Start as background process
cronx status          # Show job status and next runs
cronx list            # List configured jobs
cronx next [job]      # Preview next scheduled times
```

## Environment Variables

- `CRONX_CONFIG`: Path to config file (default: ~/.cronx/cronx.config.yaml)
- `CRONX_GATEWAY_URL`: Gateway URL (can also be set in config)
- `CRONX_SEED`: Random seed for reproducible scheduling (for debugging)

## License

MIT
```

**Step 3: Commit**

```bash
git add cronx.config.example.yaml README.md
git commit -m "docs: add example config and README"
```

---

### Task 15: Final Build & Test

**Step 1: Install dependencies**

```bash
npm install
```

**Step 2: Run all tests**

```bash
npm run test:run
```

Expected: All tests pass

**Step 3: Build**

```bash
npm run build
```

Expected: Clean build with no errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete CRONX v0.1.0 implementation"
```

---

## Summary

This plan implements CRONX in 15 tasks across 6 phases:

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1. Foundation | 1-3 | Types, time utils, random utils |
| 2. Strategies | 4-7 | Window, interval, probabilistic, factory |
| 3. Storage | 8 | SQLite persistence |
| 4. Config & Gateway | 9-10 | YAML loader, HTTP client |
| 5. Core | 11-13 | Job runner, scheduler, CLI |
| 6. Integration | 14-15 | Docs, build, test |

Total estimated: ~3-4 hours of focused implementation.
