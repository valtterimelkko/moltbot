# PRD: Fix Moltbot Gateway Restart Loop During Message Processing

**Version:** 1.0
**Date:** 2026-01-30
**Status:** Ready for Implementation

---

## Executive Summary

### Problem Statement
Moltbot gateway receives Telegram messages (typing indicator appears) but restarts before sending responses, causing 100% message processing failure. Users see the bot "typing" but never receive a reply.

### Root Cause
Config file auto-rewrites trigger file watcher → reload handler decides restart needed → SIGUSR1 signal sent → graceful shutdown initiated → in-flight agent requests interrupted → responses lost.

### Impact
- **User Experience:** Complete bot failure - no messages get responses
- **Reliability:** 100% reproducible issue affecting all message types
- **Business:** Critical production blocker preventing bot usage

### Solution Approach
Multi-layered defense-in-depth strategy:
1. Verify and enhance existing deferred restart logic
2. Add comprehensive logging to identify config write sources
3. Increase debounce time for atomic write handling
4. Prevent spurious config writes
5. Harden PM2 configuration
6. Add monitoring and testing

### Success Criteria
- ✅ Messages processed successfully without mid-processing restarts
- ✅ Agent runs complete and send responses to users
- ✅ Config changes outside active runs still trigger restarts correctly
- ✅ 24-hour stability test passes with zero interrupted messages
- ✅ Comprehensive logging shows deferred restart logic working

---

## Background & Context

### Current Architecture

```
Message arrives → Gateway receives → Agent starts processing → Tools execute
                                                                     ↓
                                                            (Config file changes)
                                                                     ↓
                                                              File watcher detects
                                                                     ↓
                                                            Reload handler evaluates
                                                                     ↓
                                                              SIGUSR1 emitted
                                                                     ↓
                                                            Graceful shutdown starts
                                                                     ↓
                                                          In-flight request LOST
```

### Existing Safeguards (Why They're Not Working)

1. **Deferred Restart Logic** (`src/gateway/config-reload.ts:312-345`)
   - **EXISTS:** Checks `getActiveAgentRunCount()` before restarting
   - **SHOULD:** Queue restart if agent runs active
   - **ISSUE:** Still allows restarts during processing (needs investigation)

2. **macOS App Guard** (`apps/macos/Sources/Moltbot/AppState.swift:452-453`)
   - **EXISTS:** `guard connectionMode == .local else { return }`
   - **SHOULD:** Prevent remote mode config writes
   - **ISSUE:** May not cover all code paths or gateway might be in local mode

3. **Agent Run Tracking** (`src/infra/agent-events.ts`)
   - **EXISTS:** `runContextById` Map tracks active runs
   - **SHOULD:** Provide accurate count for deferred restart logic
   - **ISSUE:** May not be registering all run types correctly

### Timeline of a Typical Failure

```
21:20:35  →  Telegram message received
21:20:36  →  Agent run starts (runId: b27eccb8-f113-4f67-8de6-45a1161f6c97)
21:20:49  →  First tool completes (exec toolCallId: UG6gBMdvD)
21:21:02  →  Second tool starts (exec toolCallId: SvLFDzozr)
21:21:02  →  SIGUSR1 signal received (+7ms into second tool) ⚠️
             Config file change detected
             Reload handler: "restart needed"
             process.emit("SIGUSR1")
21:21:02  →  Graceful shutdown begins
             In-flight processing INTERRUPTED
             Tool execution aborted
             Response generation STOPS
21:21:06  →  Gateway restarts (new PID)
             Previous message result LOST
             User sees: bot typed but never responded
```

### Research Report Key Findings

From comprehensive Node.js restart loop analysis (Moltbot_Restart_Loop_Investigation.md):

**Root Causes in Stateful Agents:**
- File watcher + self-modifying behavior = positive feedback loop
- Atomic writes (write temp → rename) trigger multiple events
- Default PM2 configs too aggressive for autonomous agents
- Insufficient signal handling and shutdown logic

**Proven Solutions:**
- Defer restarts during active requests ⭐ (Primary)
- Increase debounce time (300ms → 2000-5000ms)
- Architectural segregation (code vs data directories)
- Robust PM2 configuration (`ignore_watch`, `awaitWriteFinish`, `kill_timeout`)
- Graceful shutdown handlers
- Lockfiles for concurrent operations

---

## Implementation Modules

Each module is designed to be independently implementable by different agents. Modules can be executed in parallel except where dependencies are noted.

---

## Module 1: Enhanced Logging & Diagnostics

**Priority:** CRITICAL
**Difficulty:** Low
**Dependencies:** None
**Estimated Effort:** 2-3 hours

### Objective
Add comprehensive logging to identify when and why config writes occur, track deferred restart decisions, and monitor active agent runs during reload events.

### Tasks

#### 1.1 Add Config Write Source Logging
**File:** `src/config/io.ts`

```typescript
// In writeConfigFile() function (around line 462-519)
export async function writeConfigFile(config: MoltbotConfig, opts?: WriteConfigOpts): Promise<void> {
  const writeSource = new Error().stack?.split('\n')[2]?.trim() || 'unknown';
  configLog.info(`writing config file (source: ${writeSource})`);

  // Add logging before actual write
  const activeRuns = getActiveAgentRunCount();
  if (activeRuns > 0) {
    configLog.warn(`config write attempted with ${activeRuns} active agent run(s)`);
  }

  // ... existing write logic
}
```

**Expected Output:**
```
[config] writing config file (source: at syncGatewayConfigIfNeeded (/apps/macos/.../AppState.swift:455))
[config] config write attempted with 1 active agent run(s)
```

#### 1.2 Add Deferred Restart Decision Logging
**File:** `src/gateway/config-reload.ts`

```typescript
// In runReload function (around line 312-320 and 337-345)
if (activeRunCount > 0) {
  const runIds = getActiveAgentRunIds(); // Import from agent-events.ts
  opts.log.warn(
    `config change requires gateway restart, but deferring (${activeRunCount} active agent run${activeRunCount === 1 ? "" : "s"}: ${runIds.join(", ")})`
  );
  // ... existing queue logic
}
```

**Expected Output:**
```
[reload] config change requires gateway restart, but deferring (1 active agent run: b27eccb8-f113-4f67-8de6-45a1161f6c97)
```

#### 1.3 Add Agent Run Lifecycle Logging
**File:** `src/infra/agent-events.ts`

```typescript
export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) return;
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, { ...context });
    agentLog.debug(`agent run registered: ${runId} (total active: ${runContextById.size})`);
    return;
  }
  // ... existing logic
}

export function clearAgentRunContext(runId: string) {
  const existed = runContextById.has(runId);
  runContextById.delete(runId);
  if (existed) {
    agentLog.debug(`agent run cleared: ${runId} (remaining active: ${runContextById.size})`);
  }
  // ... existing callback logic
}
```

**Expected Output:**
```
[agent] agent run registered: b27eccb8-f113-4f67-8de6-45a1161f6c97 (total active: 1)
[agent] agent run cleared: b27eccb8-f113-4f67-8de6-45a1161f6c97 (remaining active: 0)
```

#### 1.4 Add SIGUSR1 Signal Source Logging
**File:** `src/gateway/server-reload-handlers.ts`

```typescript
// In requestGatewayRestart function (around line 151-157)
const requestGatewayRestart = (
  plan: GatewayReloadPlan,
  nextConfig: ReturnType<typeof loadConfig>,
) => {
  // ... existing logic ...

  const activeRuns = getActiveAgentRunCount();
  const runIds = getActiveAgentRunIds();
  params.logReload.warn(
    `emitting SIGUSR1 for gateway restart (active runs: ${activeRuns}${activeRuns > 0 ? `, runIds: ${runIds.join(", ")}` : ""})`
  );

  authorizeGatewaySigusr1Restart();
  process.emit("SIGUSR1");
};
```

**Expected Output:**
```
[reload] config change requires gateway restart (plugins.entries.telegram)
[reload] emitting SIGUSR1 for gateway restart (active runs: 1, runIds: b27eccb8-f113-4f67-8de6-45a1161f6c97)
```

### Verification
- Run gateway with verbose logging
- Send a test message
- Check logs show:
  - Agent run registration
  - Any config writes during processing
  - Deferred restart decisions
  - Agent run cleanup
  - Queued restart application (if any)

### Deliverables
- Enhanced logging in 4 files
- Log output samples showing new diagnostics
- Updated logging documentation

---

## Module 2: Verify & Fix Active Run Detection

**Priority:** CRITICAL
**Difficulty:** Medium
**Dependencies:** Module 1 (for logging)
**Estimated Effort:** 3-4 hours

### Objective
Audit and fix agent run registration/cleanup to ensure `getActiveAgentRunCount()` accurately reflects in-flight requests during config reload events.

### Investigation Tasks

#### 2.1 Audit Agent Run Registration Call Sites
**Files to check:**
- `src/process/agent-queue.ts`
- `src/cli/agent-cli/agent.ts`
- `src/gateway/server.ts`
- `src/channels/**/index.ts` (all channel providers)

**Verification:**
```typescript
// Search pattern:
grep -r "registerAgentRunContext" src/

// Ensure every agent invocation path includes:
registerAgentRunContext(runId, { sessionKey, verboseLevel, isHeartbeat });
try {
  // ... agent run logic ...
} finally {
  clearAgentRunContext(runId); // MUST be in finally block
}
```

**Expected finding:** All agent run paths should register/clear context. Look for:
- ❌ Missing registration in some code paths
- ❌ Clear without finally block (can skip on errors)
- ❌ Heartbeat runs not properly marked
- ❌ Subagent runs not tracked

#### 2.2 Fix Missing Registration/Cleanup
**File:** `src/process/agent-queue.ts` (or wherever gaps found)

```typescript
// Example fix pattern:
async function runAgent(params: AgentParams) {
  const runId = params.runId || crypto.randomUUID();

  // ✅ ALWAYS register before starting
  registerAgentRunContext(runId, {
    sessionKey: params.sessionKey,
    verboseLevel: params.verboseLevel,
    isHeartbeat: params.isHeartbeat,
  });

  try {
    // ... existing agent logic ...
  } catch (error) {
    // ... error handling ...
  } finally {
    // ✅ ALWAYS clear in finally block
    clearAgentRunContext(runId);
  }
}
```

#### 2.3 Add Defensive Timeout for Stale Runs
**File:** `src/infra/agent-events.ts`

```typescript
// Add automatic cleanup for runs that exceed max duration
const MAX_RUN_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const runStartTimes = new Map<string, number>();

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) return;
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, { ...context });
    runStartTimes.set(runId, Date.now());

    // Schedule automatic cleanup
    setTimeout(() => {
      if (runContextById.has(runId)) {
        agentLog.warn(`force-clearing stale agent run: ${runId} (exceeded ${MAX_RUN_DURATION_MS}ms)`);
        clearAgentRunContext(runId);
      }
    }, MAX_RUN_DURATION_MS);
    return;
  }
  // ... existing update logic
}

export function clearAgentRunContext(runId: string) {
  runContextById.delete(runId);
  runStartTimes.delete(runId);
  // ... existing callback logic
}
```

### Testing

```typescript
// Add test in src/infra/agent-events.test.ts
describe('agent run tracking', () => {
  it('should track active runs correctly', () => {
    expect(getActiveAgentRunCount()).toBe(0);

    registerAgentRunContext('run-1', {});
    expect(getActiveAgentRunCount()).toBe(1);

    registerAgentRunContext('run-2', {});
    expect(getActiveAgentRunCount()).toBe(2);

    clearAgentRunContext('run-1');
    expect(getActiveAgentRunCount()).toBe(1);

    clearAgentRunContext('run-2');
    expect(getActiveAgentRunCount()).toBe(0);
  });

  it('should fire completion callbacks', () => {
    const callback = vi.fn();
    const unregister = onAgentRunComplete(callback);

    registerAgentRunContext('run-1', {});
    expect(callback).not.toHaveBeenCalled();

    clearAgentRunContext('run-1');
    expect(callback).toHaveBeenCalledTimes(1);

    unregister();
  });
});
```

### Deliverables
- Audit report of all registration/cleanup call sites
- Fixes for any missing registration/cleanup
- Defensive timeout for stale runs
- Unit tests for agent run tracking
- Integration test showing deferred restart working

---

## Module 3: Increase Debounce & Stabilization

**Priority:** HIGH
**Difficulty:** Low
**Dependencies:** None
**Estimated Effort:** 1-2 hours

### Objective
Increase config file watcher debounce time and add stabilization settings to handle atomic write patterns (write temp → rename) without triggering multiple restart events.

### Tasks

#### 3.1 Increase Debounce Time
**File:** `src/gateway/config-reload.ts`

```typescript
// Current default (around line 36-40):
const DEFAULT_RELOAD_SETTINGS: Required<GatewayReloadSettings> = {
  mode: "hybrid",
  debounceMs: 300, // ❌ Too short for atomic writes
};

// Change to:
const DEFAULT_RELOAD_SETTINGS: Required<GatewayReloadSettings> = {
  mode: "hybrid",
  debounceMs: 2000, // ✅ Handle atomic write sequences
};
```

**Rationale:** Research shows atomic writes (editor saves) trigger sequence:
1. `ADD` (tempfile)
2. `UNLINK` (original)
3. `ADD` (original from rename)

300ms catches each event separately → 3 restart attempts.
2000ms allows all events to coalesce → 1 restart after stabilization.

#### 3.2 Add awaitWriteFinish Configuration
**File:** `src/gateway/config-reload.ts`

```typescript
// In createGatewayConfigReloader function (around line 365-369):
const watcher = chokidar.watch(opts.watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 200, // ❌ Too short
    pollInterval: 50
  },
  usePolling: Boolean(process.env.VITEST),
});

// Change to:
const watcher = chokidar.watch(opts.watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 2000, // ✅ Wait for file size to stabilize
    pollInterval: 100,
  },
  usePolling: Boolean(process.env.VITEST) || Boolean(process.env.MOLTBOT_USE_POLLING),
  interval: 1000, // Polling interval if usePolling enabled
});
```

**Rationale:**
- `stabilityThreshold: 2000` ensures file size hasn't changed for 2 seconds
- Prevents restart during multi-step write operations
- Aligns with debounceMs setting

#### 3.3 Make Debounce Configurable
**File:** `src/config/gateway.ts`

```typescript
// Add to GatewayReloadSettings type:
export interface GatewayReloadSettings {
  mode?: "off" | "restart" | "hot" | "hybrid";
  debounceMs?: number; // NEW: Allow user override
}
```

**File:** `src/gateway/config-reload.ts`

```typescript
// In resolveGatewayReloadSettings function:
export function resolveGatewayReloadSettings(config: MoltbotConfig): Required<GatewayReloadSettings> {
  const reload = config.gateway?.reload;
  return {
    mode: reload?.mode ?? DEFAULT_RELOAD_SETTINGS.mode,
    debounceMs: reload?.debounceMs ?? DEFAULT_RELOAD_SETTINGS.debounceMs, // NEW
  };
}
```

**Usage in config:**
```json
{
  "gateway": {
    "reload": {
      "mode": "hybrid",
      "debounceMs": 5000
    }
  }
}
```

### Testing

```typescript
// Add test in src/gateway/config-reload.test.ts
describe('config reload debouncing', () => {
  it('should debounce rapid config changes', async () => {
    vi.useFakeTimers();
    const reloadSpy = vi.fn();

    // Create reloader with 2000ms debounce
    const reloader = createGatewayConfigReloader({
      // ... setup ...
      debounceMs: 2000,
    });

    // Trigger 3 rapid changes (atomic write simulation)
    await writeConfig({ version: 1 });
    vi.advanceTimersByTime(100);
    await writeConfig({ version: 2 });
    vi.advanceTimersByTime(100);
    await writeConfig({ version: 3 });

    // Should not reload yet
    expect(reloadSpy).not.toHaveBeenCalled();

    // Advance past debounce
    vi.advanceTimersByTime(2000);

    // Should reload once with final config
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));

    vi.useRealTimers();
  });
});
```

### Deliverables
- Increased default debounce to 2000ms
- Enhanced awaitWriteFinish configuration
- Configurable debounce time in gateway.reload
- Unit tests for debouncing behavior
- Documentation of config options

---

## Module 4: Prevent Spurious Config Writes

**Priority:** HIGH
**Difficulty:** Medium
**Dependencies:** Module 1 (for identifying write sources)
**Estimated Effort:** 3-4 hours

### Objective
Identify and eliminate unnecessary config writes, especially those triggered by the macOS app or gateway initialization, that create reload loops.

### Tasks

#### 4.1 Verify macOS App Remote Mode Guard
**File:** `apps/macos/Sources/Moltbot/AppState.swift`

**Current state (line 452-453):**
```swift
// Don't write to gateway config in remote mode - gateway manages its own config
guard connectionMode == .local else { return }
```

**Verification needed:**
- Confirm gateway is actually running in `.remote` mode on the remote server
- Check if there are other config write paths in the macOS app
- Ensure guard covers all scenarios

**Search for other config write sites:**
```bash
cd apps/macos
grep -r "MoltbotConfigFile" Sources/
grep -r "ConfigStore.save" Sources/
grep -r "writeConfig" Sources/
```

**Fix any gaps:**
```swift
// Add to all config write functions:
private func updateGatewayConfig() {
    // Prevent writes in remote mode
    guard connectionMode == .local else {
        appLog.debug("skipping gateway config write (remote mode)")
        return
    }

    // Prevent writes during initialization
    guard !isInitializing else {
        appLog.debug("skipping gateway config write (initializing)")
        return
    }

    // ... actual write logic
}
```

#### 4.2 Add Config Checksum Verification
**File:** `src/config/io.ts`

```typescript
import crypto from 'node:crypto';

let lastConfigChecksum: string | null = null;

function calculateConfigChecksum(config: MoltbotConfig): string {
  const normalized = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function writeConfigFile(config: MoltbotConfig, opts?: WriteConfigOpts): Promise<void> {
  const checksum = calculateConfigChecksum(config);

  // Skip write if config hasn't actually changed
  if (checksum === lastConfigChecksum && !opts?.forceWrite) {
    configLog.debug('config write skipped (checksum unchanged)');
    return;
  }

  configLog.info(`writing config file (checksum: ${checksum.slice(0, 8)}...)`);

  // ... existing write logic ...

  lastConfigChecksum = checksum;
}
```

**Benefits:**
- Prevents write loops from metadata-only changes
- Stops redundant writes from re-applying same config
- Breaks sync loops in bi-directional scenarios

#### 4.3 Prevent Gateway Initialization Writes
**File:** `src/config/config.ts` or `src/gateway/server.ts`

```typescript
// Track initialization state
let gatewayInitialized = false;

export function loadConfig(): MoltbotConfig {
  const config = readConfigFile();

  // Apply defaults and migrations
  const withDefaults = applyConfigDefaults(config);

  // ❌ DON'T write back during load unless explicitly needed
  // Only write if schema version changed or validation added fields
  const needsWrite = !gatewayInitialized && configNeedsMigration(config, withDefaults);

  if (needsWrite) {
    configLog.info('config migration needed; writing updated config');
    writeConfigFile(withDefaults);
  }

  gatewayInitialized = true;
  return withDefaults;
}
```

#### 4.4 Add Config Write Rate Limiting
**File:** `src/config/io.ts`

```typescript
const WRITE_RATE_LIMIT_MS = 5000; // Max 1 write per 5 seconds
let lastWriteTime = 0;
let pendingWrite: NodeJS.Timeout | null = null;

export async function writeConfigFile(config: MoltbotConfig, opts?: WriteConfigOpts): Promise<void> {
  const now = Date.now();
  const timeSinceLastWrite = now - lastWriteTime;

  if (timeSinceLastWrite < WRITE_RATE_LIMIT_MS && !opts?.urgent) {
    // Rate limit: queue write for later
    if (pendingWrite) clearTimeout(pendingWrite);

    configLog.debug(`config write rate-limited; queuing (${WRITE_RATE_LIMIT_MS - timeSinceLastWrite}ms remaining)`);

    pendingWrite = setTimeout(() => {
      void writeConfigFile(config, { ...opts, urgent: true });
    }, WRITE_RATE_LIMIT_MS - timeSinceLastWrite);

    return;
  }

  // ... existing write logic ...

  lastWriteTime = now;
  if (pendingWrite) {
    clearTimeout(pendingWrite);
    pendingWrite = null;
  }
}
```

### Testing

```bash
# Manual test: Monitor config writes
inotifywait -m -e modify /root/.clawdbot/moltbot.json &
INOTIFY_PID=$!

# Start gateway
moltbot gateway run --verbose

# Send test message
moltbot agent --message "test"

# Check if config was written during message processing
kill $INOTIFY_PID

# Expected: No writes during agent run
```

### Deliverables
- Verified macOS app remote mode guard
- Config checksum verification
- Initialization write prevention
- Config write rate limiting
- Test demonstrating no spurious writes

---

## Module 5: PM2 Configuration Hardening

**Priority:** MEDIUM
**Difficulty:** Low
**Dependencies:** None (can run in parallel)
**Estimated Effort:** 1-2 hours

### Objective
Optimize PM2 process manager configuration to handle the gateway's stateful, file-writing behavior without triggering restart loops.

### Tasks

#### 5.1 Update ecosystem.config.cjs
**File:** `/root/moltbot/ecosystem.config.cjs`

**Current state:** Basic PM2 config
**Target state:** Hardened config with ignore patterns

```javascript
module.exports = {
  apps: [
    {
      name: "moltbot-gateway",
      script: "./dist/entry.js",
      args: "gateway --port 18789",

      // ===== WATCH CONFIGURATION =====
      watch: false, // ✅ DISABLE watch mode entirely (gateway has built-in reload)

      // If watch must be enabled, use these settings:
      // watch: ["./dist"],
      // ignore_watch: [
      //   "node_modules",
      //   "logs",
      //   "*.log",
      //   ".clawdbot",
      //   "data",
      //   "*.json",
      //   "*.sqlite",
      //   ".git",
      //   "tmp",
      //   "temp",
      // ],
      // watch_options: {
      //   followSymlinks: false,
      //   usePolling: false,
      //   awaitWriteFinish: {
      //     stabilityThreshold: 2000,
      //     pollInterval: 100,
      //   },
      // },

      // ===== RESTART STRATEGY =====
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s", // Prevent restart storms
      restart_delay: 3000, // Wait 3s between restarts
      exp_backoff_restart_delay: 100, // Exponential backoff

      // ===== SHUTDOWN STRATEGY =====
      kill_timeout: 10000, // Give 10s for graceful shutdown (up from default 1600ms)
      wait_ready: false,
      listen_timeout: 10000,
      shutdown_with_message: false,

      // ===== RESOURCE LIMITS =====
      max_memory_restart: "1G", // Restart if memory exceeds 1GB

      // ===== ENVIRONMENT =====
      env: {
        NODE_ENV: "production",
        MOLTBOT_DATA_DIR: "/root/.clawdbot",
        MOLTBOT_LOG_DIR: "/tmp/moltbot",
      },

      // ===== LOGGING =====
      error_file: "/tmp/moltbot/pm2-error.log",
      out_file: "/tmp/moltbot/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
    {
      name: "moltbot-health-monitor",
      script: "./scripts/pm2-health-monitor.js",
      autorestart: true,
      watch: false,
      max_restarts: 5,
      min_uptime: "30s",
      env: {
        HEALTH_CHECK_INTERVAL_MS: 300000, // 5 minutes
        GATEWAY_PORT: 18789,
      },
      error_file: "/tmp/moltbot/pm2-health-monitor-error.log",
      out_file: "/tmp/moltbot/pm2-health-monitor-out.log",
    },
  ],
};
```

**Key Changes:**
1. **watch: false** - Gateway has built-in hot reload; PM2 watch disabled
2. **kill_timeout: 10000** - Allow time for graceful shutdown
3. **restart_delay: 3000** - Prevent rapid restart cycles
4. **max_restarts: 10** - Limit restart storms

#### 5.2 Update Health Monitor
**File:** `/root/moltbot/scripts/pm2-health-monitor.js`

**Add check for active agent runs before forcing restart:**

```javascript
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '300000');
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '18789');
const GATEWAY_WS_URL = `ws://127.0.0.1:${GATEWAY_PORT}`;

async function checkGatewayHealth() {
  try {
    // Check 1: Port reachable
    const portOpen = await checkPort(GATEWAY_PORT);
    if (!portOpen) {
      console.log(`[health] gateway port ${GATEWAY_PORT} not reachable`);
      await forceRestartGateway();
      return;
    }

    // Check 2: WebSocket responding
    const wsHealthy = await checkWebSocket(GATEWAY_WS_URL);
    if (!wsHealthy) {
      console.log(`[health] gateway websocket not responding`);
      await forceRestartGateway();
      return;
    }

    // Check 3: Query active agent runs via WS
    const activeRuns = await queryActiveAgentRuns(GATEWAY_WS_URL);
    if (activeRuns > 0) {
      console.log(`[health] gateway healthy but has ${activeRuns} active run(s); deferring any restart`);
      return;
    }

    console.log(`[health] gateway healthy (port open, ws responding, no active runs)`);
  } catch (error) {
    console.error(`[health] check failed: ${error.message}`);
  }
}

async function queryActiveAgentRuns(wsUrl) {
  // Connect to gateway WS and query agent run count
  // This prevents health monitor from killing gateway during message processing
  const ws = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WS query timeout'));
    }, 5000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'query',
        query: 'activeAgentRunCount'
      }));
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      const response = JSON.parse(data);
      ws.close();
      resolve(response.count || 0);
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
```

### Testing

```bash
# Test PM2 config
pm2 delete all
pm2 start ecosystem.config.cjs

# Verify no watch-triggered restarts
echo "test" >> /tmp/test.log
sleep 5
pm2 logs moltbot-gateway --lines 20 --nostream | grep -i restart
# Expected: No restart logs

# Verify graceful shutdown timeout
pm2 restart moltbot-gateway
pm2 logs moltbot-gateway --lines 20 --nostream | grep -i "shutdown\|SIGTERM"
# Expected: Clean shutdown within 10s
```

### Deliverables
- Updated ecosystem.config.cjs with hardened settings
- Enhanced health monitor with active run awareness
- PM2 restart strategy documentation
- Test showing no spurious PM2 restarts

---

## Module 6: Testing & Verification

**Priority:** CRITICAL
**Difficulty:** Medium
**Dependencies:** Modules 1-5 (requires all fixes in place)
**Estimated Effort:** 4-6 hours

### Objective
Comprehensive testing to verify the restart loop is fixed and deferred restart logic works correctly under various scenarios.

### Tasks

#### 6.1 E2E Test: Deferred Restart During Message Processing
**File:** `src/gateway/config-reload.e2e.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { startGatewayServer } from '../gateway/server.js';
import { writeConfigFile } from '../config/io.js';
import { getActiveAgentRunCount } from '../infra/agent-events.js';

describe('config reload with active agent runs', () => {
  it('should defer restart when agent run is active', async () => {
    // Start gateway
    const gateway = await startGatewayServer({ port: 18790 });

    // Simulate incoming message that starts agent run
    const agentPromise = gateway.runAgent({
      message: 'run a slow shell command',
      sessionKey: 'test-session',
    });

    // Wait for agent to start
    await waitFor(() => getActiveAgentRunCount() > 0);
    expect(getActiveAgentRunCount()).toBe(1);

    // Trigger config change while agent is running
    const currentConfig = await readConfigSnapshot();
    const modifiedConfig = {
      ...currentConfig.config,
      gateway: {
        ...currentConfig.config.gateway,
        testSetting: 'modified',
      },
    };

    await writeConfigFile(modifiedConfig);

    // Gateway should NOT restart yet
    await delay(1000);
    expect(gateway.isRunning()).toBe(true);
    expect(getActiveAgentRunCount()).toBe(1);

    // Wait for agent to complete
    await agentPromise;
    expect(getActiveAgentRunCount()).toBe(0);

    // Now restart should be applied
    await waitFor(() => !gateway.isRunning(), { timeout: 5000 });
    expect(gateway.isRunning()).toBe(false);
    expect(gateway.restartReason).toBe('queued config change applied');
  });

  it('should immediately restart when no active runs', async () => {
    const gateway = await startGatewayServer({ port: 18790 });

    // No active runs
    expect(getActiveAgentRunCount()).toBe(0);

    // Trigger config change
    const currentConfig = await readConfigSnapshot();
    const modifiedConfig = {
      ...currentConfig.config,
      gateway: {
        ...currentConfig.config.gateway,
        testSetting: 'modified-immediate',
      },
    };

    await writeConfigFile(modifiedConfig);

    // Gateway should restart immediately
    await waitFor(() => !gateway.isRunning(), { timeout: 3000 });
    expect(gateway.restartReason).toBe('config change');
  });
});
```

#### 6.2 Load Test: Concurrent Messages
**File:** `test/e2e/load-test-concurrent-messages.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('concurrent message processing', () => {
  it('should handle 10 concurrent messages without restarts', async () => {
    const gateway = await startGatewayServer({ port: 18790 });
    const restartSpy = vi.fn();
    gateway.on('restart', restartSpy);

    // Send 10 messages concurrently
    const messages = Array.from({ length: 10 }, (_, i) =>
      gateway.runAgent({
        message: `test message ${i}`,
        sessionKey: `test-session-${i}`,
      })
    );

    // All should complete
    const results = await Promise.all(messages);
    expect(results).toHaveLength(10);

    // No restarts should have occurred
    expect(restartSpy).not.toHaveBeenCalled();

    // All messages should have responses
    for (const result of results) {
      expect(result.response).toBeTruthy();
      expect(result.error).toBeUndefined();
    }
  });
});
```

#### 6.3 Integration Test: Telegram Message Processing
**File:** `test/e2e/telegram-message-processing.e2e.test.ts`

```typescript
describe('Telegram message processing', () => {
  it('should process Telegram message end-to-end without restart', async () => {
    const gateway = await startGatewayServer({ port: 18790 });

    // Simulate Telegram message
    const telegramMessage = {
      chat: { id: 123456 },
      from: { id: 876311493 },
      text: 'hi',
    };

    const restartSpy = vi.fn();
    gateway.on('restart', restartSpy);

    // Send via Telegram channel
    const result = await gateway.channels.telegram.handleMessage(telegramMessage);

    // Should complete successfully
    expect(result.sent).toBe(true);
    expect(result.response).toBeTruthy();

    // No restart should have occurred
    expect(restartSpy).not.toHaveBeenCalled();

    await gateway.close();
  });
});
```

#### 6.4 Stability Test: 24-Hour Monitoring
**File:** `scripts/stability-test.sh`

```bash
#!/bin/bash

# 24-hour stability test
# Sends messages every 5 minutes and monitors for restarts

DURATION_HOURS=24
INTERVAL_SECONDS=300
LOG_FILE="/tmp/moltbot-stability-test.log"

echo "Starting 24-hour stability test at $(date)" | tee -a "$LOG_FILE"
echo "Monitoring for unexpected restarts during message processing" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_HOURS * 3600))

MESSAGE_COUNT=0
SUCCESS_COUNT=0
RESTART_COUNT=0

while [ $(date +%s) -lt $END_TIME ]; do
  MESSAGE_COUNT=$((MESSAGE_COUNT + 1))

  echo "[$(date)] Sending test message #$MESSAGE_COUNT" | tee -a "$LOG_FILE"

  # Send test message
  BEFORE_RESTARTS=$(pm2 info moltbot-gateway | grep 'restart time' | awk '{print $4}')

  moltbot agent --message "stability test message #$MESSAGE_COUNT" --thinking low 2>&1 | tee -a "$LOG_FILE"

  if [ $? -eq 0 ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "[$(date)] Message #$MESSAGE_COUNT completed successfully" | tee -a "$LOG_FILE"
  else
    echo "[$(date)] Message #$MESSAGE_COUNT FAILED" | tee -a "$LOG_FILE"
  fi

  # Check for restarts
  AFTER_RESTARTS=$(pm2 info moltbot-gateway | grep 'restart time' | awk '{print $4}')

  if [ "$BEFORE_RESTARTS" != "$AFTER_RESTARTS" ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "[$(date)] ⚠️ RESTART DETECTED during message processing!" | tee -a "$LOG_FILE"
  fi

  # Wait for next interval
  sleep $INTERVAL_SECONDS
done

# Final report
echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "24-Hour Stability Test Complete" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Total messages sent: $MESSAGE_COUNT" | tee -a "$LOG_FILE"
echo "Successful responses: $SUCCESS_COUNT" | tee -a "$LOG_FILE"
echo "Restarts during processing: $RESTART_COUNT" | tee -a "$LOG_FILE"
echo "Success rate: $(awk "BEGIN {printf \"%.2f%%\", ($SUCCESS_COUNT/$MESSAGE_COUNT)*100}")" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [ $RESTART_COUNT -eq 0 ] && [ $SUCCESS_COUNT -eq $MESSAGE_COUNT ]; then
  echo "✅ PASS: No restarts detected, all messages processed" | tee -a "$LOG_FILE"
  exit 0
else
  echo "❌ FAIL: $RESTART_COUNT restarts or message failures detected" | tee -a "$LOG_FILE"
  exit 1
fi
```

#### 6.5 Manual Test Procedure
**File:** `docs/testing/restart-loop-manual-test.md`

```markdown
# Manual Testing Procedure: Restart Loop Fix

## Prerequisites
- Moltbot gateway running
- Telegram bot configured and connected
- Verbose logging enabled

## Test 1: Simple Message Processing

1. Start gateway with logging:
   ```bash
   moltbot gateway run --verbose --port 18789 2>&1 | tee /tmp/gateway-test.log
   ```

2. Send Telegram message: "hi"

3. Verify in logs:
   ```bash
   grep -E "(agent run registered|config change|SIGUSR1|agent run cleared)" /tmp/gateway-test.log
   ```

4. Expected output:
   ```
   [agent] agent run registered: abc123 (total active: 1)
   [agent] agent run cleared: abc123 (remaining active: 0)
   ```

5. Expected NO output:
   ```
   [reload] emitting SIGUSR1 for gateway restart (active runs: 1, runIds: abc123)
   ```

## Test 2: Message with Config Change

1. Start gateway
2. Send message: "run echo 'test'"
3. While message processing, in another terminal:
   ```bash
   # Modify config (trigger change)
   moltbot config set gateway.testSetting "modified"
   ```
4. Check logs for deferred restart:
   ```
   [reload] config change requires gateway restart, but deferring (1 active agent run: abc123)
   [agent] agent run cleared: abc123 (remaining active: 0)
   [reload] applying queued gateway restart (all agent runs completed)
   ```

## Test 3: Config Change Without Active Runs

1. Ensure no messages processing
2. Modify config:
   ```bash
   moltbot config set gateway.testSetting "immediate"
   ```
3. Verify immediate restart:
   ```
   [reload] config change requires gateway restart (gateway.testSetting)
   [reload] emitting SIGUSR1 for gateway restart (active runs: 0)
   [gateway] signal SIGUSR1 received
   [gateway] received SIGUSR1; restarting
   ```

## Pass Criteria

✅ Test 1: Message processes without restart
✅ Test 2: Config change deferred until message completes
✅ Test 3: Config change with no active runs restarts immediately
✅ No log errors or warnings (except expected deferred restart messages)
```

### Deliverables
- E2E test for deferred restart
- Load test for concurrent messages
- Telegram integration test
- 24-hour stability test script
- Manual testing procedure
- Test results report

---

## Risk Assessment & Mitigation

### Implementation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Deferred restart logic breaks hot reload | Medium | High | Comprehensive E2E tests; manual testing of config changes |
| Increased debounce delays legitimate restarts | Low | Medium | Make debounce configurable; document trade-offs |
| Stale run detection clears active runs prematurely | Low | High | Set conservative timeout (10 min); add safety checks |
| Checksum verification prevents necessary writes | Low | Medium | Add forceWrite option; log skipped writes for debugging |
| PM2 config changes break existing deployments | Medium | Medium | Test on staging; provide migration guide; backward compatible |

### Rollback Plan

If issues occur post-deployment:

1. **Immediate:** Disable config reload entirely
   ```bash
   moltbot config set gateway.reload.mode "off"
   pm2 restart moltbot-gateway
   ```

2. **Short-term:** Revert debounce increase
   ```bash
   moltbot config set gateway.reload.debounceMs 300
   ```

3. **Full rollback:** Revert all code changes
   ```bash
   git revert <commit-range>
   pnpm build
   pm2 restart moltbot-gateway
   ```

---

## Success Metrics

### Primary Metrics
- ✅ **Zero restarts during message processing** (24-hour test)
- ✅ **100% message completion rate** (no interrupted responses)
- ✅ **Deferred restart count > 0** (proves logic is working)
- ✅ **Applied queued restarts = Deferred restarts** (no lost restarts)

### Secondary Metrics
- Config change latency < 5 seconds (with 2000ms debounce)
- Zero config write loops (checksum verification working)
- Health monitor respects active runs (no force-kills during processing)
- PM2 restart count remains low (< 5 per week)

### Logging Verification
- Agent run lifecycle logged correctly (register → clear)
- Config write sources identified in logs
- Deferred restart decisions visible
- Queued restart application logged

---

## Trade-offs & Considerations

### Performance vs Stability

**Increased Debounce Time (300ms → 2000ms)**
- ✅ Pro: Prevents restart loops from atomic writes
- ✅ Pro: Reduces CPU load from excessive watcher events
- ❌ Con: Config changes take 2 seconds to apply (vs instant)
- 💡 Mitigation: Make configurable; users needing fast reload can reduce

**Active Run Tracking Overhead**
- ✅ Pro: Accurate detection of in-flight requests
- ❌ Con: Additional Map lookups on every agent start/end
- ❌ Con: Memory overhead for run context storage
- 💡 Mitigation: Negligible for typical load; add stale cleanup

### Reliability vs Flexibility

**Deferred Restart Logic**
- ✅ Pro: Prevents data loss from interrupted messages
- ✅ Pro: Improves user experience (messages complete)
- ❌ Con: Config changes delayed if agent runs are frequent
- ❌ Con: Queued restarts could accumulate if runs never stop
- 💡 Mitigation: Max queue size of 1; force restart after 10-minute timeout

**Config Write Rate Limiting**
- ✅ Pro: Prevents write loops and excessive restarts
- ❌ Con: Rapid config changes may be dropped/delayed
- 💡 Mitigation: Allow urgent flag for critical writes

### Operational Complexity

**Enhanced Logging**
- ✅ Pro: Easier debugging and monitoring
- ❌ Con: More log volume (disk space, analysis time)
- ❌ Con: Sensitive data may leak in logs (runIds, config values)
- 💡 Mitigation: Log rotation; sanitize sensitive fields

**PM2 Watch Disabled**
- ✅ Pro: Gateway controls its own reload (no PM2 conflicts)
- ✅ Pro: Prevents external restart triggers
- ❌ Con: Developers lose PM2 auto-reload during development
- 💡 Mitigation: Gateway has built-in hot reload; use pnpm gateway:watch for dev

### Security Implications

**Config Checksum Verification**
- ✅ Pro: Prevents unauthorized config modifications from triggering restarts
- ❌ Con: Legitimate external tools may be blocked
- 💡 Mitigation: Document forceWrite API for trusted tools

**Extended Kill Timeout (1.6s → 10s)**
- ✅ Pro: Allows clean shutdown (DB close, port release)
- ❌ Con: Delayed shutdowns during emergencies
- ❌ Con: Rogue processes could delay system maintenance
- 💡 Mitigation: Health monitor can still force-kill after timeout

---

## Skills & Tools for Agents

When implementing this PRD, agents can leverage these Claude Code skills:

### Development Skills
- **context7-docs**: Fetch TypeScript/Node.js API documentation for chokidar, PM2, etc.
- **github-search-repos**: Find similar restart loop solutions in other projects
- **github-repo-info**: Review PM2 and chokidar repo best practices

### Testing Skills
- **using-claudecodecli**: Guide for running CLI tests and debugging
- **webapp-testing**: Test gateway WebSocket endpoints during E2E tests

### Documentation Skills
- **skill-creator**: Create custom skills for monitoring restart loops
- **markdown-to-docx**: Convert PRD to Word format for stakeholders

### Integration Skills
- **github-pr-original-repo**: Create PR from fork if working on forked repo
- **github-push**: Push implementation commits to main repo
- **notion-create-note**: Track implementation progress in Notion Ultimate Brain

---

## Appendix A: File Reference

### Core Implementation Files

| File | Purpose | Module |
|------|---------|--------|
| `src/gateway/config-reload.ts` | Reload logic, deferred restart | 2, 3 |
| `src/gateway/server-reload-handlers.ts` | SIGUSR1 emission | 1 |
| `src/cli/gateway-cli/run-loop.ts` | SIGUSR1 handler | 1 |
| `src/infra/agent-events.ts` | Agent run tracking | 2 |
| `src/config/io.ts` | Config write operations | 1, 4 |
| `apps/macos/Sources/Moltbot/AppState.swift` | macOS app config sync | 4 |
| `ecosystem.config.cjs` | PM2 configuration | 5 |
| `scripts/pm2-health-monitor.js` | Health monitoring | 5 |

### Test Files

| File | Purpose | Module |
|------|---------|--------|
| `src/gateway/config-reload.e2e.test.ts` | E2E deferred restart test | 6 |
| `test/e2e/load-test-concurrent-messages.ts` | Concurrent load test | 6 |
| `test/e2e/telegram-message-processing.e2e.test.ts` | Telegram integration | 6 |
| `scripts/stability-test.sh` | 24-hour stability test | 6 |

### Documentation Files

| File | Purpose |
|------|---------|
| `docs/testing/restart-loop-manual-test.md` | Manual test procedure |
| `README_Tech.md` | Technical documentation (update with fix) |
| `changes/changes_PRD.md` | This document |

---

## Appendix B: Glossary

**Active Agent Run**: An in-flight agent request that is currently executing tools or generating responses. Tracked via `runContextById` Map.

**Atomic Write**: File write pattern where editors write to temp file then rename to target file, triggering multiple filesystem events.

**Debounce Time**: Delay before processing accumulated file change events. Prevents multiple restarts for rapid changes.

**Deferred Restart**: Strategy where config-triggered restarts are queued until all active agent runs complete.

**Hot Reload**: Applying config changes without full gateway restart. Only works for certain config paths.

**SIGUSR1**: Unix signal used to trigger graceful gateway restart. Can be sent internally (config reload) or externally (manual restart command).

**Stability Threshold**: Time file size must remain unchanged before watcher considers write complete. Part of awaitWriteFinish.

---

## Appendix C: Research References

1. **Moltbot_Restart_Loop_Investigation.md** - Comprehensive analysis of Node.js restart loops in stateful agents
2. **README_Tech.md** - Technical documentation of current issue and troubleshooting attempts
3. **src/gateway/config-reload.ts** - Source code analysis showing existing deferred restart implementation
4. **apps/macos/Sources/Moltbot/AppState.swift** - macOS app config sync guard implementation

---

**END OF PRD**

---

## Implementation Notes for Agents

### Module Execution Order (Recommended)

1. **Phase 1 - Diagnostics** (Parallel)
   - Module 1: Enhanced Logging
   - Module 5: PM2 Configuration

2. **Phase 2 - Core Fixes** (Sequential)
   - Module 2: Active Run Detection (depends on Module 1 logs)
   - Module 3: Debounce & Stabilization
   - Module 4: Prevent Config Writes (uses Module 1 logs to identify sources)

3. **Phase 3 - Verification** (Sequential)
   - Module 6: Testing (depends on all previous modules)

### Agent Coordination

- **Modules 1 & 5** can be worked on by different agents in parallel
- **Module 2** should wait for Module 1 logging to be in place for debugging
- **Module 6** must wait for all fixes to be implemented
- Use git branches: `fix/restart-loop/module-N` for each module
- Create separate PRs for each module or combine related modules

### Testing Strategy

- Test each module independently before integration
- Run existing test suite after each module: `pnpm test`
- Manual testing after Module 2, 3, 4
- Full E2E testing in Module 6
- Staging deployment before production

---

*This PRD is ready for implementation by specialized agents working on individual modules.*
