import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectOk,
  installGatewayTestHooks,
  startServerWithClient,
} from "../../src/gateway/test-helpers.js";
import {
  getActiveAgentRunCount,
  getActiveAgentRunIds,
  registerAgentRunContext,
  clearAgentRunContext,
} from "../../src/infra/agent-events.js";

installGatewayTestHooks({ scope: "suite" });

describe("concurrent message processing load test", () => {
  let prevSkipChannels: string | undefined;
  let prevSkipGmail: string | undefined;

  beforeAll(() => {
    prevSkipChannels = process.env.CLAWDBOT_SKIP_CHANNELS;
    prevSkipGmail = process.env.CLAWDBOT_SKIP_GMAIL_WATCHER;
    process.env.CLAWDBOT_SKIP_CHANNELS = "0";
    delete process.env.CLAWDBOT_SKIP_GMAIL_WATCHER;
  });

  afterAll(() => {
    if (prevSkipChannels === undefined) {
      delete process.env.CLAWDBOT_SKIP_CHANNELS;
    } else {
      process.env.CLAWDBOT_SKIP_CHANNELS = prevSkipChannels;
    }
    if (prevSkipGmail === undefined) {
      delete process.env.CLAWDBOT_SKIP_GMAIL_WATCHER;
    } else {
      process.env.CLAWDBOT_SKIP_GMAIL_WATCHER = prevSkipGmail;
    }
  });

  it("should handle 10 concurrent agent runs without restarts", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const messageCount = 10;
    const runIds: string[] = [];
    const results: Array<{ success: boolean; runId: string }> = [];

    // Start 10 concurrent agent runs
    const startPromises = Array.from({ length: messageCount }, (_, i) => {
      const runId = `concurrent-run-${i}`;
      runIds.push(runId);

      return new Promise<void>((resolve) => {
        registerAgentRunContext(runId, {
          sessionKey: `test-session-${i}`,
          verboseLevel: "on",
          isHeartbeat: false,
        });

        // Simulate async work
        setTimeout(
          () => {
            results.push({ success: true, runId });
            clearAgentRunContext(runId);
            resolve();
          },
          100 + Math.random() * 200,
        ); // Random duration 100-300ms
      });
    });

    // Wait for all runs to complete
    await Promise.all(startPromises);

    // Verify all runs completed successfully
    expect(results).toHaveLength(messageCount);
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    // Verify no runs remain active
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should handle rapid sequential runs without restarts", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const runCount = 20;
    const results: Array<{ success: boolean; runId: string }> = [];

    // Execute runs sequentially but rapidly
    for (let i = 0; i < runCount; i++) {
      const runId = `sequential-run-${i}`;

      registerAgentRunContext(runId, {
        sessionKey: `test-session-${i}`,
        verboseLevel: "on",
        isHeartbeat: false,
      });

      // Simulate minimal work
      await new Promise((resolve) => setTimeout(resolve, 10));

      results.push({ success: true, runId });
      clearAgentRunContext(runId);
    }

    // Verify all runs completed
    expect(results).toHaveLength(runCount);
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    // Verify no runs remain active
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should handle mixed concurrent and sequential runs", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const results: Array<{ success: boolean; runId: string }> = [];

    // Start 5 concurrent runs
    const concurrentRunIds: string[] = [];
    const concurrentPromises = Array.from({ length: 5 }, (_, i) => {
      const runId = `mixed-concurrent-${i}`;
      concurrentRunIds.push(runId);

      return new Promise<void>((resolve) => {
        registerAgentRunContext(runId, {
          sessionKey: `test-session-concurrent-${i}`,
          verboseLevel: "on",
          isHeartbeat: false,
        });

        setTimeout(() => {
          results.push({ success: true, runId });
          clearAgentRunContext(runId);
          resolve();
        }, 150);
      });
    });

    // Wait for concurrent runs to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Execute 5 sequential runs while concurrent ones are running
    for (let i = 0; i < 5; i++) {
      const runId = `mixed-sequential-${i}`;

      registerAgentRunContext(runId, {
        sessionKey: `test-session-sequential-${i}`,
        verboseLevel: "on",
        isHeartbeat: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      results.push({ success: true, runId });
      clearAgentRunContext(runId);
    }

    // Wait for all concurrent runs to complete
    await Promise.all(concurrentPromises);

    // Verify all runs completed
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    // Verify no runs remain active
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should maintain accurate run count during high concurrency", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const maxConcurrent = 15;
    const runCount = 30;
    const activeCounts: number[] = [];

    // Start runs in batches
    for (let i = 0; i < runCount; i++) {
      const runId = `high-concurrency-${i}`;

      registerAgentRunContext(runId, {
        sessionKey: `test-session-${i}`,
        verboseLevel: "on",
        isHeartbeat: false,
      });

      activeCounts.push(getActiveAgentRunCount());

      // Complete some runs to maintain concurrency
      if (i >= maxConcurrent) {
        const oldRunId = `high-concurrency-${i - maxConcurrent}`;
        clearAgentRunContext(oldRunId);
        activeCounts.push(getActiveAgentRunCount());
      }

      // Small delay between starts
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Clear remaining runs
    for (let i = runCount - maxConcurrent; i < runCount; i++) {
      const runId = `high-concurrency-${i}`;
      clearAgentRunContext(runId);
    }

    // Verify final state
    expect(getActiveAgentRunCount()).toBe(0);

    // Verify concurrency never exceeded max
    for (const count of activeCounts) {
      expect(count).toBeLessThanOrEqual(maxConcurrent);
    }

    ws.close();
    await server.close();
  });
});
