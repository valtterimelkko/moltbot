# Changes Process: Restart Loop Fix Implementation

## How to Use This Document

**Purpose:** Track implementation progress, blockers, and solutions for each module of the restart loop fix.

**Audience:** Agents working on individual modules (parallel execution).

**Update Guidelines:**
- Update only the section for your assigned module
- Use concise bullet points (avoid verbose narrative)
- Record problems **as they occur**, not after completion
- Document solutions immediately when found
- Mark status transitions in real-time
- Keep each module's section under ~20 lines
- Link to specific files/lines when relevant: `[filename.ts:123](path)`

**Status Values:**
- `NOT_STARTED` - Awaiting work
- `IN_PROGRESS` - Currently being worked on
- `BLOCKED` - Stuck on a problem (document in Issues)
- `TESTING` - Implementation done, verification in progress
- `COMPLETE` - Merged or ready for merge

**Commit Strategy:** Create PRs for each module (or group related modules). Link PR to this doc with `changes/changes_process.md` commit message note.

---

## Module 1: Enhanced Logging & Diagnostics

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**PR:** (blank)

### Implementation Checklist
- [ ] 1.1 Config write source logging in `src/config/io.ts`
- [ ] 1.2 Deferred restart logging in `src/gateway/config-reload.ts`
- [ ] 1.3 Agent lifecycle logging in `src/infra/agent-events.ts`
- [ ] 1.4 SIGUSR1 signal logging in `src/gateway/server-reload-handlers.ts`

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Module 2: Verify & Fix Active Run Detection

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**Dependencies:** Module 1 (for debugging)
**PR:** (blank)

### Implementation Checklist
- [ ] 2.1 Audit agent run registration call sites
- [ ] 2.2 Fix missing registration/cleanup in identified paths
- [ ] 2.3 Add defensive timeout for stale runs in `src/infra/agent-events.ts`
- [ ] 2.4 Unit tests in `src/infra/agent-events.test.ts`
- [ ] 2.5 Integration test for deferred restart

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Module 3: Increase Debounce & Stabilization

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**PR:** (blank)

### Implementation Checklist
- [ ] 3.1 Increase debounce time from 300ms to 2000ms in `src/gateway/config-reload.ts`
- [ ] 3.2 Add awaitWriteFinish config in `src/gateway/config-reload.ts`
- [ ] 3.3 Make debounce configurable in `src/config/gateway.ts`
- [ ] 3.4 Unit tests for debounce behavior in `src/gateway/config-reload.test.ts`

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Module 4: Prevent Spurious Config Writes

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**Dependencies:** Module 1 (for identifying write sources)
**PR:** (blank)

### Implementation Checklist
- [ ] 4.1 Verify macOS app remote mode guard in `apps/macos/Sources/Moltbot/AppState.swift`
- [ ] 4.2 Add config checksum verification in `src/config/io.ts`
- [ ] 4.3 Prevent gateway initialization writes in `src/config/config.ts`
- [ ] 4.4 Add config write rate limiting in `src/config/io.ts`
- [ ] 4.5 Manual test: Monitor writes during message processing

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Module 5: PM2 Configuration Hardening

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**PR:** (blank)

### Implementation Checklist
- [ ] 5.1 Update `ecosystem.config.cjs` with hardened settings
- [ ] 5.2 Create/update health monitor in `scripts/pm2-health-monitor.js`
- [ ] 5.3 Verify watch disabled and kill_timeout increased
- [ ] 5.4 Test PM2 config doesn't trigger spurious restarts

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Module 6: Testing & Verification

**Status:** NOT_STARTED
**Assigned to:** (blank)
**Start Date:** (blank)
**Dependencies:** Modules 1-5 (all must be complete)
**PR:** (blank)

### Implementation Checklist
- [ ] 6.1 E2E test: Deferred restart during message processing in `src/gateway/config-reload.e2e.test.ts`
- [ ] 6.2 Load test: Concurrent messages in `test/e2e/load-test-concurrent-messages.ts`
- [ ] 6.3 Integration test: Telegram message processing in `test/e2e/telegram-message-processing.e2e.test.ts`
- [ ] 6.4 Create stability test script `scripts/stability-test.sh`
- [ ] 6.5 Create manual test procedure `docs/testing/restart-loop-manual-test.md`
- [ ] 6.6 Run all tests locally: `pnpm test`
- [ ] 6.7 Run manual tests on staging

### Issues
(Record problems here as encountered)

### Solutions
(Document fixes as discovered)

### Notes
(Any relevant observations or context)

---

## Cross-Module Coordination

### Dependencies Summary
```
Module 1 (Logging) ──┐
                     └─→ Module 2 (Active Run Detection) ──┐
Module 3 (Debounce)  ─────────────────────────────────────┼→ Module 6 (Testing)
Module 4 (Config)   ──┐                                   └─
Module 5 (PM2) ──────┘
```

### Recommended Execution Order
1. **Parallel Phase 1:** Modules 1 & 5 (independent)
2. **Sequential Phase 2:** Modules 2, 3, 4 (each may depend on logging)
3. **Final Phase:** Module 6 (requires all others complete)

### Communication Notes
- Document blockers immediately in Issues section
- If blocked, tag other agents in PR comments
- Verify integration between modules before Module 6
- Example: Module 2 should verify Module 1 logging works as expected

---

## Build & Test Commands

Run before committing:
```bash
pnpm lint
pnpm build
pnpm test
```

Run for specific module testing:
```bash
# Module 1 logging
pnpm test src/config/io.test.ts
pnpm test src/gateway/config-reload.test.ts
pnpm test src/infra/agent-events.test.ts

# Module 2 active runs
pnpm test src/infra/agent-events.test.ts

# Module 3 debounce
pnpm test src/gateway/config-reload.test.ts

# Module 4 config writes
pnpm test src/config/io.test.ts

# Module 6 integration
pnpm test src/gateway/config-reload.e2e.test.ts
```

---

## Key Files Reference

| File | Modules |
|------|---------|
| [src/gateway/config-reload.ts](src/gateway/config-reload.ts) | 2, 3 |
| [src/gateway/server-reload-handlers.ts](src/gateway/server-reload-handlers.ts) | 1 |
| [src/infra/agent-events.ts](src/infra/agent-events.ts) | 1, 2 |
| [src/config/io.ts](src/config/io.ts) | 1, 4 |
| [apps/macos/Sources/Moltbot/AppState.swift](apps/macos/Sources/Moltbot/AppState.swift) | 4 |
| [ecosystem.config.cjs](ecosystem.config.cjs) | 5 |

---

## Success Criteria (Module 6)

- ✅ Zero restarts during message processing (24-hour test)
- ✅ 100% message completion rate
- ✅ Deferred restart logic working (visible in logs)
- ✅ All E2E tests passing
- ✅ Manual tests passing on staging

---

*Last updated:* (auto-update when editing)
*Document version:* 1.0
