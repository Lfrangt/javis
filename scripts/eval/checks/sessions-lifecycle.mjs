import { ok, fail } from '../_client.mjs';

// Local work-session lifecycle (README: "Local work sessions for focus goals,
// session notes, resume-from-history handoff … and deterministic
// end-of-session summaries"). Exercises start → event → end → resume, then
// DELETEs the throwaway session. Self-cleaning.
//
// Note: session events require `text` (not `note`, which demonstrations capture
// uses) — a small cross-feature field-name inconsistency worth knowing.
export default {
  lane: 'sessions-lifecycle',
  async run(ctx) {
    const out = [];
    const tag = `eval/sessions/${Date.now()}`;
    let id = '';

    const start = await ctx.api('/api/sessions/start', {
      method: 'POST',
      body: { title: tag, goal: 'eval session lifecycle probe', source: 'eval' },
    });
    id = start.data?.session?.id || start.data?.id || '';
    if (!start.ok || !id) {
      out.push(fail('sl.start', 'Start session', `POST /api/sessions/start ${start.status} ${start.error || start.data?.error || ''}`));
      return out;
    }
    out.push(ok('sl.start', 'Start session', `session ${id.slice(0, 8)} · status=${start.data?.session?.status || '?'}`));

    try {
      const event = await ctx.api(`/api/sessions/${encodeURIComponent(id)}/events`, {
        method: 'POST',
        body: { type: 'note', text: 'eval probe note', source: 'eval' },
      });
      out.push(
        event.ok && event.data?.ok !== false
          ? ok('sl.event', 'Add session event', 'note event recorded')
          : fail('sl.event', 'Add session event', `POST …/events ${event.status} ${event.error || event.data?.details || ''}`),
      );

      const checkIn = await ctx.api('/api/sessions/check-in');
      out.push(
        checkIn.ok
          ? ok('sl.checkin', 'Session check-in', 'check-in surface reflects the active session')
          : fail('sl.checkin', 'Session check-in', `GET /api/sessions/check-in ${checkIn.status} ${checkIn.error || ''}`),
      );

      const end = await ctx.api(`/api/sessions/${encodeURIComponent(id)}/end`, {
        method: 'POST',
        body: { source: 'eval', summary: 'eval lifecycle complete' },
      });
      out.push(
        end.ok && end.data?.session?.status === 'done'
          ? ok('sl.end', 'End session', `status=done · summary recorded`)
          : fail('sl.end', 'End session', `POST …/end ${end.status} ${end.error || ''}`, end.data),
      );

      const resume = await ctx.api(`/api/sessions/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
        body: { source: 'eval' },
      });
      out.push(
        resume.ok && resume.data?.session
          ? ok('sl.resume', 'Resume from history', `resumed ${id.slice(0, 8)} (status=${resume.data.session.status})`)
          : fail('sl.resume', 'Resume from history', `POST …/resume ${resume.status} ${resume.error || ''}`),
      );
    } finally {
      const del = await ctx.api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', body: { source: 'eval' } });
      out.push(
        del.ok
          ? ok('sl.cleanup', 'Cleanup', `throwaway session ${id.slice(0, 8)} removed`)
          : fail('sl.cleanup', 'Cleanup', `DELETE /api/sessions/${id.slice(0, 8)} ${del.status} ${del.error || ''} — may leave a test session behind`),
      );
    }

    return out;
  },
};
