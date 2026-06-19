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
          Array.isArray(attention.reasons) &&
          intervention.attentionLevel === attention.level
          ? ok('presence.attention_policy', 'Attention policy', `${attention.level} · pet=${attention.petState} · notify=${attention.shouldNotify ? 'yes' : 'no'}`)
          : fail('presence.attention_policy', 'Attention policy', 'presence must expose quiet attention policy and cooldown state', attention),
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
          output.includes('Reasons:')
          ? ok('presence.attention_cui', 'CUI attention policy', 'config CUI prints quiet attention policy')
          : fail('presence.attention_cui', 'CUI attention policy', 'expected --print-attention to print attention policy', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('presence.attention_cui', 'CUI attention policy', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
