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
    const [status, doctor, autopilotResult, browserJs, shortcutsResult, perceptionResult] = await Promise.all([
      request('/api/status'),
      request('/api/doctor/report'),
      request('/api/autopilot').catch(() => ({ autopilot: null })),
      request('/api/browser/javascript').catch((error) => ({ javascript: { enabled: false, error: error instanceof Error ? error.message : String(error) } })),
      request('/api/shortcuts?limit=5').catch(() => ({ shortcuts: null })),
      request('/api/perception/consent?limit=3').catch(() => ({ perception: null })),
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
    if (perceptionResult.perception) {
      const perception = perceptionResult.perception;
      const counts = perception.counts || {};
      console.log(`Perception: ${counts.enabled || 0}/${counts.total || 0} enabled · active ${counts.active || 0} · limited ${counts.limited || 0} · blocked ${counts.blocked || 0}`);
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
      if (status.presence.attention) {
        const attention = status.presence.attention;
        const cooldown = attention.cooldown?.active ? ` · quiet ${attention.cooldown.remainingLabel || '-'}` : '';
        console.log(`Attention: ${attention.level || 'quiet'} · pet ${attention.petState || '-'} · notify ${attention.shouldNotify ? 'yes' : 'no'}${cooldown} · ${compact(attention.summary || '', 90)}`);
      }
    }
    if (autopilotResult.autopilot) {
      const autopilot = autopilotResult.autopilot;
      const maintenance = autopilot.maintenance || {};
      const decision = autopilotResult.decisionPreview || autopilot.lastDecision || null;
      const maintenanceText = maintenance.minIntervalMs
        ? ` · maintenance ${maintenance.due ? 'due' : 'cooldown'}${maintenance.lastSnapshotAt ? ` last ${formatTime(maintenance.lastSnapshotAt)}` : ''}`
        : '';
      const decisionText = decision?.skipSummary || decision?.reason || decision?.selectedAction?.decision?.reason || decision?.outcome || 'none';
      console.log(`Autopilot: ${autopilot.enabled ? 'on' : 'off'} · every ${formatInterval(autopilot.intervalMs)} · ticks ${autopilot.tickCount || 0} · ran ${autopilot.executedCount || 0} · decision ${compact(decisionText, 60)} · last ${compact(autopilot.lastResult || 'none', 80)}${maintenanceText}`);
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
  console.log('R. Run renderer Realtime dogfood (starts mic)');
  console.log('B. Show Realtime dogfood brief');
  console.log('E. Show Realtime dogfood acceptance');
  console.log('A. Save Realtime dogfood archive');
  console.log('P. Copy next Realtime dogfood prompt');
  console.log('T. Track Realtime dogfood session');
  console.log('H. Show spoken work handoff');
  console.log('L. Show local capability map');
  console.log('G. Show browser workflow benchmarks');
  console.log('F. Show file workflow benchmarks');
  console.log('K. Show knowledge workflow benchmarks');
  console.log('C. Show creative workflow benchmarks');
  console.log('U. Show app workflow benchmarks');
  console.log('Y. Show productivity workflow benchmarks');
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
  console.log('30. Show browser activity');
  console.log('31. Show attention policy');
  console.log('32. Show perception consent');
  console.log('33. Show screen privacy');
  console.log('34. Quit');
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

function printAutopilotDecision(decision, label = 'Decision') {
  if (!decision) return;
  const selected = decision.selectedAction || null;
  const first = decision.firstAction || null;
  const target = selected || first;
  const targetText = target ? `${target.label || target.id || 'action'} (${target.source || 'unknown'})` : 'none';
  const reason = decision.reason ? ` · reason ${decision.reason}` : '';
  console.log(`${label}: ${decision.outcome || 'preview'}${reason} · target ${targetText}`);
  if (decision.skipSummary) console.log(`Why waiting: ${compact(decision.skipSummary, 260)}`);
  if (decision.nextWait) console.log(`Wait: ${compact(decision.nextWait, 220)}`);
  if (decision.candidateCounts) {
    const counts = decision.candidateCounts;
    console.log(`Candidate counts: ${counts.autoExecutable || 0} auto / ${counts.manualOnly || 0} manual / ${counts.blocked || 0} blocked / ${counts.total || 0} total`);
  }
  const waitingFor = Array.isArray(decision.waitingFor) ? decision.waitingFor : [];
  if (waitingFor.length) {
    const waits = waitingFor.slice(0, 4).map((item, index) => {
      const wait = item.waitLabel ? ` · ${item.waitLabel}` : '';
      return `${index + 1}. ${item.label || item.id} · ${item.status || 'waiting'}${wait}: ${compact(item.summary || '', 140)}`;
    });
    console.log(`Waiting for: ${waits.join(' | ')}`);
  }
  const candidates = Array.isArray(decision.candidates) ? decision.candidates : [];
  if (candidates.length) {
    const lines = candidates.slice(0, 3).map((candidate, index) => {
      const state = candidate.decision?.executable ? 'auto' : candidate.decision?.reason || 'blocked';
      return `${index + 1}. ${candidate.label || candidate.id} · ${candidate.source || '-'} · ${state}`;
    });
    console.log(`Candidates: ${lines.join(' | ')}`);
  }
}

function printAutopilotDetails(autopilot, decisionPreview = null) {
  console.log(`Autopilot: ${autopilot.enabled ? 'on' : 'off'}${autopilot.busy || autopilot.running ? ' · busy' : ''}`);
  console.log(`Interval: ${formatInterval(autopilot.intervalMs)} (${autopilot.intervalMs || 0}ms)`);
  console.log(`Ticks: ${autopilot.tickCount || 0} · executed ${autopilot.executedCount || 0} · skipped ${autopilot.skippedCount || 0}`);
  console.log(`Last tick: ${formatTime(autopilot.lastTickAt)}`);
  console.log(`Last executed: ${formatTime(autopilot.lastExecutedAt)}`);
  if (autopilot.maintenance) {
    const maintenance = autopilot.maintenance;
    console.log(`Maintenance: ${maintenance.due ? 'due' : 'cooldown'} · every ${formatInterval(maintenance.minIntervalMs)} · last ${formatTime(maintenance.lastSnapshotAt)} · ran ${maintenance.runCount || 0}`);
  }
  printAutopilotDecision(autopilot.lastDecision, 'Last decision');
  printAutopilotDecision(decisionPreview, 'Preview');
  if (autopilot.lastResult) console.log(`Last result: ${compact(autopilot.lastResult, 260)}`);
  if (autopilot.lastError) console.log(`Last error: ${compact(autopilot.lastError, 260)}`);
}

function printNextAction(next) {
  const action = next?.action || next?.next?.action || next?.next?.briefing?.nextActions?.[0] || next?.briefing?.nextActions?.[0];
  if (!action) {
    console.log('Next action: none');
    return false;
  }
  const auto = action.manualOnly || action.autopilotEligible === false
    ? 'manual-only'
    : action.autoEligible || action.workflowAction === 'retry_app_workflow' ? 'auto-eligible' : 'manual';
  console.log(`Next action: ${action.label || action.id || 'unnamed'} (${action.source || 'unknown'}, ${auto})`);
  if (action.summary) console.log(`Summary: ${compact(action.summary, 260)}`);
  if (action.manualOnlyReason) console.log(`Manual reason: ${compact(action.manualOnlyReason, 220)}`);
  const guide = action.dogfoodGuide || action.guide || {};
  return printDogfoodGuide(guide);
}

function printDogfoodGuide(guide = {}) {
  if (guide.goal) {
    const prompts = Array.isArray(guide.prompts) ? guide.prompts : [];
    const evidenceTools = (Array.isArray(guide.expectedEvidence) ? guide.expectedEvidence : [])
      .map((item) => item?.tool)
      .filter(Boolean);
    console.log(`Guide: ${compact(guide.goal, 260)}`);
    if (guide.start?.petAction) console.log(`Start: ${compact(guide.start.petAction, 220)}`);
    if (guide.start?.hotkey) console.log(`Hotkey: ${guide.start.hotkey}`);
    if (guide.monitor?.cui) console.log(`Monitor: ${guide.monitor.cui}`);
    if (prompts.length) console.log(`Ask: ${prompts.join(' / ')}`);
    if (evidenceTools.length) console.log(`Evidence tools: ${evidenceTools.join(', ')}`);
    return true;
  }
  return false;
}

async function showWorkbenchNext() {
  const preview = await request('/api/work/next?workflowLimit=6&jobLimit=6');
  console.log('');
  const printedGuide = printNextAction(preview);
  const realtimeGuide = preview?.next?.briefing?.realtimeVoice?.dogfoodGuide || preview?.briefing?.realtimeVoice?.dogfoodGuide || {};
  if (!printedGuide) printDogfoodGuide(realtimeGuide);
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

function printLocalCapabilities(result) {
  const capabilities = result?.capabilities || result || {};
  const rows = Array.isArray(capabilities.capabilities) ? capabilities.capabilities : [];
  const counts = capabilities.counts || {};
  console.log('JAVIS Local Capabilities');
  console.log('========================');
  console.log(capabilities.spokenSummary || capabilities.summary || 'No capability summary available.');
  console.log(`Counts: ready ${counts.ready || 0} · limited ${counts.limited || 0} · blocked ${counts.blocked || 0} · shown ${counts.total || rows.length}`);
  const control = capabilities.controlMode || {};
  const policy = capabilities.policy || {};
  console.log(`Control: ${control.mode || '-'} · local execution=${control.localExecutionEnabled ? 'on' : 'off'} · trusted=${control.trustedLocalMode ? 'yes' : 'no'} · auto L${control.effectiveMaxAutoRiskLevel ?? '-'} · approval L${control.effectiveRequireApprovalAtRiskLevel ?? '-'}`);
  console.log(`Policy: dryRun=${policy.dryRun ? 'yes' : 'no'} · cli=${Array.isArray(policy.cliAllowedCommands) ? policy.cliAllowedCommands.join(', ') || '-' : '-'} · write roots=${policy.writeRootCount ?? '-'}`);
  const collaboration = capabilities.collaboration || {};
  console.log(`Collab: ${collaboration.active || 0} active · ${collaboration.conflictPairs || 0} conflict pair(s)`);
  if (capabilities.readiness?.summary) console.log(`Readiness: ${capabilities.readiness.overall || '-'} · ${compact(capabilities.readiness.summary, 220)}`);
  if (capabilities.next?.output) console.log(`Next: ${compact(capabilities.next.output, 260)}`);
  const guardrails = Array.isArray(capabilities.guardrails) ? capabilities.guardrails : [];
  if (guardrails.length) {
    console.log('\nGuardrails:');
    for (const item of guardrails.slice(0, 6)) console.log(`- ${compact(item, 180)}`);
  }
  const starts = Array.isArray(capabilities.recommendedStart) ? capabilities.recommendedStart : [];
  if (starts.length) {
    console.log('\nRecommended start tools:');
    for (const item of starts.slice(0, 6)) {
      console.log(`- ${item.tool || '-'}: ${compact(item.reason || item.when || '', 180)}`);
    }
  }
  if (!rows.length) {
    console.log('\nCapabilities: none matched.');
    return;
  }
  console.log('\nCapabilities:');
  for (const item of rows) {
    console.log(`- ${item.id || '-'} · ${item.status || '-'} · ${item.label || '-'}: ${compact(item.summary || '', 220)}`);
    if (Array.isArray(item.recommendedTools) && item.recommendedTools.length) {
      console.log(`  tools=${item.recommendedTools.slice(0, 10).join(', ')}`);
    }
    if (item.nextAction) console.log(`  next=${compact(item.nextAction, 180)}`);
  }
}

async function showLocalCapabilities(options = {}) {
  const params = new URLSearchParams();
  params.set('includeNext', options.includeNext === true ? 'true' : 'false');
  if (options.query) params.set('query', options.query);
  if (options.lane) params.set('lane', options.lane);
  const result = await request(`/api/capabilities?${params.toString()}`);
  console.log('');
  printLocalCapabilities(result);
}

async function showAutopilotStatus() {
  const [autopilotResult, next] = await Promise.all([
    request('/api/autopilot'),
    request('/api/work/next').catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
  ]);
  console.log('');
  printAutopilotDetails(autopilotResult.autopilot || {}, autopilotResult.decisionPreview || null);
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
  printAutopilotDetails(result.autopilot || result.tick?.autopilot || {}, result.autopilot?.lastDecision || result.tick?.autopilot?.lastDecision || null);
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

function printBrowserActivity(activity) {
  console.log('Browser Activity');
  console.log('================');
  console.log(activity?.summary || 'No browser activity summary available.');
  const privacy = activity?.privacy || {};
  console.log(`Privacy: metadata-only=${privacy.metadataOnly ? 'yes' : 'no'} · page text stored=${privacy.noPageText ? 'no' : 'unknown'} · urls redacted=${privacy.urlsRedactedForStorage ? 'yes' : 'no'}`);
  const current = activity?.current;
  if (current) {
    console.log(`Current: ${[current.app, current.host || current.title].filter(Boolean).join(' · ') || '-'} · ${formatTime(current.createdAt)}`);
  }
  const topHosts = Array.isArray(activity?.topHosts) ? activity.topHosts : [];
  if (topHosts.length) {
    console.log('\nTop hosts:');
    for (const host of topHosts.slice(0, 8)) {
      console.log(`- ${host.host || '-'} · ${host.count || 0} sample(s) · ${formatTime(host.lastSeenAt)}`);
    }
  }
  const recent = Array.isArray(activity?.recent) ? activity.recent : [];
  if (!recent.length) {
    console.log('\nRecent pages: none');
    return;
  }
  console.log('\nRecent pages:');
  for (const item of recent.slice(0, 10)) {
    const title = item.title ? ` · ${compact(item.title, 120)}` : '';
    console.log(`- ${item.app || '-'} · ${item.host || '-'}${title} · ${formatTime(item.createdAt)}`);
  }
}

async function showBrowserActivity() {
  const result = await request('/api/browser/activity?limit=10');
  console.log('');
  printBrowserActivity(result.activity || {});
}

function printBrowserBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('Browser Workflow Benchmarks');
  console.log('===========================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: preview-only=${benchmarks.previewOnly ? 'yes' : 'no'} · starts browser=${benchmarks.startsBrowser ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · executed ${counts.executed || 0} · queued ${counts.queued || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: no browser actions=${safety.noBrowserActions ? 'yes' : 'no'} · no model calls=${safety.noModelCalls ? 'yes' : 'no'} · sensitive fields blocked=${safety.sensitiveFieldsBlocked ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${item.intent || '-'} · workflow ${item.workflowStatus || '-'} · route ${item.routingStatus || '-'}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showBrowserBenchmarks() {
  const result = await request('/api/browser/benchmarks?source=cui_browser_benchmarks');
  console.log('');
  printBrowserBenchmarks(result);
}

function printFileBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('File Workflow Benchmarks');
  console.log('========================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: preview-only=${benchmarks.previewOnly ? 'yes' : 'no'} · starts apps=${benchmarks.startsApps ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'} · user files mutated=${benchmarks.mutatesUserFiles ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · planned ${counts.planned || 0} · executed ${counts.executed || 0} · queued ${counts.queued || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: fixture-only=${safety.fixtureOnly ? 'yes' : 'no'} · cleanup=${safety.cleanupOk ? 'ok' : 'check'} · no model calls=${safety.noModelCalls ? 'yes' : 'no'} · apply gate=${safety.confirmRequiredForApply ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${item.intent || '-'} · workflow ${item.workflowStatus || '-'} · route ${item.routingStatus || '-'}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showFileBenchmarks() {
  const result = await request('/api/files/benchmarks?source=cui_file_benchmarks');
  console.log('');
  printFileBenchmarks(result);
}

function printKnowledgeBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('Knowledge Workflow Benchmarks');
  console.log('=============================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: fixture-only=${benchmarks.fixtureOnly ? 'yes' : 'no'} · starts apps=${benchmarks.startsApps ? 'yes' : 'no'} · writes fixture=${benchmarks.writesFixture ? 'yes' : 'no'} · user files mutated=${benchmarks.mutatesUserFiles ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · preview ${counts.preview || 0} · executed ${counts.executed || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: fixture-only=${safety.fixtureOnly ? 'yes' : 'no'} · cleanup=${safety.cleanupOk ? 'ok' : 'check'} · no user files=${safety.noUserFileMutation ? 'yes' : 'no'} · write gate=${safety.confirmRequiredForWrite ? 'yes' : 'no'} · fixture write=${safety.confirmedFixtureWrite ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${item.intent || '-'} · workflow ${item.workflowStatus || '-'} · route ${item.routingStatus || '-'}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showKnowledgeBenchmarks() {
  const result = await request('/api/knowledge/benchmarks?source=cui_knowledge_benchmarks');
  console.log('');
  printKnowledgeBenchmarks(result);
}

function printCreativeBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('Creative Workflow Benchmarks');
  console.log('============================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: preview-only=${benchmarks.previewOnly ? 'yes' : 'no'} · starts apps=${benchmarks.startsApps ? 'yes' : 'no'} · creative actions=${benchmarks.executesCreativeActions ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · video ${counts.video || 0} · music ${counts.music || 0} · blocked gates ${counts.blocked || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: plan-only=${safety.planOnly ? 'yes' : 'no'} · no app launch=${safety.noAppLaunch ? 'yes' : 'no'} · export gate=${safety.exportConfirmationGate ? 'yes' : 'no'} · asset gate=${safety.assetPathGate ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    const target = [item.app, item.stageId, item.actionId].filter(Boolean).join(' · ') || item.intent || '-';
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${target}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showCreativeBenchmarks() {
  const result = await request('/api/creative/benchmarks?source=cui_creative_benchmarks');
  console.log('');
  printCreativeBenchmarks(result);
}

function printAppBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('App Workflow Benchmarks');
  console.log('=======================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: preview-only=${benchmarks.previewOnly ? 'yes' : 'no'} · starts apps=${benchmarks.startsApps ? 'yes' : 'no'} · app actions=${benchmarks.executesAppActions ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · planned ${counts.planned || 0} · executed ${counts.executed || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: plan-only=${safety.planOnly ? 'yes' : 'no'} · no app launch=${safety.noAppLaunch ? 'yes' : 'no'} · no UI actions=${safety.noUiActions ? 'yes' : 'no'} · unsafe delete=${safety.unsafeDeleteRejected ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    const target = [item.intent, item.source, Array.isArray(item.stepTypes) ? item.stepTypes.join('/') : ''].filter(Boolean).join(' · ') || '-';
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${target}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showAppBenchmarks() {
  const result = await request('/api/app/benchmarks?source=cui_app_benchmarks');
  console.log('');
  printAppBenchmarks(result);
}

function printProductivityBenchmarks(result) {
  const benchmarks = result?.benchmarks || result || {};
  const counts = benchmarks.counts || {};
  console.log('Productivity Workflow Benchmarks');
  console.log('================================');
  console.log(benchmarks.summary || `${counts.pass || 0}/${counts.total || 0} benchmark case(s) passed.`);
  console.log(`Mode: preview-only=${benchmarks.previewOnly ? 'yes' : 'no'} · starts apps=${benchmarks.startsApps ? 'yes' : 'no'} · productivity actions=${benchmarks.executesProductivityActions ? 'yes' : 'no'} · sends messages=${benchmarks.sendsMessages ? 'yes' : 'no'} · model calls=${benchmarks.modelCalls ? 'yes' : 'no'}`);
  console.log(`Counts: pass ${counts.pass || 0}/${counts.total || 0} · fail ${counts.fail || 0} · notes ${counts.notes || 0} · reminders ${counts.reminders || 0} · calendar ${counts.calendar || 0} · mail ${counts.mail || 0}`);
  const safety = benchmarks.safety || {};
  console.log(`Safety: plan-only=${safety.planOnly ? 'yes' : 'no'} · no app launch=${safety.noAppLaunch ? 'yes' : 'no'} · native preview=${safety.nativeCreatePreview ? 'yes' : 'no'} · calendar gate=${safety.calendarConfirmationGate ? 'yes' : 'no'} · email recipient gate=${safety.emailRecipientGate ? 'yes' : 'no'} · email send blocked=${safety.emailSendBlocked ? 'yes' : 'no'}`);
  const cases = Array.isArray(benchmarks.cases) ? benchmarks.cases : [];
  if (!cases.length) {
    console.log('\nCases: none');
    return;
  }
  console.log('\nCases:');
  for (const item of cases) {
    const target = [item.app, item.stageId, item.actionId].filter(Boolean).join(' · ') || item.intent || '-';
    console.log(`- ${item.ok ? 'pass' : 'fail'} ${item.label || item.id || '-'} · ${target}`);
    if (item.summary) console.log(`  ${compact(item.summary, 180)}`);
  }
  if (benchmarks.nextAction) console.log(`\nNext: ${benchmarks.nextAction}`);
}

async function showProductivityBenchmarks() {
  const result = await request('/api/productivity/benchmarks?source=cui_productivity_benchmarks');
  console.log('');
  printProductivityBenchmarks(result);
}

function printPerceptionConsent(result) {
  const perception = result?.perception || result || {};
  const counts = perception.counts || {};
  console.log('Perception Consent');
  console.log('==================');
  console.log(perception.summary || 'No perception consent summary available.');
  console.log(`Policy: local-only=${perception.policy?.localOnly ? 'yes' : 'no'} · passive=${perception.policy?.passiveByDefault ? 'yes' : 'no'} · user intent for action=${perception.policy?.requiresUserIntentForAction ? 'yes' : 'no'}`);
  console.log(`Control: ${perception.policy?.controlMode?.mode || '-'} · local execution=${perception.policy?.localExecutionEnabled ? 'on' : 'off'} · trusted=${perception.policy?.trustedLocalMode ? 'yes' : 'no'}`);
  console.log(`Counts: ${counts.enabled || 0}/${counts.total || 0} enabled · active ${counts.active || 0} · ready ${counts.ready || 0} · waiting ${counts.waiting || 0} · limited ${counts.limited || 0} · blocked ${counts.blocked || 0}`);
  const surfaces = Array.isArray(perception.surfaces) ? perception.surfaces : [];
  if (!surfaces.length) {
    console.log('\nSurfaces: none');
    return;
  }
  console.log('\nSurfaces:');
  for (const surface of surfaces) {
    const consent = surface.consent || {};
    const lastAudit = surface.lastAudit ? `${surface.lastAudit.type} ${surface.lastAudit.ts || ''}`.trim() : 'none';
    console.log(`- ${surface.id} · ${surface.label}: ${surface.status} · enabled=${surface.enabled ? 'yes' : 'no'} · raw stored=${surface.rawContentStored ? 'yes' : 'no'}`);
    console.log(`  data=${surface.dataClass || '-'} · retention=${compact(surface.retention || '-', 160)}`);
    console.log(`  consent=${consent.policyGate || '-'} · system=${consent.systemPermission ?? '-'} · user action=${consent.explicitUserActionRequired ? 'yes' : 'no'} · audit=${lastAudit}`);
    if (surface.id === 'screen_context' && surface.evidence?.rulesSummary) {
      console.log(`  privacy rules=${surface.evidence.rulesSummary}`);
      const enforcement = surface.evidence.enforcement || {};
      console.log(`  enforcement=global:${enforcement.globalTransform || '-'} · app/window filter=${enforcement.appWindowContextFilter ? 'yes' : 'no'} · region mask=${enforcement.regionRendererMask ? 'yes' : enforcement.regionRendererMaskStatus || 'no'}`);
    }
    if (surface.nextAction) console.log(`  next=${compact(surface.nextAction, 180)}`);
  }
}

async function showPerceptionConsent() {
  const result = await request('/api/perception/consent?limit=8');
  console.log('');
  printPerceptionConsent(result);
}

function printScreenPrivacy(result) {
  const privacy = result?.privacy || {};
  const counts = privacy.ruleCounts || {};
  console.log('Screen Privacy');
  console.log('==============');
  console.log(`Mode: ${privacy.mode || '-'} · ${privacy.label || '-'}`);
  console.log(`Transform: maxWidth=${privacy.maxWidth || 0} · blur=${privacy.blurPx || 0}px · jpeg=${privacy.jpegQuality || 0}`);
  console.log(`Rules: ${counts.enabled || 0}/${counts.total || 0} enabled · ${privacy.rulesSummary || '-'}`);
  const enforcement = privacy.enforcement || {};
  console.log(`Enforcement: global=${enforcement.globalTransform || '-'} · app/window filter=${enforcement.appWindowContextFilter ? 'yes' : 'no'} · browser host filter=${enforcement.browserHostContextFilter ? 'yes' : 'no'} · region mask=${enforcement.regionRendererMask ? 'yes' : enforcement.regionRendererMaskStatus || 'no'}`);
  const rules = Array.isArray(privacy.rules) ? privacy.rules : [];
  if (!rules.length) {
    console.log('\nRules: none');
    return;
  }
  console.log('\nRules:');
  for (const rule of rules.slice(0, 30)) {
    const target = rule.kind === 'region'
      ? `${rule.region?.x},${rule.region?.y} ${rule.region?.width}x${rule.region?.height} ${rule.region?.unit || 'percent'}`
      : `${rule.match || 'contains'} "${rule.value || ''}"`;
    console.log(`- ${rule.id} · ${rule.enabled ? 'on' : 'off'} · ${rule.kind}/${rule.effect} · ${target}`);
  }
}

async function showScreenPrivacy() {
  const result = await request('/api/screen/privacy');
  console.log('');
  printScreenPrivacy(result);
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
  const latency = evidence.latency || conversation.lastRealtimeLatencyReceipt || {};
  const progress = evidence.progress || {};
  const progressSync = evidence.progressSync || progress.sync || {};
  const shortcutTools = evidence.shortcutTools || {};
  const shortcutEvents = Array.isArray(shortcutTools.recent) ? shortcutTools.recent : [];
  const dogfoodSessionTools = evidence.dogfoodSessionTools || {};
  const dogfoodSessionEvents = Array.isArray(dogfoodSessionTools.recent) ? dogfoodSessionTools.recent : [];
  const handoffTools = evidence.handoffTools || {};
  const handoffEvents = Array.isArray(handoffTools.recent) ? handoffTools.recent : [];
  const autopilotTools = evidence.autopilotTools || {};
  const autopilotEvents = Array.isArray(autopilotTools.recent) ? autopilotTools.recent : [];
  const attentionTools = evidence.attentionTools || {};
  const attentionEvents = Array.isArray(attentionTools.recent) ? attentionTools.recent : [];
  const perceptionTools = evidence.perceptionTools || {};
  const perceptionEvents = Array.isArray(perceptionTools.recent) ? perceptionTools.recent : [];
  const demonstrationTools = evidence.demonstrationTools || {};
  const demonstrationEvents = Array.isArray(demonstrationTools.recent) ? demonstrationTools.recent : [];
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
  console.log('\nLatency:');
  if (latency.createdAt) {
    console.log(`- ${latency.quality || '-'} · stage ${latency.stage || '-'} · start-live ${Number(latency.startToLiveMs || 0)}ms · negotiation ${Number(latency.negotiationMs || 0)}ms · live-progress ${Number(latency.liveToFirstProgressMs || 0)}ms`);
    console.log(`- mic ${Number(latency.micReadyMs || 0)}ms · offer ${Number(latency.offerReadyMs || 0)}ms · remote-live ${Number(latency.remoteDescriptionToLiveMs || 0)}ms`);
  } else {
    console.log('- none yet · start a real voice session to capture click-to-live timing.');
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
  console.log('\nDogfood session tools:');
  console.log(`- observed ${Number(dogfoodSessionTools.count || 0)} recent event(s) · actions ${(dogfoodSessionTools.observedActions || []).join(', ') || '-'}`);
  console.log(`- starts microphone=${dogfoodSessionTools.startsMicrophone ? 'yes' : 'no'} · start=${dogfoodSessionTools.hasStart ? 'yes' : 'no'} · mark=${dogfoodSessionTools.hasMark ? 'yes' : 'no'} · end=${dogfoodSessionTools.hasEnd ? 'yes' : 'no'}`);
  console.log(`- next ${compact(dogfoodSessionTools.nextAction || 'Ask live voice to inspect or update the Realtime dogfood session tracker.', 220)}`);
  for (const event of dogfoodSessionEvents.slice(0, 4)) {
    const session = event.dogfoodSession || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      session.action || event.name || '-',
      session.sessionStatus ? `status=${session.sessionStatus}` : '',
      session.stepId ? `step=${session.stepId}` : '',
      session.startsMicrophone ? 'starts-mic' : 'no-mic',
    ].filter(Boolean);
    console.log(`- ${event.name || 'dogfood_session_tool'} · ${bits.join(' · ')}`);
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
  console.log('\nAutopilot tool:');
  console.log(`- observed ${Number(autopilotTools.count || 0)} recent event(s) · called=${autopilotTools.hasStatus ? 'yes' : 'no'}`);
  console.log(`- next ${compact(autopilotTools.nextAction || dogfood.autopilotTools?.nextAction || 'Ask live voice why unattended autopilot skipped.', 220)}`);
  for (const event of autopilotEvents.slice(0, 4)) {
    const autopilot = event.autopilot || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      autopilot.canActNow ? 'can-act' : 'waiting',
      autopilot.reason ? `reason=${autopilot.reason}` : '',
      autopilot.candidateCount ? `candidates=${autopilot.candidateCount}` : '',
      autopilot.autoExecutableCount ? `auto=${autopilot.autoExecutableCount}` : '',
    ].filter(Boolean);
    const waiting = autopilot.firstWaitingFor ? ` · waiting=${compact(autopilot.firstWaitingFor, 120)}` : '';
    const summary = autopilot.spokenSummary ? ` · ${compact(autopilot.spokenSummary, 140)}` : '';
    console.log(`- ${event.name || 'get_autopilot_status'} · ${bits.join(' · ')}${waiting}${summary}`);
  }
  console.log('\nAttention explanation tool:');
  console.log(`- observed ${Number(attentionTools.count || 0)} recent event(s) · called=${attentionTools.hasExplanation ? 'yes' : 'no'}`);
  console.log(`- next ${compact(attentionTools.nextAction || dogfood.attentionTools?.nextAction || 'Ask live voice why the pet is green/yellow/red.', 220)}`);
  for (const event of attentionEvents.slice(0, 4)) {
    const attention = event.attention || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      attention.level ? `level=${attention.level}` : '',
      attention.petState ? `pet=${attention.petState}` : '',
      attention.operatorOnlyHistory ? 'operator-history' : '',
      attention.desktopPetStillMinimal ? 'pet-minimal' : '',
    ].filter(Boolean);
    const summary = attention.spokenSummary ? ` · ${compact(attention.spokenSummary, 180)}` : '';
    console.log(`- ${event.name || 'get_attention_explanation'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nPerception consent tool:');
  console.log(`- observed ${Number(perceptionTools.count || 0)} recent event(s) · called=${perceptionTools.hasConsent ? 'yes' : 'no'}`);
  console.log(`- next ${compact(perceptionTools.nextAction || dogfood.perceptionTools?.nextAction || 'Ask live voice what JAVIS can see/control and which permissions are active.', 220)}`);
  for (const event of perceptionEvents.slice(0, 4)) {
    const perception = event.perception || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      perception.surfaceCount ? `surfaces=${perception.surfaceCount}` : '',
      perception.rawStoredCount ? `raw=${perception.rawStoredCount}` : 'raw=0',
      perception.blockedCount ? `blocked=${perception.blockedCount}` : '',
      perception.localOnly ? 'local-only' : '',
      perception.requiresUserIntentForAction ? 'user-intent' : '',
      perception.desktopPetStillMinimal ? 'pet-minimal' : '',
    ].filter(Boolean);
    const summary = perception.summary ? ` · ${compact(perception.summary, 180)}` : '';
    console.log(`- ${event.name || 'get_perception_consent'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nUI demonstration tools:');
  console.log(`- observed ${Number(demonstrationTools.count || 0)} recent event(s) · actions ${(demonstrationTools.observedActions || []).join(', ') || '-'}`);
  console.log(`- replay=${demonstrationTools.hasSafeReplayPlan ? 'safe-preview' : 'pending'} · draft=${demonstrationTools.hasDraft ? 'yes' : 'no'} · confirm-gate=${demonstrationTools.hasConfirmationGate ? 'yes' : 'no'} · raw=${demonstrationTools.noRawStored ? 'none' : 'check'}`);
  console.log('- expected tools start_ui_demonstration, capture_ui_demonstration_step, finish_ui_demonstration, plan_ui_demonstration_replay, draft_ui_demonstration_skill, save_ui_demonstration_skill');
  console.log(`- next ${compact(demonstrationTools.nextAction || dogfood.demonstrationTools?.nextAction || 'Ask live voice to record a short UI demonstration and draft a local skill.', 220)}`);
  for (const event of demonstrationEvents.slice(0, 4)) {
    const demo = event.demonstration || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      demo.action || event.name || '-',
      demo.demonstrationId ? `id=${compact(demo.demonstrationId, 10)}` : '',
      demo.stepCount ? `steps=${demo.stepCount}` : '',
      demo.skillName ? `skill=${compact(demo.skillName, 60)}` : '',
      demo.previewOnly ? 'preview-only' : '',
      demo.reobserveBeforeActing ? 'reobserve' : '',
      demo.requiresConfirmation ? 'confirmation' : '',
      demo.recordReplayInspired ? 'record-replay' : '',
    ].filter(Boolean);
    const summary = demo.output ? ` · ${compact(demo.output, 160)}` : '';
    console.log(`- ${event.name || 'ui_demonstration'} · ${bits.join(' · ')}${summary}`);
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

function printInboxTriage(result) {
  const triage = result?.triage || result || {};
  const counts = triage.counts || {};
  const groups = triage.groups || {};
  const items = Array.isArray(triage.items) ? triage.items : [];
  console.log(`Inbox triage: ${counts.open || 0} open / ${counts.total || 0} total`);
  if (triage.spokenSummary) console.log(`Spoken: ${compact(triage.spokenSummary, 420)}`);
  if (triage.confirmationPolicy?.summary) console.log(`Policy: ${compact(triage.confirmationPolicy.summary, 420)}`);
  const laneGroups = Array.isArray(groups.byLane) ? groups.byLane : [];
  const priorityGroups = Array.isArray(groups.byPriority) ? groups.byPriority : [];
  const sourceGroups = Array.isArray(groups.bySource) ? groups.bySource : [];
  if (laneGroups.length) {
    console.log('\nBy lane:');
    for (const group of laneGroups.slice(0, 6)) {
      const top = group.topItem?.title ? ` · top ${compact(group.topItem.title, 80)}` : '';
      const confirm = group.requiresConfirmation ? ` · confirm ${group.requiresConfirmation}` : '';
      console.log(`- ${group.key}: ${group.count}${confirm}${top}`);
    }
  }
  if (priorityGroups.length) {
    console.log('\nBy priority:');
    for (const group of priorityGroups.slice(0, 6)) {
      console.log(`- ${group.key}: ${group.count}`);
    }
  }
  if (sourceGroups.length) {
    console.log('\nBy source:');
    for (const group of sourceGroups.slice(0, 6)) {
      console.log(`- ${group.key}: ${group.count}`);
    }
  }
  console.log('\nItems:');
  if (!items.length) {
    console.log('- none');
    return;
  }
  for (const item of items.slice(0, 8)) {
    const policy = item.confirmationPolicy || {};
    const decision = item.decision || {};
    console.log(`- P${item.priority} ${compact(item.title, 100)} · ${item.age || '-'} · ${decision.label || decision.lane || '-'} · ${policy.label || '-'}`);
    if (policy.spokenPrompt) console.log(`  ask: ${compact(policy.spokenPrompt, 180)}`);
  }
}

async function showInboxTriage() {
  const result = await request('/api/inbox/triage');
  printInboxTriage(result);
}

function printAttentionPolicy(result) {
  const attention = result?.attention || result || {};
  console.log(`Attention: ${attention.level || 'quiet'} · pet ${attention.petState || '-'} · notify=${attention.shouldNotify ? 'yes' : 'no'}`);
  console.log(`Summary: ${compact(attention.summary || '-', 420)}`);
  console.log(`Next: ${compact(attention.nextAction || '-', 420)}`);
  if (attention.cooldown) {
    console.log(`Cooldown: ${attention.cooldown.active ? 'active' : 'ready'} · remaining ${attention.cooldown.remainingLabel || 'now'} · window ${formatInterval(attention.cooldownMs || 0)}`);
  }
  const counts = attention.counts || {};
  console.log(`Counts: reasons ${counts.reasons || 0} · high ${counts.highPriority || 0} · approvals ${counts.pendingApprovals || 0} · jobs ${counts.activeJobs || 0} · inbox ${counts.openInbox || 0}`);
  const reasons = Array.isArray(attention.reasons) ? attention.reasons : [];
  console.log('\nReasons:');
  if (!reasons.length) {
    console.log('- none');
  } else {
    for (const reason of reasons.slice(0, 8)) {
      const notify = reason.notify ? 'notify' : 'quiet';
      const count = reason.count ? ` · ${reason.count}` : '';
      console.log(`- ${reason.severity || 'info'} ${reason.label || reason.id} · ${notify}${count}: ${compact(reason.summary || '', 180)}`);
    }
  }
  const history = attention.history || {};
  const recent = Array.isArray(history.recent) ? history.recent : [];
  console.log('\nHistory:');
  console.log(`Summary: ${compact(history.summary || 'No attention notification history yet.', 220)}`);
  if (!recent.length) {
    console.log('- none');
    return;
  }
  for (const item of recent.slice(0, 8)) {
    const status = item.delivered ? 'sent' : `suppressed:${item.reason || 'policy'}`;
    const reason = item.attentionReason ? ` · ${item.attentionReason}` : '';
    console.log(`- ${formatTime(item.createdAt)} · ${status}${reason} · ${compact(item.title || '', 90)}`);
    if (item.body) console.log(`  ${compact(item.body, 160)}`);
  }
}

async function showAttentionPolicy() {
  const result = await request('/api/attention');
  printAttentionPolicy(result);
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

function printRendererDogfood(result) {
  const state = result?.rendererDogfood || result?.rendererDogfoodState || result || {};
  console.log('JAVIS Renderer Realtime Dogfood');
  console.log('===============================');
  console.log(`Run: ${state.runId || result?.runId || '-'}`);
  console.log(`Status: ${state.status || (result?.executed ? 'dispatched' : 'preview')} · renderer=${result?.rendererAvailable ?? state.rendererAvailable ? 'ready' : 'unknown'} · starts microphone=${result?.startsMicrophone || state.startsMicrophone ? 'yes' : 'no'}`);
  if (result?.output) console.log(`\n${compact(result.output, 1200)}`);
  const events = Array.isArray(state.events) ? state.events : [];
  if (events.length) {
    console.log('\nRecent events:');
    for (const event of events.slice(-8)) {
      console.log(`- ${event.createdAtIso || event.createdAt || '-'} · ${event.type || '-'} · ${event.status || '-'}${event.prompt ? ` · ${compact(event.prompt, 120)}` : ''}${event.detail ? ` · ${compact(event.detail, 160)}` : ''}`);
    }
  }
}

async function startRendererRealtimeDogfoodFromCui(rl) {
  console.log('\nPreviewing renderer Realtime dogfood trigger...');
  const preview = await request('/api/realtime/dogfood/renderer/start', {
    method: 'POST',
    body: { execute: false, source: 'cui' },
  });
  printRendererDogfood(preview);
  console.log('\nThis starts the renderer WebRTC voice session and microphone capture.');
  const answer = (await rl.question('Type START MIC to run it now, send the next dogfood prompt, and save evidence later: ')).trim();
  if (answer !== 'START MIC') {
    console.log('\nNo renderer dogfood started.');
    return;
  }
  const result = await request('/api/realtime/dogfood/renderer/start', {
    method: 'POST',
    body: {
      execute: true,
      confirmMic: true,
      prepareProgress: true,
      prepareWhenLive: true,
      durationMs: 45000,
      promptDelayMs: 35000,
      betweenPromptsMs: 9000,
      stopAfterMs: 0,
      source: 'cui',
    },
  });
  printRendererDogfood(result);
  console.log('\nOpen CUI option V to watch evidence, then option A to save the dogfood archive.');
}

function printRealtimeDogfoodPrompt(result) {
  const prompt = result?.prompt || result || {};
  console.log('JAVIS Realtime Dogfood Prompt');
  console.log('=============================');
  console.log(`Status: ${prompt.status || 'pending'} · phase ${prompt.phase || '-'}`);
  if (prompt.drillSummary) console.log(`Drill: ${compact(prompt.drillSummary, 240)}`);
  console.log(`Step: ${prompt.step?.status || 'pending'} ${prompt.step?.label || prompt.step?.id || '-'}`);
  console.log(`Type: ${prompt.promptType || 'spoken'} · manual only=${prompt.manualOnly ? 'yes' : 'no'} · starts microphone=${prompt.startsMicrophone ? 'yes' : 'no'}`);
  console.log(`Next: ${prompt.prompt || '-'}`);
  if (prompt.copyText && prompt.copyText !== prompt.prompt) {
    console.log(`Copy text: ${prompt.copyText}`);
  }
  if (Array.isArray(prompt.followUpPrompts) && prompt.followUpPrompts.length) {
    console.log(`Follow-up: ${prompt.followUpPrompts.join(' | ')}`);
  }
  if (prompt.reason) console.log(`Reason: ${compact(prompt.reason, 220)}`);
  console.log(`Monitor: ${prompt.monitor?.cui || 'npm run config -> V. Watch Realtime voice evidence'}`);
  console.log(`Endpoint: ${prompt.monitor?.endpoint || '/api/realtime/evidence'}`);
}

function printRealtimeDogfoodBrief(result) {
  const brief = result?.brief || result || {};
  const counts = brief.counts || {};
  const gap = brief.gapSummary || {};
  const step = brief.currentStep || {};
  const prompt = brief.nextPrompt || {};
  console.log('JAVIS Realtime Dogfood Brief');
  console.log('============================');
  console.log(`Status: ${brief.status || 'pending'} · phase ${brief.phase || '-'} · ready ${Number(counts.ready || 0)}/${Number(counts.steps || 0)}`);
  console.log(`Manual only=yes · starts microphone=${brief.startsMicrophone ? 'yes' : 'no'}`);
  if (gap.summary) console.log(`Gap: ${compact(gap.summary, 320)}`);
  if (gap.nextPrompt?.prompt || gap.nextPrompt?.copyText) console.log(`Gap next prompt: ${gap.nextPrompt.prompt || gap.nextPrompt.copyText}`);
  if (brief.brief) console.log(`\n${brief.brief}`);
  console.log(`\nCurrent step: ${step.status || 'pending'} ${step.label || step.id || '-'}`);
  console.log(`Next prompt: ${prompt.copyText || prompt.prompt || '-'}`);
  if (Array.isArray(prompt.followUpPrompts) && prompt.followUpPrompts.length) {
    console.log(`Follow-up: ${prompt.followUpPrompts.join(' | ')}`);
  }
  console.log('\nPrompt script:');
  const prompts = Array.isArray(brief.prompts) ? brief.prompts : [];
  if (prompts.length) {
    prompts.slice(0, 12).forEach((item, index) => console.log(`${index + 1}. ${item}`));
  } else {
    console.log('- none');
  }
  console.log('\nEvidence gates:');
  const tools = Array.isArray(brief.evidenceTools) ? brief.evidenceTools : [];
  if (tools.length) {
    for (const item of tools) {
      console.log(`- ${item.ok ? 'ready' : 'pending'} ${item.label || item.id || '-'} · ${item.tool || '-'}`);
    }
  } else {
    console.log('- none');
  }
  console.log('\nStart/monitor:');
  console.log(`- start: ${brief.start?.hotkey || 'Option+Space'} or click pet`);
  console.log(`- monitor: ${brief.monitor?.cui || 'npm run config -> V. Watch Realtime voice evidence'}`);
  console.log(`- endpoint: ${brief.monitor?.endpoint || '/api/realtime/evidence'}`);
  console.log(`- prompt helper: ${brief.monitor?.prompt || 'npm run config -- --print-realtime-dogfood-prompt'}`);
}

function printRealtimeDogfoodArchive(result) {
  const archive = result?.archive || result || {};
  const metadata = result?.metadata || {};
  const counts = archive.counts || metadata.counts || {};
  const gap = archive.gapSummary || archive.brief?.gapSummary || {};
  const prompt = archive.nextPrompt || {};
  const step = archive.currentStep || {};
  const file = archive.file || {};
  console.log('JAVIS Realtime Dogfood Archive');
  console.log('==============================');
  console.log(`Mode: ${archive.saved ? 'saved' : 'preview'} · status ${archive.status || metadata.status || 'pending'} · phase ${archive.phase || metadata.phase || '-'}`);
  console.log(`Manual only=yes · starts microphone=${archive.startsMicrophone ? 'yes' : 'no'} · raw audio stored=${archive.safety?.rawAudioStored ? 'yes' : 'no'}`);
  console.log(`Ready: ${Number(counts.ready || 0)}/${Number(counts.steps || 0)} step(s) · tools ${Number(counts.evidenceToolsReady || 0)}/${Number(counts.evidenceToolsTotal || 0)} · audit ${Number(counts.auditEvents || 0)}`);
  if (gap.summary || metadata.gapSummary) console.log(`Gap: ${compact(gap.summary || metadata.gapSummary || '', 320)}`);
  console.log(`Summary: ${compact(archive.archiveSummary || metadata.summary || archive.summary || '-', 420)}`);
  console.log(`File: ${file.path || metadata.file || '-'}`);
  console.log(`Current step: ${step.status || 'pending'} ${step.label || step.id || metadata.currentStep || '-'}`);
  console.log(`Next prompt: ${prompt.copyText || prompt.prompt || metadata.nextPrompt || '-'}`);
  if (Array.isArray(archive.prompts) && archive.prompts.length) {
    console.log(`Prompt script: ${archive.prompts.slice(0, 5).join(' | ')}`);
  }
  const recent = result?.archives?.items || [];
  if (recent.length) {
    console.log('\nRecent archives:');
    for (const item of recent.slice(0, 5)) {
      console.log(`- ${item.savedAt || item.generatedAt || '-'} · ${item.status || '-'} · ${item.filename || item.file || '-'} · ${compact(item.summary || '', 160)}`);
    }
  }
}

function printRealtimeDogfoodAcceptance(result) {
  const acceptance = result?.acceptance || result || {};
  const archive = result?.archive || {};
  const counts = acceptance.counts || {};
  console.log('JAVIS Realtime Dogfood Acceptance');
  console.log('=================================');
  console.log(`Status: ${acceptance.status || 'pending'} · accepted=${acceptance.accepted ? 'yes' : 'no'}`);
  console.log(`Manual only=yes · starts microphone=${acceptance.startsMicrophone ? 'yes' : 'no'} · requires user=${acceptance.requiresUserPresence === false ? 'no' : 'yes'}`);
  console.log(`Gates: ${Number(counts.passed || 0)}/${Number(counts.gates || 0)} pass · gaps ${Number(counts.gaps || 0)} · groups ${Number(counts.groups || 0)}`);
  console.log(`Summary: ${compact(acceptance.summary || '-', 420)}`);
  if (acceptance.nextGap) {
    console.log(`Next gap: ${acceptance.nextGap.group || '-'} / ${acceptance.nextGap.id || '-'} · ${compact(acceptance.nextGap.label || '', 220)}`);
    if (acceptance.nextGap.nextAction) console.log(`Next action: ${compact(acceptance.nextGap.nextAction, 260)}`);
  }
  console.log(`Archive required: ${acceptance.archive?.saved ? 'saved' : 'not saved'} · ${acceptance.archive?.file || archive.file?.path || '-'}`);
  console.log(`Safety: raw audio stored=${acceptance.safety?.rawAudioStored ? 'yes' : 'no'} · screen image included=${acceptance.safety?.screenImageIncluded ? 'yes' : 'no'} · policy bypass=${acceptance.safety?.actionPolicyBypassed ? 'yes' : 'no'}`);
  const groups = Array.isArray(acceptance.groups) ? acceptance.groups : [];
  if (groups.length) {
    console.log('\nGroups:');
    for (const group of groups) {
      console.log(`- ${group.ok ? 'pass' : 'gap'} ${group.id}: ${group.ready}/${group.total}${group.gaps?.length ? ` · missing ${group.gaps.join(', ')}` : ''}`);
    }
  }
  const gaps = Array.isArray(acceptance.gaps) ? acceptance.gaps : [];
  if (gaps.length) {
    console.log('\nMissing gates:');
    for (const gate of gaps.slice(0, 10)) {
      console.log(`- ${gate.group}/${gate.id}: ${compact(gate.label || '', 180)}`);
    }
  }
}

async function showRealtimeDogfoodPrompt(options = {}) {
  if (options.copy) {
    const result = await request('/api/realtime/dogfood/prompt/copy', {
      method: 'POST',
      body: { source: 'cui', dryRun: options.dryRun === true },
    });
    printRealtimeDogfoodPrompt(result);
    console.log(`\n${result.copied ? 'Copied' : result.wouldCopy ? 'Would copy' : 'Copy ready'}: ${compact(result.text || result.prompt?.copyText || '', 260)}`);
    return;
  }
  const result = await request('/api/realtime/dogfood/prompt');
  printRealtimeDogfoodPrompt(result);
}

async function showRealtimeDogfoodBrief() {
  const result = await request('/api/realtime/dogfood/brief');
  printRealtimeDogfoodBrief(result);
}

async function showRealtimeDogfoodArchive(options = {}) {
  const result = await request('/api/realtime/dogfood/archive', {
    method: options.save ? 'POST' : 'GET',
    body: options.save ? { source: 'cui' } : undefined,
  });
  printRealtimeDogfoodArchive(result);
}

async function showRealtimeDogfoodAcceptance() {
  const result = await request('/api/realtime/dogfood/acceptance');
  printRealtimeDogfoodAcceptance(result);
}

function printRealtimeDogfoodSession(result) {
  const sessions = result?.sessions || result || {};
  const active = sessions.active || null;
  const items = Array.isArray(sessions.items) ? sessions.items : [];
  const counts = sessions.counts || {};
  const autoSync = sessions.autoSync || active?.autoSync || {};
  console.log('JAVIS Realtime Dogfood Session');
  console.log('==============================');
  console.log(`Sessions: ${counts.active || 0} active · ${counts.done || 0} done · ${counts.cancelled || 0} cancelled · ${counts.total || 0} total`);
  console.log(`Manual only=yes · starts microphone=${sessions.startsMicrophone ? 'yes' : 'no'}`);
  console.log(`Evidence: ${sessions.evidence?.status || '-'} · phase ${sessions.evidence?.phase || '-'}`);
  console.log(`Evidence sync: auto=${autoSync.enabled === false ? 'no' : 'yes'} · changed=${Number(autoSync.changed || 0)} session(s) · synced=${Number(autoSync.syncedSteps || 0)} step(s) · currentReady=${Number(autoSync.currentEvidenceReady || 0)}`);
  if (sessions.prompt?.copyText) console.log(`Next prompt: ${sessions.prompt.copyText}`);
  console.log(`Monitor: ${sessions.active?.monitor?.cui || 'npm run config -> V. Watch Realtime voice evidence'}`);
  if (!active) {
    console.log('\nActive session: none');
  } else {
    console.log(`\nActive session: ${active.title} · ${active.status} · ${formatTime(active.createdAt)}`);
    console.log(`Progress: ${active.counts?.evidenceReady || 0}/${active.counts?.total || 0} evidence ready · ${active.counts?.currentEvidenceReady || 0}/${active.counts?.total || 0} currently ready · ${active.counts?.operatorDone || 0}/${active.counts?.total || 0} operator done`);
    console.log(`Auto-sync: sticky=${active.autoSync?.stickyEvidence ? 'yes' : 'no'} · last=${active.autoSync?.lastSyncedAt ? formatTime(active.autoSync.lastSyncedAt) : '-'} · count=${active.autoSync?.syncCount || 0}`);
    if (active.nextStep) console.log(`Next evidence step: ${active.nextStep.label}`);
    const steps = Array.isArray(active.steps) ? active.steps : [];
    for (const step of steps.slice(0, 12)) {
      const mark = step.operatorDone ? 'done' : step.evidenceOk ? 'ready' : step.status || 'pending';
      const sticky = step.evidenceOk && !step.currentEvidenceOk ? ' · sticky' : '';
      console.log(`- ${mark} ${step.label || step.id}${sticky}`);
    }
  }
  const recent = items.filter((item) => !active || item.id !== active.id).slice(0, 3);
  if (recent.length) {
    console.log('\nRecent sessions:');
    for (const item of recent) {
      console.log(`- ${item.status} ${item.title || item.id} · ${item.counts?.evidenceReady || 0}/${item.counts?.total || 0} evidence · ${formatTime(item.updatedAt)}`);
    }
  }
}

async function showRealtimeDogfoodSession(options = {}) {
  if (options.start) {
    const result = await request('/api/realtime/dogfood/session/start', {
      method: 'POST',
      body: { source: 'cui', allowConcurrent: options.allowConcurrent === true },
    });
    printRealtimeDogfoodSession(result.sessions || {});
    if (result.output) console.log(`\n${compact(result.output, 900)}`);
    return result;
  }
  const result = await request('/api/realtime/dogfood/session');
  printRealtimeDogfoodSession(result.sessions || {});
  return result;
}

async function manageRealtimeDogfoodSession(rl) {
  const result = await showRealtimeDogfoodSession();
  const active = result.sessions?.active || null;
  if (active) {
    const answer = (await rl.question('\nType DONE to finish, CANCEL to cancel, or press Enter to return: ')).trim();
    if (answer === 'DONE' || answer === 'CANCEL') {
      const finished = await request(`/api/realtime/dogfood/session/${encodeURIComponent(active.id)}/end`, {
        method: 'POST',
        body: { source: 'cui', status: answer === 'CANCEL' ? 'cancelled' : 'done' },
      });
      console.log('');
      printRealtimeDogfoodSession(finished.sessions || {});
    }
    return;
  }
  const answer = (await rl.question('\nType START to start a Realtime dogfood tracker, or press Enter to return: ')).trim();
  if (answer === 'START') await showRealtimeDogfoodSession({ start: true });
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

  if (process.argv.includes('--print-realtime-dogfood-prompt') || process.argv.includes('--realtime-dogfood-prompt')) {
    await showRealtimeDogfoodPrompt();
    return;
  }

  if (process.argv.includes('--print-realtime-dogfood-brief') || process.argv.includes('--realtime-dogfood-brief')) {
    await showRealtimeDogfoodBrief();
    return;
  }

  if (process.argv.includes('--print-realtime-dogfood-acceptance') || process.argv.includes('--realtime-dogfood-acceptance')) {
    await showRealtimeDogfoodAcceptance();
    return;
  }

  if (process.argv.includes('--print-realtime-dogfood-archive') || process.argv.includes('--realtime-dogfood-archive')) {
    await showRealtimeDogfoodArchive();
    return;
  }

  if (process.argv.includes('--save-realtime-dogfood-archive')) {
    await showRealtimeDogfoodArchive({ save: true });
    return;
  }

  if (process.argv.includes('--print-renderer-realtime-dogfood') || process.argv.includes('--renderer-realtime-dogfood')) {
    const result = await request('/api/realtime/dogfood/renderer');
    printRendererDogfood(result);
    return;
  }

  if (process.argv.includes('--start-renderer-realtime-dogfood')) {
    const confirmMic = process.argv.includes('--confirm-mic');
    const result = await request('/api/realtime/dogfood/renderer/start', {
      method: 'POST',
      body: {
        execute: true,
        confirmMic,
        prepareProgress: true,
        prepareWhenLive: true,
        durationMs: 45000,
        promptDelayMs: 35000,
        betweenPromptsMs: 9000,
        source: 'cui_cli',
      },
    });
    printRendererDogfood(result);
    return;
  }

  if (process.argv.includes('--copy-realtime-dogfood-prompt')) {
    await showRealtimeDogfoodPrompt({ copy: true });
    return;
  }

  if (process.argv.includes('--print-realtime-dogfood-session') || process.argv.includes('--realtime-dogfood-session')) {
    await showRealtimeDogfoodSession();
    return;
  }

  if (process.argv.includes('--start-realtime-dogfood-session')) {
    await showRealtimeDogfoodSession({ start: true, allowConcurrent: true });
    return;
  }

  if (process.argv.includes('--print-work-handoff') || process.argv.includes('--work-handoff')) {
    const result = await request('/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900');
    printWorkHandoff(result);
    return;
  }

  if (process.argv.includes('--print-capabilities') || process.argv.includes('--capabilities')) {
    const queryIndex = process.argv.findIndex((item) => item === '--query');
    const laneIndex = process.argv.findIndex((item) => item === '--lane');
    await showLocalCapabilities({
      query: queryIndex >= 0 ? process.argv[queryIndex + 1] : '',
      lane: laneIndex >= 0 ? process.argv[laneIndex + 1] : '',
      includeNext: process.argv.includes('--include-next'),
    });
    return;
  }

  if (process.argv.includes('--print-work-next') || process.argv.includes('--work-next')) {
    await showWorkbenchNext();
    return;
  }

  if (process.argv.includes('--print-browser-activity') || process.argv.includes('--browser-activity')) {
    await showBrowserActivity();
    return;
  }

  if (process.argv.includes('--print-browser-benchmarks') || process.argv.includes('--browser-benchmarks')) {
    await showBrowserBenchmarks();
    return;
  }

  if (process.argv.includes('--print-file-benchmarks') || process.argv.includes('--file-benchmarks')) {
    await showFileBenchmarks();
    return;
  }

  if (process.argv.includes('--print-knowledge-benchmarks') || process.argv.includes('--knowledge-benchmarks')) {
    await showKnowledgeBenchmarks();
    return;
  }

  if (process.argv.includes('--print-creative-benchmarks') || process.argv.includes('--creative-benchmarks')) {
    await showCreativeBenchmarks();
    return;
  }

  if (process.argv.includes('--print-app-benchmarks') || process.argv.includes('--app-benchmarks')) {
    await showAppBenchmarks();
    return;
  }

  if (process.argv.includes('--print-productivity-benchmarks') || process.argv.includes('--productivity-benchmarks')) {
    await showProductivityBenchmarks();
    return;
  }

  if (process.argv.includes('--print-perception') || process.argv.includes('--perception')) {
    await showPerceptionConsent();
    return;
  }

  if (process.argv.includes('--print-screen-privacy') || process.argv.includes('--screen-privacy')) {
    await showScreenPrivacy();
    return;
  }

  if (process.argv.includes('--print-inbox-triage') || process.argv.includes('--inbox-triage')) {
    await showInboxTriage();
    return;
  }

  if (process.argv.includes('--print-attention') || process.argv.includes('--attention')) {
    await showAttentionPolicy();
    return;
  }

  if (process.argv.includes('--print-autopilot') || process.argv.includes('--autopilot')) {
    await showAutopilotStatus();
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
      } else if (answer === 'r' || answer === 'renderer dogfood' || answer === 'realtime renderer') {
        await startRendererRealtimeDogfoodFromCui(rl);
      } else if (answer === 'b' || answer === 'brief' || answer === 'dogfood brief') {
        await showRealtimeDogfoodBrief();
      } else if (answer === 'e' || answer === 'acceptance' || answer === 'dogfood acceptance') {
        await showRealtimeDogfoodAcceptance();
      } else if (answer === 'a' || answer === 'archive' || answer === 'dogfood archive') {
        await showRealtimeDogfoodArchive({ save: true });
      } else if (answer === 'p' || answer === 'prompt' || answer === 'dogfood prompt') {
        await showRealtimeDogfoodPrompt({ copy: true });
      } else if (answer === 't' || answer === 'track' || answer === 'dogfood session') {
        await manageRealtimeDogfoodSession(rl);
      } else if (answer === 'h' || answer === 'handoff' || answer === 'work handoff') {
        await showWorkHandoff();
      } else if (answer === 'l' || answer === 'capabilities' || answer === 'capability map') {
        await showLocalCapabilities({ includeNext: true });
      } else if (answer === 'g' || answer === 'browser benchmark' || answer === 'browser benchmarks') {
        await showBrowserBenchmarks();
      } else if (answer === 'f' || answer === 'file benchmark' || answer === 'file benchmarks') {
        await showFileBenchmarks();
      } else if (answer === 'k' || answer === 'knowledge benchmark' || answer === 'knowledge benchmarks') {
        await showKnowledgeBenchmarks();
      } else if (answer === 'c' || answer === 'creative benchmark' || answer === 'creative benchmarks') {
        await showCreativeBenchmarks();
      } else if (answer === 'u' || answer === 'app benchmark' || answer === 'app benchmarks') {
        await showAppBenchmarks();
      } else if (answer === 'y' || answer === 'productivity benchmark' || answer === 'productivity benchmarks') {
        await showProductivityBenchmarks();
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
      } else if (answer === '30') {
        await showBrowserActivity();
      } else if (answer === '31') {
        await showAttentionPolicy();
      } else if (answer === '32') {
        await showPerceptionConsent();
      } else if (answer === '33') {
        await showScreenPrivacy();
      } else if (answer === '34' || answer === 'q' || answer === 'quit' || answer === 'exit') {
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
