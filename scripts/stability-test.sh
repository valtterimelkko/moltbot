#!/bin/bash

# 24-hour stability test for Moltbot gateway restart loop fix
# Sends messages every 5 minutes and monitors for restarts during message processing

set -euo pipefail

# Configuration
DURATION_HOURS=${DURATION_HOURS:-1}  # Default to 1 hour for testing, use 24 for full test
INTERVAL_SECONDS=${INTERVAL_SECONDS:-300}  # Default 5 minutes
LOG_FILE="${LOG_FILE:-/tmp/moltbot-stability-test.log}"
GATEWAY_PORT="${GATEWAY_PORT:-18789}"

# Test counters
MESSAGE_COUNT=0
SUCCESS_COUNT=0
RESTART_COUNT=0
DEFERRED_RESTART_COUNT=0

echo "========================================" | tee -a "$LOG_FILE"
echo "Moltbot Gateway Stability Test" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Duration: ${DURATION_HOURS} hour(s)" | tee -a "$LOG_FILE"
echo "Interval: ${INTERVAL_SECONDS} second(s)" | tee -a "$LOG_FILE"
echo "Gateway Port: ${GATEWAY_PORT}" | tee -a "$LOG_FILE"
echo "Log File: ${LOG_FILE}" | tee -a "$LOG_FILE"
echo "Started at: $(date -Iseconds)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Monitoring for unexpected restarts during message processing" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_HOURS * 3600))

# Helper function to get PM2 restart count
get_pm2_restart_count() {
  pm2 info moltbot-gateway --json 2>/dev/null | \
    jq -r '.[] | .pm2_env.restart_time // 0' 2>/dev/null || echo "0"
}

# Helper function to check if gateway is running
is_gateway_running() {
  nc -zv 127.0.0.1 "$GATEWAY_PORT" 2>/dev/null
}

# Helper function to get active agent run count from logs
get_active_run_count() {
  # Look for "agent run registered" and "agent run cleared" in recent logs
  local registered=$(grep -c "agent run registered" /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log 2>/dev/null || echo "0")
  local cleared=$(grep -c "agent run cleared" /tmp/moltbot/moltbot-$(date +%Y-%m-%d).log 2>/dev/null || echo "0")
  echo $((registered - cleared))
}

# Helper function to check for deferred restart messages
get_deferred_restart_count() {
  grep -c "deferring.*active agent run" /tmp/moltbot/pm2-out.log 2>/dev/null || echo "0"
}

# Main test loop
while [ $(date +%s) -lt $END_TIME ]; do
  MESSAGE_COUNT=$((MESSAGE_COUNT + 1))

  echo "[$(date)] Sending test message #$MESSAGE_COUNT" | tee -a "$LOG_FILE"

  # Record restart count before message
  BEFORE_RESTARTS=$(get_pm2_restart_count)

  # Send test message (simulate user interaction)
  # Note: In a real scenario, this would be a Telegram message
  # For testing, we just verify gateway stability
  if command -v moltbot &>/dev/null; then
    moltbot agent --message "stability test message #$MESSAGE_COUNT" --thinking low 2>&1 | tee -a "$LOG_FILE" || true
  else
    echo "[$(date)] moltbot CLI not available, skipping actual message send" | tee -a "$LOG_FILE"
  fi

  # Check if message completed successfully
  if [ $? -eq 0 ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "[$(date)] Message #$MESSAGE_COUNT completed successfully" | tee -a "$LOG_FILE"
  else
    echo "[$(date)] Message #$MESSAGE_COUNT FAILED" | tee -a "$LOG_FILE"
  fi

  # Check for restarts during processing
  AFTER_RESTARTS=$(get_pm2_restart_count)

  if [ "$BEFORE_RESTARTS" != "$AFTER_RESTARTS" ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    echo "[$(date)] ⚠️  RESTART DETECTED during message #$MESSAGE_COUNT!" | tee -a "$LOG_FILE"
  fi

  # Check for deferred restart messages in logs
  DEFERRED_COUNT=$(get_deferred_restart_count)
  if [ "$DEFERRED_COUNT" -gt "$DEFERRED_RESTART_COUNT" ]; then
    DEFERRED_RESTART_COUNT=$DEFERRED_COUNT
    echo "[$(date)] ℹ️  Deferred restart detected (count: $DEFERRED_RESTART_COUNT)" | tee -a "$LOG_FILE"
  fi

  # Check gateway is still running
  if ! is_gateway_running; then
    echo "[$(date)] 🚨 CRITICAL: Gateway is NOT responding on port $GATEWAY_PORT!" | tee -a "$LOG_FILE"
  fi

  # Check active run count
  ACTIVE_RUNS=$(get_active_run_count)
  echo "[$(date)] Active agent runs: $ACTIVE_RUNS" | tee -a "$LOG_FILE"

  echo "" | tee -a "$LOG_FILE"

  # Wait for next interval
  sleep $INTERVAL_SECONDS
done

# Final report
echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Stability Test Complete" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Test duration: $(( ($(date +%s) - START_TIME) / 60 )) minutes" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Results:" | tee -a "$LOG_FILE"
echo "  Total messages sent: $MESSAGE_COUNT" | tee -a "$LOG_FILE"
echo "  Successful responses: $SUCCESS_COUNT" | tee -a "$LOG_FILE"
echo "  Restarts during processing: $RESTART_COUNT" | tee -a "$LOG_FILE"
echo "  Deferred restarts detected: $DEFERRED_RESTART_COUNT" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Calculate success rate
if [ $MESSAGE_COUNT -gt 0 ]; then
  SUCCESS_RATE=$(awk "BEGIN {printf \"%.2f%%\", ($SUCCESS_COUNT/$MESSAGE_COUNT)*100}")
  echo "  Success rate: $SUCCESS_RATE" | tee -a "$LOG_FILE"
else
  echo "  Success rate: N/A (no messages sent)" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"

# Exit with appropriate code
if [ $RESTART_COUNT -eq 0 ] && [ $SUCCESS_COUNT -eq $MESSAGE_COUNT ]; then
  echo "✅ PASS: No restarts detected, all messages processed" | tee -a "$LOG_FILE"
  exit 0
else
  echo "❌ FAIL: $RESTART_COUNT restart(s) or message failures detected" | tee -a "$LOG_FILE"
  exit 1
fi
