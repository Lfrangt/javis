import { ok, warn, fail } from '../_client.mjs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import url from 'node:url';

const execFileAsync = promisify(execFile);
const here = path.dirname(url.fileURLToPath(import.meta.url));
const collabCli = path.join(here, '..', '..', 'collab.mjs');
const configCui = path.join(here, '..', '..', 'config-cui.cjs');

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

    try {
      const { stdout } = await execFileAsync(process.execPath, [collabCli, 'status', '--json'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const cliSnapshot = JSON.parse(stdout);
      out.push(
        cliSnapshot?.collaboration?.counts
          ? ok('collaboration.cli_status', 'Collaboration CLI status', `${cliSnapshot.collaboration.counts.active || 0} active claim(s) via npm run collab`)
          : fail('collaboration.cli_status', 'Collaboration CLI status', 'missing collaboration counts', cliSnapshot),
      );
    } catch (error) {
      out.push(fail('collaboration.cli_status', 'Collaboration CLI status', error instanceof Error ? error.message : String(error)));
    }

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

    const handoff = await ctx.api('/api/collaboration/handoff?limit=20');
    const handoffActive = handoff.data?.handoff?.activeScopes || [];
    out.push(
      handoff.ok &&
        handoff.data?.handoff?.summary &&
        Array.isArray(handoff.data?.handoff?.nextActions) &&
        handoffActive.some((item) => item.key === scope || item.scope === scope)
        ? ok('collaboration.handoff_api', 'Collaboration handoff API', handoff.data.handoff.summary)
        : fail('collaboration.handoff_api', 'Collaboration handoff API', 'handoff did not expose active scope and next actions', handoff.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, [collabCli, 'handoff', '--json'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const cliHandoff = JSON.parse(stdout);
      const cliScopes = cliHandoff?.handoff?.activeScopes || [];
      out.push(
        cliHandoff?.handoff?.summary && cliScopes.some((item) => item.key === scope || item.scope === scope)
          ? ok('collaboration.cli_handoff', 'Collaboration CLI handoff', cliHandoff.handoff.summary)
          : fail('collaboration.cli_handoff', 'Collaboration CLI handoff', 'missing handoff summary or active scope', cliHandoff),
      );
    } catch (error) {
      out.push(fail('collaboration.cli_handoff', 'Collaboration CLI handoff', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, [configCui, '--print-collaboration-handoff'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      out.push(
        stdout.includes('Collaboration Handoff') &&
          stdout.includes(scope) &&
          stdout.includes('heartbeat=') &&
          stdout.includes('release=')
          ? ok('collaboration.cui_handoff', 'Collaboration CUI handoff', 'config CUI prints handoff, active scope, heartbeat, and release commands')
          : fail('collaboration.cui_handoff', 'Collaboration CUI handoff', 'CUI handoff output missing expected content', { stdout }),
      );
    } catch (error) {
      out.push(fail('collaboration.cui_handoff', 'Collaboration CUI handoff', error instanceof Error ? error.message : String(error)));
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

    let forcedConflictId = '';
    const forcedConflict = await ctx.api('/api/collaboration/claims', {
      method: 'POST',
      body: {
        agent: 'eval-conflict-forced',
        owner: 'eval-conflict-forced',
        lane: 'local',
        scope,
        access: 'write',
        task: 'Forced overlap to verify collaboration handoff conflict mode',
        ttlMs: 120000,
        force: true,
        source: 'eval',
      },
    });
    if (forcedConflict.ok && forcedConflict.data?.claim?.id) {
      forcedConflictId = forcedConflict.data.claim.id;
      const conflictHandoff = await ctx.api('/api/collaboration/handoff?limit=20');
      out.push(
        conflictHandoff.ok &&
          conflictHandoff.data?.handoff?.mode === 'conflict' &&
          (conflictHandoff.data?.handoff?.conflictPairs || []).length >= 1
          ? ok('collaboration.handoff_conflict', 'Collaboration handoff conflict mode', `${conflictHandoff.data.handoff.conflictPairs.length} conflict pair(s)`)
          : fail('collaboration.handoff_conflict', 'Collaboration handoff conflict mode', 'forced overlap did not appear in handoff', conflictHandoff.data),
      );
      await ctx.api(`/api/collaboration/claims/${encodeURIComponent(forcedConflictId)}/release`, {
        method: 'POST',
        body: { status: 'released', source: 'eval', result: 'forced conflict eval complete' },
      });
    } else {
      out.push(fail('collaboration.handoff_conflict', 'Collaboration handoff conflict mode', `forced claim ${forcedConflict.status} ${forcedConflict.error || forcedConflict.data?.error || ''}`, forcedConflict.data));
    }

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
