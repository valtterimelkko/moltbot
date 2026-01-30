# 🎯 CRITICAL ROOT CAUSE FOUND

## The Problem is NOT in Moltbot Code

**The agent is intentionally killing the gateway in response to "hello".**

### Evidence

From PM2 error logs (stderr):
```
2026-01-30 22:44:22 +00:00: [DEBUG EXEC] Starting exec tool with command: ps aux | grep -i "moltbot"
2026-01-30 22:44:34 +00:00: [DEBUG EXEC] Starting exec tool with command: kill 1350845
```

**Timeline:**
1. User sends "hello" to bot via Telegram
2. Agent processes message
3. Agent runs: `ps aux | grep -i "moltbot"`  (lists processes)
4. 12 seconds later...
5. Agent runs: `kill 1350845` (kills the gateway PID)
6. Gateway receives SIGTERM and shuts down
7. PM2 restarts gateway
8. User never sees response

---

## This is NOT:

❌ **Config reload issue** - No config changed, no SIGUSR1 emitted
❌ **Health monitor issue** - Monitor checks every 5 minutes, not due for 4+ more minutes
❌ **Queue overflow issue** - Queue handling works fine
❌ **Telegram bot ID issue** - Wrong channel, same problem would occur anywhere
❌ **PM2 bug** - PM2 is correctly restarting as intended
❌ **Moltbot code bug** - Code is unchanged, this started 2 days ago

## This IS:

✅ **Agent behavior change** - The Claude model/agent is deciding to kill the gateway
✅ **Intentional commands** - Two separate exec calls, not random crash
✅ **Deterministic** - Happens every time you send a message

---

## Root Cause: Unknown Instructions to Agent

**The agent is being told (by something) to:**
1. Check if moltbot processes are running
2. Kill the gateway process

This could be from:
- **SOUL.md** - Instructions about auto-healing or self-restart?
- **Workspace prompt injection** - Injected system prompt?
- **Skill with auto-execution** - A skill that runs `kill`?
- **Claude model behavior** - Change in model's default actions?
- **Agent system prompt** - Explicit instruction to manage gateway?
- **External configuration** - Some config telling agent to "restart gateway"?

---

## Key Question for You

**What changed 2 days ago?**

Possibilities:
1. Did you update the agent's workspace files (SOUL.md, AGENTS.md, etc.)?
2. Did you add a new skill that might auto-execute?
3. Did you change the Claude model being used?
4. Did you modify the agent's system prompt?
5. Did you update Moltbot itself?
6. Did something in `/root/clawd/` change?
7. Did you enable some kind of "auto-healing" or "auto-restart" feature?

---

## Next Steps

**We need to find why the agent thinks it should kill itself.**

Check these files for any instructions about:
- "restart gateway"
- "kill moltbot"
- "check process"
- "monitor health"
- "auto-restart"

Files to check:
- `/root/clawd/SOUL.md` - Does it mention gateway management?
- `/root/clawd/AGENTS.md` - Any auto-healing instructions?
- `/root/clawd/MEMORY.md` - Any recorded tasks?
- `/root/clawd/memory/2026-01-29.md` - What happened 2 days ago?
- Agent system prompt or config - Any changes?

---

## Once We Know What Changed

We can either:
1. **Remove the instruction** from the workspace
2. **Modify the skill** that's executing the kill command
3. **Revert the agent configuration** to before 2 days ago
4. **Disable the auto-execution** mechanism

But first we need to understand: **Why is the agent being told to kill the gateway?**

