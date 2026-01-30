import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  clearAgentRunContext,
  emitAgentEvent,
  getAgentRunContext,
  onAgentEvent,
  registerAgentRunContext,
  resetAgentRunContextForTest,
  getActiveAgentRunCount,
  onAgentRunComplete,
} from "./agent-events.js";

describe("agent-events sequencing", () => {
  test("stores and clears run context", async () => {
    resetAgentRunContextForTest();
    registerAgentRunContext("run-1", { sessionKey: "main" });
    expect(getAgentRunContext("run-1")?.sessionKey).toBe("main");
    clearAgentRunContext("run-1");
    expect(getAgentRunContext("run-1")).toBeUndefined();
  });

  test("maintains monotonic seq per runId", async () => {
    const seen: Record<string, number[]> = {};
    const stop = onAgentEvent((evt) => {
      const list = seen[evt.runId] ?? [];
      seen[evt.runId] = list;
      list.push(evt.seq);
    });

    emitAgentEvent({ runId: "run-1", stream: "lifecycle", data: {} });
    emitAgentEvent({ runId: "run-1", stream: "lifecycle", data: {} });
    emitAgentEvent({ runId: "run-2", stream: "lifecycle", data: {} });
    emitAgentEvent({ runId: "run-1", stream: "lifecycle", data: {} });

    stop();

    expect(seen["run-1"]).toEqual([1, 2, 3]);
    expect(seen["run-2"]).toEqual([1]);
  });

  test("preserves compaction ordering on the event bus", async () => {
    const phases: Array<string> = [];
    const stop = onAgentEvent((evt) => {
      if (evt.runId !== "run-1") return;
      if (evt.stream !== "compaction") return;
      if (typeof evt.data?.phase === "string") phases.push(evt.data.phase);
    });

    emitAgentEvent({ runId: "run-1", stream: "compaction", data: { phase: "start" } });
    emitAgentEvent({
      runId: "run-1",
      stream: "compaction",
      data: { phase: "end", willRetry: false },
    });

    stop();

    expect(phases).toEqual(["start", "end"]);
  });
});

describe("agent run tracking", () => {
  beforeEach(() => {
    resetAgentRunContextForTest();
  });

  test("should track active runs correctly", () => {
    expect(getActiveAgentRunCount()).toBe(0);

    registerAgentRunContext("run-1", {});
    expect(getActiveAgentRunCount()).toBe(1);

    registerAgentRunContext("run-2", {});
    expect(getActiveAgentRunCount()).toBe(2);

    clearAgentRunContext("run-1");
    expect(getActiveAgentRunCount()).toBe(1);

    clearAgentRunContext("run-2");
    expect(getActiveAgentRunCount()).toBe(0);
  });

  test("should fire completion callbacks", () => {
    const callback = vi.fn();
    const unregister = onAgentRunComplete(callback);

    registerAgentRunContext("run-1", {});
    expect(callback).not.toHaveBeenCalled();

    clearAgentRunContext("run-1");
    expect(callback).toHaveBeenCalledTimes(1);

    unregister();
  });

  test("should not fire callback when clearing non-existent run", () => {
    const callback = vi.fn();
    onAgentRunComplete(callback);

    clearAgentRunContext("non-existent");
    expect(callback).not.toHaveBeenCalled();
  });

  test("should update existing run context", () => {
    registerAgentRunContext("run-1", {
      sessionKey: "original",
      verboseLevel: "off",
      isHeartbeat: false,
    });

    expect(getAgentRunContext("run-1")).toEqual({
      sessionKey: "original",
      verboseLevel: "off",
      isHeartbeat: false,
    });

    registerAgentRunContext("run-1", {
      sessionKey: "updated",
      verboseLevel: "full",
      isHeartbeat: true,
    });

    expect(getAgentRunContext("run-1")).toEqual({
      sessionKey: "updated",
      verboseLevel: "full",
      isHeartbeat: true,
    });

    // Should still only have one run
    expect(getActiveAgentRunCount()).toBe(1);
  });
});
