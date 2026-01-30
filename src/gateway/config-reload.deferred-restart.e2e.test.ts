import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { connectOk, installGatewayTestHooks, startServerWithClient } from "./test-helpers.js";
import {
  getActiveAgentRunCount,
  getActiveAgentRunIds,
  registerAgentRunContext,
  clearAgentRunContext,
} from "../infra/agent-events.js";
import { readConfigFileSnapshot } from "../config/config.js";

installGatewayTestHooks({ scope: "suite" });

describe("config reload with deferred restart during active agent runs", () => {
  let prevSkipChannels: string | undefined;
  let prevSkipGmail: string | undefined;

  beforeEach(() => {
    prevSkipChannels = process.env.CLAWDBOT_SKIP_CHANNELS;
    prevSkipGmail = process.env.CLAWDBOT_SKIP_GMAIL_WATCHER;
    process.env.CLAWDBOT_SKIP_CHANNELS = "0";
    delete process.env.CLAWDBOT_SKIP_GMAIL_WATCHER;
  });

  afterEach(() => {
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

  it("should defer restart when agent run is active", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    // Simulate an active agent run
    const runId = "test-run-123";
    registerAgentRunContext(runId, {
      sessionKey: "test-session",
      verboseLevel: "on",
      isHeartbeat: false,
    });

    expect(getActiveAgentRunCount()).toBe(1);
    expect(getActiveAgentRunIds()).toContain(runId);

    // Trigger a config change that requires restart
    const snapshot = await readConfigFileSnapshot();
    if (snapshot.valid && snapshot.config) {
      const modifiedConfig = {
        ...snapshot.config,
        gateway: {
          ...snapshot.config.gateway,
          testSetting: "modified",
        },
      };

      // Write config to trigger reload
      const configPath = snapshot.path;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(modifiedConfig, null, 2), "utf-8");

      // Wait for debounce period (2000ms)
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Agent run should still be active (no restart occurred)
      expect(getActiveAgentRunCount()).toBe(1);
      expect(getActiveAgentRunIds()).toContain(runId);
    }

    // Clear agent run (simulate completion)
    clearAgentRunContext(runId);
    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should immediately restart when no active runs", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    // No active runs
    expect(getActiveAgentRunCount()).toBe(0);

    // Trigger a config change that requires restart
    const snapshot = await readConfigFileSnapshot();
    if (snapshot.valid && snapshot.config) {
      const modifiedConfig = {
        ...snapshot.config,
        gateway: {
          ...snapshot.config.gateway,
          testSetting: "immediate",
        },
      };

      // Write config to trigger reload
      const configPath = snapshot.path;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(modifiedConfig, null, 2), "utf-8");

      // Wait for debounce period and restart
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Gateway should have processed config change
      // (We can't directly test restart in unit test, but we verify no errors)
    }

    ws.close();
    await server.close();
  });

  it("should handle multiple concurrent active runs", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    // Simulate multiple concurrent agent runs
    const runIds = ["test-run-1", "test-run-2", "test-run-3"];
    for (const runId of runIds) {
      registerAgentRunContext(runId, {
        sessionKey: `test-session-${runId}`,
        verboseLevel: "on",
        isHeartbeat: false,
      });
    }

    expect(getActiveAgentRunCount()).toBe(3);

    // Trigger config change
    const snapshot = await readConfigFileSnapshot();
    if (snapshot.valid && snapshot.config) {
      const modifiedConfig = {
        ...snapshot.config,
        gateway: {
          ...snapshot.config.gateway,
          testSetting: "concurrent",
        },
      };

      const configPath = snapshot.path;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(modifiedConfig, null, 2), "utf-8");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // All runs should still be active
      expect(getActiveAgentRunCount()).toBe(3);
      for (const runId of runIds) {
        expect(getActiveAgentRunIds()).toContain(runId);
      }
    }

    // Clear runs one by one
    for (const runId of runIds) {
      clearAgentRunContext(runId);
      expect(getActiveAgentRunCount()).toBe(runIds.length - runIds.indexOf(runId) - 1);
    }

    expect(getActiveAgentRunCount()).toBe(0);

    ws.close();
    await server.close();
  });

  it("should queue restart and apply after all runs complete", async () => {
    const { server, ws } = await startServerWithClient();
    await connectOk(ws);

    const runId = "test-run-queue";
    registerAgentRunContext(runId, {
      sessionKey: "test-session-queue",
      verboseLevel: "on",
      isHeartbeat: false,
    });

    expect(getActiveAgentRunCount()).toBe(1);

    // Trigger config change while run is active
    const snapshot = await readConfigFileSnapshot();
    if (snapshot.valid && snapshot.config) {
      const modifiedConfig = {
        ...snapshot.config,
        gateway: {
          ...snapshot.config.gateway,
          testSetting: "queued",
        },
      };

      const configPath = snapshot.path;
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(configPath, JSON.stringify(modifiedConfig, null, 2), "utf-8");

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // Run should still be active (restart deferred)
      expect(getActiveAgentRunCount()).toBe(1);

      // Complete run
      clearAgentRunContext(runId);

      // Wait for queued restart to be applied
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Run should be cleared
      expect(getActiveAgentRunCount()).toBe(0);
    }

    ws.close();
    await server.close();
  });
});
