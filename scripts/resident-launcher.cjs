#!/usr/bin/env node
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(process.env.JAVIS_REPO_ROOT || path.join(__dirname, '..'));
const electronExecutable = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const apiPort = Number(process.env.JAVIS_API_PORT || 3417);
const startupTimeoutMs = Math.max(5000, Math.min(120000, Number(process.env.JAVIS_RESIDENT_STARTUP_HEALTH_TIMEOUT_MS || 20000)));
const pollIntervalMs = Math.max(250, Math.min(5000, Number(process.env.JAVIS_RESIDENT_STARTUP_HEALTH_POLL_MS || 750)));
const startupAttempts = Math.max(1, Math.min(5, Number(process.env.JAVIS_RESIDENT_STARTUP_ATTEMPTS || 3)));
const startupRetryDelayMs = Math.max(250, Math.min(10000, Number(process.env.JAVIS_RESIDENT_STARTUP_RETRY_DELAY_MS || 1500)));

let child = null;
let childExit = null;
let exiting = false;
let startupSettled = false;

function fail(message) {
  process.stderr.write(`JAVIS resident launcher: ${message}\n`);
  process.exitCode = 1;
}

function requestHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const request = http.request(
      {
        host: '127.0.0.1',
        port: apiPort,
        path: '/api/health?lite=watchdog',
        method: 'GET',
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 32 * 1024) request.destroy(new Error('health response too large'));
        });
        response.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(body);
          } catch {}
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300 && data?.ok === true,
            statusCode: response.statusCode,
            elapsedMs: Date.now() - startedAt,
            data,
          });
        });
      },
    );
    request.on('timeout', () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      resolve({
        ok: false,
        statusCode: 0,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    request.end();
  });
}

function stopChild(signal = 'SIGTERM') {
  if (!child || child.killed) return;
  try {
    child.kill(signal);
  } catch {}
}

function installSignalHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (exiting) return;
      exiting = true;
      stopChild('SIGTERM');
      setTimeout(() => stopChild('SIGKILL'), 3000).unref();
    });
  }
}

function spawnElectronChild(attempt) {
  childExit = null;
  const proc = spawn(electronExecutable, [repoRoot], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JAVIS_REPO_ROOT: repoRoot,
      JAVIS_RESIDENT_LAUNCHER: 'true',
      JAVIS_RESIDENT_LAUNCHER_ATTEMPT: String(attempt),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child = proc;
  proc.on('exit', (code, signal) => {
    if (proc !== child) return;
    if (exiting) {
      process.exit(0);
      return;
    }
    if (!startupSettled) {
      childExit = { code, signal };
      return;
    }
    process.exitCode = code === null ? 1 : code;
    if (signal) process.stderr.write(`JAVIS resident launcher: Electron exited with signal ${signal}\n`);
    process.exit();
  });
  proc.on('error', (error) => {
    if (proc !== child) return;
    childExit = {
      code: null,
      signal: '',
      error: error instanceof Error ? error.message : String(error),
    };
  });
  return proc;
}

async function waitForHealthyChild(proc = child) {
  const deadline = Date.now() + startupTimeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    if (proc !== child) {
      return {
        ok: false,
        reason: 'electron child was replaced during startup',
        latest,
      };
    }
    if (childExit || proc.exitCode !== null || proc.signalCode) {
      return {
        ok: false,
        reason: childExit?.error
          ? `electron failed to start: ${childExit.error}`
          : `electron exited early code=${childExit?.code ?? proc.exitCode ?? '-'} signal=${childExit?.signal || proc.signalCode || '-'}`,
        latest,
      };
    }
    latest = await requestHealth();
    if (latest.ok) return { ok: true, latest };
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return {
    ok: false,
    reason: `resident API did not become healthy within ${Math.round(startupTimeoutMs / 1000)}s`,
    latest,
  };
}

async function main() {
  if (!fs.existsSync(electronExecutable)) {
    fail(`Electron executable not found: ${electronExecutable}`);
    return;
  }
  if (!fs.existsSync(path.join(repoRoot, 'electron', 'main.cjs'))) {
    fail(`Electron main process not found under ${repoRoot}`);
    return;
  }
  process.chdir(repoRoot);
  require.resolve('dotenv');
  installSignalHandlers();

  let finalHealth = null;
  for (let attempt = 1; attempt <= startupAttempts; attempt += 1) {
    const proc = spawnElectronChild(attempt);
    const health = await waitForHealthyChild(proc);
    finalHealth = health;
    if (health.ok) {
      startupSettled = true;
      process.stdout.write(`JAVIS resident launcher: healthy pid=${health.latest?.data?.pid || proc.pid || '-'} api=127.0.0.1:${apiPort} attempt=${attempt}/${startupAttempts}\n`);
      return;
    }
    process.stderr.write(`JAVIS resident launcher: startup attempt ${attempt}/${startupAttempts} failed: ${health.reason}; last=${health.latest?.error || health.latest?.statusCode || 'unknown'}\n`);
    stopChild('SIGTERM');
    if (attempt < startupAttempts) {
      await new Promise((resolve) => setTimeout(resolve, startupRetryDelayMs));
    }
  }
  fail(`${finalHealth?.reason || 'resident startup failed'}; attempts=${startupAttempts}; last=${finalHealth?.latest?.error || finalHealth?.latest?.statusCode || 'unknown'}`);
  exiting = true;
  stopChild('SIGTERM');
  setTimeout(() => stopChild('SIGKILL'), 3000).unref();
  process.exit(1);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
  stopChild('SIGTERM');
  process.exit(1);
});
