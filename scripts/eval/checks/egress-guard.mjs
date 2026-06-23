import { ok, warn, fail } from '../_client.mjs';

// OpenAI egress + spend guard (the zero-spend safety sentinel: it intercepts
// fetch/http(s) to OpenAI hosts and requires a spend-reservation scope, so a
// runaway code path cannot silently bill the user's OpenAI key). Read-only —
// the probe explicitly does not call OpenAI. README/SAFETY: user-owned keys,
// local-first trust, hard stops on cost.
export default {
  lane: 'egress-guard',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/openai/egress-guard');
    const g = r.data?.egressGuard;
    if (!r.ok || !g) {
      out.push(fail('egress.read', 'OpenAI egress guard', `GET /api/openai/egress-guard ${r.status} ${r.error || ''}`));
      return out;
    }

    const guardsHosts = Array.isArray(g.guardedHosts)
      && g.guardedHosts.some((h) => /(^|\.)api\.openai\.com$/.test(String(h)) || h === 'api.openai.com');
    out.push(
      g.enabled && g.installed && g.mode === 'scoped_allow_only' && guardsHosts
        ? ok('egress.installed', 'Egress guard installed', `mode=${g.mode} · guards ${g.guardedHosts.length} OpenAI host(s) across ${Object.values(g.guardedApis || {}).filter(Boolean).length} HTTP API(s)`)
        : warn('egress.installed', 'Egress guard installed', `enabled=${g.enabled} installed=${g.installed} mode=${g.mode}`, { g }),
    );

    // Safety contract: blocks unscoped OpenAI fetch, requires a spend scope, and
    // the probe itself must not call OpenAI or leak the token.
    const s = g.safety || {};
    out.push(
      s.blocksUnscopedOpenAiFetch === true
        && s.requiresSpendReservationScope === true
        && s.callsOpenAiDuringProbe === false
        && s.exposesApiToken === false
        ? ok('egress.contract', 'Egress safety contract', 'blocks unscoped OpenAI fetch · requires spend scope · no spend or token leak during probe')
        : fail('egress.contract', 'Egress safety contract', 'egress guard safety contract not fully asserted', { safety: s }),
    );

    const sp = r.data?.spendGuard;
    if (sp) {
      out.push(
        typeof sp.hardSpendLock === 'boolean' && sp.egressGuardEnabled === true && typeof sp.paranoidZeroSpend?.enabled === 'boolean'
          ? ok('egress.spend_guard', 'Spend guard', `hardLock=${sp.hardSpendLock} · paranoidZeroSpend=${sp.paranoidZeroSpend.enabled} · mode=${sp.mode}`)
          : warn('egress.spend_guard', 'Spend guard', `spend guard shape unexpected (${Object.keys(sp).slice(0, 6).join(',')})`, { sp }),
      );
    }

    return out;
  },
};
