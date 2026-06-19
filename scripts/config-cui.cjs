#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const readline = require('node:readline/promises');

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');
const ENV_FILE = path.join(process.cwd(), '.env');
const ENV_EXAMPLE_FILE = path.join(process.cwd(), '.env.example');
const LAUNCH_AGENT_LABEL = 'com.haoge.javis';
const PARK_CORNERS = ['notch', 'bottom-right', 'bottom-left', 'top-right', 'top-left'];
const CONTROL_MODES = ['observe_only', 'ask_before_action', 'trusted_local', 'takeover_supervised'];

function formatTime(value) {
  const number = Number(value || 0);
  if (!number) return 'never';
  return new Date(number).toLocaleString();
}

function formatInterval(ms) {
  const number = Number(ms || 0);
  if (!number) return '-';
  const seconds = Math.round(number / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function compact(value, max = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(API_TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function request(path, options = {}) {
  const url = new URL(path, API_BASE);
  const body = options.body ? JSON.stringify(options.body) : '';
  const token = readApiToken();
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { 'X-JAVIS-Token': token } : {}),
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

function summarizeVoiceHealth(voiceHealth, conversation, doctor) {
  const doctorVoice = (doctor?.checks || []).find((check) => check.id === 'realtime_voice_provider');
  if (doctorVoice && doctorVoice.status !== 'ready') {
    return `${doctorVoice.status} · ${compact(doctorVoice.summary, 130)}`;
  }
  if (voiceHealth?.status && voiceHealth.status !== 'ready') {
    return `${voiceHealth.status} · ${compact(voiceHealth.summary || voiceHealth.error || '-', 130)}`;
  }
  if (conversation?.error) {
    return `error · ${compact(conversation.error, 130)}`;
  }
  if (voiceHealth?.kind === 'last_success') {
    return 'provider ok';
  }
  return '';
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
    const [status, doctor, autopilotResult, browserJs, shortcutsResult] = await Promise.all([
      request('/api/status'),
      request('/api/doctor/report'),
      request('/api/autopilot').catch(() => ({ autopilot: null })),
      request('/api/browser/javascript').catch((error) => ({ javascript: { enabled: false, error: error instanceof Error ? error.message : String(error) } })),
      request('/api/shortcuts?limit=5').catch(() => ({ shortcuts: null })),
    ]);
    const window = status.window || {};
    console.log(`API: ${status.api?.baseUrl || API_BASE}`);
    console.log(`OpenAI key: ${status.api?.hasOpenAiKey ? 'present' : 'missing'}`);
    console.log(`Local execution: ${status.api?.localExecutionEnabled ? 'enabled' : 'disabled'}`);
    console.log(`Trusted local mode: ${status.api?.trustedLocalMode ? 'enabled' : 'off'}`);
    if (status.actionPolicy) {
      console.log(`Auto-run: Level ${status.actionPolicy.maxAutoRiskLevel}; approval at Level ${status.actionPolicy.requireApprovalAtRiskLevel}`);
      if (status.actionPolicy.controlMode) {
        const mode = status.actionPolicy.controlMode;
        console.log(`Control mode: ${mode.mode || '-'} · effective auto Level ${mode.effective?.maxAutoRiskLevel ?? '-'} · approval at Level ${mode.effective?.requireApprovalAtRiskLevel ?? '-'}`);
      }
    }
    console.log(`Pet: ${window.mode || 'pet'} ${window.position ? `@ ${window.position.x},${window.position.y}` : ''}`);
    console.log(`Hotkeys: pet ${window.hotkeyRegistered ? 'ready' : 'off'} (${window.hotkey || '-'}) · capture ${window.captureHotkeyRegistered ? 'ready' : 'off'} (${window.captureHotkey || '-'})`);
    if (status.wake) {
      console.log(`Wake: ${status.wake.engine?.configured ? (status.wake.engine.running ? 'engine running' : 'engine stopped') : 'soft'} · words ${status.wake.words?.join(', ') || '-'}`);
    }
    if (status.conversation) {
      const conversation = status.conversation;
      const voiceHealth = summarizeVoiceHealth(status.voiceHealth, conversation, doctor.doctor);
      console.log(`Voice: ${conversation.status || 'idle'} · mic ${conversation.micMode || 'open'} · screen ${conversation.screenLive ? 'on' : 'off'}${conversation.stale ? ' · stale' : ''}${voiceHealth ? ` · ${voiceHealth}` : ''}`);
    }
    if (status.ambient) {
      console.log(`Ambient: ${status.ambient.enabled ? 'on' : 'off'} · screen ${status.ambient.captureScreen ? 'on' : 'off'} · ${status.ambient.count || 0} sample(s)`);
    }
    if (status.learning) {
      const profile = status.learning.profile || {};
      const controls = status.learning.controls || {};
      const exclusions = (controls.excludedApps?.length || 0) + (controls.excludedHosts?.length || 0) + (controls.excludedFolders?.length || 0);
      console.log(`Learning: ${status.learning.enabled ? 'on' : status.learning.paused ? 'paused' : 'off'} · prompts ${status.learning.includeInPrompts ? 'on' : 'off'} · ${profile.sourceEventCount || 0} distilled · ${exclusions} exclusion(s) · ${profile.summary || 'no profile yet'}`);
    }
    if (status.demonstrations) {
      const counts = status.demonstrations.counts || {};
      const active = status.demonstrations.active;
      console.log(`Demos: ${counts.total || 0} saved · ${counts.recording || 0} recording${active?.title ? ` · ${compact(active.title, 80)}` : ''}`);
    }
    const shortcuts = shortcutsResult.shortcuts || status.shortcuts;
    if (shortcuts) {
      const counts = shortcuts.counts || {};
      const latest = shortcuts.items?.[0];
      console.log(`Shortcuts: ${counts.enabled || 0} enabled / ${counts.total || 0} saved${latest?.phrase ? ` · latest "${compact(latest.phrase, 60)}"` : ''}`);
    }
    if (status.collaboration) {
      const counts = status.collaboration.counts || {};
      console.log(`Collab: ${counts.active || 0} active claim(s) · ${counts.conflicts || 0} conflict pair(s)`);
    }
    if (status.presence) {
      const observing = status.presence.observing?.latest || {};
      const where = [observing.app, observing.browser?.host || observing.browser?.title || observing.windowTitle].filter(Boolean).join(' · ');
      console.log(`Presence: ${status.presence.label || status.presence.mode || 'Standby'}${where ? ` · ${where}` : ''}`);
    }
    if (autopilotResult.autopilot) {
      const autopilot = autopilotResult.autopilot;
      const maintenance = autopilot.maintenance || {};
      const maintenanceText = maintenance.minIntervalMs
        ? ` · maintenance ${maintenance.due ? 'due' : 'cooldown'}${maintenance.lastSnapshotAt ? ` last ${formatTime(maintenance.lastSnapshotAt)}` : ''}`
        : '';
      console.log(`Autopilot: ${autopilot.enabled ? 'on' : 'off'} · every ${formatInterval(autopilot.intervalMs)} · ticks ${autopilot.tickCount || 0} · ran ${autopilot.executedCount || 0} · last ${compact(autopilot.lastResult || 'none', 80)}${maintenanceText}`);
    }
    if (browserJs.javascript?.supported && browserJs.javascript?.available) {
      const bridge = browserJs.javascript.bridge || '';
      const cdpError = browserJs.javascript.cdpError || browserJs.javascript.cdp?.error || '';
      const browserDetail = browserJs.javascript.enabled
        ? `ready${bridge ? ` via ${bridge}` : ''}`
        : `needs browser bridge${browserJs.javascript.error ? ` · ${browserJs.javascript.error}` : ''}${cdpError && cdpError !== browserJs.javascript.error ? ` · cdp ${cdpError}` : ''}`;
      console.log(`Browser DOM: ${browserDetail}`);
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
  console.log('M. Open Microphone settings');
  console.log('3. Open Screen Recording settings');
  console.log('4. Open Accessibility settings');
  console.log('5. Open Full Disk Access settings');
  console.log('6. Move pet position');
  console.log('7. Restart JAVIS resident');
  console.log('8. Toggle local execution');
  console.log('9. Toggle Level 3 auto-run');
  console.log('10. Toggle trusted local mode');
  console.log('11. Set control mode');
  console.log('12. Run doctor');
  console.log('13. Test wake trigger');
  console.log('V. Watch Realtime voice evidence');
  console.log('D. Start Realtime dogfood drill');
  console.log('H. Show spoken work handoff');
  console.log('14. Show next work item');
  console.log('15. Run next work item');
  console.log('16. Show autopilot status');
  console.log('17. Run one autopilot tick');
  console.log('18. Toggle overnight autopilot');
  console.log('19. Refresh learning profile');
  console.log('20. Save learning as memory');
  console.log('21. Pause/resume learning');
  console.log('22. Manage learning exclusions');
  console.log('23. Delete inferred learning data');
  console.log('24. Preview learning skill draft');
  console.log('25. Export learning skill');
  console.log('26. Show collaboration claims');
  console.log('27. Show UI demonstrations');
  console.log('28. Show skill shortcuts');
  console.log('29. Promote shortcut candidate');
  console.log('30. Quit');
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

async function setControlMode(rl) {
  const current = await request('/api/control/mode');
  const mode = current.controlMode || {};
  console.log(`\nControl mode is currently ${mode.mode || '-'}.`);
  console.log('observe_only: watch/read/status only; blocks actions.');
  console.log('ask_before_action: read-only auto; asks before Level 2+ actions.');
  console.log('trusted_local: use local action policy for this Mac.');
  console.log('takeover_supervised: trusted local actions, Level 4 still gated.');
  CONTROL_MODES.forEach((id, index) => {
    console.log(`${index + 1}. ${id}`);
  });
  const answer = (await rl.question(`Choose mode [1-${CONTROL_MODES.length}]: `)).trim();
  const selected = CONTROL_MODES[Number(answer) - 1];
  if (!selected) {
    console.log('\nNo change made.');
    return;
  }
  const expected = selected === 'observe_only' ? 'OBSERVE' : selected === 'ask_before_action' ? 'ASK' : selected === 'trusted_local' ? 'TRUST' : 'TAKEOVER';
  const confirm = (await rl.question(`Type ${expected} to switch to ${selected}: `)).trim();
  if (confirm !== expected) {
    console.log('\nNo change made.');
    return;
  }
  const updated = await request('/api/control/mode', {
    method: 'PUT',
    body: { mode: selected, source: 'cui' },
  });
  const next = updated.controlMode || {};
  console.log(`\nControl mode saved: ${next.mode || selected}.`);
  console.log(`Effective auto Level ${next.effective?.maxAutoRiskLevel ?? '-'}; approval at Level ${next.effective?.requireApprovalAtRiskLevel ?? '-'}.`);
}

function printAutopilotDetails(autopilot) {
  console.log(`Autopilot: ${autopilot.enabled ? 'on' : 'off'}${autopilot.busy || autopilot.running ? ' · busy' : ''}`);
  console.log(`Interval: ${formatInterval(autopilot.intervalMs)} (${autopilot.intervalMs || 0}ms)`);
  console.log(`Ticks: ${autopilot.tickCount || 0} · executed ${autopilot.executedCount || 0} · skipped ${autopilot.skippedCount || 0}`);
  console.log(`Last tick: ${formatTime(autopilot.lastTickAt)}`);
  console.log(`Last executed: ${formatTime(autopilot.lastExecutedAt)}`);
  if (autopilot.maintenance) {
    const maintenance = autopilot.maintenance;
    console.log(`Maintenance: ${maintenance.due ? 'due' : 'cooldown'} · every ${formatInterval(maintenance.minIntervalMs)} · last ${formatTime(maintenance.lastSnapshotAt)} · ran ${maintenance.runCount || 0}`);
  }
  if (autopilot.lastResult) console.log(`Last result: ${compact(autopilot.lastResult, 260)}`);
  if (autopilot.lastError) console.log(`Last error: ${compact(autopilot.lastError, 260)}`);
}

function printNextAction(next) {
  const action = next?.action || next?.next?.action || next?.next?.briefing?.nextActions?.[0] || next?.briefing?.nextActions?.[0];
  if (!action) {
    console.log('Next action: none');
    return;
  }
  const auto = action.manualOnly || action.autopilotEligible === false
    ? 'manual-only'
    : action.autoEligible || action.workflowAction === 'retry_app_workflow' ? 'auto-eligible' : 'manual';
  console.log(`Next action: ${action.label || action.id || 'unnamed'} (${action.source || 'unknown'}, ${auto})`);
  if (action.summary) console.log(`Summary: ${compact(action.summary, 260)}`);
  if (action.manualOnlyReason) console.log(`Manual reason: ${compact(action.manualOnlyReason, 220)}`);
}

async function showWorkbenchNext() {
  const preview = await request('/api/work/next?workflowLimit=6&jobLimit=6');
  console.log('');
  printNextAction(preview);
  if (preview.next?.output) console.log(compact(preview.next.output, 700));
}

async function runWorkbenchNext(rl) {
  console.log('\nPreviewing next work item...');
  const preview = await request('/api/work/next?workflowLimit=6&jobLimit=6');
  printNextAction(preview);
  if (preview.next?.output) console.log(compact(preview.next.output, 700));
  const answer = (await rl.question('Run this work item now? Type RUN to execute: ')).trim();
  if (answer !== 'RUN') {
    console.log('\nNo action executed.');
    return;
  }

  const result = await request('/api/work/next', {
    method: 'POST',
    body: { source: 'cui', execute: true, workflowLimit: 6, jobLimit: 6 },
  });
  const next = result.next || {};
  console.log(`\nWork item ${next.executed ? 'executed' : 'reviewed'}.`);
  if (next.output) console.log(compact(next.output, 900));
}

function printWorkHandoff(result) {
  const handoff = result?.handoff || result || {};
  console.log('JAVIS Work Handoff');
  console.log('==================');
  console.log(handoff.spokenSummary || handoff.output || 'No handoff summary available.');
  const nextActions = Array.isArray(handoff.nextActions) ? handoff.nextActions : [];
  const followUps = Array.isArray(handoff.followUps) ? handoff.followUps : [];
  const progress = handoff.progress || {};
  const session = handoff.session || null;
  console.log('\nDetails:');
  console.log(`- generated: ${handoff.generatedAt || '-'}`);
  console.log(`- progress: ${compact(progress.spokenSummary || '-', 360)}`);
  console.log(`- workers: ${compact(progress.workerSummary || '-', 220)}`);
  console.log(`- session: ${session ? `${session.title || session.id} · ${session.events || 0} event(s)` : 'none active'}`);
  console.log(`- next: ${summarizeNextActions(nextActions)}`);
  console.log(`- continuations: ${summarizeNextActions(followUps)}`);
  const collaboration = handoff.collaboration?.counts || {};
  console.log(`- collab: ${collaboration.active || 0} active · ${collaboration.conflicts || 0} conflict pair(s)`);
}

async function showWorkHandoff() {
  const result = await request('/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900');
  console.log('');
  printWorkHandoff(result);
}

async function showAutopilotStatus() {
  const [autopilotResult, next] = await Promise.all([
    request('/api/autopilot'),
    request('/api/work/next').catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);
  console.log('');
  printAutopilotDetails(autopilotResult.autopilot || {});
  if (next.error) {
    console.log(`Next action: unavailable · ${next.error}`);
  } else {
    printNextAction(next);
  }
}

async function runAutopilotTick(rl) {
  console.log('\nPreviewing next autopilot action...');
  const preview = await request('/api/work/next?workflowLimit=6&jobLimit=6');
  printNextAction(preview);
  const answer = (await rl.question('Run one autopilot tick now? Type RUN to execute: ')).trim();
  if (answer !== 'RUN') {
    console.log('\nNo action executed.');
    return;
  }

  const result = await request('/api/autopilot/tick', {
    method: 'POST',
    body: { source: 'cui', execute: true },
  });
  const executed = result.tick?.executed ? 'executed' : 'skipped';
  const reason = result.tick?.reason ? ` · ${result.tick.reason}` : '';
  console.log(`\nAutopilot tick ${executed}${reason}.`);
  if (result.tick?.result?.output) console.log(compact(result.tick.result.output, 600));
  printAutopilotDetails(result.autopilot || result.tick?.autopilot || {});
}

async function toggleAutopilot(rl) {
  const status = await request('/api/autopilot').catch(() => ({ autopilot: null }));
  const envValue = getEnvValue('JAVIS_AUTOPILOT_ENABLED');
  const current = status.autopilot?.enabled ?? (envValue === 'true');
  console.log(`\nOvernight autopilot is currently ${current ? 'enabled' : 'disabled'}.`);
  console.log('It only runs low-risk recovery diagnostics and retryable blocked app workflows; it skips during live voice or active background jobs.');
  if (!current) {
    const localExec = getEnvValue('JAVIS_ENABLE_LOCAL_EXEC') === 'true';
    const trusted = getEnvValue('JAVIS_TRUSTED_LOCAL_MODE') === 'true';
    if (!localExec || !trusted) {
      console.log('Enabling autopilot will also set local execution, trusted local mode, and Level 3 auto-run in .env.');
    }
  }
  const expected = current ? 'STOP' : 'RUN';
  const answer = (await rl.question(`Type ${expected} to ${current ? 'disable' : 'enable'} overnight autopilot: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }

  setEnvValue('JAVIS_AUTOPILOT_ENABLED', current ? 'false' : 'true');
  if (!current) {
    setEnvValue('JAVIS_ENABLE_LOCAL_EXEC', 'true');
    setEnvValue('JAVIS_TRUSTED_LOCAL_MODE', 'true');
    setEnvValue('JAVIS_MAX_AUTO_RISK_LEVEL', '3');
    setEnvValue('JAVIS_REQUIRE_APPROVAL_AT_RISK_LEVEL', '4');
    await request('/api/actions/policy', {
      method: 'PUT',
      body: { maxAutoRiskLevel: 3, requireApprovalAtRiskLevel: 4 },
    }).catch(() => null);
  }
  console.log(`\nSaved JAVIS_AUTOPILOT_ENABLED=${current ? 'false' : 'true'} to ${ENV_FILE}.`);
  const restart = (await rl.question('Restart JAVIS now to load it? [Y/n] ')).trim().toLowerCase();
  if (!restart || restart === 'y' || restart === 'yes') {
    await restartJavis();
  }
}

function printLearningControls(learning) {
  const controls = learning?.controls || {};
  const profile = learning?.profile || {};
  console.log(`Learning: ${learning?.enabled ? 'on' : learning?.paused ? 'paused' : 'off'} · configured ${learning?.configured ? 'yes' : 'no'} · prompts ${learning?.includeInPrompts ? 'on' : 'off'}`);
  console.log(`Distilled events: ${profile.sourceEventCount || 0}`);
  if (profile.summary) console.log(`Summary: ${compact(profile.summary, 500)}`);
  console.log(`Excluded apps: ${(controls.excludedApps || []).join(', ') || '-'}`);
  console.log(`Excluded sites: ${(controls.excludedHosts || []).join(', ') || '-'}`);
  console.log(`Excluded folders: ${(controls.excludedFolders || []).join(', ') || '-'}`);
}

async function toggleLearning(rl) {
  const result = await request('/api/learning');
  const learning = result.learning || {};
  console.log('');
  printLearningControls(learning);
  if (!learning.configured) {
    const answer = (await rl.question('Ambient learning is not enabled in .env. Type START to enable it and restart JAVIS: ')).trim();
    if (answer !== 'START') {
      console.log('\nNo change made.');
      return;
    }
    setEnvValue('JAVIS_AMBIENT_LEARNING', 'true');
    console.log(`\nSaved JAVIS_AMBIENT_LEARNING=true to ${ENV_FILE}.`);
    await restartJavis();
    return;
  }
  const nextPaused = !learning.paused;
  const expected = nextPaused ? 'PAUSE' : 'RESUME';
  const answer = (await rl.question(`Type ${expected} to ${nextPaused ? 'pause' : 'resume'} inferred learning: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }
  const updated = await request(nextPaused ? '/api/learning/pause' : '/api/learning/resume', {
    method: 'POST',
    body: { source: 'cui' },
  });
  console.log('');
  printLearningControls(updated.learning);
}

async function manageLearningExclusions(rl) {
  const before = await request('/api/learning');
  console.log('');
  printLearningControls(before.learning);
  const action = (await rl.question('Add or remove exclusion? [add/remove/list] ')).trim().toLowerCase();
  if (!action || action === 'list') return;
  if (!['add', 'remove'].includes(action)) {
    console.log('\nNo change made.');
    return;
  }
  const kind = (await rl.question('Kind [app/site/folder]: ')).trim().toLowerCase();
  const value = (await rl.question('Value or pattern: ')).trim();
  if (!['app', 'site', 'folder'].includes(kind) || !value) {
    console.log('\nNo change made.');
    return;
  }
  const updated = await request(action === 'remove' ? '/api/learning/exclusions' : '/api/learning/exclusions', {
    method: action === 'remove' ? 'DELETE' : 'POST',
    body: { source: 'cui', kind, value },
  });
  console.log('');
  printLearningControls(updated.learning);
}

async function deleteLearningData(rl) {
  const current = await request('/api/learning');
  console.log('');
  printLearningControls(current.learning);
  console.log('This deletes the inferred local profile. Explicit memories are not deleted.');
  const clearAmbient = (await rl.question('Also clear stored ambient metadata? [y/N] ')).trim().toLowerCase();
  const expected = clearAmbient === 'y' || clearAmbient === 'yes' ? 'DELETE ALL' : 'DELETE';
  const answer = (await rl.question(`Type ${expected} to continue: `)).trim();
  if (answer !== expected) {
    console.log('\nNo change made.');
    return;
  }
  const result = await request('/api/learning', {
    method: 'DELETE',
    body: { source: 'cui', clearAmbient: expected === 'DELETE ALL', keepControls: true },
  });
  console.log('');
  printLearningControls(result.learning);
}

function printSkillDraft(draft) {
  const skill = draft?.skill || draft?.draft?.skill || {};
  const evidence = draft?.evidence || draft?.draft?.evidence || {};
  const profile = evidence.learning?.profile || {};
  console.log(`Skill: ${skill.name || '-'}`);
  console.log(`Title: ${skill.title || '-'}`);
  console.log(`Description: ${skill.description || '-'}`);
  console.log(`Suggested path: ${skill.suggestedUserPath || '-'}`);
  console.log(`Source observations: ${profile.sourceEventCount || 0}`);
  if (profile.summary) console.log(`Summary: ${compact(profile.summary, 500)}`);
  if (skill.markdown) {
    console.log('\n--- SKILL.md preview ---');
    console.log(compact(skill.markdown, 1800));
  }
}

async function previewLearningSkillDraft() {
  const draft = await request('/api/learning/skill-draft?source=cui&force=true');
  console.log('');
  printSkillDraft(draft);
}

async function exportLearningSkillDraft(rl) {
  const draft = await request('/api/learning/skill-draft?source=cui&force=true');
  console.log('');
  printSkillDraft(draft);
  console.log('\nThis writes a user-level Codex skill under ~/.agents/skills, not into this GitHub project.');
  const answer = (await rl.question('Type SAVE to export this skill: ')).trim();
  if (answer !== 'SAVE') {
    console.log('\nNo skill exported.');
    return;
  }
  const result = await request('/api/learning/skill-draft/save', {
    method: 'POST',
    body: { source: 'cui', confirm: true, force: false },
  });
  console.log(`\n${result.output || 'Skill exported.'}`);
}

function printCollaborationClaims(collaboration) {
  const counts = collaboration?.counts || {};
  console.log(`Collaboration: ${counts.active || 0} active · ${counts.conflicts || 0} conflict pair(s) · ${counts.total || 0} total`);
  const active = collaboration?.active || [];
  if (!active.length) {
    console.log('Active claims: none');
    return;
  }
  console.log('\nActive claims:');
  for (const claim of active) {
    const expires = claim.expiresAt ? ` · expires ${formatTime(claim.expiresAt)}` : '';
    console.log(`- ${claim.owner || claim.agent || 'agent'} · ${claim.access}:${claim.key || claim.scope || '-'} · ${compact(claim.task || claim.scope || '', 120)}${expires}`);
  }
}

async function showCollaborationClaims() {
  const result = await request('/api/collaboration?limit=20');
  console.log('');
  printCollaborationClaims(result.collaboration || {});
}

function printDemonstrations(demonstrations) {
  const counts = demonstrations?.counts || {};
  console.log(`Demonstrations: ${counts.total || 0} total · ${counts.recording || 0} recording · ${counts.done || 0} done`);
  if (demonstrations?.storage?.note) console.log(`Storage: ${demonstrations.storage.note}`);
  const active = demonstrations?.active;
  if (active) {
    console.log(`\nRecording: ${active.title} · ${active.steps?.length || 0} step(s)`);
  }
  const recent = demonstrations?.recent || [];
  if (!recent.length) {
    console.log('\nRecent demonstrations: none');
    return;
  }
  console.log('\nRecent demonstrations:');
  for (const demo of recent.slice(0, 10)) {
    const generated = demo.playbook?.generatedAt ? ` · playbook ${formatTime(demo.playbook.generatedAt)}` : '';
    console.log(`- ${demo.status} · ${demo.title || demo.goal || demo.id} · ${demo.steps?.length || 0} step(s)${generated}`);
    if (demo.playbook?.summary) console.log(`  ${compact(demo.playbook.summary, 160)}`);
  }
}

async function showDemonstrations() {
  const result = await request('/api/demonstrations?limit=10');
  console.log('');
  printDemonstrations(result.demonstrations || {});
}

function printShortcuts(shortcuts) {
  const counts = shortcuts?.counts || {};
  console.log(`Shortcuts: ${counts.enabled || 0} enabled · ${counts.disabled || 0} disabled · ${counts.total || 0} total`);
  const items = shortcuts?.items || [];
  if (!items.length) {
    console.log('Saved shortcuts: none');
    return;
  }
  console.log('\nSaved shortcuts:');
  for (const item of items.slice(0, 20)) {
    const skill = item.skillRecallPlan?.primarySkill?.name || '-';
    const used = item.usedCount ? ` · used ${item.usedCount}` : '';
    const lastUsed = item.lastUsedAt ? ` · last ${formatTime(item.lastUsedAt)}` : '';
    console.log(`- "${item.phrase}" -> ${skill}${item.enabled ? '' : ' · disabled'}${used}${lastUsed}`);
    if (item.skillRecallPlan?.summary) console.log(`  ${compact(item.skillRecallPlan.summary, 160)}`);
  }
}

async function showSkillShortcuts() {
  const result = await request('/api/shortcuts?limit=20');
  console.log('');
  printShortcuts(result.shortcuts || {});
}

function printShortcutCandidate(candidate, index) {
  const skill = candidate.skillRecallPlan?.primarySkill?.name || '-';
  const title = candidate.taskTitle || candidate.title || candidate.phrase || '-';
  console.log(`${index + 1}. ${candidate.source || 'candidate'} · ${skill} · ${compact(title, 100)}`);
  if (candidate.resultSummary) console.log(`   ${compact(candidate.resultSummary, 180)}`);
}

async function promoteShortcutCandidate(rl) {
  const result = await request('/api/shortcuts/candidates?limit=5');
  const candidates = result.candidates?.items || [];
  console.log('');
  if (!candidates.length) {
    console.log('No completed skill-plan candidates yet. Run a task that recalls a local skill, let it finish, then come back here.');
    return;
  }
  console.log('Shortcut candidates:');
  candidates.forEach(printShortcutCandidate);
  const choice = (await rl.question(`Choose candidate [1-${candidates.length}]: `)).trim();
  const selected = candidates[Number(choice) - 1];
  if (!selected) {
    console.log('\nNo shortcut saved.');
    return;
  }
  const defaultPhrase = compact(selected.phrase || selected.title || selected.taskTitle || selected.skillRecallPlan?.primarySkill?.name || '', 80);
  const phraseAnswer = (await rl.question(`Shortcut phrase [${defaultPhrase}]: `)).trim();
  const phrase = phraseAnswer || defaultPhrase;
  if (!phrase) {
    console.log('\nNo shortcut saved.');
    return;
  }
  console.log(`\nThis saves "${phrase}" as a local trigger for ${selected.skillRecallPlan?.primarySkill?.name || 'the recalled skill plan'}.`);
  console.log('It changes future routing context only; it does not approve actions or expand permissions.');
  const confirm = (await rl.question('Type SAVE to save this shortcut: ')).trim();
  if (confirm !== 'SAVE') {
    console.log('\nNo shortcut saved.');
    return;
  }
  const saved = await request('/api/shortcuts/promote', {
    method: 'POST',
    body: {
      source: 'cui',
      confirm: true,
      routeId: selected.routeId,
      jobId: selected.jobId,
      phrase,
    },
  });
  console.log(`\n${saved.output || 'Shortcut saved.'}`);
}

function summarizeWorkerGroups(groups) {
  if (!Array.isArray(groups)) return `${Number(groups || 0)} group(s)`;
  if (!groups.length) return '0 group(s)';
  const summary = groups.slice(0, 4).map((group) => {
    const owner = [group.owner, group.lane].filter(Boolean).join('/') || group.id || 'worker';
    const parts = [];
    if (Number(group.active || 0)) parts.push(`${group.active} active`);
    if (Number(group.done || 0)) parts.push(`${group.done} done`);
    if (Number(group.failed || 0)) parts.push(`${group.failed} failed`);
    if (!parts.length) parts.push(`${group.total || 0} total`);
    return `${owner} ${parts.join(', ')}`;
  });
  const more = groups.length > summary.length ? `; +${groups.length - summary.length} more` : '';
  return `${groups.length} group(s): ${summary.join('; ')}${more}`;
}

function summarizeNextActions(actions) {
  if (!Array.isArray(actions)) return compact(actions || '-', 260);
  return compact(actions.map((action) => action?.label || action?.summary || action?.id || String(action)).join(' | ') || '-', 260);
}

function printRealtimeEvidence(result) {
  const evidence = result?.evidence || result || {};
  const dogfood = evidence.dogfood || {};
  const checks = evidence.checks || {};
  const conversation = evidence.conversation || {};
  const voiceHealth = evidence.voiceHealth || {};
  const negotiation = conversation.lastRealtimeSessionNegotiation || {};
  const injection = conversation.lastRealtimeProgressInjection || {};
  const progress = evidence.progress || {};
  const progressSync = evidence.progressSync || progress.sync || {};
  const shortcutTools = evidence.shortcutTools || {};
  const shortcutEvents = Array.isArray(shortcutTools.recent) ? shortcutTools.recent : [];
  const handoffTools = evidence.handoffTools || {};
  const handoffEvents = Array.isArray(handoffTools.recent) ? handoffTools.recent : [];
  const toolCalls = Array.isArray(evidence.toolCalls) ? evidence.toolCalls : [];
  const drill = evidence.drill || dogfood.drill || {};
  const dogfoodStart = evidence.dogfoodStart || drill.dogfoodStart || {};
  const checklist = Array.isArray(evidence.checklist) ? evidence.checklist : [];
  const checkLabels = [
    ['providerReady', 'Realtime provider'],
    ['sessionNegotiated', 'WebRTC session'],
    ['progressInjectedFromRenderer', 'Renderer progress injection'],
    ['progressVersionSynced', 'Progress sequence sync'],
    ['passiveContextOnly', 'Passive context only'],
    ['spokenSummaryReady', 'Short spoken summary'],
  ];
  console.log(`Realtime voice evidence: ${evidence.readyForVoiceProgressQuestion ? 'READY' : 'pending'}`);
  console.log(`Status: ${evidence.status || 'pending'} · phase ${evidence.phase || '-'}`);
  if (evidence.generatedAt) console.log(`Generated: ${evidence.generatedAt}`);
  console.log(`Next: ${evidence.nextAction || '-'}`);
  if (evidence.blocker?.summary) {
    console.log(`Blocker: ${evidence.blocker.label || evidence.blocker.id || '-'} · ${compact(evidence.blocker.summary, 220)}`);
  }
  console.log('\nChecks:');
  if (checklist.length) {
    for (const step of checklist) {
      const suffix = step.detail ? ` · ${compact(step.detail, 180)}` : '';
      console.log(`- ${step.status || (step.ok ? 'ready' : 'pending')} ${step.label || step.id || '-'}${suffix}`);
    }
  } else {
    for (const [key, label] of checkLabels) {
      console.log(`- ${checks[key] ? 'ok' : 'pending'} ${label}`);
    }
  }
  if (Array.isArray(evidence.missing) && evidence.missing.length) {
    console.log('\nMissing:');
    for (const item of evidence.missing.slice(0, 4)) {
      console.log(`- ${item}`);
    }
  }
  if (Array.isArray(drill.steps) && drill.steps.length) {
    console.log('\nDogfood drill:');
    console.log(`- ${drill.status || 'pending'} · ${compact(drill.summary || '-', 240)}`);
    if (dogfoodStart.active || dogfoodStart.status) {
      console.log(`- start state: ${dogfoodStart.status || 'idle'} · pendingOnLive=${dogfoodStart.pendingProgressOnLive ? 'yes' : 'no'} · progressQueued=${dogfoodStart.progressQueuedAt ? 'yes' : 'no'}`);
    }
    for (const step of drill.steps.slice(0, 8)) {
      console.log(`- ${step.status || (step.ok ? 'ready' : 'pending')} ${step.label || step.id || '-'} · ${compact(step.nextAction || step.detail || '-', 180)}`);
    }
    if (Array.isArray(drill.prompts) && drill.prompts.length) {
      console.log(`- prompts: ${drill.prompts.slice(0, 4).join(' | ')}`);
    }
  }
  console.log('\nShortcut tools:');
  console.log(`- observed ${Number(shortcutTools.count || 0)} recent event(s) · actions ${(shortcutTools.observedActions || []).join(', ') || '-'}`);
  console.log(`- gates confirm=${shortcutTools.hasConfirmationGate ? 'yes' : 'no'} · save=${shortcutTools.hasSave ? 'yes' : 'no'} · forget=${shortcutTools.hasForget ? 'yes' : 'no'}`);
  console.log(`- next ${compact(shortcutTools.nextAction || dogfood.shortcutTools?.nextAction || 'Ask live voice to list, save, or forget a shortcut phrase.', 220)}`);
  for (const event of shortcutEvents.slice(0, 4)) {
    const shortcut = event.shortcut || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      shortcut.action || event.name || '-',
      shortcut.requiresConfirmation ? 'confirmation' : '',
      shortcut.phrase ? `phrase="${compact(shortcut.phrase, 60)}"` : '',
    ].filter(Boolean);
    console.log(`- ${event.name || 'shortcut_tool'} · ${bits.join(' · ')}`);
  }
  console.log('\nHandoff tool:');
  console.log(`- observed ${Number(handoffTools.count || 0)} recent event(s) · called=${handoffTools.hasHandoff ? 'yes' : 'no'}`);
  console.log(`- next ${compact(handoffTools.nextAction || dogfood.handoffTools?.nextAction || 'Ask live voice for the current work handoff.', 220)}`);
  for (const event of handoffEvents.slice(0, 4)) {
    const handoff = event.handoff || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      handoff.readiness ? `readiness=${handoff.readiness}` : '',
      handoff.progressSequence ? `seq=${handoff.progressSequence}` : '',
      handoff.nextActionCount ? `next=${handoff.nextActionCount}` : '',
    ].filter(Boolean);
    const summary = handoff.spokenSummary ? ` · ${compact(handoff.spokenSummary, 140)}` : '';
    console.log(`- ${event.name || 'get_work_handoff'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nRecent realtime tool calls:');
  if (toolCalls.length) {
    for (const event of toolCalls.slice(0, 5)) {
      const resultShape = event.result || {};
      const shortcut = event.shortcut?.action ? ` · shortcut=${event.shortcut.action}` : '';
      console.log(`- ${event.name || '-'} · ${event.ok ? 'ok' : 'fail'} · ${event.source || '-'} · ${Math.round(Number(event.durationMs || 0))}ms · ${resultShape.outputType || 'output'}:${resultShape.outputBytes || 0}B${shortcut}`);
    }
  } else {
    console.log('- none yet');
  }
  if (dogfood.manualOnly) {
    console.log('\nManual dogfood:');
    console.log(`- start: ${dogfood.start?.petAction || 'Click the desktop pet or use the summon hotkey.'}`);
    console.log(`- hotkey: ${dogfood.start?.hotkey || 'Option+Space'}`);
    console.log(`- work-next: ${dogfood.start?.workNext?.method || 'POST'} ${dogfood.start?.workNext?.path || '/api/work/next'} · manual only`);
    if (dogfood.startDrill?.path) {
      console.log(`- start drill: ${dogfood.startDrill.method || 'POST'} ${dogfood.startDrill.path} · prepareProgress=${dogfood.startDrill.body?.prepareProgress !== false ? 'yes' : 'no'} · whenLive=${dogfood.startDrill.body?.prepareWhenLive !== false ? 'yes' : 'no'}`);
    }
    if (dogfood.prepareProgress?.path) {
      console.log(`- prepare progress: ${dogfood.prepareProgress.method || 'POST'} ${dogfood.prepareProgress.path} · ${dogfood.prepareProgress.body?.durationMs || 45000}ms sample`);
    }
    console.log(`- monitor: ${dogfood.monitor?.cui || 'npm run config -> V'} · ${dogfood.monitor?.endpoint || '/api/realtime/evidence'}`);
    console.log(`- ask when READY: ${dogfood.promptWhenReady || '后台现在怎么样'}`);
    if (dogfood.currentStep?.label) {
      console.log(`- current step: ${dogfood.currentStep.status || 'pending'} ${dogfood.currentStep.label} · ${compact(dogfood.currentStep.nextAction || dogfood.currentStep.detail || '-', 220)}`);
    }
  }
  console.log('\nVoice session:');
  console.log(`- status ${conversation.status || 'idle'} · mic ${conversation.micMode || '-'} · session ${conversation.sessionId || '-'}`);
  if (voiceHealth.summary) {
    console.log(`- provider ${voiceHealth.status || 'unknown'} · ${compact(voiceHealth.summary, 220)}`);
    if (voiceHealth.next) console.log(`- next ${compact(voiceHealth.next, 220)}`);
  }
  if (Object.keys(negotiation).length) {
    console.log(`- negotiation ok=${negotiation.ok === true ? 'yes' : 'no'} · status=${negotiation.statusCode || '-'} · offer=${negotiation.offerBytes || 0}B · answer=${negotiation.answerBytes || 0}B · ${formatInterval(negotiation.durationMs)}`);
  } else {
    console.log('- negotiation none yet');
  }
  if (Object.keys(injection).length) {
    console.log(`- injection ${injection.transport || '-'} · channel=${injection.dataChannelReadyState || '-'} · forced=${injection.forcedResponse === true ? 'yes' : 'no'} · seq=${injection.progressSequence || 0} · workers=${injection.workerSummary || '-'}`);
  } else {
    console.log('- injection none yet');
  }
  console.log('\nProgress summary:');
  console.log(`- sync ${progressSync.status || 'pending'} · current seq ${progressSync.currentSequence ?? progress.version?.sequence ?? 0} · injected seq ${progressSync.injectedSequence ?? injection.progressSequence ?? 0} · behind ${progressSync.behindBy ?? 0}`);
  console.log(`- workers ${summarizeWorkerGroups(progress.workerGroups)} · active jobs ${progress.activeJobs || 0} · blocked workflows ${progress.blockedWorkflows || 0}`);
  console.log(`- spoken ${compact(progress.spokenSummary || '-', 420)}`);
  if (Array.isArray(progress.nextActions) && progress.nextActions.length) {
    console.log(`- next ${summarizeNextActions(progress.nextActions)}`);
  }
}

async function watchRealtimeEvidence(rl) {
  const answer = (await rl.question('\nWatch realtime voice evidence for how many seconds? [120] ')).trim();
  const parsedSeconds = Number(answer);
  const seconds = Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? Math.min(600, Math.max(5, parsedSeconds)) : 120;
  const endAt = Date.now() + seconds * 1000;
  let lastError = null;
  while (Date.now() <= endAt) {
    console.clear();
    console.log('JAVIS Realtime Voice Evidence');
    console.log('=============================');
    console.log(`Watching ${API_BASE}/api/realtime/evidence · ${Math.max(0, Math.ceil((endAt - Date.now()) / 1000))}s left\n`);
    try {
      const result = await request('/api/realtime/evidence');
      lastError = null;
      printRealtimeEvidence(result);
    } catch (error) {
      lastError = error;
      console.log(`Cannot read realtime evidence: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(Math.min(3000, Math.max(250, endAt - Date.now())));
  }
  if (lastError) throw lastError;
}

async function startRealtimeDogfoodDrillFromCui(rl) {
  console.log('\nPreviewing Realtime dogfood drill start...');
  const preview = await request('/api/realtime/dogfood/start', {
    method: 'POST',
    body: { execute: false, source: 'cui' },
  });
  if (preview.output) console.log(compact(preview.output, 900));
  const answer = (await rl.question('Start drill now? Type RUN to summon JAVIS and prepare a progress sample after voice is live: ')).trim();
  if (answer !== 'RUN') {
    console.log('\nNo drill started.');
    return;
  }
  const result = await request('/api/realtime/dogfood/start', {
    method: 'POST',
    body: { execute: true, prepareProgress: true, prepareWhenLive: true, durationMs: 45000, source: 'cui' },
  });
  console.log(`\nRealtime dogfood drill ${result.executed ? 'started' : 'reviewed'}.`);
  if (result.output) console.log(compact(result.output, 1200));
  console.log('Open CUI option V to watch the drill evidence update.');
}

async function movePetCorner(rl) {
  const status = await request('/api/window/state');
  const current = status.window?.parkCorner || getEnvValue('JAVIS_WINDOW_PARK_CORNER') || 'notch';
  console.log(`\nPet position is currently ${current}.`);
  PARK_CORNERS.forEach((corner, index) => {
    console.log(`${index + 1}. ${corner}`);
  });
  const answer = (await rl.question(`Choose position [1-${PARK_CORNERS.length}]: `)).trim();
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
  if (process.argv.includes('--print-realtime-evidence') || process.argv.includes('--realtime-evidence')) {
    const result = await request('/api/realtime/evidence');
    printRealtimeEvidence(result);
    return;
  }

  if (process.argv.includes('--print-work-handoff') || process.argv.includes('--work-handoff')) {
    const result = await request('/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900');
    printWorkHandoff(result);
    return;
  }

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
      else if (answer === 'm' || answer === 'mic' || answer === 'microphone') await setupAction('open_microphone_settings');
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
        await setControlMode(rl);
      } else if (answer === '12') {
        const doctor = await request('/api/doctor/report');
        console.log(`\n${doctor.doctor?.label || doctor.doctor?.overall || 'Doctor complete'}`);
        console.log(issueLines(doctor.doctor).join('\n') || 'All checks ready.');
      } else if (answer === '13') {
        const result = await request('/api/wake/trigger', {
          method: 'POST',
          body: { source: 'cui', phrase: 'manual test' },
        });
        console.log(`\nWake trigger queued. Pending: ${result.wake?.pending ? 'yes' : 'no'}`);
      } else if (answer === 'v' || answer === 'voice' || answer === 'realtime') {
        await watchRealtimeEvidence(rl);
      } else if (answer === 'd' || answer === 'dogfood' || answer === 'drill') {
        await startRealtimeDogfoodDrillFromCui(rl);
      } else if (answer === 'h' || answer === 'handoff' || answer === 'work handoff') {
        await showWorkHandoff();
      } else if (answer === '14') {
        await showWorkbenchNext();
      } else if (answer === '15') {
        await runWorkbenchNext(rl);
      } else if (answer === '16') {
        await showAutopilotStatus();
      } else if (answer === '17') {
        await runAutopilotTick(rl);
      } else if (answer === '18') {
        await toggleAutopilot(rl);
      } else if (answer === '19') {
        const result = await request('/api/learning/distill', {
          method: 'POST',
          body: { source: 'cui' },
        });
        console.log(`\nLearning refreshed: ${result.learning?.profile?.summary || 'no profile yet'}`);
      } else if (answer === '20') {
        const result = await request('/api/learning/remember', {
          method: 'POST',
          body: { source: 'cui' },
        });
        console.log(`\nSaved learning memory: ${result.memory?.text ? compact(result.memory.text, 500) : result.memory?.id || 'done'}`);
      } else if (answer === '21') {
        await toggleLearning(rl);
      } else if (answer === '22') {
        await manageLearningExclusions(rl);
      } else if (answer === '23') {
        await deleteLearningData(rl);
      } else if (answer === '24') {
        await previewLearningSkillDraft();
      } else if (answer === '25') {
        await exportLearningSkillDraft(rl);
      } else if (answer === '26') {
        await showCollaborationClaims();
      } else if (answer === '27') {
        await showDemonstrations();
      } else if (answer === '28') {
        await showSkillShortcuts();
      } else if (answer === '29') {
        await promoteShortcutCandidate(rl);
      } else if (answer === '30' || answer === 'q' || answer === 'quit' || answer === 'exit') {
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
