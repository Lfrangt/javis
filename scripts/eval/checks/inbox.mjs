import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'inbox',
  async run(ctx) {
    const out = [];
    const createdIds = [];

    try {
      const list = await ctx.api('/api/inbox');
      const inbox = list.data?.inbox || {};
      const items = inbox.items || list.data?.items || (Array.isArray(list.data) ? list.data : null);
      if (!list.ok || !Array.isArray(items)) {
        out.push(fail('inbox.list', 'Inbox list', `GET /api/inbox ${list.status} ${list.error || ''}`));
      } else {
        const counts = inbox.counts || {};
        out.push(ok('inbox.list', 'Inbox list', `${items.length} returned · ${counts.open || 0} open · ${counts.total || items.length} total`, { counts }));
      }

      for (const item of [
        {
          title: 'Eval inbox quick reply',
          body: 'Summarize this note and keep it as a quick follow-up.',
          priority: 1,
          source: 'eval_inbox_contract',
          tags: ['eval', 'quick'],
        },
        {
          title: 'Eval inbox delete payment warning',
          body: 'Delete a payment draft only after explicit confirmation.',
          priority: 2,
          source: 'eval_inbox_contract',
          tags: ['eval', 'sensitive'],
        },
      ]) {
        const created = await ctx.api('/api/inbox', {
          method: 'POST',
          body: item,
          retries: 0,
        });
        if (created.data?.item?.id) createdIds.push(created.data.item.id);
      }

      const triage = await ctx.api('/api/inbox/triage', {
        method: 'POST',
        body: { limit: 30, source: 'eval' },
      });
      const t = triage.data?.triage || triage.data;
      out.push(
        triage.ok && t
          ? ok('inbox.triage', 'Inbox triage', `prioritized=${Array.isArray(t.items) ? t.items.length : Array.isArray(t.prioritized) ? t.prioritized.length : 'ok'}`)
          : warn('inbox.triage', 'Inbox triage', `GET /api/inbox/triage ${triage.status} ${triage.error || ''}`),
      );
      const fixtureItems = Array.isArray(t?.items) ? t.items.filter((item) => createdIds.includes(item.id)) : [];
      const groups = t?.groups || {};
      out.push(
        triage.ok &&
          fixtureItems.length >= 2 &&
          Array.isArray(groups.byLane) &&
          Array.isArray(groups.byPriority) &&
          Array.isArray(groups.bySource) &&
          typeof t.spokenSummary === 'string' &&
          t.confirmationPolicy?.requiresExplicitUserIntent === true &&
          fixtureItems.every((item) => item.confirmationPolicy?.spokenPrompt && item.confirmationPolicy.autoProcessAllowed === false)
          ? ok('inbox.triage_groups', 'Inbox triage groups', `${groups.byLane.length} lane group(s), ${groups.bySource.length} source group(s), ${fixtureItems.length} fixture item(s)`)
          : fail('inbox.triage_groups', 'Inbox triage groups', 'triage did not expose grouped items and voice confirmation policy', t),
      );

      try {
        const { stdout } = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-inbox-triage'], {
          cwd: process.cwd(),
          timeout: 15000,
          maxBuffer: 1024 * 1024,
        });
        out.push(
          stdout.includes('Inbox triage:') &&
            stdout.includes('By lane:') &&
            stdout.includes('Policy:') &&
            stdout.includes('ask:')
            ? ok('inbox.cui_triage', 'Inbox CUI triage', 'config CUI prints grouped Inbox triage and spoken confirmation prompts')
            : fail('inbox.cui_triage', 'Inbox CUI triage', 'expected --print-inbox-triage to show grouped triage and prompts', { output: stdout.slice(0, 2000) }),
        );
      } catch (error) {
        out.push(fail('inbox.cui_triage', 'Inbox CUI triage', error instanceof Error ? error.message : String(error)));
      }
    } finally {
      for (const id of createdIds) {
        await ctx.api(`/api/inbox/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          retries: 0,
        });
      }
    }

    return out;
  },
};
