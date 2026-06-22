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

      const processPreview = await ctx.api('/api/inbox/process-next', {
        method: 'POST',
        body: { source: 'eval_inbox_process_preview' },
        retries: 0,
      });
      const processGate = await ctx.api('/api/inbox/process-next', {
        method: 'POST',
        body: { execute: true, source: 'eval_inbox_process_gate' },
        retries: 0,
      });
      out.push(
        processPreview.ok &&
          processPreview.data?.ok === true &&
          processPreview.data?.status === 'preview' &&
          processPreview.data?.previewOnly === true &&
          processPreview.data?.executeRequested === false &&
          processPreview.data?.requiresConfirmation === false &&
          processPreview.data?.executed === false &&
          processPreview.data?.queued === false &&
          processGate.ok &&
          processGate.data?.ok === true &&
          processGate.data?.status === 'confirmation_required' &&
          processGate.data?.previewOnly === true &&
          processGate.data?.executeRequested === true &&
          processGate.data?.confirm === false &&
          processGate.data?.requiresConfirmation === true &&
          processGate.data?.executed === false &&
          processGate.data?.queued === false
          ? ok('inbox.process_next_gate', 'Inbox process-next preview and confirmation gate', 'process-next previews first and requires confirm:true before routing or marking done')
          : fail('inbox.process_next_gate', 'Inbox process-next preview and confirmation gate', 'expected process-next to preview by default and stop at confirmation_required before execution', {
              preview: processPreview.data,
              gate: processGate.data,
            }),
      );

      const routeTargetId = createdIds[0] || '';
      const routePreview = routeTargetId
        ? await ctx.api(`/api/inbox/${encodeURIComponent(routeTargetId)}/route`, {
            method: 'POST',
            body: { source: 'eval_inbox_route_preview' },
            retries: 0,
          })
        : null;
      const routeGate = routeTargetId
        ? await ctx.api(`/api/inbox/${encodeURIComponent(routeTargetId)}/route`, {
            method: 'POST',
            body: { execute: true, source: 'eval_inbox_route_gate' },
            retries: 0,
          })
        : null;
      out.push(
        routePreview?.ok &&
          routePreview.data?.ok === true &&
          routePreview.data?.status === 'preview' &&
          routePreview.data?.previewOnly === true &&
          routePreview.data?.item?.status === 'open' &&
          routePreview.data?.executed === false &&
          routePreview.data?.queued === false &&
          routeGate?.ok &&
          routeGate.data?.ok === true &&
          routeGate.data?.status === 'confirmation_required' &&
          routeGate.data?.previewOnly === true &&
          routeGate.data?.requiresConfirmation === true &&
          routeGate.data?.item?.status === 'open' &&
          routeGate.data?.executed === false &&
          routeGate.data?.queued === false
          ? ok('inbox.route_gate', 'Inbox item route preview and confirmation gate', `${routeTargetId} stayed open until confirm:true`)
          : fail('inbox.route_gate', 'Inbox item route preview and confirmation gate', 'expected item route to preview and require confirmation before marking done', {
              preview: routePreview?.data,
              gate: routeGate?.data,
            }),
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
