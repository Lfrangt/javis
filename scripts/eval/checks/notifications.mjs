import { ok, fail } from '../_client.mjs';

// Resident notifications (README: "Resident system notifications for approvals
// and background task completion"). Uses the dryRun path so it validates the
// notification path WITHOUT firing a real system notification (the test
// endpoint now honors dryRun — see docs/issues/2026-06-23-notifications-test-no-dryrun.md).
export default {
  lane: 'notifications',
  async run(ctx) {
    const out = [];

    const state = await ctx.api('/api/notifications/state');
    const ns = state.data?.notifications;
    out.push(
      state.ok && ns && typeof ns.supported === 'boolean'
        ? ok('notif.state', 'Notification state', `supported=${ns.supported} enabled=${ns.enabled} sent=${ns.sent ?? ns.counts?.sent ?? '?'}`)
        : fail('notif.state', 'Notification state', `GET /api/notifications/state ${state.status} ${state.error || ''}`),
    );

    const sentBefore = ns?.sent ?? ns?.counts?.sent ?? 0;
    const dry = await ctx.api('/api/notifications/test', { method: 'POST', body: { dryRun: true, source: 'eval' } });
    const after = await ctx.api('/api/notifications/state');
    const sentAfter = after.data?.notifications?.sent ?? after.data?.notifications?.counts?.sent ?? 0;
    out.push(
      dry.ok && dry.data?.dryRun === true && dry.data?.wouldSend?.title && sentAfter === sentBefore
        ? ok('notif.dryrun', 'Test dry-run', `validated path · wouldSend="${dry.data.wouldSend.title}" · no real send (sent stayed ${sentAfter})`)
        : fail('notif.dryrun', 'Test dry-run', `dryRun not honored (dryRun=${dry.data?.dryRun}, sent ${sentBefore}→${sentAfter}) — restart JAVIS to load the fix`, dry.data),
    );

    return out;
  },
};
