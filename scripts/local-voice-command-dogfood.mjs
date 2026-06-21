#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(API_TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positionalMessage() {
  const valueFlags = new Set(['--message', '--text', '--mode', '--wake-phrase', '--session-goal', '--session-title']);
  const parts = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item || item.startsWith('--')) {
      if (valueFlags.has(item) && args[index + 1] && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    parts.push(item);
  }
  return parts.join(' ').trim();
}

function userCliMode() {
  return process.env.JAVIS_LOCAL_VOICE_CLI === 'true' || hasFlag('user') || hasFlag('local');
}

function printHelp() {
  console.log(`JAVIS Local Voice Command
=========================
Use this when Realtime voice is unavailable or when you want a no-mic local intake path.

Examples:
  npm run voice -- "帮我看一下当前窗口，判断下一步该怎么做"
  npm run voice -- --wake "贾维斯，帮我看当前窗口下一步做什么"
  npm run voice -- --run --include-screen --include-ui "把这个任务交给后台处理"
  npm run voice -- --session "把这次本地语音指令写入工作会话"
  npm run voice:chat -- --session
  printf "/status\\n/next\\n状态\\n/exit\\n" | npm run voice:chat -- --json
  npm run voice -- --json --no-speech "当前状态怎么样？"

Flags:
  --wake                       Trigger wake first, then send the transcript through local intake.
  --wake-phrase <phrase>       Phrase stored in wake state. Default: 贾维斯.
  --run, --execute             Queue/execute non-quick routes through normal policy gates.
  --include-screen, --screen   Attach metadata-only screen context. No screenshot is sent.
  --include-ui, --include-accessibility
                               Attach a bounded Accessibility outline. No full node payload is sent.
  --no-screen, --no-ui         Disable default local CLI screen/UI metadata.
  --session                   Record into the active work session; if none exists, start one.
  --session-goal <goal>       Goal/title for the auto-started work session.
  --no-session                Disable active session logging for this command.
  --chat, --loop              Keep a local no-mic command loop open until /exit or /quit.
                               Slash commands: /status, /handoff, /next, /history, /help.
  --confirm-speak, --confirm  Actually speak the local acknowledgement with macOS say.
  --no-speech                 Disable the acknowledgement preview.
  --mode <lane>               Hint quick/background/codex/claude.
  --json                      Print machine-readable output.`);
}

async function request(apiPath, options = {}) {
  const token = readApiToken();
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { 'X-JAVIS-Token': token } : {}),
  };
  const response = await fetch(`${API_BASE}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

function buildPayload(options = {}) {
  const userCli = userCliMode();
  const execute = hasFlag('execute') || hasFlag('run');
  const wake = hasFlag('wake') || hasFlag('summon');
  const confirm = hasFlag('confirm') || hasFlag('confirm-speak') || hasFlag('confirm-audio');
  const includeScreen = hasFlag('include-screen') || hasFlag('screen') || (userCli && !hasFlag('no-screen'));
  const includeAccessibility =
    hasFlag('include-accessibility') ||
    hasFlag('include-ui') ||
    hasFlag('ui') ||
    (userCli && includeScreen && !hasFlag('no-ui'));
  const loop = Boolean(options.loop);
  const sessionRequested = hasFlag('session') || hasFlag('work-session') || hasFlag('record-session') || (loop && !hasFlag('no-session'));
  const sessionGoal = argValue('session-goal', argValue('session-title', loop ? 'JAVIS local voice command loop' : ''));
  const source = userCli
    ? wake
      ? execute ? 'local_wake_voice_command_cli_execute' : 'local_wake_voice_command_cli_preview'
      : execute ? 'local_voice_command_cli_execute' : 'local_voice_command_cli_preview'
    : wake
      ? execute ? 'dogfood_wake_voice_command_execute' : 'dogfood_wake_voice_command_preview'
      : execute ? 'dogfood_voice_command_execute' : 'dogfood_voice_command_preview';
  return {
    transcript: String(options.transcript || argValue('message', argValue('text', positionalMessage() || '帮我整理当前工作状态，给我一个三步计划，先不要执行。'))).trim(),
    execute,
    includeScreen,
    includeAccessibility,
    speak: !hasFlag('no-speech'),
    confirmSpeak: confirm,
    allowCloudQuick: hasFlag('allow-cloud-quick'),
    useMemory: hasFlag('use-memory'),
    session: hasFlag('no-session') ? false : sessionRequested ? true : undefined,
    sessionGoal,
    sessionTitle: sessionGoal,
    mode: argValue('mode', ''),
    phrase: argValue('wake-phrase', '贾维斯'),
    source: loop ? `${source}_loop` : source,
  };
}

function summarize(data = {}) {
  const route = data.route || {};
  return {
    ok: Boolean(data.ok),
    channel: data.channel,
    requestedExecute: Boolean(data.requestedExecute),
    executed: Boolean(data.executed),
    heldReason: data.heldReason || '',
    transcriptLength: String(data.transcript || '').length,
    route: {
      ok: route.ok !== false,
      lane: route.decision?.lane || '',
      label: route.decision?.label || '',
      queued: Boolean(route.queued || route.job?.id),
      jobId: route.job?.id || '',
      output: String(route.output || '').slice(0, 180),
    },
    spokenAck: String(data.spokenAck || '').slice(0, 220),
    context: data.context
      ? {
          ok: data.context.ok !== false,
          metadataOnly: Boolean(data.context.metadataOnly),
          includesScreenImage: Boolean(data.context.includesScreenImage),
          includesClipboardText: Boolean(data.context.includesClipboardText),
          includesAccessibilityNodes: Boolean(data.context.includesAccessibilityNodes),
          includeScreenRequested: Boolean(data.context.includeScreenRequested),
          includeAccessibilityRequested: Boolean(data.context.includeAccessibilityRequested),
          summary: String(data.context.summary || '').slice(0, 220),
          frontmost: data.context.frontmost || {},
          browser: data.context.browser || {},
          screen: data.context.screen || {},
          accessibility: data.context.accessibility || {},
        }
      : null,
    speech: data.speech
      ? {
          ok: data.speech.ok !== false,
          dryRun: Boolean(data.speech.dryRun),
          speaking: Boolean(data.speech.speaking),
          command: data.speech.command || '',
          textLength: data.speech.textLength || 0,
        }
      : null,
    wake: data.wake
      ? {
          pending: Boolean(data.wake.pending),
          lastPhrase: data.wake.lastPhrase || '',
          handoffMode: data.handoff?.mode || data.wake.handoff?.mode || '',
          localVoiceMode: data.handoff?.localVoiceMode || data.wake.handoff?.localVoiceMode || '',
        }
      : null,
    session: data.session
      ? {
          requested: Boolean(data.session.requested),
          recorded: Boolean(data.session.recorded),
          autoStarted: Boolean(data.session.autoStarted),
          sessionId: data.session.sessionId || '',
          eventId: data.session.eventId || '',
          title: data.session.title || '',
          reason: data.session.reason || '',
          error: data.session.error || '',
          privacy: data.session.privacy || {},
        }
      : null,
    safety: data.safety || {},
  };
}

async function runCommand(payload, wake, userCli) {
  const response = await request(wake ? '/api/wake/command' : '/api/voice/command', {
    method: 'POST',
    body: payload,
  });
  const summary = summarize(response.data || {});
  return {
    ok: Boolean(response.ok && response.data?.ok),
    apiBase: API_BASE,
    cliMode: userCli ? 'local' : 'dogfood',
    previewOnly: !payload.execute,
    payload: {
      wake,
      execute: payload.execute,
      includeScreen: payload.includeScreen,
      includeAccessibility: payload.includeAccessibility,
      speak: payload.speak,
      confirmSpeak: payload.confirmSpeak,
      allowCloudQuick: payload.allowCloudQuick,
      useMemory: payload.useMemory,
      session: payload.session,
      sessionGoal: payload.sessionGoal,
      mode: payload.mode,
    },
    responseStatus: response.status,
    ...summary,
  };
}

function printResult(result, payload, userCli) {
  console.log(userCli ? 'JAVIS Local Voice Command' : 'JAVIS Local Voice Command Dogfood');
  console.log(userCli ? '=========================' : '=================================');
  console.log(`API: ${API_BASE}`);
  console.log(`Mode: ${payload.execute ? 'execute' : 'preview'} · ok=${result.ok ? 'yes' : 'no'}`);
  if (result.wake) console.log(`Wake: ${result.wake.pending ? 'pending' : 'recorded'} · ${result.wake.handoffMode || '-'} · ${result.wake.lastPhrase || '-'}`);
  console.log(`Task: ${payload.transcript}`);
  console.log(`Route: ${result.route.lane || '-'} · queued=${result.route.queued ? 'yes' : 'no'} · executed=${result.executed ? 'yes' : 'no'}`);
  if (result.route.jobId) console.log(`Job: ${result.route.jobId}`);
  if (result.session?.recorded) {
    console.log(`Session: recorded · ${result.session.title || result.session.sessionId}`);
  } else if (result.session?.requested || result.session?.error) {
    console.log(`Session: not recorded · ${result.session.reason || result.session.error || 'no active session'}`);
  }
  console.log(`Speech: ${result.speech?.dryRun ? 'preview' : result.speech?.speaking ? 'speaking' : 'off'} · microphone=no · realtime=no`);
  console.log(`Context: ${result.context?.metadataOnly ? 'metadata-only' : 'unavailable'} · ${result.context?.summary || '-'}`);
  if (result.context?.accessibility?.requested) {
    console.log(`UI: ${result.context.accessibility.available ? `${result.context.accessibility.nodeCount || 0} node(s)` : result.context.accessibility.error || 'unavailable'}`);
  }
  console.log(`Ack: ${result.spokenAck}`);
  if (userCli && !payload.execute) console.log('Next: add --run to queue non-quick work through normal policy gates.');
  if (!result.ok) console.log(`Error: HTTP ${result.responseStatus}`);
}

function compactText(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function loopSafety() {
  return {
    startsMicrophone: false,
    usesRealtime: false,
    storesRawAudio: false,
    readOnly: true,
  };
}

function loopHelpText() {
  return [
    'Loop commands:',
    '  /status   Read resident readiness, Realtime blocker, and local fallback state.',
    '  /handoff  Read the voice-ready work handoff summary.',
    '  /next     Read the next workbench action preview.',
    '  /history  Read recent sanitized local voice-command turns.',
    '  /help     Show this help.',
    '  /exit     Leave the loop.',
    '',
    'Type a normal request without / to route it through /api/voice/command.',
  ].join('\n');
}

function formatLoopStatus(data = {}) {
  const readiness = data.readiness || {};
  const counts = readiness.counts || {};
  const voiceHealth = data.voiceHealth || {};
  const localVoice = data.localVoice || {};
  const routing = data.routing?.counts || data.routing || {};
  const latest = localVoice.history?.latest || null;
  const lines = [
    `Status: ${readiness.label || readiness.overall || 'unknown'} · ready ${counts.ready ?? '-'} / ${counts.total ?? '-'} · warning ${counts.warning ?? 0} · blocked ${counts.blocked ?? 0}`,
    `Realtime: ${voiceHealth.status || 'unknown'} · ${compactText(voiceHealth.summary || '-', 260)}`,
    `Local voice: ${localVoice.mode || 'unknown'} · ${localVoice.input?.endpoint || '/api/voice/command'}`,
    `Routing: total ${routing.total ?? '-'} · running ${routing.running ?? 0} · blocked ${routing.blocked ?? 0}`,
  ];
  if (latest) {
    lines.push(`Latest voice: ${latest.lane || '-'} · ${compactText(latest.transcriptPreview || '-', 140)}`);
  }
  return lines.join('\n');
}

function formatLoopHandoff(data = {}) {
  const handoff = data.handoff || {};
  const counts = handoff.progress?.counts || {};
  const jobCounts = counts.jobs || {};
  const workflowCounts = counts.workflows || {};
  const followUps = Array.isArray(handoff.followUps) ? handoff.followUps : [];
  const nextActions = Array.isArray(handoff.briefing?.nextActions) ? handoff.briefing.nextActions : [];
  const nextActionCount = nextActions.length || 'see summary';
  return [
    `Handoff: ${compactText(handoff.spokenSummary || handoff.output || '-', 520)}`,
    `Work: jobs running ${jobCounts.running ?? 0} / queued ${jobCounts.queued ?? 0} · workflows running ${workflowCounts.running ?? 0} / blocked ${workflowCounts.blocked ?? 0}`,
    `Next actions: ${nextActionCount} · follow-ups: ${followUps.length}`,
  ].join('\n');
}

function formatLoopNext(data = {}) {
  const next = data.next || {};
  const action = next.action || {};
  const localFallback = action.localFallback || {};
  const lines = [
    `Next: ${action.label || action.id || 'none'} · source=${action.source || '-'} · executable=${action.executable ? 'yes' : 'no'} · executed=${next.executed ? 'yes' : 'no'}`,
    `Summary: ${compactText(action.summary || next.output || '-', 520)}`,
  ];
  if (localFallback.endpoint) {
    lines.push(`Fallback: ${localFallback.endpoint} · ${compactText(localFallback.summary || '', 220)}`);
  }
  return lines.join('\n');
}

function formatHistoryTime(timestamp) {
  const time = Date.parse(timestamp || '');
  if (!Number.isFinite(time)) return '-';
  return new Date(time).toISOString().replace('T', ' ').slice(0, 16);
}

function formatLoopHistory(data = {}) {
  const history = data.history || {};
  const items = Array.isArray(history.items) ? history.items : [];
  if (!items.length) return 'History: 0 local voice turn(s).';
  const lines = [`History: ${history.count ?? items.length} local voice turn(s), transcript-preview-only.`];
  for (const item of items.slice(0, 5)) {
    const state = item.queued ? 'queued' : item.executed ? 'executed' : 'preview';
    const route = item.routeId ? ` · route ${item.routeId}` : '';
    lines.push(`- ${formatHistoryTime(item.timestamp)} · ${item.lane || '-'} · ${state}${route} · ${compactText(item.transcriptPreview || '-', 160)}`);
  }
  return lines.join('\n');
}

function commandOk(response, command) {
  if (!response.ok) return false;
  const data = response.data || {};
  if (data.ok === false) return false;
  if (command === 'handoff' && data.handoff?.ok === false) return false;
  if (command === 'next' && data.next?.ok === false) return false;
  if (command === 'history' && data.history?.ok === false) return false;
  return true;
}

function loopCommandResult(base, response, output) {
  return {
    ...base,
    ok: commandOk(response, base.command),
    responseStatus: response.status,
    output,
  };
}

async function runLoopCommand(transcript) {
  const [rawCommand] = String(transcript || '').trim().split(/\s+/);
  const name = String(rawCommand || '').toLowerCase();
  if (!name.startsWith('/')) return null;
  const command = name.slice(1);
  const base = {
    transcript,
    kind: 'loop_command',
    command,
    ok: true,
    responseStatus: 0,
    previewOnly: true,
    output: '',
    safety: loopSafety(),
  };

  try {
    if (command === 'help') return { ...base, output: loopHelpText() };
    if (command === 'status') {
      const response = await request('/api/status');
      return loopCommandResult(base, response, formatLoopStatus(response.data || {}));
    }
    if (command === 'handoff') {
      const response = await request('/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900');
      return loopCommandResult(base, response, formatLoopHandoff(response.data || {}));
    }
    if (command === 'next') {
      const response = await request('/api/work/next?workflowLimit=6&jobLimit=6');
      return loopCommandResult(base, response, formatLoopNext(response.data || {}));
    }
    if (command === 'history') {
      const response = await request('/api/voice/history?limit=5');
      return loopCommandResult(base, response, formatLoopHistory(response.data || {}));
    }
    return {
      ...base,
      ok: false,
      output: `Unknown loop command: ${name}\n\n${loopHelpText()}`,
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      output: `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runLoop() {
  const userCli = userCliMode();
  const wake = hasFlag('wake') || hasFlag('summon');
  const json = hasFlag('json');
  const rl = readline.createInterface({
    input: process.stdin,
    output: json || !process.stdin.isTTY ? undefined : process.stdout,
    terminal: Boolean(process.stdin.isTTY && !json),
  });
  const turns = [];
  if (!json) {
    console.log('JAVIS Local Voice Command Loop');
    console.log('==============================');
    console.log('Type /help for commands, or /exit to stop. This loop starts no microphone and no Realtime session.');
  }

  if (process.stdin.isTTY && !json) rl.setPrompt('JAVIS> ');
  if (process.stdin.isTTY && !json) rl.prompt();
  for await (const rawLine of rl) {
    const transcript = String(rawLine || '').trim();
    if (!transcript) {
      if (process.stdin.isTTY && !json) rl.prompt();
      continue;
    }
    if (['/exit', '/quit', 'exit', 'quit'].includes(transcript.toLowerCase())) break;
    const loopCommand = await runLoopCommand(transcript);
    if (loopCommand) {
      turns.push(loopCommand);
      if (!json) {
        console.log(loopCommand.output);
        console.log('Safety: read-only=yes · microphone=no · realtime=no · raw audio=no');
        if (process.stdin.isTTY) rl.prompt();
      }
      if (!loopCommand.ok && hasFlag('stop-on-error')) break;
      continue;
    }
    const payload = buildPayload({ loop: true, transcript });
    const result = await runCommand(payload, wake, userCli);
    turns.push({
      transcript,
      ok: result.ok,
      responseStatus: result.responseStatus,
      route: result.route,
      executed: result.executed,
      previewOnly: result.previewOnly,
      spokenAck: result.spokenAck,
      safety: result.safety,
      context: result.context
        ? {
            metadataOnly: result.context.metadataOnly,
            includesScreenImage: result.context.includesScreenImage,
            includesClipboardText: result.context.includesClipboardText,
            includesAccessibilityNodes: result.context.includesAccessibilityNodes,
          }
        : null,
      session: result.session,
    });
    if (!json) {
      console.log(`Route: ${result.route.lane || '-'} · queued=${result.route.queued ? 'yes' : 'no'} · executed=${result.executed ? 'yes' : 'no'}`);
      if (result.session?.recorded) console.log(`Session: recorded · ${result.session.title || result.session.sessionId}`);
      console.log(`Ack: ${result.spokenAck}`);
      console.log('Safety: microphone=no · realtime=no · raw audio=no');
      if (process.stdin.isTTY) rl.prompt();
    }
    if (!result.ok && hasFlag('stop-on-error')) break;
  }
  rl.close();

  const okAll = turns.every((turn) => turn.ok);
  if (json) {
    console.log(JSON.stringify({
      ok: okAll,
      apiBase: API_BASE,
      cliMode: userCli ? 'local' : 'dogfood',
      loop: true,
      turnCount: turns.length,
      previewOnly: !(hasFlag('execute') || hasFlag('run')),
      safety: {
        startsMicrophone: false,
        usesRealtime: false,
        storesRawAudio: false,
        readOnly: !(hasFlag('execute') || hasFlag('run')),
      },
      turns,
    }, null, 2));
  }
  process.exitCode = okAll ? 0 : 1;
}

async function main() {
  if (hasFlag('help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  if (hasFlag('chat') || hasFlag('loop') || hasFlag('interactive')) {
    await runLoop();
    return;
  }

  const userCli = userCliMode();
  const payload = buildPayload();
  const wake = hasFlag('wake') || hasFlag('summon');
  const result = await runCommand(payload, wake, userCli);

  if (hasFlag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result, payload, userCli);
  }

  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
