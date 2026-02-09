# CRONX

**Random Job Scheduler for AI Agents**

Makes autonomous agents feel natural, not robotic.
for Blu 💙,  
so that he can feel a little of the "imperfection" of human time

---

## Overview

CRONX is a scheduling system designed specifically for AI agents. Unlike traditional cron schedulers that execute at fixed times, CRONX introduces randomness to make agent behavior feel more human-like and less predictable.

### Key Features

- **Three Scheduling Strategies**: Window, Interval, and Probabilistic
- **Built-in Resilience**: Retry logic with exponential backoff, circuit breaker pattern
- **Gateway Integration**: Sends messages to your AI agent gateway
- **SQLite Persistence**: Tracks job state and execution history
- **Environment Variable Support**: Use `${VAR:-default}` syntax in config
- **TypeScript First**: Full type safety with comprehensive types

---

## Installation

```bash
npm install @rfxlamia/cronx
```

Or with pnpm:

```bash
pnpm add @rfxlamia/cronx
```

---

## Quick Start

### 1. Create Configuration

Create `~/.cronx/cronx.config.yaml`:

```yaml
cronx:
  version: 1
  timezone: "Asia/Jakarta"

  gateway:
    url: "http://127.0.0.1:18789/api/v1/sessions/send"
    sessionKey: "agent:main:main"
    timeout: 30s

  triggerDir: "/root/.cronx/triggers"
  openclawPath: "openclaw"
  defaultRecipient: "+6289648535538"
  cliTimeoutMs: 60000
  writeTimeoutMs: 10000

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
  research:
    description: "Daily AI research"
    strategy: window
    window:
      start: "09:00"
      end: "11:00"
      distribution: weighted
    action:
      message: "Run skill: phd-research"
      deliver: true
    sessionTarget: isolated
    recipient: "+6289648535538"
    thinking: medium
    enabled: true
```

### 2. Start the Scheduler

```bash
# Run in foreground
cronx start

# Run as background daemon
cronx start --daemon
```

### 3. Check Status

```bash
cronx status
```

---

## Scheduling Strategies

### Window Strategy

Execute a job once within a specified time window. The exact execution time is randomly selected within the window.

```yaml
strategy: window
window:
  start: "09:00"      # Window start (HH:MM)
  end: "11:00"        # Window end (HH:MM)
  distribution: weighted  # uniform | gaussian | weighted
```

**Use case**: "Run my research task sometime between 9 AM and 11 AM"

### Interval Strategy

Execute a job at random intervals between a minimum and maximum duration.

```yaml
strategy: interval
interval:
  min: 7200       # Minimum interval in seconds (2 hours)
  max: 14400      # Maximum interval in seconds (4 hours)
  jitter: 0.2     # Additional randomness factor (0-1)
```

**Use case**: "Check emails every 2-4 hours with some variability"

### Probabilistic Strategy

Check at regular intervals and execute based on probability.

```yaml
strategy: probabilistic
probabilistic:
  checkInterval: 3600   # Check every hour (seconds)
  probability: 0.3      # 30% chance to execute
```

**Use case**: "Maybe check social media each hour, but not every time"

---

## CLI Commands

### `cronx start`

Start the scheduler.

```bash
cronx start [options]

Options:
  -d, --daemon       Run as background daemon
  -s, --seed <seed>  Seed for reproducible randomness
  -c, --config <path>  Path to config file
```

### `cronx status`

Show current scheduler and job status.

```bash
cronx status [options]

Options:
  -c, --config <path>  Path to config file
```

### `cronx list`

List all configured jobs.

```bash
cronx list [options]

Options:
  -c, --config <path>  Path to config file
  -e, --enabled       Show only enabled jobs
```

### `cronx next`

Show next scheduled runs for jobs.

```bash
cronx next [job] [options]

Arguments:
  job                 Job name (optional, shows all if not specified)

Options:
  -c, --config <path>  Path to config file
  -n, --count <count>  Number of future runs to show (default: 5)
```

---

## Configuration Reference

### Top-Level Structure

```yaml
cronx:
  version: 1                    # Config version (required)
  timezone: "Asia/Jakarta"      # Default timezone (IANA format)

  gateway:
    url: "http://..."          # Gateway URL
    sessionKey: "agent:main"   # Session key for auth
    timeout: 30s               # Request timeout
  triggerDir: "/root/.cronx/triggers"  # Trigger file directory
  openclawPath: "openclaw"             # OpenClaw CLI binary
  defaultRecipient: "+628..."          # Recipient fallback
  cliTimeoutMs: 60000                  # CLI timeout
  writeTimeoutMs: 10000                # File write timeout

  defaults:
    retry: { ... }             # Default retry config
    circuitBreaker: { ... }    # Default circuit breaker config
    onFailure: notify          # Default failure action

jobs:
  job_name:
    # Job definition
```

### Job Definition

```yaml
job_name:
  description: "Human-readable description"
  tags: [tag1, tag2]           # Optional categorization
  strategy: window             # window | interval | probabilistic

  # Strategy-specific config (one of):
  window: { ... }
  interval: { ... }
  probabilistic: { ... }

  action:
    message: "Message to send"
    priority: normal           # low | normal | high
    deliver: true              # Execute CLI deliver step

  # Optional overrides:
  sessionTarget: isolated      # isolated | main
  recipient: "+628..."
  thinking: medium             # off | minimal | low | medium | high
  retry:
    maxAttempts: 3
    backoff: exponential       # fixed | linear | exponential
    timeout: 30

  circuitBreaker:
    threshold: 5               # Failures before opening
    window: 3600               # Counting window (seconds)
    recoveryTime: 600          # Time before retry (seconds)

  onFailure: notify            # notify | silent | escalate
  enabled: true
```

### Environment Variables

Use shell-style variable substitution:

```yaml
gateway:
  url: "${CRONX_GATEWAY_URL:-http://localhost:8080}"
  sessionKey: "${CRONX_SESSION_KEY}"
```

- `${VAR}` - Use variable value
- `${VAR:-default}` - Use default if not set

---

## Programmatic Usage

### Basic Example

```typescript
import { Scheduler, SQLiteStore, GatewayClient, loadConfigFromFile, configToJobs } from '@rfxlamia/cronx';

// Load configuration
const config = loadConfigFromFile('~/.cronx/cronx.config.yaml');
const jobs = configToJobs(config, { enabledOnly: true });

// Initialize components
const store = new SQLiteStore('~/.cronx/cronx.db');
const gateway = new GatewayClient({
  url: config.cronx.gateway.url,
  sessionKey: config.cronx.gateway.sessionKey,
  timeout: config.cronx.gateway.timeout,
});

// Create and start scheduler
const scheduler = new Scheduler({
  jobs,
  store,
  gateway,
  timezone: config.cronx.timezone,
});

await scheduler.start();
```

### Using Individual Strategies

```typescript
import { WindowStrategy, IntervalStrategy, ProbabilisticStrategy } from '@rfxlamia/cronx/strategies';

// Window strategy
const window = new WindowStrategy({
  start: '09:00',
  end: '11:00',
  timezone: 'Asia/Jakarta',
  distribution: 'weighted',
});
const nextRun = window.calculateNextRun(null);

// Interval strategy
const interval = new IntervalStrategy({
  min: 3600,
  max: 7200,
  jitter: 0.1,
});
const nextInterval = interval.calculateNextRun(Date.now());

// Probabilistic strategy
const prob = new ProbabilisticStrategy({
  checkInterval: 3600,
  probability: 0.3,
});
if (prob.shouldRun()) {
  // Execute job
}
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CRONX_GATEWAY_URL` | Gateway URL for sending messages | - |
| `CRONX_SESSION_KEY` | Session key for authentication | - |
| `CRONX_CONFIG_PATH` | Path to config file | `~/.cronx/cronx.config.yaml` |
| `CRONX_DB_PATH` | Path to SQLite database | `~/.cronx/cronx.db` |
| `CRONX_LOG_LEVEL` | Log level (debug, info, warn, error) | `info` |

---

## Architecture

```
+----------------+     +------------------+
|   Config File  | --> |  Config Loader   |
+----------------+     +------------------+
                              |
                              v
+----------------+     +------------------+     +----------------+
|   Strategies   | --> |    Scheduler     | --> |    Gateway     |
+----------------+     +------------------+     +----------------+
                              |
                              v
                       +------------------+
                       |   SQLite Store   |
                       +------------------+
```

- **Config Loader**: Parses YAML, validates schema, expands environment variables
- **Scheduler**: Core loop that manages job timing and execution
- **Strategies**: Calculate next run times based on configuration
- **Gateway Client**: Sends messages to your AI agent
- **SQLite Store**: Persists job state and execution history

---

## Resilience Features

### Retry with Backoff

Failed jobs are automatically retried with configurable backoff:

- **fixed**: Same delay between retries
- **linear**: Delay increases linearly (delay * attempt)
- **exponential**: Delay doubles each attempt (delay * 2^attempt)

### Circuit Breaker

Prevents cascading failures:

- **Closed**: Normal operation, requests pass through
- **Open**: After threshold failures, requests fail fast
- **Half-Open**: After recovery time, test if service is back

---

## Development

### Building

```bash
npm run build
```

### Testing

```bash
# Run tests
npm test

# Run tests once
npm run test:run

# With coverage
npm run test:coverage
```

### Type Checking

```bash
npm run typecheck
```

---

## License

MIT

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## Roadmap

The following features are planned for future releases:

### v0.2
- **Circuit Breaker Logic**: Database table exists, implementation coming soon
- **Dead Letter Queue**: Store failed jobs for manual review/retry
- **HEARTBEAT.md Parser**: Parse and execute tasks from HEARTBEAT.md files
- **Additional CLI Commands**:
  - `cronx trigger <job>` - Manually trigger a job
  - `cronx disable <job>` - Disable a job
  - `cronx enable <job>` - Enable a job
  - `cronx logs [job]` - View execution logs

### Future
- Web dashboard for monitoring
- Distributed scheduling (multi-node)
- Webhook triggers
- Job dependencies and DAG support
