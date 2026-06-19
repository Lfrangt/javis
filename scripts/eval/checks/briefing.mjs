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
    const followUps = Array.isArray(b.followUps) ? b.followUps : [];
    const coherentFollowUps = followUps.every((action) => (
      action?.source === 'workflows' &&
      action.workflowAction === 'continue' &&
      action.id &&
      action.workflowId &&
      action.instruction &&
      action.continuation &&
      typeof action.continuation.memoryMatches === 'number' &&
      typeof action.continuation.relatedWorkflows === 'number'
    ));
    out.push(
      Array.isArray(b.followUps) && coherentFollowUps
        ? ok('briefing.followups', 'Workflow follow-ups', `${followUps.length} continuation suggestion(s)`)
        : fail('briefing.followups', 'Workflow follow-ups', 'briefing followUps are missing or malformed', b.followUps),
    );
    const realtimeVoice = b.realtimeVoice || {};
    const realtimeAction = next.find((action) => action.source === 'realtime_voice') || null;
    const realtimePending = realtimeVoice.status && realtimeVoice.status !== 'ready';
    out.push(
      !realtimeVoice.status ||
        (['ready', 'pending', 'blocked'].includes(realtimeVoice.status) &&
          typeof realtimeVoice.phase === 'string' &&
          (!realtimePending || (
            realtimeAction &&
            realtimeAction.phase === realtimeVoice.phase &&
            realtimeAction.blocker &&
            realtimeAction.manualOnly === true &&
            realtimeAction.autoEligible === false &&
            realtimeAction.autopilotEligible === false &&
            typeof realtimeAction.manualOnlyReason === 'string' &&
            realtimeAction.manualOnlyReason.length > 0
          )))
        ? ok('briefing.realtime_voice', 'Realtime voice next action', realtimePending ? `${realtimeVoice.status}/${realtimeVoice.phase}` : 'ready or not surfaced')
        : fail('briefing.realtime_voice', 'Realtime voice next action', 'briefing did not expose a coherent realtime voice work-next blocker', {
          realtimeVoice,
          nextActions: next,
        }),
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

    const handoffResponse = await ctx.api('/api/work/handoff?maxChars=760&nextLimit=2&followUpLimit=2');
    const handoff = handoffResponse.data?.handoff;
    const handoffReady = Boolean(
      handoffResponse.ok &&
      handoff &&
      typeof handoff.ok === 'boolean' &&
      typeof handoff.spokenSummary === 'string' &&
      handoff.spokenSummary.trim() &&
      handoff.spokenSummary.length <= 760 &&
      handoff.progress &&
      typeof handoff.progress.spokenSummary === 'string' &&
      handoff.briefing &&
      Array.isArray(handoff.nextActions) &&
      Array.isArray(handoff.followUps) &&
      handoff.collaboration?.counts,
    );
    out.push(
      handoffReady
        ? ok('briefing.handoff', 'Spoken work handoff', handoff.spokenSummary.slice(0, 180), {
          nextActions: handoff.nextActions.length,
          followUps: handoff.followUps.length,
          progress: handoff.progress.spokenSummary,
        })
        : fail('briefing.handoff', 'Spoken work handoff', `GET /api/work/handoff did not return a coherent voice-ready handoff (${handoffResponse.status})`, handoffResponse.data),
    );

    return out;
  },
};
