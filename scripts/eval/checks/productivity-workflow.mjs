import { ok, fail } from '../_client.mjs';

// Productivity workflows (README: productivity dogfood / focus work over local
// apps). Preview-only (execute:false) — plans the workflow, picks an app, and
// returns stages without running anything.
export default {
  lane: 'productivity-workflow',
  async run(ctx) {
    const out = [];

    const plan = await ctx.api('/api/productivity/workflow', {
      method: 'POST',
      body: { instruction: 'organize my notes and plan today', execute: false, source: 'eval' },
      timeoutMs: 15000,
    });
    const d = plan.data || {};
    const app = d.selectedApp?.name || d.selectedApp || '';
    out.push(
      plan.ok && d.ok === true && d.executed === false && d.intent && (d.stages || []).length > 0
        ? ok('prod.workflow_plan', 'Productivity workflow plan', `intent=${d.intent} · app=${app || '?'} · ${d.stages.length} stage(s) · executed=false`)
        : fail('prod.workflow_plan', 'Productivity workflow plan', `POST /api/productivity/workflow (preview) ${plan.status} ${plan.error || d.error || ''}`, d),
    );

    // Missing instruction must be rejected (input validation).
    const empty = await ctx.api('/api/productivity/workflow', { method: 'POST', body: { execute: false, source: 'eval' }, timeoutMs: 8000 });
    out.push(
      empty.status >= 400
        ? ok('prod.workflow_validation', 'Missing instruction rejected', 'a workflow with no instruction is rejected')
        : fail('prod.workflow_validation', 'Missing instruction rejected', `expected 4xx for missing instruction, got ${empty.status}`, empty.data),
    );

    return out;
  },
};
