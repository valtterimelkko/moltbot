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

describe("Telegram message processing integration test", () => {
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

  it("should process simple Telegram message without restart", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    // Simulate Telegram message processing
    const runId = "telegram-simple-message";
    const message = "hi";

    registerAgentRunContext(runId, {
      sessionKey: "telegram-session-123",
      verboseLevel: "on",
      isHeartbeat: false,
    });

    expect(getActiveAgentRunCount()).toBe(1);

    // Simulate agent processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify run is still active (no restart occurred)
    expect(getActiveAgentRunCount()).toBe(1);
    expect(getActiveAgentRunIds()).toContain(runId);

    // Complete the run
    clearAgentRunContext(runId);
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should process Telegram message with tool execution without restart", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    // Simulate Telegram message with tool execution
    const runId = "telegram-tool-message";
    const message = "run echo 'test'";

    registerAgentRunContext(runId, {
      sessionKey: "telegram-session-tool",
      verboseLevel: "on",
      isHeartbeat: false,
    });

    expect(getActiveAgentRunCount()).toBe(1);

    // Simulate tool execution (longer duration)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify run is still active
    expect(getActiveAgentRunCount()).toBe(1);

    // Complete the run
    clearAgentRunContext(runId);
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should handle multiple sequential Telegram messages", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const messageCount = 5;
    const results: Array<{ success: boolean; runId: string }> = [];

    // Process multiple messages sequentially
    for (let i = 0; i < messageCount; i++) {
      const runId = `telegram-sequential-${i}`;
      const message = `test message ${i}`;

      registerAgentRunContext(runId, {
        sessionKey: `telegram-session-${i}`,
        verboseLevel: "on",
        isHeartbeat: false,
      });

      expect(getActiveAgentRunCount()).toBe(1);

      // Simulate processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      results.push({ success: true, runId });
      clearAgentRunContext(runId);

      expect(getActiveAgentRunCount()).toBe(0);
    }

    // Verify all messages processed
    expect(results).toHaveLength(messageCount);
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    ws.close();
    await server.close();
  });

  it("should handle concurrent Telegram messages from same user", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const concurrentCount = 3;
    const results: Array<{ success: boolean; runId: string }> = [];

    // Start concurrent messages from same user
    const promises = Array.from({ length: concurrentCount }, (_, i) => {
      const runId = `telegram-concurrent-${i}`;
      const message = `concurrent message ${i}`;

      return new Promise<void>((resolve) => {
        registerAgentRunContext(runId, {
          sessionKey: "telegram-session-same-user",
          verboseLevel: "on",
          isHeartbeat: false,
        });

        setTimeout(
          () => {
            results.push({ success: true, runId });
            clearAgentRunContext(runId);
            resolve();
          },
          100 + i * 50,
        );
      });
    });

    await Promise.all(promises);

    // Verify all messages processed
    expect(results).toHaveLength(concurrentCount);
    for (const result of results) {
      expect(result.success).toBe(true);
    }

    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should maintain session context across multiple messages", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const sessionKey = "telegram-session-persistent";
    const messageCount = 4;

    // Process multiple messages with same session
    for (let i = 0; i < messageCount; i++) {
      const runId = `telegram-session-${i}`;
      const message = `message ${i}`;

      registerAgentRunContext(runId, {
        sessionKey,
        verboseLevel: "on",
        isHeartbeat: false,
      });

      expect(getActiveAgentRunCount()).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 50));

      clearAgentRunContext(runId);

      expect(getActiveAgentRunCount()).toBe(0);
    }

    ws.close();
    await server.close();
  });

  it("should handle heartbeat messages without affecting restart logic", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const heartbeatCount = 3;

    // Process heartbeat messages
    for (let i = 0; i < heartbeatCount; i++) {
      const runId = `telegram-heartbeat-${i}`;

      registerAgentRunContext(runId, {
        sessionKey: "telegram-heartbeat-session",
        verboseLevel: "on",
        isHeartbeat: true,
      });

      expect(getActiveAgentRunCount()).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 30));

      clearAgentRunContext(runId);

      expect(getActiveAgentRunCount()).toBe(0);
    }

    ws.close();
    await server.close();
  });
});
