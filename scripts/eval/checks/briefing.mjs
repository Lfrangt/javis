import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'briefing',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/briefing');
    const b = r.data?.briefing || r.data;
    if (!r.ok || !b) {
      out.push(fail('briefing.read', 'Work briefing', `GET /api/briefing ${r.status} ${r.error || ''}`));
      return out;
    }
    out.push(
      b.summary
        ? ok('briefing.summary', 'Briefing summary', String(b.summary).slice(0, 140))
        : warn('briefing.summary', 'Briefing summary', 'no summary text'),
    );
    const next = Array.isArray(b.nextActions) ? b.nextActions : [];
    out.push(
      next.length
        ? ok('briefing.next', 'Next actions', `${next.length} next action(s): ${next.map((n) => n.label || n.title || n.summary || n).slice(0, 2).join(' · ')}`)
        : warn('briefing.next', 'Next actions', 'briefing returned no next actions (idle is ok)'),
    );

    const wn = await ctx.api('/api/work/next');
    const action = wn.data?.action || wn.data?.workNext || wn.data;
    out.push(
      wn.ok && action
        ? ok('briefing.worknext', 'Work-next', `${action.label || action.summary || action.type || 'next action'}${action.executed ? ' (executed)' : ' (preview)'}`)
        : warn('briefing.worknext', 'Work-next', `GET /api/work/next ${wn.status} ${wn.error || ''}`),
    );

    return out;
  },
};
