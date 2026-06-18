import { ok, warn, fail } from '../_client.mjs';

// Lane contract registry (ROADMAP "deterministic lane contract registry for
// owner/scope/handoff/risk boundaries before model choice").
export default {
  lane: 'lanes',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/lanes/contracts');
    const snapshot = r.data?.laneContracts || r.data || {};
    const contracts = snapshot.contracts || r.data?.contracts || r.data?.lanes || (Array.isArray(r.data) ? r.data : null);
    if (!r.ok || !Array.isArray(contracts)) {
      out.push(fail('lanes.registry', 'Lane contracts', `GET /api/lanes/contracts ${r.status} ${r.error || ''}`));
      return out;
    }
    out.push(ok('lanes.registry', 'Lane contracts', `${contracts.length} lane contract(s): ${contracts.map((c) => c.id || c.lane || c.name).filter(Boolean).slice(0, 6).join(', ')}`));

    const sample = contracts[0];
    const complete = sample && ['owner', 'scope', 'handoff', 'risk'].some((k) => k in sample || `${k}Boundary` in sample);
    out.push(
      complete
        ? ok('lanes.fields', 'Contract fields', 'contracts carry owner/scope/handoff/risk boundaries')
        : warn('lanes.fields', 'Contract fields', 'contract objects do not obviously expose owner/scope/handoff/risk'),
    );

    return out;
  },
};
