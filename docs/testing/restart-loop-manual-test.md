# Manual Testing Procedure: Restart Loop Fix

## Prerequisites

- Moltbot gateway running
- Telegram bot configured and connected
- Verbose logging enabled (`DEBUG=agent` or `DEBUG=*`)
- Modules 1-5 implemented and deployed

## Test 1: Simple Message Processing

**Objective:** Verify that a simple message processes without triggering a restart.

### Steps

1. Start gateway with verbose logging:
   ```bash
   pm2 logs moltbot-gateway --lines 0
   ```

2. Send a simple Telegram message:
   ```
   hi
   ```

3. Monitor logs for agent run lifecycle:
   ```bash
   tail -f /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log | grep -E "(agent run registered|agent run cleared)"
   ```

4. Verify in logs:
   ```
   [agent] agent run registered: <runId> (total active: 1)
   [agent] agent run cleared: <runId> (remaining active: 0)
   ```

5. Verify NO restart occurred:
   ```bash
   grep -E "(SIGUSR1|signal.*received|received SIGUSR1)" /tmp/moltbot/pm2-out.log
   ```
   Expected: No output (no restart during message processing)

### Expected Result

✅ Message processes without restart
✅ Agent run registered and cleared cleanly
✅ No SIGUSR1 signal during message processing
✅ Bot responds with a reply

---

## Test 2: Message with Config Change

**Objective:** Verify that config changes during active agent runs are deferred until completion.

### Steps

1. Ensure gateway is running and no active messages:
   ```bash
   # Check for active runs
   grep "agent run registered" /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log | tail -5
   ```

2. Send a message that will trigger tool execution:
   ```
   run echo 'test'
   ```

3. While message is processing, trigger a config change in another terminal:
   ```bash
   moltbot config set gateway.testSetting "modified"
   ```

4. Monitor logs for deferred restart:
   ```bash
   tail -f /tmp/moltbot/pm2-out.log | grep -E "(config change|deferring|active agent run)"
   ```

5. Verify logs show:
   ```
   [reload] config change requires gateway restart, but deferring (1 active agent run: <runId>)
   [agent] agent run cleared: <runId> (remaining active: 0)
   [reload] applying queued gateway restart (all agent runs completed)
   ```

6. Verify the message completes and bot responds.

### Expected Result

✅ Config change deferred while agent run active
✅ Message completes successfully
✅ Restart applied after agent run completes
✅ No response interruption

---

## Test 3: Config Change Without Active Runs

**Objective:** Verify that config changes with no active runs trigger immediate restart.

### Steps

1. Ensure no active messages:
   ```bash
   # Wait for any active runs to complete
   while grep -q "agent run registered" /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log | tail -1; do
     sleep 1
   done
   ```

2. Modify config:
   ```bash
   moltbot config set gateway.testSetting "immediate"
   ```

3. Monitor logs for immediate restart:
   ```bash
   tail -f /tmp/moltbot/pm2-out.log | grep -E "(config change|SIGUSR1|received SIGUSR1)"
   ```

4. Verify logs show:
   ```
   [reload] config change requires gateway restart (gateway.testSetting)
   [reload] emitting SIGUSR1 for gateway restart (active runs: 0)
   [gateway] signal SIGUSR1 received
   [gateway] received SIGUSR1; restarting
   ```

5. Verify gateway restarts:
   ```bash
   pm2 list | grep moltbot-gateway
   ```

### Expected Result

✅ Config change triggers immediate restart
✅ No active runs at time of restart
✅ Gateway restarts cleanly
✅ Logs show restart sequence

---

## Test 4: Multiple Concurrent Messages

**Objective:** Verify that concurrent messages don't trigger restarts.

### Steps

1. Send multiple messages rapidly:
   ```bash
   for i in {1..5}; do
     moltbot agent --message "concurrent test $i" --thinking on &
   done
   ```

2. Monitor logs for active runs:
   ```bash
   tail -f /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log | grep "agent run registered"
   ```

3. Verify all messages complete:
   ```bash
   # Check for restarts
   grep -c "SIGUSR1" /tmp/moltbot/pm2-out.log
   ```

4. Verify all messages get responses.

### Expected Result

✅ All 5 messages process without restarts
✅ No SIGUSR1 signals during concurrent processing
✅ All messages receive responses

---

## Test 5: Long-Running Message During Config Change

**Objective:** Verify that long-running messages are protected from restarts.

### Steps

1. Send a long-running command:
   ```
   run sleep 30
   ```

2. Wait 5 seconds for agent to start processing.

3. Trigger config change:
   ```bash
   moltbot config set gateway.testSetting "long-running-test"
   ```

4. Monitor logs:
   ```bash
   tail -f /tmp/moltbot/pm2-out.log | grep -E "(config change|deferring|agent run)"
   ```

5. Verify deferred restart message appears:
   ```
   [reload] config change requires gateway restart, but deferring (1 active agent run: <runId>)
   ```

6. Wait for sleep command to complete (30 seconds).

7. Verify restart occurs after completion:
   ```bash
   grep -E "(applying queued|SIGUSR1)" /tmp/moltbot/pm2-out.log | tail -5
   ```

### Expected Result

✅ Config change deferred during long-running command
✅ Long-running command completes successfully
✅ Restart applied after command completes
✅ No interruption of long-running process

---

## Pass Criteria

All tests must pass for the fix to be considered successful:

✅ **Test 1:** Message processes without restart
✅ **Test 2:** Config change deferred until message completes
✅ **Test 3:** Config change with no active runs restarts immediately
✅ **Test 4:** Concurrent messages don't trigger restarts
✅ **Test 5:** Long-running messages protected from restarts
✅ **No log errors** (except expected deferred restart messages)
✅ **All messages receive responses**

## Troubleshooting

### If messages don't complete:

1. Check gateway is running:
   ```bash
   pm2 list | grep moltbot-gateway
   ```

2. Check for errors:
   ```bash
   tail -100 /tmp/moltbot/pm2-error.log
   ```

3. Check config file:
   ```bash
   cat ~/.clawdbot/moltbot.json
   ```

### If restarts still occur during messages:

1. Verify Modules 1-5 are deployed:
   ```bash
   # Check config-reload.ts has deferred restart logic
   grep -A 5 "getActiveAgentRunCount" src/gateway/config-reload.ts
   ```

2. Check debounce setting:
   ```bash
   moltbot config get gateway.reload.debounceMs
   ```
   Expected: `2000` (or higher)

3. Check for config write loops:
   ```bash
   tail -f /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log | grep "writing config file"
   ```

### If deferred restart messages don't appear:

1. Check agent-events.ts logging:
   ```bash
   DEBUG=agent moltbot gateway run --port 18789
   ```

2. Verify agent run tracking:
   ```bash
   # Look for registration and clearing
   grep -E "(agent run registered|agent run cleared)" /tmp/moltbot/moltbot-*.log
   ```

## Running the Full Test Suite

To run all tests in sequence:

```bash
# Test 1: Simple message
echo "=== Test 1: Simple Message ==="
# Send "hi" in Telegram and verify logs

# Test 2: Config change during message
echo "=== Test 2: Config Change During Message ==="
# Send "run echo 'test'" and modify config

# Test 3: Config change without active runs
echo "=== Test 3: Config Change Without Active Runs ==="
# Wait for idle, then modify config

# Test 4: Concurrent messages
echo "=== Test 4: Concurrent Messages ==="
# Send 5 messages rapidly

# Test 5: Long-running message
echo "=== Test 5: Long-Running Message ==="
# Send "run sleep 30" and modify config

# Summary
echo "=== All Tests Complete ==="
# Review logs for pass/fail criteria
```

## Running the 24-Hour Stability Test

```bash
# Run full 24-hour stability test
cd /root/moltbot
chmod +x scripts/stability-test.sh
DURATION_HOURS=24 ./scripts/stability-test.sh

# Monitor progress
tail -f /tmp/moltbot-stability-test.log
```

Expected results after 24 hours:
- Zero restarts during message processing
- 100% message completion rate
- Deferred restart count > 0 (proves logic is working)
- Applied queued restarts = Deferred restarts (no lost restarts)
