import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

function parseJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in output.');
  return JSON.parse(raw.slice(start, end + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readIdleSpeechState(ctx) {
  await ctx.api('/api/speech/stop', {
    method: 'POST',
    body: { reason: 'eval_speech_state_cleanup' },
    timeoutMs: 10000,
  });

  let state = await ctx.api('/api/speech/state', { timeoutMs: 10000 });
  for (let attempt = 0; attempt < 5 && state.ok && state.data?.speech?.speaking === true; attempt += 1) {
    await sleep(200);
    state = await ctx.api('/api/speech/state', { timeoutMs: 10000 });
  }
  return state;
}

export default {
  lane: 'speech',
  async run(ctx) {
    const out = [];

    const state = await readIdleSpeechState(ctx);
    const speech = state.data?.speech || {};
    out.push(
      state.ok &&
        speech.available === true &&
        speech.commandAvailable === true &&
        speech.enabled === true &&
        speech.speaking === false
        ? ok('speech.state', 'Local speech state', `say=${speech.commandAvailable ? 'available' : 'missing'} speaking=${speech.speaking ? 'yes' : 'no'}`)
        : fail('speech.state', 'Local speech state', `GET /api/speech/state ${state.status}`, state.data),
    );

    const preview = await ctx.api('/api/speech/say', {
      method: 'POST',
      body: {
        text: 'JAVIS local speech preview.',
        dryRun: true,
        source: 'eval_speech_preview',
      },
      timeoutMs: 10000,
    });
    const previewData = preview.data || {};
    out.push(
      preview.ok &&
        previewData.ok === true &&
        previewData.dryRun === true &&
        previewData.speaking === false &&
        previewData.command === '/usr/bin/say' &&
        previewData.textLength > 0
        ? ok('speech.preview', 'Local speech dry-run', `rate=${previewData.rate || '-'} voice=${previewData.voice || 'default'}`)
        : fail('speech.preview', 'Local speech dry-run', `POST /api/speech/say ${preview.status}`, preview.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/local-speech-dogfood.mjs', '--json'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      const dogfood = parseJson(stdout);
      out.push(
        dogfood.ok === true &&
          dogfood.previewOnly === true &&
          dogfood.execute === false &&
          dogfood.safety?.startsMicrophone === false &&
          dogfood.safety?.callsOpenAI === false &&
          dogfood.safety?.speaksAudio === false &&
          dogfood.say?.dryRun === true
          ? ok('speech.dogfood_preview', 'Local speech dogfood preview', 'preview validates local TTS without microphone, OpenAI, or audio output')
          : fail('speech.dogfood_preview', 'Local speech dogfood preview', 'dogfood preview missing safety markers', dogfood),
      );
    } catch (error) {
      out.push(fail('speech.dogfood_preview', 'Local speech dogfood preview', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
