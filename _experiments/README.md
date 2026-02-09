# blu Default Cron Configuration Analysis

**Exported:** 2026-02-09 09:21 GMT+8  
**Source:** OpenClaw Gateway Production Environment  
**Purpose:** Reverse engineering for CRONX debugging

---

## Overview

Total Jobs: **9**  
Active: **8** | Disabled: **1**  
Session Target Distribution:
- `isolated`: 7 jobs (run in separate sub-agent sessions)
- `main`: 2 jobs (inject into main session)

---

## Job Categories

### 1. Research & Content Generation

#### blu-research-surprise (ACTIVE)
- **Schedule:** Every 5 hours (`0 */5 * * *`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Thinking:** high
- **Timeout:** 1200s (20 min)
- **Purpose:** Academic-grade research with PDF deliverable
- **Key Actions:**
  - Use phd-research skill
  - Data analysis with pandas/matplotlib
  - PDF conversion via skills/pdf/scripts/md_to_pdf.py
  - WhatsApp delivery to +6289648535538
  - GitHub push

#### Coolhunter Indonesia General News 07:00 (ACTIVE)
- **Schedule:** Daily at 07:00 (`0 7 * * *`)
- **TZ:** Asia/Makassar (WITA)
- **Target:** isolated
- **Thinking:** medium
- **Timeout:** 900s (15 min)
- **Purpose:** Indonesia news trend analysis
- **Key Actions:**
  - Web search (Brave) → Tavily MCP fallback
  - Full article fetch via web_fetch
  - Report generation with fact-check table
  - PDF conversion and WhatsApp delivery

### 2. Maintenance & Housekeeping

#### Memory Maintenance (ACTIVE)
- **Schedule:** Daily at 22:00 (`0 22 * * *`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Purpose:** Curate daily memory into MEMORY.md

#### Daily Git Backup (ACTIVE)
- **Schedule:** Daily at 23:00 (`0 23 * * *`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Purpose:** Auto-commit and push to GitHub

#### Skill Improvement Check (ACTIVE)
- **Schedule:** Monday at 06:00 (`0 6 * * 1`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Purpose:** Review skill usage and suggest improvements

### 3. Monitoring & Alerts

#### GitHub Project Monitor (ACTIVE)
- **Schedule:** Daily at 12:00 (`0 12 * * *`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Purpose:** Check V's GitHub repos for activity

#### Weekly Retro (ACTIVE)
- **Schedule:** Sunday at 20:00 (`0 20 * * 0`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Purpose:** Weekly progress summary

### 4. Development/Debugging

#### Temporary task-status reminder for V (ACTIVE)
- **Schedule:** Every 12 minutes (`everyMs: 720000`)
- **Target:** main (injects into primary session)
- **Purpose:** Proactive status check via HEARTBEAT.md

#### bluAdventure Experiment - Time Perception (DISABLED)
- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **TZ:** Asia/Jakarta
- **Target:** isolated
- **Status:** Was active during CRONX experiment, now disabled

---

## Key Patterns for CRONX

### 1. Session Target Strategy
- **isolated:** Heavy tasks (research, long-running) → separate context
- **main:** Quick checks/status updates → same context as user

### 2. Payload Types
- `agentTurn`: Run agent with message (isolated only)
- `systemEvent`: Inject text into session (main only)

### 3. Delivery Modes
- `announce`: Send result back to requester chat
- `none`: Silent execution

### 4. Timezone Handling
- Asia/Jakarta (WIB): Most jobs
- Asia/Makassar (WITA): Coolhunter (07:00 WITA = 06:00 WIB)

### 5. Skill Integration
All research jobs rely on external skills:
- `phd-research`: Research workflow
- `coolhunter`: News analysis
- `tinkering`: Experiment sandbox
- `pdf`: Report conversion

### 6. External Dependencies
- **WhatsApp:** +6289648535538
- **GitHub:** bluworkspace/bluWorld
- **MCP:** Tavily (fallback search)
- **Scripts:** skills/pdf/scripts/md_to_pdf.py

---

## Debugging Notes

### What Works
1. Cron scheduling is stable (no missed runs)
2. Isolated sessions properly spawn sub-agents
3. PDF generation and WhatsApp delivery work
4. GitHub push automation reliable

### Potential Issues
1. **Tavily fallback dependency:** If mcporter.json missing, search fails
2. **Session timeout:** Long research jobs (20min) may hit timeout
3. **Timezone confusion:** Makassar vs Jakarta for Coolhunter
4. **Delivery mode:** `announce` requires active channel connection

### For CRONX Implementation
1. Need file-based trigger support (not just cron expressions)
2. Consider timezone override per-job
3. Handle skill loading gracefully
4. Support both isolated and main session targets

---

## Related Files
- `blu-default-crons-export.json` - Full JSON export
- OpenClaw config: `/root/.openclaw/workspace/config/mcporter.json`
- Skills: `/root/.openclaw/workspace/skills/`
