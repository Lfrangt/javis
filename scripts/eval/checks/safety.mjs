import { ok, warn, fail } from '../_client.mjs';

async function rawApi(ctx, pathname, { method = 'GET', headers = {}, body } = {}) {
  try {
    const response = await fetch(`${ctx.baseUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

// Safety gates (GOAL "hard stops for sends, deletes, purchases, account
// changes" + issue note "keep the Level 3 policy / approval gates"). Read-only:
// previews Level-3 policy behavior and confirms Level-4 export-style work is
// not silently executable.
export default {
  lane: 'safety',
  async run(ctx) {
    const out = [];

    const publicHealth = await rawApi(ctx, '/api/health');
    const noTokenReadiness = await rawApi(ctx, '/api/readiness');
    const badTokenReadiness = await rawApi(ctx, '/api/readiness', {
      headers: { 'X-JAVIS-Token': 'javis-eval-bad-token' },
    });
    const untrustedOrigin = await rawApi(ctx, '/api/readiness', {
      headers: {
        ...(ctx.token ? { 'X-JAVIS-Token': ctx.token } : {}),
        Origin: 'https://malicious.example.invalid',
      },
    });
    const trustedTokenReadiness = ctx.token
      ? await rawApi(ctx, '/api/readiness', { headers: { 'X-JAVIS-Token': ctx.token } })
      : { ok: false, status: 0, data: null, error: 'no runtime token discovered' };
    const tokenProtected =
      publicHealth.ok &&
      noTokenReadiness.status === 401 &&
      badTokenReadiness.status === 401 &&
      untrustedOrigin.status === 403 &&
      trustedTokenReadiness.ok;
    out.push(
      tokenProtected
        ? ok('safety.api_auth', 'Local API token and origin gate', 'health is public; protected endpoints reject missing/bad tokens and untrusted origins; runtime token is accepted', {
          publicHealth: publicHealth.status,
          noTokenReadiness: noTokenReadiness.status,
          badTokenReadiness: badTokenReadiness.status,
          untrustedOrigin: untrustedOrigin.status,
          trustedTokenReadiness: trustedTokenReadiness.status,
        })
        : fail('safety.api_auth', 'Local API token and origin gate', `expected public health=200, missing/bad token=401, untrusted origin=403, trusted token=200; got health=${publicHealth.status} missing=${noTokenReadiness.status} bad=${badTokenReadiness.status} origin=${untrustedOrigin.status} trusted=${trustedTokenReadiness.status}`, {
          publicHealth,
          noTokenReadiness,
          badTokenReadiness,
          untrustedOrigin,
          trustedTokenReadiness,
        }),
    );

    const pol = await ctx.api('/api/actions/policy');
    const policy = pol.data?.policy || pol.data;
    if (!pol.ok || !policy) {
      out.push(fail('safety.policy', 'Action policy', `GET /api/actions/policy ${pol.status} ${pol.error || ''}`));
    } else {
      const allow = policy.allow || {};
      out.push(ok('safety.policy', 'Action policy', `maxAutoRisk=${policy.maxAutoRiskLevel} approvalAt=${policy.requireApprovalAtRiskLevel} dryRun=${policy.dryRun} localExec=${policy.localExecutionEnabled ?? policy.localExec ?? '?'}`, { keys: Object.keys(allow) }));

      // Broad web AX roles are needed for Chromium contenteditables, but they
      // must be gated by explicit editable evidence before preview/execution.
      const axRoles = allow.ax_set_value?.allowedRoles;
      if (Array.isArray(axRoles)) {
        const broadRoles = axRoles.filter((r) => ['AXGroup', 'AXStaticText', 'AXWebArea'].includes(r));
        const evidenceRoles = Array.isArray(allow.ax_set_value?.editableEvidenceRequiredRoles)
          ? allow.ax_set_value.editableEvidenceRequiredRoles
          : [];
        const missingEvidenceRoles = broadRoles.filter((r) => !evidenceRoles.includes(r));

        if (!broadRoles.length) {
          out.push(ok('safety.axroles', 'ax_set_value allowlist', `tight: ${axRoles.join(', ')}`, { axRoles }));
        } else if (missingEvidenceRoles.length) {
          out.push(fail('safety.axroles', 'ax_set_value editable evidence gate', `broad roles missing editable evidence gate: ${missingEvidenceRoles.join(', ')}`, { axRoles, evidenceRoles }));
        } else {
          const probe = await ctx.api('/api/actions/preview', {
            method: 'POST',
            body: {
              action: 'ax_set_value',
              nodeId: '1',
              expectedRole: broadRoles[0],
              expectedLabel: 'JAVIS eval non-editable broad-role probe',
              content: 'JAVIS eval safety probe',
            },
          });
          const blocked = probe.data?.ok === false && /editable evidence/i.test(String(probe.data?.error || ''));
          out.push(
            blocked
              ? ok('safety.axroles', 'ax_set_value editable evidence gate', `broad roles require editable evidence: ${broadRoles.join(', ')}`, { axRoles, evidenceRoles, probe: probe.data })
              : fail('safety.axroles', 'ax_set_value editable evidence gate', `broad role preview was not blocked without editable evidence (status ${probe.status})`, { axRoles, evidenceRoles, probe: probe.data }),
          );
        }
      }
    }

    // Preview a Level-3 action. In trusted local mode this can be allowed; in
    // guarded mode it must require approval or be blocked.
    const preview = await ctx.api('/api/actions/preview', { method: 'POST', body: { action: 'type_text', value: 'JAVIS eval safety probe' } });
    const ev = preview.data?.evaluation || preview.data;
    const plan = preview.data?.plan || {};
    const trustedLevel3 = Number(policy?.maxAutoRiskLevel || 0) >= 3 && Number(policy?.requireApprovalAtRiskLevel || 0) >= 4;
    const gated =
      (ev && (ev.needsApproval === true || ev.blocked === true || /approval|disabled|risk|level 3/i.test(String(ev.reason || '')))) ||
      (!preview.ok && /approval|disabled|level 3|risk/i.test(String(preview.data?.details || preview.data?.error || '')));
    const executed = preview.data?.executed === true || /executed/i.test(String(preview.data?.output || ''));
    if (executed) {
      out.push(fail('safety.level3', 'Level-3 preview', 'A preview response looked executed — gate bypass!'));
    } else if (trustedLevel3 && plan.riskLevel === 3 && ev?.needsApproval === false && ev?.blocked !== true) {
      out.push(ok('safety.level3', 'Level-3 preview', 'trusted local mode allows Level-3 preview without approval, as configured'));
    } else if (gated) {
      out.push(ok('safety.level3', 'Level-3 preview', 'guarded policy requires approval / blocks Level-3 preview'));
    } else {
      out.push(warn('safety.level3', 'Level-3 preview', `Could not confirm Level-3 policy behavior (status ${preview.status}); inspect /api/actions/preview shape`, { data: preview.data }));
    }

    const level4 = await ctx.api('/api/creative/action', {
      method: 'POST',
      body: {
        instruction: 'Prepare a video export panel without exporting anything',
        intent: 'video_edit',
        stage: 'export',
        actionId: 'open_export_panel',
        execute: true,
        confirm: false,
        source: 'eval',
      },
    });
    const blockedLevel4 =
      level4.status === 202 ||
      level4.status === 409 ||
      level4.data?.requiresConfirmation === true ||
      level4.data?.status === 'blocked' ||
      level4.data?.verification?.status === 'blocked';
    out.push(
      blockedLevel4
        ? ok('safety.level4', 'Level-4 confirmation gate', 'export-style creative action required confirmation / stayed blocked')
        : fail('safety.level4', 'Level-4 confirmation gate', `expected confirmation block, got ${level4.status}`, level4.data),
    );

    return out;
  },
};
