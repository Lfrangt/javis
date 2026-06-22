#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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

function argvValue(name, fallback = '') {
  const index = process.argv.findIndex((item) => item === name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return fallback;
  return value;
}

function positionalText() {
  const valueFlags = new Set([
    '--action-id',
    '--agent',
    '--arguments',
    '--id',
    '--instruction',
    '--job-limit',
    '--lane',
    '--limit',
    '--max-steps',
    '--message',
    '--query',
    '--route-id',
    '--server',
    '--source',
    '--task',
    '--tool',
    '--voice-limit',
    '--workflow-limit',
  ]);
  const parts = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item) continue;
    if (item.startsWith('--')) {
      if (valueFlags.has(item) && args[index + 1] && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    parts.push(item);
  }
  return parts.join(' ').trim();
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
    const next = voiceHealth?.kind === 'quota_or_rate_limit' && voiceHealth.next
      ? ` · ${compact(voiceHealth.next, 130)}`
      : '';
    return `${doctorVoice.status} · ${compact(doctorVoice.summary, 130)}${next}`;
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

function commandName(commandLine) {
  const text = String(commandLine || '').trim();
  if (!text || text === '*') return text;
  return text.split(/\s+/)[0].replace(/^["']|["']$/g, '');
}

function commandPath(commandLine) {
  const name = commandName(commandLine);
  if (!name || name === '*') return '';
  try {
    return execFileSync('/usr/bin/which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function firstConfigItem(...sources) {
  const ids = sources.filter(Boolean);
  return (items) => ids.map((id) => items.find((item) => item.id === id)).find(Boolean) || null;
}

function statusGlyph(status) {
  if (status === 'ready') return 'ready';
  if (status === 'blocked') return 'blocked';
  if (status === 'warning' || status === 'limited') return 'check';
  if (status === 'manual') return 'manual';
  return status || 'unknown';
}

function printPermissionRows(title, rows) {
  console.log(`\n${title}:`);
  for (const row of rows) {
    const detail = row.detail ? ` · ${compact(row.detail, 180)}` : '';
    console.log(`- ${statusGlyph(row.status)} ${row.label}${detail}`);
    if (row.next) console.log(`  next=${compact(row.next, 180)}`);
  }
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
    const [status, doctor, autopilotResult, browserReady, shortcutsResult, perceptionResult, collaborationHandoffResult, keepAwakeResult] = await Promise.all([
      request('/api/status'),
      request('/api/doctor/report'),
      request('/api/autopilot').catch(() => ({ autopilot: null })),
      request('/api/browser/readiness').catch((error) => ({ readiness: { status: 'warning', summary: error instanceof Error ? error.message : String(error) } })),
      request('/api/shortcuts?limit=5').catch(() => ({ shortcuts: null })),
      request('/api/perception/consent?limit=3').catch(() => ({ perception: null })),
      request('/api/collaboration/handoff?limit=5').catch(() => ({ handoff: null })),
      request('/api/keep-awake/status').catch(() => ({ keepAwake: null })),
    ]);
    const window = status.window || {};
    console.log(`API: ${status.api?.baseUrl || API_BASE}`);
    console.log(`OpenAI key: ${status.api?.hasOpenAiKey ? 'present' : 'missing'}`);
    if (status.voiceHealth?.kind === 'quota_or_rate_limit') {
      console.log(`OpenAI provider: quota/rate-limit · ${compact(status.voiceHealth.next || status.voiceHealth.summary || '', 180)}`);
    }
    if (status.voiceHealth?.recovery?.active) {
      const recovery = status.voiceHealth.recovery;
      const firstStep = Array.isArray(recovery.steps) ? recovery.steps[0] : null;
      console.log(`Realtime recovery: ${compact(recovery.summary || '', 120)}${firstStep?.label ? ` · next ${firstStep.label}` : ''}`);
    }
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
    if (keepAwakeResult.keepAwake) {
      const keepAwake = keepAwakeResult.keepAwake;
      const power = keepAwake.power?.source ? ` · ${keepAwake.power.source}` : '';
      const managed = keepAwake.running ? `managed pid ${keepAwake.pid || '-'}` : keepAwake.active ? 'external assertion' : 'off';
      console.log(`Keep-awake: ${managed}${power} · screen ${keepAwake.plan?.screenMaySleep ? 'may sleep' : 'held awake'}`);
    }
    if (status.conversation) {
      const conversation = status.conversation;
      const voiceHealth = summarizeVoiceHealth(status.voiceHealth, conversation, doctor.doctor);
      console.log(`Voice: ${conversation.status || 'idle'} · mic ${conversation.micMode || 'open'} · screen ${conversation.screenLive ? 'on' : 'off'}${conversation.stale ? ' · stale' : ''}${voiceHealth ? ` · ${voiceHealth}` : ''}`);
    }
    if (status.voiceStandby) {
      const standby = status.voiceStandby;
      console.log(`Voice standby: ${standby.mode || '-'} · ${standby.primaryAction?.label || standby.label || '-'} · mic ${standby.primaryAction?.startsMicrophone ? 'yes' : 'no'}`);
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
    if (collaborationHandoffResult.handoff) {
      const handoff = collaborationHandoffResult.handoff;
      const counts = handoff.counts || {};
      const next = handoff.nextActions?.[0]?.label ? ` · next ${handoff.nextActions[0].label}` : '';
      console.log(`Collab: ${handoff.mode || 'unknown'} · ${counts.active || 0} active · ${counts.conflicts || 0} conflict pair(s)${next}`);
    } else if (status.collaboration) {
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
    if (browserReady.readiness) {
      const readiness = browserReady.readiness;
      const context = readiness.context || {};
      const dom = readiness.capabilities?.dom || {};
      const bridge = readiness.bridges?.cdp?.enabled ? 'cdp ready' : readiness.bridges?.javascript?.status || 'bridge unknown';
      const target = [context.app, context.title || context.url].filter(Boolean).join(' · ') || readiness.defaultTarget?.selector || '-';
      console.log(`Browser: ${readiness.status || '-'} · ${compact(target, 90)} · DOM ${dom.status || '-'} · ${bridge}`);
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
  console.log('1. Set / replace OpenAI API key');
  console.log('1B. Show OpenAI API billing/quota recovery');
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
  console.log('RB. Show resident recovery bundle');
  console.log('KA. Show keep-awake status');
  console.log('KS. Start keep-awake');
  console.log('KX. Stop keep-awake');
  console.log('V. Watch Realtime voice evidence');
  console.log('D. Start Realtime dogfood drill');
  console.log('R. Run renderer Realtime dogfood (starts mic)');
  console.log('RP. Probe Realtime provider (no mic)');
  console.log('O. Show Realtime live drill pack');
  console.log('B. Show Realtime dogfood brief');
  console.log('E. Show Realtime dogfood acceptance');
  console.log('A. Save Realtime dogfood archive');
  console.log('Y. Prepare Realtime dogfood preflight bundle');
  console.log('P. Copy next Realtime dogfood prompt');
  console.log('T. Track Realtime dogfood session');
  console.log('H. Show spoken work handoff');
  console.log('VH. Show local voice command history');
  console.log('VS. Show voice standby/fallback status');
  console.log('VC. Start local voice command loop (no mic)');
  console.log('AG. Preview bounded autonomy loop');
  console.log('AR. Run bounded autonomy loop');
  console.log('WH. Show wake handoff');
  console.log('L. Show local capability map');
  console.log('I. Show permission matrix');
  console.log('CR. Show local control readiness');
  console.log('S. Show routing speed policy');
  console.log('BR. Show browser readiness');
  console.log('G. Show browser workflow benchmarks');
  console.log('F. Show file workflow benchmarks');
  console.log('K. Show knowledge workflow benchmarks');
  console.log('X. Show MCP server discovery');
  console.log('W. Preview MCP workflow plan');
  console.log('Z. Preview MCP tool call');
  console.log('C. Show creative workflow benchmarks');
  console.log('U. Show app workflow benchmarks');
  console.log('Y. Show productivity workflow benchmarks');
  console.log('14. Show next work item');
  console.log('15. Run next work item');
  console.log('16. Show autopilot status');
  console.log('17. Run one autopilot tick');
  console.log('18. Toggle overnight autopilot');
  console.log('J. Show learning distillation');
  console.log('RR. Show Record & Replay teaching packet');
  console.log('RT. Save Record & Replay teaching packet');
  console.log('19. Refresh learning profile');
  console.log('20. Save learning as memory');
  console.log('21. Pause/resume learning');
  console.log('22. Manage learning exclusions');
  console.log('23. Delete inferred learning data');
  console.log('24. Show learning evolution');
  console.log('25. Preview learning skill draft');
  console.log('26. Export learning skill');
  console.log('27. Show collaboration handoff');
  console.log('CS. Show collaboration scope suggestions');
  console.log('28. Show UI demonstrations');
  console.log('29. Show skill shortcuts');
  console.log('30. Promote shortcut candidate');
  console.log('31. Show browser activity');
  console.log('32. Show attention policy');
  console.log('33. Show perception consent');
  console.log('34. Show screen privacy');
  console.log('35. Apply recommended screen privacy');
  console.log('36. Add screen region mask');
  console.log('37. Quit');
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
    const waits = waitingFor.slice(0, 6).map((item, index) => {
      const wait = item.waitLabel ? ` · ${item.waitLabel}` : '';
      return `${index + 1}. ${item.label || item.id} · ${item.status || 'waiting'}${wait}: ${compact(item.summary || '', 140)}`;
    });
    const more = waitingFor.length > waits.length ? ` | +${waitingFor.length - waits.length} more` : '';
    console.log(`Waiting for: ${waits.join(' | ')}${more}`);
  } else {
    console.log(`Waiting for: none${decision.outcome === 'ready' ? ' · ready' : ''}`);
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
  if (action.source === 'sessions' && action.sessionContinuation?.routeId) {
    console.log(`Session route: ${action.sessionContinuation.routeId} · ${action.sessionContinuation.label || action.sessionContinuation.recoveryType || 'continue'}`);
    if (action.sessionContinuation.summary) console.log(`Session plan: ${compact(action.sessionContinuation.summary, 260)}`);
    if (action.sessionContinuation.executable) console.log(`Run: POST /api/work/next {"actionId":"${action.id}","execute":true}`);
  }
  const fallback = action.localFallback || action.fallback || action.voiceHealth?.fallback || {};
  if (fallback.available) {
    console.log(`Guide: Use local fallback while this work-next item is blocked.`);
    console.log(`Local fallback: ${fallback.endpoint || '/api/voice/command'} (${fallback.lane || 'local_voice_command'})`);
    if (fallback.dogfoodCommand) console.log(`Fallback command: ${fallback.dogfoodCommand}`);
    if (fallback.summary) console.log(`Fallback summary: ${compact(fallback.summary, 260)}`);
    if (fallback.blocker?.active) {
      console.log(`Fallback blocker: ${fallback.blocker.kind || fallback.blocker.status || 'provider'} · ${compact(fallback.blocker.summary || fallback.blocker.next || '', 260)}`);
    }
    if (fallback.safety) {
      console.log(`Fallback safety: starts microphone=${fallback.safety.startsMicrophone ? 'yes' : 'no'}; realtime=${fallback.safety.usesRealtime ? 'yes' : 'no'}; raw audio=${fallback.safety.storesRawAudio ? 'yes' : 'no'}`);
    }
  }
  if (printBrowserRecoveryGuide(action)) return true;
  if (printRouteRecoveryGuide(action)) return true;
  const guide = action.dogfoodGuide || action.guide || {};
  return printDogfoodGuide(guide);
}

function printBrowserRecoveryGuide(action = {}) {
  if (action.source !== 'browser_recovery' || !action.browserRecovery) return false;
  const recovery = action.browserRecovery || {};
  const appName = recovery.app || action.macAction?.value || 'supported browser';
  console.log(`Guide: Open or focus ${appName} before retrying browser work.`);
  if (recovery.type) console.log(`Browser recovery: ${recovery.type}`);
  if (recovery.firstTaskTitle) console.log(`Blocked task: ${compact(recovery.firstTaskTitle, 180)}`);
  if (action.macAction?.action) console.log(`Local action: ${action.macAction.action} ${compact(action.macAction.value || appName, 140)}`);
  if (recovery.retryActionId) console.log(`Retry action: ${recovery.retryActionId}`);
  if (recovery.readinessEndpoint) console.log(`Recheck: ${recovery.readinessEndpoint}`);
  console.log(`Preview: GET /api/work/next?actionId=${encodeURIComponent(action.id || 'browser_recovery:open_supported_browser')}`);
  console.log(`Run: POST /api/work/next {"actionId":"${action.id || 'browser_recovery:open_supported_browser'}","execute":true}`);
  return true;
}

function printRouteRecoveryGuide(action = {}) {
  if (action.source !== 'routing' || !action.routeRecovery) return false;
  const recovery = action.routeRecovery || {};
  const recommended = recovery.recommended || {};
  const routeId = action.routeId || recommended.routeId || '';
  console.log(`Guide: Continue routed work via ${recommended.label || 'route recovery'}.`);
  if (routeId) console.log(`Route: ${routeId}`);
  if (recommended.type) console.log(`Recovery: ${recommended.type}${recommended.executable ? ' (executable)' : ' (inspect only)'}`);
  if (recommended.summary) console.log(`Plan: ${compact(recommended.summary, 260)}`);
  if (recommended.reason) console.log(`Reason: ${compact(recommended.reason, 260)}`);
  if (recommended.executable && routeId) {
    console.log(`Run: POST /api/work/next {"actionId":"route:${routeId}","execute":true}`);
  } else if (recommended.endpoint?.path) {
    console.log(`Inspect: ${recommended.endpoint.method || 'GET'} ${recommended.endpoint.path}`);
  }
  return true;
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
  const action = preview?.next?.action || preview?.action || null;
  const realtimeGuide = preview?.next?.briefing?.realtimeVoice?.dogfoodGuide || preview?.briefing?.realtimeVoice?.dogfoodGuide || {};
  if (!printedGuide && (!action || action.source === 'realtime_voice')) printDogfoodGuide(realtimeGuide);
  if (preview.next?.output) console.log(compact(preview.next.output, 700));
}

function workNextActionIdFromArgv() {
  const explicit = argvValue('--action-id') || argvValue('--id');
  if (explicit) return explicit;
  const routeId = argvValue('--route-id');
  return routeId ? `route:${routeId.replace(/^route:/, '')}` : '';
}

function wantsLastVoiceRoute() {
  return process.argv.includes('--last-voice-route') || process.argv.includes('--last-voice');
}

async function latestExecutableVoiceRoute() {
  const limit = Math.max(1, Math.min(50, Number(argvValue('--voice-limit', '20') || 20)));
  const result = await request(`/api/voice/history?limit=${encodeURIComponent(limit)}`);
  const history = result.history || {};
  const items = Array.isArray(history.items) ? history.items : [];
  for (const item of items) {
    if (!item?.routeId || item.executed || item.queued) continue;
    const actionId = `route:${item.routeId}`;
    const preview = await request(`/api/work/next?actionId=${encodeURIComponent(actionId)}`).catch(() => null);
    const next = preview?.next || {};
    const recommended = next.result?.routeRecovery?.recommended || next.action?.routeRecovery?.recommended || {};
    if (next.ok === true && next.action?.source === 'routing' && recommended.executable === true) {
      return {
        actionId,
        item,
        recommended,
      };
    }
  }
  throw new Error(`No executable preview voice route found in the last ${limit} local voice history item(s).`);
}

async function resolveWorkNextAction(options = {}) {
  const explicit = options.actionId || workNextActionIdFromArgv();
  if (explicit) return { actionId: explicit, source: 'explicit' };
  if (!wantsLastVoiceRoute()) return { actionId: '', source: 'default' };
  const latest = await latestExecutableVoiceRoute();
  return {
    actionId: latest.actionId,
    source: 'last_voice_route',
    lastVoiceRoute: latest,
  };
}

async function runWorkbenchNextDirect(options = {}) {
  const resolved = await resolveWorkNextAction(options);
  const actionId = resolved.actionId;
  const workflowLimit = Number(argvValue('--workflow-limit', '6') || 6);
  const jobLimit = Number(argvValue('--job-limit', '6') || 6);
  const result = await request('/api/work/next', {
    method: 'POST',
    body: {
      source: options.source || argvValue('--source', 'cui_cli'),
      execute: true,
      workflowLimit,
      jobLimit,
      ...(actionId ? { actionId } : {}),
    },
  });
  const next = result.next || {};
  console.log('');
  printNextAction(result);
  if (resolved.source === 'last_voice_route' && resolved.lastVoiceRoute?.item) {
    const item = resolved.lastVoiceRoute.item;
    console.log(`Last voice route: ${item.routeId} · ${compact(item.transcriptPreview || '', 180)}`);
  }
  if (actionId) console.log(`Action: ${actionId}`);
  console.log(`Work item ${next.executed ? 'executed' : 'reviewed'}.`);
  if (next.output) console.log(compact(next.output, 1200));
  if (next.ok === false) {
    throw new Error(next.output || `Work-next action failed${actionId ? `: ${actionId}` : ''}.`);
  }
  return result;
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

function autonomyTaskFromArgv(fallback = '') {
  return argvValue('--task') || argvValue('--message') || argvValue('--instruction') || positionalText() || fallback;
}

function autonomyOptionsFromArgv(options = {}) {
  return {
    execute: Boolean(options.execute || process.argv.includes('--run') || process.argv.includes('--execute')),
    retry: Boolean(options.retry || process.argv.includes('--retry') || process.argv.includes('--auto-recover')),
    observe: !process.argv.includes('--no-observe'),
    includeAccessibility: process.argv.includes('--include-ui') || process.argv.includes('--include-accessibility'),
    captureScreen: process.argv.includes('--capture-screen') || process.argv.includes('--screen'),
    useMemory: process.argv.includes('--use-memory'),
    maxSteps: Number(argvValue('--max-steps', '8') || 8),
    source: options.source || argvValue('--source', 'cui_cli_autonomy'),
  };
}

function printAutonomyResult(result) {
  const autonomy = result?.autonomy || result || {};
  const route = autonomy.route || {};
  const agency = autonomy.agencyPlan || {};
  const primary = agency.primary || agency.nextActions?.[0] || null;
  const steps = Array.isArray(autonomy.steps) ? autonomy.steps : [];
  console.log('\nJAVIS Bounded Autonomy');
  console.log('======================');
  console.log(`Mode: ${autonomy.executeRequested ? 'execute' : 'preview'} · status=${autonomy.status || '-'} · queued=${autonomy.queued ? 'yes' : 'no'}`);
  console.log(`Task: ${compact(autonomy.task || '-', 260)}`);
  console.log(`Route: ${route.label || route.lane || '-'} · ${route.contextPlan?.mode || '-'} · ${compact(route.reason || route.output || '-', 220)}`);
  if (route.contextPlan?.recommendedTools?.length) {
    console.log(`Tools: ${route.contextPlan.recommendedTools.slice(0, 6).join(', ')}`);
  }
  console.log(`Agency: ${agency.status || '-'} · ${compact(agency.spokenSummary || autonomy.nextAction || '-', 360)}`);
  if (primary) {
    console.log(`Primary: ${primary.label || primary.id || '-'} · source=${primary.source || '-'} · executable=${primary.executable ? 'yes' : 'no'} · user=${primary.requiresUser ? 'yes' : 'no'}`);
    if (primary.summary) console.log(`Primary summary: ${compact(primary.summary, 360)}`);
  }
  if (steps.length) {
    console.log('\nSteps:');
    for (const step of steps.slice(0, 8)) {
      console.log(`- ${step.ok ? 'ok' : 'check'} ${step.label || step.id}: ${compact(step.detail || step.nextAction || '', 220)}`);
    }
  }
  if (autonomy.execution) {
    console.log(`\nExecution: ${autonomy.execution.queued ? 'queued' : autonomy.execution.executed ? 'done' : 'reviewed'} · ${compact(autonomy.execution.output || '', 360)}`);
  }
  if (autonomy.recovery?.candidate?.action) {
    const candidate = autonomy.recovery.candidate;
    console.log(`Recovery candidate: ${candidate.action.label || candidate.action.id} · job ${candidate.jobId || '-'}`);
  }
  console.log(`\nSafety: bounded=${autonomy.safety?.bounded ? 'yes' : 'unknown'} · direct shell=${autonomy.safety?.noDirectShell ? 'no' : 'unknown'} · direct UI=${autonomy.safety?.noDirectUi ? 'no' : 'unknown'} · policy=${autonomy.safety?.usesExistingActionPolicy ? 'preserved' : 'unknown'}`);
  console.log(`Learning: ${autonomy.safety?.learningContext?.usedInPrompt ? 'attached' : 'not attached'} · no permission grant=${autonomy.safety?.learningContext?.noPermissionGrant ? 'yes' : 'unknown'}`);
  if (!autonomy.executeRequested) {
    console.log('\nRun explicitly: npm run autonomy:run -- --task "<task>"');
  }
  return autonomy;
}

async function showAutonomyLoop(options = {}) {
  const task = String(options.task || autonomyTaskFromArgv('检查当前 JAVIS 状态，提出下一步怎么继续，先不要执行。')).trim();
  const argvOptions = autonomyOptionsFromArgv(options);
  const result = await request('/api/autonomy/run', {
    method: 'POST',
    body: {
      task,
      execute: argvOptions.execute,
      retry: argvOptions.retry,
      observe: argvOptions.observe,
      includeAccessibility: argvOptions.includeAccessibility,
      captureScreen: argvOptions.captureScreen,
      useMemory: argvOptions.useMemory,
      maxSteps: argvOptions.maxSteps,
      source: argvOptions.source,
    },
  });
  return printAutonomyResult(result);
}

async function runAutonomyLoopFromCui(rl) {
  const task = (await rl.question('\nTask for bounded autonomy loop: ')).trim();
  if (!task) {
    console.log('\nNo task entered.');
    return;
  }
  console.log('\nPreviewing bounded autonomy loop...');
  await showAutonomyLoop({ task, source: 'cui_autonomy_preview', execute: false });
  const answer = (await rl.question('\nRun one bounded autonomy step through normal policy gates? Type RUN to execute: ')).trim();
  if (answer !== 'RUN') {
    console.log('\nNo action executed.');
    return;
  }
  await showAutonomyLoop({ task, source: 'cui_autonomy_execute', execute: true, retry: true });
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

async function showVoiceHistory() {
  const limitIndex = process.argv.findIndex((item) => item === '--limit');
  const limit = limitIndex >= 0 && process.argv[limitIndex + 1] ? process.argv[limitIndex + 1] : '10';
  const result = await request(`/api/voice/history?limit=${encodeURIComponent(limit)}`);
  const history = result.history || {};
  const items = Array.isArray(history.items) ? history.items : [];
  const latency = history.latency || {};
  console.log('\nLocal Voice Command History');
  console.log('===========================');
  console.log(`Items: ${items.length}/${history.limit || limit} · privacy: transcript-preview-only, no audio/screenshots/clipboard/full-AX`);
  if (latency.count) {
    console.log(`Latency: latest ${latency.latestMs || 0}ms · avg ${latency.avgMs || 0}ms · p90 ${latency.p90Ms || 0}ms · max ${latency.maxMs || 0}ms · slow ${latency.slowCount || 0}/${latency.count} over ${latency.slowThresholdMs || 5000}ms`);
  }
  if (!items.length) {
    console.log('No local voice-command history yet.');
    return;
  }
  for (const [index, item] of items.entries()) {
    const state = item.queued ? 'queued' : item.executed ? 'executed' : 'preview';
    const ids = [item.jobId ? `job ${item.jobId}` : '', item.routeId ? `route ${item.routeId}` : ''].filter(Boolean).join(' · ');
    const context = item.contextSummary ? ` · ${compact(item.contextSummary, 120)}` : '';
    const elapsed = item.elapsedMs ? ` · ${item.elapsedMs}ms` : '';
    console.log(`${index + 1}. ${formatTime(Date.parse(item.timestamp || '') || 0)} · ${item.lane || '-'} · ${state}${elapsed}${ids ? ` · ${ids}` : ''}`);
    console.log(`   ${compact(item.transcriptPreview || '(no transcript preview)', 220)}${context}`);
    if (state === 'preview' && item.routeId) {
      console.log(`   Continue: npm run work:run -- --action-id route:${item.routeId}`);
    }
  }
}

async function showLocalVoiceLoopQuickstart() {
  const status = await request('/api/status').catch(() => ({}));
  const voiceHealth = status.voiceHealth || {};
  const localVoice = status.localVoice || {};
  console.log('\nJAVIS Local Voice Command Loop');
  console.log('==============================');
  console.log('Use this when Realtime voice is unavailable or when you want a quiet terminal intake loop.');
  console.log(`Realtime: ${voiceHealth.status || 'unknown'} · ${compact(voiceHealth.summary || '-', 220)}`);
  console.log(`Local fallback: ${localVoice.mode || 'standby'} · ${localVoice.input?.endpoint || '/api/voice/command'}`);
  if (localVoice.inputMode?.mode) {
    console.log(`Input mode: ${localVoice.inputMode.label || localVoice.inputMode.mode} · default=${localVoice.inputMode.micDefault || '-'} · ${compact(localVoice.inputMode.prompt || '', 160)}`);
  }
  console.log('\nCommands:');
  console.log('  npm run voice:chat');
  console.log('  npm run voice:chat -- --session');
  console.log('  npm run voice:chat -- --run --include-screen --include-ui');
  console.log('  npm run voice:chat -- --no-session --no-screen --no-ui');
  console.log('\nInside the loop:');
  console.log('  Type a request and press Enter.');
  console.log('  Type /status, /app, /file, /browser, /handoff, /jobs, /progress, /blockers, /unblock, /next, /auto, or /history for read-only resident checks.');
  console.log('  Type /ui <task> to preview a local app/UI workflow; start the loop with --run to execute.');
  console.log('  Type /file list|search|read ... to inspect allowed local files through policy.');
  console.log('  Type /file organize|rename|convert ... to preview file workflow plans without moving files.');
  console.log('  Type /browse [intent] <task> to preview a browser workflow over the current page.');
  console.log('  Type /open <url or search> to preview opening a page; start the loop with --run to execute.');
  console.log('  Type /delegate, /codex, or /claude <task> to preview a scoped worker handoff.');
  console.log('  Type /jobs or /progress to check background workers, workflows, recovery, and next action.');
  console.log('  Type /agent <task> to preview a bounded autonomy loop without execution.');
  console.log('  Type /help to list local loop commands.');
  console.log('  Type /exit or /quit to return to the shell.');
  console.log('\nSafety: starts microphone=no; uses Realtime=no; stores raw audio=no; screen/UI context is metadata-only.');
}

function printVoiceStandby(result) {
  const standby = result?.standby || result?.voiceStandby || result || {};
  const provider = standby.provider || {};
  const local = standby.local || {};
  const primary = standby.primaryAction || {};
  const safety = standby.safety || {};
  const inputMode = standby.inputMode || local.inputMode || {};
  const retryPolicy = provider.retryPolicy || {};
  const recoveryActions = Array.isArray(standby.recoveryActions) ? standby.recoveryActions : [];
  const history = local.history || {};
  const promptPack = standby.promptPack || local.promptPack || {};
  const examples = Array.isArray(promptPack.examples) ? promptPack.examples : [];
  console.log('\nJAVIS Voice Standby');
  console.log('===================');
  console.log(`Mode: ${standby.mode || '-'} · ${standby.label || '-'}`);
  if (standby.summary) console.log(`Summary: ${compact(standby.summary, 320)}`);
  if (standby.next) console.log(`Next: ${compact(standby.next, 320)}`);
  console.log(`Primary: ${primary.label || primary.id || '-'}${primary.command ? ` · ${primary.command}` : ''}${primary.endpoint ? ` · ${primary.endpoint}` : ''}`);
  console.log(`Primary safety: starts mic=${primary.startsMicrophone ? 'yes' : 'no'} uses Realtime=${primary.usesRealtime ? 'yes' : 'no'} opens Terminal=${primary.opensTerminal ? 'yes' : 'no'}`);
  if (inputMode.mode) {
    console.log(`Input mode: ${inputMode.label || inputMode.mode} · default=${inputMode.micDefault || '-'} · ${compact(inputMode.prompt || '', 160)}`);
  }
  console.log('\nProvider');
  console.log(`- ${provider.status || '-'} · ${provider.kind || '-'} · key=${provider.hasOpenAiKey ? 'present' : 'missing'} · ok=${provider.ok ? 'yes' : 'no'}`);
  if (provider.summary) console.log(`- ${compact(provider.summary, 300)}`);
  if (provider.next) console.log(`- next: ${compact(provider.next, 320)}`);
  if (provider.subscriptionBoundary) console.log(`- billing: ${compact(provider.subscriptionBoundary, 320)}`);
  if (retryPolicy.active) {
    console.log(`- retry: ${retryPolicy.state || '-'} · can probe now=${retryPolicy.canProbeNow ? 'yes' : 'no'}${retryPolicy.waitLabel ? ` · wait ${retryPolicy.waitLabel}` : ''} · local fallback=${retryPolicy.shouldUseLocalFallback ? 'yes' : 'no'}`);
  }
  console.log('\nLocal intake');
  console.log(`- ${local.mode || '-'} · ${local.input?.endpoint || '/api/voice/command'} · loop=${local.input?.openLoopCommand || 'npm run voice:chat'}`);
  if (local.summary) console.log(`- ${compact(local.summary, 260)}`);
  if (history.count !== undefined) console.log(`- history: ${history.count || 0} item(s)${history.latency?.avgMs ? ` · avg ${history.latency.avgMs}ms` : ''}`);
  if (local.blocker?.active) console.log(`- blocker: ${local.blocker.kind || '-'} · ${compact(local.blocker.summary || '', 220)}`);
  if (promptPack.nextUtterance || examples.length) {
    console.log('\nTry saying');
    if (promptPack.nextUtterance) console.log(`- next: ${compact(promptPack.nextUtterance, 180)}`);
    for (const example of examples.slice(0, 3)) {
      console.log(`- ${compact(example.utterance || example.label || '-', 180)}`);
    }
  }
  if (recoveryActions.length) {
    console.log('\nRecovery actions');
    for (const [index, action] of recoveryActions.entries()) {
      const command = action.command ? ` · ${action.command}` : '';
      const url = action.url ? ` · ${action.url}` : '';
      console.log(`${index + 1}. ${action.label || action.id}: ${compact(action.detail || '', 240)}${command}${url}`);
    }
  }
  console.log('\nCommands');
  console.log('- standby: npm run voice:standby');
  console.log('- primary action API: POST /api/voice/standby {"execute":false|true}');
  console.log('- local loop: npm run voice:chat');
  console.log('- one shot: npm run voice -- "..."');
  console.log('- provider probe: npm run dogfood:realtime-provider-probe');
  console.log('\nSafety');
  console.log(`- read-only=${safety.readOnly ? 'yes' : 'no'} starts mic=${safety.startsMicrophone ? 'yes' : 'no'} uses Realtime=${safety.usesRealtime ? 'yes' : 'no'} stores raw audio=${safety.storesRawAudio ? 'yes' : 'no'}`);
}

async function showVoiceStandby() {
  const result = await request('/api/voice/standby');
  printVoiceStandby(result);
  return result;
}

function printVoiceStandbyPrimaryAction(result) {
  const primary = result?.primaryAction || {};
  const action = result?.action || {};
  const safety = result?.safety || {};
  console.log('\nJAVIS Voice Entry');
  console.log('=================');
  console.log(`Mode: ${result?.mode || '-'}`);
  console.log(`Primary: ${primary.label || primary.id || '-'}${primary.command ? ` · ${primary.command}` : ''}${primary.endpoint ? ` · ${primary.endpoint}` : ''}`);
  console.log(`Executed: ${result?.executed ? 'yes' : 'no'}`);
  if (result?.output || action.output) console.log(`Output: ${compact(result.output || action.output, 500)}`);
  console.log(`Safety: starts mic=${safety.startsMicrophone ? 'yes' : 'no'} uses Realtime=${safety.usesRealtime ? 'yes' : 'no'} opens Terminal=${safety.opensTerminal ? 'yes' : 'no'} stores raw audio=${safety.storesRawAudio ? 'yes' : 'no'}`);
}

async function runVoiceStandbyPrimaryActionFromCli(options = {}) {
  const execute = options.execute === true;
  const result = await request('/api/voice/standby', {
    method: 'POST',
    body: {
      execute,
      source: execute ? 'cui_cli_voice_open' : 'cui_cli_voice_entry_preview',
    },
  });
  printVoiceStandbyPrimaryAction(result);
  return result;
}

async function startLocalVoiceCommandLoopFromCui(rl) {
  await showLocalVoiceLoopQuickstart();
  const answer = (await rl.question('\nStart local no-mic command loop now? Press Enter to start, or type NO: ')).trim().toLowerCase();
  if (answer === 'no' || answer === 'n') {
    console.log('\nNo local loop started.');
    return;
  }
  console.log('\nStarting local voice command loop. Type /exit to return to this CUI.');
  if (typeof rl.pause === 'function') rl.pause();
  const result = spawnSync(process.execPath, ['scripts/local-voice-command-dogfood.mjs', '--chat'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JAVIS_LOCAL_VOICE_CLI: 'true',
    },
    stdio: 'inherit',
  });
  if (typeof rl.resume === 'function') rl.resume();
  if (result.error) {
    console.log(`\nLocal voice command loop failed: ${result.error.message}`);
  } else {
    console.log(`\nLocal voice command loop exited with code ${result.status ?? 0}.`);
  }
}

async function showWakeHandoff() {
  const result = await request('/api/wake/status');
  const wake = result.wake || {};
  const handoff = wake.handoff || {};
  const input = handoff.input || {};
  const safety = handoff.safety || {};
  console.log('\nJAVIS Wake Handoff');
  console.log('==================');
  console.log(`Pending: ${wake.pending ? 'yes' : 'no'} · phrase: ${wake.lastPhrase || '-'} · source: ${wake.lastSource || '-'}`);
  console.log(`Mode: ${handoff.mode || '-'} · local voice: ${handoff.localVoiceMode || '-'}`);
  if (handoff.summary) console.log(`Summary: ${compact(handoff.summary, 260)}`);
  if (handoff.next) console.log(`Next: ${compact(handoff.next, 260)}`);
  if (handoff.blocker?.active) console.log(`Blocker: ${handoff.blocker.kind || handoff.blocker.status || 'provider'} · ${compact(handoff.blocker.summary || handoff.blocker.next || '', 260)}`);
  console.log(`Command: ${input.cliCommand || 'npm run voice -- "..."'}`);
  console.log(`Endpoint: ${input.endpoint || '/api/voice/command'}`);
  console.log(`Safety: read-only=${safety.readOnly !== false ? 'yes' : 'no'} · mic=${safety.startsMicrophone ? 'yes' : 'no'} · realtime=${safety.usesRealtime ? 'yes' : 'no'} · rawAudio=${safety.storesRawAudio ? 'yes' : 'no'}`);
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
  const collaborationHandoff = collaboration.handoff || {};
  const collaborationNext = collaborationHandoff.nextActions?.[0]?.label ? ` · next ${collaborationHandoff.nextActions[0].label}` : '';
  console.log(`Collab: ${collaborationHandoff.mode || 'unknown'} · ${collaboration.active || 0} active · ${collaboration.conflictPairs || 0} conflict pair(s)${collaborationNext}`);
  if (collaborationHandoff.summary) console.log(`Collab handoff: ${compact(collaborationHandoff.summary, 260)}`);
  const suggestedScopes = Array.isArray(collaborationHandoff.suggestedScopes) ? collaborationHandoff.suggestedScopes : [];
  if (suggestedScopes.length) {
    const safeSuggestions = suggestedScopes.filter((item) => item.safeToClaim).length;
    console.log(`Collab suggestions: ${safeSuggestions}/${suggestedScopes.length} safe · first ${suggestedScopes[0].label || suggestedScopes[0].id || '-'}`);
  }
  if (capabilities.speedPolicy?.spokenSummary) console.log(`Speed: ${compact(capabilities.speedPolicy.spokenSummary, 320)}`);
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

async function showPermissionMatrix() {
  const [status, configResult, capabilitiesResult] = await Promise.all([
    request('/api/status'),
    request('/api/config/check'),
    request('/api/capabilities?includeNext=false').catch(() => ({ capabilities: null })),
  ]);
  const config = configResult.config || {};
  const items = Array.isArray(config.items) ? config.items : [];
  const item = (...ids) => firstConfigItem(...ids)(items);
  const policy = status.actionPolicy?.effective || status.actionPolicy || {};
  const allow = policy.allow || {};
  const control = status.actionPolicy?.controlMode || {};
  const capabilities = capabilitiesResult.capabilities || {};
  const capabilityRows = Array.isArray(capabilities.capabilities) ? capabilities.capabilities : [];
  const capability = (id) => capabilityRows.find((row) => row.id === id) || null;
  const codePolicy = allow.code_agent || {};
  const cliPolicy = allow.cli_command || {};
  const codexCommand = getEnvValue('JAVIS_CODEX_CMD') || 'codex exec';
  const claudeCommand = getEnvValue('JAVIS_CLAUDE_CMD') || 'claude -p';
  const codexPath = commandPath(codexCommand);
  const claudePath = commandPath(claudeCommand);
  const chromeApps = [
    '/Applications/Google Chrome.app',
    path.join(os.homedir(), 'Applications', 'Google Chrome.app'),
    '/Applications/Arc.app',
    '/Applications/Comet.app',
    '/Applications/Brave Browser.app',
    '/Applications/Microsoft Edge.app',
  ].filter((candidate) => fs.existsSync(candidate));
  const writeRoots = allow.write_file?.allowedRoots || allow.create_directory?.allowedRoots || [];
  const browserControl = item('browser_control_policy');
  const browserRead = item('browser_page_policy');
  const accessibility = item('accessibility_permission');
  const screen = item('screen_permission');
  const microphone = item('microphone_permission');
  const notifications = item('notifications');
  const localExecution = item('local_execution');
  const actionPolicy = item('action_policy');
  const controlMode = item('control_mode');
  const screenPrivacy = item('screen_privacy_preset');

  console.log('JAVIS Permission Matrix');
  console.log('=======================');
  console.log(config.summary || status.readiness?.summary || 'Permission state loaded from the resident API.');
  console.log(`Overall: config=${config.overall || '-'} · readiness=${status.readiness?.overall || '-'} · local=${status.api?.localExecutionEnabled ? 'on' : 'off'} · trusted=${status.api?.trustedLocalMode ? 'yes' : 'no'}`);
  console.log('Note: macOS privacy panes still require your manual toggle. JAVIS can open the pane and verify evidence after you grant it.');

  printPermissionRows('macOS privacy', [
    {
      label: 'Microphone',
      status: microphone?.status || 'unknown',
      detail: microphone?.summary,
      next: microphone?.next || 'Menu M opens Microphone settings.',
    },
    {
      label: 'Screen Recording',
      status: screen?.status || 'unknown',
      detail: screen?.summary,
      next: screen?.next || 'Menu 3 opens Screen Recording settings.',
    },
    {
      label: 'Accessibility',
      status: accessibility?.status || 'unknown',
      detail: accessibility?.summary,
      next: accessibility?.next || 'Menu 4 opens Accessibility settings.',
    },
    {
      label: 'Full Disk Access',
      status: 'manual',
      detail: writeRoots.length ? `JAVIS file policy can use ${writeRoots.length} root(s): ${writeRoots.slice(0, 3).join(', ')}` : 'macOS Full Disk Access cannot be granted programmatically.',
      next: 'Menu 5 opens Full Disk Access settings; add Terminal/Codex/Electron if protected folders fail.',
    },
    {
      label: 'Notifications',
      status: notifications?.status || 'unknown',
      detail: notifications?.summary,
      next: notifications?.next || '',
    },
    {
      label: 'Screen privacy preset',
      status: screenPrivacy?.status || 'unknown',
      detail: screenPrivacy?.summary,
      next: screenPrivacy?.next || 'Menu 34/35 reviews or reapplies screen privacy.',
    },
  ]);

  printPermissionRows('local autonomy', [
    {
      label: 'Local execution',
      status: localExecution?.status || (status.api?.localExecutionEnabled ? 'ready' : 'blocked'),
      detail: localExecution?.summary || `JAVIS_ENABLE_LOCAL_EXEC=${status.api?.localExecutionEnabled ? 'true' : 'false'}`,
      next: localExecution?.next || 'Menu 8 toggles local execution.',
    },
    {
      label: 'Trusted local mode',
      status: status.api?.trustedLocalMode ? 'ready' : 'warning',
      detail: `JAVIS_TRUSTED_LOCAL_MODE=${status.api?.trustedLocalMode ? 'true' : 'false'}`,
      next: status.api?.trustedLocalMode ? '' : 'Menu 10 enables trusted local mode after confirmation.',
    },
    {
      label: 'Control mode',
      status: controlMode?.status || 'unknown',
      detail: controlMode?.summary || `${control.mode || '-'} · auto L${control.effective?.maxAutoRiskLevel ?? policy.maxAutoRiskLevel ?? '-'} · approval L${control.effective?.requireApprovalAtRiskLevel ?? policy.requireApprovalAtRiskLevel ?? '-'}`,
      next: controlMode?.next || 'Menu 11 changes runtime control posture.',
    },
    {
      label: 'Action policy',
      status: actionPolicy?.status || 'unknown',
      detail: actionPolicy?.summary || `dryRun=${policy.dryRun ? 'yes' : 'no'} · auto L${policy.maxAutoRiskLevel ?? '-'} · approval L${policy.requireApprovalAtRiskLevel ?? '-'}`,
      next: actionPolicy?.next || 'Menu 9 toggles Level 3 auto-run.',
    },
    {
      label: 'File write roots',
      status: writeRoots.length ? 'ready' : 'warning',
      detail: writeRoots.join(', ') || 'No write roots reported by action policy.',
      next: writeRoots.length ? '' : 'Set JAVIS_ALLOWED_WRITE_ROOTS or enable trusted local mode.',
    },
  ]);

  printPermissionRows('workers and CLI tools', [
    {
      label: `Codex (${codexCommand})`,
      status: codexPath && capability('codex')?.status !== 'blocked' ? 'ready' : 'blocked',
      detail: codexPath ? `found ${codexPath}` : 'command not found in PATH',
      next: codexPath ? '' : 'Install/login Codex CLI or set JAVIS_CODEX_CMD.',
    },
    {
      label: `Claude Code (${claudeCommand})`,
      status: claudePath && capability('claude')?.status !== 'blocked' ? 'ready' : 'blocked',
      detail: claudePath ? `found ${claudePath}` : 'command not found in PATH',
      next: claudePath ? '' : 'Install/login Claude Code CLI or set JAVIS_CLAUDE_CMD.',
    },
    {
      label: 'Code-agent policy',
      status: codePolicy.enabled ? 'ready' : 'blocked',
      detail: `allowed=${Array.isArray(codePolicy.allowedCommands) ? codePolicy.allowedCommands.join(', ') : '-'} · timeout=${formatInterval(codePolicy.maxTimeoutMs || 0)}`,
      next: codePolicy.enabled ? '' : 'Enable allow.code_agent in action policy.',
    },
    {
      label: 'Generic CLI policy',
      status: cliPolicy.enabled ? 'ready' : 'blocked',
      detail: `allowed=${Array.isArray(cliPolicy.allowedCommands) ? cliPolicy.allowedCommands.join(', ') : '-'} · timeout=${formatInterval(cliPolicy.maxTimeoutMs || 0)}`,
      next: cliPolicy.enabled ? '' : 'Enable allow.cli_command in action policy.',
    },
  ]);

  printPermissionRows('browser and app control', [
    {
      label: 'Browser page reading',
      status: browserRead?.status || capability('browser')?.status || 'unknown',
      detail: browserRead?.summary || capability('browser')?.summary || '',
      next: browserRead?.next || 'Menu 31 shows browser activity; G runs browser workflow benchmarks.',
    },
    {
      label: 'Browser guarded control',
      status: browserControl?.status || capability('browser')?.status || 'unknown',
      detail: browserControl?.summary || `installed browsers=${chromeApps.length ? chromeApps.map((appPath) => path.basename(appPath, '.app')).join(', ') : 'none detected in /Applications'}`,
      next: browserControl?.next || 'Use browser workflow previews first; submits/sends still require confirmation.',
    },
    {
      label: 'Chrome DevTools bridge',
      status: chromeApps.length ? 'ready' : 'warning',
      detail: `JAVIS_CHROME_DEBUG_PORT=${getEnvValue('JAVIS_CHROME_DEBUG_PORT') || process.env.JAVIS_CHROME_DEBUG_PORT || '9222'}`,
      next: chromeApps.length ? 'Optional bridge; Apple Events path may be enough.' : 'Install a supported browser or use the existing browser menu to inspect bridge readiness.',
    },
    {
      label: 'Mac app Accessibility actions',
      status: capability('app')?.status || accessibility?.status || 'unknown',
      detail: capability('app')?.summary || accessibility?.summary || '',
      next: capability('app')?.nextAction || 'Menu U/Y runs app and productivity previews.',
    },
  ]);

  printPermissionRows('resident and shortcuts', [
    {
      label: 'LaunchAgent',
      status: item('launch_agent')?.status || 'unknown',
      detail: item('launch_agent')?.summary || LAUNCH_AGENT_LABEL,
      next: item('launch_agent')?.next || 'Use npm run resident:restart if the resident is stale.',
    },
    {
      label: 'Tap summon hotkey',
      status: item('summon_hotkey')?.status || (status.window?.summonHotkeyRegistered ? 'ready' : 'warning'),
      detail: item('summon_hotkey')?.summary || `${status.window?.summonHotkey || '-'} · registered=${status.window?.summonHotkeyRegistered ? 'yes' : 'no'}`,
      next: item('summon_hotkey')?.next || 'Set JAVIS_SUMMON_HOTKEY or JAVIS_TAP_HOTKEY.',
    },
    {
      label: 'Capture hotkey',
      status: item('capture_hotkey')?.status || (status.window?.captureHotkeyRegistered ? 'ready' : 'warning'),
      detail: item('capture_hotkey')?.summary || `${status.window?.captureHotkey || '-'} · registered=${status.window?.captureHotkeyRegistered ? 'yes' : 'no'}`,
      next: item('capture_hotkey')?.next || '',
    },
  ]);

  console.log('\nUseful commands:');
  console.log('- npm run config -- --print-permissions');
  console.log('- npm run config -- --print-capabilities --include-next');
  console.log('- npm run doctor -- --allow-blocked');
  console.log('- npm run eval -- --only=health,control,parallel,collaboration');
}

function readinessStatusFromChecks(checks) {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked';
  if (checks.some((check) => check.status === 'warning' || check.status === 'manual' || check.status === 'limited')) return 'warning';
  return 'ready';
}

function printReadinessGate(gate) {
  console.log(`- ${statusGlyph(gate.status)} ${gate.label}: ${compact(gate.summary, 220)}`);
  if (gate.next) console.log(`  next=${compact(gate.next, 220)}`);
}

async function showControlReadiness() {
  const [status, configResult, capabilitiesResult, perceptionResult, collaborationResult] = await Promise.all([
    request('/api/status'),
    request('/api/config/check'),
    request('/api/capabilities?includeNext=false').catch(() => ({ capabilities: null })),
    request('/api/perception/consent?limit=10').catch(() => ({ perception: null })),
    request('/api/collaboration/handoff?limit=8').catch(() => ({ handoff: null })),
  ]);
  const config = configResult.config || {};
  const items = Array.isArray(config.items) ? config.items : [];
  const item = (...ids) => firstConfigItem(...ids)(items);
  const policy = status.actionPolicy?.effective || status.actionPolicy || {};
  const allow = policy.allow || {};
  const control = status.actionPolicy?.controlMode || {};
  const capabilities = capabilitiesResult.capabilities || {};
  const capabilityRows = Array.isArray(capabilities.capabilities) ? capabilities.capabilities : [];
  const capability = (id) => capabilityRows.find((row) => row.id === id) || null;
  const perception = perceptionResult.perception || {};
  const perceptionCounts = perception.counts || {};
  const collaboration = collaborationResult.handoff || {};
  const collaborationCounts = collaboration.counts || {};
  const writeRoots = allow.write_file?.allowedRoots || allow.create_directory?.allowedRoots || [];
  const codexCommand = getEnvValue('JAVIS_CODEX_CMD') || 'codex exec';
  const claudeCommand = getEnvValue('JAVIS_CLAUDE_CMD') || 'claude -p';
  const codexPath = commandPath(codexCommand);
  const claudePath = commandPath(claudeCommand);
  const codePolicy = allow.code_agent || {};
  const cliPolicy = allow.cli_command || {};
  const gates = [
    {
      id: 'voice',
      label: 'Voice entry',
      status: readinessStatusFromChecks([
        { status: status.api?.hasOpenAiKey ? 'ready' : 'blocked' },
        { status: item('microphone_permission')?.status || 'unknown' },
      ]),
      summary: `OpenAI key ${status.api?.hasOpenAiKey ? 'present' : 'missing'}; microphone ${item('microphone_permission')?.status || 'unknown'}.`,
      next: status.api?.hasOpenAiKey ? item('microphone_permission')?.next || '' : 'Add OPENAI_API_KEY from CUI option 1, then restart JAVIS.',
    },
    {
      id: 'screen',
      label: 'Screen awareness',
      status: readinessStatusFromChecks([
        { status: item('screen_permission')?.status || 'unknown' },
        { status: item('screen_privacy_preset')?.status || 'unknown' },
      ]),
      summary: `${item('screen_permission')?.summary || 'Screen status unknown'} Privacy: ${item('screen_privacy_preset')?.summary || 'preset unknown'}`,
      next: item('screen_permission')?.next || item('screen_privacy_preset')?.next || '',
    },
    {
      id: 'app',
      label: 'Mac app control',
      status: readinessStatusFromChecks([
        { status: item('accessibility_permission')?.status || 'unknown' },
        { status: capability('app')?.status || 'unknown' },
      ]),
      summary: capability('app')?.summary || item('accessibility_permission')?.summary || 'Accessibility/app capability unknown.',
      next: capability('app')?.nextAction || item('accessibility_permission')?.next || '',
    },
    {
      id: 'browser',
      label: 'Browser control',
      status: readinessStatusFromChecks([
        { status: item('browser_page_policy')?.status || capability('browser')?.status || 'unknown' },
        { status: item('browser_control_policy')?.status || capability('browser')?.status || 'unknown' },
      ]),
      summary: `${item('browser_page_policy')?.summary || 'Browser read policy unknown'} ${item('browser_control_policy')?.summary || ''}`,
      next: item('browser_control_policy')?.next || 'Use browser workflow previews first; submissions still require confirmation.',
    },
    {
      id: 'files',
      label: 'Files and local actions',
      status: readinessStatusFromChecks([
        { status: status.api?.localExecutionEnabled ? 'ready' : 'blocked' },
        { status: writeRoots.length ? 'ready' : 'warning' },
        { status: capability('file')?.status || 'unknown' },
      ]),
      summary: `local execution=${status.api?.localExecutionEnabled ? 'on' : 'off'}; trusted=${status.api?.trustedLocalMode ? 'yes' : 'no'}; write roots=${writeRoots.length || 0}.`,
      next: status.api?.localExecutionEnabled ? '' : 'Enable local execution from CUI option 8.',
    },
    {
      id: 'workers',
      label: 'Codex and Claude Code',
      status: readinessStatusFromChecks([
        { status: codexPath ? 'ready' : 'blocked' },
        { status: claudePath ? 'ready' : 'blocked' },
        { status: codePolicy.enabled ? 'ready' : 'blocked' },
      ]),
      summary: `Codex ${codexPath ? 'ready' : 'missing'}; Claude Code ${claudePath ? 'ready' : 'missing'}; code-agent policy=${codePolicy.enabled ? 'on' : 'off'}.`,
      next: !codexPath ? 'Install/login Codex CLI or set JAVIS_CODEX_CMD.' : !claudePath ? 'Install/login Claude Code CLI or set JAVIS_CLAUDE_CMD.' : '',
    },
    {
      id: 'cli',
      label: 'Generic CLI lane',
      status: cliPolicy.enabled ? 'ready' : 'blocked',
      summary: `allowed commands=${Array.isArray(cliPolicy.allowedCommands) ? cliPolicy.allowedCommands.join(', ') : '-'}; timeout=${formatInterval(cliPolicy.maxTimeoutMs || 0)}.`,
      next: cliPolicy.enabled ? '' : 'Enable allow.cli_command in action-policy.json.',
    },
    {
      id: 'resident',
      label: 'Resident and hotkeys',
      status: readinessStatusFromChecks([
        { status: item('launch_agent')?.status || 'unknown' },
        { status: item('summon_hotkey')?.status || (status.window?.summonHotkeyRegistered ? 'ready' : 'warning') },
        { status: item('capture_hotkey')?.status || (status.window?.captureHotkeyRegistered ? 'ready' : 'warning') },
      ]),
      summary: `LaunchAgent ${item('launch_agent')?.status || 'unknown'}; summon ${status.window?.summonHotkeyRegistered ? 'registered' : 'off'} (${status.window?.summonHotkey || '-'}); capture ${status.window?.captureHotkeyRegistered ? 'registered' : 'off'} (${status.window?.captureHotkey || '-'}).`,
      next: item('launch_agent')?.next || '',
    },
    {
      id: 'perception',
      label: 'Consent and storage posture',
      status: Number(perceptionCounts.blocked || 0) > 0 ? 'blocked' : Number(perceptionCounts.limited || 0) > 0 ? 'warning' : 'ready',
      summary: `${perceptionCounts.enabled || 0}/${perceptionCounts.total || 0} perception/tool surfaces enabled; ${perceptionCounts.active || 0} active; ${perceptionCounts.blocked || 0} blocked.`,
      next: Number(perceptionCounts.blocked || 0) > 0 ? 'Run npm run config -- --print-perception to inspect blocked surfaces.' : '',
    },
    {
      id: 'collaboration',
      label: 'Multi-agent coordination',
      status: Number(collaborationCounts.conflicts || 0) > 0 ? 'blocked' : 'ready',
      summary: `${collaborationCounts.active || 0} active claim(s); ${collaborationCounts.conflicts || 0} conflict pair(s).`,
      next: Number(collaborationCounts.conflicts || 0) > 0 ? 'Run npm run collab -- handoff to resolve overlapping scopes.' : 'Use npm run collab -- handoff --markdown --agent claude-code before starting external workers.',
    },
  ];

  const counts = gates.reduce((acc, gate) => {
    acc[gate.status] = (acc[gate.status] || 0) + 1;
    return acc;
  }, {});
  const overall = counts.blocked ? 'blocked' : counts.warning ? 'limited' : 'ready';
  const takeoverReady = overall === 'ready' && status.api?.trustedLocalMode && Number(policy.maxAutoRiskLevel || 0) >= 3;

  console.log('JAVIS Local Control Readiness');
  console.log('=============================');
  console.log(`Overall: ${overall} · ready ${counts.ready || 0} · warning ${counts.warning || 0} · blocked ${counts.blocked || 0}`);
  console.log(`Takeover posture: ${takeoverReady ? 'ready for supervised local control' : 'needs review before broad local control'} · control=${control.mode || '-'} · auto L${control.effective?.maxAutoRiskLevel ?? policy.maxAutoRiskLevel ?? '-'} · approval L${control.effective?.requireApprovalAtRiskLevel ?? policy.requireApprovalAtRiskLevel ?? '-'}`);
  console.log(`Summary: ${capabilities.spokenSummary || config.summary || status.readiness?.summary || 'Local control status loaded.'}`);

  console.log('\nReadiness gates:');
  for (const gate of gates) printReadinessGate(gate);

  const nextActions = gates
    .filter((gate) => gate.status !== 'ready' && gate.next)
    .map((gate) => `${gate.label}: ${gate.next}`);
  console.log('\nNext actions:');
  if (nextActions.length) {
    for (const action of nextActions.slice(0, 6)) console.log(`- ${compact(action, 240)}`);
  } else {
    console.log('- No setup blocker found. Start live voice from the pet or summon hotkey when you want JAVIS to act.');
    console.log('- Keep Level 4 actions such as sends, purchases, deletes, form submissions, and account changes behind explicit confirmation.');
  }

  console.log('\nUseful commands:');
  console.log('- npm run config -- --print-control-readiness');
  console.log('- npm run config -- --print-permissions');
  console.log('- npm run config -- --print-capabilities --include-next');
  console.log('- npm run eval -- --only=health,control,presence,parallel,collaboration');
}

function printRoutingSpeedPolicy(result) {
  const policy = result?.speedPolicy || result || {};
  const models = policy.models || {};
  const rules = policy.policy || {};
  const decision = policy.decision || null;
  console.log('JAVIS Routing Speed Policy');
  console.log('==========================');
  console.log(policy.spokenSummary || policy.summary || 'No routing speed policy available.');
  console.log(`Manual only=yes · starts microphone=${policy.startsMicrophone ? 'yes' : 'no'} · executes actions=${policy.executesActions ? 'yes' : 'no'}`);
  console.log(`Models: realtime=${models.realtime || '-'} · fast=${models.fast || '-'} · background=${models.background || '-'} · voice=${models.realtimeVoice || '-'}`);
  console.log(`Workers: codex=${models.codexCommand || '-'} · claude=${models.claudeCommand || '-'}`);
  if (Array.isArray(rules.defaultOrder) && rules.defaultOrder.length) {
    console.log(`Order: ${rules.defaultOrder.join(' -> ')}`);
  }
  const ruleLines = Array.isArray(rules.rules) ? rules.rules : [];
  if (ruleLines.length) {
    console.log('\nRules:');
    for (const rule of ruleLines.slice(0, 8)) console.log(`- ${compact(rule, 220)}`);
  }
  const profiles = Array.isArray(policy.profiles) ? policy.profiles : [];
  if (profiles.length) {
    console.log('\nProfiles:');
    for (const item of profiles) {
      const bg = item.canRunInBackground ? 'bg' : 'inline';
      const parallel = item.parallelEligible ? 'parallel' : 'serial';
      console.log(`- ${item.id || '-'} · ${item.latencyClass || '-'} · ${bg}/${parallel} · ${item.modelRole || '-'}:${item.model || '-'} · ${compact(item.summary || '', 200)}`);
    }
  }
  const samples = Array.isArray(policy.samples) ? policy.samples : [];
  if (samples.length) {
    console.log('\nSamples:');
    for (const sample of samples.slice(0, 6)) {
      console.log(`- ${sample.id || '-'} -> ${sample.lane || '-'} / ${sample.profile || '-'} · ${compact(sample.reason || '', 180)}`);
    }
  }
  if (decision) {
    console.log('\nDecision:');
    console.log(`- lane=${decision.lane || '-'} · profile=${decision.speedProfile?.id || '-'} · model=${decision.speedProfile?.model || '-'}`);
    console.log(`- reason=${compact(decision.reason || '', 260)}`);
    if (decision.toolFirst?.recommended) {
      console.log(`- tool-first=${decision.toolFirst.profileId || '-'} · ${compact(decision.toolFirst.reason || '', 220)}`);
      const firstTools = Array.isArray(decision.toolFirst.firstTools) ? decision.toolFirst.firstTools : [];
      if (firstTools.length) console.log(`- first-tools=${firstTools.join(', ')}`);
    }
    console.log(`- spoken=${compact(decision.spokenPlan || '', 260)}`);
    const tools = decision.contextPlan?.recommendedTools || [];
    if (tools.length) console.log(`- tools=${tools.join(', ')}`);
  }
}

async function showRoutingSpeedPolicy(options = {}) {
  const params = new URLSearchParams();
  if (options.message) params.set('message', options.message);
  if (options.lane) params.set('lane', options.lane);
  const result = await request(`/api/routing/speed-policy?${params.toString()}`);
  console.log('');
  printRoutingSpeedPolicy(result);
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

function printLearningEvolution(evolution) {
  const recent = evolution?.windows?.recent || {};
  const baseline = evolution?.windows?.baseline || {};
  const changes = Array.isArray(evolution?.changes) ? evolution.changes : [];
  const privacy = evolution?.privacy || {};
  console.log('Learning Evolution');
  console.log('==================');
  console.log(evolution?.spokenSummary || evolution?.summary || 'No local learning evolution summary available.');
  console.log(`Events: recent ${recent.count || 0} · baseline ${baseline.count || 0} · enough baseline=${evolution?.enoughBaseline ? 'yes' : 'no'}`);
  console.log(`Privacy: local-only=${privacy.localOnly ? 'yes' : 'no'} · metadata-only=${privacy.metadataOnly ? 'yes' : 'no'} · raw screenshots=${privacy.noRawScreenshots ? 'no' : 'unknown'} · clipboard text=${privacy.noClipboardText ? 'no' : 'unknown'} · page bodies=${privacy.noPageBodies ? 'no' : 'unknown'}`);
  if (!changes.length) {
    console.log('\nChanges: none');
  } else {
    console.log('\nChanges:');
    for (const change of changes.slice(0, 8)) {
      const shift = [change.from, change.to].filter(Boolean).join(' -> ') || change.to || change.id || '-';
      console.log(`- ${change.label || change.id || 'change'} · ${shift} · confidence ${change.confidence ?? '-'}`);
      if (change.evidence) console.log(`  ${compact(change.evidence, 180)}`);
    }
  }
  const topRecentApps = Array.isArray(recent.topApps) ? recent.topApps.slice(0, 3).map((item) => `${item.name} ${Math.round((item.share || 0) * 100)}%`) : [];
  const topBaselineApps = Array.isArray(baseline.topApps) ? baseline.topApps.slice(0, 3).map((item) => `${item.name} ${Math.round((item.share || 0) * 100)}%`) : [];
  if (topRecentApps.length || topBaselineApps.length) {
    console.log('\nApp focus:');
    console.log(`- recent: ${topRecentApps.join(', ') || '-'}`);
    console.log(`- baseline: ${topBaselineApps.join(', ') || '-'}`);
  }
  const topRecentHosts = Array.isArray(recent.topBrowserHosts) ? recent.topBrowserHosts.slice(0, 3).map((item) => `${item.host} ${Math.round((item.share || 0) * 100)}%`) : [];
  const topBaselineHosts = Array.isArray(baseline.topBrowserHosts) ? baseline.topBrowserHosts.slice(0, 3).map((item) => `${item.host} ${Math.round((item.share || 0) * 100)}%`) : [];
  if (topRecentHosts.length || topBaselineHosts.length) {
    console.log('\nBrowser focus:');
    console.log(`- recent: ${topRecentHosts.join(', ') || '-'}`);
    console.log(`- baseline: ${topBaselineHosts.join(', ') || '-'}`);
  }
  if (evolution?.nextAction) console.log(`\nNext: ${evolution.nextAction}`);
}

async function showLearningEvolution() {
  const result = await request('/api/learning/evolution?source=cui');
  console.log('');
  printLearningEvolution(result.evolution || result);
}

function printLearningDistillation(distillation) {
  const state = distillation?.state || {};
  const profile = distillation?.profile || {};
  const evolution = distillation?.evolution || {};
  const artifacts = distillation?.artifacts || {};
  const demonstrations = artifacts.demonstrations || {};
  const shortcuts = artifacts.shortcuts || {};
  const skills = artifacts.skills || {};
  const habitCandidates = distillation?.habitCandidates || {};
  const privacy = distillation?.privacy || {};
  console.log('Learning Distillation');
  console.log('=====================');
  console.log(distillation?.spokenSummary || distillation?.summary || 'No local distillation summary available.');
  console.log(`State: configured=${state.configured ? 'yes' : 'no'} · enabled=${state.enabled ? 'yes' : 'no'} · paused=${state.paused ? 'yes' : 'no'} · prompts=${state.includeInPrompts ? 'on' : 'off'}`);
  console.log(`Profile: ${profile.sourceEventCount || 0} metadata event(s) · changes ${(evolution.changes || []).length || 0} · reusable ${(demonstrations.counts?.done || 0) + (shortcuts.counts?.enabled || 0) + (skills.returned || 0)}`);
  console.log(`Privacy: local-only=${privacy.localOnly ? 'yes' : 'no'} · metadata-only=${privacy.metadataOnly ? 'yes' : 'no'} · raw screenshots=${privacy.noRawScreenshots ? 'no' : 'unknown'} · clipboard text=${privacy.noClipboardText ? 'no' : 'unknown'} · page bodies=${privacy.noPageBodies ? 'no' : 'unknown'}`);
  if (privacy.promptInjectionRisk) console.log(`Risk: ${compact(privacy.promptInjectionRisk, 220)}`);
  const signals = Array.isArray(profile.signals) ? profile.signals : [];
  if (signals.length) {
    console.log('\nSignals:');
    for (const signal of signals.slice(0, 6)) console.log(`- ${compact(signal, 180)}`);
  }
  const changes = Array.isArray(evolution.changes) ? evolution.changes : [];
  if (changes.length) {
    console.log('\nRecent changes:');
    for (const change of changes.slice(0, 5)) {
      const shift = [change.from, change.to].filter(Boolean).join(' -> ') || change.to || change.id || '-';
      console.log(`- ${change.label || change.id || 'change'} · ${shift} · confidence ${change.confidence ?? '-'}`);
    }
  }
  const demoCounts = demonstrations.counts || {};
  const shortcutCounts = shortcuts.counts || {};
  console.log('\nArtifacts:');
  console.log(`- demonstrations: done ${demoCounts.done || 0} · recording ${demoCounts.recording || 0} · total ${demoCounts.total || 0}`);
  console.log(`- shortcuts: enabled ${shortcutCounts.enabled || 0} · disabled ${shortcutCounts.disabled || 0} · total ${shortcutCounts.total || 0}`);
  console.log(`- local skills: ${skills.returned || 0}`);
  const candidates = Array.isArray(habitCandidates.candidates) ? habitCandidates.candidates : [];
  console.log('\nHabit candidates:');
  console.log(`Policy: read-only=${habitCandidates.policy?.readOnly ? 'yes' : 'no'} · no auto-save=${habitCandidates.policy?.noAutoSave ? 'yes' : 'no'} · confirm promotion=${habitCandidates.policy?.confirmationRequiredForPromotion ? 'yes' : 'no'}`);
  if (!candidates.length) {
    console.log('- none');
  } else {
    for (const candidate of candidates.slice(0, 6)) {
      const action = candidate.recommendedAction || {};
      const confirm = action.requiresConfirmation ? ' · confirm' : '';
      console.log(`- ${candidate.kind || 'candidate'} · ${compact(candidate.label || candidate.id || '-', 120)} · confidence ${candidate.confidence ?? '-'}${confirm}`);
      if (candidate.summary) console.log(`  ${compact(candidate.summary, 220)}`);
      if (action.endpoint) console.log(`  next: ${action.method || 'GET'} ${action.endpoint}`);
    }
  }
  const nextActions = Array.isArray(distillation?.nextActions) ? distillation.nextActions : [];
  if (nextActions.length) {
    console.log('\nNext actions:');
    for (const action of nextActions.slice(0, 6)) {
      console.log(`- ${action.id || '-'} · ${action.label || '-'} · ${action.method || 'GET'} ${action.endpoint || '-'}${action.requiresConfirmation ? ' · confirm' : ''}`);
    }
  }
}

async function showLearningDistillation() {
  const result = await request('/api/learning/distillation?source=cui');
  console.log('');
  printLearningDistillation(result.distillation || result);
}

function printRecordReplayTeachingPacket(result) {
  const packet = result?.teachingPacket || result?.packet || result || {};
  const metadata = result?.metadata || {};
  const latest = result?.latest || null;
  const packets = result?.packets || {};
  const candidate = packet.candidate || metadata.candidate || {};
  const safety = packet.safety || metadata.safety || {};
  const distillation = packet.distillation || {};
  const teachingScript = Array.isArray(packet.teachingScript) ? packet.teachingScript : [];
  const prompts = Array.isArray(packet.liveVoicePrompts) ? packet.liveVoicePrompts : [];
  const boundaries = Array.isArray(packet.boundaries) ? packet.boundaries : [];
  const recentItems = Array.isArray(packets.items) ? packets.items : [];
  console.log('Record & Replay Teaching Packet');
  console.log('===============================');
  console.log(packet.summary || metadata.summary || 'No teaching packet preview available.');
  console.log(`Saved: ${packet.saved || metadata.saved ? 'yes' : 'no'}${metadata.file || packet.file?.path ? ` · ${metadata.file || packet.file.path}` : ''}`);
  console.log(`Candidate: ${candidate.kind || '-'} · ${candidate.label || candidate.id || '-'} · confidence ${candidate.confidence ?? '-'}`);
  if (distillation.spokenSummary || distillation.summary) console.log(`Distillation: ${compact(distillation.spokenSummary || distillation.summary, 420)}`);
  console.log(`Safety: microphone=${safety.startsMicrophone ? 'starts' : 'no'} · recording=${safety.startsRecording ? 'starts' : 'no'} · workers=${safety.startsWorkers ? 'starts' : 'no'} · replay/actions=${safety.executesTask ? 'yes' : 'no'} · grants permission=${safety.grantsPermission ? 'yes' : 'no'}`);
  console.log(`Confirm gates: recording=${safety.confirmationRequiredForRecording !== false ? 'yes' : 'unknown'} · replay=${safety.confirmationRequiredForReplay !== false ? 'yes' : 'unknown'} · skill save=${safety.confirmationRequiredForSkillSave !== false ? 'yes' : 'unknown'} · shortcut=${safety.confirmationRequiredForShortcutSave !== false ? 'yes' : 'unknown'}`);
  if (prompts.length) {
    console.log('\nVoice prompts:');
    for (const prompt of prompts.slice(0, 6)) console.log(`- ${compact(prompt, 220)}`);
  }
  if (teachingScript.length) {
    console.log('\nTeaching steps:');
    for (const step of teachingScript.slice(0, 8)) {
      console.log(`- ${step.id || '-'} · ${step.label || '-'}: ${compact(step.instruction || '', 220)}`);
      if (step.endpoint?.path) console.log(`  endpoint=${step.endpoint.method || 'POST'} ${step.endpoint.path}`);
      if (Array.isArray(step.endpoints) && step.endpoints.length) {
        console.log(`  endpoints=${step.endpoints.slice(0, 3).map((item) => `${item.method || 'POST'} ${item.path || '-'}`).join(' | ')}`);
      }
    }
  }
  if (boundaries.length) {
    console.log('\nBoundaries:');
    for (const boundary of boundaries.slice(0, 6)) console.log(`- ${compact(boundary, 220)}`);
  }
  if (latest) {
    console.log(`\nLatest saved: ${latest.filename || '-'} · ${latest.savedAt || latest.generatedAt || '-'} · ${compact(latest.summary || '', 180)}`);
  }
  if (recentItems.length) {
    console.log('\nRecent saved packets:');
    for (const item of recentItems.slice(0, 5)) {
      console.log(`- ${item.filename || '-'} · ${item.candidate?.label || item.candidate?.id || '-'} · ${item.counts?.teachingSteps || 0} step(s)`);
    }
  }
}

async function showRecordReplayTeachingPacket(options = {}) {
  const save = options.save === true;
  const result = save
    ? await request('/api/record-replay/teaching-packet', {
      method: 'POST',
      body: { source: 'cui_record_replay_teaching_packet' },
    })
    : await request('/api/record-replay/teaching-packet?source=cui_record_replay_teaching_packet&limit=5');
  console.log('');
  printRecordReplayTeachingPacket(result);
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

function printCollaborationHandoff(result) {
  const handoff = result?.handoff || result || {};
  const counts = handoff.counts || {};
  const ownerGroups = Array.isArray(handoff.ownerGroups) ? handoff.ownerGroups : [];
  const conflictPairs = Array.isArray(handoff.conflictPairs) ? handoff.conflictPairs : [];
  const nextActions = Array.isArray(handoff.nextActions) ? handoff.nextActions : [];
  const activeScopes = Array.isArray(handoff.activeScopes) ? handoff.activeScopes : [];
  const suggestedScopes = Array.isArray(handoff.suggestedScopes) ? handoff.suggestedScopes : [];
  const suggestionsOnly = suggestedScopes.length && !handoff.spokenSummary && !handoff.summary && !ownerGroups.length && !activeScopes.length && !nextActions.length;
  console.log(suggestionsOnly ? 'Collaboration Scope Suggestions' : 'Collaboration Handoff');
  console.log(suggestionsOnly ? '===============================' : '=====================');
  if (!suggestionsOnly) {
    console.log(handoff.spokenSummary || handoff.summary || 'No collaboration handoff available.');
    console.log(`Mode: ${handoff.mode || '-'} · active ${counts.active || 0} · conflicts ${counts.conflicts || 0} · total ${counts.total || 0}`);
  }
  if (ownerGroups.length) {
    console.log('\nOwner groups:');
    for (const group of ownerGroups.slice(0, 8)) {
      const scopes = Array.isArray(group.scopes) ? group.scopes.slice(0, 3).join('; ') : '';
      console.log(`- ${group.owner || group.agent || '-'} / ${group.lane || '-'} · ${group.active || 0} active · ${group.writeScopes || 0} write${scopes ? ` · ${compact(scopes, 180)}` : ''}`);
      if (Array.isArray(group.tasks) && group.tasks.length) console.log(`  tasks=${compact(group.tasks.join(' | '), 180)}`);
    }
  }
  if (conflictPairs.length) {
    console.log('\nConflicts:');
    for (const pair of conflictPairs.slice(0, 6)) {
      const left = pair.left || {};
      const right = pair.right || {};
      console.log(`- ${left.owner || left.agent || '-'} <-> ${right.owner || right.agent || '-'} · ${compact(pair.key || left.key || right.key || '-', 180)}`);
    }
  }
  if (nextActions.length) {
    console.log('\nNext actions:');
    for (const action of nextActions.slice(0, 5)) {
      console.log(`- ${action.label || action.id || '-'}: ${compact(action.summary || '', 220)}`);
    }
  }
  if (suggestionsOnly) {
    // Suggestions-only output does not need a synthetic empty active-scope line.
  } else if (!activeScopes.length) {
    console.log('\nActive scopes: none');
  } else {
    console.log('\nActive scopes:');
    for (const claim of activeScopes.slice(0, 10)) {
      const expires = claim.expiresAt ? ` · expires ${formatTime(claim.expiresAt)}` : '';
      console.log(`- ${claim.owner || claim.agent || 'agent'} · ${claim.access}:${compact(claim.key || claim.scope || '-', 180)}${expires}`);
      if (claim.task) console.log(`  task=${compact(claim.task, 180)}`);
      if (claim.nextHeartbeatCommand) console.log(`  heartbeat=${claim.nextHeartbeatCommand}`);
      if (claim.releaseCommand) console.log(`  release=${claim.releaseCommand}`);
    }
  }
  if (suggestedScopes.length) {
    console.log('\nSuggested scopes for external agents:');
    for (const suggestion of suggestedScopes.slice(0, 8)) {
      const status = suggestion.safeToClaim ? 'safe' : `blocked:${suggestion.conflictCount || 0}`;
      console.log(`- ${status} · ${suggestion.label || suggestion.id || '-'} · ${suggestion.owner || suggestion.agent || '-'} / ${suggestion.lane || '-'}`);
      console.log(`  scope=${compact(suggestion.scope || suggestion.key || '-', 220)}`);
      if (suggestion.task) console.log(`  task=${compact(suggestion.task, 220)}`);
      if (suggestion.reason) console.log(`  why=${compact(suggestion.reason, 220)}`);
      if (suggestion.claimCommand) console.log(`  claim=${suggestion.claimCommand}`);
      if (Array.isArray(suggestion.validation) && suggestion.validation.length) {
        console.log(`  verify=${suggestion.validation.slice(0, 3).join(' && ')}`);
      }
    }
  }
}

async function showCollaborationClaims() {
  const result = await request('/api/collaboration?limit=20');
  console.log('');
  printCollaborationClaims(result.collaboration || {});
}

async function showCollaborationHandoff() {
  const result = await request('/api/collaboration/handoff?limit=20');
  console.log('');
  printCollaborationHandoff(result);
}

async function showCollaborationSuggestions(options = {}) {
  const params = new URLSearchParams();
  params.set('limit', options.limit || '8');
  if (options.query) params.set('query', options.query);
  if (options.agent) params.set('agent', options.agent);
  const result = await request(`/api/collaboration/suggestions?${params.toString()}`);
  console.log('');
  printCollaborationHandoff({ handoff: { suggestedScopes: result.suggestions || [] } });
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

function printBrowserReadiness(result) {
  const readiness = result?.readiness || result || {};
  const context = readiness.context || {};
  const target = readiness.defaultTarget || {};
  const cdp = readiness.bridges?.cdp || {};
  const javascript = readiness.bridges?.javascript || {};
  const capabilities = readiness.capabilities || {};
  const nextActions = Array.isArray(readiness.nextActions) ? readiness.nextActions : [];
  const commands = readiness.commands || {};
  const safety = readiness.safety || {};
  console.log('JAVIS Browser Readiness');
  console.log('=======================');
  console.log(`Status: ${readiness.status || '-'} · ${readiness.label || '-'}`);
  if (readiness.summary) console.log(`Summary: ${compact(readiness.summary, 360)}`);
  console.log(`Default target: ${target.mode || '-'} · app=${target.app || '-'} · source=${target.source || '-'} · asks window=${target.asksWhichWindow ? 'yes' : 'no'}`);
  if (target.summary) console.log(`Target: ${compact(target.summary, 260)}`);
  console.log(`Context: ${context.available ? 'available' : 'unavailable'} · supported=${context.supported ? 'yes' : 'no'} · ${context.app || '-'}${context.title ? ` · ${compact(context.title, 120)}` : ''}`);
  if (context.url) console.log(`URL: ${compact(context.url, 220)}`);
  if (context.error) console.log(`Context error: ${compact(context.error, 220)}`);
  console.log(`Bridge: cdp=${cdp.enabled ? 'ready' : 'not-ready'} · port=${cdp.port ?? '-'} · targets=${cdp.targets ?? 0} · js=${javascript.status || '-'}`);
  if (cdp.error) console.log(`CDP: ${compact(cdp.error, 180)}`);
  console.log('\nCapabilities');
  for (const [name, item] of Object.entries(capabilities)) {
    console.log(`- ${name}: ${item?.status || '-'} · ${item?.endpoint || '-'}`);
  }
  if (nextActions.length) {
    console.log('\nNext actions');
    for (const [index, action] of nextActions.slice(0, 6).entries()) {
      const command = action.command ? ` · ${action.command}` : '';
      const endpoint = action.endpoint ? ` · ${action.endpoint}` : '';
      console.log(`${index + 1}. ${action.label || action.id || '-'}${endpoint}${command}`);
      if (action.summary) console.log(`   ${compact(action.summary, 240)}`);
    }
  }
  console.log('\nCommands');
  console.log(`- readiness: ${commands.readiness || 'npm run browser:ready'}`);
  console.log(`- page: ${commands.page || 'curl http://127.0.0.1:3417/api/browser/page'}`);
  console.log(`- DOM: ${commands.dom || 'curl "http://127.0.0.1:3417/api/browser/dom?limit=20"'}`);
  console.log(`- benchmarks: ${commands.benchmarks || 'npm run config -- --print-browser-benchmarks'}`);
  console.log('\nSafety');
  console.log(`- read-only=${safety.readOnly ? 'yes' : 'no'} starts browser=${safety.startsBrowser ? 'yes' : 'no'} executes actions=${safety.executesBrowserActions ? 'yes' : 'no'} executes JS=${safety.executesPageJavaScript ? 'yes' : 'no'} reads page text=${safety.readsPageText ? 'yes' : 'no'} asks window=${safety.asksWhichWindow ? 'yes' : 'no'}`);
}

async function showBrowserReadiness() {
  const result = await request('/api/browser/readiness');
  console.log('');
  printBrowserReadiness(result);
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
  console.log(`Safety: no browser actions=${safety.noBrowserActions ? 'yes' : 'no'} · no model calls=${safety.noModelCalls ? 'yes' : 'no'} · DOM reobserve=${safety.domReobserveBeforeAction ? 'yes' : 'no'} · no form submit=${safety.noFormSubmitByDefault ? 'yes' : 'no'} · submit execute gate=${safety.domSubmitExecuteGate ? 'yes' : 'no'} · confirmed fixture gate=${safety.domConfirmFixtureNoExecute ? 'yes' : 'no'} · sensitive fields blocked=${safety.sensitiveFieldsBlocked ? 'yes' : 'no'}`);
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

function printMcpServers(result) {
  const mcp = result?.mcp || result || {};
  const counts = mcp.counts || {};
  const safety = mcp.safety || {};
  console.log('MCP Server Discovery');
  console.log('====================');
  console.log(mcp.summary || 'No MCP discovery summary available.');
  console.log(`Counts: servers ${counts.servers || 0} · enabled ${counts.enabled || 0} · stdio ${counts.stdio || 0} · remote ${counts.remote || 0} · files ${counts.filesFound || 0}/${counts.filesChecked || 0} · invalid ${counts.invalidFiles || 0}`);
  console.log(`Safety: read-only=${safety.readOnly ? 'yes' : 'no'} · starts servers=${safety.startsServers ? 'yes' : 'no'} · commands executed=${safety.commandsExecuted ? 'yes' : 'no'} · env values redacted=${safety.envValuesRedacted ? 'yes' : 'no'} · URL queries redacted=${safety.urlQueriesRedacted ? 'yes' : 'no'}`);
  const files = Array.isArray(mcp.files) ? mcp.files : [];
  if (files.length) {
    console.log('\nConfig files:');
    for (const file of files) {
      const status = file.exists ? file.valid ? 'valid' : 'invalid' : 'missing';
      const error = file.error ? ` · ${compact(file.error, 160)}` : '';
      console.log(`- ${file.label || file.id || '-'} · ${status} · ${file.serverCount || 0} server(s) · ${file.path || '-'}${error}`);
    }
  }
  const servers = Array.isArray(mcp.servers) ? mcp.servers : [];
  if (!servers.length) {
    console.log('\nServers: none');
    if (mcp.nextAction) console.log(`\nNext: ${mcp.nextAction}`);
    return;
  }
  console.log('\nServers:');
  for (const server of servers) {
    const target = server.command ? `cmd=${server.command}` : server.urlHost ? `host=${server.urlHost}` : 'target=-';
    const env = Array.isArray(server.envKeys) && server.envKeys.length ? ` · env keys=${server.envKeys.join(', ')}` : '';
    console.log(`- ${server.enabled ? 'on' : 'off'} ${server.name || '-'} · ${server.transport || 'unknown'} · ${server.risk || 'unknown'} · ${target} · source=${server.sourceLabel || server.sourceId || '-'}${env}`);
  }
  if (mcp.nextAction) console.log(`\nNext: ${mcp.nextAction}`);
}

async function showMcpServers() {
  const result = await request('/api/mcp/servers?source=cui_mcp_servers');
  console.log('');
  printMcpServers(result);
}

function printMcpWorkflow(result) {
  const workflow = result?.mcpWorkflow || result || {};
  const counts = workflow.counts || {};
  const safety = workflow.safety || {};
  console.log('MCP Workflow Preview');
  console.log('====================');
  console.log(workflow.summary || 'No MCP workflow preview summary available.');
  console.log(`Status: ${workflow.status || 'unknown'} · intent=${workflow.intent || '-'} · candidates=${counts.candidates || 0} · servers=${counts.servers || 0}`);
  console.log(`Safety: preview-only=${safety.previewOnly ? 'yes' : 'no'} · starts servers=${safety.startsServers ? 'yes' : 'no'} · commands executed=${safety.commandsExecuted ? 'yes' : 'no'} · calls MCP tools=${safety.callsMcpTools ? 'yes' : 'no'} · schema-start-after-approval=${safety.approvalMayStartServerForToolsList ? 'yes' : 'no'} · env values redacted=${safety.envValuesRedacted ? 'yes' : 'no'} · confirmation required=${safety.requiresConfirmationForExecution ? 'yes' : 'no'}`);
  if (workflow.task) console.log(`Task: ${compact(workflow.task, 220)}`);
  const selected = workflow.selectedServer || null;
  if (selected) {
    const target = selected.command ? `cmd=${selected.command}` : selected.urlHost ? `host=${selected.urlHost}` : 'target=-';
    console.log(`\nSelected: ${selected.name || '-'} · ${selected.transport || 'unknown'} · ${selected.risk || 'unknown'} · ${target}`);
  }
  if (workflow.approval) {
    console.log(`\nApproval: ${workflow.approval.id || '-'} · ${workflow.approval.status || '-'} · ${workflow.approval.summary || '-'}`);
  }
  const candidates = Array.isArray(workflow.candidates) ? workflow.candidates : [];
  if (candidates.length) {
    console.log('\nCandidates:');
    for (const candidate of candidates) {
      const target = candidate.command ? `cmd=${candidate.command}` : candidate.urlHost ? `host=${candidate.urlHost}` : 'target=-';
      const terms = Array.isArray(candidate.matchedTerms) && candidate.matchedTerms.length ? ` · match=${candidate.matchedTerms.join(', ')}` : '';
      console.log(`- ${candidate.enabled ? 'on' : 'off'} ${candidate.name || '-'} · score=${candidate.score || 0} · ${candidate.transport || 'unknown'} · ${target}${terms}`);
    }
  }
  const steps = Array.isArray(workflow.actionPlan) ? workflow.actionPlan : [];
  if (steps.length) {
    console.log('\nPlan:');
    for (const step of steps) {
      console.log(`- ${step.id || '-'} · ${step.status || '-'} · ${compact(step.output || step.label || '', 180)}`);
    }
  }
  if (workflow.nextAction) console.log(`\nNext: ${workflow.nextAction}`);
}

async function showMcpWorkflow(options = {}) {
  const task = options.task || argvValue('--task', '') || argvValue('--query', '') || 'Choose an MCP server for this task without executing.';
  const serverName = options.serverName || argvValue('--server', '') || argvValue('--server-name', '');
  const toolName = options.toolName || argvValue('--tool', '') || argvValue('--tool-name', '');
  const sourceId = options.sourceId || argvValue('--source-id', '') || argvValue('--mcp-source-id', '');
  const requestApproval = options.requestApproval === true || process.argv.includes('--request-approval');
  const result = await request('/api/mcp/workflow', {
    method: 'POST',
    body: {
      source: 'cui_mcp_workflow',
      task,
      serverName,
      toolName,
      sourceId,
      execute: requestApproval,
      requestApproval,
    },
  });
  console.log('');
  printMcpWorkflow(result);
}

function printMcpToolCall(result) {
  const call = result?.mcpToolCall || result || {};
  const counts = call.counts || {};
  const safety = call.safety || {};
  const requested = call.requested || {};
  console.log('MCP Tool Call Preview');
  console.log('=====================');
  console.log(call.summary || 'No MCP tool-call preview summary available.');
  console.log(`Status: ${call.status || 'unknown'} · candidates=${counts.candidates || 0} · servers=${counts.servers || 0}`);
  console.log(`Safety: preview-only=${safety.previewOnly ? 'yes' : 'no'} · starts servers=${safety.startsServers ? 'yes' : 'no'} · calls MCP tools=${safety.callsMcpTools ? 'yes' : 'no'} · approval calls tool=${safety.approvalCallsMcpTools ? 'yes' : 'no'} · result sanitized=${safety.toolResultSanitized ? 'yes' : 'no'} · confirmation required=${safety.requiresConfirmationForExecution ? 'yes' : 'no'}`);
  if (call.task) console.log(`Task: ${compact(call.task, 220)}`);
  console.log(`Arguments: keys=${Array.isArray(requested.argumentKeys) ? requested.argumentKeys.join(', ') || '-' : '-'} · bytes=${requested.argumentBytes || 0}`);
  const selected = call.selectedServer || null;
  if (selected) {
    const target = selected.command ? `cmd=${selected.command}` : selected.urlHost ? `host=${selected.urlHost}` : 'target=-';
    console.log(`\nSelected: ${selected.name || '-'} · ${selected.transport || 'unknown'} · ${selected.risk || 'unknown'} · ${target}`);
  }
  if (call.approval) {
    console.log(`\nApproval: ${call.approval.id || '-'} · ${call.approval.status || '-'} · ${call.approval.summary || '-'}`);
  }
  const steps = Array.isArray(call.actionPlan) ? call.actionPlan : [];
  if (steps.length) {
    console.log('\nPlan:');
    for (const step of steps) {
      console.log(`- ${step.id || '-'} · ${step.status || '-'} · ${compact(step.output || step.label || '', 180)}`);
    }
  }
  if (call.nextAction) console.log(`\nNext: ${call.nextAction}`);
}

async function showMcpToolCall(options = {}) {
  const task = options.task || argvValue('--task', '') || argvValue('--query', '') || 'Preview an MCP tool call without executing.';
  const serverName = options.serverName || argvValue('--server', '') || argvValue('--server-name', '');
  const toolName = options.toolName || argvValue('--tool', '') || argvValue('--tool-name', '');
  const sourceId = options.sourceId || argvValue('--source-id', '') || argvValue('--mcp-source-id', '');
  const argumentText = options.arguments || argvValue('--arguments', '') || argvValue('--args', '') || '{}';
  const requestApproval = options.requestApproval === true || process.argv.includes('--request-approval');
  const result = await request('/api/mcp/tool-call', {
    method: 'POST',
    body: {
      source: 'cui_mcp_tool_call',
      task,
      serverName,
      toolName,
      sourceId,
      toolArguments: argumentText,
      execute: requestApproval,
      requestApproval,
    },
  });
  console.log('');
  printMcpToolCall(result);
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
  const presets = result?.presets || {};
  const presetItems = Array.isArray(presets.presets) ? presets.presets : [];
  if (presetItems.length) {
    console.log('\nPresets:');
    for (const preset of presetItems.slice(0, 8)) {
      console.log(`- ${preset.id} · ${preset.applied ? 'applied' : 'available'} · rules ${preset.appliedCount || 0}/${preset.ruleCount || 0}${preset.recommended ? ' · recommended' : ''}`);
      if (preset.description) console.log(`  ${compact(preset.description, 180)}`);
    }
  }
  const regionPresets = result?.regionPresets || {};
  const regionPresetItems = Array.isArray(regionPresets.presets) ? regionPresets.presets : [];
  if (regionPresetItems.length) {
    console.log('\nRegion presets:');
    for (const preset of regionPresetItems.slice(0, 8)) {
      const region = preset.region || {};
      console.log(`- ${preset.id} · ${preset.applied ? 'applied' : 'available'} · ${region.x},${region.y} ${region.width}x${region.height} ${region.unit || 'percent'}`);
      if (preset.description) console.log(`  ${compact(preset.description, 180)}`);
    }
  }
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

function printScreenRegionPresets(regionPresets) {
  const presets = Array.isArray(regionPresets?.presets) ? regionPresets.presets : [];
  console.log('Screen Region Presets');
  console.log('=====================');
  if (!presets.length) {
    console.log('No region presets available.');
    return;
  }
  presets.forEach((preset, index) => {
    const region = preset.region || {};
    console.log(`${index + 1}. ${preset.id} · ${preset.applied ? 'applied' : 'available'} · ${region.x},${region.y} ${region.width}x${region.height} ${region.unit || 'percent'}`);
    if (preset.description) console.log(`   ${compact(preset.description, 180)}`);
  });
}

async function showScreenRegionPresets() {
  const result = await request('/api/screen/privacy/region-presets');
  console.log('');
  printScreenRegionPresets(result.regionPresets || result);
}

function printScreenPrivacyPresetPreview(preview) {
  const preset = preview?.preset || {};
  const counts = preview?.counts || {};
  console.log(`${preset.label || preset.id || 'Screen privacy preset'}: ${preset.ruleCount || counts.presetRules || 0} rule(s).`);
  console.log(`Existing: ${counts.existing || 0} · would add ${counts.wouldAdd || 0} · update ${counts.wouldUpdate || 0} · next enabled ${counts.nextEnabled || 0}`);
  if (preset.description) console.log(compact(preset.description, 220));
  if (preview?.samples?.appPasswordManager?.blocked && preview?.samples?.browserLogin?.blocked && preview?.samples?.safeFinder?.allowed) {
    console.log('Sample checks: password/account contexts blocked; normal Finder context allowed.');
  }
}

async function applyRecommendedScreenPrivacy(rl, options = {}) {
  const previewResult = await request('/api/screen/privacy/presets/sensitive_defaults');
  const preview = previewResult.preview || previewResult;
  console.log('');
  printScreenPrivacyPresetPreview(preview);
  if (options.dryRun) return;
  if (rl) {
    const answer = (await rl.question('Type APPLY to save this preset: ')).trim();
    if (answer !== 'APPLY') {
      console.log('\nNo change made.');
      return;
    }
  }
  const result = await request('/api/screen/privacy/presets/sensitive_defaults/apply', {
    method: 'POST',
    body: { source: 'cui' },
  });
  console.log(`\n${result.output || 'Applied screen privacy preset.'}`);
}

async function addScreenRegionMask(rl, options = {}) {
  const listResult = await request('/api/screen/privacy/region-presets');
  const regionPresets = listResult.regionPresets || listResult;
  const presets = Array.isArray(regionPresets.presets) ? regionPresets.presets : [];
  console.log('');
  printScreenRegionPresets(regionPresets);

  let selectedId = options.preset || '';
  if (!selectedId && rl) {
    const answer = (await rl.question(`Choose preset [1-${presets.length}] or type custom: `)).trim().toLowerCase();
    if (answer === 'custom') {
      const x = Number((await rl.question('x percent [0-100]: ')).trim());
      const y = Number((await rl.question('y percent [0-100]: ')).trim());
      const width = Number((await rl.question('width percent [1-100]: ')).trim());
      const height = Number((await rl.question('height percent [1-100]: ')).trim());
      const label = (await rl.question('Label [Custom screen mask]: ')).trim() || 'Custom screen mask';
      const result = await request('/api/screen/privacy/rules', {
        method: 'POST',
        body: {
          source: 'cui',
          id: `custom_region_${Date.now().toString(36)}`,
          kind: 'region',
          effect: 'blur',
          label,
          region: { unit: 'percent', x, y, width, height },
        },
      });
      console.log(`\nAdded ${result.rule?.label || label}.`);
      return;
    }
    const selected = presets[Number(answer) - 1] || presets.find((preset) => preset.id === answer);
    selectedId = selected?.id || '';
  }

  if (!selectedId) {
    console.log('\nNo region mask selected.');
    return;
  }
  const preview = await request(`/api/screen/privacy/region-presets/${encodeURIComponent(selectedId)}`);
  const preset = preview.preview?.preset || {};
  const counts = preview.preview?.counts || {};
  console.log(`\n${preset.label || selectedId}: would add ${counts.wouldAdd || 0}, update ${counts.wouldUpdate || 0}.`);
  if (rl) {
    const answer = (await rl.question('Type APPLY to save this region mask: ')).trim();
    if (answer !== 'APPLY') {
      console.log('\nNo change made.');
      return;
    }
  }
  const result = await request(`/api/screen/privacy/region-presets/${encodeURIComponent(selectedId)}/apply`, {
    method: 'POST',
    body: { source: 'cui' },
  });
  console.log(`\n${result.output || 'Applied screen region mask.'}`);
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
  const workNextTools = evidence.workNextTools || {};
  const workNextEvents = Array.isArray(workNextTools.recent) ? workNextTools.recent : [];
  const delegateTools = evidence.delegateTools || {};
  const delegateEvents = Array.isArray(delegateTools.recent) ? delegateTools.recent : [];
  const approvalTools = evidence.approvalTools || {};
  const approvalEvents = Array.isArray(approvalTools.recent) ? approvalTools.recent : [];
  const autopilotTools = evidence.autopilotTools || {};
  const autopilotEvents = Array.isArray(autopilotTools.recent) ? autopilotTools.recent : [];
  const attentionTools = evidence.attentionTools || {};
  const attentionEvents = Array.isArray(attentionTools.recent) ? attentionTools.recent : [];
  const perceptionTools = evidence.perceptionTools || {};
  const perceptionEvents = Array.isArray(perceptionTools.recent) ? perceptionTools.recent : [];
  const capabilityTools = evidence.capabilityTools || {};
  const capabilityEvents = Array.isArray(capabilityTools.recent) ? capabilityTools.recent : [];
  const mcpTools = evidence.mcpTools || {};
  const mcpEvents = Array.isArray(mcpTools.recent) ? mcpTools.recent : [];
  const collaborationTools = evidence.collaborationTools || {};
  const collaborationEvents = Array.isArray(collaborationTools.recent) ? collaborationTools.recent : [];
  const learningTools = evidence.learningTools || {};
  const learningEvents = Array.isArray(learningTools.recent) ? learningTools.recent : [];
  const browserTools = evidence.browserTools || {};
  const browserEvents = Array.isArray(browserTools.recent) ? browserTools.recent : [];
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
  console.log('\nWork next tool:');
  console.log(`- observed ${Number(workNextTools.count || 0)} recent event(s) · preview=${workNextTools.hasPreview ? 'yes' : 'no'} · run=${workNextTools.hasRun ? 'yes' : 'no'} · safe-preview=${workNextTools.safePreview ? 'yes' : 'no'}`);
  console.log(`- route recovery=${workNextTools.hasRouteRecovery ? 'yes' : 'no'} · browser fill handoff=${workNextTools.hasBrowserFillHandoff ? 'yes' : 'no'} · prepared=${Number(workNextTools.browserFillSafePreparedCount || 0)} · blocked=${Number(workNextTools.browserFillBlockedCount || 0)}`);
  console.log(`- next ${compact(workNextTools.nextAction || dogfood.workNextTools?.nextAction || 'Ask live voice to preview the single next work step.', 220)}`);
  for (const event of workNextEvents.slice(0, 4)) {
    const workNext = event.workNext || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      workNext.action || event.name || '-',
      workNext.readOnlyPreview ? 'read-only' : '',
      workNext.executed ? 'executed' : 'not-executed',
      workNext.actionSource ? `source=${workNext.actionSource}` : '',
      workNext.routeRecoveryType ? `recovery=${workNext.routeRecoveryType}` : '',
      workNext.browserFillHandoff ? `fill=${Number(workNext.browserFillSafePreparedCount || 0)}/${Number(workNext.browserFillBlockedCount || 0)}` : '',
    ].filter(Boolean);
    const summary = workNext.output ? ` · ${compact(workNext.output, 140)}` : '';
    console.log(`- ${event.name || 'get_work_next'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nDelegation tools:');
  console.log(`- observed ${Number(delegateTools.count || 0)} recent event(s) · preview=${delegateTools.hasPreview ? 'yes' : 'no'} · confirm-gate=${delegateTools.hasConfirmationGate ? 'yes' : 'no'} · queued=${delegateTools.hasQueued ? 'yes' : 'no'} · serialized=${delegateTools.hasSerialized ? 'yes' : 'no'} · safe-preview=${delegateTools.safePreview ? 'yes' : 'no'}`);
  console.log(`- policy=${delegateTools.policyGated ? 'yes' : 'pending'} · starts=${Number(delegateTools.startsWorkerCount || 0)} · conflicts=${Number(delegateTools.conflictCount || 0)} · worker-may-write=${delegateTools.workerMayMutateFiles ? 'yes' : 'no'}`);
  console.log(`- next ${compact(delegateTools.nextAction || dogfood.delegateTools?.nextAction || 'Ask live voice to preview a scoped Codex/Claude/background worker delegation before confirming execution.', 220)}`);
  for (const event of delegateEvents.slice(0, 4)) {
    const delegate = event.delegate || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      delegate.status ? `status=${delegate.status}` : '',
      delegate.mode ? `mode=${delegate.mode}` : '',
      delegate.owner ? `owner=${delegate.owner}` : '',
      delegate.scope ? `scope=${compact(delegate.scope, 80)}` : '',
      delegate.access ? `access=${delegate.access}` : '',
      delegate.previewOnly ? 'preview' : '',
      delegate.requiresConfirmation ? 'confirmation' : '',
      delegate.confirm ? 'confirmed' : '',
      delegate.queued ? 'queued' : '',
      delegate.serialized ? 'serialized' : '',
      delegate.jobId ? `job=${compact(delegate.jobId, 10)}` : '',
    ].filter(Boolean);
    const summary = delegate.spokenSummary ? ` · ${compact(delegate.spokenSummary, 160)}` : '';
    console.log(`- ${event.name || 'delegate_task'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nApproval tools:');
  console.log(`- observed ${Number(approvalTools.count || 0)} recent event(s) · list=${approvalTools.hasList ? 'yes' : 'no'} · confirm gate=${approvalTools.hasConfirmationGate ? 'yes' : 'no'} · reject=${approvalTools.hasReject ? 'yes' : 'no'} · approve=${approvalTools.hasApprove ? 'yes' : 'no'}`);
  console.log(`- pending=${Number(approvalTools.pendingCount || 0)} · privacy=${approvalTools.privacySafe ? 'safe' : 'pending'} · next ${compact(approvalTools.nextAction || dogfood.approvalTools?.nextAction || 'Ask live voice which approvals are pending, then resolve one exact id only after confirmation.', 220)}`);
  for (const event of approvalEvents.slice(0, 4)) {
    const approval = event.approval || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      approval.action || event.name || '-',
      approval.approvalId || approval.selectedId ? `id=${approval.approvalId || approval.selectedId}` : '',
      approval.approvalStatus ? `status=${approval.approvalStatus}` : approval.status ? `status=${approval.status}` : '',
      approval.requiresConfirmation ? 'confirmation' : '',
      approval.rawContentRedacted === false ? 'raw-visible' : 'redacted',
    ].filter(Boolean);
    const summary = approval.approvalSummary || approval.firstPendingSummary ? ` · ${compact(approval.approvalSummary || approval.firstPendingSummary, 140)}` : '';
    console.log(`- ${event.name || 'approval_tool'} · ${bits.join(' · ')}${summary}`);
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
  console.log('\nLocal capability tool:');
  console.log(`- observed ${Number(capabilityTools.count || 0)} recent event(s) · called=${capabilityTools.hasCapabilityMap ? 'yes' : 'no'}`);
  console.log(`- local state=${capabilityTools.hasLocalExecutionState ? 'yes' : 'no'} · recommended tools=${capabilityTools.hasRecommendedTools ? 'yes' : 'no'}`);
  console.log(`- next ${compact(capabilityTools.nextAction || dogfood.capabilityTools?.nextAction || 'Ask live voice what JAVIS can do and which local tool should handle this task.', 220)}`);
  for (const event of capabilityEvents.slice(0, 4)) {
    const capability = event.capability || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      capability.controlMode ? `mode=${capability.controlMode}` : '',
      capability.localExecutionEnabled ? 'local-exec' : 'local-exec-off',
      capability.matchedCount ? `matched=${capability.matchedCount}` : '',
      capability.readyCount ? `ready=${capability.readyCount}` : '',
      capability.recommendedTools?.length ? `tools=${capability.recommendedTools.slice(0, 4).join(',')}` : '',
    ].filter(Boolean);
    const summary = capability.spokenSummary ? ` · ${compact(capability.spokenSummary, 180)}` : '';
    console.log(`- ${event.name || 'get_local_capabilities'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nMCP discovery tool:');
  console.log(`- observed ${Number(mcpTools.count || 0)} recent event(s) · discovery=${mcpTools.hasDiscovery ? 'yes' : 'no'} · servers=${mcpTools.hasServers ? 'yes' : 'no'} · privacy=${mcpTools.privacySafe ? 'safe' : 'pending'}`);
  console.log(`- next ${compact(mcpTools.nextAction || dogfood.mcpTools?.nextAction || 'Ask live voice which MCP servers are configured locally.', 220)}`);
  for (const event of mcpEvents.slice(0, 4)) {
    const mcp = event.mcp || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      `servers=${Number(mcp.serverCount || 0)}`,
      `files=${Number(mcp.filesFound || 0)}`,
      mcp.readOnly ? 'read-only' : '',
      mcp.envValuesRedacted ? 'env-redacted' : '',
      mcp.startsServers ? 'starts-servers' : 'no-start',
      mcp.commandsExecuted ? 'cmd-executed' : 'no-cmd',
    ].filter(Boolean);
    const names = Array.isArray(mcp.serverNames) && mcp.serverNames.length ? ` · names=${mcp.serverNames.slice(0, 4).join(',')}` : '';
    console.log(`- ${event.name || 'get_mcp_servers'} · ${bits.join(' · ')}${names}`);
  }
  console.log('\nCollaboration tools:');
  console.log(`- observed ${Number(collaborationTools.count || 0)} recent event(s) · actions ${(collaborationTools.observedActions || []).join(', ') || '-'}`);
  console.log(`- state=${collaborationTools.hasState ? 'yes' : 'no'} · preview=${collaborationTools.hasClaimPreview ? 'yes' : 'no'} · create=${collaborationTools.hasClaimCreate ? 'yes' : 'no'} · heartbeat=${collaborationTools.hasHeartbeat ? 'yes' : 'no'} · release=${collaborationTools.hasRelease ? 'yes' : 'no'}`);
  console.log(`- confirm gate=${collaborationTools.hasConfirmationGate ? 'yes' : 'no'} · safe=${collaborationTools.safeControl ? 'yes' : 'pending'} · conflicts=${Number(collaborationTools.conflictCount || 0)} · active=${Number(collaborationTools.activeCount || 0)}`);
  console.log(`- next ${compact(collaborationTools.nextAction || dogfood.collaborationTools?.nextAction || 'Ask live voice to preview and confirm a scoped Claude Code/Codex collaboration claim.', 220)}`);
  for (const event of collaborationEvents.slice(0, 4)) {
    const collaboration = event.collaboration || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      collaboration.action || event.name || '-',
      collaboration.previewOnly ? 'preview' : '',
      collaboration.executed ? 'executed' : '',
      collaboration.requiresConfirmation ? 'confirmation' : '',
      collaboration.confirm ? 'confirmed' : '',
      collaboration.owner ? `owner=${collaboration.owner}` : '',
      collaboration.scope ? `scope=${compact(collaboration.scope, 80)}` : '',
      collaboration.conflictCount ? `conflicts=${collaboration.conflictCount}` : '',
    ].filter(Boolean);
    const summary = collaboration.spokenSummary ? ` · ${compact(collaboration.spokenSummary, 160)}` : '';
    console.log(`- ${event.name || 'collaboration_tool'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nLocal learning tool:');
  console.log(`- observed ${Number(learningTools.count || 0)} recent event(s) · profile=${learningTools.hasLearningProfile ? 'yes' : 'no'} · evolution=${learningTools.hasLearningEvolution ? 'yes' : 'no'} · privacy=${learningTools.privacySafe ? 'safe' : 'pending'}`);
  console.log(`- source events=${learningTools.hasSourceEvents ? 'yes' : 'no'} · signals=${learningTools.hasSignals ? 'yes' : 'no'} · changes=${learningTools.hasChanges ? 'yes' : 'no'}`);
  console.log(`- next ${compact(learningTools.nextAction || dogfood.learningTools?.nextAction || 'Ask live voice what local habits JAVIS has inferred and what changed recently.', 220)}`);
  for (const event of learningEvents.slice(0, 4)) {
    const learning = event.learning || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      learning.action || event.name || '-',
      learning.enabled ? 'enabled' : learning.paused ? 'paused' : 'off',
      learning.includeInPrompts ? 'prompt-on' : 'prompt-off',
      `events=${Number(learning.sourceEventCount || 0)}`,
      learning.signalCount ? `signals=${learning.signalCount}` : '',
      learning.changeCount ? `changes=${learning.changeCount}` : '',
      learning.hasEvolution ? 'evolution' : '',
      learning.localOnly ? 'local-only' : '',
      learning.noRawScreenshots ? 'no-raw-screen' : '',
    ].filter(Boolean);
    const summary = learning.spokenSummary ? ` · ${compact(learning.spokenSummary, 180)}` : '';
    console.log(`- ${event.name || 'learning_tool'} · ${bits.join(' · ')}${summary}`);
  }
  console.log('\nBrowser tools:');
  console.log(`- observed ${Number(browserTools.count || 0)} recent event(s) · actions ${(browserTools.observedActions || []).join(', ') || '-'}`);
  console.log(`- gates page-read=${browserTools.hasPageRead ? 'yes' : 'no'} · dom-read=${browserTools.hasDomRead ? 'yes' : 'no'} · workflow=${browserTools.hasWorkflow ? 'yes' : 'no'} · safe-preview=${browserTools.hasSafeWorkflowPreview ? 'yes' : 'no'}`);
  console.log(`- next ${compact(browserTools.nextAction || dogfood.browserTools?.nextAction || 'Ask live voice to inspect the current browser page safely.', 220)}`);
  for (const event of browserEvents.slice(0, 4)) {
    const browser = event.browser || {};
    const bits = [
      event.ok ? 'ok' : 'fail',
      event.source || '-',
      browser.action || event.name || '-',
      browser.intent ? `intent=${browser.intent}` : '',
      browser.mode ? `mode=${browser.mode}` : '',
      browser.previewOnly ? 'preview-only' : '',
      browser.safePreview ? 'safe-preview' : '',
      browser.confirmationRequired ? 'confirmation' : '',
      browser.host ? `host=${browser.host}` : '',
      browser.linkCount ? `links=${browser.linkCount}` : '',
      browser.controlCount ? `controls=${browser.controlCount}` : '',
      browser.workflowId ? `workflow=${compact(browser.workflowId, 10)}` : '',
    ].filter(Boolean);
    const summary = browser.output ? ` · ${compact(browser.output, 160)}` : '';
    console.log(`- ${event.name || 'browser_tool'} · ${bits.join(' · ')}${summary}`);
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
      const browser = event.browser?.action ? ` · browser=${event.browser.action}` : '';
      const workNext = event.workNext?.action ? ` · workNext=${event.workNext.action}` : '';
      const delegate = event.delegate?.status ? ` · delegate=${event.delegate.status}` : '';
      const collaboration = event.collaboration?.action ? ` · collaboration=${event.collaboration.action}` : '';
      console.log(`- ${event.name || '-'} · ${event.ok ? 'ok' : 'fail'} · ${event.source || '-'} · ${Math.round(Number(event.durationMs || 0))}ms · ${resultShape.outputType || 'output'}:${resultShape.outputBytes || 0}B${shortcut}${browser}${workNext}${delegate}${collaboration}`);
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
  const preflight = result?.preflight || state.preflight || {};
  console.log('JAVIS Renderer Realtime Dogfood');
  console.log('===============================');
  console.log(`Run: ${state.runId || result?.runId || '-'}`);
  console.log(`Status: ${state.status || (result?.executed ? 'dispatched' : 'preview')} · renderer=${result?.rendererAvailable ?? state.rendererAvailable ? 'ready' : 'unknown'} · starts microphone=${result?.startsMicrophone || state.startsMicrophone ? 'yes' : 'no'}`);
  if (preflight.status) {
    console.log(`Preflight: ${preflight.status} · ready=${preflight.readyToStart ? 'yes' : 'no'} · provider=${preflight.providerReady ? 'ready' : 'not-ready'} · confirmMic=${preflight.requiresMicConfirmation ? 'required' : 'no'}`);
    if (preflight.nextPrompt?.copyText) console.log(`Next prompt: ${compact(preflight.nextPrompt.copyText, 220)}`);
    if (Array.isArray(preflight.blockers) && preflight.blockers.length) {
      console.log('Blockers:');
      for (const blocker of preflight.blockers.slice(0, 3)) {
        console.log(`- ${blocker.label || blocker.id}: ${compact(blocker.nextAction || blocker.detail || '', 220)}`);
      }
    }
    if (preflight.commands?.scriptExecute) console.log(`Command: ${preflight.commands.scriptExecute}`);
  }
  if (result?.output) console.log(`\n${compact(result.output, 1200)}`);
  const events = Array.isArray(state.events) ? state.events : [];
  if (events.length) {
    console.log('\nRecent events:');
    for (const event of events.slice(-8)) {
      console.log(`- ${event.createdAtIso || event.createdAt || '-'} · ${event.type || '-'} · ${event.status || '-'}${event.prompt ? ` · ${compact(event.prompt, 120)}` : ''}${event.detail ? ` · ${compact(event.detail, 160)}` : ''}`);
    }
  }
}

function printRealtimeProviderProbe(result) {
  const probe = result?.probe || result?.providerProbe || result || {};
  const providerResult = probe.result || result?.result || {};
  console.log('JAVIS Realtime Provider Probe');
  console.log('=============================');
  console.log(`Run: ${probe.runId || result?.runId || providerResult.runId || '-'}`);
  console.log(`Status: ${probe.status || (result?.executed ? 'dispatched' : 'preview')} · renderer=${probe.rendererAvailable ? 'ready' : 'unknown'} · key=${probe.hasOpenAiKey ? 'present' : 'missing'} · starts microphone=${probe.startsMicrophone ? 'yes' : 'no'}`);
  console.log(`Provider: ${probe.providerReady ? 'ready' : 'not-ready'}${providerResult.statusCode ? ` · HTTP ${providerResult.statusCode}` : ''}${providerResult.durationMs ? ` · ${providerResult.durationMs}ms` : ''}`);
  if (probe.summary) console.log(`Summary: ${compact(probe.summary, 300)}`);
  if (probe.next) console.log(`Next: ${compact(probe.next, 300)}`);
  if (providerResult.error) console.log(`Error: ${compact(providerResult.error, 360)}`);
  if (result?.output) console.log(`\n${compact(result.output, 1200)}`);
  const events = Array.isArray(probe.events) ? probe.events : [];
  if (events.length) {
    console.log('\nRecent probe events:');
    for (const event of events.slice(-8)) {
      console.log(`- ${event.createdAtIso || event.createdAt || '-'} · ${event.type || '-'} · ${event.status || '-'}${event.detail ? ` · ${compact(event.detail, 180)}` : ''}`);
    }
  }
}

function printRealtimeProviderRecovery(result) {
  const recovery = result?.recovery || result || {};
  const health = result?.voiceHealth || {};
  const steps = Array.isArray(recovery.steps) ? recovery.steps : [];
  console.log('JAVIS Realtime Provider Recovery');
  console.log('================================');
  console.log(`Status: ${health.status || recovery.status || '-'} · kind=${health.kind || recovery.kind || '-'} · active=${recovery.active ? 'yes' : 'no'}`);
  if (health.summary || recovery.summary) console.log(`Summary: ${compact(health.summary || recovery.summary, 320)}`);
  if (recovery.subscriptionBoundary) console.log(`Billing: ${compact(recovery.subscriptionBoundary, 320)}`);
  if (recovery.next) console.log(`Next: ${compact(recovery.next, 320)}`);
  if (recovery.autoProbe) {
    const fresh = recovery.autoProbe.freshness || {};
    const state = recovery.autoProbe.running ? 'running' : recovery.autoProbe.due ? 'due' : fresh.fresh ? `cooldown ${fresh.waitLabel || ''}`.trim() : 'idle';
    console.log(`Auto probe: ${state} · action=${recovery.autoProbe.actionId || 'readiness:realtime_voice_provider'} · starts microphone=${recovery.autoProbe.safety?.startsMicrophone ? 'yes' : 'no'}`);
  }
  if (recovery.retryPolicy?.active) {
    const policy = recovery.retryPolicy;
    console.log(`Retry policy: ${policy.state || '-'} · can probe now=${policy.canProbeNow ? 'yes' : 'no'}${policy.waitLabel ? ` · wait ${policy.waitLabel}` : ''} · use local fallback=${policy.shouldUseLocalFallback ? 'yes' : 'no'}`);
  }
  if (steps.length) {
    console.log('\nRecovery steps:');
    for (const [index, step] of steps.entries()) {
      const command = step.command ? ` · ${step.command}` : '';
      const url = step.url ? ` · ${step.url}` : '';
      console.log(`${index + 1}. ${step.label || step.id}: ${compact(step.detail || '', 260)}${command}${url}`);
    }
  }
  if (recovery.localFallback?.command) {
    console.log(`\nFallback now: ${recovery.localFallback.command} · ${recovery.localFallback.endpoint || '/api/voice/command'}`);
  }
  if (recovery.links?.billing) console.log(`API billing: ${recovery.links.billing}`);
  if (recovery.links?.help) console.log(`OpenAI help: ${recovery.links.help}`);
}

async function showRealtimeProviderRecovery(options = {}) {
  const result = await request('/api/realtime/provider/recovery');
  printRealtimeProviderRecovery(result);
  if (options.openBilling) await setupAction('open_openai_platform_billing');
  return result;
}

async function showRealtimeProviderRecoveryFromCui(rl) {
  const result = await showRealtimeProviderRecovery();
  const recovery = result?.recovery || {};
  if (!recovery.billingLikely) return;
  const answer = (await rl.question('\nOpen OpenAI API billing in browser now? Type OPEN to continue: ')).trim();
  if (answer !== 'OPEN') {
    console.log('\nNo browser opened.');
    return;
  }
  await setupAction('open_openai_platform_billing');
}

function printSetupRecoveryBundle(result) {
  const bundle = result?.bundle || result || {};
  const resident = bundle.resident || {};
  const setup = bundle.setup || {};
  const readiness = bundle.readiness || {};
  const voice = bundle.voice || {};
  const realtime = voice.realtime || {};
  const localFallback = voice.localFallback || {};
  const pet = bundle.pet || {};
  const keepAwake = bundle.keepAwake || {};
  const automation = bundle.automation || {};
  const policy = automation.policy || {};
  const allow = policy.allow || {};
  const commands = bundle.commands || {};
  const permissions = Array.isArray(bundle.permissions) ? bundle.permissions : [];
  const capabilities = Array.isArray(automation.capabilities) ? automation.capabilities : [];
  const nextActions = Array.isArray(bundle.nextActions) ? bundle.nextActions : [];
  console.log('JAVIS Setup Recovery Bundle');
  console.log('===========================');
  console.log(`Status: ${bundle.overall || '-'} · ${bundle.label || '-'}`);
  if (bundle.summary) console.log(`Summary: ${compact(bundle.summary, 420)}`);
  if (bundle.nextAction) {
    const action = bundle.nextAction;
    const command = action.command ? ` · ${action.command}` : '';
    const endpoint = action.endpoint ? ` · ${action.endpoint}` : '';
    console.log(`Next: ${action.label || action.id || '-'}${command}${endpoint}`);
    if (action.summary) console.log(`      ${compact(action.summary, 280)}`);
  }

  console.log('\nResident');
  console.log(`- installed=${resident.installed ? 'yes' : 'no'} loaded=${resident.loaded ? 'yes' : 'no'} matchesProject=${resident.matchesProject ? 'yes' : 'no'}${resident.pid ? ` pid=${resident.pid}` : ''}`);
  if (pet.window) {
    console.log(`- pet ${pet.window.mode || pet.mode || '-'} ${pet.window.width || '-'}x${pet.window.height || '-'} park=${pet.window.parkCorner || '-'} hotkey=${pet.window.hotkeyRegistered ? 'on' : 'off'} summon=${pet.window.summonHotkeyRegistered ? 'on' : 'off'}`);
  }
  if (keepAwake.plan) {
    const keepAwakeLabel = keepAwake.running ? 'managed' : keepAwake.active ? 'external assertion' : 'off';
    console.log(`- keep-awake ${keepAwakeLabel}${keepAwake.pid ? ` pid=${keepAwake.pid}` : ''} · screen ${keepAwake.plan.screenMaySleep ? 'may sleep' : 'held awake'} · power=${keepAwake.power?.source || '-'}`);
  }

  console.log('\nVoice');
  console.log(`- realtime: ${realtime.status || '-'} · ${realtime.kind || '-'}${realtime.lastStatusCode ? ` · HTTP ${realtime.lastStatusCode}` : ''}`);
  if (realtime.summary) console.log(`  ${compact(realtime.summary, 260)}`);
  console.log(`- local fallback: ${localFallback.available ? 'ready' : 'off'} · ${localFallback.mode || '-'} · starts mic=${localFallback.safety?.startsMicrophone ? 'yes' : 'no'}`);
  if (localFallback.input?.openLoopCommand) console.log(`  ${localFallback.input.openLoopCommand}`);

  console.log('\nControl');
  console.log(`- local execution=${automation.localExecutionEnabled ? 'on' : 'off'} trusted=${automation.trustedLocalMode ? 'on' : 'off'} mode=${automation.controlMode?.mode || '-'}`);
  console.log(`- auto Level ${policy.maxAutoRiskLevel ?? '-'} · approval Level ${policy.requireApprovalAtRiskLevel ?? '-'} · dryRun=${policy.dryRun ? 'yes' : 'no'}`);
  if (allow.files) console.log(`- files: ${allow.files.rootCount || 0} root(s), write ${allow.files.writeRootCount || 0}`);
  if (allow.cli) console.log(`- cli: ${allow.cli.enabled ? 'on' : 'off'} · ${(allow.cli.allowedCommands || []).join(', ') || '-'}`);
  if (allow.codeAgents) console.log(`- code agents: ${allow.codeAgents.enabled ? 'on' : 'off'} · ${(allow.codeAgents.allowedCommands || []).join(', ') || '-'}`);
  if (automation.workers) {
    console.log(`- workers: codex=${automation.workers.codex?.available ? 'ready' : 'missing'} claude=${automation.workers.claude?.available ? 'ready' : 'missing'}`);
  }

  if (permissions.length) {
    console.log('\nPermissions');
    for (const item of permissions) {
      console.log(`- ${item.status || '-'} ${item.label || item.id}: ${compact(item.summary || item.next || '', 180)}`);
    }
  }

  if (capabilities.length) {
    console.log('\nCapabilities');
    for (const item of capabilities.slice(0, 8)) {
      console.log(`- ${item.status || '-'} ${item.label || item.id}: ${compact(item.summary || item.next || '', 180)}`);
    }
  }

  if (nextActions.length > 1) {
    console.log('\nNext actions');
    for (const [index, action] of nextActions.slice(0, 6).entries()) {
      const command = action.command ? ` · ${action.command}` : '';
      console.log(`${index + 1}. ${action.label || action.id}${command}`);
    }
  }

  console.log('\nCommands');
  console.log(`- bundle: ${commands.bundle || 'npm run config -- --print-setup-recovery-bundle'}`);
  console.log(`- doctor: ${commands.doctor || 'npm run doctor -- --allow-blocked'}`);
  console.log(`- restart: ${commands.restart || 'npm run resident:restart'}`);
  console.log(`- local voice: ${commands.localVoiceLoop || 'npm run voice:chat'}`);
  console.log(`- voice standby: ${commands.voiceStandby || 'npm run voice:standby'}`);
  console.log(`- realtime probe: ${commands.realtimeProviderProbe || 'npm run dogfood:realtime-provider-probe'}`);
  console.log(`- keep awake: ${commands.keepAwakeStatus || 'npm run keepawake'} / ${commands.keepAwakeStart || 'npm run keepawake:start'} / ${commands.keepAwakeStop || 'npm run keepawake:stop'}`);

  const safety = bundle.safety || {};
  console.log('\nSafety');
  console.log(`- read-only=${safety.readOnly ? 'yes' : 'no'} starts mic=${safety.startsMicrophone ? 'yes' : 'no'} calls OpenAI=${safety.callsOpenAi ? 'yes' : 'no'} mutates files=${safety.mutatesFiles ? 'yes' : 'no'} exposes token=${safety.exposesApiToken ? 'yes' : 'no'}`);
  if (setup.nextStep || readiness.primaryIssue) {
    console.log(`\nReadiness: ${readiness.overall || setup.overall || '-'} · ${setup.blockedOrWarningCount || 0} setup issue(s)`);
  }
}

async function showSetupRecoveryBundle() {
  const result = await request('/api/setup/recovery-bundle');
  printSetupRecoveryBundle(result);
  return result;
}

function printKeepAwake(result) {
  const keepAwake = result?.keepAwake || result || {};
  const plan = keepAwake.plan || {};
  const power = keepAwake.power || {};
  const assertions = keepAwake.assertions || {};
  const launchctl = keepAwake.launchctl || {};
  console.log('JAVIS Keep-Awake');
  console.log('================');
  const statusLabel = keepAwake.running ? 'managed' : keepAwake.active ? 'external assertion' : 'off';
  console.log(`Status: ${statusLabel} · running=${keepAwake.running ? 'yes' : 'no'}${keepAwake.pid ? ` · pid=${keepAwake.pid}` : ''}`);
  console.log(`Label: ${keepAwake.label || plan.label || '-'}`);
  console.log(`Command: ${plan.commandLine || '-'}`);
  console.log(`Mode: ${plan.mode || '-'} · screen may sleep=${plan.screenMaySleep ? 'yes' : 'no'}`);
  if (power.available) console.log(`Power: ${power.source || '-'} · AC=${power.acPower ? 'yes' : 'no'}`);
  else if (power.error) console.log(`Power: unavailable · ${compact(power.error, 180)}`);
  if (assertions.available) {
    console.log(`Assertions: active=${assertions.active ? 'yes' : 'no'} system=${assertions.system ? 'yes' : 'no'} idle=${assertions.idle ? 'yes' : 'no'} disk=${assertions.disk ? 'yes' : 'no'} display=${assertions.display ? 'yes' : 'no'}`);
  } else if (assertions.error) {
    console.log(`Assertions: unavailable · ${compact(assertions.error, 180)}`);
  }
  if (launchctl.error && !launchctl.loaded) console.log(`Launchd: not loaded · ${compact(launchctl.error, 180)}`);
  if (keepAwake.summary) console.log(`Summary: ${compact(keepAwake.summary, 300)}`);
  if (keepAwake.next) console.log(`Next: ${compact(keepAwake.next, 300)}`);
  console.log('\nCommands');
  console.log('- status: npm run keepawake');
  console.log('- start: npm run keepawake:start');
  console.log('- stop: npm run keepawake:stop');
  console.log('\nSafety');
  console.log(`- starts mic=${keepAwake.safety?.startsMicrophone ? 'yes' : 'no'} calls OpenAI=${keepAwake.safety?.callsOpenAi ? 'yes' : 'no'} mutates project files=${keepAwake.safety?.mutatesProjectFiles ? 'yes' : 'no'} allows display sleep=${keepAwake.safety?.allowsDisplaySleep ? 'yes' : 'no'}`);
}

async function showKeepAwakeStatus() {
  const result = await request('/api/keep-awake/status');
  printKeepAwake(result);
  return result;
}

async function runKeepAwakeAction(action, options = {}) {
  const result = await request(`/api/keep-awake/${action}`, {
    method: 'POST',
    body: {
      execute: options.execute === true,
      source: options.source || 'cui',
    },
  });
  if (result.output) console.log(`\n${result.output}`);
  printKeepAwake(result);
  return result;
}

async function startKeepAwakeFromCui(rl) {
  const preview = await request('/api/keep-awake/start', {
    method: 'POST',
    body: { execute: false, source: 'cui_preview' },
  });
  printKeepAwake(preview);
  const answer = (await rl.question('\nStart keep-awake now? Type START to continue: ')).trim();
  if (answer !== 'START') {
    console.log('\nKeep-awake not started.');
    return;
  }
  await runKeepAwakeAction('start', { execute: true, source: 'cui' });
}

async function stopKeepAwakeFromCui(rl) {
  const preview = await request('/api/keep-awake/stop', {
    method: 'POST',
    body: { execute: false, source: 'cui_preview' },
  });
  printKeepAwake(preview);
  const answer = (await rl.question('\nStop keep-awake now? Type STOP to continue: ')).trim();
  if (answer !== 'STOP') {
    console.log('\nKeep-awake left unchanged.');
    return;
  }
  await runKeepAwakeAction('stop', { execute: true, source: 'cui' });
}

async function showRealtimeProviderProbe(options = {}) {
  const run = options.run === true;
  let result = run
    ? await request('/api/realtime/provider/probe', {
        method: 'POST',
        body: { execute: true, source: 'cui' },
      })
    : await request('/api/realtime/provider/probe');

  if (run && result.executed) {
    const runId = result.runId || result.providerProbe?.runId || '';
    const endAt = Date.now() + Number(options.timeoutMs || 20000);
    while (Date.now() < endAt) {
      await sleep(1000);
      const current = await request('/api/realtime/provider/probe');
      const probe = current.probe || {};
      const done = probe.active === false && (probe.completedAt || probe.result);
      const sameRun = !runId || probe.runId === runId || probe.result?.runId === runId;
      result = { ...result, probe };
      if (done && sameRun) break;
    }
  }

  printRealtimeProviderProbe(result);
  return result;
}

async function runRealtimeProviderProbeFromCui(rl) {
  const preview = await showRealtimeProviderProbe();
  if (preview.probe?.startsMicrophone) {
    console.log('\nUnexpected safety state: probe claims it starts microphone. Refusing.');
    return;
  }
  const answer = (await rl.question('\nRun no-mic provider probe now? Type RUN to call OpenAI Realtime without microphone capture: ')).trim();
  if (answer !== 'RUN') {
    console.log('\nNo provider probe started.');
    return;
  }
  await showRealtimeProviderProbe({ run: true });
}

function printRealtimeDogfoodPack(result) {
  const pack = result?.pack || result || {};
  const readiness = pack.readiness || {};
  const prompts = pack.prompts || {};
  const next = prompts.next || {};
  const commands = pack.commands || {};
  const safety = pack.safety || {};
  console.log('JAVIS Realtime Live Drill Pack');
  console.log('===============================');
  console.log(`Status: ${pack.status || 'pending'} · ready=${pack.readyToStart ? 'yes' : 'no'} · accepted=${pack.accepted ? 'yes' : 'no'}`);
  console.log(`Manual only=yes · starts microphone=${pack.startsMicrophone ? 'yes' : 'no'} · mic confirmation=${pack.requiresMicConfirmation ? 'required' : 'no'}`);
  console.log(`Renderer: ${readiness.rendererReady ? 'ready' : 'not-ready'} · provider=${readiness.providerReady ? 'ready' : 'not-ready'} · evidence=${readiness.evidenceStatus || '-'} / ${readiness.evidencePhase || '-'}`);
  console.log(`Acceptance: ${Number(readiness.acceptancePassed || 0)}/${Number(readiness.acceptanceGates || 0)} gate(s) pass`);
  if (next.copyText || next.prompt) {
    console.log(`\nNext prompt: ${next.copyText || next.prompt}`);
  }
  if (Array.isArray(next.followUpPrompts) && next.followUpPrompts.length) {
    console.log(`Follow-up: ${next.followUpPrompts.join(' | ')}`);
  }
  const liveGateRunbook = pack.liveGateRunbook || {};
  if (Array.isArray(liveGateRunbook.gateIds) && liveGateRunbook.gateIds.length) {
    const missingGateIds = Array.isArray(liveGateRunbook.missingGateIds)
      ? liveGateRunbook.missingGateIds.join(', ')
      : '-';
    console.log('\nLive gates:');
    console.log(`- remaining: ${Number(liveGateRunbook.remainingCount || 0)} · ${missingGateIds || '-'}`);
    console.log(`- command: ${liveGateRunbook.command || commands.startRequireAcceptance || commands.start || 'npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance'}`);
    if (liveGateRunbook.progressPrompt) console.log(`- ask: ${liveGateRunbook.progressPrompt}`);
    if (liveGateRunbook.monitorCommand) console.log(`- monitor: ${liveGateRunbook.monitorCommand}`);
  }
  const blockers = Array.isArray(pack.blockers) ? pack.blockers : [];
  if (blockers.length) {
    console.log('\nBlockers:');
    for (const blocker of blockers.slice(0, 5)) {
      console.log(`- ${blocker.label || blocker.id}: ${compact(blocker.nextAction || blocker.detail || '', 240)}`);
    }
  }
  console.log('\nCommands:');
  console.log(`- pack: ${commands.pack || 'npm run config -- --print-realtime-dogfood-pack'}`);
  console.log(`- preflight: ${commands.preflight || 'npm run dogfood:realtime-renderer'}`);
  console.log(`- start: ${commands.start || 'npm run dogfood:realtime-renderer -- --execute --confirm-mic'}`);
  console.log(`- monitor: ${commands.monitor || 'npm run config -> V. Watch Realtime voice evidence'}`);
  console.log(`- archive: ${commands.saveArchive || 'npm run config -- --save-realtime-dogfood-archive'}`);
  console.log(`- acceptance: ${commands.acceptance || 'npm run dogfood:realtime-acceptance'}`);
  const steps = Array.isArray(pack.operatorSteps) ? pack.operatorSteps : [];
  if (steps.length) {
    console.log('\nOperator steps:');
    for (const step of steps) {
      const mic = step.startsMicrophone ? 'starts mic' : 'no mic';
      const confirm = step.requiresMicConfirmation ? ' · confirm mic' : '';
      console.log(`- ${step.id || '-'} · ${mic}${confirm}: ${compact(step.command || step.prompt || step.endpoint || step.nextAction || '', 220)}`);
    }
  }
  const gaps = Array.isArray(pack.acceptance?.gaps) ? pack.acceptance.gaps : [];
  if (gaps.length) {
    console.log('\nNext acceptance gaps:');
    for (const gap of gaps.slice(0, 6)) {
      console.log(`- ${gap.group || '-'}/${gap.id || '-'}: ${compact(gap.label || gap.nextAction || '', 220)}`);
    }
  }
  console.log('\nSafety:');
  console.log(`- preflight starts mic: ${safety.preflightStartsMicrophone ? 'yes' : 'no'}`);
  console.log(`- pack starts mic: ${safety.packStartsMicrophone ? 'yes' : 'no'}`);
  console.log(`- execute requires confirm mic: ${safety.executeRequiresConfirmMic ? 'yes' : 'no'}`);
  console.log(`- autopilot eligible: ${safety.autopilotEligible ? 'yes' : 'no'}`);
  console.log(`- raw audio stored: ${safety.archiveStoresRawAudio ? 'yes' : 'no'}`);
  if (pack.nextAction) console.log(`\nNext action: ${compact(pack.nextAction, 320)}`);
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
    prompts.slice(0, 24).forEach((item, index) => console.log(`${index + 1}. ${item}`));
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
  const archiveSource = result?.archiveSource || acceptance.archiveSource || {};
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
  if (archiveSource.mode) {
    console.log(`Archive source: ${archiveSource.mode} · saved=${archiveSource.saved ? 'yes' : 'no'} · ${archiveSource.file || '-'}`);
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

function printRealtimeShortcutRecallDogfood(result) {
  const recall = result?.shortcutRecall || result || {};
  const safety = recall.safety || {};
  console.log('JAVIS Realtime Shortcut Recall Dogfood');
  console.log('======================================');
  console.log(`Status: ${recall.status || 'preview'} · ok=${recall.ok ? 'yes' : 'no'} · confirmed=${recall.confirmed ? 'yes' : 'no'}`);
  console.log(`Phrase: ${recall.phrase || '-'}`);
  console.log(`Task: ${compact(recall.task || '-', 260)}`);
  console.log(`Requires confirmation: ${recall.requiresConfirmation ? 'yes' : 'no'}`);
  console.log(`Safety: starts mic=${safety.startsMicrophone ? 'yes' : 'no'} · starts workers=${safety.startsWorkers ? 'yes' : 'no'} · executes task=${safety.executesTask ? 'yes' : 'no'} · route preview=${safety.routePreviewOnly ? 'yes' : 'no'}`);
  if (recall.shortcut) {
    console.log(`Shortcut: ${recall.shortcut.id || '-'} · ${recall.shortcut.primarySkill || '-'} · used ${Number(recall.shortcut.usedCount || 0)}`);
  }
  if (recall.route) {
    console.log(`Route: ${recall.route.id || '-'} · ${recall.route.lane || '-'} · ${recall.route.status || '-'} · ${recall.route.source || '-'}`);
  }
  if (recall.routeSkillRecall) {
    console.log(`Recall: ${recall.recalled ? 'yes' : 'no'} · ${recall.routeSkillRecall.decisionEffect || '-'} · ${recall.routeSkillRecall.primarySkill || '-'}`);
  }
  if (recall.output) console.log(`Summary: ${compact(recall.output, 420)}`);
  if (recall.requiresConfirmation) {
    console.log('Next: npm run config -- --prepare-realtime-shortcut-recall --confirm');
  }
}

function printRealtimeDogfoodPreflightBundle(result) {
  const bundle = result?.preflightBundle || result || {};
  const safety = bundle.safety || {};
  const acceptance = bundle.acceptance || {};
  const counts = acceptance.counts || {};
  const archive = bundle.archive || {};
  console.log('JAVIS Realtime Dogfood Preflight Bundle');
  console.log('=======================================');
  console.log(`Status: ${bundle.status || 'preview'} · ok=${bundle.ok ? 'yes' : 'no'} · confirmed=${bundle.confirmed ? 'yes' : 'no'} · executed=${bundle.executed ? 'yes' : 'no'}`);
  console.log(`Requires confirmation: ${bundle.requiresConfirmation ? 'yes' : 'no'}`);
  console.log(`Safety: starts mic=${safety.startsMicrophone ? 'yes' : 'no'} · starts workers=${safety.startsWorkers ? 'yes' : 'no'} · executes task=${safety.executesTask ? 'yes' : 'no'} · writes local json=${safety.writesLocalJson ? 'yes' : 'no'}`);
  if (bundle.live) {
    console.log(`Live prep: prompts=${Number(bundle.live.promptCount || 0)} · archive=${bundle.live.archive?.saved ? 'saved' : 'preview'} · session=${bundle.live.session?.sessions?.active?.id || bundle.live.session?.sessions?.active?.title || '-'}`);
  }
  if (bundle.shortcutRecall) {
    console.log(`Shortcut recall: ${bundle.shortcutRecall.recalled ? 'ready' : 'preview'} · phrase=${bundle.shortcutRecall.phrase || '-'} · route=${bundle.shortcutRecall.route?.id || '-'}`);
  }
  console.log(`Archive: ${archive.saved ? 'saved' : 'preview'} · ${archive.file?.path || acceptance.archive?.file || '-'}`);
  console.log(`Acceptance: ${Number(counts.passed || 0)}/${Number(counts.gates || 0)} gates · next=${acceptance.nextGap?.group || '-'}/${acceptance.nextGap?.id || '-'}`);
  console.log(`Next live command: ${bundle.next?.liveCommand || 'npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance'}`);
  if (bundle.output) console.log(`\n${compact(bundle.output, 1200)}`);
  if (bundle.requiresConfirmation) {
    console.log('\nNext: npm run config -- --prepare-realtime-dogfood-preflight --confirm');
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

async function showRealtimeDogfoodPack() {
  const result = await request('/api/realtime/dogfood/pack');
  printRealtimeDogfoodPack(result);
}

async function showRealtimeDogfoodArchive(options = {}) {
  const result = await request('/api/realtime/dogfood/archive', {
    method: options.save ? 'POST' : 'GET',
    body: options.save ? { source: 'cui' } : undefined,
  });
  printRealtimeDogfoodArchive(result);
}

async function showRealtimeDogfoodAcceptance(options = {}) {
  const query = options.preview ? '?preview=true' : '';
  const result = await request(`/api/realtime/dogfood/acceptance${query}`, {
    method: options.saveArchive ? 'POST' : 'GET',
    body: options.saveArchive ? { saveArchive: true, source: 'cui_acceptance_save' } : undefined,
  });
  printRealtimeDogfoodAcceptance(result);
}

async function showRealtimeShortcutRecallDogfood(options = {}) {
  const phrase = argvValue('--phrase', '');
  const task = argvValue('--task', '');
  const result = await request('/api/realtime/dogfood/shortcut-recall', {
    method: options.confirm ? 'POST' : 'GET',
    body: options.confirm ? {
      confirm: true,
      source: 'cui_realtime_dogfood_shortcut_recall',
      ...(phrase ? { phrase } : {}),
      ...(task ? { task } : {}),
    } : undefined,
  });
  printRealtimeShortcutRecallDogfood(result);
}

async function showRealtimeDogfoodPreflightBundle(options = {}) {
  const phrase = argvValue('--phrase', '');
  const task = argvValue('--task', '');
  const result = await request('/api/realtime/dogfood/preflight-bundle', {
    method: options.confirm ? 'POST' : 'GET',
    body: options.confirm ? {
      confirm: true,
      source: 'cui_realtime_dogfood_preflight_bundle',
      ...(phrase ? { phrase } : {}),
      ...(task ? { task } : {}),
    } : undefined,
  });
  printRealtimeDogfoodPreflightBundle(result);
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

  if (process.argv.includes('--print-realtime-dogfood-pack') || process.argv.includes('--realtime-dogfood-pack')) {
    await showRealtimeDogfoodPack();
    return;
  }

  if (process.argv.includes('--print-realtime-dogfood-acceptance') || process.argv.includes('--realtime-dogfood-acceptance')) {
    await showRealtimeDogfoodAcceptance({
      saveArchive: process.argv.includes('--save-archive'),
      preview: process.argv.includes('--preview') || process.argv.includes('--current-preview'),
    });
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

  if (process.argv.includes('--prepare-realtime-shortcut-recall') || process.argv.includes('--realtime-shortcut-recall')) {
    await showRealtimeShortcutRecallDogfood({ confirm: process.argv.includes('--confirm') });
    return;
  }

  if (process.argv.includes('--prepare-realtime-dogfood-preflight') || process.argv.includes('--realtime-dogfood-preflight')) {
    await showRealtimeDogfoodPreflightBundle({ confirm: process.argv.includes('--confirm') });
    return;
  }

  if (process.argv.includes('--print-renderer-realtime-dogfood') || process.argv.includes('--renderer-realtime-dogfood')) {
    const result = await request('/api/realtime/dogfood/renderer');
    printRendererDogfood(result);
    return;
  }

  if (process.argv.includes('--print-realtime-provider-probe') || process.argv.includes('--realtime-provider-probe')) {
    await showRealtimeProviderProbe();
    return;
  }

  if (process.argv.includes('--run-realtime-provider-probe')) {
    await showRealtimeProviderProbe({ run: true });
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

  if (process.argv.includes('--print-collaboration-handoff') || process.argv.includes('--collaboration-handoff') || process.argv.includes('--collaboration')) {
    await showCollaborationHandoff();
    return;
  }

  if (process.argv.includes('--print-collaboration-suggestions') || process.argv.includes('--collaboration-suggestions')) {
    const queryIndex = process.argv.findIndex((item) => item === '--query');
    const agentIndex = process.argv.findIndex((item) => item === '--agent');
    await showCollaborationSuggestions({
      query: queryIndex >= 0 ? process.argv[queryIndex + 1] : '',
      agent: agentIndex >= 0 ? process.argv[agentIndex + 1] : '',
    });
    return;
  }

  if (process.argv.includes('--print-collaboration-claims') || process.argv.includes('--collaboration-claims')) {
    await showCollaborationClaims();
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

  if (process.argv.includes('--print-permissions') || process.argv.includes('--permissions')) {
    await showPermissionMatrix();
    return;
  }

  if (process.argv.includes('--print-control-readiness') || process.argv.includes('--control-readiness')) {
    await showControlReadiness();
    return;
  }

  if (process.argv.includes('--print-setup-recovery-bundle') || process.argv.includes('--setup-recovery-bundle') || process.argv.includes('--recovery-bundle')) {
    await showSetupRecoveryBundle();
    return;
  }

  if (process.argv.includes('--print-keep-awake') || process.argv.includes('--keep-awake')) {
    await showKeepAwakeStatus();
    return;
  }

  if (process.argv.includes('--start-keep-awake')) {
    await runKeepAwakeAction('start', { execute: true, source: 'cui_cli' });
    return;
  }

  if (process.argv.includes('--stop-keep-awake')) {
    await runKeepAwakeAction('stop', { execute: true, source: 'cui_cli' });
    return;
  }

  if (process.argv.includes('--print-routing-speed-policy') || process.argv.includes('--routing-speed-policy')) {
    const messageIndex = process.argv.findIndex((item) => item === '--message');
    const laneIndex = process.argv.findIndex((item) => item === '--lane');
    await showRoutingSpeedPolicy({
      message: messageIndex >= 0 ? process.argv[messageIndex + 1] : '',
      lane: laneIndex >= 0 ? process.argv[laneIndex + 1] : '',
    });
    return;
  }

  if (process.argv.includes('--print-work-next') || process.argv.includes('--work-next')) {
    await showWorkbenchNext();
    return;
  }

  if (process.argv.includes('--run-work-next') || process.argv.includes('--execute-work-next')) {
    await runWorkbenchNextDirect();
    return;
  }

  if (process.argv.includes('--print-autonomy') || process.argv.includes('--autonomy')) {
    await showAutonomyLoop({ execute: false });
    return;
  }

  if (process.argv.includes('--run-autonomy') || process.argv.includes('--execute-autonomy')) {
    await showAutonomyLoop({ execute: true, retry: process.argv.includes('--retry') || process.argv.includes('--auto-recover') });
    return;
  }

  if (process.argv.includes('--print-voice-history') || process.argv.includes('--voice-history')) {
    await showVoiceHistory();
    return;
  }

  if (process.argv.includes('--print-voice-standby') || process.argv.includes('--voice-standby') || process.argv.includes('--standby')) {
    await showVoiceStandby();
    return;
  }

  if (process.argv.includes('--voice-entry') || process.argv.includes('--preview-voice-entry')) {
    await runVoiceStandbyPrimaryActionFromCli({ execute: false });
    return;
  }

  if (process.argv.includes('--open-voice-entry') || process.argv.includes('--run-voice-entry')) {
    await runVoiceStandbyPrimaryActionFromCli({ execute: true });
    return;
  }

  if (process.argv.includes('--print-local-voice-loop') || process.argv.includes('--local-voice-loop')) {
    await showLocalVoiceLoopQuickstart();
    return;
  }

  if (process.argv.includes('--print-wake-handoff') || process.argv.includes('--wake-handoff')) {
    await showWakeHandoff();
    return;
  }

  if (process.argv.includes('--print-browser-activity') || process.argv.includes('--browser-activity')) {
    await showBrowserActivity();
    return;
  }

  if (process.argv.includes('--print-browser-readiness') || process.argv.includes('--browser-readiness')) {
    await showBrowserReadiness();
    return;
  }

  if (process.argv.includes('--print-learning-evolution') || process.argv.includes('--learning-evolution')) {
    await showLearningEvolution();
    return;
  }

  if (process.argv.includes('--print-learning-distillation') || process.argv.includes('--learning-distillation')) {
    await showLearningDistillation();
    return;
  }

  if (process.argv.includes('--print-record-replay-teaching') || process.argv.includes('--record-replay-teaching')) {
    await showRecordReplayTeachingPacket();
    return;
  }

  if (process.argv.includes('--save-record-replay-teaching')) {
    await showRecordReplayTeachingPacket({ save: true });
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

  if (process.argv.includes('--print-mcp-servers') || process.argv.includes('--mcp-servers')) {
    await showMcpServers();
    return;
  }

  if (process.argv.includes('--print-mcp-workflow') || process.argv.includes('--mcp-workflow')) {
    await showMcpWorkflow();
    return;
  }

  if (process.argv.includes('--print-mcp-tool-call') || process.argv.includes('--mcp-tool-call')) {
    await showMcpToolCall();
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

  if (process.argv.includes('--print-screen-region-presets')) {
    await showScreenRegionPresets();
    return;
  }

  const addRegionIndex = process.argv.findIndex((item) => item === '--add-screen-region-mask');
  if (addRegionIndex >= 0) {
    const maybePreset = process.argv[addRegionIndex + 1] || '';
    await addScreenRegionMask(null, {
      preset: maybePreset && !maybePreset.startsWith('--') ? maybePreset : 'top_right_notifications',
    });
    return;
  }

  if (process.argv.includes('--preview-screen-privacy-preset')) {
    await applyRecommendedScreenPrivacy(null, { dryRun: true });
    return;
  }

  if (process.argv.includes('--apply-screen-privacy-preset')) {
    await applyRecommendedScreenPrivacy(null);
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

  if (process.argv.includes('--print-realtime-recovery') || process.argv.includes('--realtime-recovery')) {
    await showRealtimeProviderRecovery({ openBilling: process.argv.includes('--open-billing') });
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
      else if (answer === '1b' || answer === 'billing' || answer === 'quota' || answer === 'realtime recovery') await showRealtimeProviderRecoveryFromCui(rl);
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
      } else if (answer === 'rb' || answer === 'recovery bundle' || answer === 'setup recovery' || answer === 'resident recovery') {
        await showSetupRecoveryBundle();
      } else if (answer === 'ka' || answer === 'keep awake' || answer === 'keep-awake') {
        await showKeepAwakeStatus();
      } else if (answer === 'ks' || answer === 'keep awake start' || answer === 'start keep awake' || answer === 'start keep-awake') {
        await startKeepAwakeFromCui(rl);
      } else if (answer === 'kx' || answer === 'keep awake stop' || answer === 'stop keep awake' || answer === 'stop keep-awake') {
        await stopKeepAwakeFromCui(rl);
      } else if (answer === 'v' || answer === 'voice' || answer === 'realtime') {
        await watchRealtimeEvidence(rl);
      } else if (answer === 'd' || answer === 'dogfood' || answer === 'drill') {
        await startRealtimeDogfoodDrillFromCui(rl);
      } else if (answer === 'r' || answer === 'renderer dogfood' || answer === 'realtime renderer') {
        await startRendererRealtimeDogfoodFromCui(rl);
      } else if (answer === 'rp' || answer === 'provider probe' || answer === 'realtime provider probe') {
        await runRealtimeProviderProbeFromCui(rl);
      } else if (answer === 'o' || answer === 'pack' || answer === 'drill pack' || answer === 'live drill pack') {
        await showRealtimeDogfoodPack();
      } else if (answer === 'b' || answer === 'brief' || answer === 'dogfood brief') {
        await showRealtimeDogfoodBrief();
      } else if (answer === 'e' || answer === 'acceptance' || answer === 'dogfood acceptance') {
        await showRealtimeDogfoodAcceptance();
      } else if (answer === 'a' || answer === 'archive' || answer === 'dogfood archive') {
        await showRealtimeDogfoodArchive({ save: true });
      } else if (answer === 'y' || answer === 'preflight' || answer === 'dogfood preflight') {
        await showRealtimeDogfoodPreflightBundle({ confirm: true });
      } else if (answer === 'p' || answer === 'prompt' || answer === 'dogfood prompt') {
        await showRealtimeDogfoodPrompt({ copy: true });
      } else if (answer === 't' || answer === 'track' || answer === 'dogfood session') {
        await manageRealtimeDogfoodSession(rl);
      } else if (answer === 'h' || answer === 'handoff' || answer === 'work handoff') {
        await showWorkHandoff();
      } else if (answer === 'vh' || answer === 'voice history' || answer === 'local voice history') {
        await showVoiceHistory();
      } else if (answer === 'vs' || answer === 'voice standby' || answer === 'standby' || answer === 'fallback') {
        await showVoiceStandby();
      } else if (answer === 'vc' || answer === 'voice chat' || answer === 'local voice loop' || answer === 'local voice command loop') {
        await startLocalVoiceCommandLoopFromCui(rl);
      } else if (answer === 'ag' || answer === 'agent' || answer === 'autonomy' || answer === 'bounded autonomy') {
        const task = await rl.question('Task to preview with bounded autonomy: ');
        await showAutonomyLoop({ task, source: 'cui_autonomy_preview', execute: false });
      } else if (answer === 'ar' || answer === 'agent run' || answer === 'run autonomy' || answer === 'autonomy run') {
        await runAutonomyLoopFromCui(rl);
      } else if (answer === 'wh' || answer === 'wake handoff' || answer === 'wake') {
        await showWakeHandoff();
      } else if (answer === 'l' || answer === 'capabilities' || answer === 'capability map') {
        await showLocalCapabilities({ includeNext: true });
      } else if (answer === 'i' || answer === 'permissions' || answer === 'permission matrix') {
        await showPermissionMatrix();
      } else if (answer === 'cr' || answer === 'control readiness' || answer === 'readiness packet') {
        await showControlReadiness();
      } else if (answer === 's' || answer === 'speed' || answer === 'speed policy' || answer === 'routing speed') {
        await showRoutingSpeedPolicy();
      } else if (answer === 'br' || answer === 'browser readiness' || answer === 'browser ready') {
        await showBrowserReadiness();
      } else if (answer === 'g' || answer === 'browser benchmark' || answer === 'browser benchmarks') {
        await showBrowserBenchmarks();
      } else if (answer === 'f' || answer === 'file benchmark' || answer === 'file benchmarks') {
        await showFileBenchmarks();
      } else if (answer === 'k' || answer === 'knowledge benchmark' || answer === 'knowledge benchmarks') {
        await showKnowledgeBenchmarks();
      } else if (answer === 'x' || answer === 'mcp' || answer === 'mcp servers') {
        await showMcpServers();
      } else if (answer === 'w' || answer === 'mcp workflow' || answer === 'mcp preview') {
        const task = await rl.question('Task to preview MCP routing for: ');
        await showMcpWorkflow({ task });
      } else if (answer === 'z' || answer === 'mcp tool call' || answer === 'mcp call') {
        const task = await rl.question('Task for this MCP tool call: ');
        const serverName = await rl.question('MCP server name: ');
        const toolName = await rl.question('MCP tool name: ');
        const argumentText = await rl.question('Tool arguments JSON object (default {}): ');
        await showMcpToolCall({
          task,
          serverName,
          toolName,
          arguments: argumentText.trim() || '{}',
        });
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
      } else if (answer === 'j' || answer === 'learning distillation') {
        await showLearningDistillation();
      } else if (answer === 'rr' || answer === 'record replay' || answer === 'record replay teaching') {
        await showRecordReplayTeachingPacket();
      } else if (answer === 'rt' || answer === 'record replay save' || answer === 'record replay packet') {
        await showRecordReplayTeachingPacket({ save: true });
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
        await showLearningEvolution();
      } else if (answer === '25') {
        await previewLearningSkillDraft();
      } else if (answer === '26') {
        await exportLearningSkillDraft(rl);
      } else if (answer === '27') {
        await showCollaborationHandoff();
      } else if (answer === 'cs' || answer === 'collaboration suggestions' || answer === 'scope suggestions') {
        await showCollaborationSuggestions();
      } else if (answer === 'claims' || answer === 'collaboration claims') {
        await showCollaborationClaims();
      } else if (answer === '28') {
        await showDemonstrations();
      } else if (answer === '29') {
        await showSkillShortcuts();
      } else if (answer === '30') {
        await promoteShortcutCandidate(rl);
      } else if (answer === '31') {
        await showBrowserActivity();
      } else if (answer === '32') {
        await showAttentionPolicy();
      } else if (answer === '33') {
        await showPerceptionConsent();
      } else if (answer === '34') {
        await showScreenPrivacy();
      } else if (answer === '35') {
        await applyRecommendedScreenPrivacy(rl);
      } else if (answer === '36') {
        await addScreenRegionMask(rl);
      } else if (answer === '37' || answer === 'q' || answer === 'quit' || answer === 'exit') {
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
