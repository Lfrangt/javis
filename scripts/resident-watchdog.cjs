#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const label = 'com.haoge.javis';
const uid = process.getuid?.();
const homeDir = process.env.HOME || os.homedir();
const dataDir = process.env.JAVIS_DATA_DIR || path.join(homeDir, 'Library', 'Application Support', 'JAVIS', 'Runtime');
const stateFile = path.join(dataDir, 'resident-watchdog.json');
const auditFile = path.join(dataDir, 'resident-watchdog.jsonl');
const stopScript = path.join(repoRoot, 'scripts', 'stop-resident-processes.cjs');
const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${label}.plist`);
const args = new Set(process.argv.slice(2));
const jsonMode = args.has('--json');
const dryRun = args.has('--dry-run') || args.has('--check');
const apiPort = Number(process.env.JAVIS_API_PORT || readEnvValue('JAVIS_API_PORT') || 3417);
const timeoutMs = clampNumber(process.env.JAVIS_WATCHDOG_HEALTH_TIMEOUT_MS, 500, 15000, 3000);
const cooldownMs = clampNumber(process.env.JAVIS_WATCHDOG_RESTART_COOLDOWN_MS, 10000, 600000, 60000);

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readEnvValue(key) {
  try {
    const envPath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envPath)) return '';
    const line = fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((item) => item.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

function run(command, argsList, options = {}) {
  try {
    return {
      ok: true,
      stdout: execFileSync(command, argsList, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: options.timeoutMs || 20000,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout || ''),
      stderr: String(error.stderr || error.message || error),
    };
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(next) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function appendEvent(event) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(auditFile, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, 'utf8');
}

function requestHealth() {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port: apiPort,
        path: '/api/health',
        method: 'GET',
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64 * 1024) request.destroy(new Error('health response too large'));
        });
        response.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(body);
          } catch {}
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
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
        status: 0,
        elapsedMs: Date.now() - startedAt,
        error: String(error.message || error),
      });
    });
    request.end();
  });
}

function launchAgentTarget() {
  return uid === undefined ? '' : `gui/${uid}/${label}`;
}

function launchAgentLoaded() {
  const target = launchAgentTarget();
  if (!target) return false;
  return run('launchctl', ['print', target], { timeoutMs: 5000 }).ok;
}

function restartResident(reason) {
  const stopped = run(process.execPath, [stopScript], { timeoutMs: 30000 });
  const target = launchAgentTarget();
  let kicked = { ok: false, stderr: 'launchctl target unavailable' };
  if (target && launchAgentLoaded()) {
    kicked = run('launchctl', ['kickstart', '-k', target], { timeoutMs: 15000 });
  } else if (uid !== undefined && fs.existsSync(plistPath)) {
    run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { timeoutMs: 15000 });
    kicked = run('launchctl', ['kickstart', '-k', target], { timeoutMs: 15000 });
  }
  return {
    reason,
    stopped: stopped.ok,
    kickstarted: kicked.ok,
    kickstartError: kicked.ok ? '' : String(kicked.stderr || kicked.stdout || '').trim(),
  };
}

async function main() {
  const health = await requestHealth();
  const now = Date.now();
  const previous = readState();

  if (health.ok) {
    const result = {
      ok: true,
      status: 'healthy',
      checkedAt: new Date(now).toISOString(),
      apiPort,
      elapsedMs: health.elapsedMs,
      pid: health.data?.pid || null,
      uptimeSeconds: Math.round(Number(health.data?.uptimeSeconds || 0)),
      restarted: false,
      safety: {
        localHealthOnly: true,
        callsOpenAi: false,
        startsMicrophone: false,
        capturesScreen: false,
        mutatesUserFiles: false,
      },
    };
    writeState({ ...previous, lastOkAt: result.checkedAt, lastStatus: result.status, lastHealth: result });
    appendEvent({ type: 'health_ok', apiPort, elapsedMs: health.elapsedMs, pid: result.pid });
    print(result);
    return;
  }

  const sinceLastRestart = previous.lastRestartAt ? now - Date.parse(previous.lastRestartAt) : Infinity;
  if (sinceLastRestart < cooldownMs) {
    const result = {
      ok: false,
      status: 'unhealthy_restart_cooldown',
      checkedAt: new Date(now).toISOString(),
      apiPort,
      elapsedMs: health.elapsedMs,
      error: health.error || `HTTP ${health.status}`,
      restarted: false,
      cooldownRemainingMs: Math.max(0, cooldownMs - sinceLastRestart),
      dryRun,
    };
    writeState({ ...previous, lastStatus: result.status, lastFailureAt: result.checkedAt, lastFailure: result });
    appendEvent({ type: 'health_failed_cooldown', apiPort, error: result.error, elapsedMs: health.elapsedMs, cooldownRemainingMs: result.cooldownRemainingMs });
    print(result);
    return;
  }

  if (dryRun) {
    const result = {
      ok: false,
      status: 'unhealthy_dry_run',
      checkedAt: new Date(now).toISOString(),
      apiPort,
      elapsedMs: health.elapsedMs,
      error: health.error || `HTTP ${health.status}`,
      restarted: false,
      dryRun: true,
    };
    writeState({ ...previous, lastStatus: result.status, lastFailureAt: result.checkedAt, lastFailure: result });
    appendEvent({ type: 'health_failed_dry_run', apiPort, error: result.error, elapsedMs: health.elapsedMs });
    print(result);
    process.exitCode = 1;
    return;
  }

  const restart = restartResident(health.error || `HTTP ${health.status}`);
  const result = {
    ok: restart.kickstarted,
    status: restart.kickstarted ? 'restarted' : 'restart_failed',
    checkedAt: new Date(now).toISOString(),
    apiPort,
    elapsedMs: health.elapsedMs,
    error: health.error || `HTTP ${health.status}`,
    restarted: restart.kickstarted,
    restart,
    safety: {
      localHealthOnly: true,
      callsOpenAi: false,
      startsMicrophone: false,
      capturesScreen: false,
      mutatesUserFiles: false,
    },
  };
  writeState({
    ...previous,
    lastStatus: result.status,
    lastFailureAt: result.checkedAt,
    lastFailure: result,
    ...(restart.kickstarted ? { lastRestartAt: result.checkedAt, lastRestart: result } : {}),
  });
  appendEvent({ type: result.status, apiPort, error: result.error, elapsedMs: health.elapsedMs, restart });
  print(result);
  if (!restart.kickstarted) process.exitCode = 1;
}

function print(result) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.status === 'healthy') {
    console.log(`JAVIS resident watchdog: healthy · api=127.0.0.1:${result.apiPort} · pid=${result.pid || 'unknown'} · ${result.elapsedMs}ms`);
    return;
  }
  if (result.status === 'restarted') {
    console.log(`JAVIS resident watchdog: restarted · reason=${result.error} · stopped=${result.restart.stopped ? 'yes' : 'no'} · kickstarted=${result.restart.kickstarted ? 'yes' : 'no'}`);
    return;
  }
  if (result.status === 'unhealthy_restart_cooldown') {
    console.log(`JAVIS resident watchdog: unhealthy but cooling down · reason=${result.error} · remaining=${Math.ceil(result.cooldownRemainingMs / 1000)}s`);
    return;
  }
  console.log(`JAVIS resident watchdog: ${result.status} · reason=${result.error || 'unknown'}`);
}

main().catch((error) => {
  const result = { ok: false, status: 'watchdog_error', error: error instanceof Error ? error.message : String(error) };
  appendEvent({ type: 'watchdog_error', error: result.error });
  print(result);
  process.exitCode = 1;
});
