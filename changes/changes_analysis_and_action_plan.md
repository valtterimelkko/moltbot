# Analysis: Why Proposed Alternatives Won't Work

**Date:** 2026-01-30
**System:** Linux VPS (Ubuntu)
**Problem Status:** PERSISTS after 6-module fix implementation
**Symptom:** Bot stops responding after ~27 seconds during message processing

---

## Why Each Alternative Won't Solve This

### ❌ Option 1: Change Telegram Bot ID

**Why it won't work:**
- Root cause is NOT Telegram queue buildup
- The issue is gateway-level: config file changes → SIGUSR1 signal → restart during processing
- Telegram's message queue lives on Telegram's servers, not your bot
- A new bot ID would have the exact same restart behavior
- The ~27 second pattern indicates interrupt during tool execution, not queue overflow

**Evidence from logs (README_Tech.md):**
```
21:20:35  →  Message received
21:20:36  →  Agent starts processing
21:20:49  →  First tool completes
21:21:02  →  Second tool starts (+7ms: SIGUSR1 received) ← INTERRUPTION
21:21:06  →  Gateway restarts, response LOST
```

This is a deterministic interruption pattern, not queue congestion.

---

### ❌ Option 2: Switch to Discord

**Why it won't work:**
- The restart issue affects the **gateway**, which is channel-agnostic
- Both Telegram and Discord use the same:
  - PM2 process manager
  - Config reload system (`src/gateway/config-reload.ts`)
  - Agent queue (`session:<key>` lanes)
  - File watcher (chokidar on `/root/.clawdbot/moltbot.json`)
- The SIGUSR1 signal is emitted by `src/gateway/server-reload-handlers.ts` regardless of channel

**What would happen:**
- You'd get the exact same restart behavior on Discord
- After ~27 seconds of processing, Discord bot would also stop mid-response

**When Discord WOULD make sense:**
- Better UX with slash commands
- After fixing the restart issue
- Not as a fix, but as a channel preference

---

### ❌ Option 3: Remote Gateway (Not Applicable)

**Why it's not applicable:**
- You're already on a Linux VPS (Ubuntu)
- There's no macOS app involved that could be writing config incorrectly
- "Remote gateway" means running the gateway on a different machine
- You don't have another machine to run it on
- The OpenClaw docs mention remote gateway as an option for users who want to run on a server while controlling from desktop - you're already running on a server

**Clarification:**
- Your current setup IS what a "remote gateway" would look like for desktop users
- The issue is on the gateway server itself (where you are now)

---

### ✅ PM2 Is Fine (Keep It)

**Current PM2 config is already well-hardened:**
```javascript
{
  watch: false,           // ✅ No double-reload loops
  kill_timeout: 10000,    // ✅ Graceful shutdown
  max_restarts: 10,       // ✅ Prevents restart storms
  max_memory_restart: '1G'  // ✅ Memory limit
}
```

**Alternative: systemd**
- Would be slightly simpler (no PM2 daemon overhead)
- But won't fix the restart issue
- Save this for later optimization

---

## Why the 6-Module Fix Didn't Work

The fix was well-designed and comprehensive, but something is preventing the **deferred restart logic** from triggering.

**What SHOULD happen (Module 2 implementation):**
```typescript
// src/gateway/config-reload.ts:312-345
if (activeRunCount > 0) {
  opts.log.warn(`deferring (${activeRunCount} active runs)`);
  queuedReloadPlan = plan;  // Queue restart for later
  return;  // Don't restart now
}
```

**What's ACTUALLY happening:**
```
21:21:02 → SIGUSR1 signal received (active runs: 1) ← Gateway restarting anyway!
```

**Possible root causes:**
1. ❌ Agent runs not being registered correctly
2. ❌ Config writes happening faster than debounce window
3. ❌ Deferred restart logic has a bug
4. ❌ Multiple config write sources overwhelming the system
5. ❌ SIGUSR1 coming from a different source (not config reload)

---

# Concrete Sequential Action Plan

## Objective
Debug why the deferred restart logic (Module 2) is not preventing restarts during active agent runs.

---

## Step 1: Verify Enhanced Logging Is Active

**Goal:** Confirm Module 1 logging enhancements are working

**Commands:**
```bash
cd /root/moltbot

# Check if enhanced logging exists in code
grep -n "agent run registered" src/infra/agent-events.ts
grep -n "deferring.*active agent run" src/gateway/config-reload.ts
grep -n "writing config file (source:" src/config/io.ts
```

**Expected output:**
- Should find log statements added in Module 1

**If NOT found:**
→ The Module 1 code changes didn't make it into dist/
→ Need to rebuild: `pnpm build`

---

## Step 2: Rebuild and Restart Gateway

**Goal:** Ensure latest code (Modules 1-6) is running

**Commands:**
```bash
cd /root/moltbot

# Rebuild from source
pnpm build

# Restart gateway
pm2 restart moltbot-gateway

# Verify new process started
pm2 status
```

**Expected output:**
```
┌─────┬──────────────────────┬─────────┬─────────┬──────────┐
│ id  │ name                 │ status  │ restart │ uptime   │
├─────┼──────────────────────┼─────────┼─────────┼──────────┤
│ 0   │ moltbot-gateway      │ online  │ <count> │ 0s       │
└─────┴──────────────────────┴─────────┴─────────┴──────────┘
```

**Note:** Restart count will increment by 1

---

## Step 3: Clear Old Logs

**Goal:** Start with clean log files for easier analysis

**Commands:**
```bash
# Backup old logs
mv /tmp/moltbot/moltbot-2026-01-30.log /tmp/moltbot/moltbot-2026-01-30.log.backup || true
mv /tmp/moltbot/pm2-out.log /tmp/moltbot/pm2-out.log.backup || true

# PM2 will recreate logs automatically
pm2 restart moltbot-gateway

# Verify new logs exist
ls -lah /tmp/moltbot/*.log
```

---

## Step 4: Monitor Config File Writes in Real-Time

**Goal:** Detect when config file is being modified

**Commands:**
```bash
# In a separate terminal/tmux pane, start file watcher
inotifywait -m -e modify,close_write /root/.clawdbot/moltbot.json 2>&1 | while read line; do
  echo "[$(date '+%H:%M:%S.%3N')] CONFIG WRITE: $line"
done
```

**Keep this running in background**

---

## Step 5: Monitor Application Logs in Real-Time

**Goal:** Watch for agent run lifecycle and restart events

**Commands:**
```bash
# In another terminal/tmux pane, tail application logs
tail -f /tmp/moltbot/moltbot-*.log | grep -E --line-buffered "(agent run|config change|SIGUSR1|deferred|writing config|reload)"
```

**Expected log patterns from Module 1:**
```
[agent] agent run registered: <runId> (total active: 1)
[reload] config change detected; evaluating reload
[reload] config change requires gateway restart, but deferring (1 active agent run: <runId>)
[agent] agent run cleared: <runId> (remaining active: 0)
[reload] applying queued gateway restart
```

**Keep this running in background**

---

## Step 6: Send Test Message

**Goal:** Trigger the issue while monitoring logs

**Commands:**
```bash
# Send test message to Telegram bot
# (Use your Telegram app to send "hi" or any message)
```

**What to watch in log monitors:**
1. **File watcher (Step 4):** Any config writes during 0-30 seconds?
2. **App logs (Step 5):** Agent run registration? Deferred restart message?

---

## Step 7: Capture Full Event Timeline

**Goal:** Get complete picture of what happened

**Commands:**
```bash
# After message completes (or fails), review full logs
cd /tmp/moltbot

# Get timestamp of last message
LAST_MSG_TIME=$(grep -E "embedded run start" moltbot-*.log | tail -1 | jq -r '.date')

echo "Last message started at: $LAST_MSG_TIME"

# Extract all events within 60 seconds of that message
grep -E "($LAST_MSG_TIME|agent run|config|SIGUSR1|reload)" moltbot-*.log | tail -50

# Check PM2 logs for reload events
grep -E "reload|SIGUSR1|restart" pm2-out.log | tail -20
```

**Save output to file:**
```bash
# Dump full timeline to analysis file
{
  echo "=== CONFIG FILE WRITES ==="
  echo "(see Step 4 output)"
  echo ""
  echo "=== APPLICATION LOGS ==="
  grep -E "($LAST_MSG_TIME|agent run|config|SIGUSR1|reload)" moltbot-*.log | tail -50
  echo ""
  echo "=== PM2 LOGS ==="
  grep -E "reload|SIGUSR1|restart" pm2-out.log | tail -20
} > /root/moltbot/changes/debug_timeline_$(date +%Y%m%d_%H%M%S).txt
```

---

## Step 8: Analyze Timeline for Root Cause

**Goal:** Identify what's triggering the restart

**Questions to answer from logs:**

1. **Was agent run registered?**
   - Look for: `[agent] agent run registered: <runId> (total active: 1)`
   - If NOT found → Module 2 registration is broken

2. **Was config file modified?**
   - Look at Step 4 file watcher output
   - If YES → What process modified it? (check timestamp)

3. **Did deferred restart logic trigger?**
   - Look for: `deferring (1 active agent run: <runId>)`
   - If NOT found → Deferred restart logic didn't activate

4. **What triggered SIGUSR1?**
   - Look for: `emitting SIGUSR1 for gateway restart (active runs: X)`
   - Check value of X - should be 0 if deferred worked, 1 if broken

5. **When did agent run clear?**
   - Look for: `[agent] agent run cleared: <runId>`
   - Compare timestamp to SIGUSR1 timestamp
   - If cleared AFTER SIGUSR1 → restart interrupted the run

**Create analysis summary:**
```bash
cat > /root/moltbot/changes/step8_analysis.md <<'EOF'
# Step 8 Analysis Results

## 1. Agent Run Registration
- [ ] Agent run WAS registered
- [ ] Agent run was NOT registered

Evidence:
```
(paste log line here)
```

## 2. Config File Modifications
- [ ] Config file WAS modified during processing
- [ ] Config file was NOT modified

Evidence:
```
(paste inotifywait output here)
```

## 3. Deferred Restart Logic
- [ ] Deferred restart DID trigger
- [ ] Deferred restart did NOT trigger

Evidence:
```
(paste log line here)
```

## 4. SIGUSR1 Source
Active runs at time of SIGUSR1: _____

Evidence:
```
(paste log line here)
```

## 5. Timeline Comparison
Agent registered at: _____
SIGUSR1 emitted at: _____
Agent cleared at: _____

## Conclusion
The root cause appears to be: _____________________

EOF
```

Fill in the checkboxes and blanks based on log analysis.

---

## Step 9: Decision Point - Root Cause Identified

Based on Step 8 analysis, determine which scenario matches:

### Scenario A: Agent run NOT registered
**Symptom:** No log line: `agent run registered`

**Root cause:** Module 2 registration not working for this code path

**Next step:** → Go to **Step 10A**

---

### Scenario B: Config writes during processing
**Symptom:** inotifywait shows config modification at ~27 seconds

**Root cause:** Something is writing config file repeatedly

**Next step:** → Go to **Step 10B**

---

### Scenario C: Deferred restart NOT triggered
**Symptom:** Logs show `emitting SIGUSR1 (active runs: 1)` instead of `deferring`

**Root cause:** Deferred restart logic has a bug or condition is wrong

**Next step:** → Go to **Step 10C**

---

### Scenario D: Multiple rapid config changes
**Symptom:** Multiple config writes within 2-second debounce window

**Root cause:** Debounce not working or too short

**Next step:** → Go to **Step 10D**

---

## Step 10A: Fix Agent Run Registration

**Goal:** Ensure agent runs are tracked correctly

**Commands:**
```bash
cd /root/moltbot

# Find where agent runs start but don't register
# Check all code paths that invoke the agent
grep -rn "runAgent\|agent-runner-execution\|embedAgentRun" src/ --include="*.ts" | grep -v ".test.ts"
```

**Review each entry point:**
```bash
# Check if registerAgentRunContext is called BEFORE agent execution
# Look for pattern:

# ✅ GOOD:
registerAgentRunContext(runId, { ... });
try {
  // agent execution
} finally {
  clearAgentRunContext(runId);
}

# ❌ BAD:
// agent execution (no registration!)
```

**Find missing registration:**
```bash
# Channels that might miss registration
grep -A 10 "async.*handle.*message" src/telegram/monitor.ts src/discord/accounts.ts

# Auto-reply that might miss registration
grep -A 10 "async.*executeAgentRun" src/auto-reply/reply/agent-runner-execution.ts
```

**Fix location:**
If found, add registration to the entry point that's missing it.

**After fix:**
```bash
pnpm build
pm2 restart moltbot-gateway
# Go back to Step 6 and test again
```

---

## Step 10B: Identify Config Write Source

**Goal:** Find what process is writing config file

**Commands:**
```bash
# Check enhanced logging from Module 1.1
grep "writing config file (source:" /tmp/moltbot/moltbot-*.log

# Expected format:
# [config] writing config file (source: at functionName (/path/to/file.ts:123))
```

**Common sources to investigate:**

1. **Gateway initialization:**
   ```bash
   grep "at loadConfig\|at startGatewayServer" /tmp/moltbot/moltbot-*.log
   ```
   - If found during message processing → Bug in init logic

2. **Validation/defaults:**
   ```bash
   grep "at validateConfigObjectWithPlugins\|at applyModelDefaults" /tmp/moltbot/moltbot-*.log
   ```
   - If found → Config normalization re-writing file

3. **External process:**
   ```bash
   # Check if anything else is touching the file
   lsof /root/.clawdbot/moltbot.json
   ```

**If external process found:**
- Kill it: `kill -9 <PID>`
- Identify what it is: `ps aux | grep <PID>`

**If internal write found:**
- Review the source file at the line number
- Add a check: only write if config actually changed (Module 4 should have this)
- Verify checksum logic is working

**After fix:**
```bash
pnpm build
pm2 restart moltbot-gateway
# Go back to Step 6 and test again
```

---

## Step 10C: Fix Deferred Restart Logic

**Goal:** Debug why deferral condition isn't met

**Commands:**
```bash
cd /root/moltbot

# Check deferred restart implementation
cat src/gateway/config-reload.ts | grep -A 20 "activeRunCount.*>"
```

**Verify logic:**
```typescript
// Should look like:
const activeRunCount = getActiveAgentRunCount();

if (activeRunCount > 0) {
  const runIds = getActiveAgentRunIds();
  opts.log.warn(
    `config change requires gateway restart, but deferring (${activeRunCount} active agent run${activeRunCount === 1 ? "" : "s"}: ${runIds.join(", ")})`
  );

  // CRITICAL: Must queue the restart
  queuedReloadPlan = plan;
  queuedReloadConfig = nextConfig;

  return;  // CRITICAL: Must return early
}

// If we reach here, no active runs → safe to restart
authorizeGatewaySigusr1Restart();
process.emit("SIGUSR1");
```

**Check if condition is evaluated:**
```bash
# Add temporary debug logging
# Edit src/gateway/config-reload.ts and add:

const activeRunCount = getActiveAgentRunCount();
console.error(`[DEBUG] activeRunCount=${activeRunCount}, runContextById.size=${runContextById.size}`);

if (activeRunCount > 0) {
  // ... existing code
```

**Rebuild and test:**
```bash
pnpm build
pm2 restart moltbot-gateway
# Send test message
# Check PM2 error log for debug output:
tail -f /tmp/moltbot/pm2-error.log | grep DEBUG
```

**If activeRunCount is 0 when it should be 1:**
→ Registration issue (Go back to Step 10A)

**If activeRunCount is 1 but still restarting:**
→ The condition is being bypassed somehow
→ Check for multiple reload handlers
→ Check for direct SIGUSR1 emissions elsewhere

---

## Step 10D: Increase Debounce and Investigate Write Loop

**Goal:** Handle rapid config changes

**Commands:**
```bash
cd /root/moltbot

# Check current debounce setting
grep "debounceMs:" src/gateway/config-reload.ts

# Should be 2000 after Module 3
# If still 300, Module 3 didn't apply
```

**Increase debounce further:**
```typescript
// Edit src/gateway/config-reload.ts
const DEFAULT_RELOAD_SETTINGS: Required<GatewayReloadSettings> = {
  mode: "hybrid",
  debounceMs: 5000,  // Increase to 5 seconds
};
```

**Increase awaitWriteFinish:**
```typescript
// In createGatewayConfigReloader function
const watcher = chokidar.watch(opts.watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 3000,  // Increase to 3 seconds
    pollInterval: 100,
  },
  // ...
});
```

**Rebuild and test:**
```bash
pnpm build
pm2 restart moltbot-gateway
# Go back to Step 6 and test again
```

**If still happening:**
→ Multiple processes writing config in a loop
→ Need to identify ALL write sources (back to Step 10B)
→ Consider disabling config reload entirely as emergency measure:
```bash
moltbot config set gateway.reload.mode off
pm2 restart moltbot-gateway
```

---

## Step 11: Emergency Workaround (If All Else Fails)

**Goal:** Get bot working again while investigating

**Option 1: Disable Config Reload**
```bash
moltbot config set gateway.reload.mode off
pm2 restart moltbot-gateway
```

**Trade-off:**
- ✅ Bot will stop restarting during messages
- ❌ Config changes require manual restart
- ⚠️ Must restart gateway after any config change: `pm2 restart moltbot-gateway`

---

**Option 2: Increase Debounce to Extreme**
```bash
# Edit /root/.clawdbot/moltbot.json
# Add:
{
  "gateway": {
    "reload": {
      "debounceMs": 30000  // 30 seconds
    }
  }
}

pm2 restart moltbot-gateway
```

**Trade-off:**
- ✅ Gives messages time to complete before restart
- ❌ Config changes take 30 seconds to apply
- ⚠️ Doesn't fix root cause, just buys time

---

**Option 3: Run Without PM2 (Direct Node Process)**
```bash
# Stop PM2
pm2 delete moltbot-gateway

# Run directly (in tmux or screen session)
cd /root/moltbot
node dist/entry.js gateway --port 18789 --verbose 2>&1 | tee /tmp/moltbot-direct.log

# In a separate tmux pane, send test message
```

**Trade-off:**
- ✅ Simpler, no PM2 interference
- ❌ No auto-restart on crash
- ❌ Logs not managed by PM2
- ⚠️ Temporary for debugging only

---

## Step 12: Report Findings

**Goal:** Document what was found for further investigation

**Commands:**
```bash
# Collect all debug outputs
cat > /root/moltbot/changes/investigation_report.md <<'EOF'
# Investigation Report: Gateway Restart Loop

**Date:** $(date)
**System:** Linux VPS (Ubuntu)

## Problem Confirmed
Bot stops responding after ~27 seconds. Same pattern as before Module 1-6 fixes.

## Steps Executed
- [ ] Step 1: Verified enhanced logging
- [ ] Step 2: Rebuilt and restarted
- [ ] Step 3: Cleared logs
- [ ] Step 4-6: Monitored and tested
- [ ] Step 7: Captured timeline
- [ ] Step 8: Analyzed root cause
- [ ] Step 9-10: Applied fix for scenario: _____
- [ ] Step 11: Emergency workaround applied? _____

## Root Cause Found
(Paste Step 8 analysis here)

## Fix Applied
(Describe what was changed)

## Result After Fix
- [ ] Bot now responds correctly
- [ ] Issue persists
- [ ] New issue emerged: _____

## Next Steps
(What to try next)

EOF
```

Fill in the report and save.

---

## Summary of Sequential Steps

1. ✅ Verify enhanced logging exists in code
2. ✅ Rebuild and restart gateway
3. ✅ Clear old logs
4. ✅ Monitor config file writes (background)
5. ✅ Monitor application logs (background)
6. ✅ Send test message
7. ✅ Capture full event timeline
8. ✅ Analyze timeline to identify root cause
9. ✅ Match to one of 4 scenarios (A/B/C/D)
10. ✅ Execute scenario-specific fix (10A/10B/10C/10D)
11. ⚠️ If all fixes fail: Apply emergency workaround
12. ✅ Document findings in report

---

## Expected Outcome

After completing these steps, you will have:
1. Identified the specific root cause (registration, config writes, logic bug, or debounce)
2. Applied a targeted fix
3. Verified the fix works (or documented why it doesn't)
4. Have detailed logs and timeline for further investigation if needed

If the issue persists after all steps, the investigation report will contain enough data to escalate to the Moltbot/OpenClaw maintainers with a full reproduction case.
