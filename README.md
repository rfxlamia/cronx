# CRONX

**Probabilistic Job Scheduler for AI Agents** *(Beta)*

Makes autonomous agents feel natural, not robotic.  
*for Blu 💙, so that he can feel a little of the "imperfection" of human time*

---

## ⚠️ CURRENT STATUS: Beta

CRONX is **experimental software**. The following features are **NOT fully implemented**:

| Feature | Status | Notes |
|---------|--------|-------|
| **Probabilistic strategy** | ✅ Working | Fully tested with FileBridge |
| **Circuit breaker** | ⚠️ Partial | Database table exists, logic NOT implemented |
| **HTTP Gateway delivery** | ❌ Broken | Timeout issues, do NOT use |
| **Native daemon mode** | ❌ Non-persistent | Dies when session closes |
| **Window strategy** | ⚠️ Manual setup | Requires database enable |
| **Interval strategy** | ⚠️ Manual setup | Requires database enable |

**Recommendation:** Use **Probabilistic + FileBridge only** for production.

---

## Overview

CRONX is a scheduling system designed specifically for AI agents. Unlike traditional cron schedulers that execute at fixed times, CRONX introduces randomness to make agent behavior feel more human-like and less predictable.

### What Actually Works

- **Probabilistic Strategy**: 50/50, 30/70, or any probability-based execution
- **FileBridge Mode**: Write trigger files (no HTTP exposure, no timeout)
- **SQLite Persistence**: Tracks job state and execution history
- **Retry with Backoff**: Exponential backoff for failed operations
- **TypeScript First**: Full type safety with comprehensive types

---

## Installation

```bash
npm install @rfxlamia/cronx
```

Or clone from source:

```bash
git clone https://github.com/bluworkspace/cronx.git
cd cronx && npm install && npm run build
```

---

## Quick Start (Probabilistic + FileBridge Only)

### 1. Create Configuration

Create `~/.cronx/my-job.yaml`:

```yaml
cronx:
  version: 1
  timezone: "Asia/Jakarta"

  # FileBridge config — NO gateway, NO defaultRecipient
  triggerDir: "/root/.cronx/triggers"
  openclawPath: "openclaw"
  cliTimeoutMs: 60000
  writeTimeoutMs: 10000

jobs:
  my_probabilistic_job:
    description: "Run with 50% chance every hour"
    strategy: probabilistic
    probabilistic:
      checkInterval: 3600   # Check every hour
      probability: 0.5      # 50% chance to execute
    action:
      message: "Do something!"
    enabled: true
```

**⚠️ DO NOT add:**
- `gateway` section (will timeout)
- `defaultRecipient` (will timeout)
- `deliver: true` (will timeout)

### 2. Enable Job in Database (CRITICAL)

```bash
sqlite3 ~/.cronx/cronx.db "INSERT OR REPLACE INTO jobs (name, enabled, created_at, updated_at) VALUES ('my_probabilistic_job', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);"
```

Without this step, job shows `[disabled]` and won't run.

### 3. Start with tmux (Required for Persistence)

```bash
# Create tmux session
tmux new-session -d -s cronx "cronx start --config ~/.cronx/my-job.yaml"

# Or run foreground for testing
cronx start --config ~/.cronx/my-job.yaml
```

**Note:** `--daemon` flag does NOT persist across session closes. Use tmux.

### 4. Verify

```bash
cronx status --config ~/.cronx/my-job.yaml
cronx next --config ~/.cronx/my-job.yaml
```

---

## Scheduling Strategies

### Probabilistic Strategy (✅ Fully Working)

Check at regular intervals and execute based on probability.

```yaml
strategy: probabilistic
probabilistic:
  checkInterval: 3600   # Check every hour (seconds)
  probability: 0.5      # 50% chance to execute
```

**Use case:** "Maybe check social media each hour, but not every time"

**Real-world behavior:** Expect clustering (multiple triggers close together) and gaps (long periods without triggers). This is genuine randomness, not evenly distributed.

### Window Strategy (⚠️ Manual Setup Required)

Execute a job once within a specified time window.

```yaml
strategy: window
window:
  start: "09:00"      # Window start (HH:MM)
  end: "11:00"        # Window end (HH:MM)
  distribution: weighted  # uniform | gaussian | weighted
```

**Use case:** "Run my research task sometime between 9 AM and 11 AM"

**Setup required:**
```bash
sqlite3 ~/.cronx/cronx.db "INSERT OR REPLACE INTO jobs (name, enabled) VALUES ('job_name', 1);"
```

### Interval Strategy (⚠️ Manual Setup Required)

Execute a job at random intervals between a minimum and maximum duration.

```yaml
strategy: interval
interval:
  min: 7200       # Minimum interval (2 hours)
  max: 14400      # Maximum interval (4 hours)
  jitter: 0.2     # Additional randomness (0-1)
```

**Use case:** "Check emails every 2-4 hours with some variability"

**Setup required:** Same as Window strategy — enable in database.

---

## CLI Commands

### `cronx start`

Start the scheduler.

```bash
# Run in foreground (debugging)
cronx start --config ~/.cronx/my-job.yaml

# Run with tmux (persistence)
tmux new-session -d -s cronx "cronx start --config ~/.cronx/my-job.yaml"

# ⚠️ Daemon mode exists but NOT persistent across session closes
cronx start --daemon --config ~/.cronx/my-job.yaml
```

### `cronx status`

Show current scheduler and job status.

```bash
cronx status --config ~/.cronx/my-job.yaml
```

### `cronx list`

List all configured jobs.

```bash
cronx list --config ~/.cronx/my-job.yaml
```

### `cronx next`

Show next scheduled runs.

```bash
cronx next --config ~/.cronx/my-job.yaml
```

---

## Configuration Reference

### Minimal Working Config (Probabilistic)

```yaml
cronx:
  version: 1
  timezone: "Asia/Jakarta"
  triggerDir: "/root/.cronx/triggers"
  openclawPath: "openclaw"
  cliTimeoutMs: 60000
  writeTimeoutMs: 10000

jobs:
  job_name:
    description: "Description"
    strategy: probabilistic
    probabilistic:
      checkInterval: 3600
      probability: 0.5
    action:
      message: "Message to agent"
    enabled: true
```

### Environment Variables

Use shell-style variable substitution:

```yaml
triggerDir: "${CRONX_TRIGGER_DIR:-/root/.cronx/triggers}"
```

- `${VAR}` — Use variable value
- `${VAR:-default}` — Use default if not set

---

## Architecture

```
+----------------+     +------------------+
|   Config File  | --> |  Config Loader   |
+----------------+     +------------------+
                              |
                              v
+----------------+     +------------------+     +----------------+
|   Strategies   | --> |    Scheduler     | --> |   FileBridge   |
+----------------+     +------------------+     +----------------+
                              |
                              v
                       +------------------+
                       |   SQLite Store   |
                       +------------------+
```

- **Config Loader**: Parses YAML, validates schema
- **Scheduler**: Core loop that manages job timing
- **FileBridge**: Writes trigger files (working path)
- **SQLite Store**: Persists job state

**Gateway Client** exists in code but has timeout issues. Not recommended.

---

## Common Issues

### "OpenClaw CLI timeout after 60000ms"

**Cause:** CRONX tried to use HTTP Gateway or CLI delivery.

**Fix:** Remove `gateway` section and `defaultRecipient` from config. Use FileBridge only.

### Job shows `[disabled]`

**Cause:** Job not in SQLite database.

**Fix:**
```bash
sqlite3 ~/.cronx/cronx.db "INSERT OR REPLACE INTO jobs (name, enabled) VALUES ('job_name', 1);"
```

### Scheduler dies when I close terminal

**Cause:** `--daemon` flag doesn't actually persist.

**Fix:** Use tmux:
```bash
tmux new-session -d -s cronx "cronx start --config ~/.cronx/my-job.yaml"
```

### "next at Never" for window/interval jobs

**Cause:** Job not enabled in database, can't calculate next run.

**Fix:** Enable in database (see above).

---

## Limitations & Roadmap

### Current Limitations

1. **HTTP Gateway**: Timeout issues, unreliable
2. **Circuit Breaker**: Database schema exists, logic not implemented
3. **Daemon Mode**: Non-persistent, requires tmux workaround
4. **Window/Interval**: Require manual database setup

### Roadmap

#### v0.2 (Planned)
- Fix circuit breaker logic implementation
- Add persistent daemon mode
- Simplify window/interval database setup
- Dead letter queue for failed jobs

#### Future
- Web dashboard
- Distributed scheduling
- Webhook triggers

---

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm test
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

## Acknowledgments

Built for Blu 💙 — so AI agents can feel a little of the beautiful imperfection of human time.
