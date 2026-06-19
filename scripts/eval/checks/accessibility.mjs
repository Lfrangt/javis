import { ok, warn, fail } from '../_client.mjs';

// Light AX smoke check. For the deep Gemini-composer acceptance test use the
// dedicated harness: `npm run verify:ax -- --require-chromium`.
export default {
  lane: 'accessibility',
  async run(ctx) {
    const out = [];
    const smokeMaxNodes = 80;
    const smokeMaxDepth = 5;

    const tree = await ctx.api(`/api/accessibility/tree?maxNodes=${smokeMaxNodes}&maxDepth=${smokeMaxDepth}`, { timeoutMs: 30000 });
    const t = tree.data?.tree;
    if (!tree.ok || !t) {
      out.push(fail('ax.tree', 'AX tree read', `GET /api/accessibility/tree ${tree.status} ${tree.error || ''}`));
      return out;
    }
    if (t.error === 'accessibility_permission_not_granted') {
      out.push(warn('ax.tree', 'AX tree read', 'Accessibility permission not granted — grant it in System Settings to use app control.'));
      return out;
    }
    if (t.error === 'accessibility_tree_read_timeout') {
      out.push(fail('ax.tree', 'AX tree read', `tree read timed out for app="${t.app || '?'}" budget=${smokeMaxNodes}/${smokeMaxDepth}`));
      return out;
    }
    out.push(
      t.available
        ? ok('ax.tree', 'AX tree read', `app="${t.app}" nodes=${t.nodeCount} truncated=${t.truncated} budget=${smokeMaxNodes}/${smokeMaxDepth}`)
        : warn('ax.tree', 'AX tree read', `no nodes (app="${t.app || '?'}" error=${t.error || ''})`),
    );

    const plan = await ctx.api('/api/accessibility/plan', {
      method: 'POST',
      body: { instruction: 'focus the main input', maxNodes: smokeMaxNodes, maxDepth: smokeMaxDepth },
      timeoutMs: 30000,
    });
    const rec = plan.data?.recommended;
    out.push(
      plan.ok && rec
        ? ok('ax.plan', 'AX target plan', `${rec.type}${rec.role ? ` (${rec.role})` : ''} from ${plan.data.candidates?.length || 0} candidate(s)`)
        : warn('ax.plan', 'AX target plan', `POST /api/accessibility/plan ${plan.status} ${plan.error || ''}`),
    );

    return out;
  },
};
