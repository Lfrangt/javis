import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ok, fail } from '../_client.mjs';

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
  const tempPath = path.join(os.tmpdir(), `javis-realtime-progress-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tempPath, compiled.outputText);
  try {
    return await import(pathToFileURL(tempPath).href);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function baseProgress(now, overrides = {}) {
  return {
    output: 'RAW OUTPUT SHOULD NOT WIN',
    version: {
      sequence: 42,
      updatedAt: now,
      source: 'eval_progress',
    },
    counts: {
      activeJobs: 0,
      activeWorkflows: 0,
      blockedWorkflows: 0,
      activeRoutes: 0,
    },
    activeRoutes: [],
    routingLedger: [],
    workerGroups: [
      {
        id: 'group-1',
        parallelGroup: 'research-batch',
        owner: 'Claude Code',
        lane: 'claude',
        total: 2,
        statusCounts: { done: 1, running: 1 },
        active: 1,
        done: 1,
        failed: 0,
        latestUpdatedAt: now,
        latestResultLink: '/api/jobs/job-1',
        nextAction: 'Continue reading docs and report one concrete next action.',
      },
    ],
    workerSummary: '1 worker group(s), 1 active, 1 done',
    latestDone: {
      job: null,
      workflow: null,
      route: null,
    },
    ...overrides,
  };
}

export default {
  lane: 'realtime-injection',
  async run(ctx) {
    const out = [];
    const mod = await importRealtimeProgressModule();
    const now = Date.now();
    const since = now - 10000;

    const context = mod.realtimeWorkProgressContext(baseProgress(now), since);
    const groupedContext =
      context.includes('Silent JAVIS background work progress update') &&
      context.includes('Do not answer this message by itself') &&
      context.includes('Worker summary: 1 worker group(s), 1 active, 1 done.') &&
      context.includes('Claude Code/claude group=research-batch') &&
      !context.includes('RAW OUTPUT SHOULD NOT WIN');
    out.push(
      groupedContext
        ? ok('realtime_injection.grouped_context', 'Grouped progress context', 'worker summary is injected ahead of raw progress output')
        : fail('realtime_injection.grouped_context', 'Grouped progress context', 'grouped worker context was missing or raw output won', { context }),
    );

    const groupedWithoutRawOutput = mod.realtimeWorkProgressContext(baseProgress(now, { output: '' }), since);
    out.push(
      groupedWithoutRawOutput.includes('Worker summary: 1 worker group(s), 1 active, 1 done.')
        ? ok('realtime_injection.grouped_without_raw_output', 'Grouped progress without raw log', 'worker summary still injects when raw progress output is empty')
        : fail('realtime_injection.grouped_without_raw_output', 'Grouped progress without raw log', 'worker summary depended on raw output text', { groupedWithoutRawOutput }),
    );

    const stale = mod.realtimeWorkProgressContext(
      baseProgress(now - 120000, {
        workerGroups: [
          {
            ...baseProgress(now).workerGroups[0],
            active: 0,
            done: 1,
            latestUpdatedAt: now - 120000,
          },
        ],
        workerSummary: '1 worker group(s), 1 done',
      }),
      since,
    );
    out.push(
      stale === ''
        ? ok('realtime_injection.stale_skip', 'Stale progress skip', 'inactive stale worker groups do not inject live context')
        : fail('realtime_injection.stale_skip', 'Stale progress skip', 'stale progress still produced context', { stale }),
    );

    const event = mod.buildRealtimeTextContextEvent(context);
    const serialized = JSON.stringify(event);
    const isSilentContextEvent =
      event?.type === 'conversation.item.create' &&
      event.item?.role === 'user' &&
      event.item?.content?.[0]?.type === 'input_text' &&
      event.item?.content?.[0]?.text === context &&
      !serialized.includes('response.create') &&
      !Object.hasOwn(event, 'response');
    out.push(
      isSilentContextEvent
        ? ok('realtime_injection.no_response_create', 'No forced Realtime response', 'progress injection creates only a user context item')
        : fail('realtime_injection.no_response_create', 'No forced Realtime response', 'progress injection event would force or malformed a response', { event }),
    );

    if (!ctx?.api) return out;

    const before = await ctx.api('/api/conversation/state');
    const conversation = before.data?.conversation;
    if (!before.ok || !conversation) {
      out.push(fail('realtime_injection.runtime_read', 'Runtime injection evidence', `GET /api/conversation/state ${before.status} ${before.error || before.data?.error || ''}`));
      return out;
    }

    const evidence = mod.realtimeProgressInjectionEvidence(baseProgress(now), context);
    out.push(
      evidence.progressSequence === 42 &&
        evidence.progressUpdatedAt === now &&
        evidence.progressSource === 'eval_progress'
        ? ok('realtime_injection.progress_version_evidence', 'Progress version evidence', `sequence=${evidence.progressSequence}`)
        : fail('realtime_injection.progress_version_evidence', 'Progress version evidence', 'progress version was not carried into injection evidence', evidence),
    );

    const status = await ctx.api('/api/status');
    const progressSnapshot = await ctx.api('/api/work/progress');
    const statusVersion = status.data?.progressVersion;
    const endpointVersion = progressSnapshot.data?.progress?.version;
    out.push(
      status.ok &&
        progressSnapshot.ok &&
        typeof statusVersion?.sequence === 'number' &&
        typeof endpointVersion?.sequence === 'number' &&
        typeof endpointVersion?.updatedAt === 'number'
        ? ok('realtime_injection.progress_version_api', 'Progress version API', `status=${statusVersion.sequence} progress=${endpointVersion.sequence}`)
        : fail('realtime_injection.progress_version_api', 'Progress version API', 'status/progress APIs did not expose work progress versions', { status: status.data, progress: progressSnapshot.data }),
    );

    if (conversation.active) {
      const dryRun = await ctx.api('/api/realtime/progress-injection', {
        method: 'POST',
        body: {
          source: 'eval-dry-run',
          sessionId: conversation.sessionId,
          dryRun: true,
          transport: 'eval-simulated',
          dataChannelReadyState: 'open',
          eventType: 'conversation.item.create',
          eventRole: 'user',
          contentType: 'input_text',
          forcedResponse: false,
          responseActive: false,
          voiceStatus: conversation.status,
          micMode: conversation.micMode || 'open',
          screenLive: Boolean(conversation.screenLive),
          ...evidence,
        },
      });
      out.push(
        dryRun.ok &&
          dryRun.data?.injection?.workerSummary === evidence.workerSummary &&
          dryRun.data?.injection?.transport === 'eval-simulated' &&
          dryRun.data?.injection?.progressSequence === evidence.progressSequence &&
          dryRun.data?.injection?.eventType === 'conversation.item.create' &&
          dryRun.data?.injection?.forcedResponse === false
          ? ok('realtime_injection.runtime_dry_run', 'Runtime injection evidence', 'active user session detected; dry-run normalization passed')
          : fail('realtime_injection.runtime_dry_run', 'Runtime injection evidence', `dry-run failed ${dryRun.status}`, dryRun.data),
      );
      return out;
    }

    const sessionId = `eval-realtime-injection-${Date.now()}`;
    try {
      await ctx.api('/api/conversation/state', {
        method: 'POST',
        body: { status: 'connecting', sessionId, micMode: 'open', source: 'eval' },
      });
      await ctx.api('/api/conversation/state', {
        method: 'POST',
        body: { status: 'live', sessionId, micMode: 'open', source: 'eval' },
      });
      const record = await ctx.api('/api/realtime/progress-injection', {
        method: 'POST',
        body: {
          source: 'eval',
          sessionId,
          transport: 'eval-simulated',
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
          record.data?.conversation?.status === 'live' &&
          record.data?.conversation?.realtimeProgressInjectionCount >= 1 &&
          recorded?.sessionId === sessionId &&
          recorded?.workerSummary === evidence.workerSummary &&
          recorded?.contextPreview === evidence.contextPreview &&
          recorded?.transport === 'eval-simulated' &&
          recorded?.progressSequence === evidence.progressSequence &&
          recorded?.progressSource === evidence.progressSource &&
          recorded?.dataChannelReadyState === 'open' &&
          recorded?.eventType === 'conversation.item.create' &&
          recorded?.forcedResponse === false
          ? ok('realtime_injection.runtime_record', 'Runtime injection evidence', 'resident recorded the live progress injection summary')
          : fail('realtime_injection.runtime_record', 'Runtime injection evidence', `record failed ${record.status}`, record.data),
      );
    } finally {
      await ctx.api('/api/conversation/state', {
        method: 'POST',
        body: {
          status: 'idle',
          sessionId,
          micMode: conversation.micMode || 'open',
          screenLive: false,
          source: 'eval-restore',
          clearRealtimeProgressInjection: true,
        },
      });
    }

    return out;
  },
};
