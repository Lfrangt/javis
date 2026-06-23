import { ok, fail, skip } from '../_client.mjs';

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
    let resumedId = ''; // resume forks a NEW session id — must be cleaned too.

    const before = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
    const existingActive = before.data?.sessions?.active || null;
    if (existingActive) {
      out.push(skip('sl.active_guard', 'Active session guard', `left existing active session untouched: ${existingActive.title || existingActive.id}`));
      return out;
    }

    const start = await ctx.api('/api/sessions/start', {
      method: 'POST',
      body: { title: tag, goal: 'eval session lifecycle probe', source: 'eval' },
    });
    id = start.data?.session?.id || start.data?.id || '';
    if (!start.ok || !id) {
      const detail = String(start.data?.details || start.error || start.data?.error || '');
      if (/already active/i.test(detail)) {
        out.push(skip('sl.active_guard', 'Active session guard', `start skipped because a session became active: ${detail}`));
        return out;
      }
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
      resumedId = resume.data?.session?.id || '';
      out.push(
        resume.ok && resume.data?.session
          ? ok('sl.resume', 'Resume from history', `resumed as ${resumedId.slice(0, 8)}${resumedId && resumedId !== id ? ' (forks a new session id)' : ''}`)
          : fail('sl.resume', 'Resume from history', `POST …/resume ${resume.status} ${resume.error || ''}`),
      );
    } finally {
      // resume forks a new session, so clean up both ids.
      const ids = [...new Set([id, resumedId].filter(Boolean))];
      const dels = await Promise.all(ids.map((sid) => ctx.api(`/api/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE', body: { source: 'eval' } })));
      out.push(
        dels.every((d) => d.ok)
          ? ok('sl.cleanup', 'Cleanup', `${ids.length} throwaway session(s) removed`)
          : fail('sl.cleanup', 'Cleanup', `cleanup incomplete (${dels.filter((d) => d.ok).length}/${ids.length} removed) — may leave a test session behind`),
      );
    }

    return out;
  },
};
