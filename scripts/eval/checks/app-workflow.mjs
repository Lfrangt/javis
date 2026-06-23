import { ok, fail } from '../_client.mjs';

// Multi-step local app workflows (README: "Multi-step local app workflows:
// preview or execute short sequences such as open app, wait, press UI target,
// type text, hotkey"). Preview-only (execute:false) with a harmless wait step —
// nothing runs.
export default {
  lane: 'app-workflow',
  async run(ctx) {
    const out = [];

    const preview = await ctx.api('/api/app/workflow', {
      method: 'POST',
      body: {
        execute: false,
        title: 'eval app workflow preview',
        steps: [
          { action: 'wait', ms: 100 },
          { action: 'wait', ms: 100 },
        ],
        source: 'eval',
      },
      timeoutMs: 15000,
    });
    const d = preview.data || {};
    out.push(
      preview.ok && d.ok === true && d.executed === false
        ? ok('app.workflow_preview', 'App workflow preview', `previewed ${d.counts?.total ?? (d.workflow?.steps || []).length} step(s) · executed=false`)
        : fail('app.workflow_preview', 'App workflow preview', `POST /api/app/workflow (preview) ${preview.status} ${preview.error || d.error || ''}`, d),
    );

    // Empty steps must be rejected (input validation).
    const empty = await ctx.api('/api/app/workflow', { method: 'POST', body: { execute: false, steps: [], source: 'eval' }, timeoutMs: 8000 });
    out.push(
      empty.status >= 400
        ? ok('app.workflow_validation', 'Empty workflow rejected', 'a no-step workflow is rejected as expected')
        : fail('app.workflow_validation', 'Empty workflow rejected', `expected 4xx for empty steps, got ${empty.status}`, empty.data),
    );

    return out;
  },
};
