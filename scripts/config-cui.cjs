#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const readline = require('node:readline/promises');

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const ENV_FILE = path.join(process.cwd(), '.env');
const ENV_EXAMPLE_FILE = path.join(process.cwd(), '.env.example');
const LAUNCH_AGENT_LABEL = 'com.haoge.javis';
const PARK_CORNERS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

function request(path, options = {}) {
  const url = new URL(path, API_BASE);
  const body = options.body ? JSON.stringify(options.body) : '';
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = raw;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data?.details || data?.error || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function issueLines(doctor) {
  return (doctor?.checks || [])
    .filter((check) => check.status !== 'ready')
    .map((check) => `- ${check.status.toUpperCase()} ${check.label}: ${check.next || check.summary}`);
}

function ensureEnvFile() {
  if (fs.existsSync(ENV_FILE)) return false;
  if (fs.existsSync(ENV_EXAMPLE_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE_FILE, ENV_FILE);
  } else {
    fs.writeFileSync(ENV_FILE, 'OPENAI_API_KEY=\n', 'utf8');
  }
  return true;
}

function setEnvValue(key, value) {
  ensureEnvFile();
  const current = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = current.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index >= 0) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function getEnvValue(key) {
  if (!fs.existsSync(ENV_FILE)) return '';
  const line = fs.readFileSync(ENV_FILE, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : '';
}

async function hiddenQuestion(rl, prompt) {
  process.stdout.write(prompt);
  try {
    execFileSync('stty', ['-echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
  } catch {
    // If stty is unavailable, readline still works; the value may be visible.
  }
  try {
    const value = await rl.question('');
    process.stdout.write('\n');
    return value.trim();
  } finally {
    try {
      execFileSync('stty', ['echo'], { stdio: ['inherit', 'ignore', 'ignore'] });
    } catch {
      // Ignore restore failures; Terminal usually restores echo on process exit.
    }
  }
}

function validateOpenAiKey(value) {
  if (!value) return 'Key was empty.';
  if (/\s/.test(value)) return 'Key contains whitespace.';
  if (value.length < 20) return 'Key looks too short.';
  return '';
}

function restartResident() {
  const uid = typeof process.getuid === 'function'
    ? String(process.getuid())
    : execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
  execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCH_AGENT_LABEL}`], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printStatus() {
  console.clear();
  console.log('JAVIS Config');
  console.log('============');
  try {
    const [status, doctor] = await Promise.all([
      request('/api/status'),
      request('/api/doctor/report'),
    ]);
    const window = status.window || {};
    console.log(`API: ${status.api?.baseUrl || API_BASE}`);
    console.log(`OpenAI key: ${status.api?.hasOpenAiKey ? 'present' : 'missing'}`);
    console.log(`Local execution: ${status.api?.localExecutionEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Trusted local mode: ${status.api?.trustedLocalMode ? 'enabled' : 'off'}`);
    if (status.actionPolicy) {
      console.log(`Auto-run: Level ${status.actionPolicy.maxAutoRiskLevel}; approval at Level ${status.actionPolicy.requireApprovalAtRiskLevel}`);
    }
    console.log(`Pet: ${window.mode || 'pet'} ${window.position ? `@ ${window.position.x},${window.position.y}` : ''}`);
    console.log(`Hotkeys: pet ${window.hotkeyRegistered ? 'ready' : 'off'} (${window.hotkey || '-'}) · capture ${window.captureHotkeyRegistered ? 'ready' : 'off'} (${window.captureHotkey || '-'})`);
    if (status.wake) {
      console.log(`Wake: ${status.wake.engine?.configured ? (status.wake.engine.running ? 'engine running' : 'engine stopped') : 'soft'} · words ${status.wake.words?.join(', ') || '-'}`);
    }
    if (status.ambient) {
      console.log(`Ambient: ${status.ambient.enabled ? 'on' : 'off'} · screen ${status.ambient.captureScreen ? 'on' : 'off'} · ${status.ambient.count || 0} sample(s)`);
    }
    console.log(`Doctor: ${doctor.doctor?.counts?.ready || 0}/${doctor.doctor?.counts?.total || 0} ready · ${doctor.doctor?.overall || 'unknown'}`);
    const issues = issueLines(doctor.doctor);
    if (issues.length) {
      console.log('\nNeeds attention:');
      console.log(issues.slice(0, 6).join('\n'));
    }
  } catch (error) {
    console.log(`Cannot reach JAVIS at ${API_BASE}`);
    console.log(error instanceof Error ? error.message : String(error));
  }
  console.log('\nActions');
  console.log('1. Set OpenAI API key');
  console.log('2. Open .env');
  console.log('3. Open Screen Recording settings');
  console.log('4. Open Accessibility settings');
  console.log('5. Open Full Disk Access settings');
  console.log('6. Move pet corner');
  console.log('7. Restart JAVIS resident');
  console.log('8. Toggle local execution');
  console.log('9. Toggle Level 3 auto-run');
  console.log('10. Toggle trusted local mode');
  console.log('11. Run doctor');
  console.log('12. Test wake trigger');
  console.log('13. Quit');
}

async function setupAction(action) {
  const result = await request('/api/setup/actions', {
    method: 'POST',
    body: { action },
  });
  console.log(`\n${result.output || 'Done.'}`);
}

async function setOpenAiKey(rl) {
  const value = await hiddenQuestion(rl, '\nPaste OPENAI_API_KEY: ');
  const error = validateOpenAiKey(value);
  if (error) {
    console.log(`\nNot saved: ${error}`);
    return;
  }

  setEnvValue('OPENAI_API_KEY', value);
  console.log(`\nSaved OPENAI_API_KEY to ${ENV_FILE}.`);
  const restart = (await rl.question('Restart JAVIS now to load it? [Y/n] ')).trim().toLowerCase();
  if (!restart || restart === 'y' || restart === 'yes') {
    await restartJavis();
  }
}

async function restartJavis() {
  try {
    restartResident();
    console.log('\nRestarted JAVIS resident.');
    await sleep(1600);
  } catch (error) {
    console.log('\nCould not restart LaunchAgent automatically.');
    console.log(error instanceof Error ? error.message : String(error));
    console.log('Run `npm run resident:install` or restart JAVIS manually.');
  }
}

async function toggleLocalExecution(rl) {
  const current = getEnvValue('JAVIS_ENABLE_LOCAL_EXEC') === 'true';
  console.log(`\nLocal execution is currently ${current ? 'enabled' : 'disabled'}.`);
  console.log('This controls Level 3 actions such as Codex/Claude delegation, typing, hotkeys, and file mutations.');
  const expected = current ? 'DISABLE' : 'ENABLE';
  const answer = (await rl.question(`Type ${expected} to ${expected.toLowerCase()} local execution: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }

  setEnvValue('JAVIS_ENABLE_LOCAL_EXEC', current ? 'false' : 'true');
  console.log(`\nSaved JAVIS_ENABLE_LOCAL_EXEC=${current ? 'false' : 'true'} to ${ENV_FILE}.`);
  const restart = (await rl.question('Restart JAVIS now to load it? [Y/n] ')).trim().toLowerCase();
  if (!restart || restart === 'y' || restart === 'yes') {
    await restartJavis();
  }
}

async function toggleLevel3AutoRun(rl) {
  const status = await request('/api/status');
  const currentAuto = Number(status.actionPolicy?.maxAutoRiskLevel || 0) >= 3
    && Number(status.actionPolicy?.requireApprovalAtRiskLevel || 0) >= 4;
  console.log(`\nLevel 3 auto-run is currently ${currentAuto ? 'enabled' : 'guarded'}.`);
  console.log('Level 3 includes local file edits, typing into apps, Accessibility clicks, and Codex/Claude delegation.');
  console.log('Level 4 actions such as sends, purchases, form submissions, deletes, and account changes should still require confirmation.');
  const expected = currentAuto ? 'GUARD' : 'AUTO';
  const answer = (await rl.question(`Type ${expected} to switch to ${currentAuto ? 'approval-gated' : 'auto-run'} Level 3: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }

  const next = currentAuto
    ? { maxAutoRiskLevel: 2, requireApprovalAtRiskLevel: 3 }
    : { maxAutoRiskLevel: 3, requireApprovalAtRiskLevel: 4 };
  setEnvValue('JAVIS_MAX_AUTO_RISK_LEVEL', String(next.maxAutoRiskLevel));
  setEnvValue('JAVIS_REQUIRE_APPROVAL_AT_RISK_LEVEL', String(next.requireApprovalAtRiskLevel));
  await request('/api/actions/policy', { method: 'PUT', body: next });
  console.log(`\nSaved auto-run Level ${next.maxAutoRiskLevel}; approval starts at Level ${next.requireApprovalAtRiskLevel}.`);
  const restart = (await rl.question('Restart JAVIS now to keep .env and runtime aligned? [Y/n] ')).trim().toLowerCase();
  if (!restart || restart === 'y' || restart === 'yes') {
    await restartJavis();
  }
}

async function toggleTrustedLocalMode(rl) {
  const current = getEnvValue('JAVIS_TRUSTED_LOCAL_MODE') === 'true';
  console.log(`\nTrusted local mode is currently ${current ? 'enabled' : 'off'}.`);
  console.log('When enabled, JAVIS treats automatic Level 3 local actions as intentional: file edits in allowed roots, typing, hotkeys, Accessibility clicks, and Codex/Claude delegation.');
  console.log('Level 4 actions such as sends, purchases, form submissions, deletes, and account changes still require confirmation.');
  const expected = current ? 'UNTRUST' : 'TRUST';
  const answer = (await rl.question(`Type ${expected} to ${current ? 'turn off' : 'enable'} trusted local mode: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }

  setEnvValue('JAVIS_TRUSTED_LOCAL_MODE', current ? 'false' : 'true');
  if (!current) {
    setEnvValue('JAVIS_ENABLE_LOCAL_EXEC', 'true');
    setEnvValue('JAVIS_MAX_AUTO_RISK_LEVEL', '3');
    setEnvValue('JAVIS_REQUIRE_APPROVAL_AT_RISK_LEVEL', '4');
    await request('/api/actions/policy', {
      method: 'PUT',
      body: { maxAutoRiskLevel: 3, requireApprovalAtRiskLevel: 4 },
    });
  }
  console.log(`\nSaved JAVIS_TRUSTED_LOCAL_MODE=${current ? 'false' : 'true'} to ${ENV_FILE}.`);
  const restart = (await rl.question('Restart JAVIS now to load it? [Y/n] ')).trim().toLowerCase();
  if (!restart || restart === 'y' || restart === 'yes') {
    await restartJavis();
  }
}

async function movePetCorner(rl) {
  const status = await request('/api/window/state');
  const current = status.window?.parkCorner || getEnvValue('JAVIS_WINDOW_PARK_CORNER') || 'top-right';
  console.log(`\nPet corner is currently ${current}.`);
  PARK_CORNERS.forEach((corner, index) => {
    console.log(`${index + 1}. ${corner}`);
  });
  const answer = (await rl.question('Choose corner [1-4]: ')).trim();
  const index = Number(answer) - 1;
  const corner = PARK_CORNERS[index];
  if (!corner) {
    console.log('\nNo change made.');
    return;
  }

  setEnvValue('JAVIS_WINDOW_PARK_CORNER', corner);
  setEnvValue('JAVIS_WINDOW_PARK_DISPLAY', 'primary');
  const result = await request('/api/window/park', {
    method: 'POST',
    body: { corner, display: 'primary' },
  });
  console.log(`\nMoved pet to ${corner}.`);
  if (result.window?.position) {
    console.log(`Position: ${result.window.position.x},${result.window.position.y}`);
  }
}

async function main() {
  if (!process.stdin.isTTY) {
    await printStatus();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      await printStatus();
      const answer = (await rl.question('\nChoose: ')).trim().toLowerCase();
      if (answer === '1') await setOpenAiKey(rl);
      else if (answer === '2') await setupAction('prepare_env_file');
      else if (answer === '3') await setupAction('open_screen_settings');
      else if (answer === '4') await setupAction('open_accessibility_settings');
      else if (answer === '5') await setupAction('open_full_disk_access_settings');
      else if (answer === '6') {
        await movePetCorner(rl);
      } else if (answer === '7') {
        await restartJavis();
      } else if (answer === '8') {
        await toggleLocalExecution(rl);
      } else if (answer === '9') {
        await toggleLevel3AutoRun(rl);
      } else if (answer === '10') {
        await toggleTrustedLocalMode(rl);
      } else if (answer === '11') {
        const doctor = await request('/api/doctor/report');
        console.log(`\n${doctor.doctor?.label || doctor.doctor?.overall || 'Doctor complete'}`);
        console.log(issueLines(doctor.doctor).join('\n') || 'All checks ready.');
      } else if (answer === '12') {
        const result = await request('/api/wake/trigger', {
          method: 'POST',
          body: { source: 'cui', phrase: 'manual test' },
        });
        console.log(`\nWake trigger queued. Pending: ${result.wake?.pending ? 'yes' : 'no'}`);
      } else if (answer === '13' || answer === 'q' || answer === 'quit' || answer === 'exit') {
        break;
      } else {
        console.log('\nUnknown choice.');
      }
      await rl.question('\nPress Enter to continue...');
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
