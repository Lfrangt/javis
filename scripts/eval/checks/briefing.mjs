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
    const workNext = wn.data?.next;
    const workNextReady = Boolean(
      wn.ok &&
      workNext &&
      workNext.ok === true &&
      workNext.executed === false &&
      typeof workNext.output === 'string' &&
      workNext.output.trim() &&
      workNext.briefing &&
      Array.isArray(workNext.briefing.nextActions),
    );
    const selectedAction = workNext?.action || null;
    const workNextActions = Array.isArray(workNext?.briefing?.nextActions)
      ? workNext.briefing.nextActions
      : [];
    const matchesBriefing = !selectedAction ||
      (next.length === 0 && workNextActions.length === 0) ||
      workNextActions.some((item) => item?.id && item.id === selectedAction.id);
    out.push(
      workNextReady && matchesBriefing
        ? ok('briefing.worknext', 'Work-next', `${selectedAction?.label || 'No next action'} (preview) · ${String(workNext.output).slice(0, 140)}`, {
          action: selectedAction,
          output: workNext.output,
          nextActionCount: workNextActions.length,
        })
        : fail('briefing.worknext', 'Work-next', `GET /api/work/next did not return a coherent preview envelope (${wn.status})`, wn.data),
    );

    return out;
  },
};
