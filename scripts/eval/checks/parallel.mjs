import { ok, fail } from '../_client.mjs';

function hasRouteMetadata(item, parallelGroup) {
  const routing = item?.routing || {};
  return Boolean(
    routing.id
      && routing.owner
      && routing.scope
      && routing.parallelGroup === parallelGroup
      && routing.status
      && routing.resultLink,
  );
}

export default {
  lane: 'parallel',
  async run(ctx) {
    const out = [];
    const parallelGroup = `eval-parallel-${Date.now()}`;
    const preflightGroup = `eval-parallel-preflight-${Date.now()}`;
    const preflightTasks = Array.from({ length: 20 }, (_, index) => ({
      command: `echo preflight-${index + 1}`,
      title: `preflight task ${index + 1}`,
      owner: `eval-preflight-${index + 1}`,
      scope: index >= 18 ? 'docs/eval-parallel-preflight-shared.md' : `docs/eval-parallel-preflight-${index + 1}.md`,
      access: index >= 18 ? 'write' : 'read',
    }));
    const routingBefore = await ctx.api('/api/tasks/routing?limit=1');
    const preflightResponse = await ctx.api('/api/tasks/parallel/preflight', {
      method: 'POST',
      body: {
        requestedAgents: 20,
        parallelGroup: preflightGroup,
        source: 'eval_parallel_preflight',
        tasks: preflightTasks,
      },
      timeoutMs: 20000,
    });
    const routingAfter = await ctx.api('/api/tasks/routing?limit=1');
    const preflight = preflightResponse.data?.preflight || {};
    const preflightCounts = preflight.counts || {};
    const preflightSafe =
      preflightResponse.ok &&
      preflight.requestedAgents === 20 &&
      preflight.maxRequestedAgents >= 20 &&
      preflight.configuredMaxParallelTasks >= 2 &&
      preflight.safeConcurrency <= preflight.configuredMaxParallelTasks &&
      preflightCounts.acceptedTasks === Math.min(20, preflight.maxRequestedAgents) &&
      preflightCounts.serialRequired >= 1 &&
      Array.isArray(preflight.parallelBatches) &&
      preflight.safety?.startsWorkers === false &&
      preflight.safety?.callsOpenAI === false &&
      preflight.safety?.startsMicrophone === false &&
      preflight.safety?.createsRoutingRecords === false &&
      routingBefore.data?.counts?.total === routingAfter.data?.counts?.total;
    out.push(
      preflightSafe
        ? ok('parallel.preflight_20_slots', '20-agent preflight', `requested=${preflight.requestedAgents} safe=${preflight.safeConcurrency} waves=${preflightCounts.parallelWaves} serial=${preflightCounts.serialRequired}`)
        : fail('parallel.preflight_20_slots', '20-agent preflight', 'parallel preflight should plan 20 requested slots without starting workers or writing route records', {
          preflight,
          routingBefore: routingBefore.data?.counts,
          routingAfter: routingAfter.data?.counts,
        }),
    );

    const spendBeforeVoicePreflight = await ctx.api('/api/openai/spend-guard');
    const spendBeforeCount = Number(spendBeforeVoicePreflight.data?.spendGuard?.counts?.total || 0);
    const naturalPreflight = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '开20个Agent先预检一下',
        execute: false,
        includeScreen: false,
        speak: false,
        source: 'eval_parallel_preflight_voice',
      },
      timeoutMs: 30000,
    });
    const spendAfterVoicePreflight = await ctx.api('/api/openai/spend-guard');
    const spendAfterCount = Number(spendAfterVoicePreflight.data?.spendGuard?.counts?.total || 0);
    const naturalRoute = naturalPreflight.data?.route || {};
    const naturalVoicePreflight = naturalPreflight.data?.parallelPreflight || naturalRoute.data?.parallelPreflight || {};
    const naturalSafety = naturalVoicePreflight.safety || {};
    out.push(
      naturalPreflight.ok &&
        naturalRoute.localCommand?.intent === 'parallel_preflight' &&
        naturalVoicePreflight.requestedAgents === 20 &&
        naturalSafety.startsWorkers === false &&
        naturalSafety.callsOpenAI === false &&
        naturalSafety.startsMicrophone === false &&
        naturalSafety.opensTerminal === false &&
        spendAfterCount === spendBeforeCount
        ? ok('parallel.preflight_voice_command', 'Natural 20-agent voice preflight', `requested=${naturalVoicePreflight.requestedAgents} spendDelta=${spendAfterCount - spendBeforeCount}`)
        : fail('parallel.preflight_voice_command', 'Natural 20-agent voice preflight', 'expected natural voice command to return preflight without spend, workers, mic, or Terminal', {
          voice: naturalPreflight.data,
          before: spendBeforeVoicePreflight.data,
          after: spendAfterVoicePreflight.data,
        }),
    );

    const body = {
      execute: false,
      parallelGroup,
      source: 'eval_parallel',
      tasks: [
        {
          task: 'Read-only investigation: inspect resident operations docs for stale setup notes',
          mode: 'background',
          owner: 'eval-research-a',
          scope: 'docs/OPERATIONS.md',
          access: 'read',
        },
        {
          task: 'Read-only investigation: inspect architecture docs for multi-agent ownership notes',
          mode: 'codex',
          owner: 'eval-research-b',
          scope: 'docs/ARCHITECTURE.md',
          access: 'read',
        },
        {
          task: 'Update shared documentation fixture A',
          mode: 'codex',
          owner: 'eval-doc-a',
          scope: 'docs/eval-parallel-fixture.md',
          access: 'write',
        },
        {
          task: 'Update shared documentation fixture B',
          mode: 'claude',
          owner: 'eval-doc-b',
          scope: 'docs/eval-parallel-fixture.md',
          access: 'write',
        },
      ],
    };

    const response = await ctx.api('/api/tasks/parallel', {
      method: 'POST',
      body,
      timeoutMs: 20000,
    });
    const data = response.data;
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!response.ok || !data || results.length !== 4) {
      out.push(fail('parallel.route', 'Parallel routing dogfood', `POST /api/tasks/parallel ${response.status} ${response.error || data?.error || ''}`, data));
      return out;
    }

    out.push(ok(
      'parallel.route',
      'Parallel routing dogfood',
      `${results.length} preview route(s), ${data.ownership?.conflicts || 0} serialized conflict(s)`,
      { parallelGroup, counts: data.counts },
    ));

    const readItems = results.slice(0, 2);
    const readsParallelSafe = readItems.every((item) => item.ownership?.access === 'read' && item.ownership?.parallelSafe === true && item.ownership?.serialized === false);
    out.push(
      readsParallelSafe
        ? ok('parallel.read_only', 'Read-only investigations', 'two read-only investigations stayed parallel-safe')
        : fail('parallel.read_only', 'Read-only investigations', 'expected first two tasks to be read-only and parallel-safe', readItems.map((item) => item.ownership)),
    );

    const firstWrite = results[2];
    const secondWrite = results[3];
    const writeGuardOk = firstWrite?.ownership?.access === 'write'
      && firstWrite?.ownership?.parallelSafe === true
      && firstWrite?.ownership?.serialized === false
      && secondWrite?.ownership?.access === 'write'
      && secondWrite?.ownership?.parallelSafe === false
      && secondWrite?.ownership?.serialized === true
      && (secondWrite?.ownership?.conflicts || []).length >= 1
      && data.ownership?.conflicts >= 1;
    out.push(
      writeGuardOk
        ? ok('parallel.write_guard', 'Overlapping write guard', `later write serialized behind ${secondWrite.ownership.conflicts[0]?.owner || 'first owner'}`)
        : fail('parallel.write_guard', 'Overlapping write guard', 'expected second write to serialize behind first write', { firstWrite: firstWrite?.ownership, secondWrite: secondWrite?.ownership, ownership: data.ownership }),
    );

    const routesComplete = results.every((item) => hasRouteMetadata(item, parallelGroup));
    out.push(
      routesComplete
        ? ok('parallel.route_metadata', 'Route metadata', 'all routes record owner, scope, group, status, and result link')
        : fail('parallel.route_metadata', 'Route metadata', 'one or more route records are missing owner/scope/group/status/resultLink', results.map((item) => item.routing)),
    );

    const ledger = Array.isArray(data.routingLedger) ? data.routingLedger : [];
    const ledgerComplete = ledger.length === 4
      && ledger.every((item) => item.parallelGroup === parallelGroup && item.ownership && item.resultLink);
    out.push(
      ledgerComplete
        ? ok('parallel.ledger', 'Parallel routing ledger', 'routing ledger mirrors all four task records with ownership')
        : fail('parallel.ledger', 'Parallel routing ledger', 'routing ledger missing ownership/result links for the dogfood batch', ledger),
    );

    return out;
  },
};
