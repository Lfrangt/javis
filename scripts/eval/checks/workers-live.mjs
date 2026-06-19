import { ok, warn, fail, skip } from '../_client.mjs';

const LIVE_FLAG = 'JAVIS_EVAL_LIVE_WORKERS';
const DEFAULT_TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobFromResult(item = {}) {
  return item.job || null;
}

function jobHasEvidence(job = {}) {
  return Boolean(
    job.id
      && job.status
      && 'log' in job
      && 'cancelRequested' in job
      && Array.isArray(job.attempts)
      && (job.log || job.result || job.failureKind),
  );
}

function groupsContainJobs(groups = [], jobs = []) {
  const ids = new Set(groups.flatMap((group) => (group.jobs || []).map((job) => job.id)));
  return jobs.every((job) => ids.has(job.id));
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

export default {
  lane: 'workers-live',
  async run(ctx) {
    const out = [];

    if (process.env[LIVE_FLAG] !== 'true') {
      out.push(skip(
        'workers_live.opt_in',
        'Live mixed worker batch',
        `set ${LIVE_FLAG}=true to queue real read-only Codex, Claude, and local CLI workers`,
      ));
      return out;
    }

    const parallelGroup = `eval-workers-live-${Date.now()}`;
    const response = await ctx.api('/api/tasks/parallel', {
      method: 'POST',
      timeoutMs: 30000,
      body: {
        execute: true,
        parallelGroup,
        source: 'eval_workers_live',
        tasks: [
          {
            task: 'Read-only Codex smoke: inspect package.json and scripts/eval/README.md, then return two concise bullets. Do not write files, edit files, or commit.',
            mode: 'codex',
            owner: 'eval-codex-read',
            scope: 'package.json scripts/eval/README.md',
            access: 'read',
          },
          {
            task: 'Read-only Claude smoke: inspect docs/ROADMAP.md and docs/OPERATIONS.md, then return two concise bullets. Do not write files, edit files, or commit.',
            mode: 'claude',
            owner: 'eval-claude-read',
            scope: 'docs/ROADMAP.md docs/OPERATIONS.md',
            access: 'read',
          },
          {
            command: 'node --check scripts/eval/checks/parallel.mjs && echo javis-workers-live-local-ok',
            title: 'Read-only local CLI smoke',
            mode: 'cli',
            owner: 'eval-local-cli',
            scope: 'scripts/eval/checks/parallel.mjs',
            access: 'read',
            timeoutMs: 60000,
          },
        ],
      },
    });

    const data = response.data;
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!response.ok || results.length !== 3) {
      out.push(fail('workers_live.route', 'Live worker routing', `POST /api/tasks/parallel ${response.status} ${response.error || data?.error || ''}`, data));
      return out;
    }

    out.push(ok(
      'workers_live.route',
      'Live worker routing',
      `${results.length} worker route(s), group=${parallelGroup}`,
      { counts: data.counts, ownership: data.ownership },
    ));

    const jobs = results.map(jobFromResult).filter(Boolean);
    const expectedModes = new Set(['codex', 'claude', 'cli']);
    const queuedModes = new Set(jobs.map((job) => job.mode));
    const allModesQueued = jobs.length === 3 && Array.from(expectedModes).every((mode) => queuedModes.has(mode));
    out.push(
      allModesQueued
        ? ok('workers_live.queued', 'Mixed worker jobs', `queued ${Array.from(queuedModes).join(', ')}`)
        : fail('workers_live.queued', 'Mixed worker jobs', `expected codex, claude, cli jobs; got ${Array.from(queuedModes).join(', ') || 'none'}`, results),
    );
    if (!allModesQueued) return out;

    const progressDuring = await ctx.api('/api/work/progress', { timeoutMs: 10000 });
    const p = progressDuring.data?.progress;
    out.push(
      progressDuring.ok && p && Array.isArray(p.activeJobs) && Array.isArray(p.recentJobs)
        ? ok('workers_live.progress_during', 'Progress while running', `active=${p.activeJobs.length}, recent=${p.recentJobs.length}`)
        : warn('workers_live.progress_during', 'Progress while running', `GET /api/work/progress ${progressDuring.status} ${progressDuring.error || ''}`),
    );

    const completed = await waitForJobs(ctx, jobs, DEFAULT_TIMEOUT_MS);
    const done = completed.filter((job) => job.status === 'done');
    const failed = completed.filter((job) => job.status === 'failed');
    out.push(
      done.length === completed.length
        ? ok('workers_live.completed', 'Worker completion', `all ${completed.length} read-only worker job(s) completed`)
        : fail('workers_live.completed', 'Worker completion', `${done.length}/${completed.length} done, ${failed.length} failed`, completed.map((job) => ({
          id: job.id,
          mode: job.mode,
          status: job.status,
          failureKind: job.failureKind,
          result: String(job.result || '').slice(0, 400),
          log: String(job.log || '').slice(-800),
        }))),
    );

    const evidenceOk = completed.every(jobHasEvidence);
    out.push(
      evidenceOk
        ? ok('workers_live.logs', 'Worker logs and attempts', 'all live worker jobs expose log, attempts, status, and cancelRequested')
        : fail('workers_live.logs', 'Worker logs and attempts', 'one or more jobs are missing observable worker evidence', completed),
    );

    const progressAfter = await ctx.api('/api/work/progress', { timeoutMs: 10000 });
    const after = progressAfter.data?.progress;
    const recentIds = new Set((after?.recentJobs || []).map((job) => job.id));
    const progressHasJobs = completed.every((job) => recentIds.has(job.id));
    out.push(
      progressAfter.ok && progressHasJobs
        ? ok('workers_live.progress_after', 'Progress after completion', 'work progress includes all live worker jobs in recentJobs')
        : fail('workers_live.progress_after', 'Progress after completion', 'work progress did not surface every completed live worker job', {
          jobIds: completed.map((job) => job.id),
          recentIds: Array.from(recentIds),
        }),
    );
    const groups = Array.isArray(after?.workerGroups) ? after.workerGroups : [];
    const groupsHaveJobs = groupsContainJobs(groups, completed);
    const hasSummary = typeof after?.workerSummary === 'string' && after.workerSummary.includes('worker group');
    out.push(
      progressAfter.ok && groupsHaveJobs && hasSummary
        ? ok('workers_live.progress_groups', 'Grouped worker progress', `${after.workerSummary}; groups=${groups.length}`)
        : fail('workers_live.progress_groups', 'Grouped worker progress', 'work progress did not group every live worker job by owner/lane/group', {
          workerSummary: after?.workerSummary,
          workerGroups: groups,
          jobIds: completed.map((job) => job.id),
        }),
    );

    return out;
  },
};
