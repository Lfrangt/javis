import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseToolOutput(response) {
  try {
    return JSON.parse(response.data?.output || '{}');
  } catch {
    return null;
  }
}

async function waitForJob(ctx, id, timeoutMs = 10000) {
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    const response = await ctx.api(`/api/jobs/${encodeURIComponent(id)}`, { retries: 0 });
    latest = response.data?.job || null;
    if (latest && !['queued', 'running'].includes(latest.status)) return latest;
    await sleep(250);
  }
  return latest;
}

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
    const autopilotDecision = autopilot.data?.decisionPreview || ap?.lastDecision || null;
    out.push(
      autopilot.ok && ap && typeof ap.tickCount === 'number'
        ? ok('workers.autopilot', 'Autopilot status', `enabled=${ap.enabled} running=${ap.running} ticks=${ap.tickCount} executed=${ap.executedCount} skipped=${ap.skippedCount}${ap.lastError ? ` lastError=${String(ap.lastError).slice(0, 40)}` : ''}`)
        : warn('workers.autopilot', 'Autopilot status', `GET /api/autopilot ${autopilot.status} ${autopilot.error || ''}`),
    );
    out.push(
      autopilot.ok &&
        autopilotDecision &&
        typeof autopilotDecision.outcome === 'string' &&
        typeof autopilotDecision.nextWait === 'string' &&
        typeof autopilotDecision.skipSummary === 'string' &&
        autopilotDecision.candidateCounts &&
        typeof autopilotDecision.candidateCounts.total === 'number' &&
        typeof autopilotDecision.candidateCounts.autoExecutable === 'number' &&
        Array.isArray(autopilotDecision.waitingFor) &&
        Array.isArray(autopilotDecision.candidates) &&
        autopilotDecision.candidates.every((candidate) => candidate.id && candidate.decision && typeof candidate.decision.reason === 'string')
        ? ok('workers.autopilot_decision_evidence', 'Autopilot decision evidence', `${autopilotDecision.outcome}${autopilotDecision.reason ? `/${autopilotDecision.reason}` : ''} · ${autopilotDecision.candidateCounts.autoExecutable} auto / ${autopilotDecision.candidateCounts.total} candidate(s) · waiting=${autopilotDecision.waitingFor.length}`)
        : fail('workers.autopilot_decision_evidence', 'Autopilot decision evidence', 'autopilot did not expose structured decision preview/candidates/waiting conditions', autopilot.data),
    );
    try {
      const { stdout } = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-autopilot'], {
        cwd: process.cwd(),
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      out.push(
        stdout.includes('Candidate counts:') &&
          stdout.includes('Waiting for:') &&
          stdout.includes('Why waiting:')
          ? ok('workers.autopilot_cui_waiting', 'Autopilot CUI waiting conditions', 'config CUI prints candidate counts and waiting conditions')
          : fail('workers.autopilot_cui_waiting', 'Autopilot CUI waiting conditions', 'expected --print-autopilot to show candidate counts and waiting conditions', { output: stdout.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('workers.autopilot_cui_waiting', 'Autopilot CUI waiting conditions', error instanceof Error ? error.message : String(error)));
    }
    out.push(
      autopilot.ok && ap?.maintenance && typeof ap.maintenance.minIntervalMs === 'number'
        ? ok('workers.autopilot_maintenance_state', 'Autopilot maintenance state', `due=${ap.maintenance.due} last=${ap.maintenance.lastSnapshotAt || 0}`)
        : warn('workers.autopilot_maintenance_state', 'Autopilot maintenance state', 'autopilot did not expose maintenance cooldown state'),
    );

    const maintenancePreview = await ctx.api('/api/work/next', {
      method: 'POST',
      timeoutMs: 45000,
      body: {
        execute: false,
        actionId: 'maintenance:resident_snapshot',
        includeMaintenance: true,
        forceMaintenance: true,
        source: 'eval',
      },
    });
    const maintenance = maintenancePreview.data?.next;
    out.push(
      maintenancePreview.ok &&
        maintenance?.action?.source === 'maintenance' &&
        maintenance.action.autoEligible === true &&
        maintenance.action.autopilotEligible === true &&
        maintenance.action.riskLevel === 0 &&
        maintenance.executed === false &&
        /maintenance snapshot/i.test(String(maintenance.output || ''))
        ? ok('workers.autopilot_maintenance_preview', 'Autopilot maintenance fallback', `${maintenance.action.label} · ${maintenance.action.cooldown}`)
        : fail('workers.autopilot_maintenance_preview', 'Autopilot maintenance fallback', 'work-next did not expose a read-only maintenance fallback preview', maintenancePreview.data),
    );

    let recoveryJobId = '';
    try {
      const queuedRecoveryFixture = await ctx.api('/api/cli/run', {
        method: 'POST',
        body: {
          command: 'node -e "console.error(\'intentional recovery contract failure\'); process.exit(7)"',
          title: 'Recoverable worker contract check',
          source: 'eval_recovery_contract',
          scope: 'eval:worker_recovery_contract',
          parallelGroup: 'eval_recovery_contract',
          timeoutMs: 10000,
        },
        retries: 0,
      });
      recoveryJobId = queuedRecoveryFixture.data?.job?.id || '';
      const failedJob = recoveryJobId ? await waitForJob(ctx, recoveryJobId) : null;
      const recoveryPlan = failedJob?.recoveryPlan || {};
      out.push(
        queuedRecoveryFixture.ok &&
          failedJob?.status === 'failed' &&
          failedJob.failureKind === 'command_failed' &&
          Array.isArray(failedJob.attempts) &&
          failedJob.attempts.length >= 2 &&
          recoveryPlan.diagnostics?.runtime &&
          recoveryPlan.nextActions?.some((action) => action.type === 'diagnose') &&
          recoveryPlan.nextActions?.some((action) => action.type === 'retry')
          ? ok('workers.recovery_plan_contract', 'Worker recovery plan contract', `${failedJob.failureKind} · ${recoveryPlan.nextActions.length} recovery action(s)`, { jobId: recoveryJobId, recoveryPlan })
          : fail('workers.recovery_plan_contract', 'Worker recovery plan contract', 'failed job did not preserve attempts, diagnostics, and recovery actions', { queued: queuedRecoveryFixture.data, failedJob }),
      );

      const recoverySnapshot = await ctx.api('/api/jobs/recovery?includeInternal=true&limit=20');
      const recovery = recoverySnapshot.data?.recovery;
      const recoveryItem = Array.isArray(recovery?.items) ? recovery.items.find((item) => item.id === recoveryJobId) : null;
      out.push(
        recoverySnapshot.ok &&
          recoveryItem &&
          recoveryItem.failureKind === 'command_failed' &&
          recoveryItem.recovery?.recommended?.id?.startsWith(`recovery:${recoveryJobId}:`) &&
          recoveryItem.recovery?.nextActions?.some((action) => action.recoveryType === 'diagnose') &&
          recoveryItem.recovery?.nextActions?.some((action) => action.recoveryType === 'retry') &&
          recoveryItem.recovery?.nextActions?.some((action) => action.recoveryType === 'retry' && action.trustedAutoEligible === true) &&
          recovery?.counts?.recoverable >= 1
          ? ok('workers.recovery_snapshot', 'Worker recovery snapshot', `${recovery.counts.recoverable} recoverable failed job(s); next=${recoveryItem.recovery.recommended.label}`)
          : fail('workers.recovery_snapshot', 'Worker recovery snapshot', 'recovery snapshot did not expose the failed job and recommended action', recovery),
      );

      const recoveryProgress = await ctx.api('/api/work/progress?includeInternal=true&jobLimit=20');
      const progressRecovery = recoveryProgress.data?.progress?.recovery;
      out.push(
        recoveryProgress.ok &&
          progressRecovery?.items?.some((item) => item.id === recoveryJobId) &&
          progressRecovery?.counts?.recoverable >= 1
          ? ok('workers.recovery_progress', 'Recovery in work progress', recoveryProgress.data.progress.spokenSummary || progressRecovery.summary)
          : fail('workers.recovery_progress', 'Recovery in work progress', 'work progress did not include recoverable worker evidence', recoveryProgress.data),
      );

      const recoveryPreview = await ctx.api(`/api/jobs/${encodeURIComponent(recoveryJobId)}/recovery/run`, {
        method: 'POST',
        body: {
          execute: false,
          recoveryType: 'retry',
          source: 'eval_recovery_contract',
        },
        retries: 0,
      });
      out.push(
        recoveryPreview.ok &&
          recoveryPreview.data?.ok === true &&
          recoveryPreview.data?.executed === false &&
          recoveryPreview.data?.queued === false &&
          recoveryPreview.data?.action?.recoveryType === 'retry' &&
          recoveryPreview.data?.action?.id === `recovery:${recoveryJobId}:retry` &&
          /recovery job/i.test(String(recoveryPreview.data?.output || ''))
          ? ok('workers.recovery_action_preview', 'Worker recovery action preview', `${recoveryPreview.data.action.id} previewed`)
          : fail('workers.recovery_action_preview', 'Worker recovery action preview', 'job-level recovery preview did not expose the selected retry action', recoveryPreview.data),
      );

      const recoveryDiagnose = await ctx.api(`/api/jobs/${encodeURIComponent(recoveryJobId)}/recovery/run`, {
        method: 'POST',
        body: {
          execute: true,
          recoveryType: 'diagnose',
          source: 'eval_recovery_contract',
        },
        retries: 0,
      });
      const diagnosedJob = recoveryJobId ? await ctx.api(`/api/jobs/${encodeURIComponent(recoveryJobId)}`, { retries: 0 }) : null;
      out.push(
        recoveryDiagnose.ok &&
          recoveryDiagnose.data?.ok === true &&
          recoveryDiagnose.data?.executed === true &&
          recoveryDiagnose.data?.queued === false &&
          recoveryDiagnose.data?.action?.recoveryType === 'diagnose' &&
          /Recovery action reviewed via work_next: diagnose/.test(String(diagnosedJob?.data?.job?.log || ''))
          ? ok('workers.recovery_action_execute', 'Worker recovery action execute', 'diagnose action recorded against failed job without queueing a child worker')
          : fail('workers.recovery_action_execute', 'Worker recovery action execute', 'diagnose recovery action did not execute safely against the failed job', { recoveryDiagnose: recoveryDiagnose.data, diagnosedJob: diagnosedJob?.data }),
      );

      const recoveryVoiceTool = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'run_worker_recovery',
          arguments: {
            jobId: recoveryJobId,
            recoveryType: 'retry',
            execute: false,
          },
        },
        retries: 0,
      });
      const recoveryVoiceOutput = parseToolOutput(recoveryVoiceTool);
      out.push(
        recoveryVoiceTool.ok &&
          recoveryVoiceTool.data?.ok === true &&
          recoveryVoiceOutput?.ok === true &&
          recoveryVoiceOutput?.executed === false &&
          recoveryVoiceOutput?.action?.recoveryType === 'retry' &&
          recoveryVoiceOutput?.job?.id === recoveryJobId
          ? ok('workers.recovery_voice_tool', 'Worker recovery voice tool', 'run_worker_recovery can target a specific failed job without executing by default')
          : fail('workers.recovery_voice_tool', 'Worker recovery voice tool', 'run_worker_recovery did not preview the selected failed-job recovery action', recoveryVoiceTool.data),
      );
    } finally {
      if (recoveryJobId) {
        await ctx.api(`/api/jobs/${encodeURIComponent(recoveryJobId)}`, {
          method: 'DELETE',
          retries: 0,
        });
      }
    }

    const progress = await ctx.api('/api/work/progress');
    const p = progress.data?.progress;
    out.push(
      progress.ok && p
        ? ok('workers.progress', 'Unified progress', `activeJobs=${(p.activeJobs || []).length} blockedWorkflows=${(p.blockedWorkflows || []).length} workerGroups=${(p.workerGroups || []).length} nextActions=${(p.nextActions || []).length}`)
        : warn('workers.progress', 'Unified progress', `GET /api/work/progress ${progress.status} ${progress.error || ''}`),
    );
    out.push(
      progress.ok && p && Array.isArray(p.workerGroups) && typeof p.workerSummary === 'string'
        ? ok('workers.progress_groups', 'Worker progress groups', `${p.workerSummary || 'empty summary'}`)
        : warn('workers.progress_groups', 'Worker progress groups', 'progress response does not expose workerGroups/workerSummary yet'),
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
