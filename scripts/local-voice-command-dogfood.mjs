#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

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

function numericArg(name, fallback, options = {}) {
  const raw = argValue(name, '');
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  const min = Number.isFinite(options.min) ? options.min : 0;
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, value));
}

function positionalMessage() {
  const valueFlags = new Set(['--message', '--text', '--mode', '--wake-phrase', '--session-goal', '--session-title', '--request-timeout-ms']);
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
                               Slash commands: /status, /app, /ui, /file, /browser, /browse, /open, /delegate, /codex, /claude, /handoff, /jobs, /progress, /next, /auto, /history, /agent, /help.
  --full-status               In chat mode, make /status use the full diagnostics payload.
  --full-app                  Make /app read live Mac context and Accessibility outline.
  --full-browser              Make /browser read live browser page text.
  --full-next                 In chat mode, make /next use the full workbench payload.
  --full-agent                In chat mode, make /agent run the full autonomy preview.
  --agent-steps <n>           In chat mode, override fast /agent step count. Default: 4.
  --confirm-delegate          With --run, allow /delegate, /codex, or /claude to start a worker.
  --request-timeout-ms <ms>    Bound each local API call. Default: 30000.
  --confirm-speak, --confirm  Actually speak the local acknowledgement with macOS say.
  --no-speech                 Disable the acknowledgement preview.
  --mode <lane>               Hint quick/background/codex/claude.
  --json                      Print machine-readable output.`);
}

async function request(apiPath, options = {}) {
  const token = readApiToken();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : numericArg('request-timeout-ms', DEFAULT_REQUEST_TIMEOUT_MS, { min: 1000, max: 120000 });
  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { 'X-JAVIS-Token': token } : {}),
  };
  try {
    const response = await fetch(`${API_BASE}${apiPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data, elapsedMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      data: {
        ok: false,
        error: timedOut ? `request timed out after ${timeoutMs}ms` : String(error?.message || error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
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
    elapsedMs: response.elapsedMs,
    apiElapsedMs: response.elapsedMs,
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

function loopFullMode(command) {
  return hasFlag('full') || hasFlag(`full-${command}`);
}

function loopAgentStepLimit() {
  if (loopFullMode('agent')) return 8;
  return numericArg('agent-steps', 4, { min: 2, max: 10 });
}

function loopSafety() {
  return {
    startsMicrophone: false,
    usesRealtime: false,
    storesRawAudio: false,
    readOnly: true,
  };
}

function loopExecuteRequested() {
  return hasFlag('execute') || hasFlag('run');
}

function loopDelegateConfirmRequested() {
  return hasFlag('confirm-delegate') || hasFlag('confirm-worker') || hasFlag('confirm-agent');
}

function loopHelpText() {
  return [
    'Loop commands:',
    '  /voice    Read Realtime/live voice blocker, local fallback, and next recovery step.',
    '  /see      Read screen/privacy/ambient perception status without capturing a new frame.',
    '  /status   Fast-read pet readiness, Realtime blocker, and local fallback state.',
    '  /app      Fast-read recent Mac app and screen metadata; add --full-app for live UI outline.',
    '  /ui       Preview a local app/UI workflow plan; add --run to execute through policy.',
    '  /file     List, search, read, or preview organize/rename/convert file workflows.',
    '  /browser  Fast-read recent browser metadata; add --full-browser for live page summary.',
    '  /browse   Preview a browser workflow over the current page; add --run to execute.',
    '  /open     Preview opening a URL or web search; add --run to execute through policy.',
    '  /delegate Preview a scoped background/Codex/Claude handoff; --run stops at a confirmation gate.',
    '  /codex    Shortcut for /delegate codex.',
    '  /claude   Shortcut for /delegate claude.',
    '  /handoff  Read the voice-ready work handoff summary.',
    '  /jobs     Read active/recent jobs, worker groups, recovery hints, and next action.',
    '  /progress Alias for /jobs.',
    '  /next     Fast-read the next workbench action preview.',
    '  /auto     Read autopilot/agency status and why unattended work is or is not acting.',
    '  /history  Read recent sanitized local voice-command turns.',
    '  /agent    Preview a short bounded autonomy loop for a task.',
    '  /help     Show this help.',
    '  /exit     Leave the loop.',
    '',
    'Flags: --full-status, --full-app, --full-browser, --full-next, --full-agent, --full, or --confirm-delegate.',
    'Type a normal request without / to route it through /api/voice/command.',
  ].join('\n');
}

function normalizeUiTask(transcript) {
  return String(transcript || '').replace(/^\/ui\b/i, '').trim();
}

function normalizeFileRequest(transcript) {
  const raw = String(transcript || '').replace(/^\/files?\b/i, '').trim();
  if (!raw) {
    return {
      kind: 'action',
      action: 'list_directory',
      path: '.',
      maxEntries: 12,
      label: 'list',
    };
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  const command = String(tokens[0] || '').toLowerCase();
  if (['search', 'find', 'grep'].includes(command)) {
    let rest = raw.replace(/^\S+\s*/u, '').trim();
    let targetPath = '.';
    const inMatch = rest.match(/\s+(?:in|within|under|at|path:)\s+(.+)$/i);
    if (inMatch) {
      targetPath = inMatch[1].trim() || '.';
      rest = rest.slice(0, inMatch.index).trim();
    }
    if (!rest) {
      return {
        error: 'Usage: /file search <query> [in <path>]',
      };
    }
    return {
      kind: 'action',
      action: 'search_files',
      path: targetPath,
      query: rest,
      maxResults: 8,
      label: 'search',
    };
  }
  if (['read', 'cat', 'show', 'open'].includes(command)) {
    const targetPath = raw.replace(/^\S+\s*/u, '').trim();
    if (!targetPath) {
      return {
        error: 'Usage: /file read <path>',
      };
    }
    return {
      kind: 'action',
      action: 'read_file',
      path: targetPath,
      maxBytes: 6000,
      label: 'read',
    };
  }
  if (['list', 'ls', 'dir'].includes(command)) {
    const targetPath = raw.replace(/^\S+\s*/u, '').trim() || '.';
    return {
      kind: 'action',
      action: 'list_directory',
      path: targetPath,
      maxEntries: 12,
      label: 'list',
    };
  }
  if (['organize', 'organise', 'sort'].includes(command)) {
    const targetPath = raw.replace(/^\S+\s*/u, '').trim() || '.';
    return {
      kind: 'workflow',
      intent: 'organize',
      path: targetPath,
      maxEntries: 80,
      maxMoves: 12,
      label: 'organize',
    };
  }
  if (['rename', 'batch-rename', 'batch_rename'].includes(command)) {
    const request = normalizeFileRenameRequest(raw.replace(/^\S+\s*/u, '').trim());
    if (request.error) return request;
    return {
      kind: 'workflow',
      intent: 'rename',
      label: 'rename',
      maxFiles: 12,
      ...request,
    };
  }
  if (['convert', 'copy-convert', 'copy_convert'].includes(command)) {
    const request = normalizeFileConvertRequest(raw.replace(/^\S+\s*/u, '').trim(), command);
    if (request.error) return request;
    return {
      kind: 'workflow',
      intent: 'convert',
      label: 'convert',
      maxFiles: 8,
      ...request,
    };
  }
  return {
    kind: 'action',
    action: 'list_directory',
    path: raw,
    maxEntries: 12,
    label: 'list',
  };
}

function extractFileTextOption(text, names) {
  let nextText = String(text || '');
  let value = '';
  for (const name of names) {
    const pattern = new RegExp(`\\s+${name}\\s+(.+?)(?=\\s+(?:prefix|suffix|case|style|ext|extension|extensions|to|as|target)\\b|$)`, 'i');
    const match = nextText.match(pattern);
    if (match) {
      value = String(match[1] || '').trim();
      nextText = `${nextText.slice(0, match.index)} ${nextText.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
      break;
    }
  }
  return { text: nextText, value };
}

function normalizeFileExtensions(value) {
  const items = String(value || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`));
  return Array.from(new Set(items)).slice(0, 12);
}

function normalizeFileRenameRequest(input) {
  let rest = String(input || '').trim();
  if (!rest) return { error: 'Usage: /file rename <path> [prefix <text>] [suffix <text>] [case kebab|snake|lower|upper] [ext .txt,.md]' };
  let extracted = extractFileTextOption(rest, ['prefix']);
  rest = extracted.text;
  const prefix = extracted.value;
  extracted = extractFileTextOption(rest, ['suffix']);
  rest = extracted.text;
  const suffix = extracted.value;
  extracted = extractFileTextOption(rest, ['case', 'style']);
  rest = extracted.text;
  const caseStyle = extracted.value.toLowerCase();
  extracted = extractFileTextOption(rest, ['ext', 'extension', 'extensions']);
  rest = extracted.text;
  const extensions = normalizeFileExtensions(extracted.value);
  const pathValue = rest || '.';
  return {
    path: pathValue,
    prefix: prefix || (!suffix && !caseStyle ? 'renamed-' : ''),
    suffix,
    caseStyle: ['kebab', 'snake', 'lower', 'upper'].includes(caseStyle) ? caseStyle : '',
    extensions,
  };
}

function normalizeFileConvertRequest(input, command = 'convert') {
  let rest = String(input || '').trim();
  if (!rest) return { error: 'Usage: /file convert <path> to <.extension> [ext .txt,.md]' };
  const target = extractFileTextOption(rest, ['to', 'as', 'target']);
  rest = target.text;
  const targetExtension = normalizeFileExtensions(target.value)[0] || '';
  if (!targetExtension) return { error: 'Usage: /file convert <path> to <.extension>' };
  const source = extractFileTextOption(rest, ['ext', 'extension', 'extensions']);
  rest = source.text;
  const extensions = normalizeFileExtensions(source.value);
  const pathValue = rest || '.';
  return {
    path: pathValue,
    targetExtension,
    extensions,
    conversionMode: command.startsWith('copy') ? 'copy' : 'semantic',
  };
}

function normalizeDelegateModeForLoop(value) {
  const mode = String(value || '').trim().toLowerCase().replaceAll('-', '_');
  const aliases = {
    code: 'codex',
    repo: 'codex',
    claude_code: 'claude',
    claudecode: 'claude',
    deep: 'background',
    bg: 'background',
    worker: 'background',
  };
  const normalized = aliases[mode] || mode;
  return ['background', 'codex', 'claude'].includes(normalized) ? normalized : '';
}

function ownerForDelegateMode(mode) {
  if (mode === 'codex') return 'Codex';
  if (mode === 'claude') return 'Claude Code';
  return 'Background';
}

function normalizeDelegateAccessForLoop(value) {
  const access = String(value || '').trim().toLowerCase();
  if (['read', 'write', 'exclusive'].includes(access)) return access;
  return '';
}

function extractDelegateOption(text, names) {
  let nextText = String(text || '').trim();
  let value = '';
  for (const name of names) {
    const pattern = new RegExp(`(?:^|\\s)${name}\\s+(.+?)(?=\\s+(?:scope|path|in|owner|access|mode|lane)\\b|$)`, 'i');
    const match = nextText.match(pattern);
    if (match) {
      value = String(match[1] || '').trim();
      nextText = `${nextText.slice(0, match.index)} ${nextText.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
      break;
    }
  }
  return { text: nextText, value };
}

function extractDelegateTokenOption(text, names) {
  let nextText = String(text || '').trim();
  let value = '';
  for (const name of names) {
    const pattern = new RegExp(`(?:^|\\s)${name}\\s+(\\S+)`, 'i');
    const match = nextText.match(pattern);
    if (match) {
      value = String(match[1] || '').trim();
      nextText = `${nextText.slice(0, match.index)} ${nextText.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
      break;
    }
  }
  return { text: nextText, value };
}

function normalizeDelegateRequest(transcript, command = 'delegate') {
  let raw = String(transcript || '').replace(new RegExp(`^/${command}\\b`, 'i'), '').trim();
  let mode = command === 'codex' || command === 'claude' ? command : '';
  if (command === 'delegate') {
    const tokens = raw.split(/\s+/).filter(Boolean);
    const requestedMode = normalizeDelegateModeForLoop(tokens[0] || '');
    if (requestedMode) {
      mode = requestedMode;
      raw = raw.replace(/^\S+\s*/u, '').trim();
    }
  }
  mode = mode || normalizeDelegateModeForLoop(argValue('delegate-mode', argValue('worker-mode', ''))) || 'background';
  let extracted = extractDelegateTokenOption(raw, ['scope', 'path', 'in']);
  raw = extracted.text;
  const scope = extracted.value;
  extracted = extractDelegateOption(raw, ['owner']);
  raw = extracted.text;
  const owner = extracted.value || ownerForDelegateMode(mode);
  extracted = extractDelegateTokenOption(raw, ['access']);
  raw = extracted.text;
  const access = normalizeDelegateAccessForLoop(extracted.value);
  const task = raw.trim();
  if (!task) {
    return {
      error: `Usage: /${command} <task> or /delegate codex scope <path> <task>`,
    };
  }
  return {
    task,
    mode,
    owner,
    scope,
    access,
    execute: loopExecuteRequested(),
    confirm: loopDelegateConfirmRequested(),
  };
}

function parseFileActionOutput(data = {}) {
  const raw = typeof data.output === 'string' ? data.output : '';
  if (!raw) return { raw: '' };
  try {
    return {
      ...JSON.parse(raw),
      raw,
    };
  } catch {
    return { raw };
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatFileEntryLine(entry = {}) {
  const name = entry.name || entry.path || '-';
  const type = entry.type || (entry.match ? 'match' : 'file');
  const size = entry.size !== undefined ? ` · ${formatBytes(entry.size)}` : '';
  const match = entry.match ? ` · ${compactText(entry.match, 80)}` : '';
  return `- ${type}${size}${match} · ${compactText(name, 180)}`;
}

function formatLoopFile(data = {}, request = {}) {
  const parsed = parseFileActionOutput(data);
  const action = request.action || '-';
  const pathLabel = parsed.path || request.path || '.';
  const lines = [
    `File: ${action} · path=${compactText(pathLabel, 220)}`,
  ];
  if (request.query) lines.push(`Query: ${compactText(request.query, 180)}`);
  if (action === 'list_directory') {
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    lines.push(`Result: ${entries.length} item(s) shown${parsed.truncated ? ' · truncated' : ''}`);
    lines.push(...entries.slice(0, 8).map(formatFileEntryLine));
  } else if (action === 'search_files') {
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    lines.push(`Result: ${results.length} match(es) shown${parsed.truncated ? ' · truncated' : ''}`);
    lines.push(...results.slice(0, 8).map(formatFileEntryLine));
  } else if (action === 'read_file') {
    const text = String(parsed.text || parsed.content || parsed.raw || data.output || '').trim();
    lines.push(`Result: ${text.length} char(s) previewed${parsed.truncated ? ' · truncated' : ''}`);
    if (text) lines.push(`Text: ${compactText(text, 900)}`);
  } else {
    lines.push(`Result: ${compactText(parsed.raw || data.output || '-', 900)}`);
  }
  if (data.error) lines.push(`Note: ${compactText(data.error, 220)}`);
  lines.push('Next: ask normally to summarize, organize, or hand this file context to a worker.');
  return lines.filter(Boolean).join('\n');
}

function formatLoopFileWorkflow(data = {}, request = {}) {
  const workflow = data.workflow || {};
  const routing = data.routing || {};
  const plan = data.plan || {};
  const counts = plan.counts || {};
  const pathLabel = plan.path || data.target?.path || request.path || '.';
  const optionText = [
    request.prefix ? `prefix=${request.prefix}` : '',
    request.suffix ? `suffix=${request.suffix}` : '',
    request.caseStyle ? `case=${request.caseStyle}` : '',
    request.targetExtension ? `to=${request.targetExtension}` : '',
    Array.isArray(request.extensions) && request.extensions.length ? `ext=${request.extensions.join(',')}` : '',
  ].filter(Boolean).join(' · ');
  const lines = [
    `File workflow: preview only · ${request.intent || data.intent || '-'} · path=${compactText(pathLabel, 220)}`,
  ];
  if (optionText) lines.push(`Options: ${compactText(optionText, 220)}`);
  lines.push(`Plan: steps ${counts.steps ?? 0} · blocked ${counts.blocked ?? 0} · approvals ${counts.approvals ?? 0}`);
  if (workflow.id || workflow.status) lines.push(`Workflow: ${workflow.status || '-'}${workflow.id ? ` · ${workflow.id}` : ''}`);
  if (routing.status || routing.lane || routing.mode) lines.push(`Route: ${routing.status || '-'} · ${routing.lane || routing.mode || '-'}`);
  lines.push(`Result: ${compactText(data.output || plan.output || plan.summary || '-', 700)}`);
  lines.push('Next: use /file read/search for evidence, or ask normally to execute a confirmed plan through policy.');
  return lines.filter(Boolean).join('\n');
}

function parseToolJsonOutput(data = {}) {
  const raw = typeof data.output === 'string' ? data.output : '';
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { output: raw };
  }
}

function formatLoopDelegate(data = {}, request = {}) {
  const payload = parseToolJsonOutput(data);
  const routing = payload.routing || {};
  const job = payload.job || {};
  const ownership = payload.ownership || {};
  const status = payload.status || (data.ok ? 'preview' : 'failed');
  const lines = [
    `Delegate: ${payload.previewOnly === false ? 'execution requested' : 'preview only'} · ${payload.mode || request.mode || '-'} · ${payload.owner || request.owner || '-'}`,
    `Task: ${compactText(payload.task || request.task || '-', 240)}`,
    `Scope: ${compactText(payload.scope || request.scope || '-', 220)} · access=${payload.access || request.access || '-'}`,
    `Status: ${status} · confirm=${payload.confirm ? 'yes' : 'no'} · queued=${payload.queued ? 'yes' : 'no'} · executed=${payload.executed ? 'yes' : 'no'}`,
  ];
  if (routing.id || routing.status) {
    lines.push(`Route: ${routing.status || '-'} · ${routing.lane || '-'}${routing.id ? ` · ${routing.id}` : ''}`);
  }
  if (job.id || job.status) {
    lines.push(`Job: ${job.status || '-'}${job.id ? ` · ${job.id}` : ''}`);
  }
  if (ownership.key || ownership.reason) {
    lines.push(`Ownership: ${ownership.access || '-'} · serialized=${ownership.serialized ? 'yes' : 'no'} · ${compactText(ownership.reason || ownership.key || '-', 240)}`);
  }
  lines.push(`Result: ${compactText(payload.spokenSummary || payload.output || data.output || '-', 520)}`);
  if (payload.requiresConfirmation) lines.push('Next: restart this loop with --run --confirm-delegate only when you want to start the worker.');
  if (!request.execute) lines.push('Next: restart this loop with --run to review the execution confirmation gate.');
  return lines.filter(Boolean).join('\n');
}

function loopUiUseModel() {
  return hasFlag('allow-cloud-ui') || hasFlag('model-ui') || hasFlag('ui-model');
}

function formatLoopApp(macData = {}, treeData = {}) {
  const context = macData.context || macData || {};
  const tree = treeData.tree || treeData || {};
  const frontmost = context.frontmost || {};
  const browser = context.browser || {};
  const screen = context.screen || {};
  const clipboard = context.clipboard || {};
  const outline = compactText(tree.outline || context.accessibility?.outline || '', 520);
  const lines = [
    `App: ${frontmost.app || tree.app || '-'} · ${compactText(frontmost.windowTitle || tree.windowTitle || '-', 180)}`,
    `Screen: ${screen.available ? `${screen.width || '-'}x${screen.height || '-'}` : 'metadata-only'}${screen.private ? ' · private' : ''}${screen.ageMs !== undefined ? ` · age ${screen.ageMs}ms` : ''}`,
    `Browser: ${browser.available ? 'available' : 'unavailable'} · ${browser.title ? compactText(browser.title, 120) : browser.host || browser.app || '-'}`,
    `Clipboard: ${clipboard.hasText ? `text ${clipboard.length || 0} char(s)` : 'no text attached'}`,
    `UI: ${tree.available ? 'available' : 'unavailable'} · app=${tree.app || '-'} · nodes=${tree.nodeCount ?? 0} · truncated=${tree.truncated ? 'yes' : 'no'}`,
  ];
  if (outline) lines.push(`Outline: ${outline}`);
  if (tree.error) lines.push(`Note: ${compactText(tree.error, 180)}`);
  return lines.join('\n');
}

function ambientLatestEvent(data = {}) {
  const recent = Array.isArray(data.ambient?.recent) ? data.ambient.recent : [];
  return recent[0] || {};
}

function formatLoopAppAmbient(data = {}) {
  const ambient = data.ambient || {};
  const event = ambientLatestEvent(data);
  const frontmost = event.frontmost || {};
  const browser = event.browser || {};
  const screen = event.screen || {};
  const ageMs = event.createdAt ? Math.max(0, Date.now() - Number(event.createdAt || 0)) : null;
  const lines = [
    `App: ${frontmost.app || '-'} · ${compactText(frontmost.windowTitle || '-', 180)}`,
    `Screen: ${screen.width && screen.height ? `${screen.width}x${screen.height}` : 'metadata-only'}${screen.privacyMode ? ` · ${screen.privacyMode}` : ''}${ageMs !== null ? ` · cached ${ageMs}ms` : ''}`,
    `Browser: ${browser.available ? 'available' : 'unavailable'} · ${browser.title ? compactText(browser.title, 120) : browser.app || '-'}`,
    'Clipboard: not read in fast mode',
    'UI: skipped in fast mode · add --full-app for live Accessibility outline',
  ];
  if (!ambient.enabled) lines.push('Note: ambient observation is disabled; add --full-app for a live read.');
  return lines.join('\n');
}

function normalizeBrowserWorkflowIntentForLoop(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    action: 'extract_actions',
    actions: 'extract_actions',
    todo: 'extract_actions',
    todos: 'extract_actions',
    question: 'ask',
    qa: 'ask',
    write: 'draft',
    fill: 'fill_draft',
    fill_form: 'fill_draft',
    form_fill: 'fill_draft',
    review: 'review_result',
  };
  const intent = aliases[raw] || raw;
  if (['summarize', 'extract_actions', 'draft', 'ask', 'act', 'fill_draft', 'search', 'compare', 'review_result', 'research'].includes(intent)) return intent;
  return '';
}

function normalizeBrowseRequest(transcript) {
  const raw = String(transcript || '').replace(/^\/browse\b/i, '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const firstIntent = normalizeBrowserWorkflowIntentForLoop(tokens[0] || '');
  const intent = firstIntent || argValue('browser-intent', 'extract_actions');
  const instruction = firstIntent ? raw.replace(/^\S+\s*/u, '').trim() : raw;
  const mode = argValue('browser-mode', argValue('mode', 'quick'));
  return {
    intent: normalizeBrowserWorkflowIntentForLoop(intent) || 'extract_actions',
    instruction,
    mode: ['quick', 'background', 'codex', 'claude'].includes(mode) ? mode : 'quick',
  };
}

function unwrapBrowserPayload(data = {}, key) {
  if (data && typeof data === 'object' && data[key] && typeof data[key] === 'object') return data[key];
  return data && typeof data === 'object' ? data : {};
}

function formatBrowserUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '-';
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 160);
  } catch {
    return compactText(url, 160);
  }
}

function formatLoopBrowser(contextData = {}, pageData = {}) {
  const context = unwrapBrowserPayload(contextData, 'context');
  const page = unwrapBrowserPayload(pageData, 'page');
  const available = page.available || context.available;
  const supported = page.supported || context.supported;
  const app = page.app || context.app || '-';
  const title = page.title || context.title || '';
  const url = page.url || context.url || '';
  const text = String(page.selectedText || page.text || page.metaDescription || '').trim();
  const headings = Array.isArray(page.headings) ? page.headings.filter(Boolean).slice(0, 3) : [];
  const links = Array.isArray(page.links) ? page.links.filter((link) => link?.href).slice(0, 3) : [];
  const error = page.error || context.error || '';
  const lines = [
    `Browser: ${available ? 'available' : 'unavailable'} · ${supported ? 'supported' : 'unsupported'} · ${app}`,
    `Page: ${title ? compactText(title, 180) : '-'} · ${formatBrowserUrl(url)}`,
  ];
  if (text) lines.push(`Text: ${compactText(text, 520)}`);
  if (headings.length) lines.push(`Headings: ${headings.map((item) => compactText(item, 80)).join(' | ')}`);
  if (links.length) {
    lines.push(`Links: ${links.map((link) => compactText(link.text || link.href, 80)).join(' | ')}`);
  }
  lines.push(`Length: ${Number(page.textLength || 0)} char(s)${page.truncated ? ' · truncated' : ''}`);
  if (error) lines.push(`Note: ${compactText(error, 180)}`);
  if (!available || !supported) lines.push('Next: bring Chrome, Safari, Arc, Edge, or Brave to the front, then run /browser again.');
  return lines.join('\n');
}

function formatLoopBrowserActivity(data = {}) {
  const activity = data.activity || {};
  const current = activity.current || {};
  const recent = Array.isArray(activity.recent) ? activity.recent : [];
  const topHosts = Array.isArray(activity.topHosts) ? activity.topHosts : [];
  const lines = [
    `Browser: ${current.app ? 'recent' : 'unavailable'} · metadata-only · ${current.app || '-'}`,
    `Page: ${current.title ? compactText(current.title, 180) : '-'} · ${current.host || '-'}`,
    `Recent: ${recent.length} page context(s) · hosts ${topHosts.length}`,
    'Text: not read in fast mode',
    'Length: 0 char(s) · metadata-only',
  ];
  if (recent.length) {
    lines.push(`Pages: ${recent.slice(0, 3).map((item) => compactText([item.host, item.title].filter(Boolean).join(' · '), 90)).join(' | ')}`);
  }
  if (activity.summary) lines.push(`Summary: ${compactText(activity.summary, 220)}`);
  lines.push(current.app ? 'Next: add --full-browser when a task needs visible page text.' : 'Next: bring Chrome, Safari, Arc, Edge, or Brave to the front, then run /browser again.');
  return lines.join('\n');
}

function normalizeOpenTarget(transcript) {
  const raw = String(transcript || '').replace(/^\/open\b/i, '').trim();
  if (!raw) return null;
  if (/^https?:\/\/\S+$/i.test(raw)) {
    return {
      kind: 'url',
      label: raw,
      transcript: `open ${raw}`,
    };
  }
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(raw)) {
    const url = `https://${raw}`;
    return {
      kind: 'url',
      label: url,
      transcript: `open ${url}`,
    };
  }
  return {
    kind: 'search',
    label: raw,
    transcript: `web search ${raw}`,
  };
}

function formatLoopOpen(data = {}, target = {}, execute = false) {
  const route = data.route || data.routePreview || {};
  const decision = route.decision || {};
  const rawLocalCommand = route.localCommand || decision.localCommand || data.routing?.localCommand || '';
  const localCommand = typeof rawLocalCommand === 'string'
    ? rawLocalCommand
    : rawLocalCommand?.intent || rawLocalCommand?.label || '';
  const lines = [
    `Open: ${execute ? 'execute requested' : 'preview only'} · ${target.kind || '-'} · ${compactText(target.label || '-', 220)}`,
    `Route: ${decision.label || data.routing?.label || route.output || '-'} · lane=${decision.lane || data.routing?.lane || '-'} · local=${localCommand || '-'}`,
    `Result: executed=${data.executed ? 'yes' : 'no'} · queued=${route.queued || data.routing?.status === 'queued' ? 'yes' : 'no'} · ${compactText(route.output || data.output || data.spokenAck || '-', 260)}`,
  ];
  if (!execute) lines.push('Next: restart this loop with --run when you want the same command to actually open.');
  return lines.join('\n');
}

function formatLoopBrowse(data = {}, request = {}, execute = false) {
  const page = data.page || data.workflow?.target || {};
  const workflow = data.workflow || {};
  const routing = data.routing || {};
  const lines = [
    `Browse: ${execute ? 'execute requested' : 'preview only'} · ${data.intent || request.intent || '-'} · mode=${data.mode || request.mode || '-'}`,
    `Page: ${page.title ? compactText(page.title, 160) : '-'} · ${formatBrowserUrl(page.url || '')}`,
    `Workflow: ${workflow.status || '-'}${workflow.id ? ` · ${workflow.id}` : ''}`,
    `Route: ${routing.status || '-'} · ${routing.lane || routing.mode || '-'}${routing.resultLink ? ` · ${routing.resultLink}` : ''}`,
    `Result: ${compactText(data.output || workflow.result || '-', 520)}`,
  ];
  if (page.error) lines.push(`Note: ${compactText(page.error, 220)}`);
  if (!execute) lines.push('Next: restart this loop with --run when you want this browser workflow to act or queue.');
  return lines.join('\n');
}

function formatLoopUi(data = {}, task = '', execute = false) {
  const plan = data.plan || data.run?.plan || {};
  const run = data.run || {};
  const workflow = data.workflow || run.workflow || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepText = steps.length
    ? steps.slice(0, 6).map((step, index) => `${index + 1}. ${step.type || '-'} · ${compactText(step.label || step.instruction || step.app || step.url || step.keys || '', 100)}`).join(' | ')
    : compactText(plan.reason || 'No safe UI steps planned.', 220);
  const lines = [
    `UI: ${execute ? 'execute requested' : 'preview only'} · source=${plan.source || '-'} · confidence=${plan.confidence ?? '-'}`,
    `Task: ${compactText(task || plan.instruction || '-', 220)}`,
    `Steps: ${stepText}`,
    `Result: ${compactText(data.output || run.output || workflow.result || plan.output || '-', 420)}`,
  ];
  if (workflow.id || workflow.status) lines.push(`Workflow: ${workflow.status || '-'}${workflow.id ? ` · ${workflow.id}` : ''}`);
  if (!execute) lines.push('Next: restart this loop with --run when you want this UI workflow to execute through normal policy gates.');
  return lines.join('\n');
}

function formatLoopStatus(data = {}) {
  if (data.pet?.lightweight) {
    const pet = data.pet || {};
    const readiness = data.readiness || {};
    const counts = readiness.counts || {};
    const voiceHealth = data.voiceHealth || {};
    const localVoice = data.localVoice || {};
    const fallback = voiceHealth.fallback || {};
    const queue = Array.isArray(data.queue) ? data.queue : [];
    const approvals = Array.isArray(data.approvals) ? data.approvals : [];
    const lines = [
      `Status: ${readiness.label || pet.label || pet.mode || 'unknown'} · ready ${counts.ready ?? '-'} / ${counts.total ?? '-'} · warning ${counts.warning ?? 0} · blocked ${counts.blocked ?? 0}`,
      `Pet: ${pet.color || pet.trafficLight?.color || '-'} · ${pet.label || pet.mode || '-'} · ${compactText(pet.summary || '-', 220)}`,
      `Realtime: ${voiceHealth.status || 'unknown'} · ${compactText(voiceHealth.summary || '-', 220)}`,
      `Local voice: ${localVoice.mode || localVoice.status || 'unknown'} · ${localVoice.input?.endpoint || fallback.endpoint || '/api/voice/command'}`,
      `Queue: active ${queue.length} · approvals ${approvals.length} · sessions ${data.sessions?.counts?.active ?? 0}`,
    ];
    if (pet.next || voiceHealth.next) lines.push(`Next: ${compactText(pet.next || voiceHealth.next, 220)}`);
    return lines.join('\n');
  }
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

function formatLoopVoiceStatus(data = {}) {
  const standby = data.standby || {};
  const provider = standby.provider || {};
  const local = standby.local || {};
  const primary = standby.primaryAction || {};
  const blocker = local.blocker || {};
  const recoveryActions = Array.isArray(standby.recoveryActions) ? standby.recoveryActions : [];
  const lines = [
    `Voice: ${standby.label || standby.mode || 'unknown'} · provider=${provider.status || '-'} · kind=${provider.kind || '-'} · ok=${provider.ok ? 'yes' : 'no'}`,
    `Primary: ${primary.label || primary.id || '-'} · mic=${primary.startsMicrophone ? 'yes' : 'no'} · realtime=${primary.usesRealtime ? 'yes' : 'no'} · terminal=${primary.opensTerminal ? 'yes' : 'no'}`,
    `Local fallback: ${local.mode || '-'} · ${local.input?.endpoint || '/api/voice/command'} · terminal=${local.interaction?.opensTerminal ? 'yes' : 'no'}`,
  ];
  if (provider.summary) lines.push(`Realtime: ${compactText(provider.summary, 260)}`);
  if (provider.subscriptionBoundary) lines.push(`Billing/API: ${compactText(provider.subscriptionBoundary, 260)}`);
  if (blocker.active) lines.push(`Blocker: ${blocker.kind || provider.kind || '-'} · ${compactText(blocker.summary || provider.summary || '', 240)}`);
  if (standby.next || provider.next || local.next) lines.push(`Next: ${compactText(standby.next || provider.next || local.next, 320)}`);
  if (recoveryActions.length) {
    lines.push('Recovery:');
    for (const action of recoveryActions.slice(0, 3)) {
      lines.push(`- ${action.label || action.id || '-'}: ${compactText(action.detail || action.command || action.url || '', 180)}`);
    }
  }
  lines.push('Safety: read-only; does not start microphone, Realtime, Terminal, screen capture, or raw audio storage.');
  return lines.filter(Boolean).join('\n');
}

function formatLoopPerceptionStatus(data = {}) {
  const perception = data.perception || {};
  const counts = perception.counts || {};
  const surfaces = Array.isArray(perception.surfaces) ? perception.surfaces : [];
  const byId = new Map(surfaces.map((surface) => [surface.id, surface]));
  const screen = byId.get('screen_context') || {};
  const ambient = byId.get('ambient_observer') || {};
  const browser = byId.get('browser_activity') || {};
  const ax = byId.get('accessibility_tree') || {};
  const screenEvidence = screen.evidence || {};
  const ambientEvidence = ambient.evidence || {};
  const lines = [
    `Perception: enabled ${counts.enabled ?? 0}/${counts.total ?? 0} · active ${counts.active ?? 0} · limited ${counts.limited ?? 0} · blocked ${counts.blocked ?? 0}`,
    `Screen: ${screen.status || '-'} · cached=${screen.available ? 'yes' : 'no'} · privacy=${screenEvidence.privacyMode || '-'}${screenEvidence.width ? ` · ${screenEvidence.width}x${screenEvidence.height} · age=${screenEvidence.ageMs ?? '-'}ms` : ''}`,
    `Ambient: ${ambient.status || '-'} · samples=${ambientEvidence.count ?? 0} · interval=${ambientEvidence.intervalMs ?? '-'}ms · latestApp=${ambientEvidence.latestApp || '-'}`,
    `Browser metadata: ${browser.status || '-'} · ${compactText(browser.summary || '-', 260)}`,
    `Accessibility: ${ax.status || '-'} · ${compactText(ax.summary || '-', 220)}`,
  ];
  if (screenEvidence.rulesSummary) lines.push(`Privacy rules: ${compactText(screenEvidence.rulesSummary, 260)}`);
  if (perception.summary) lines.push(`Summary: ${compactText(perception.summary, 260)}`);
  lines.push('Safety: read-only; does not capture a new screen frame, return images, read page text, read clipboard text, start microphone, or use Realtime.');
  return lines.filter(Boolean).join('\n');
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

function formatProgressAge(timestamp) {
  const raw = Number(timestamp || 0);
  const value = Number.isFinite(raw) && raw > 0 ? raw : Date.parse(timestamp || '');
  if (!Number.isFinite(value) || value <= 0) return '-';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatWorkerGroupForLoop(group = {}) {
  const counts = group.statusCounts || {};
  const pieces = [
    group.active ? `${group.active} active` : '',
    group.done ? `${group.done} done` : '',
    group.failed ? `${group.failed} failed` : '',
    counts.cancelled ? `${counts.cancelled} cancelled` : '',
  ].filter(Boolean).join(', ') || `${group.total ?? 0} tracked`;
  const skills = Array.isArray(group.skills) && group.skills.length
    ? ` · skills ${group.skills.slice(0, 2).map((item) => compactText(item, 48)).join(', ')}`
    : '';
  const next = group.nextAction ? ` · next ${compactText(group.nextAction, 120)}` : '';
  return `- ${group.owner || '-'} / ${group.lane || '-'} · ${compactText(group.parallelGroup || group.id || '-', 80)} · ${pieces} · ${formatProgressAge(group.latestUpdatedAt)}${skills}${next}`;
}

function formatProgressJobLine(job = {}) {
  const title = compactText(job.title || job.command || job.id || '-', 120);
  const result = compactText(job.result || job.output || job.error || job.log || '', 140);
  const detail = result ? ` · ${result}` : '';
  return `- ${job.mode || job.lane || 'job'} / ${job.status || '-'} · ${title} · ${formatProgressAge(job.updatedAt || job.createdAt)}${detail}`;
}

function formatProgressWorkflowLine(workflow = {}) {
  const title = compactText(workflow.title || workflow.intent || workflow.id || '-', 120);
  const result = compactText(workflow.result || workflow.output || workflow.error || workflow.request || '', 140);
  const detail = result ? ` · ${result}` : '';
  return `- ${workflow.kind || 'workflow'} / ${workflow.status || '-'} · ${title} · ${formatProgressAge(workflow.updatedAt || workflow.createdAt)}${detail}`;
}

function formatLoopJobs(data = {}) {
  const progress = data.progress || data || {};
  const counts = progress.counts || {};
  const jobCounts = counts.jobs || {};
  const workflowCounts = counts.workflows || {};
  const recoveryCounts = counts.recovery || progress.recovery?.counts || {};
  const activeJobs = Array.isArray(progress.activeJobs) ? progress.activeJobs : [];
  const recentJobs = Array.isArray(progress.recentJobs) ? progress.recentJobs : [];
  const workerGroups = Array.isArray(progress.workerGroups) ? progress.workerGroups : [];
  const blockedWorkflows = Array.isArray(progress.blockedWorkflows) ? progress.blockedWorkflows : [];
  const recentWorkflows = Array.isArray(progress.recentWorkflows) ? progress.recentWorkflows : [];
  const nextActions = Array.isArray(progress.nextActions) ? progress.nextActions : [];
  const latestDoneJob = progress.latestDone?.job || null;
  const latestDoneWorkflow = progress.latestDone?.workflow || null;
  const summary = progress.spokenSummary || progress.output || 'No progress summary available.';
  const lines = [
    `Jobs: running ${jobCounts.running ?? 0} · queued ${jobCounts.queued ?? 0} · done ${jobCounts.done ?? 0} · failed ${jobCounts.failed ?? 0} · cancelled ${jobCounts.cancelled ?? 0}`,
    `Workflows: running ${workflowCounts.running ?? 0} · blocked ${workflowCounts.blocked ?? 0} · failed ${workflowCounts.failed ?? 0} · done ${workflowCounts.done ?? 0}`,
    `Routes: active ${counts.activeRoutes ?? 0} · recovery ${recoveryCounts.recoverable ?? 0} recoverable · collab ${counts.collaboration?.active ?? 0} active`,
    `Summary: ${compactText(summary, 520)}`,
  ];

  if (workerGroups.length) {
    lines.push(`Workers: ${compactText(progress.workerSummary || `${workerGroups.length} worker group(s)`, 220)}`);
    lines.push(...workerGroups.slice(0, 3).map(formatWorkerGroupForLoop));
  } else {
    lines.push(`Workers: ${compactText(progress.workerSummary || 'No worker groups are active or recent.', 220)}`);
  }

  if (activeJobs.length) {
    lines.push('Active jobs:');
    lines.push(...activeJobs.slice(0, 3).map(formatProgressJobLine));
  } else if (recentJobs.length) {
    lines.push('Recent jobs:');
    lines.push(...recentJobs.slice(0, 2).map(formatProgressJobLine));
  }

  if (blockedWorkflows.length) {
    lines.push('Needs attention:');
    lines.push(...blockedWorkflows.slice(0, 3).map(formatProgressWorkflowLine));
  } else if (latestDoneJob || latestDoneWorkflow) {
    lines.push(`Latest done: ${compactText(latestDoneJob?.title || latestDoneWorkflow?.title || latestDoneJob?.id || latestDoneWorkflow?.id || '-', 160)}`);
  } else if (recentWorkflows.length) {
    lines.push('Recent workflows:');
    lines.push(...recentWorkflows.slice(0, 2).map(formatProgressWorkflowLine));
  }

  if (nextActions.length) {
    const next = nextActions[0] || {};
    lines.push(`Next: ${compactText(next.label || next.id || 'next action', 90)} · ${compactText(next.summary || next.instruction || '', 220)}`);
  }
  return lines.filter(Boolean).join('\n');
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

function formatLoopAutopilot(data = {}) {
  const payload = parseToolJsonOutput(data);
  const selected = payload.selectedAction || null;
  const first = payload.firstAction || null;
  const target = selected || first || {};
  const counts = payload.candidateCounts || {};
  const waiting = Array.isArray(payload.waitingFor) ? payload.waitingFor : [];
  const lines = [
    `Autopilot: ${payload.enabled ? 'enabled' : 'disabled'} · running=${payload.running ? 'yes' : 'no'} · busy=${payload.busy ? 'yes' : 'no'} · canActNow=${payload.canActNow ? 'yes' : 'no'}`,
    `Ticks: total ${payload.tickCount ?? 0} · executed ${payload.executedCount ?? 0} · skipped ${payload.skippedCount ?? 0}`,
    `Summary: ${compactText(payload.spokenSummary || payload.skipSummary || payload.nextWait || payload.output || '-', 520)}`,
  ];
  if (target.id || target.label) {
    lines.push(`Candidate: ${compactText(target.label || target.id, 120)} · source=${target.source || '-'} · executable=${target.executable ? 'yes' : 'no'} · reason=${target.decision?.reason || payload.reason || '-'}`);
  } else {
    lines.push('Candidate: none');
  }
  if (counts.total !== undefined) {
    lines.push(`Candidates: total ${counts.total || 0} · auto ${counts.autoExecutable || 0} · manual ${counts.manualOnly || 0} · blocked ${counts.blocked || 0}`);
  }
  if (waiting.length) {
    lines.push('Waiting for:');
    for (const item of waiting.slice(0, 3)) {
      lines.push(`- ${item.label || item.id || '-'}: ${compactText(item.summary || item.status || '', 180)}${item.waitLabel ? ` · wait ${item.waitLabel}` : ''}`);
    }
  }
  if (payload.maintenance) {
    lines.push(`Maintenance: due=${payload.maintenance.due ? 'yes' : 'no'} · runs=${payload.maintenance.runCount || 0}${payload.maintenance.lastSummary ? ` · ${compactText(payload.maintenance.lastSummary, 180)}` : ''}`);
  }
  lines.push('Safety: read-only; does not execute work-next, start workers, microphone, or Realtime.');
  return lines.filter(Boolean).join('\n');
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

function formatAutonomyLoop(data = {}) {
  const autonomy = data.autonomy || {};
  const route = autonomy.route || {};
  const agency = autonomy.agencyPlan || {};
  const primary = agency.primary || agency.nextActions?.[0] || {};
  const steps = Array.isArray(autonomy.steps) ? autonomy.steps : [];
  const lines = [
    `Agent: ${autonomy.status || 'preview'} · ${route.label || route.lane || '-'} · ${compactText(agency.spokenSummary || autonomy.nextAction || '-', 420)}`,
  ];
  if (route.contextPlan?.recommendedTools?.length) {
    lines.push(`Tools: ${route.contextPlan.recommendedTools.slice(0, 5).join(', ')}`);
  }
  if (primary.label || primary.id) {
    lines.push(`Primary: ${primary.label || primary.id} · source=${primary.source || '-'} · executable=${primary.executable ? 'yes' : 'no'} · user=${primary.requiresUser ? 'yes' : 'no'}`);
  }
  if (steps.length) {
    lines.push(`Steps: ${steps.slice(0, 5).map((step) => step.id || step.label).filter(Boolean).join(' -> ')}`);
  }
  lines.push(`Safety: bounded=${autonomy.safety?.bounded ? 'yes' : 'unknown'} · direct shell=${autonomy.safety?.noDirectShell ? 'no' : 'unknown'} · direct UI=${autonomy.safety?.noDirectUi ? 'no' : 'unknown'} · policy=${autonomy.safety?.usesExistingActionPolicy ? 'preserved' : 'unknown'}`);
  return lines.join('\n');
}

function commandOk(response, command) {
  if (!response.ok) return false;
  const data = response.data || {};
  if (data.ok === false) return false;
  if (command === 'handoff' && data.handoff?.ok === false) return false;
  if (command === 'next' && data.next?.ok === false) return false;
  if (command === 'history' && data.history?.ok === false) return false;
  if ((command === 'jobs' || command === 'progress') && data.progress?.ok === false) return false;
  if (command === 'agent' && data.autonomy?.ok === false) return false;
  return true;
}

function publicLoopCommandBase(base) {
  const { startedAt, ...publicBase } = base;
  return publicBase;
}

function loopCommandResult(base, response, output, details = {}) {
  return {
    ...publicLoopCommandBase(base),
    ...details,
    ok: commandOk(response, base.command),
    responseStatus: response.status,
    elapsedMs: Math.round(performance.now() - base.startedAt),
    apiElapsedMs: response.elapsedMs,
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
    startedAt: performance.now(),
    ok: true,
    responseStatus: 0,
    previewOnly: true,
    output: '',
    safety: loopSafety(),
  };

  try {
    if (command === 'help') {
      return {
        ...publicLoopCommandBase(base),
        elapsedMs: Math.round(performance.now() - base.startedAt),
        output: loopHelpText(),
      };
    }
    if (command === 'status') {
      const full = loopFullMode('status');
      const endpoint = full ? '/api/status' : '/api/pet/status';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopStatus(response.data || {}), {
        endpoint,
        detailLevel: full ? 'full' : 'fast',
      });
    }
    if (command === 'voice' || command === 'voice-status' || command === 'mic' || command === 'realtime') {
      const endpoint = '/api/voice/standby';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopVoiceStatus(response.data || {}), {
        endpoint,
        detailLevel: 'fast',
      });
    }
    if (command === 'see' || command === 'perception' || command === 'watch' || command === 'screen-status') {
      const endpoint = '/api/perception/consent?limit=5';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopPerceptionStatus(response.data || {}), {
        endpoint,
        detailLevel: 'fast',
      });
    }
    if (command === 'app') {
      const full = loopFullMode('app');
      if (!full) {
        const endpoint = '/api/ambient?limit=1';
        const response = await request(endpoint);
        return loopCommandResult(base, response, formatLoopAppAmbient(response.data || {}), {
          endpoint,
          detailLevel: 'fast',
        });
      }
      const [macResponse, treeResponse] = await Promise.all([
        request('/api/mac/context'),
        request('/api/accessibility/tree?maxNodes=40&maxDepth=4'),
      ]);
      return {
        ...publicLoopCommandBase(base),
        endpoint: '/api/mac/context + /api/accessibility/tree?maxNodes=40&maxDepth=4',
        detailLevel: 'full',
        ok: Boolean(macResponse.ok && treeResponse.ok && macResponse.data && treeResponse.data),
        responseStatus: macResponse.ok ? treeResponse.status : macResponse.status,
        elapsedMs: Math.round(performance.now() - base.startedAt),
        apiElapsedMs: Math.max(macResponse.elapsedMs || 0, treeResponse.elapsedMs || 0),
        output: formatLoopApp(macResponse.data || {}, treeResponse.data || {}),
      };
    }
    if (command === 'ui') {
      const task = normalizeUiTask(transcript);
      if (!task) {
        return {
          ...publicLoopCommandBase(base),
          ok: false,
          elapsedMs: Math.round(performance.now() - base.startedAt),
          output: 'Usage: /ui <local app/UI task>',
        };
      }
      const execute = loopExecuteRequested();
      const response = await request('/api/app/plan', {
        method: 'POST',
        body: {
          instruction: task,
          execute,
          useModel: loopUiUseModel(),
          maxNodes: 120,
          maxDepth: 6,
          continueOnError: false,
          source: execute ? 'local_voice_loop_ui_execute' : 'local_voice_loop_ui_preview',
        },
      });
      return {
        ...publicLoopCommandBase(base),
        endpoint: '/api/app/plan',
        detailLevel: execute ? 'execute' : 'preview',
        previewOnly: !execute,
        task,
        ok: Boolean(response.ok && response.data),
        responseStatus: response.status,
        elapsedMs: Math.round(performance.now() - base.startedAt),
        apiElapsedMs: response.elapsedMs,
        safety: {
          ...loopSafety(),
          readOnly: !execute,
        },
        output: formatLoopUi(response.data || {}, task, execute),
      };
    }
    if (command === 'file' || command === 'files') {
      const fileRequest = normalizeFileRequest(transcript);
      if (fileRequest.error) {
        return {
          ...publicLoopCommandBase(base),
          command: 'file',
          ok: false,
          elapsedMs: Math.round(performance.now() - base.startedAt),
          output: fileRequest.error,
        };
      }
      if (fileRequest.kind === 'workflow') {
        const response = await request('/api/files/workflow', {
          method: 'POST',
          body: {
            intent: fileRequest.intent,
            path: fileRequest.path,
            mode: 'quick',
            instruction: `Preview ${fileRequest.intent} for ${fileRequest.path}`,
            maxEntries: fileRequest.maxEntries,
            maxMoves: fileRequest.maxMoves,
            maxFiles: fileRequest.maxFiles,
            prefix: fileRequest.prefix,
            suffix: fileRequest.suffix,
            caseStyle: fileRequest.caseStyle,
            extensions: fileRequest.extensions,
            targetExtension: fileRequest.targetExtension,
            conversionMode: fileRequest.conversionMode,
            source: 'local_voice_loop_file_workflow_preview',
            scope: `local_voice_loop:file:${fileRequest.intent}`,
            parallelGroup: 'local_voice_loop:file',
          },
        });
        return loopCommandResult(base, response, formatLoopFileWorkflow(response.data || {}, fileRequest), {
          command: 'file',
          endpoint: '/api/files/workflow',
          detailLevel: 'preview',
          workflowIntent: fileRequest.intent,
          filePath: fileRequest.path,
        });
      }
      const response = await request('/api/files/execute', {
        method: 'POST',
        body: {
          action: fileRequest.action,
          path: fileRequest.path,
          query: fileRequest.query,
          maxEntries: fileRequest.maxEntries,
          maxResults: fileRequest.maxResults,
          maxBytes: fileRequest.maxBytes,
        },
      });
      return loopCommandResult(base, response, formatLoopFile(response.data || {}, fileRequest), {
        command: 'file',
        endpoint: '/api/files/execute',
        detailLevel: 'fast',
        fileAction: fileRequest.action,
        filePath: fileRequest.path,
        query: fileRequest.query || '',
      });
    }
    if (command === 'browser') {
      const full = loopFullMode('browser');
      if (!full) {
        const endpoint = '/api/browser/activity?limit=4';
        const response = await request(endpoint);
        return loopCommandResult(base, response, formatLoopBrowserActivity(response.data || {}), {
          endpoint,
          detailLevel: 'fast',
        });
      }
      const [contextResponse, pageResponse] = await Promise.all([
        request('/api/browser/context'),
        request('/api/browser/page?maxChars=1200'),
      ]);
      const output = formatLoopBrowser(contextResponse.data || {}, pageResponse.data || {});
      return {
        ...publicLoopCommandBase(base),
        endpoint: '/api/browser/context + /api/browser/page?maxChars=1200',
        detailLevel: 'full',
        ok: Boolean(contextResponse.ok && pageResponse.ok && contextResponse.data && pageResponse.data),
        responseStatus: contextResponse.ok ? pageResponse.status : contextResponse.status,
        elapsedMs: Math.round(performance.now() - base.startedAt),
        apiElapsedMs: Math.max(contextResponse.elapsedMs || 0, pageResponse.elapsedMs || 0),
        output,
      };
    }
    if (command === 'open') {
      const target = normalizeOpenTarget(transcript);
      if (!target) {
        return {
          ...publicLoopCommandBase(base),
          ok: false,
          elapsedMs: Math.round(performance.now() - base.startedAt),
          output: 'Usage: /open <https://example.com | example.com | search terms>',
        };
      }
      const execute = loopExecuteRequested();
      const payload = {
        ...buildPayload({ loop: true, transcript: target.transcript }),
        execute,
        includeScreen: false,
        includeAccessibility: false,
        speak: false,
        confirmSpeak: false,
        session: false,
        sessionGoal: '',
        sessionTitle: '',
        source: execute ? 'local_voice_loop_open_execute' : 'local_voice_loop_open_preview',
      };
      const response = await request('/api/voice/command', {
        method: 'POST',
        body: payload,
      });
      return loopCommandResult(base, response, formatLoopOpen(response.data || {}, target, execute), {
        endpoint: '/api/voice/command',
        detailLevel: execute ? 'execute' : 'preview',
        previewOnly: !execute,
        target: target.label,
        targetKind: target.kind,
        safety: {
          ...loopSafety(),
          readOnly: !execute,
        },
      });
    }
    if (command === 'browse') {
      const browseRequest = normalizeBrowseRequest(transcript);
      const execute = loopExecuteRequested();
      const response = await request('/api/browser/workflow', {
        method: 'POST',
        body: {
          intent: browseRequest.intent,
          mode: browseRequest.mode,
          instruction: browseRequest.instruction,
          execute,
          source: execute ? 'local_voice_loop_browser_workflow_execute' : 'local_voice_loop_browser_workflow_preview',
          scope: `local_voice_loop:browser:${browseRequest.intent}`,
          parallelGroup: 'local_voice_loop:browser',
          maxChars: 12000,
        },
      });
      return {
        ...publicLoopCommandBase(base),
        endpoint: '/api/browser/workflow',
        detailLevel: execute ? 'execute' : 'preview',
        previewOnly: !execute,
        intent: browseRequest.intent,
        mode: browseRequest.mode,
        ok: Boolean(response.ok && response.data),
        responseStatus: response.status,
        elapsedMs: Math.round(performance.now() - base.startedAt),
        apiElapsedMs: response.elapsedMs,
        safety: {
          ...loopSafety(),
          readOnly: !execute,
        },
        output: formatLoopBrowse(response.data || {}, browseRequest, execute),
      };
    }
    if (command === 'delegate' || command === 'codex' || command === 'claude') {
      const delegateRequest = normalizeDelegateRequest(transcript, command);
      if (delegateRequest.error) {
        return {
          ...publicLoopCommandBase(base),
          command,
          ok: false,
          elapsedMs: Math.round(performance.now() - base.startedAt),
          output: delegateRequest.error,
        };
      }
      const response = await request('/api/tools/execute', {
        method: 'POST',
        body: {
          source: delegateRequest.execute
            ? delegateRequest.confirm ? 'local_voice_loop_delegate_execute_confirmed' : 'local_voice_loop_delegate_execute_gate'
            : 'local_voice_loop_delegate_preview',
          name: 'delegate_task',
          arguments: {
            task: delegateRequest.task,
            mode: delegateRequest.mode,
            owner: delegateRequest.owner,
            scope: delegateRequest.scope,
            access: delegateRequest.access,
            execute: delegateRequest.execute,
            confirm: delegateRequest.confirm,
          },
        },
      });
      const payload = parseToolJsonOutput(response.data || {});
      return loopCommandResult(base, response, formatLoopDelegate(response.data || {}, delegateRequest), {
        command,
        endpoint: '/api/tools/execute',
        detailLevel: delegateRequest.execute ? 'execute_gate' : 'preview',
        previewOnly: payload.previewOnly !== false,
        delegateMode: delegateRequest.mode,
        delegateOwner: delegateRequest.owner,
        delegateScope: delegateRequest.scope || payload.scope || '',
        delegateStatus: payload.status || '',
        safety: {
          ...loopSafety(),
          readOnly: payload.previewOnly !== false,
        },
      });
    }
    if (command === 'handoff') {
      const response = await request('/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900');
      return loopCommandResult(base, response, formatLoopHandoff(response.data || {}), {
        endpoint: '/api/work/handoff?jobLimit=6&workflowLimit=6&nextLimit=3&followUpLimit=3&maxChars=900',
        detailLevel: 'full',
      });
    }
    if (command === 'jobs' || command === 'progress') {
      const endpoint = '/api/work/progress?jobLimit=5&workflowLimit=5';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopJobs(response.data || {}), {
        endpoint,
        detailLevel: 'fast',
      });
    }
    if (command === 'next') {
      const full = loopFullMode('next');
      const endpoint = full
        ? '/api/work/next?workflowLimit=6&jobLimit=6'
        : '/api/work/next?workflowLimit=2&jobLimit=2&compact=true';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopNext(response.data || {}), {
        endpoint,
        detailLevel: full ? 'full' : 'fast',
      });
    }
    if (command === 'auto' || command === 'autopilot' || command === 'agency') {
      const response = await request('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'local_voice_loop_autopilot_status',
          name: 'get_autopilot_status',
          arguments: {
            source: 'local_voice_loop',
            workflowLimit: 6,
            jobLimit: 6,
          },
        },
      });
      return loopCommandResult(base, response, formatLoopAutopilot(response.data || {}), {
        command,
        endpoint: '/api/tools/execute',
        detailLevel: 'fast',
      });
    }
    if (command === 'history') {
      const endpoint = '/api/voice/history?limit=5';
      const response = await request(endpoint);
      return loopCommandResult(base, response, formatLoopHistory(response.data || {}), {
        endpoint,
        detailLevel: 'fast',
      });
    }
    if (command === 'agent') {
      const task = String(transcript || '').replace(/^\/agent\b/i, '').trim();
      if (!task) {
        return {
          ...publicLoopCommandBase(base),
          ok: false,
          elapsedMs: Math.round(performance.now() - base.startedAt),
          output: 'Usage: /agent <task to think through>',
        };
      }
      const response = await request('/api/autonomy/run', {
        method: 'POST',
        body: {
          task,
          execute: false,
          observe: true,
          includeAccessibility: false,
          captureScreen: false,
          useMemory: hasFlag('use-memory'),
          maxSteps: loopAgentStepLimit(),
          source: 'local_voice_loop_agent_preview',
        },
      });
      return loopCommandResult(base, response, formatAutonomyLoop(response.data || {}), {
        endpoint: '/api/autonomy/run',
        detailLevel: loopFullMode('agent') ? 'full' : 'fast',
        agentSteps: loopAgentStepLimit(),
      });
    }
    return {
      ...publicLoopCommandBase(base),
      ok: false,
      elapsedMs: Math.round(performance.now() - base.startedAt),
      output: `Unknown loop command: ${name}\n\n${loopHelpText()}`,
    };
  } catch (error) {
    return {
      ...publicLoopCommandBase(base),
      ok: false,
      elapsedMs: Math.round(performance.now() - base.startedAt),
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
        console.log(`Latency: ${loopCommand.elapsedMs ?? '-'}ms${loopCommand.apiElapsedMs !== undefined ? ` · api=${loopCommand.apiElapsedMs}ms` : ''}`);
        console.log(`Safety: read-only=${loopCommand.safety?.readOnly === false ? 'no' : 'yes'} · microphone=no · realtime=no · raw audio=no`);
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
      elapsedMs: result.elapsedMs,
      apiElapsedMs: result.apiElapsedMs,
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
      console.log(`Latency: ${result.elapsedMs ?? '-'}ms`);
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
