import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'collaboration',
  async run(ctx) {
    const out = [];

    const before = await ctx.api('/api/collaboration?limit=10');
    const snapshot = before.data?.collaboration;
    if (!before.ok || !snapshot) {
      out.push(fail('collaboration.read', 'Collaboration ledger', `GET /api/collaboration ${before.status} ${before.error || ''}`));
      return out;
    }
    out.push(ok('collaboration.read', 'Collaboration ledger', `${snapshot.counts?.active || 0} active claim(s), ${snapshot.counts?.conflicts || 0} conflict pair(s)`, { counts: snapshot.counts }));

    const scope = `eval/collaboration/${Date.now()}`;
    let claimId = '';
    const claim = await ctx.api('/api/collaboration/claims', {
      method: 'POST',
      body: {
        agent: 'eval-harness',
        owner: 'eval',
        lane: 'local',
        scope,
        access: 'write',
        task: 'Temporary collaboration ledger eval claim',
        ttlMs: 120000,
        source: 'eval',
      },
    });
    if (claim.ok && claim.data?.claim?.id) {
      claimId = claim.data.claim.id;
      out.push(ok('collaboration.claim', 'Temporary claim', `created ${claimId} for ${scope}`));
    } else {
      out.push(fail('collaboration.claim', 'Temporary claim', `POST claim ${claim.status} ${claim.error || claim.data?.error || ''}`));
      return out;
    }

    const conflict = await ctx.api('/api/collaboration/claims', {
      method: 'POST',
      body: {
        agent: 'eval-conflict',
        owner: 'eval-conflict',
        lane: 'local',
        scope,
        access: 'write',
        task: 'Expected blocked eval conflict',
        ttlMs: 120000,
        source: 'eval',
      },
    });
    out.push(
      conflict.status === 409 && conflict.data?.ok === false && (conflict.data?.conflicts || []).length >= 1
        ? ok('collaboration.conflict', 'Conflict detection', 'overlapping write claim returned 409')
        : fail('collaboration.conflict', 'Conflict detection', `expected 409 conflict, got ${conflict.status}`, conflict.data),
    );

    const heartbeat = await ctx.api(`/api/collaboration/claims/${encodeURIComponent(claimId)}/heartbeat`, {
      method: 'POST',
      body: { ttlMs: 120000, source: 'eval' },
    });
    out.push(
      heartbeat.ok
        ? ok('collaboration.heartbeat', 'Claim heartbeat', 'temporary claim refreshed')
        : warn('collaboration.heartbeat', 'Claim heartbeat', `heartbeat ${heartbeat.status} ${heartbeat.error || ''}`),
    );

    const release = await ctx.api(`/api/collaboration/claims/${encodeURIComponent(claimId)}/release`, {
      method: 'POST',
      body: { status: 'done', source: 'eval', result: 'eval complete' },
    });
    out.push(
      release.ok && release.data?.claim?.status === 'done'
        ? ok('collaboration.release', 'Claim release', 'temporary claim marked done')
        : fail('collaboration.release', 'Claim release', `release ${release.status} ${release.error || release.data?.error || ''}`),
    );

    return out;
  },
};
