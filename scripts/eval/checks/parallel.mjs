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
