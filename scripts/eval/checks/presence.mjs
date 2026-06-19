import { ok, warn, fail } from '../_client.mjs';

// Resident presence + passive ambient observation (README: "Resident presence
// state: standby/watching/wake/work/attention" and "Passive ambient observe
// mode"). Read-only.
export default {
  lane: 'presence',
  async run(ctx) {
    const out = [];

    const presence = await ctx.api('/api/presence');
    const p = presence.data?.presence;
    if (!presence.ok || !p) {
      out.push(fail('presence.state', 'Presence state', `GET /api/presence ${presence.status} ${presence.error || ''}`));
    } else {
      out.push(ok('presence.state', 'Presence state', `mode=${p.mode || '?'} · ${p.label || ''}${p.intervention ? ' · guardrails on' : ''}`, { mode: p.mode }));
    }

    const ambient = await ctx.api('/api/ambient');
    const a = ambient.data?.ambient;
    const events = a?.recent;
    out.push(
      ambient.ok && a && Array.isArray(events)
        ? ok('presence.ambient', 'Ambient observations', `observe=${a.enabled} · ${a.count ?? events.length} retained · ${events.length} recent`)
        : warn('presence.ambient', 'Ambient observations', `GET /api/ambient ${ambient.status} ${ambient.error || ''}`),
    );

    return out;
  },
};
