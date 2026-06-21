import { ok, warn, fail } from '../_client.mjs';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sameStringList(left = [], right = []) {
  return JSON.stringify(Array.from(left || [])) === JSON.stringify(Array.from(right || []));
}

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

    const evolution = await ctx.api('/api/learning/evolution?source=eval&recentLimit=8&baselineLimit=24');
    const evolutionData = evolution.data?.evolution;
    out.push(
      evolution.ok &&
        evolutionData?.ok === true &&
        typeof evolutionData.spokenSummary === 'string' &&
        Array.isArray(evolutionData.changes) &&
        evolutionData.windows?.recent &&
        evolutionData.windows?.baseline &&
        evolutionData.privacy?.localOnly === true &&
        evolutionData.privacy?.metadataOnly === true &&
        evolutionData.privacy?.noRawScreenshots === true &&
        evolutionData.privacy?.noClipboardText === true &&
        evolutionData.privacy?.noPageBodies === true &&
        evolutionData.privacy?.noPermissionGrant === true
        ? ok('learning.evolution', 'Learning evolution snapshot', `${evolutionData.windows.recent.count || 0} recent · ${evolutionData.windows.baseline.count || 0} baseline · ${evolutionData.changes.length} change(s)`)
        : fail('learning.evolution', 'Learning evolution snapshot', `GET /api/learning/evolution ${evolution.status}`, evolution.data),
    );

    try {
      const learningEvolutionCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-learning-evolution'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${learningEvolutionCui.stdout || ''}\n${learningEvolutionCui.stderr || ''}`;
      out.push(
        output.includes('Learning Evolution') &&
          output.includes('Privacy:') &&
          output.includes('metadata-only=yes') &&
          output.includes('Events:')
          ? ok('learning.evolution_cui', 'Learning evolution CUI', 'config CUI prints local evolution snapshot')
          : fail('learning.evolution_cui', 'Learning evolution CUI', 'expected config CUI to print local evolution details', { output: output.slice(0, 1800) }),
      );
    } catch (error) {
      out.push(fail('learning.evolution_cui', 'Learning evolution CUI', error instanceof Error ? error.message : String(error)));
    }

    const distillation = await ctx.api('/api/learning/distillation?source=eval&recentLimit=8&baselineLimit=24&skillLimit=4');
    const distillationData = distillation.data?.distillation;
    const distillationPrivacy = distillationData?.privacy || {};
    const distillationNextActions = Array.isArray(distillationData?.nextActions) ? distillationData.nextActions : [];
    const distillationNextActionIds = new Set(distillationNextActions.map((action) => action.id));
    const habitCandidates = distillationData?.habitCandidates || {};
    const habitCandidateList = Array.isArray(habitCandidates.candidates) ? habitCandidates.candidates : [];
    const profileRecentContexts = Array.isArray(distillationData?.profile?.recentContexts)
      ? distillationData.profile.recentContexts
      : [];
    out.push(
      distillation.ok &&
        distillationData?.ok === true &&
        distillationData?.kind === 'local_user_distillation' &&
        distillationData?.state?.learningFile &&
        String(distillationData.state.learningFile).includes('Application Support/JAVIS/Runtime') &&
        typeof distillationData.spokenSummary === 'string' &&
        typeof distillationData.profile?.sourceEventCount === 'number' &&
        Array.isArray(distillationData.evolution?.changes) &&
        typeof distillationData.artifacts?.demonstrations?.counts?.total === 'number' &&
        typeof distillationData.artifacts?.shortcuts?.counts?.total === 'number' &&
        typeof distillationData.artifacts?.shortcutCandidates?.count === 'number' &&
        typeof distillationData.artifacts?.skills?.returned === 'number' &&
        habitCandidates.ok === true &&
        habitCandidates.policy?.readOnly === true &&
        habitCandidates.policy?.inferenceOnly === true &&
        habitCandidates.policy?.noAutoSave === true &&
        habitCandidates.policy?.confirmationRequiredForPromotion === true &&
        habitCandidates.privacy?.localOnly === true &&
        habitCandidates.privacy?.metadataOnly === true &&
        habitCandidates.privacy?.noRawScreenshots === true &&
        habitCandidates.privacy?.noClipboardText === true &&
        habitCandidates.privacy?.noPageBodies === true &&
        habitCandidateList.length >= 1 &&
        habitCandidateList.every((candidate) =>
          candidate.id &&
          candidate.kind &&
          candidate.label &&
          typeof candidate.confidence === 'number' &&
          candidate.recommendedAction?.id &&
          candidate.safety?.localOnly === true &&
          candidate.safety?.metadataOnly === true &&
          candidate.safety?.doesNotExecute === true &&
          candidate.safety?.doesNotGrantPermission === true &&
          candidate.safety?.noAutoSave === true &&
          candidate.safety?.noRawScreenshots === true &&
          candidate.safety?.noClipboardText === true &&
          candidate.safety?.noPageBodies === true
        ) &&
        distillationPrivacy.localOnly === true &&
        distillationPrivacy.metadataOnly === true &&
        distillationPrivacy.modelFreeDistillation === true &&
        distillationPrivacy.inferredNotExplicitMemory === true &&
        distillationPrivacy.rawContentStoredByDefault === false &&
        distillationPrivacy.noRawScreenshots === true &&
        distillationPrivacy.noClipboardText === true &&
        distillationPrivacy.noPageBodies === true &&
        distillationPrivacy.noPermissionGrant === true &&
        /untrusted/i.test(distillationPrivacy.promptInjectionRisk || '') &&
        (distillationData.boundaries || []).some((item) => /inferred habits/i.test(item)) &&
        (distillationData.boundaries || []).some((item) => /Never skip sends/i.test(item)) &&
        distillationNextActionIds.has('review_habit_candidates') &&
        distillationNextActionIds.has('manage_exclusions') &&
        distillationNextActionIds.has('record_demonstration') &&
        distillationNextActionIds.has('preview_skill_draft') &&
        distillationNextActionIds.has('save_skill_or_memory') &&
        distillationNextActions.some((action) => action.id === 'save_skill_or_memory' && action.requiresConfirmation === true) &&
        profileRecentContexts.every((item) => !Object.prototype.hasOwnProperty.call(item, 'url'))
        ? ok('learning.distillation_status', 'Local user distillation status', distillationData.summary)
        : fail('learning.distillation_status', 'Local user distillation status', `GET /api/learning/distillation ${distillation.status}`, distillation.data),
    );

    try {
      const learningDistillationCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-learning-distillation'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${learningDistillationCui.stdout || ''}\n${learningDistillationCui.stderr || ''}`;
      out.push(
        output.includes('Learning Distillation') &&
          output.includes('Privacy:') &&
          output.includes('metadata-only=yes') &&
          output.includes('Risk:') &&
          output.includes('Artifacts:') &&
          output.includes('Habit candidates:') &&
          output.includes('no auto-save=yes') &&
          output.includes('Next actions:')
          ? ok('learning.distillation_cui', 'Learning distillation CUI', 'config CUI prints local distillation status, privacy, habit candidates, artifacts, and next actions')
          : fail('learning.distillation_cui', 'Learning distillation CUI', 'expected config CUI to print local distillation details', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('learning.distillation_cui', 'Learning distillation CUI', error instanceof Error ? error.message : String(error)));
    }

    const originalControls = {
      paused: Boolean(controls.paused),
      includeInPrompts: Boolean(controls.includeInPrompts),
      excludedApps: Array.isArray(controls.excludedApps) ? controls.excludedApps : [],
      excludedHosts: Array.isArray(controls.excludedHosts) ? controls.excludedHosts : [],
      excludedFolders: Array.isArray(controls.excludedFolders) ? controls.excludedFolders : [],
    };
    const testControls = {
      ...originalControls,
      excludedApps: Array.from(new Set([...originalControls.excludedApps, 'EvalPrivateApp'])),
      excludedHosts: Array.from(new Set([...originalControls.excludedHosts, 'eval-private.example.com'])),
      excludedFolders: Array.from(new Set([...originalControls.excludedFolders, '~/EvalPrivateFolder'])),
    };
    let appliedControls = null;
    let restoredControls = null;
    try {
      const applied = await ctx.api('/api/learning/settings', {
        method: 'PUT',
        body: { ...testControls, source: 'eval_control_roundtrip' },
      });
      appliedControls = applied.data?.learning?.controls;
      const restored = await ctx.api('/api/learning/settings', {
        method: 'PUT',
        body: { ...originalControls, source: 'eval_control_restore' },
      });
      restoredControls = restored.data?.learning?.controls;
      out.push(
        applied.ok &&
          restored.ok &&
          appliedControls?.excludedApps?.includes('EvalPrivateApp') &&
          appliedControls?.excludedHosts?.includes('eval-private.example.com') &&
          appliedControls?.excludedFolders?.includes('~/EvalPrivateFolder') &&
          restoredControls?.paused === originalControls.paused &&
          restoredControls?.includeInPrompts === originalControls.includeInPrompts &&
          sameStringList(restoredControls?.excludedApps, originalControls.excludedApps) &&
          sameStringList(restoredControls?.excludedHosts, originalControls.excludedHosts) &&
          sameStringList(restoredControls?.excludedFolders, originalControls.excludedFolders)
          ? ok('learning.control_roundtrip', 'Learning control roundtrip', 'pause/prompt flags and app/site/folder exclusions can be updated and restored')
          : fail('learning.control_roundtrip', 'Learning control roundtrip', 'learning controls did not apply or restore cleanly', { applied: applied.data, restored: restored.data, originalControls }),
      );
    } finally {
      if (
        !restoredControls ||
        restoredControls.paused !== originalControls.paused ||
        restoredControls.includeInPrompts !== originalControls.includeInPrompts ||
        !sameStringList(restoredControls.excludedApps, originalControls.excludedApps) ||
        !sameStringList(restoredControls.excludedHosts, originalControls.excludedHosts) ||
        !sameStringList(restoredControls.excludedFolders, originalControls.excludedFolders)
      ) {
        await ctx.api('/api/learning/settings', {
          method: 'PUT',
          body: { ...originalControls, source: 'eval_control_restore_finally' },
        });
      }
    }

    const draft = await ctx.api('/api/learning/skill-draft?source=eval&force=true&routeLimit=2&workflowLimit=2');
    const skill = draft.data?.skill;
    out.push(
      draft.ok && skill?.markdown && String(skill.markdown).includes('# Workflow')
        ? ok('learning.skill_draft', 'Skill draft preview', `${skill.name || 'unnamed'} · ${skill.markdown.length} chars`)
        : warn('learning.skill_draft', 'Skill draft preview', `draft ${draft.status} ${draft.error || draft.data?.error || ''}`),
    );

    const teachingPreview = await ctx.api('/api/work/next?actionId=record_replay%3Aprepare_teaching_packet&forceRecordReplayTeachingPacket=true');
    const teachingPreviewNext = teachingPreview.data?.next || {};
    const teachingPreviewResult = teachingPreviewNext.result || {};
    const teachingPreviewPacket = teachingPreviewResult.packet || teachingPreviewResult;
    out.push(
      teachingPreview.ok &&
        teachingPreviewNext.ok === true &&
        teachingPreviewNext.executed === false &&
        teachingPreviewNext.action?.id === 'record_replay:prepare_teaching_packet' &&
        teachingPreviewNext.action?.source === 'record_replay' &&
        teachingPreviewNext.action?.autoEligible === true &&
        teachingPreviewNext.action?.startsMicrophone === false &&
        teachingPreviewNext.action?.startsRecording === false &&
        teachingPreviewNext.action?.executesTask === false &&
        teachingPreviewPacket.kind === 'record_replay_teaching_packet' &&
        teachingPreviewPacket.safety?.startsMicrophone === false &&
        teachingPreviewPacket.safety?.startsRecording === false &&
        teachingPreviewPacket.safety?.startsWorkers === false &&
        teachingPreviewPacket.safety?.executesTask === false &&
        teachingPreviewPacket.safety?.confirmationRequiredForRecording === true &&
        teachingPreviewPacket.safety?.confirmationRequiredForSkillSave === true &&
        Array.isArray(teachingPreviewPacket.teachingScript) &&
        teachingPreviewPacket.teachingScript.length >= 4 &&
        String(teachingPreviewNext.output || '').includes('Preview mode: no teaching packet file was written')
        ? ok('learning.record_replay_teaching_preview', 'Record & Replay teaching packet preview', `${teachingPreviewPacket.teachingScript.length} safe teaching step(s)`)
        : fail('learning.record_replay_teaching_preview', 'Record & Replay teaching packet preview', 'work-next did not expose a safe no-recording teaching packet preview', teachingPreview.data),
    );

    const teachingRun = await ctx.api('/api/work/next', {
      method: 'POST',
      body: {
        execute: true,
        actionId: 'record_replay:prepare_teaching_packet',
        forceRecordReplayTeachingPacket: true,
        source: 'eval_record_replay_teaching_packet',
      },
      retries: 0,
    });
    const teachingRunNext = teachingRun.data?.next || {};
    const teachingRunResult = teachingRunNext.result || {};
    out.push(
      teachingRun.ok &&
        teachingRunNext.ok === true &&
        teachingRunNext.executed === true &&
        teachingRunNext.action?.id === 'record_replay:prepare_teaching_packet' &&
        teachingRunNext.autopilotDecision?.reason === 'eligible_record_replay_teaching_packet' &&
        teachingRunResult.saved === true &&
        teachingRunResult.packet?.saved === true &&
        teachingRunResult.packet?.safety?.startsMicrophone === false &&
        teachingRunResult.packet?.safety?.startsRecording === false &&
        teachingRunResult.packet?.safety?.startsWorkers === false &&
        teachingRunResult.packet?.safety?.executesTask === false &&
        teachingRunResult.metadata?.file &&
        String(teachingRunResult.metadata.file).includes('/record-replay-teaching-packets/') &&
        Array.isArray(teachingRunResult.packets?.items) &&
        teachingRunResult.packets.items.some((item) => item.file === teachingRunResult.metadata.file)
        ? ok('learning.record_replay_teaching_save', 'Record & Replay teaching packet save', teachingRunResult.metadata.file)
        : fail('learning.record_replay_teaching_save', 'Record & Replay teaching packet save', 'execute=true should only save a local teaching packet', teachingRun.data),
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
