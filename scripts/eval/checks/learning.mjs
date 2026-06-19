import { ok, warn, fail } from '../_client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
    let savedSkillPath = '';
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
      const replay = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/replay/plan`, {
          method: 'POST',
          body: { source: 'eval', instruction: 'Prepare safe replay only' },
        })
        : { ok: false, data: {} };
      const replayPlan = replay.data || {};
      const replayRunBlocked = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/replay/run`, {
          method: 'POST',
          body: { source: 'eval', instruction: 'Attempt run without confirmation' },
        })
        : { ok: false, data: {} };
      const replayRunPreview = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/replay/run`, {
          method: 'POST',
          body: { source: 'eval', execute: false, instruction: 'Preview confirmed run gate' },
        })
        : { ok: false, data: {} };
      const demonstrationSkillDraft = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/skill-draft`, {
          method: 'POST',
          body: { source: 'eval', title: 'Eval demonstrated workflow skill' },
        })
        : { ok: false, data: {} };
      const demonstrationSkillSaveBlocked = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/skill-draft/save`, {
          method: 'POST',
          body: { source: 'eval', title: 'Eval demonstrated workflow skill' },
        })
        : { ok: false, data: {} };
      const evalSkillName = `eval-demonstration-skill-${String(demoId).slice(0, 8)}`;
      const demonstrationSkillSaved = demoId
        ? await ctx.api(`/api/demonstrations/${encodeURIComponent(demoId)}/skill-draft/save`, {
          method: 'POST',
          body: {
            source: 'eval',
            title: 'Eval demonstrated workflow skill',
            name: evalSkillName,
            confirm: true,
          },
        })
        : { ok: false, data: {} };
      savedSkillPath = demonstrationSkillSaved.data?.path || '';
      const skillSearch = await ctx.api('/api/skills/local?query=target%20panel%20saved%20state&kind=demonstration&limit=5&source=eval');
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
      out.push(
        replay.ok &&
          replayPlan.ok === true &&
          replayPlan.replayMode === 'safe_preview' &&
          replayPlan.execute === false &&
          replayPlan.appWorkflow?.execute === false &&
          replayPlan.safety?.previewOnly === true &&
          replayPlan.safety?.reobserveBeforeActing === true &&
          replayPlan.safety?.noCoordinates === true &&
          Array.isArray(replayPlan.steps) &&
          replayPlan.steps.length === 1
          ? ok('learning.demonstration_replay_plan', 'UI demonstration replay plan', `${replayPlan.steps.length} step(s) · ${replayPlan.replayMode}`)
          : fail('learning.demonstration_replay_plan', 'UI demonstration replay plan', `plan ${replay.status} ${replay.error || ''}`, replay.data),
      );
      out.push(
        !replayRunBlocked.ok &&
          replayRunBlocked.status === 409 &&
          replayRunBlocked.data?.confirmationRequired === true &&
          replayRunBlocked.data?.executed === false &&
          replayRunPreview.ok &&
          replayRunPreview.data?.executed === false &&
          replayRunPreview.data?.replayMode === 'confirmed_run_preview'
          ? ok('learning.demonstration_replay_run_gate', 'UI demonstration replay run gate', 'confirm:true required for execution; execute:false previews only')
          : fail('learning.demonstration_replay_run_gate', 'UI demonstration replay run gate', `blocked ${replayRunBlocked.status} preview ${replayRunPreview.status}`, { blocked: replayRunBlocked.data, preview: replayRunPreview.data }),
      );
      out.push(
        demonstrationSkillDraft.ok &&
          demonstrationSkillDraft.data?.source === 'demonstration_skill_draft' &&
          demonstrationSkillDraft.data?.skill?.markdown &&
          String(demonstrationSkillDraft.data.skill.markdown).includes('# Replay Plan') &&
          String(demonstrationSkillDraft.data.skill.suggestedUserPath || '').includes('/.agents/skills/') &&
          !demonstrationSkillSaveBlocked.ok &&
          demonstrationSkillSaveBlocked.status === 409 &&
          demonstrationSkillSaveBlocked.data?.requiresConfirmation === true
          ? ok('learning.demonstration_skill_draft', 'UI demonstration skill draft', `${demonstrationSkillDraft.data.skill.name} · save requires confirmation`)
          : fail('learning.demonstration_skill_draft', 'UI demonstration skill draft', `draft ${demonstrationSkillDraft.status} save ${demonstrationSkillSaveBlocked.status}`, { draft: demonstrationSkillDraft.data, save: demonstrationSkillSaveBlocked.data }),
      );
      out.push(
        demonstrationSkillSaved.ok &&
          String(savedSkillPath).includes(`/.agents/skills/${evalSkillName}/SKILL.md`) &&
          skillSearch.ok &&
          Array.isArray(skillSearch.data?.skills?.results) &&
          skillSearch.data.skills.results.some((skill) => skill.name === evalSkillName && skill.kind === 'demonstration')
          ? ok('learning.local_skill_recall', 'Local skill recall', `${evalSkillName} recalled from ${skillSearch.data.skills.returned} match(es)`)
          : fail('learning.local_skill_recall', 'Local skill recall', `save ${demonstrationSkillSaved.status} search ${skillSearch.status}`, { saved: demonstrationSkillSaved.data, search: skillSearch.data }),
      );
    } finally {
      const safeRoot = path.join(os.homedir(), '.agents', 'skills');
      if (savedSkillPath && savedSkillPath.startsWith(`${safeRoot}${path.sep}eval-demonstration-skill-`)) {
        fs.rmSync(path.dirname(savedSkillPath), { recursive: true, force: true });
      }
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
