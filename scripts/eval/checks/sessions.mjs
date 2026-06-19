import { ok, warn, fail } from '../_client.mjs';

// Local work sessions (README: "Local work sessions for focus goals, session
// notes, resume-from-history handoff …"). Read-only — lists sessions and reads
// the resume check-in; does not start or end a session.
export default {
  lane: 'sessions',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/sessions');
    const s = list.data?.sessions;
    const items = s?.items;
    const counts = s?.counts || {};
    out.push(
      list.ok && s && Array.isArray(items)
        ? ok('sessions.list', 'Session history', `${counts.total ?? items.length} local work session(s) · ${counts.active ?? 0} active · ${counts.done ?? 0} done`)
        : fail('sessions.list', 'Session history', `GET /api/sessions ${list.status} ${list.error || ''}`),
    );

    const checkIn = await ctx.api('/api/sessions/check-in');
    out.push(
      checkIn.ok
        ? ok('sessions.checkin', 'Session check-in', 'resume/check-in surface is queryable')
        : warn('sessions.checkin', 'Session check-in', `GET /api/sessions/check-in ${checkIn.status} ${checkIn.error || ''}`),
    );

    return out;
  },
};
