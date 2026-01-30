import type { VerboseLevel } from "../auto-reply/thinking.js";

// Simple logger for agent events diagnostics
const agentLog = {
  debug: (msg: string) => {
    if (process.env.DEBUG?.includes("agent") || process.env.DEBUG === "*") {
      console.debug(`[agent] ${msg}`);
    }
  },
  warn: (msg: string) => {
    console.warn(`[agent] ${msg}`);
  },
};

export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
};

// Keep per-run counters so streams stay strictly monotonic per runId.
const seqByRun = new Map<string, number>();
const listeners = new Set<(evt: AgentEventPayload) => void>();
const runContextById = new Map<string, AgentRunContext>();
const runCompletionCallbacks = new Set<() => void>();

// Defensive timeout for stale runs (10 minutes)
const MAX_RUN_DURATION_MS = 10 * 60 * 1000;
const runStartTimes = new Map<string, number>();

export function registerAgentRunContext(runId: string, context: AgentRunContext) {
  if (!runId) return;
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, { ...context });
    runStartTimes.set(runId, Date.now());

    // Schedule automatic cleanup for stale runs
    setTimeout(() => {
      if (runContextById.has(runId)) {
        agentLog.warn(
          `force-clearing stale agent run: ${runId} (exceeded ${MAX_RUN_DURATION_MS}ms)`,
        );
        clearAgentRunContext(runId);
      }
    }, MAX_RUN_DURATION_MS);

    agentLog.debug(`agent run registered: ${runId} (total active: ${runContextById.size})`);
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.verboseLevel && existing.verboseLevel !== context.verboseLevel) {
    existing.verboseLevel = context.verboseLevel;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
}

export function getAgentRunContext(runId: string) {
  return runContextById.get(runId);
}

export function clearAgentRunContext(runId: string) {
  const existed = runContextById.has(runId);
  runContextById.delete(runId);
  runStartTimes.delete(runId);
  if (existed) {
    agentLog.debug(`agent run cleared: ${runId} (remaining active: ${runContextById.size})`);
    // Notify callbacks that a run has completed
    for (const callback of runCompletionCallbacks) {
      try {
        callback();
      } catch {
        /* ignore */
      }
    }
  }
}

export function onAgentRunComplete(callback: () => void): () => void {
  runCompletionCallbacks.add(callback);
  return () => runCompletionCallbacks.delete(callback);
}

export function getActiveAgentRunCount(): number {
  return runContextById.size;
}

export function getActiveAgentRunIds(): string[] {
  return Array.from(runContextById.keys());
}

export function resetAgentRunContextForTest() {
  runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const context = runContextById.get(event.runId);
  const sessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim()
      ? event.sessionKey
      : context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      /* ignore */
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
