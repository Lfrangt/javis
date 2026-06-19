import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ok, fail, skip } from '../_client.mjs';

const LIVE_FLAG = 'JAVIS_EVAL_REALTIME_DOGFOOD';
const DEFAULT_TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importRealtimeProgressModule() {
  const sourcePath = path.resolve('src/realtimeProgress.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });
  const tempPath = path.join(os.tmpdir(), `javis-realtime-dogfood-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tempPath, compiled.outputText);
  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function jobFromResult(item = {}) {
  return item.job || null;
}

function progressGroupsFor(progress = {}, parallelGroup = '') {
  return (progress.workerGroups || []).filter((group) => group.parallelGroup === parallelGroup);
}

function groupsContainJobs(groups = [], jobs = []) {
  const ids = new Set(groups.flatMap((group) => (group.jobs || []).map((job) => job.id)));
  return jobs.every((job) => ids.has(job.id));
}

async function waitForProgressGroup(ctx, parallelGroup, jobs, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const res = await ctx.api('/api/work/progress?jobLimit=12&workflowLimit=6', { timeoutMs: 10000 });
    if (res.ok && res.data?.progress) {
      latest = res.data.progress;
      const groups = progressGroupsFor(latest, parallelGroup);
      if (groups.length && (!jobs.length || groupsContainJobs(groups, jobs))) return latest;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return latest;
}

async function waitForJobs(ctx, jobs, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let latest = jobs;
  while (Date.now() < deadline) {
    const fetched = await Promise.all(jobs.map(async (job) => {
      const res = await ctx.api(`/api/jobs/${encodeURIComponent(job.id)}`, { timeoutMs: 10000 });
      return res.ok && res.data?.job ? res.data.job : job;
    }));
    latest = fetched;
    if (fetched.every((job) => ['done', 'failed', 'cancelled'].includes(job.status))) return fetched;
    await sleep(POLL_INTERVAL_MS);
  }
  return latest;
}

function liveWorkerTasks() {
  return [
    {
      task: 'Realtime dogfood Codex read-only worker: inspect package.json and return one sentence about the available verification scripts. Do not write files, edit files, or commit.',
      mode: 'codex',
      owner: 'dogfood-codex-read',
      scope: 'package.json',
      access: 'read',
    },
    {
      task: 'Realtime dogfood Claude read-only worker: inspect docs/GOAL.md and return one sentence about the resident voice-agent objective. Do not write files, edit files, or commit.',
      mode: 'claude',
      owner: 'dogfood-claude-read',
      scope: 'docs/GOAL.md',
      access: 'read',
    },
    {
      command: 'node --check scripts/eval/checks/realtime-live-dogfood.mjs && echo javis-realtime-dogfood-local-ok',
      title: 'Realtime dogfood local CLI read-only worker',
      mode: 'cli',
      owner: 'dogfood-local-cli',
      scope: 'scripts/eval/checks/realtime-live-dogfood.mjs',
      access: 'read',
      timeoutMs: 60000,
    },
  ];
}

export default {
  lane: 'realtime-live-dogfood',
  async run(ctx) {
    const out = [];

    if (process.env[LIVE_FLAG] !== 'true') {
      out.push(skip(
        'realtime_live_dogfood.opt_in',
        'Realtime live worker dogfood',
        `set ${LIVE_FLAG}=true to queue real read-only Codex, Claude, and local CLI workers during a simulated live Realtime session`,
      ));
      return out;
    }

    const mod = await importRealtimeProgressModule();
    const before = await ctx.api('/api/conversation/state');
    const previous = before.data?.conversation || {};
    const hadActiveUserSession = Boolean(previous.active);
    const sessionId = hadActiveUserSession
      ? previous.sessionId
      : `eval-realtime-live-dogfood-${Date.now()}`;
    const parallelGroup = `eval-realtime-live-dogfood-${Date.now()}`;
    let jobs = [];
    const liveStartedAt = Date.now();

    try {
      if (!hadActiveUserSession) {
        await ctx.api('/api/conversation/state', {
          method: 'POST',
          body: { status: 'connecting', sessionId, micMode: 'open', source: 'eval_realtime_live_dogfood' },
        });
        await ctx.api('/api/conversation/state', {
          method: 'POST',
          body: { status: 'live', sessionId, micMode: 'open', source: 'eval_realtime_live_dogfood' },
        });
      }

      const route = await ctx.api('/api/tasks/parallel', {
        method: 'POST',
        timeoutMs: 30000,
        body: {
          execute: true,
          parallelGroup,
          source: 'eval_realtime_live_dogfood',
          tasks: liveWorkerTasks(),
        },
      });
      const results = Array.isArray(route.data?.results) ? route.data.results : [];
      jobs = results.map(jobFromResult).filter(Boolean);
      const queuedModes = new Set(jobs.map((job) => job.mode));
      const queuedOk = route.ok && jobs.length === 3 && ['codex', 'claude', 'cli'].every((mode) => queuedModes.has(mode));
      out.push(
        queuedOk
          ? ok('realtime_live_dogfood.queued', 'Live worker batch queued', `queued ${Array.from(queuedModes).join(', ')} under ${parallelGroup}`)
          : fail('realtime_live_dogfood.queued', 'Live worker batch queued', `expected codex, claude, cli jobs; got ${Array.from(queuedModes).join(', ') || 'none'}`, route.data),
      );
      if (!queuedOk) return out;

      const progress = await waitForProgressGroup(ctx, parallelGroup, jobs);
      const groups = progressGroupsFor(progress || {}, parallelGroup);
      const progressOk = Boolean(progress && groups.length && groupsContainJobs(groups, jobs));
      out.push(
        progressOk
          ? ok('realtime_live_dogfood.progress_group', 'Live grouped worker progress', `${progress.workerSummary}; dogfoodGroups=${groups.length}`)
          : fail('realtime_live_dogfood.progress_group', 'Live grouped worker progress', 'progress did not expose the live worker group in time', { parallelGroup, workerGroups: progress?.workerGroups }),
      );
      if (!progressOk) return out;

      const context = mod.realtimeWorkProgressContext(progress, liveStartedAt);
      const hasContext = context.includes('Silent JAVIS background work progress update')
        && context.includes('Worker summary:')
        && context.includes(parallelGroup);
      out.push(
        hasContext
          ? ok('realtime_live_dogfood.context', 'Realtime context from live workers', 'live worker progress produced passive Realtime context')
          : fail('realtime_live_dogfood.context', 'Realtime context from live workers', 'live worker progress did not produce expected Realtime context', { context }),
      );

      const evidence = mod.realtimeProgressInjectionEvidence(progress, context);
      const record = await ctx.api('/api/realtime/progress-injection', {
        method: 'POST',
        body: {
          source: 'eval_realtime_live_dogfood',
          sessionId,
          transport: 'eval-simulated-live',
          dataChannelReadyState: 'open',
          eventType: 'conversation.item.create',
          eventRole: 'user',
          contentType: 'input_text',
          forcedResponse: false,
          responseActive: false,
          voiceStatus: 'live',
          micMode: 'open',
          screenLive: false,
          ...evidence,
        },
      });
      const recorded = record.data?.conversation?.lastRealtimeProgressInjection;
      out.push(
        record.ok &&
          recorded?.sessionId === sessionId &&
          recorded?.workerSummary === evidence.workerSummary &&
          recorded?.transport === 'eval-simulated-live' &&
          recorded?.dataChannelReadyState === 'open' &&
          recorded?.forcedResponse === false
          ? ok('realtime_live_dogfood.injection_evidence', 'Realtime injection evidence', `recorded ${recorded.workerSummary}`)
          : fail('realtime_live_dogfood.injection_evidence', 'Realtime injection evidence', `record failed ${record.status}`, record.data),
      );

      const spokenSummary = String(progress.spokenSummary || '');
      const spokenOk = spokenSummary.length > 0
        && spokenSummary.length <= 420
        && /worker|后台/i.test(spokenSummary)
        && progress.workerSummary.includes('worker group');
      out.push(
        spokenOk
          ? ok('realtime_live_dogfood.spoken_summary', 'Short spoken progress answer', spokenSummary)
          : fail('realtime_live_dogfood.spoken_summary', 'Short spoken progress answer', 'progress did not expose a short voice-ready summary', { spokenSummary, workerSummary: progress.workerSummary }),
      );

      const completed = await waitForJobs(ctx, jobs);
      const allDone = completed.every((job) => job.status === 'done');
      out.push(
        allDone
          ? ok('realtime_live_dogfood.completed', 'Live worker cleanup', `all ${completed.length} read-only worker job(s) completed`)
          : fail('realtime_live_dogfood.completed', 'Live worker cleanup', 'one or more dogfood workers did not complete', completed.map((job) => ({
            id: job.id,
            mode: job.mode,
            status: job.status,
            failureKind: job.failureKind,
            log: String(job.log || '').slice(-800),
          }))),
      );
    } finally {
      if (!hadActiveUserSession) {
        await ctx.api('/api/conversation/state', {
          method: 'POST',
          body: {
            status: 'idle',
            sessionId,
            micMode: previous.micMode || 'open',
            screenLive: false,
            source: 'eval_realtime_live_dogfood_restore',
            clearRealtimeProgressInjection: true,
          },
        });
      }
    }

    return out;
  },
};
