import { ok, warn, fail } from '../_client.mjs';

// Workflow history (README: "Workflow history for recent browser, voice, and
// background work" + continue-from-history). Read-only — lists history; does
// not continue or copy a workflow.
export default {
  lane: 'workflows',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/workflows?limit=5');
    const workflows = list.data?.workflows;
    if (!list.ok || !Array.isArray(workflows)) {
      out.push(fail('workflows.history', 'Workflow history', `GET /api/workflows ${list.status} ${list.error || ''}`));
      return out;
    }
    const counts = list.data?.counts || {};
    out.push(ok('workflows.history', 'Workflow history', `${workflows.length} recent · ${counts.total ?? workflows.length} total · ${counts.done ?? '?'} done`, { counts }));

    const sample = workflows[0];
    const hasContract = sample && 'id' in sample && 'status' in sample && ('kind' in sample || 'intent' in sample);
    out.push(
      sample
        ? (hasContract
          ? ok('workflows.records', 'Workflow records', `linked records carry id/status/kind (latest: ${sample.status} ${sample.kind || sample.intent || ''})`)
          : warn('workflows.records', 'Workflow records', `record missing id/status/kind (${Object.keys(sample).slice(0, 8).join(',')})`))
        : warn('workflows.records', 'Workflow records', 'no workflows yet to inspect'),
    );

    return out;
  },
};
