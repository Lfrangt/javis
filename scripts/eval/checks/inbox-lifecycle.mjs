import { ok, fail } from '../_client.mjs';

// Inbox capture lifecycle (README: "Local Inbox for clipboard/manual captures
// and pending follow-up items" + "Explicit Inbox 'do next'"). Exercises
// capture → triage → complete → DELETE on a throwaway item. Self-cleaning.
// Does NOT call /route (that would queue real work into a lane).
export default {
  lane: 'inbox-lifecycle',
  async run(ctx) {
    const out = [];
    let id = '';

    const capture = await ctx.api('/api/inbox', {
      method: 'POST',
      body: { text: `eval probe capture ${Date.now()}`, source: 'eval' },
    });
    id = capture.data?.item?.id || capture.data?.id || '';
    if (!capture.ok || !id) {
      out.push(fail('ibx.capture', 'Capture item', `POST /api/inbox ${capture.status} ${capture.error || capture.data?.error || ''}`));
      return out;
    }
    out.push(ok('ibx.capture', 'Capture item', `item ${id.slice(0, 8)} · status=${capture.data?.item?.status || '?'} · priority=${capture.data?.item?.priority ?? '?'}`));

    try {
      const triage = await ctx.api('/api/inbox/triage', { method: 'POST', body: { source: 'eval' } });
      out.push(
        triage.ok
          ? ok('ibx.triage', 'Triage', 'read-only triage prioritized the queue')
          : fail('ibx.triage', 'Triage', `POST /api/inbox/triage ${triage.status} ${triage.error || ''}`),
      );

      const complete = await ctx.api(`/api/inbox/${encodeURIComponent(id)}/complete`, {
        method: 'POST',
        body: { source: 'eval' },
      });
      out.push(
        complete.ok && complete.data?.item?.status === 'done'
          ? ok('ibx.complete', 'Complete item', 'item marked done')
          : fail('ibx.complete', 'Complete item', `POST …/complete ${complete.status} ${complete.error || ''}`, complete.data),
      );
    } finally {
      const del = await ctx.api(`/api/inbox/${encodeURIComponent(id)}`, { method: 'DELETE', body: { source: 'eval' } });
      out.push(
        del.ok && (del.data?.removed?.id === id || del.data?.ok)
          ? ok('ibx.cleanup', 'Cleanup', `throwaway item ${id.slice(0, 8)} removed`)
          : fail('ibx.cleanup', 'Cleanup', `DELETE /api/inbox/${id.slice(0, 8)} ${del.status} ${del.error || ''} — may leave a test item behind`),
      );
    }

    return out;
  },
};
