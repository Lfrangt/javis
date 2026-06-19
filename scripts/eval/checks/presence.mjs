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
      const knownModes = new Set(['standby', 'watching', 'waking', 'connecting', 'listening', 'voice_error', 'working', 'needs_attention', 'setup_blocked']);
      out.push(
        knownModes.has(p.mode)
          ? ok('presence.state', 'Presence state', `mode=${p.mode || '?'} · ${p.label || ''}`, { mode: p.mode })
          : fail('presence.state', 'Presence state', `unknown mode ${p.mode || '?'}`, { mode: p.mode }),
      );

      const intervention = p.intervention || {};
      out.push(
        intervention.passiveByDefault === true && intervention.requiresUserIntent === true && typeof intervention.next === 'string'
          ? ok('presence.guardrails', 'Presence guardrails', `passive=${intervention.passiveByDefault} · user intent=${intervention.requiresUserIntent}`)
          : fail('presence.guardrails', 'Presence guardrails', 'presence must expose passive-by-default intervention boundaries', intervention),
      );
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
