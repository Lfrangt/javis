import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

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

      const attention = p.attention || {};
      out.push(
        attention.ok === true &&
          ['quiet', 'watching', 'waiting', 'notify'].includes(attention.level) &&
          typeof attention.shouldNotify === 'boolean' &&
          typeof attention.petState === 'string' &&
          attention.cooldown &&
          typeof attention.cooldown.remainingMs === 'number' &&
          typeof attention.cooldown.lastNotificationAt === 'number' &&
          Array.isArray(attention.reasons) &&
          intervention.attentionLevel === attention.level &&
          !Object.prototype.hasOwnProperty.call(attention, 'history')
          ? ok('presence.attention_policy', 'Attention policy', `${attention.level} · pet=${attention.petState} · notify=${attention.shouldNotify ? 'yes' : 'no'}`)
          : fail('presence.attention_policy', 'Attention policy', 'presence must expose lightweight quiet attention policy without operator history', attention),
      );

      const attentionApi = await ctx.api('/api/attention?limit=5');
      const attentionOperator = attentionApi.data?.attention || {};
      const history = attentionOperator.history || {};
      out.push(
        attentionApi.ok &&
          attentionOperator.ok === true &&
          history.ok === true &&
          history.operatorOnly === true &&
          history.desktopPet === false &&
          Array.isArray(history.recent) &&
          typeof history.summary === 'string' &&
          history.returned <= 5
          ? ok('presence.attention_history', 'Attention operator history', `${history.returned}/${history.count || 0} attention notification event(s)`)
          : fail('presence.attention_history', 'Attention operator history', 'attention API must expose operator-only history without bloating presence', attentionApi.data),
      );

      const notifyPreview = await ctx.api('/api/attention/notify', {
        method: 'POST',
        body: {
          source: 'eval',
          dryRun: true,
          title: 'JAVIS attention preview',
          body: 'Dry-run attention notification preview.',
        },
      });
      const decision = notifyPreview.data?.decision || {};
      out.push(
        notifyPreview.ok &&
          notifyPreview.data?.dryRun === true &&
          typeof notifyPreview.data?.delivered === 'boolean' &&
          typeof notifyPreview.data?.suppressed === 'boolean' &&
          typeof decision.shouldNotify === 'boolean' &&
          typeof decision.reason === 'string' &&
          decision.attention?.ok === true
          ? ok('presence.attention_notify_gate', 'Attention notification gate', `dry-run=${decision.shouldNotify ? 'would notify' : `suppressed:${decision.reason || 'policy'}`}`)
          : fail('presence.attention_notify_gate', 'Attention notification gate', 'dry-run attention notification gate must expose decision evidence without sending', notifyPreview.data),
      );

      const notifications = await ctx.api('/api/notifications/state');
      const notificationState = notifications.data?.notifications || {};
      out.push(
        notifications.ok &&
          notificationState.attentionNotifications &&
          typeof notificationState.attentionNotifications.sent === 'number' &&
          typeof notificationState.attentionNotifications.skipped === 'number' &&
          typeof notificationState.attentionNotifications.lastNotificationAt === 'number' &&
          notificationState.attentionNotifications.history?.operatorOnly === true &&
          Array.isArray(notificationState.attentionNotifications.history?.recent) &&
          notificationState.attention?.cooldown &&
          notificationState.attention.cooldown.lastNotificationAt === notificationState.attentionNotifications.lastNotificationAt
          ? ok('presence.attention_notification_state', 'Attention notification state', `${notificationState.attentionNotifications.sent} attention notification(s), cooldown=${notificationState.attention.cooldown.remainingLabel || 'now'}`)
          : fail('presence.attention_notification_state', 'Attention notification state', 'notifications state must separate attention notifications from ordinary notifications', notificationState),
      );

      const browserActivity = p.observing?.browserActivity || {};
      out.push(
        browserActivity.ok === true &&
          browserActivity.privacy?.metadataOnly === true &&
          browserActivity.privacy?.noPageText === true &&
          Array.isArray(browserActivity.recent) &&
          Array.isArray(browserActivity.topHosts) &&
          typeof browserActivity.summary === 'string'
          ? ok('presence.browser_activity', 'Browser activity in presence', `${browserActivity.count || 0} ambient browser sample(s) · ${browserActivity.summary}`)
          : fail('presence.browser_activity', 'Browser activity in presence', 'presence must expose metadata-only browser activity context', browserActivity),
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

    const activity = await ctx.api('/api/browser/activity?limit=5');
    const browserActivity = activity.data?.activity;
    out.push(
      activity.ok &&
        browserActivity?.ok === true &&
        browserActivity.privacy?.metadataOnly === true &&
        browserActivity.privacy?.noPageText === true &&
        Array.isArray(browserActivity.recent) &&
        Array.isArray(browserActivity.topHosts) &&
        typeof browserActivity.nextAction === 'string'
        ? ok('presence.browser_activity_api', 'Browser activity API', `${browserActivity.count || 0} sample(s), ${browserActivity.recent.length} recent context(s)`)
        : fail('presence.browser_activity_api', 'Browser activity API', `GET /api/browser/activity ${activity.status}`, activity.data),
    );

    const recentActivityResponse = await ctx.api('/api/activity/recent?limit=5');
    const recentActivity = recentActivityResponse.data?.activity;
    out.push(
      recentActivityResponse.ok &&
        recentActivity?.ok === true &&
        recentActivity?.kind === 'recent_activity' &&
        recentActivity.privacy?.localOnly === true &&
        recentActivity.privacy?.metadataOnly === true &&
        recentActivity.privacy?.noRawScreenshots === true &&
        recentActivity.privacy?.noClipboardText === true &&
        recentActivity.privacy?.noPageBodies === true &&
        recentActivity.privacy?.urlsReturned === false &&
        recentActivity.safety?.capturesScreenNow === false &&
        recentActivity.safety?.startsMicrophone === false &&
        recentActivity.safety?.usesRealtime === false &&
        recentActivity.safety?.returnsBrowserPageText === false &&
        Array.isArray(recentActivity.recent) &&
        Array.isArray(recentActivity.topApps)
        ? ok('presence.recent_activity_api', 'Recent activity API', `${recentActivity.count || 0} metadata sample(s), ${recentActivity.recent.length} segment(s)`)
        : fail('presence.recent_activity_api', 'Recent activity API', `GET /api/activity/recent ${recentActivityResponse.status}`, recentActivityResponse.data),
    );

    const perception = await ctx.api('/api/perception/consent?limit=5');
    const consent = perception.data?.perception;
    const surfaces = Array.isArray(consent?.surfaces) ? consent.surfaces : [];
    const surfaceIds = new Set(surfaces.map((surface) => surface.id));
    const screenSurface = surfaces.find((surface) => surface.id === 'screen_context') || {};
    const requiredSurfaces = [
      'screen_context',
      'voice_microphone',
      'ambient_observer',
      'browser_activity',
      'browser_page_reader',
      'clipboard',
      'accessibility_tree',
      'app_control',
      'local_learning',
      'worker_tools',
    ];
    const missingSurfaces = requiredSurfaces.filter((id) => !surfaceIds.has(id));
    out.push(
      perception.ok &&
        consent?.ok === true &&
        missingSurfaces.length === 0 &&
        surfaces.every((surface) => (
          typeof surface.enabled === 'boolean' &&
          typeof surface.status === 'string' &&
          typeof surface.rawContentStored === 'boolean' &&
          Array.isArray(surface.controls) &&
          Array.isArray(surface.auditTypes) &&
          surface.consent &&
          typeof surface.consent === 'object'
        )) &&
        screenSurface.evidence?.privacyRules &&
        typeof screenSurface.evidence.rulesSummary === 'string' &&
        screenSurface.evidence.enforcement?.appWindowContextFilter === true &&
        consent.policy?.passiveByDefault === true &&
        consent.policy?.requiresUserIntentForAction === true
        ? ok('presence.perception_consent_api', 'Perception consent API', `${surfaces.length} surface(s), ${consent.summary || ''}`)
        : fail('presence.perception_consent_api', 'Perception consent API', `missing/incomplete surface(s): ${missingSurfaces.join(', ') || 'metadata'}`, consent || perception.data),
    );

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-browser-activity'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      out.push(
        output.includes('Browser Activity') &&
          output.includes('Privacy: metadata-only=yes') &&
          output.includes('page text stored=no')
          ? ok('presence.browser_activity_cui', 'CUI browser activity', 'config CUI prints metadata-only browser activity')
          : fail('presence.browser_activity_cui', 'CUI browser activity', 'expected --print-browser-activity to print privacy-aware browser activity', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('presence.browser_activity_cui', 'CUI browser activity', error instanceof Error ? error.message : String(error)));
    }

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-perception'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      out.push(
        output.includes('Perception Consent') &&
          output.includes('screen_context') &&
          output.includes('browser_activity') &&
          output.includes('clipboard') &&
          output.includes('raw stored')
          ? ok('presence.perception_consent_cui', 'CUI perception consent', 'config CUI prints consent, storage, and audit status for perception surfaces')
          : fail('presence.perception_consent_cui', 'CUI perception consent', 'expected --print-perception to print perception surface status', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('presence.perception_consent_cui', 'CUI perception consent', error instanceof Error ? error.message : String(error)));
    }

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-attention'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      out.push(
        output.includes('Attention:') &&
          output.includes('Cooldown:') &&
          output.includes('Reasons:') &&
          output.includes('History:')
          ? ok('presence.attention_cui', 'CUI attention policy', 'config CUI prints quiet attention policy and operator history')
          : fail('presence.attention_cui', 'CUI attention policy', 'expected --print-attention to print attention policy and history', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('presence.attention_cui', 'CUI attention policy', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
