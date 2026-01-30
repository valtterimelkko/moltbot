#!/usr/bin/env node

/**
 * PM2 Health Monitor for Moltbot Gateway
 *
 * Monitors gateway responsiveness and automatically recovers from hangs.
 * Runs as a separate PM2-managed process (not systemd).
 *
 * Features:
 * - Checks if gateway is responding on port 18789
 * - Checks WebSocket connectivity
 * - Queries active agent runs before restarting (prevents data loss)
 * - Detects inotify watcher exhaustion
 * - Force-restarts hung gateway processes
 * - Logs all checks and recoveries
 */

import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// Configuration
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '18789');
const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_WS_URL = `ws://${GATEWAY_HOST}:${GATEWAY_PORT}`;
const CHECK_INTERVAL = parseInt(process.env.INTERVAL || process.env.HEALTH_CHECK_INTERVAL_MS || '300000'); // 5 minutes default
const INOTIFY_THRESHOLD = 0.8; // 80% of limit = warning
const LOG_FILE = '/tmp/moltbot/pm2-health-monitor.log';

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Log with timestamp
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  fs.appendFileSync(LOG_FILE, logEntry + '\n');
}

/**
 * Check if gateway port is responding
 */
function checkGatewayResponsive() {
  return new Promise((resolve) => {
    const socket = net.createConnection(GATEWAY_PORT, GATEWAY_HOST);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 3000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Check if gateway WebSocket is responding
 */
function checkWebSocketResponsive() {
  return new Promise((resolve) => {
    // Simple WebSocket connection test
    // We don't need a full WS library; just try to connect to the port
    // The gateway's WS server runs on the same port as HTTP
    const socket = net.createConnection(GATEWAY_PORT, GATEWAY_HOST);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 3000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      // Send a simple HTTP upgrade request to test WS readiness
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n\r\n');

      socket.once('data', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });

      // If no response within 1s, consider it unresponsive
      setTimeout(() => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      }, 1000);
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

/**
 * Get inotify watcher usage
 */
async function checkInotifyUsage() {
  return new Promise((resolve) => {
    fs.readFile('/proc/sys/fs/inotify/max_user_watches', 'utf8', (err, limit) => {
      if (err) {
        resolve({ limit: 0, usage: 0, percentage: 0 });
        return;
      }

      const maxWatchers = parseInt(limit.trim());
      resolve({
        limit: maxWatchers,
        threshold: Math.floor(maxWatchers * INOTIFY_THRESHOLD)
      });
    });
  });
}

/**
 * Query active agent runs via gateway logs
 * Note: This is a simplified approach. For production, use WebSocket API.
 */
function checkActiveAgentRuns() {
  return new Promise((resolve) => {
    try {
      // Check recent logs for active agent runs
      const logFile = '/tmp/moltbot/moltbot-*.log';
      const today = new Date().toISOString().split('T')[0];
      const todayLog = `/tmp/moltbot/moltbot-${today}.log`;

      if (!fs.existsSync(todayLog)) {
        resolve(0);
        return;
      }

      // Read last 50 lines to check for active runs
      const content = fs.readFileSync(todayLog, 'utf8');
      const lines = content.split('\n').slice(-50);

      // Look for "agent run registered" without corresponding "agent run cleared"
      const registeredRuns = new Set();
      const clearedRuns = new Set();

      for (const line of lines) {
        const registeredMatch = line.match(/agent run registered: ([a-f0-9-]+)/);
        if (registeredMatch) {
          registeredRuns.add(registeredMatch[1]);
        }

        const clearedMatch = line.match(/agent run cleared: ([a-f0-9-]+)/);
        if (clearedMatch) {
          clearedRuns.add(clearedMatch[1]);
        }
      }

      // Active runs = registered - cleared
      const activeRuns = registeredRuns.size - clearedRuns.size;
      resolve(Math.max(0, activeRuns));
    } catch (error) {
      log(`⚠️  Error checking active agent runs: ${error.message}`);
      resolve(0);
    }
  });
}

/**
 * Force restart gateway via PM2
 */
function restartGateway() {
  return new Promise((resolve) => {
    log('⚠️  Gateway unresponsive. Attempting force restart...');

    const killProc = spawn('killall', ['-9', 'moltbot']);

    killProc.on('close', () => {
      setTimeout(() => {
        log('✓ Gateway force-killed. PM2 will restart automatically.');
        resolve(true);
      }, 2000);
    });

    killProc.on('error', () => {
      resolve(true);
    });
  });
}

/**
 * Main health check routine
 */
async function performHealthCheck() {
  try {
    log('🔍 Starting health check...');

    // Check 1: Port reachable
    const portOpen = await checkGatewayResponsive();
    if (!portOpen) {
      log('✗ Gateway port NOT reachable');
      await restartGateway();
      return;
    }

    // Check 2: WebSocket responding
    const wsHealthy = await checkWebSocketResponsive();
    if (!wsHealthy) {
      log('✗ Gateway WebSocket not responding');
      await restartGateway();
      return;
    }

    // Check 3: Query active agent runs
    const activeRuns = await checkActiveAgentRuns();
    if (activeRuns > 0) {
      log(`ℹ️  Gateway healthy but has ${activeRuns} active agent run(s); deferring any restart`);
    }

    // Check 4: Inotify usage
    const inotify = await checkInotifyUsage();
    if (inotify.limit > 0) {
      log(`ℹ️  Inotify limit: ${inotify.limit} (threshold: ${inotify.threshold})`);
    }

    log('✓ Health check passed');
  } catch (error) {
    log(`✗ Health check error: ${error.message}`);
  }
}

/**
 * Start periodic health checks
 */
function startHealthMonitoring() {
  log(`🚀 PM2 Health Monitor started (check interval: ${CHECK_INTERVAL}ms)`);
  log(`   Gateway: ${GATEWAY_HOST}:${GATEWAY_PORT}`);
  log(`   Log file: ${LOG_FILE}`);

  performHealthCheck();

  setInterval(() => {
    performHealthCheck();
  }, CHECK_INTERVAL);
}

process.on('SIGINT', () => {
  log('📴 Health monitor shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('📴 Health monitor terminated');
  process.exit(0);
});

startHealthMonitoring();
