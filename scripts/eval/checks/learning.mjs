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

    return out;
  },
};
