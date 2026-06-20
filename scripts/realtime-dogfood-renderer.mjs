#!/usr/bin/env node
// Trigger and watch a real renderer/WebRTC Realtime dogfood run.
//
// Safe default: preview only. To start the microphone/WebRTC path, pass both:
//   --execute --confirm-mic

import fs from 'node:fs';

import { makeContext } from './eval/_client.mjs';

const args = process.argv.slice(2);

function hasFlag(name) {
  return args.includes(name);
}

function option(name, fallback = '') {
  const prefix = `${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function numberOption(name, fallback, min, max) {
  const value = Number(option(name, ''));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function promptOptions() {
  const repeated = args
    .filter((arg) => arg.startsWith('--prompt='))
    .map((arg) => arg.slice('--prompt='.length).trim())
    .filter(Boolean);
  const joined = option('--prompts', '')
    .split(/\n|;;/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...repeated, ...joined].slice(0, 8);
}

async function loadPackPromptScript(ctx, limit) {
  const response = await ctx.api(`/api/realtime/dogfood/pack?promptLimit=${encodeURIComponent(String(limit))}`, {
    timeoutMs: 30000,
  });
  const script = response.data?.pack?.prompts?.script;
  if (!response.ok || !Array.isArray(script)) {
    throw new Error(`Prompt script load failed: ${response.status} ${response.error || JSON.stringify(response.data)?.slice(0, 500)}`);
  }
  return script
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(32, Number(limit || 24))));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastEvent(rendererDogfood, type) {
  const events = Array.isArray(rendererDogfood?.events) ? rendererDogfood.events : [];
  return [...events].reverse().find((event) => event.type === type || event.status === type) || null;
}

function summarizeEvidence(evidence = {}) {
  const checks = evidence.checks || {};
  return [
    `status=${evidence.status || '-'} phase=${evidence.phase || '-'}`,
    `negotiated=${checks.sessionNegotiated ? 'yes' : 'no'}`,
    `live=${checks.voiceSessionLive ? 'yes' : 'no'}`,
    `progress=${checks.progressInjectedFromRenderer ? 'yes' : 'no'}`,
    `sync=${checks.progressVersionSynced ? 'yes' : 'no'}`,
  ].join(' ');
}

function evidenceBlockerLine(evidence = {}) {
  const blocker = evidence.blocker || {};
  const summary = String(blocker.summary || '').trim();
  const nextAction = String(blocker.nextAction || evidence.nextAction || '').trim();
  if (!summary && !nextAction) return '';
  return [
    summary ? `blocker=${summary}` : '',
    nextAction ? `next=${nextAction}` : '',
  ].filter(Boolean).join(' · ');
}

function summarizeAcceptance(acceptance = {}) {
  const counts = acceptance.counts || {};
  const nextGap = acceptance.nextGap || {};
  const parts = [
    `accepted=${acceptance.accepted ? 'yes' : 'no'}`,
    `status=${acceptance.status || '-'}`,
    `gates=${Number(counts.passed || 0)}/${Number(counts.gates || 0)}`,
  ];
  if (nextGap.id) parts.push(`next=${nextGap.group || '-'}/${nextGap.id}`);
  return parts.join(' ');
}

function summarizeAcceptanceLiveGates(acceptance = {}) {
  const wanted = new Set(['start_live_voice', 'inject_worker_progress', 'sync_latest_progress', 'ask_progress']);
  const gates = Array.isArray(acceptance.gates) ? acceptance.gates : [];
  const rows = gates
    .filter((gate) => wanted.has(gate.id))
    .map((gate) => `${gate.id}=${gate.ok ? 'yes' : 'no'}`);
  return rows.length ? rows.join(' ') : '';
}

function summarizePreflight(preflight = {}) {
  const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
  return [
    `preflight=${preflight.status || '-'}`,
    `ready=${preflight.readyToStart ? 'yes' : 'no'}`,
    `renderer=${preflight.rendererAvailable ? 'ready' : 'missing'}`,
    `provider=${preflight.providerReady ? 'ready' : 'not-ready'}`,
    blockers[0]?.id ? `blocker=${blockers[0].id}` : '',
  ].filter(Boolean).join(' ');
}

async function pollRun(ctx, runId, timeoutMs, options = {}) {
  const waitForAcceptance = options.waitForAcceptance === true;
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const [rendererRes, evidenceRes, acceptanceRes] = await Promise.all([
      ctx.api('/api/realtime/dogfood/renderer', { timeoutMs: 15000 }),
      ctx.api('/api/realtime/evidence', { timeoutMs: 15000 }),
      ctx.api('/api/realtime/dogfood/acceptance?auditLimit=20&source=renderer_dogfood_poll', { timeoutMs: 15000 }),
    ]);
    const rendererDogfood = rendererRes.data?.rendererDogfood || {};
    const evidence = evidenceRes.data?.evidence || {};
    const acceptance = acceptanceRes.data?.acceptance || {};
    latest = { rendererDogfood, evidence, acceptance };
    const live = lastEvent(rendererDogfood, 'live');
    const promptSent = lastEvent(rendererDogfood, 'prompt_sent');
    const terminal = ['stopped', 'done', 'error', 'timeout'].includes(rendererDogfood.status);
    const blockerLine = evidence.phase === 'provider_attention' ? evidenceBlockerLine(evidence) : '';
    const acceptanceLine = acceptance.counts
      ? `${summarizeAcceptance(acceptance)} ${summarizeAcceptanceLiveGates(acceptance)}`.trim()
      : '';
    console.log([
      `${new Date().toLocaleTimeString()} run=${runId.slice(0, 8)} renderer=${rendererDogfood.status || '-'} prompt=${promptSent ? 'sent' : 'pending'} ${summarizeEvidence(evidence)}`,
      acceptanceLine,
      blockerLine,
    ].filter(Boolean).join(' · '));
    if (acceptance.accepted === true) {
      return { ok: true, timeout: false, acceptanceReady: true, ...latest };
    }
    if (rendererDogfood.status === 'error' || rendererDogfood.status === 'timeout') {
      return { ok: false, timeout: false, providerBlocked: evidence.phase === 'provider_attention', ...latest };
    }
    if (!waitForAcceptance && live && promptSent && evidence.checks?.sessionNegotiated && evidence.checks?.voiceSessionLive && evidence.checks?.progressInjectedFromRenderer) {
      return { ok: true, timeout: false, ...latest };
    }
    if (!waitForAcceptance && terminal && live && promptSent) return { ok: true, timeout: false, ...latest };
    await sleep(3000);
  }
  return { ok: false, timeout: true, ...latest };
}

async function saveArchive(ctx, note) {
  const result = await ctx.api('/api/realtime/dogfood/archive', {
    method: 'POST',
    timeoutMs: 30000,
    body: {
      source: 'renderer_dogfood_script',
      note,
      auditLimit: 50,
    },
  });
  const filePath = result.data?.archive?.file?.path || result.data?.filePath || '';
  if (!result.ok || !filePath || !fs.existsSync(filePath)) {
    throw new Error(`Archive save failed: ${result.status} ${result.error || JSON.stringify(result.data)?.slice(0, 500)}`);
  }
  return filePath;
}

async function loadAcceptance(ctx, { saveArchive: shouldSaveArchive, note }) {
  const result = shouldSaveArchive
    ? await ctx.api('/api/realtime/dogfood/acceptance', {
        method: 'POST',
        timeoutMs: 30000,
        body: {
          source: 'renderer_dogfood_script',
          note,
          auditLimit: 50,
          saveArchive: true,
        },
      })
    : await ctx.api('/api/realtime/dogfood/acceptance?auditLimit=50&source=renderer_dogfood_script', {
        timeoutMs: 30000,
      });
  const acceptance = result.data?.acceptance || {};
  const archive = result.data?.archive || {};
  const filePath = archive.file?.path || acceptance.archive?.file || '';
  if (!result.ok) {
    throw new Error(`Acceptance report failed: ${result.status} ${result.error || JSON.stringify(result.data)?.slice(0, 500)}`);
  }
  if (shouldSaveArchive && (!filePath || !fs.existsSync(filePath))) {
    throw new Error(`Acceptance archive save failed: ${filePath || 'missing archive path'}`);
  }
  return {
    acceptance,
    archive,
    filePath,
    saved: Boolean(result.data?.saved || archive.saved),
  };
}

async function main() {
  const execute = hasFlag('--execute');
  const confirmMic = hasFlag('--confirm-mic');
  const save = !hasFlag('--no-save-archive');
  const acceptanceEnabled = !hasFlag('--no-acceptance');
  const requireAcceptance = hasFlag('--require-acceptance');
  const acceptanceOnly = hasFlag('--acceptance-only');
  const ctx = makeContext();

  if (acceptanceOnly) {
    const acceptanceReport = await loadAcceptance(ctx, {
      saveArchive: save,
      note: 'renderer dogfood acceptance-only snapshot',
    });
    console.log(`Acceptance: ${summarizeAcceptance(acceptanceReport.acceptance)}`);
    if (acceptanceReport.acceptance?.nextGap?.nextAction) {
      console.log(`Acceptance next action: ${acceptanceReport.acceptance.nextGap.nextAction}`);
    }
    if (acceptanceReport.filePath) console.log(`${acceptanceReport.saved ? 'Archive' : 'Archive preview'}: ${acceptanceReport.filePath}`);
    if (requireAcceptance && acceptanceReport.acceptance?.accepted !== true) {
      console.error('Realtime dogfood evidence did not pass all acceptance gates.');
      process.exitCode = 1;
    }
    return;
  }

  const promptLimit = numberOption('--prompt-limit', requireAcceptance ? 32 : 24, 1, 32);
  const explicitPrompts = promptOptions();
  const shouldUsePromptScript = hasFlag('--prompt-script') || hasFlag('--full-prompt-script') || requireAcceptance;
  const prompts = explicitPrompts.length
    ? explicitPrompts
    : shouldUsePromptScript
      ? await loadPackPromptScript(ctx, promptLimit)
      : [];
  const body = {
    execute,
    confirmMic,
    prepareProgress: true,
    prepareWhenLive: true,
    durationMs: numberOption('--duration-ms', 45000, 5000, 120000),
    promptDelayMs: numberOption('--prompt-delay-ms', 35000, 0, 180000),
    betweenPromptsMs: numberOption('--between-prompts-ms', 9000, 1000, 60000),
    stopAfterMs: numberOption('--stop-after-ms', execute ? (requireAcceptance ? 0 : 20000) : 0, 0, 300000),
    promptLimit,
    prompts,
    source: 'renderer_dogfood_script',
  };

  if (execute && !confirmMic) {
    console.error('Refusing to start microphone. Pass --confirm-mic together with --execute.');
    process.exitCode = 2;
    return;
  }

  const start = await ctx.api('/api/realtime/dogfood/renderer/start', {
    method: 'POST',
    timeoutMs: 30000,
    body,
  });
  if (!start.ok) {
    console.error(start.data?.output || start.data?.error || start.error || `HTTP ${start.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(start.data?.output || 'Renderer dogfood preview ready.');
  if (start.data?.preflight) {
    console.log(`Preflight: ${summarizePreflight(start.data.preflight)}`);
    if (start.data.preflight.nextAction) console.log(`Preflight next action: ${start.data.preflight.nextAction}`);
  }
  if (!execute) {
    console.log('Preview only. Re-run with --execute --confirm-mic to start the real renderer/WebRTC path.');
    return;
  }

  const runId = start.data?.runId || start.data?.rendererDogfood?.runId || '';
  const timeoutMs = numberOption('--timeout-ms', 150000, 30000, 600000);
  const result = await pollRun(ctx, runId, timeoutMs, { waitForAcceptance: requireAcceptance });
  let archivePath = '';
  let acceptanceReport = null;
  if (acceptanceEnabled) {
    acceptanceReport = await loadAcceptance(ctx, {
      saveArchive: save,
      note: result.ok ? 'renderer dogfood script reached live evidence' : 'renderer dogfood script incomplete',
    });
    archivePath = acceptanceReport.filePath;
    console.log(`Acceptance: ${summarizeAcceptance(acceptanceReport.acceptance)}`);
    if (acceptanceReport.acceptance?.nextGap?.nextAction) {
      console.log(`Acceptance next action: ${acceptanceReport.acceptance.nextGap.nextAction}`);
    }
    if (archivePath) console.log(`${acceptanceReport.saved ? 'Archive' : 'Archive preview'}: ${archivePath}`);
  } else if (save) {
    archivePath = await saveArchive(ctx, result.ok ? 'renderer dogfood script passed' : 'renderer dogfood script incomplete');
    console.log(`Archive: ${archivePath}`);
  }
  if (!result.ok) {
    const blockerLine = evidenceBlockerLine(result.evidence);
    if (result.providerBlocked && blockerLine) {
      console.error(`Realtime provider blocked: ${blockerLine}`);
    }
    console.error(result.timeout ? 'Timed out waiting for renderer dogfood evidence.' : 'Renderer dogfood did not reach ready evidence.');
    process.exitCode = 1;
    return;
  }
  console.log(result.acceptanceReady
    ? 'Renderer Realtime dogfood acceptance passed.'
    : 'Renderer Realtime dogfood evidence reached live + prompt + progress injection.');
  if (requireAcceptance && acceptanceReport?.acceptance?.accepted !== true) {
    console.error('Realtime dogfood evidence did not pass all acceptance gates.');
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
