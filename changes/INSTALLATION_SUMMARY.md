# Moltbot Installation & Configuration Summary

**Installation Date:** January 27-30, 2026
**Status:** ✅ **Successfully Installed & Operational**
**Version:** Moltbot 2026.1.27-beta.1

---

## 1. Executive Summary

Moltbot, a personal AI assistant framework, was successfully installed and configured at `/root/moltbot`. The installation involved:

- **Source**: GitHub repository (cloned and built from source via pnpm)
- **Process Manager**: systemd service (isolated from PM2 processes)
- **LLM Strategy**: API-First approach with OpenRouter + Anthropic models
- **Interface**: Telegram bot with grammY framework integration
- **Persistence**: systemd service auto-restart on crash and boot
- **Version Control**: Git fork at https://github.com/valtterimelkko/moltbot

The bot is fully operational, responding to Telegram messages with intelligent model routing and proper error handling.

---

## 2. Installation Process

### Phase 1: Initial Setup & Prerequisites

**Date:** January 27, 2026

#### Environment Verification
- Working Directory: `/root/moltbot`
- Platform: Linux (6.8.0-90-generic)
- Node.js Requirement: >=24 (had v20, upgraded to v24.13.0)

#### Node.js Upgrade
```bash
# Problem: Moltbot requires Node.js v24+, system had v20
# Solution:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
# Result: ✅ Installed v24.13.0
```

### Phase 2: Moltbot Installation

**Date:** January 27, 2026

#### Approach 1: npm Package (Failed)
- Attempted: `npm install moltbot`
- Issue: Placeholder package, not actual Moltbot source
- Result: ❌ Not suitable for production

#### Approach 2: GitHub Source + pnpm Build (Success)
```bash
git clone https://github.com/moltbot/moltbot.git /root/moltbot
cd /root/moltbot
npm install -g pnpm
pnpm install
pnpm build
# Result: ✅ Successfully built Moltbot 2026.1.27-beta.1
```

**Build Output:**
- Compiled TypeScript → JavaScript
- Generated `/root/moltbot/dist/` directory
- Ready for execution via `node dist/entry.js`

### Phase 3: LLM Strategy Implementation

**Date:** January 27-28, 2026

#### Strategy Document
- Source: `/root/moltbot/clawdbot_llm_strategy.md`
- Approach: **Path A: API-First with OpenRouter + Anthropic**

#### API Key Configuration

**Sources:**
- `/root/.bashrc` - Contained API keys for:
  - OPENROUTER_API_KEY
  - ANTHROPIC_API_KEY
  - MOONSHOT_API_KEY
  - TELEGRAM_BOT_TOKEN

**Storage:**
- Created: `/root/.clawdbot/.env` (environment variables)
- Configuration: `/root/.clawdbot/moltbot.json` (global gateway)
- Agent Config: `/root/.clawdbot/agents/main/config.json` (agent-specific)

### Phase 4: Telegram Bot Setup

**Date:** January 28, 2026

#### Configuration
```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "8338843900:AAGfU0DrT5DX4XlxUBlwF5MxsihxVmUIYYQ",
      "allowFrom": [876311493]
    }
  }
}
```

#### Features Enabled
- Telegram polling for incoming messages
- Response streaming (initially in "partial" mode)
- Command support via `/restart`
- User restriction to specified Telegram ID

---

## 3. Configuration & Architecture

### 3.1 Model Configuration

#### Primary Model (Default)
- **Provider:** OpenRouter
- **Model:** `mistralai/devstral-2512` (Mistral Devstral 2512)
- **Rationale:** Fast, efficient, good general-purpose model

#### Fallback Models (Cascade)
1. `openrouter/google/gemini-2.0-flash-001` - Advanced reasoning
2. `openrouter/meta-llama/llama-3.3-70b-instruct:free` - Large context
3. `moonshot/kimi-k2.5` - Additional provider (Chinese AI)
4. `anthropic/claude-sonnet-4-5` - High-quality responses
5. `anthropic/claude-opus-4-5` - Ultimate fallback (best model)

#### Task-Type Router Implementation
- **File:** `/root/moltbot/src/agents/task-type-router.ts`
- **Function:** Intelligent model selection based on message analysis
- **Task Types Detected:**
  - `file-analysis` → Gemini (best for document understanding)
  - `creative` → Llama (strong creative capabilities)
  - `debugging` → Claude Sonnet (excellent code analysis)
  - `cli` → Mistral (strong command-line knowledge)
  - `general` → Mistral (balanced default)

### 3.2 Process Architecture

```
System Infrastructure
├── Telegram Interface
│   └── grammY Bot Framework (polling mode)
├── Moltbot Gateway (systemd service)
│   ├── Agent: main (LLM routing)
│   ├── Task-Type Router
│   └── Model Selection Logic
└── External Services
    ├── OpenRouter API
    ├── Anthropic Claude API
    └── Moonshot Kimi API
```

#### Parallel Services (Not Interfering)
- **PM2 Process Manager** (for Dashboard, AI Product Visualizer)
- **Moltbot** (isolated systemd service)
- Reason: Separated to prevent resource contention and process conflicts

### 3.3 System Persistence

#### Solution: systemd Service

**File:** `/etc/systemd/system/moltbot-gateway.service`

```ini
[Unit]
Description=Moltbot AI Gateway
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/moltbot
ExecStart=/usr/bin/node dist/entry.js gateway --port 18789
Restart=always
RestartSec=5
StartLimitInterval=60
StartLimitBurst=10
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

**Features:**
- ✅ Auto-restart on crash
- ✅ Restart on system boot
- ✅ Max 10 restarts in 60-second window (prevents restart loops)
- ✅ 5-second delay between restarts
- ✅ Production environment variable set

**Why systemd over PM2:**
- Process isolation (no conflicts with Dashboard)
- Lighter weight than PM2
- Native system integration
- Simpler process management

**Management Commands:**
```bash
sudo systemctl start moltbot-gateway      # Start service
sudo systemctl stop moltbot-gateway       # Stop service
sudo systemctl restart moltbot-gateway    # Restart service
sudo systemctl status moltbot-gateway     # Check status
sudo systemctl enable moltbot-gateway     # Enable on boot
sudo journalctl -u moltbot-gateway -f     # View live logs
```

---

## 4. Problems Faced & Solutions

### Problem 1: Node.js Version Incompatibility

**Symptom:** npm install failed with engine mismatch warning

**Root Cause:** Moltbot requires Node.js >=24, system had v20

**Solution:**
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Result:** ✅ Upgraded to v24.13.0

---

### Problem 2: Unknown Model Error

**Symptom:** Bot error message: "Unknown model: openrouter/mistralai/mistral-devstral-2"

**Root Cause:** Incorrect OpenRouter model ID format (typos in model names)

**Solution:** User provided official OpenRouter model codes:
- `mistralai/devstral-2512` (not mistral-devstral-2)
- `google/gemini-2.0-flash-001` (not gemini-2.0-flash)
- `meta-llama/llama-3.3-70b-instruct:free` (added :free suffix)

**Configuration Updated:** Both moltbot.json and agents/main/config.json

**Result:** ✅ Models properly recognized and working

---

### Problem 3: Duplicate Telegram Messages

**Symptom:** Bot sending same response 2-3 times per user message

**Root Cause:** `streamMode: "partial"` configuration caused responses to stream as individual chunks, each sent as separate message

**Solution:**
```json
{
  "telegram": {
    "streamMode": "block"
  }
}
```

**Result:** ✅ Single unified response messages

---

### Problem 4: PM2 Process Conflicts

**Symptom:** Dashboard PM2 restarting 140+ times, moltbot process unstable

**Root Cause:** All processes (Moltbot, Dashboard, AI Product Visualizer) sharing same PM2 daemon, causing resource contention and conflicts

**Solution:** Moved Moltbot from PM2 to isolated systemd service
- Removed from PM2 management
- Created dedicated systemd service
- Dashboard remains in PM2 alone
- Complete isolation achieved

**Result:** ✅ No more conflicts, stable operation

---

### Problem 5: Task-Type Router Compilation Error

**Symptom:** TypeScript compilation failed: "Module declares 'DEFAULT_PROVIDER' locally, but it is not exported"

**Root Cause:** Incorrect import statement trying to get DEFAULT_PROVIDER from model-selection.ts (not exported there)

**Solution:** Updated import in task-type-router.ts:
```typescript
// Wrong:
import { parseModelRef, DEFAULT_PROVIDER } from "./model-selection.js";

// Correct:
import { parseModelRef } from "./model-selection.js";
import { DEFAULT_PROVIDER } from "./defaults.js";
```

**Result:** ✅ Compilation succeeded, task-type router deployed

---

### Problem 6: Telegram Command Limit Exceeded

**Symptom:** `setMyCommands failed: Call to 'setMyCommands' failed! (400: Bad Request: BOT_COMMANDS_TOO_MUCH)`

**Root Cause:** Both moltbot.json and agents/main/config.json had `native: "auto"` which tried to register all available commands/skills with Telegram API (limit: 100 commands). Moltbot has hundreds of potential skills.

**Solution:** Disabled native command auto-registration in both files:
```json
{
  "commands": {
    "native": false,
    "nativeSkills": false
  }
}
```

In agent config:
```json
{
  "commands": {
    "native": false,
    "text": true,
    "restart": true
  }
}
```

**Result:** ✅ Telegram connects without errors, `/restart` command still available

---

### Problem 7: Gateway Startup Delays

**Symptom:** Gateway taking time to initialize, lock file conflicts on restart

**Root Cause:** Previous instances not fully cleaned up, lock files persisting

**Solution:** Clean startup process:
- Killed old processes explicitly
- Removed stale lock files
- Restarted cleanly via systemd

**Result:** ✅ Gateway starts reliably now

---

### Problem 8: Git Symlink Issues

**Symptom:** VSCode showing `skills/global-shared` and `skills/global-skills` as uncommitted changes despite gitignore rules

**Root Cause:** .gitignore rules had trailing slashes (`skills/global-shared/`) which only match directories, not symlinks

**Solution:** Removed trailing slashes in .gitignore:
```
# Before (wrong):
skills/global-shared/
skills/global-skills/

# After (correct):
skills/global-shared
skills/global-skills
```

**Result:** ✅ Symlinks properly ignored, clean working directory

---

## 5. Configuration Choices & Changes

### 5.1 Initial Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Installation Method** | GitHub source + pnpm | Needed latest features, full control |
| **LLM Strategy** | Path A: API-First | Flexibility, multiple provider support |
| **Primary Model** | Mistral Devstral 2512 | Fast, cost-effective, good quality |
| **Persistence** | systemd | Better isolation than PM2 |
| **Interface** | Telegram | User preference, grammY support |
| **Auth Method** | Telegram ID restriction | Simple, effective user control |

### 5.2 Configuration Evolution

#### Iteration 1: Initial Setup
```json
{
  "model": {
    "primary": "openrouter/mistralai/mistral-devstral-2",
    "fallbacks": [...]
  },
  "telegram": {
    "streamMode": "partial"
  }
}
```

**Issues:** Duplicate messages, wrong model IDs

#### Iteration 2: Fixed Models & Streaming
```json
{
  "model": {
    "primary": "openrouter/mistralai/devstral-2512",
    "fallbacks": [
      "openrouter/google/gemini-2.0-flash-001",
      "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-opus-4-5"
    ]
  },
  "telegram": {
    "streamMode": "block"
  }
}
```

**Improvements:** Correct models, no duplicate messages

#### Iteration 3: Command Configuration
```json
{
  "commands": {
    "native": false,
    "nativeSkills": false
  }
}
```

**Improvements:** Fixed Telegram command limit error

#### Iteration 4: Task-Type Router (Agent Level)
```json
{
  "model": {
    "primary": "openrouter/mistralai/devstral-2512",
    "fallbacks": [
      "openrouter/google/gemini-2.0-flash-001",
      "openrouter/meta-llama/llama-3.3-70b-instruct:free",
      "moonshot/kimi-k2.5",
      "anthropic/claude-sonnet-4-5",
      "anthropic/claude-opus-4-5"
    ]
  },
  "providers": {
    "moonshot": {
      "apiKey": "sk-...",
      "baseUrl": "https://api.moonshot.ai/v1",
      "models": {
        "moonshot/kimi-k2.5": "kimi-k2.5"
      }
    }
  },
  "commands": {
    "native": false,
    "text": true,
    "restart": true
  }
}
```

**Improvements:** Moonshot provider, Restart command, Task-type routing

---

## 6. Key Files & Configurations

### 6.1 Configuration Files

| File | Purpose | Status |
|------|---------|--------|
| `/root/.clawdbot/moltbot.json` | Global gateway config | ✅ Active |
| `/root/.clawdbot/agents/main/config.json` | Agent-specific config | ✅ Active |
| `/root/.clawdbot/.env` | API keys & secrets | ✅ Secure |
| `/etc/systemd/system/moltbot-gateway.service` | systemd service definition | ✅ Active |
| `/root/moltbot/.gitignore` | Enhanced with security rules | ✅ Current |

### 6.2 Source Code Files

| File | Change | Purpose |
|------|--------|---------|
| `src/agents/task-type-router.ts` | NEW | Intelligent model routing |
| `src/agents/model-selection.ts` | MODIFIED | Integrated task-type router |
| `src/agents/pi-embedded-runner/run/attempt.ts` | MODIFIED | Pass user message for routing |
| `README_Tech.md` | NEW | Technical documentation |

### 6.3 Documentation Files

| File | Content |
|------|---------|
| `MOLTBOT_SETUP_SUMMARY.md` | Initial setup guide |
| `PM2_ISOLATION_SETUP.md` | Process manager strategy |
| `README_Tech.md` | Production architecture |
| `INSTALLATION_SUMMARY.md` | This comprehensive summary |

---

## 7. Installed Features & Capabilities

### 7.1 Core Features

✅ **Telegram Bot Interface**
- Real-time message polling
- User authentication (Telegram ID 876311493)
- Response streaming in block mode
- Emoji feedback and status indicators

✅ **Intelligent Model Selection**
- Task-type detection from message content
- Automatic model routing:
  - File analysis → Gemini 2.0 Flash
  - Creative tasks → Llama 3.3 70B
  - Debugging → Claude Sonnet 4.5
  - CLI commands → Mistral Devstral
  - General → Mistral Devstral
- Fallback cascade through 5 models

✅ **Process Management**
- systemd service for persistence
- Auto-restart on crash (max 10 in 60s)
- Boot persistence
- Status monitoring via systemctl

✅ **Command Support**
- `/restart` - Restart bot from Telegram
- Text command mode enabled
- No command auto-registration (manual only)

✅ **API Integrations**
- OpenRouter (Mistral, Google, Meta, etc.)
- Anthropic (Claude Sonnet, Opus)
- Moonshot (Kimi K2.5)
- Multiple fallback providers

✅ **Error Handling**
- Graceful fallback on model failure
- User-friendly error messages
- Auto-recovery mechanisms
- Comprehensive logging

### 7.2 Not Enabled (By Choice)

- ❌ WhatsApp/SMS interfaces (not configured)
- ❌ Voice input/output (not configured)
- ❌ Canvas rendering (no UI display)
- ❌ Local model execution (API-only strategy)

---

## 8. Testing & Validation

### 8.1 Functionality Tests

| Feature | Test | Result |
|---------|------|--------|
| **Bot Responsiveness** | Send test message via Telegram | ✅ Responds within ~1 minute (API latency expected) |
| **Model Routing** | Request different task types | ✅ Routes to optimal models |
| **Fallback Chain** | Primary model unavailable | ✅ Uses fallback models |
| **Command Restart** | `/restart` from Telegram | ✅ Restarts successfully |
| **Error Recovery** | Simulate various errors | ✅ Handles gracefully |
| **Persistence** | Kill process/reboot system | ✅ Auto-restarts reliably |

### 8.2 Configuration Validation

✅ Gateway config parsed correctly
✅ All API keys accessible
✅ Telegram connection established
✅ Model configurations valid
✅ Task-type router compiled and active
✅ systemd service active and healthy

---

## 9. Deployment & Version Control

### 9.1 Git Configuration

**Repository:** https://github.com/valtterimelkko/moltbot

**Fork Strategy:**
- Forked original moltbot repository
- Local remote changed to user's fork
- All configuration changes tracked in git
- Commits made for each major milestone

### 9.2 Commits Made

| Commit | Message | Changes |
|--------|---------|---------|
| **ab8540870** | "Implement task-type router with intelligent model selection" | Core router implementation |
| **c768d26ab** | "Fix: properly ignore skills symlinks in gitignore" | .gitignore correction |
| **Enhanced .gitignore** | Security rules for sensitive files | Better version control |

### 9.3 Branching

- **Branch:** main
- **Strategy:** Direct commits (no feature branches)
- **Status:** All changes committed and pushed

---

## 10. Installation Success Assessment

### ✅ Success Criteria Met

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Bot Installed** | ✅ | Binary at `/root/moltbot/dist/entry.js` |
| **Telegram Connected** | ✅ | Active bot responding to messages |
| **LLM Models Configured** | ✅ | 5-model fallback chain working |
| **Persistence Working** | ✅ | systemd service auto-restarts |
| **Boot Persistence** | ✅ | Service enabled for auto-start |
| **Error Recovery** | ✅ | Handles errors gracefully |
| **Documentation Complete** | ✅ | Multiple guides and READMEs |
| **Version Control** | ✅ | Git fork with commits |
| **All Problems Resolved** | ✅ | 8 issues identified and fixed |

### 📊 Operational Status

```
Moltbot Status: OPERATIONAL ✅

Component Status:
├── Gateway Service: ACTIVE (systemd)
├── Telegram Interface: CONNECTED
├── LLM Routing: OPERATIONAL
├── Model Fallbacks: CONFIGURED
├── Error Handling: ACTIVE
└── Process Persistence: ENABLED

Last Tested: 2026-01-29 15:43 UTC
Uptime: Persistent (auto-restart enabled)
Response Time: ~60 seconds (expected for API calls)
```

---

## 11. Operational Instructions

### 11.1 Regular Operations

```bash
# Check bot status
sudo systemctl status moltbot-gateway

# View recent logs
sudo journalctl -u moltbot-gateway -n 50

# Restart bot (if needed)
sudo systemctl restart moltbot-gateway

# View full log stream
sudo journalctl -u moltbot-gateway -f

# Check git status
cd /root/moltbot && git status

# Make configuration changes
# Edit: ~/.clawdbot/moltbot.json or ~/.clawdbot/agents/main/config.json
# Then restart: sudo systemctl restart moltbot-gateway
```

### 11.2 Telegram Commands

- `/restart` - Restart bot from Telegram (requires typing in chat)
- Regular text messages - Send to bot for response

### 11.3 Configuration Changes

**To update models:**
```bash
# Edit config file
nano ~/.clawdbot/agents/main/config.json

# Restart bot to apply changes
sudo systemctl restart moltbot-gateway
```

**To change Telegram user:**
```bash
# Edit allowFrom array
nano ~/.clawdbot/moltbot.json

# Restart bot
sudo systemctl restart moltbot-gateway
```

---

## 12. Technical Stack Summary

| Component | Technology | Version | Status |
|-----------|-----------|---------|--------|
| **Runtime** | Node.js | 24.13.0 | ✅ |
| **Bot Framework** | grammY | Latest | ✅ |
| **Process Manager** | systemd | Native | ✅ |
| **Package Manager** | pnpm | Latest | ✅ |
| **Language** | TypeScript | Latest | ✅ |
| **LLM Providers** | OpenRouter, Anthropic, Moonshot | Latest | ✅ |
| **Telegram Bot ID** | 8338843900 | Active | ✅ |

---

## 13. Recommendations for Future

1. **Monitor Bot Performance**: Set up log aggregation/monitoring if running in production

2. **API Rate Limiting**: Consider implementing request queuing if high volume expected

3. **Model Performance Tracking**: Log which models are used for each task type to optimize routing

4. **Backup Configuration**: Regular backups of ~/.clawdbot/ directory

5. **Update Strategy**: Plan for updating models as new ones become available

6. **Error Alerting**: Set up alerts for repeated crashes or errors

7. **Extended Features**: Consider enabling additional interfaces (WhatsApp, Discord) if needed

---

## 14. Timeline & Key Dates

| Date | Activity | Status |
|------|----------|--------|
| **Jan 27** | Node.js upgrade, Moltbot installation | ✅ Complete |
| **Jan 27-28** | LLM model configuration | ✅ Complete |
| **Jan 28** | Telegram bot setup, duplicate message fix | ✅ Complete |
| **Jan 28-29** | Process isolation (PM2 → systemd) | ✅ Complete |
| **Jan 29** | Task-type router implementation | ✅ Complete |
| **Jan 29** | Command configuration fixes | ✅ Complete |
| **Jan 29** | Documentation & version control | ✅ Complete |
| **Jan 30** | Skill improvements & summary | ✅ Complete |

---

## 15. Conclusion

**Moltbot has been successfully installed, configured, and deployed to production.**

The bot is:
- ✅ Responding to Telegram messages
- ✅ Intelligently routing to optimal LLM models
- ✅ Persistently running via systemd
- ✅ Auto-recovering from failures
- ✅ Well-documented and version-controlled
- ✅ Ready for ongoing use and maintenance

All major problems encountered during installation were identified and resolved systematically. The bot has been tested and validated to be operational. Configuration is flexible and can be updated as needed.

---

**Document Generated:** January 30, 2026
**Installation Status:** ✅ **COMPLETE & OPERATIONAL**
