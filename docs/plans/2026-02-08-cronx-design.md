# CRONX Design Document

> Random job scheduler for AI agents - making autonomous agents feel natural, not robotic.

**Author:** V + Claude
**Date:** 2026-02-08
**Status:** Approved

---

## 1. Overview & Core Concepts

**CRONX** adalah TypeScript library untuk random job scheduling, dirancang khusus untuk AI agents seperti OpenClaw yang butuh behavior natural dan unpredictable.

CRONX is NOT a replacement for system cron — it's a companion for AI-specific scheduling needs.

### Problem Statement

AI agents yang berjalan dengan fixed schedule (setiap 30 menit tepat) terasa robotic. Manusia tidak bekerja dengan presisi jam - kita cek email "sekitar pagi", research "kapan sempat", dan respond "kalau lagi santai".

### Solution

CRONX memberikan 3 randomness strategies:

| Strategy | Use Case | Contoh |
|----------|----------|--------|
| **Random Window** | "Lakukan sekali di rentang waktu ini" | Research antara 09:00-11:00 |
| **Random Interval** | "Lakukan setiap X waktu dengan variasi" | Check email setiap 2-4 jam |
| **Probabilistic** | "Ada X% chance untuk dilakukan" | 30% chance cek social media per jam |

### Core Principles

1. **Natural, not random** - Weighted by handler activity, bukan uniform random
2. **Reliable, not chaotic** - SQLite state, retry logic, circuit breaker
3. **Visible, not black-box** - Human-readable logs di OpenClaw memory
4. **Configurable, not rigid** - Per-job settings, runtime overrides

### Target Users

- OpenClaw AI agents yang butuh proactive behavior
- Handlers yang mau AI agent terasa lebih "alive"
- Developers yang butuh debuggable scheduling
- Self-hosting enthusiasts (OpenClaw typical user base)

---

## 2. Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPS / Server                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐       ┌──────────────┐       ┌─────────────┐ │
│  │    CRONX     │──────▶│   OpenClaw   │──────▶│  AI Agent   │ │
│  │   (Daemon)   │ HTTP  │   Gateway    │       │   (blu)     │ │
│  └──────────────┘       └──────────────┘       └─────────────┘ │
│         │                                             │        │
│         │ read/write                                  │        │
│         ▼                                             ▼        │
│  ┌──────────────┐                            ┌─────────────┐   │
│  │   ~/.cronx/  │                            │  ~/.openclaw│   │
│  │  - cronx.db  │◀───────────────────────────│  /workspace │   │
│  │  - config.yml│      sync state/logs       │  /memory    │   │
│  └──────────────┘                            └─────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| **CRONX Daemon** | Scheduling engine, randomness, state management, triggers |
| **OpenClaw Gateway** | Authentication, routing, message delivery |
| **AI Agent** | Job execution, business logic |
| **~/.cronx/** | SQLite state, config files, detailed logs |
| **~/.openclaw/memory/** | Human-readable state, daily summaries, alerts |

### Process Lifecycle

```
1. CRONX daemon starts
2. Load config.yaml + sync HEARTBEAT.md
3. Calculate next run times (with randomness)
4. Sleep until nearest job
5. Trigger job via Gateway HTTP API
6. Check circuit breaker state
7. Handle response (success/retry/dead-letter)
8. Update state, write logs
9. Loop ke step 4
```

### Key Design Decisions

- **Standalone daemon** - Crash isolation, independent restart
- **HTTP trigger** - Stateless, debuggable, Gateway handles auth
- **SQLite state** - ACID guarantees, survives crash
- **Dual logging** - SQLite untuk query, Markdown untuk visibility

---

## 3. Data Models & Schema

### SQLite Schema (~/.cronx/cronx.db)

```sql
-- Job definitions (synced from config.yaml)
CREATE TABLE jobs (
  name TEXT PRIMARY KEY,
  description TEXT,
  tags JSON,                     -- ["research", "morning"]
  strategy TEXT NOT NULL,        -- 'window', 'interval', 'probabilistic'
  config JSON NOT NULL,          -- strategy-specific params
  enabled BOOLEAN DEFAULT true,
  next_run INTEGER,              -- unix timestamp
  last_run INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

-- Execution history
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  scheduled_at INTEGER,          -- when it was supposed to run
  triggered_at INTEGER,          -- when actually triggered
  completed_at INTEGER,
  duration_ms INTEGER,           -- execution time tracking
  status TEXT,                   -- 'success', 'failed', 'timeout'
  response JSON,                 -- gateway response
  error TEXT,
  attempts INTEGER DEFAULT 1,
  FOREIGN KEY (job_name) REFERENCES jobs(name)
);

-- Runtime overrides (temporary changes)
CREATE TABLE overrides (
  job_name TEXT PRIMARY KEY,
  override_config JSON NOT NULL, -- merged with job config
  reason TEXT,
  created_by TEXT,               -- 'handler', 'agent', 'api'
  expires_at INTEGER,
  created_at INTEGER,
  FOREIGN KEY (job_name) REFERENCES jobs(name)
);

-- Circuit breaker state
CREATE TABLE circuit_breakers (
  job_name TEXT PRIMARY KEY,
  state TEXT DEFAULT 'closed',   -- 'closed', 'open', 'half_open'
  failure_count INTEGER DEFAULT 0,
  last_failure_at INTEGER,
  opened_at INTEGER,
  FOREIGN KEY (job_name) REFERENCES jobs(name)
);

-- Dead letter queue
CREATE TABLE failed_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name TEXT NOT NULL,
  run_id INTEGER,
  failed_at INTEGER,
  error TEXT,
  attempts INTEGER,
  retry_after INTEGER,           -- exponential backoff
  status TEXT DEFAULT 'pending', -- 'pending', 'retried', 'discarded'
  reviewed_at INTEGER,
  reviewed_by TEXT,
  FOREIGN KEY (job_name) REFERENCES jobs(name),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

-- Performance indexes
CREATE INDEX idx_jobs_next_run ON jobs(next_run) WHERE enabled = true;
CREATE INDEX idx_runs_job_time ON runs(job_name, triggered_at);
```

### TypeScript Types

```typescript
// Core types
type Strategy = 'window' | 'interval' | 'probabilistic';
type CircuitState = 'closed' | 'open' | 'half_open';
type RunStatus = 'success' | 'failed' | 'timeout';

interface Job {
  name: string;
  description?: string;
  tags?: string[];
  strategy: Strategy;
  config: WindowConfig | IntervalConfig | ProbabilisticConfig;
  enabled: boolean;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  onFailure?: 'notify' | 'silent' | 'escalate';
}

interface WindowConfig {
  start: string;          // "09:00"
  end: string;            // "11:00"
  timezone: string;       // "Asia/Jakarta"
  distribution: 'uniform' | 'gaussian' | 'weighted';
}

interface IntervalConfig {
  min: number;            // seconds
  max: number;
  jitter: number;         // 0-1, variance percentage
}

interface ProbabilisticConfig {
  checkInterval: number;  // seconds
  probability: number;    // 0-1
}

interface RetryConfig {
  maxAttempts: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  timeout: number;        // seconds
}

interface CircuitBreakerConfig {
  threshold: number;      // failures before opening
  window: number;         // seconds
  recoveryTime: number;   // seconds before half-open
}
```

---

## 4. Randomness Algorithms

### Strategy 1: Random Window (Weighted by Activity)

```typescript
function calculateNextWindowRun(config: WindowConfig): number {
  const { start, end, timezone, distribution } = config;

  // Convert to today's timestamps
  let windowStart = parseTime(start, timezone);
  let windowEnd = parseTime(end, timezone);

  // Handle window in the past (schedule for tomorrow)
  if (windowStart < Date.now()) {
    windowStart += 24 * 60 * 60 * 1000;
    windowEnd += 24 * 60 * 60 * 1000;
  }

  const windowDuration = windowEnd - windowStart;
  let offset: number;

  switch (distribution) {
    case 'uniform':
      offset = Math.random() * windowDuration;
      break;

    case 'gaussian':
      // Box-Muller transform with 3σ resampling
      let z: number;
      do {
        const u1 = Math.random();
        const u2 = Math.random();
        z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      } while (Math.abs(z) > 3); // Resample outliers

      offset = (0.5 + z * 0.15) * windowDuration;
      offset = clamp(offset, 0, windowDuration);
      break;

    case 'weighted':
      const activityWeights = getHandlerActivityWeights(start, end);
      offset = weightedRandom(activityWeights) * windowDuration;
      break;
  }

  return windowStart + offset;
}

function getHandlerActivityWeights(start: string, end: string): number[] {
  // Read from ~/.openclaw/workspace/memory/ logs
  // Analyze when handler is most active
  // Return array of weights per 15-min bucket
  // Default: slightly weighted toward mid-morning
  return [0.05, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05];
}
```

### Strategy 2: Jittered Interval

```typescript
function calculateNextIntervalRun(
  config: IntervalConfig,
  lastRun: number | null
): number {
  const { min, max, jitter } = config;

  // Handle first run
  if (!lastRun) {
    return Date.now() + (Math.random() * (max - min) + min);
  }

  // Base interval (midpoint)
  const baseInterval = (min + max) / 2;

  // Apply jitter: ±jitter% variance
  const variance = baseInterval * jitter;
  const jitteredInterval = baseInterval + (Math.random() * 2 - 1) * variance;

  // Clamp to min-max bounds
  const finalInterval = clamp(jitteredInterval, min, max);

  return lastRun + finalInterval;
}
```

### Strategy 3: Probabilistic

```typescript
function shouldRunProbabilistic(config: ProbabilisticConfig): boolean {
  return Math.random() < config.probability;
}

function probabilisticCheck(job: Job): void {
  if (shouldRunProbabilistic(job.config)) {
    triggerJob(job);
  }
  scheduleCheck(job, job.config.checkInterval);
}
```

### Reproducibility (untuk debugging)

```typescript
import { seedrandom } from 'seedrandom';

function createRng(seed?: string): () => number {
  return seed ? seedrandom(seed) : Math.random;
}

// Usage: cronx start --seed="debug-2026-02-08"
```

---

## 5. Configuration Format

### Primary Config (cronx.config.yaml)

```yaml
# ~/.cronx/cronx.config.yaml

cronx:
  version: 1
  timezone: "Asia/Jakarta"
  gateway:
    url: "${CRONX_GATEWAY_URL:-http://127.0.0.1:18789/api/v1/sessions/send}"
    session_key: "agent:main:main"
    timeout: 30s

  defaults:
    retry:
      max_attempts: 3
      backoff: exponential
    circuit_breaker:
      threshold: 5
      window: 1h
      recovery: 10m
    on_failure: notify

jobs:
  research:
    description: "Daily AI research and learning"
    tags: [learning, morning]
    strategy: window
    window:
      start: "09:00"
      end: "11:00"
      distribution: weighted
    action:
      message: "Run skill: phd-research --topic 'trending AI'"
      priority: normal
    enabled: true

  check_email:
    description: "Periodic email monitoring"
    tags: [communication]
    strategy: interval
    interval:
      min: 2h
      max: 4h
      jitter: 0.2
    action:
      message: "Check gmail for important messages"
      priority: normal

  social_pulse:
    description: "Random social media check"
    tags: [social, optional]
    strategy: probabilistic
    probabilistic:
      check_interval: 1h
      probability: 0.3
    action:
      message: "Quick scan Twitter/X for AI news"
      priority: low
    retry:
      max_attempts: 1
    on_failure: silent
```

### HEARTBEAT.md Integration

```markdown
<!-- ~/.openclaw/workspace/HEARTBEAT.md -->

## Autonomous Operations (Active)
- [x] blu-research-surprise — Research every 5 hours

## CRONX Schedule

| Job | Strategy | Window/Interval | Status |
|-----|----------|-----------------|--------|
| research | window | 09:00-11:00 | enabled |
| check_email | interval | 2-4h | enabled |
| social_pulse | probabilistic | 30%/hour | enabled |

## Quick Commands

- [ ] Run research NOW with topic "Claude 4.6 release"
- [ ] Delay check_email 2 hours

## Status (auto-updated by CRONX)

| Job | Last Run | Next Run | Status |
|-----|----------|----------|--------|
| research | 09:23 today | ~10:15 tomorrow | OK |
| check_email | 11:45 today | ~14:30 today | OK |
| social_pulse | - | checking hourly | 30% chance |
```

### Programmatic Override API

```typescript
// Delay job
cronx.override('research', {
  window: { start: '14:00', end: '16:00' },
  reason: 'Handler requested afternoon schedule',
  expires: 'end_of_day'
});

// Run immediately
cronx.triggerNow('research', {
  context: { topic: 'urgent: new model release' }
});

// Disable temporarily
cronx.disable('social_pulse', {
  until: '2026-02-10',
  reason: 'Focus week - no distractions'
});

// Enable with modified config
cronx.enable('backup_db', {
  override: { interval: { min: '1h', max: '2h' } }
});
```

---

## 6. Implementation Structure

### Project Structure

```
cronx/
├── package.json
├── tsconfig.json
├── cronx.config.example.yaml
│
├── src/
│   ├── index.ts              # Library entry point
│   ├── daemon.ts             # Daemon entry point
│   ├── cli.ts                # CLI commands
│   │
│   ├── core/
│   │   ├── scheduler.ts      # Main scheduling loop
│   │   ├── job-runner.ts     # Job execution & trigger
│   │   └── state-machine.ts  # Job state transitions
│   │
│   ├── strategies/
│   │   ├── index.ts          # Strategy factory
│   │   ├── window.ts         # Random window
│   │   ├── interval.ts       # Jittered interval
│   │   └── probabilistic.ts  # Probabilistic
│   │
│   ├── resilience/
│   │   ├── retry.ts          # Retry with backoff
│   │   ├── circuit-breaker.ts
│   │   └── dead-letter.ts    # Failed job queue
│   │
│   ├── storage/
│   │   ├── sqlite.ts         # SQLite adapter
│   │   ├── memory-sync.ts    # OpenClaw memory integration
│   │   └── migrations/       # DB schema migrations
│   │
│   ├── config/
│   │   ├── loader.ts         # YAML + env parsing
│   │   ├── heartbeat.ts      # HEARTBEAT.md parser
│   │   └── validator.ts      # Config validation (zod)
│   │
│   ├── gateway/
│   │   ├── client.ts         # HTTP client
│   │   ├── health.ts         # Health check endpoint
│   │   └── types.ts          # Request/response types
│   │
│   └── utils/
│       ├── time.ts           # Timezone, DST handling
│       ├── random.ts         # RNG utilities
│       └── logger.ts         # Structured logging + memory sink
│
├── tests/
│   ├── unit/
│   └── integration/
│
└── bin/
    └── cronx
```

### CLI Commands

```bash
# Daemon management
cronx start                    # Start daemon (foreground)
cronx start --daemon           # Start as background process
cronx stop                     # Stop daemon
cronx status                   # Show running jobs, next runs

# Job management
cronx list                     # List all jobs
cronx trigger <job>            # Trigger job immediately
cronx disable <job> [--until]  # Disable job
cronx enable <job>             # Enable job

# Debugging
cronx logs [--job] [--tail]    # View logs
cronx next [job]               # Show next scheduled runs
cronx simulate <job> [--days]  # Simulate schedule for N days
cronx health                   # Health check status
```

### NPM Package

```json
{
  "name": "cronx",
  "version": "0.1.0",
  "description": "Random job scheduler for AI agents",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": {
    "cronx": "./dist/daemon.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "yaml": "^2.3.0",
    "zod": "^3.22.0",
    "chokidar": "^3.5.0",
    "pino": "^8.0.0"
  }
}
```

---

## Next Steps

1. [ ] Initialize TypeScript project with dependencies
2. [ ] Implement core scheduler loop
3. [ ] Implement randomness strategies
4. [ ] Add SQLite storage layer
5. [ ] Build HEARTBEAT.md parser
6. [ ] Add resilience patterns (retry, circuit breaker)
7. [ ] Create CLI interface
8. [ ] Write tests
9. [ ] Documentation & examples

---

*Design approved on 2026-02-08 through collaborative brainstorming session.*
