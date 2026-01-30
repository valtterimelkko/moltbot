# Step 7-8 Analysis: Root Cause of Gateway Restart

**Date:** 2026-01-30
**Test Message Sent:** ~22:26:33 UTC
**Gateway Shutdown:** 22:26:58 UTC
**Duration:** ~25 seconds

---

## Critical Findings

### 1. The Restart is NOT from Config Reload ❌

**Evidence:**
- Config file last modified: **10:40:06 UTC** (hours before restart)
- Module 1 logging: **NO** config write detected
- Module 2 deferred restart: **NO** "deferring" messages in logs
- SIGUSR1: **NOT** being emitted
- Signal received: **SIGTERM** (not SIGUSR1)

**Conclusion:** The 6-module fix addresses config reload issues, but that's **NOT the actual problem**.

---

### 2. The Restart is NOT from Health Monitor ❌

**Evidence:**
- Health monitor check interval: **5 minutes** (300,000ms)
- Last health check: 22:25:39 UTC
- Next expected check: 22:30:39 UTC (4+ minutes after restart)
- Health monitor logs at 22:25:39: **"✓ Health check passed"**
- Logs at 22:26:58: **NONE** from health monitor

**Conclusion:** Health monitor is NOT involved in this restart.

---

### 3. The Real Problem: SIGTERM During Tool Execution ⚠️

**Timeline:**
```
22:26:33.530Z  → Agent run registered (totalActive=1) ✅
22:26:46.366Z  → First tool starts (exec)
22:26:46.396Z  → First tool ends ✅
22:26:58.891Z  → Second tool starts (exec)
22:26:58.895Z  → SIGTERM received 🔴 (4ms after tool start)
22:26:58.897Z  → Gateway shutting down
22:26:59.000Z  → PM2 restarts gateway
```

**Critical observation:** SIGTERM is sent **4 milliseconds** after the second tool starts executing.

---

### 4. Where is SIGTERM Coming From?

**NOT from:**
- ❌ Config reload system (no config change, no SIGUSR1)
- ❌ Health monitor (doesn't check for 4+ more minutes)
- ❌ PM2 directly (would show in logs)
- ❌ gateway-start.sh (just cleans locks, doesn't send signals)

**Possibilities:**
1. **Something in the second `exec` tool call** is terminating the gateway
2. **External process** is sending SIGTERM
3. **Uncaught exception** causes process to exit
4. **Signal from host OS** (unlikely)

---

## The Problem is NOT What We Fixed

The 6-module fix was designed to handle this scenario:
1. Config file changes
2. File watcher detects change
3. Reload handler emits SIGUSR1
4. Gateway restarts mid-processing

**But the actual problem is:**
1. Something (unknown) sends SIGTERM
2. Gateway receives SIGTERM and shuts down
3. PM2 restarts it
4. Agent never completes

---

## What the Logs DO Show

**Positive signs:**
- Agent run IS being registered (`totalActive=1`) ✅
- Enhanced logging IS active ✅
- First tool executes and completes successfully ✅

**Negative signs:**
- Second tool execution triggers gateway shutdown ❌
- No error message or exception in logs ❌
- Clean SIGTERM shutdown (not a crash) ❌

---

## Next Steps for Investigation

### Step 10A: Check Second Tool Execution

The issue happens specifically when the **second exec tool starts**. Need to:

1. **Find what the second tool is executing:**
   ```bash
   grep -A 5 "tool start:.*tool=exec" /tmp/moltbot/moltbot-2026-01-30.log
   # Look for what command/script is being run
   ```

2. **Check if that command is killing the gateway:**
   - Could be calling `process.exit()`
   - Could be calling `killall moltbot`
   - Could be a server port conflict
   - Could be a resource exhaustion

3. **Enable verbose/debug logging for the exec tool:**
   ```bash
   # This might help see what the tool is doing
   moltbot config set agent.tools.exec.verbose true
   ```

### Step 10B: Trace SIGTERM Source

Add strace or enhanced logging to see what sends SIGTERM:

```bash
# Restart gateway with strace to see signals
strace -e signal=SIGTERM -p <GATEWAY_PID> &

# Or check process parent/child relationships
ps auxf | grep moltbot

# Check what processes are running
lsof | grep moltbot
```

### Step 10C: Check if It's a Port Issue

The second tool might be trying to use port 18789:

```bash
# Monitor port connections during execution
watch -n 0.1 "lsof -i :18789"

# Or use ss
ss -ltnp | grep 18789
```

---

## Hypothesis

**Most likely:** The second `exec` tool is running something that:
1. Tries to start a server on port 18789 (the gateway port)
2. Detects the gateway is already using that port
3. Tries to kill the gateway to free the port
4. Sends SIGTERM to gateway PID

Or alternatively:
1. The exec tool is spawning a subprocess
2. That subprocess is being set up as a process group leader
3. When it exits, it sends SIGTERM to the process group (including parent gateway)

---

## What Module 2 Should Have Caught

If deferred restart logic was working correctly, it should show:

```
[reload] config change requires gateway restart, but deferring (1 active agent run)
```

**But we don't see this because there's NO config change being detected.**

The actual SIGTERM is coming from something else entirely.

---

## Conclusion

**The 6-module fix is good for preventing config-reload restarts, but the actual problem is something different.**

The gateway is being forcefully terminated with SIGTERM when the second exec tool starts. This could be:
- A tool doing something it shouldn't
- A command execution issue
- A port conflict
- An external script/service

**Needs investigation into what the exec tool is running and why it sends SIGTERM.**
