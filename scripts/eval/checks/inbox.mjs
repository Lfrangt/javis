import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'inbox',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/inbox');
    const inbox = list.data?.inbox || {};
    const items = inbox.items || list.data?.items || (Array.isArray(list.data) ? list.data : null);
    if (!list.ok || !Array.isArray(items)) {
      out.push(fail('inbox.list', 'Inbox list', `GET /api/inbox ${list.status} ${list.error || ''}`));
    } else {
      const counts = inbox.counts || {};
      out.push(ok('inbox.list', 'Inbox list', `${items.length} returned · ${counts.open || 0} open · ${counts.total || items.length} total`, { counts }));
    }

    const triage = await ctx.api('/api/inbox/triage');
    const t = triage.data?.triage || triage.data;
    out.push(
      triage.ok && t
        ? ok('inbox.triage', 'Inbox triage', `prioritized=${Array.isArray(t.items) ? t.items.length : Array.isArray(t.prioritized) ? t.prioritized.length : 'ok'}`)
        : warn('inbox.triage', 'Inbox triage', `GET /api/inbox/triage ${triage.status} ${triage.error || ''}`),
    );

    return out;
  },
};
