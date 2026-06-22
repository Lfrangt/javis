import { ok, warn, fail } from '../_client.mjs';

// Mac context + first-look observation + approval queue (README: "Mac context:
// frontmost app/window, clipboard summary, active jobs, and pending approvals",
// "observe_now combines the usual first-look context into one tool call", and
// "Local action approval queue"). Read-only — the observe call captures context
// but performs no action.
export default {
  lane: 'mac-context',
  async run(ctx) {
    const out = [];

    const mac = await ctx.api('/api/mac/context');
    const c = mac.data?.context;
    if (!mac.ok || !c) {
      out.push(fail('mac.context', 'Mac context', `GET /api/mac/context ${mac.status} ${mac.error || ''}`));
    } else {
      const has = (k) => Object.prototype.hasOwnProperty.call(c, k);
      const complete = ['frontmost', 'clipboard', 'queue', 'activeJobs', 'pendingApprovals', 'permissions'].every(has);
      out.push(
        complete
          ? ok('mac.context', 'Mac context', `app=${c.frontmost?.app || '?'} · jobs=${Array.isArray(c.activeJobs) ? c.activeJobs.length : c.activeJobs ?? 0} · approvals=${Array.isArray(c.pendingApprovals) ? c.pendingApprovals.length : c.pendingApprovals ?? 0} · clipboard=${c.clipboard?.length ?? c.clipboard?.chars ?? (c.clipboard ? 'present' : 'empty')}`, { keys: Object.keys(c) })
          : warn('mac.context', 'Mac context', `context present but missing first-look fields (${Object.keys(c).slice(0, 8).join(',')})`, { keys: Object.keys(c) }),
      );
    }

    // observe_now: one-shot first-look context bundle. Read-only. Bundles
    // screen capture + vision + AX, which can legitimately take >15s on a busy
    // desktop, so give it room before warning.
    const observe = await ctx.api('/api/observe', { method: 'POST', body: { source: 'eval' }, timeoutMs: 25000 });
    const o = observe.data;
    out.push(
      observe.ok && o && o.ok !== false && ('mac' in o || 'accessibility' in o)
        ? ok('mac.observe', 'First-look observation', `bundled mac/screen/accessibility context${Array.isArray(o.errors) && o.errors.length ? ` · ${o.errors.length} soft error(s)` : ''}`)
        : warn('mac.observe', 'First-look observation', `POST /api/observe ${observe.status} ${observe.error || ''}`),
    );

    // Approval queue (the gate for sensitive/irreversible actions).
    const approvals = await ctx.api('/api/approvals');
    const a = approvals.data;
    out.push(
      approvals.ok && a && a.counts
        ? ok('mac.approvals', 'Approval queue', `${a.counts.total ?? 0} total · ${(Array.isArray(a.pending) ? a.pending.length : a.pending) ?? 0} pending · ${a.counts.executed ?? 0} executed`, { counts: a.counts })
        : warn('mac.approvals', 'Approval queue', `GET /api/approvals ${approvals.status} ${approvals.error || ''}`),
    );

    return out;
  },
};
