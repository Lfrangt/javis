import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'routing',
  async run(ctx) {
    const out = [];

    const contracts = await ctx.api('/api/lanes/contracts');
    const lc = contracts.data?.laneContracts;
    const count = lc?.count || lc?.contracts?.length || lc?.ids?.length || 0;
    out.push(
      contracts.ok && count >= 4
        ? ok('routing.contracts', 'Lane contracts', `${count} lane contract(s) exposed`)
        : fail('routing.contracts', 'Lane contracts', `contracts ${contracts.status} ${contracts.error || ''}`, lc),
    );

    const quick = await ctx.api('/api/tasks/route', {
      method: 'POST',
      body: { message: '现在状态怎么样？', execute: false, useMemory: false, source: 'eval' },
    });
    const quickDecision = quick.data?.decision;
    out.push(
      quick.ok && quickDecision?.lane
        ? ok('routing.preview', 'Task route preview', `${quickDecision.lane} · ${quickDecision.reason || 'routed'}`)
        : fail('routing.preview', 'Task route preview', `route ${quick.status} ${quick.error || quick.data?.error || ''}`, quick.data),
    );

    const parallel = await ctx.api('/api/tasks/parallel', {
      method: 'POST',
      body: {
        execute: false,
        parallelGroup: `eval-routing-${Date.now()}`,
        tasks: [
          { task: 'Update eval routing fixture A', mode: 'codex', owner: 'eval-a', scope: 'eval/routing-conflict.md', access: 'write' },
          { task: 'Update eval routing fixture B', mode: 'claude', owner: 'eval-b', scope: 'eval/routing-conflict.md', access: 'write' },
        ],
      },
    });
    const second = parallel.data?.results?.[1];
    out.push(
      parallel.ok && parallel.data?.ownership?.conflicts >= 1 && second?.ownership?.serialized === true
        ? ok('routing.parallel_guard', 'Parallel ownership guard', 'overlapping write scopes serialized')
        : fail('routing.parallel_guard', 'Parallel ownership guard', `expected serialized conflict, got ${parallel.status}`, parallel.data),
    );

    const ledger = await ctx.api('/api/tasks/routing?limit=5');
    out.push(
      ledger.ok && Array.isArray(ledger.data?.records)
        ? ok('routing.ledger', 'Routing ledger', `${ledger.data.records.length} recent route record(s) · ${ledger.data.counts?.total || 0} total`)
        : warn('routing.ledger', 'Routing ledger', `ledger ${ledger.status} ${ledger.error || ''}`),
    );

    return out;
  },
};
