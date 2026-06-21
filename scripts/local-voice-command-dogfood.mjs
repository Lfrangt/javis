#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const valueFlags = new Set(['--message', '--text', '--mode']);
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
  npm run voice -- --run --include-screen --include-ui "把这个任务交给后台处理"
  npm run voice -- --json --no-speech "当前状态怎么样？"

Flags:
  --run, --execute             Queue/execute non-quick routes through normal policy gates.
  --include-screen, --screen   Attach metadata-only screen context. No screenshot is sent.
  --include-ui, --include-accessibility
                               Attach a bounded Accessibility outline. No full node payload is sent.
  --no-screen, --no-ui         Disable default local CLI screen/UI metadata.
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

function buildPayload() {
  const userCli = userCliMode();
  const execute = hasFlag('execute') || hasFlag('run');
  const confirm = hasFlag('confirm') || hasFlag('confirm-speak') || hasFlag('confirm-audio');
  const includeScreen = hasFlag('include-screen') || hasFlag('screen') || (userCli && !hasFlag('no-screen'));
  const includeAccessibility =
    hasFlag('include-accessibility') ||
    hasFlag('include-ui') ||
    hasFlag('ui') ||
    (userCli && includeScreen && !hasFlag('no-ui'));
  return {
    transcript: argValue('message', argValue('text', positionalMessage() || '帮我整理当前工作状态，给我一个三步计划，先不要执行。')),
    execute,
    includeScreen,
    includeAccessibility,
    speak: !hasFlag('no-speech'),
    confirmSpeak: confirm,
    allowCloudQuick: hasFlag('allow-cloud-quick'),
    useMemory: hasFlag('use-memory'),
    mode: argValue('mode', ''),
    source: userCli
      ? execute ? 'local_voice_command_cli_execute' : 'local_voice_command_cli_preview'
      : execute ? 'dogfood_voice_command_execute' : 'dogfood_voice_command_preview',
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
    safety: data.safety || {},
  };
}

async function main() {
  if (hasFlag('help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const userCli = userCliMode();
  const payload = buildPayload();
  const response = await request('/api/voice/command', {
    method: 'POST',
    body: payload,
  });
  const summary = summarize(response.data || {});
  const result = {
    ok: Boolean(response.ok && response.data?.ok),
    apiBase: API_BASE,
    cliMode: userCli ? 'local' : 'dogfood',
    previewOnly: !payload.execute,
    payload: {
      execute: payload.execute,
      includeScreen: payload.includeScreen,
      includeAccessibility: payload.includeAccessibility,
      speak: payload.speak,
      confirmSpeak: payload.confirmSpeak,
      allowCloudQuick: payload.allowCloudQuick,
      useMemory: payload.useMemory,
      mode: payload.mode,
    },
    responseStatus: response.status,
    ...summary,
  };

  if (hasFlag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(userCli ? 'JAVIS Local Voice Command' : 'JAVIS Local Voice Command Dogfood');
    console.log(userCli ? '=========================' : '=================================');
    console.log(`API: ${API_BASE}`);
    console.log(`Mode: ${payload.execute ? 'execute' : 'preview'} · ok=${result.ok ? 'yes' : 'no'}`);
    console.log(`Task: ${payload.transcript}`);
    console.log(`Route: ${result.route.lane || '-'} · queued=${result.route.queued ? 'yes' : 'no'} · executed=${result.executed ? 'yes' : 'no'}`);
    if (result.route.jobId) console.log(`Job: ${result.route.jobId}`);
    console.log(`Speech: ${result.speech?.dryRun ? 'preview' : result.speech?.speaking ? 'speaking' : 'off'} · microphone=no · realtime=no`);
    console.log(`Context: ${result.context?.metadataOnly ? 'metadata-only' : 'unavailable'} · ${result.context?.summary || '-'}`);
    if (result.context?.accessibility?.requested) {
      console.log(`UI: ${result.context.accessibility.available ? `${result.context.accessibility.nodeCount || 0} node(s)` : result.context.accessibility.error || 'unavailable'}`);
    }
    console.log(`Ack: ${result.spokenAck}`);
    if (userCli && !payload.execute) console.log('Next: add --run to queue non-quick work through normal policy gates.');
    if (!response.ok) console.log(`Error: HTTP ${response.status}`);
  }

  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
