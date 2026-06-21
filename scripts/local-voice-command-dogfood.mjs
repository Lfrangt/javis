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
  printf "状态\\n继续刚才那个\\n/exit\\n" | npm run voice:chat -- --json
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
    console.log('Type /exit or /quit to stop. This loop starts no microphone and no Realtime session.');
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

  const okAll = turns.length > 0 && turns.every((turn) => turn.ok);
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
