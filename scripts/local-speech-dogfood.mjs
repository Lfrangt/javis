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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const execute = hasFlag('execute');
  const confirm = hasFlag('confirm');
  return {
    text: argValue('text', 'JAVIS local speech dogfood.'),
    rate: Number(argValue('rate', '190')),
    voice: argValue('voice', ''),
    dryRun: !(execute && confirm),
    source: execute && confirm ? 'dogfood_local_speech_execute' : 'dogfood_local_speech_preview',
  };
}

async function main() {
  const payload = buildPayload();
  const before = await request('/api/speech/state');
  const say = await request('/api/speech/say', {
    method: 'POST',
    body: payload,
  });
  let after = null;
  let stopped = null;
  if (say.ok && !payload.dryRun) {
    const stopAfterMs = Math.max(250, Math.min(8000, Number(argValue('stop-after-ms', '1600'))));
    await sleep(stopAfterMs);
    stopped = await request('/api/speech/stop', {
      method: 'POST',
      body: { reason: 'dogfood_local_speech_complete' },
    });
    after = await request('/api/speech/state');
  }

  const result = {
    ok: Boolean(before.ok && say.ok && (payload.dryRun || stopped?.ok)),
    apiBase: API_BASE,
    execute: !payload.dryRun,
    previewOnly: Boolean(payload.dryRun),
    before: before.data?.speech || before.data || {},
    say: say.data || {},
    stopped: stopped?.data || null,
    after: after?.data?.speech || after?.data || null,
    safety: {
      startsMicrophone: false,
      callsOpenAI: false,
      speaksAudio: !payload.dryRun,
      autoStopsSpeech: !payload.dryRun,
      storesRawAudio: false,
    },
  };

  if (hasFlag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('JAVIS Local Speech Dogfood');
    console.log('==========================');
    console.log(`API: ${API_BASE}`);
    console.log(`Mode: ${payload.dryRun ? 'preview' : 'execute'} · ok=${result.ok ? 'yes' : 'no'}`);
    console.log(`Speech: available=${result.before.available ? 'yes' : 'no'} · command=${result.before.commandAvailable ? 'yes' : 'no'} · enabled=${result.before.enabled ? 'yes' : 'no'}`);
    console.log(`Safety: microphone=no · OpenAI=no · speaksAudio=${result.safety.speaksAudio ? 'yes' : 'no'}`);
    if (!say.ok) console.log(`Error: HTTP ${say.status}`);
    if (result.say?.rate) console.log(`Voice: ${result.say.voice || 'system default'} · rate=${result.say.rate}`);
  }

  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
