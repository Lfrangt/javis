import { ok, warn, fail } from '../_client.mjs';

// Background worker observability (ROADMAP: "persist background task history",
// "cancellable background workers with visible logs", "replayable audit log").
// Read-only — inspects history, autopilot status, the unified progress view,
// and the audit log without starting or cancelling any work.
export default {
  lane: 'workers',
  async run(ctx) {
    const out = [];

    const jobs = await ctx.api('/api/jobs?limit=5');
    const list = jobs.data?.jobs?.items || jobs.data?.jobs || (Array.isArray(jobs.data) ? jobs.data : null);
    if (!jobs.ok || !Array.isArray(list)) {
      out.push(fail('workers.jobs', 'Job history', `GET /api/jobs ${jobs.status} ${jobs.error || ''}`));
    } else {
      const counts = jobs.data?.counts || {};
      out.push(ok('workers.jobs', 'Job history', `${list.length} recent · ${counts.total ?? list.length} total · running=${counts.running ?? 0}`, { counts }));
      // Visible logs + cancellability are part of the worker contract.
      const sample = list[0];
      const hasContract = sample && 'log' in sample && 'status' in sample && 'cancelRequested' in sample;
      out.push(
        sample
          ? (hasContract
            ? ok('workers.contract', 'Worker fields', 'jobs carry status, visible log, and cancelRequested')
            : warn('workers.contract', 'Worker fields', `job missing one of status/log/cancelRequested (${Object.keys(sample).slice(0, 8).join(',')})`))
          : warn('workers.contract', 'Worker fields', 'no jobs yet to inspect the worker contract'),
      );
    }

    const autopilot = await ctx.api('/api/autopilot');
    const ap = autopilot.data?.autopilot;
    out.push(
      autopilot.ok && ap && typeof ap.tickCount === 'number'
        ? ok('workers.autopilot', 'Autopilot status', `enabled=${ap.enabled} running=${ap.running} ticks=${ap.tickCount} executed=${ap.executedCount} skipped=${ap.skippedCount}${ap.lastError ? ` lastError=${String(ap.lastError).slice(0, 40)}` : ''}`)
        : warn('workers.autopilot', 'Autopilot status', `GET /api/autopilot ${autopilot.status} ${autopilot.error || ''}`),
    );

    const progress = await ctx.api('/api/work/progress');
    const p = progress.data?.progress;
    out.push(
      progress.ok && p
        ? ok('workers.progress', 'Unified progress', `activeJobs=${(p.activeJobs || []).length} blockedWorkflows=${(p.blockedWorkflows || []).length} nextActions=${(p.nextActions || []).length}`)
        : warn('workers.progress', 'Unified progress', `GET /api/work/progress ${progress.status} ${progress.error || ''}`),
    );

    const audit = await ctx.api('/api/audit/recent?limit=5');
    const events = audit.data?.events;
    out.push(
      audit.ok && Array.isArray(events)
        ? ok('workers.audit', 'Audit log', `${events.length} recent audit event(s) (replayable)`)
        : warn('workers.audit', 'Audit log', `GET /api/audit/recent ${audit.status} ${audit.error || ''}`),
    );

    return out;
  },
};
