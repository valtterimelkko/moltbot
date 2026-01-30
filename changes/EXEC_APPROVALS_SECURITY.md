# Exec Approvals Security Policy

## Problem

The agent was executing dangerous bash commands that terminated the gateway:
```
[DEBUG EXEC] Starting exec tool with command: ps aux | grep -i "moltbot"
[DEBUG EXEC] Starting exec tool with command: kill 1364076
```

This occurred on every message, causing the bot to timeout and gateway restart.

## Root Cause

1. **Default exec security mode for gateway host**: "allowlist" (not "deny")
2. **No exec-approvals.json file**: Empty/missing defaults allowed unrestricted execution
3. **Agent autonomy**: LLM model was making independent decisions to manage gateway processes

## Solution

Created `/root/.clawdbot/exec-approvals.json` with security policy:

```json
{
  "version": 1,
  "defaults": {
    "security": "deny"
  },
  "agents": {
    "main": {
      "security": "deny",
      "ask": "always",
      "allowlist": [
        { "pattern": "^(cat|head|tail|less|more)\\s" },
        { "pattern": "^(grep|rg|ack)\\s" },
        { "pattern": "^(ls|find|locate)\\s" },
        { "pattern": "^git\\s(log|diff|status|show|blame|branch|tag|remote)\\b" },
        { "pattern": "^(npm|pnpm|bun)\\s(list|view|info|search)\\b" }
      ]
    }
  }
}
```

## Security Model

- **Default**: "deny" - blocks all exec commands
- **Agent**: "allowlist" - only safe read-only commands allowed
- **Approval**: "always" - any command outside allowlist requires human approval
- **Blocked**: process management (kill, ps, killall, pkill)
- **Blocked**: destructive commands (rm -rf, dd, mkfs, reboot, shutdown)
- **Allowed**: safe reads (cat, grep, ls, git log, npm list, etc.)

## Installation

The exec-approvals.json file is created at runtime by the gateway if missing. To apply security policies:

1. Create `/root/.clawdbot/exec-approvals.json` with desired policy
2. Restart gateway: `sudo systemctl restart moltbot-gateway`
3. Test: Send a message that doesn't require exec access

## Verification

After restart, monitor logs:
```bash
tail -f /tmp/moltbot/systemd-error.log | grep -i "exec\|kill"
```

Should show NO `[DEBUG EXEC]` commands for dangerous operations.

## Related Files

- **Schema**: `/root/moltbot/src/infra/exec-approvals.ts`
- **Implementation**: `/root/moltbot/src/agents/bash-tools.exec.ts`
- **Config Location**: `~/.clawdbot/exec-approvals.json`

## Escalation

If agent needs to run exec commands:
1. Add pattern to allowlist (for safe commands)
2. Or, ask user for approval (ask mode: "always" prompts human)
3. Or, use `security: "ask"` per-command from agent code
