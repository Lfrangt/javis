import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'learning',
  async run(ctx) {
    const out = [];

    const state = await ctx.api('/api/learning');
    const learning = state.data?.learning;
    if (!state.ok || !learning) {
      out.push(fail('learning.state', 'Learning state', `GET /api/learning ${state.status} ${state.error || ''}`));
      return out;
    }
    const controls = learning.controls || {};
    const profile = learning.profile || {};
    out.push(ok(
      'learning.controls',
      'Learning controls',
      `${learning.enabled ? 'enabled' : learning.paused ? 'paused' : 'off'} · prompts ${learning.includeInPrompts ? 'on' : 'off'} · ${(controls.excludedApps || []).length + (controls.excludedHosts || []).length + (controls.excludedFolders || []).length} exclusion(s)`,
      { configured: learning.configured, enabled: learning.enabled, paused: learning.paused },
    ));
    out.push(ok(
      'learning.profile',
      'Distilled profile',
      `${profile.sourceEventCount || 0} source event(s) · ${profile.summary || 'no summary yet'}`,
      { sourceEventCount: profile.sourceEventCount || 0 },
    ));

    const draft = await ctx.api('/api/learning/skill-draft?source=eval&force=true&routeLimit=2&workflowLimit=2');
    const skill = draft.data?.skill;
    out.push(
      draft.ok && skill?.markdown && String(skill.markdown).includes('# Workflow')
        ? ok('learning.skill_draft', 'Skill draft preview', `${skill.name || 'unnamed'} · ${skill.markdown.length} chars`)
        : warn('learning.skill_draft', 'Skill draft preview', `draft ${draft.status} ${draft.error || draft.data?.error || ''}`),
    );

    let demoId = '';
    try {
      const started = await ctx.api('/api/demonstrations/start', {
        method: 'POST',
        body: {
          title: 'Eval UI demonstration',
          goal: 'Verify explicit local UI demonstration recording',
          captureInitial: false,
          source: 'eval',
        },
      });
      demoId = started.data?.demonstration?.id || '';
      if (!started.ok || !demoId) {
        out.push(fail('learning.demonstration_record', 'UI demonstration record', `start ${started.status} ${started.error || ''}`, started.data));
        return out;
      }

      const captured = await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/capture`, {
        method: 'POST',
        body: {
          source: 'eval',
          instruction: 'Open the target panel and confirm the saved state',
          observation: {
            frontmost: { app: 'EvalApp', windowTitle: 'Demo Window', available: true },
            browser: { available: false },
            screen: { width: 1200, height: 800, privacyMode: 'private', source: 'eval' },
            accessibility: { available: true, app: 'EvalApp', windowTitle: 'Demo Window', nodeCount: 1, outline: '1 AXButton "Confirm"' },
          },
        },
      });
      const finished = await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/finish`, {
        method: 'POST',
        body: { source: 'eval' },
      });
      const demo = finished.data?.demonstration;
      const playbook = finished.data?.playbook || demo?.playbook;
      out.push(
        captured.ok &&
          finished.ok &&
          demo?.status === 'done' &&
          Array.isArray(demo.steps) &&
          demo.steps.length === 1 &&
          String(playbook?.markdown || '').includes('Replay mode: manual preview')
          ? ok('learning.demonstration_record', 'UI demonstration record', `${demo.steps.length} step(s) · ${playbook?.replayMode || 'manual_preview'}`)
          : fail('learning.demonstration_record', 'UI demonstration record', `capture ${captured.status} finish ${finished.status}`, { captured: captured.data, finished: finished.data }),
      );
    } finally {
      if (demoId) {
        await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}`, {
          method: 'DELETE',
          body: { source: 'eval_cleanup' },
        });
      }
    }

    return out;
  },
};
