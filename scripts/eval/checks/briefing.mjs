import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail, skip } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'briefing',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/briefing');
    const b = r.data?.briefing || r.data;
    if (!r.ok || !b) {
      out.push(fail('briefing.read', 'Work briefing', `GET /api/briefing ${r.status} ${r.error || ''}`));
      return out;
    }
    out.push(
      b.summary
        ? ok('briefing.summary', 'Briefing summary', String(b.summary).slice(0, 140))
        : warn('briefing.summary', 'Briefing summary', 'no summary text'),
    );
    const next = Array.isArray(b.nextActions) ? b.nextActions : [];
    out.push(
      next.length
        ? ok('briefing.next', 'Next actions', `${next.length} next action(s): ${next.map((n) => n.label || n.title || n.summary || n).slice(0, 2).join(' · ')}`)
        : warn('briefing.next', 'Next actions', 'briefing returned no next actions (idle is ok)'),
    );
    const followUps = Array.isArray(b.followUps) ? b.followUps : [];
    const coherentFollowUps = followUps.every((action) => (
      action?.source === 'workflows' &&
      action.workflowAction === 'continue' &&
      action.id &&
      action.workflowId &&
      action.instruction &&
      action.continuation &&
      typeof action.continuation.memoryMatches === 'number' &&
      typeof action.continuation.relatedWorkflows === 'number' &&
      action.continuation.learningEvidence?.evolution &&
      typeof action.continuation.learningEvidence.evolution.changeCount === 'number'
    ));
    out.push(
      Array.isArray(b.followUps) && coherentFollowUps
        ? ok('briefing.followups', 'Workflow follow-ups', `${followUps.length} continuation suggestion(s)`)
        : fail('briefing.followups', 'Workflow follow-ups', 'briefing followUps are missing or malformed', b.followUps),
    );
    const realtimeVoice = b.realtimeVoice || {};
    const realtimeAction = next.find((action) => action.source === 'realtime_voice') || null;
    const providerReadinessAction = next.find((action) => action.id === 'readiness:realtime_voice_provider') || null;
    const openAiKeyReadinessAction = next.find((action) => action.id === 'readiness:openai_key') || null;
    const zeroSpendVoiceAction = next.find((action) => action.id === 'voice:standby_primary') || null;
    const realtimePending = realtimeVoice.status && realtimeVoice.status !== 'ready';
    const realtimeGuide = realtimeAction?.dogfoodGuide || {};
    const realtimeActionPlan = realtimeAction?.dogfoodActionPlan || {};
    const realtimeLocalFallback = realtimeAction?.localFallback || {};
    const realtimeLocalFallbackReady = Boolean(
      !realtimeAction ||
        (
          realtimeLocalFallback.available === true &&
          realtimeLocalFallback.endpoint === '/api/voice/command' &&
          realtimeLocalFallback.lane === 'local_voice_command' &&
          realtimeLocalFallback.safety?.startsMicrophone === false &&
          realtimeLocalFallback.safety?.usesRealtime === false &&
          realtimeLocalFallback.safety?.storesRawAudio === false
        ),
    );
    const realtimeGuideReady = Boolean(
      !realtimeAction ||
        (
          realtimeGuide.manualOnly === true &&
          realtimeGuide.requiresUserPresence === true &&
          realtimeGuide.start?.endpoint?.path === '/api/realtime/dogfood/start' &&
          realtimeGuide.monitor?.endpoint === '/api/realtime/evidence' &&
          Array.isArray(realtimeGuide.prompts) &&
          realtimeGuide.prompts.includes('后台现在怎么样') &&
          realtimeGuide.prompts.some((prompt) => prompt.includes('现在做到哪了')) &&
          Array.isArray(realtimeGuide.expectedEvidence) &&
          realtimeGuide.expectedEvidence.some((item) => item.tool === 'get_work_handoff')
        ),
    );
    const realtimeActionPlanReady = Boolean(
      !realtimeAction ||
        (
          realtimeActionPlan.version === 1 &&
          realtimeActionPlan.scope === 'workbench' &&
          Array.isArray(realtimeActionPlan.previewable) &&
          realtimeActionPlan.previewable.some((action) => action.startsMicrophone === false && action.readOnly === true) &&
          realtimeActionPlan.previewable.some((action) => action.id === 'prepare_live_run' && action.startsMicrophone === false && action.command?.includes('dogfood:realtime-prepare')) &&
          realtimeActionPlan.previewable.some((action) => action.id === 'prepare_preflight_bundle' && action.startsMicrophone === false && action.command?.includes('prepare-realtime-dogfood-preflight')) &&
          Array.isArray(realtimeActionPlan.manual) &&
          realtimeActionPlan.manual.some((action) => action.requiresLiveVoice === true || action.requiresMicConfirmation === true) &&
          realtimeActionPlan.boundaries?.some((item) => /microphone|confirmMic/i.test(item))
        ),
    );
    out.push(
      !realtimeVoice.status ||
        (['ready', 'pending', 'warning', 'blocked'].includes(realtimeVoice.status) &&
          typeof realtimeVoice.phase === 'string' &&
          realtimeGuideReady &&
          realtimeActionPlanReady &&
          (!realtimePending || (
            realtimeAction &&
            realtimeAction.phase === realtimeVoice.phase &&
            realtimeAction.blocker &&
            realtimeLocalFallbackReady &&
            realtimeAction.manualOnly === true &&
            realtimeAction.autoEligible === false &&
            realtimeAction.autopilotEligible === false &&
            typeof realtimeAction.manualOnlyReason === 'string' &&
            realtimeAction.manualOnlyReason.length > 0
          )))
        ? ok('briefing.realtime_voice', 'Realtime voice next action', realtimePending ? `${realtimeVoice.status}/${realtimeVoice.phase}` : 'ready or not surfaced')
        : fail('briefing.realtime_voice', 'Realtime voice next action', 'briefing did not expose a coherent realtime voice work-next blocker', {
          realtimeVoice,
          nextActions: next,
        }),
    );

    const spendGuardResponse = await ctx.api('/api/openai/spend-guard');
    const spendGuard = spendGuardResponse.data?.spendGuard || {};
    const zeroSpendActive = Boolean(
      spendGuard.hardSpendLock ||
      spendGuard.mode === 'off' ||
      Number(spendGuard.dailyRequestLimit || 0) <= 0 ||
      Number(spendGuard.remaining?.total || 0) <= 0 ||
      spendGuard.safety?.zeroBudgetDefault === true
    );
    const zeroSpendVoiceIndex = next.findIndex((action) => action.id === 'voice:standby_primary');
    const providerReadinessIndex = next.findIndex((action) => action.id === 'readiness:realtime_voice_provider');
    const openAiKeyReadinessIndex = next.findIndex((action) => action.id === 'readiness:openai_key');
    const zeroSpendReadinessIndex = providerReadinessAction?.providerProbe
      ? providerReadinessIndex
      : openAiKeyReadinessAction?.zeroSpendFallbackQuiet
        ? openAiKeyReadinessIndex
        : -1;
    out.push(
      !zeroSpendActive ||
        zeroSpendReadinessIndex < 0 ||
        (
          zeroSpendVoiceAction?.source === 'voice_standby' &&
          zeroSpendVoiceAction.zeroSpendFallback === true &&
          zeroSpendVoiceAction.primaryAction?.id === 'open_local_input' &&
          zeroSpendVoiceAction.primaryAction?.startsMicrophone === false &&
          zeroSpendVoiceAction.primaryAction?.usesRealtime === false &&
          zeroSpendVoiceAction.manualOnly === false &&
          zeroSpendVoiceAction.autopilotEligible === false &&
          zeroSpendVoiceIndex >= 0 &&
          zeroSpendReadinessIndex >= 0 &&
          zeroSpendVoiceIndex < zeroSpendReadinessIndex
        )
        ? ok('briefing.zero_spend_local_voice_first', 'Zero-spend local voice first', zeroSpendActive
          ? 'voice:standby_primary is ahead of paid-provider setup while OpenAI spend is hard-locked'
          : 'OpenAI spend is not zero-locked')
        : fail('briefing.zero_spend_local_voice_first', 'Zero-spend local voice first', 'expected local no-mic voice entry to outrank paid-provider setup under zero-spend lock', {
          spendGuard,
          nextActions: next,
        }),
    );

    const wn = await ctx.api('/api/work/next');
    const workNext = wn.data?.next;
    const workNextReady = Boolean(
      wn.ok &&
      workNext &&
      workNext.ok === true &&
      workNext.executed === false &&
      typeof workNext.output === 'string' &&
      workNext.output.trim() &&
      workNext.briefing &&
      Array.isArray(workNext.briefing.nextActions),
    );
    const selectedAction = workNext?.action || null;
    const workNextActions = Array.isArray(workNext?.briefing?.nextActions)
      ? workNext.briefing.nextActions
      : [];
    const selectedGuide = selectedAction?.dogfoodGuide || {};
    const selectedPlan = selectedAction?.dogfoodActionPlan || {};
    const selectedLocalFallback = selectedAction?.localFallback || {};
    const matchesBriefing = !selectedAction ||
      (next.length === 0 && workNextActions.length === 0) ||
      workNextActions.some((item) => item?.id && item.id === selectedAction.id);
    const workNextGuideOk = selectedAction?.source !== 'realtime_voice' || Boolean(
        selectedGuide.monitor?.cui &&
        Array.isArray(selectedGuide.prompts) &&
        selectedGuide.prompts.some((prompt) => prompt.includes('现在做到哪了')) &&
        selectedGuide.expectedEvidence?.some((item) => item.tool === 'get_work_handoff') &&
        String(workNext.output).includes('Preview Realtime live dogfood preparation without starting microphone capture') &&
        String(workNext.output).includes('Live command: npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance') &&
        workNext.result?.startsMicrophone === false &&
        workNext.result?.requiresMicConfirmationForLiveStart === true &&
        Number(workNext.result?.promptCount || 0) > 8 &&
        selectedPlan.version === 1 &&
        selectedPlan.scope === 'workbench' &&
        selectedPlan.previewable?.some((action) => action.startsMicrophone === false) &&
        selectedPlan.previewable?.some((action) => action.id === 'prepare_live_run' && action.startsMicrophone === false) &&
        selectedPlan.previewable?.some((action) => action.id === 'prepare_preflight_bundle' && action.startsMicrophone === false) &&
        selectedPlan.manual?.some((action) => action.requiresLiveVoice === true || action.requiresMicConfirmation === true) &&
        selectedLocalFallback.available === true &&
        selectedLocalFallback.endpoint === '/api/voice/command' &&
        selectedLocalFallback.safety?.startsMicrophone === false &&
        selectedLocalFallback.safety?.usesRealtime === false,
    );
    out.push(
      workNextReady && matchesBriefing && workNextGuideOk
        ? ok('briefing.worknext', 'Work-next', `${selectedAction?.label || 'No next action'} (preview) · ${String(workNext.output).slice(0, 140)}`, {
          action: selectedAction,
          output: workNext.output,
          nextActionCount: workNextActions.length,
        })
        : fail('briefing.worknext', 'Work-next', `GET /api/work/next did not return a coherent preview envelope (${wn.status})`, wn.data),
    );

    let cleanupSessionId = '';
    try {
      const startSession = await ctx.api('/api/sessions/start', {
        method: 'POST',
        body: {
          goal: `eval session work-next continuation ${Date.now()}`,
          source: 'eval_session_worknext',
        },
        timeoutMs: 10000,
      });
      const session = startSession.data?.session || null;
      cleanupSessionId = session?.id || '';
      const voiceSeed = cleanupSessionId
        ? await ctx.api('/api/voice/command', {
          method: 'POST',
          body: {
            transcript: '状态',
            execute: false,
            includeScreen: false,
            useMemory: false,
            speak: false,
            session: true,
            sessionId: cleanupSessionId,
            source: 'eval_session_worknext_voice_seed',
          },
          timeoutMs: 15000,
        })
        : { ok: false, data: { error: 'missing session id' } };
      const seedRouteId = voiceSeed.data?.route?.routing?.id || '';
      const sessionActionId = `session:${cleanupSessionId}`;
      const sessionPreview = cleanupSessionId
        ? await ctx.api(`/api/work/next?actionId=${encodeURIComponent(sessionActionId)}`, { timeoutMs: 15000 })
        : { ok: false, data: null };
      const sessionPreviewNext = sessionPreview.data?.next || {};
      const sessionRun = cleanupSessionId
        ? await ctx.api('/api/work/next', {
          method: 'POST',
          body: {
            execute: true,
            actionId: sessionActionId,
            source: 'eval_session_worknext_run',
          },
          timeoutMs: 20000,
        })
        : { ok: false, data: null };
      const sessionRunNext = sessionRun.data?.next || {};
      const runResult = sessionRunNext.result || {};

      if (cleanupSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_session_worknext_cleanup',
            note: 'Cleaning up eval session work-next continuation.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }

      out.push(
        startSession.ok &&
          voiceSeed.ok &&
          seedRouteId &&
          voiceSeed.data?.session?.recorded === true &&
          sessionPreview.ok &&
          sessionPreviewNext.ok === true &&
          sessionPreviewNext.executed === false &&
          sessionPreviewNext.action?.id === sessionActionId &&
          sessionPreviewNext.action?.source === 'sessions' &&
          sessionPreviewNext.action?.sessionContinuation?.routeId === seedRouteId &&
          sessionPreviewNext.action?.sessionContinuation?.executable === true &&
          sessionPreviewNext.result?.routeRecovery?.recommended?.type === 'route_preview_execute' &&
          String(sessionPreviewNext.output || '').includes(seedRouteId) &&
          sessionRun.ok &&
          sessionRunNext.ok === true &&
          sessionRunNext.executed === true &&
          sessionRunNext.action?.id === sessionActionId &&
          runResult.routeExecution?.continuedRouteId === seedRouteId &&
          runResult.sessionEvent?.event?.type === 'session_continue' &&
          String(sessionRunNext.output || '').includes('已继续会话中的最新语音任务')
          ? ok('briefing.worknext_session_continue_voice_route', 'Work-next session continues voice route', `${sessionActionId} continued local route ${seedRouteId}`)
          : fail('briefing.worknext_session_continue_voice_route', 'Work-next session continues voice route', 'session work-next did not preview and execute the latest session voice route', {
              startSession: startSession.data,
              voiceSeed: voiceSeed.data,
              sessionPreview: sessionPreview.data,
              sessionRun: sessionRun.data,
              seedRouteId,
            }),
      );
    } catch (error) {
      if (cleanupSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
      out.push(fail('briefing.worknext_session_continue_voice_route', 'Work-next session continues voice route', error instanceof Error ? error.message : String(error)));
    }

    const realtimeProviderAction = workNextActions.find((action) => action?.id === 'readiness:realtime_voice_provider') || next.find((action) => action?.id === 'readiness:realtime_voice_provider') || null;
    if (realtimeProviderAction) {
      const providerProbePreview = await ctx.api(`/api/work/next?actionId=${encodeURIComponent(realtimeProviderAction.id)}`);
      const providerProbeNext = providerProbePreview.data?.next || {};
      const providerProbeResult = providerProbeNext.result || {};
      out.push(
        providerProbePreview.ok &&
          providerProbeNext.ok === true &&
          providerProbeNext.executed === false &&
          providerProbeNext.action?.id === 'readiness:realtime_voice_provider' &&
          providerProbeResult.executed === false &&
	          providerProbeResult.startsMicrophone === false &&
	          providerProbeResult.requiresMicConfirmation === false &&
		          providerProbeResult.endpoint?.path === '/api/realtime/provider/probe' &&
			          providerProbeResult.endpoint?.executeBody?.confirmOpenAiSpend === true &&
			          providerProbeResult.endpoint?.executeBody?.confirmOpenAiSpendPhrase === '<type spend phrase>' &&
			          providerProbeResult.endpoint?.executeBody?.openAiSpendLeaseId === '<one-request lease id>' &&
			          providerProbeResult.requiresOpenAiSpendConfirmation === true &&
	          providerProbeResult.openAiSpendConfirmation?.required === true &&
	          String(providerProbeNext.output || '').includes('Preview no-mic Realtime provider probe') &&
	          String(providerProbeNext.output || '').includes('Preview mode: no provider request was sent')
	          ? ok('briefing.worknext_realtime_provider_probe_preview', 'Work-next Realtime provider probe preview', 'readiness action previews a no-mic provider probe and requires explicit spend confirmation before any OpenAI call')
          : fail('briefing.worknext_realtime_provider_probe_preview', 'Work-next Realtime provider probe preview', 'explicit realtime provider readiness action did not return a safe no-mic probe preview', providerProbePreview.data),
      );
    } else {
      out.push(skip('briefing.worknext_realtime_provider_probe_preview', 'Work-next Realtime provider probe preview', 'Realtime provider is ready, so no provider-probe readiness action is present.'));
    }

    if (realtimeAction?.id) {
      const realtimePreparePreview = await ctx.api(`/api/work/next?actionId=${encodeURIComponent(realtimeAction.id)}`);
      const prepareNext = realtimePreparePreview.data?.next || {};
      const prepareResult = prepareNext.result || {};
      out.push(
        realtimePreparePreview.ok &&
          prepareNext.ok === true &&
          prepareNext.executed === false &&
          prepareNext.action?.id === realtimeAction.id &&
          prepareResult.startsMicrophone === false &&
          prepareResult.requiresMicConfirmationForLiveStart === true &&
          Number(prepareResult.promptCount || 0) > 8 &&
          String(prepareNext.output || '').includes('Preview Realtime live dogfood preparation without starting microphone capture') &&
          String(prepareNext.output || '').includes('Live command: npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance')
          ? ok('briefing.worknext_realtime_prepare', 'Work-next Realtime prepare preview', `${prepareResult.promptCount} prompt(s), no mic`)
          : fail('briefing.worknext_realtime_prepare', 'Work-next Realtime prepare preview', 'explicit realtime work-next did not return a no-mic prepare cockpit', realtimePreparePreview.data),
      );

      const realtimePrepareRun = await ctx.api('/api/work/next', {
        method: 'POST',
        body: {
          execute: true,
          actionId: realtimeAction.id,
          source: 'briefing_eval_realtime_preflight_bundle',
        },
        retries: 0,
      });
      const prepareRunNext = realtimePrepareRun.data?.next || {};
      const prepareRunResult = prepareRunNext.result || {};
      out.push(
        realtimePrepareRun.ok &&
          prepareRunNext.ok === true &&
          prepareRunNext.executed === true &&
          prepareRunNext.action?.id === realtimeAction.id &&
          prepareRunResult.ok === true &&
          prepareRunResult.executed === true &&
          prepareRunResult.startsMicrophone === false &&
          prepareRunResult.requiresMicConfirmationForLiveStart === true &&
          prepareRunResult.archive?.saved === true &&
          prepareRunResult.archive?.file?.path &&
          prepareRunResult.shortcutRecall?.recalled === true &&
          prepareRunResult.acceptance?.gates?.some((gate) => gate.id === 'archive_saved' && gate.ok === true) &&
          prepareRunResult.acceptance?.gates?.some((gate) => gate.id === 'route_recalled_shortcut' && gate.ok === true) &&
          String(prepareRunNext.output || '').includes('Prepared Realtime dogfood preflight bundle without starting microphone capture') &&
          String(prepareRunNext.output || '').includes('Live command: npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance')
          ? ok('briefing.worknext_realtime_preflight_execute', 'Work-next Realtime preflight execute', prepareRunResult.archive.file.path)
          : fail('briefing.worknext_realtime_preflight_execute', 'Work-next Realtime preflight execute', 'execute=true should prepare the full no-mic Realtime preflight bundle', realtimePrepareRun.data),
      );
    }

    const learningDistillation = await ctx.api('/api/learning/distillation?source=briefing_eval&candidateLimit=1&skillLimit=2');
    const learningCandidate = learningDistillation.data?.distillation?.habitCandidates?.candidates?.[0] || null;
    if (learningCandidate?.id) {
      const learningActionId = `learning_habit:${learningCandidate.id}`;
      const learningPreview = await ctx.api(`/api/work/next?actionId=${encodeURIComponent(learningActionId)}`);
      const learningNext = learningPreview.data?.next || {};
      const learningResult = learningNext.result || {};
      const learningEnvelope = learningResult.learningHabitCandidate || {};
      out.push(
        learningDistillation.ok &&
          learningPreview.ok &&
          learningNext.ok === true &&
          learningNext.executed === false &&
          learningNext.action?.id === learningActionId &&
          learningNext.action?.source === 'learning_habit' &&
          learningNext.action?.manualOnly === true &&
          learningNext.action?.autoEligible === false &&
          learningNext.action?.autopilotEligible === false &&
          learningEnvelope.candidate?.id === learningCandidate.id &&
          learningEnvelope.safety?.readOnly === true &&
          learningEnvelope.safety?.metadataOnly === true &&
          learningEnvelope.safety?.doesNotExecute === true &&
          learningEnvelope.safety?.doesNotGrantPermission === true &&
          learningEnvelope.safety?.noAutoSave === true &&
          String(learningNext.output || '').includes('Preview only: this does not save memory') &&
          Array.isArray(learningNext.briefing?.availableActions) &&
          learningNext.briefing.availableActions.some((action) => action.id === learningActionId)
          ? ok('briefing.worknext_learning_habit_preview', 'Work-next learning habit preview', `${learningCandidate.id} is read-only`)
          : fail('briefing.worknext_learning_habit_preview', 'Work-next learning habit preview', 'explicit learning-habit action did not return a safe read-only preview', {
            learningDistillation: learningDistillation.data,
            learningPreview: learningPreview.data,
          }),
      );

      const learningExecuteAttempt = await ctx.api('/api/work/next', {
        method: 'POST',
        body: {
          execute: true,
          actionId: learningActionId,
          source: 'briefing_eval_learning_execute',
        },
      });
      const learningExecuteNext = learningExecuteAttempt.data?.next || {};
      out.push(
        learningExecuteAttempt.ok &&
          learningExecuteNext.ok === true &&
          learningExecuteNext.executed === false &&
          learningExecuteNext.result?.executeRequested === true &&
          learningExecuteNext.result?.learningHabitCandidate?.candidate?.id === learningCandidate.id &&
          String(learningExecuteNext.output || '').includes('Execute was requested but ignored')
          ? ok('briefing.worknext_learning_habit_no_execute', 'Work-next learning habit execute gate', 'execute request stayed read-only')
          : fail('briefing.worknext_learning_habit_no_execute', 'Work-next learning habit execute gate', 'learning-habit action executed or failed to explain the read-only gate', learningExecuteAttempt.data),
      );
    } else {
      out.push(fail('briefing.worknext_learning_habit_preview', 'Work-next learning habit preview', 'learning distillation returned no habit candidate', learningDistillation.data));
    }

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-work-next'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      const hasRealtimePrepareGuide =
        output.includes('Preview Realtime live dogfood preparation without starting microphone capture') &&
        output.includes('Live command: npm run dogfood:realtime-renderer -- --execute --confirm-mic --require-acceptance');
      const hasProviderFallbackGuide =
        output.includes('Realtime voice provider') &&
        output.includes('Local fallback: /api/voice/command') &&
        output.includes('Fallback command: npm run dogfood:voice-command') &&
        output.includes('Fallback safety: starts microphone=no; realtime=no; raw audio=no');
      const hasZeroSpendLocalVoiceGuide =
        output.includes('Next action: Open local input (voice_standby, manual)') &&
        output.includes('Guide: Use local no-mic pet input while Realtime is unavailable or spend-locked.') &&
        output.includes('Zero-spend fallback: OpenAI spend is locked; no provider request will be sent.') &&
        output.includes('Primary: open_local_input') &&
        output.includes('Run: npm run work:run -- --action-id voice:standby_primary') &&
        output.includes('Open input: npm run voice:open') &&
        output.includes('Run API: POST /api/work/next {"actionId":"voice:standby_primary","execute":true}') &&
        output.includes('Safety: starts microphone=no; realtime=no; opens Terminal=no');
      const hasRouteRecoveryGuide =
        output.includes('Guide: Continue routed work via') &&
        output.includes('Recovery: route_preview_execute') &&
        output.includes('Run: POST /api/work/next {"actionId":"route:') &&
        output.includes('预览模式');
      const hasBrowserOpenRecoveryGuide =
        output.includes('Guide: Open or focus Google Chrome before retrying browser work.') &&
        output.includes('Browser recovery: browser_window_unavailable') &&
        output.includes('Retry action: route:') &&
        output.includes('Recheck: /api/browser/readiness') &&
        output.includes('Preview: GET /api/work/next?actionId=browser_recovery%3Aopen_supported_browser') &&
        output.includes('Run: POST /api/work/next {"actionId":"browser_recovery:open_supported_browser","execute":true}') &&
        output.includes('Preview browser recovery');
      const hasBrowserRetryRecoveryGuide =
        output.includes('Guide: Retry browser work in Google Chrome; the browser target is already prepared.') &&
        output.includes('Browser recovery: browser_ready_retry') &&
        output.includes('Prepared target:') &&
        output.includes('Retry action: route:') &&
        output.includes('Preview: GET /api/work/next?actionId=browser_recovery%3Aretry_browser_work') &&
        output.includes('Run: POST /api/work/next {"actionId":"browser_recovery:retry_browser_work","execute":true}');
      const hasBrowserRecoveryGuide = hasBrowserOpenRecoveryGuide || hasBrowserRetryRecoveryGuide;
      const hasRealtimeWorkbenchGuide =
        output.includes('Monitor: npm run config -> V. Watch Realtime voice evidence') &&
        output.includes('现在做到哪了') &&
        output.includes('get_work_handoff') &&
        hasRealtimePrepareGuide;
      out.push(
        output.includes('Next action:') &&
          output.includes('Guide:') &&
          (hasRouteRecoveryGuide || hasBrowserRecoveryGuide || hasProviderFallbackGuide || hasZeroSpendLocalVoiceGuide || hasRealtimeWorkbenchGuide)
          ? ok('briefing.cui_worknext', 'CUI work-next guide', hasRouteRecoveryGuide
            ? 'config CUI prints routed preview continuation guide'
            : hasBrowserRecoveryGuide
              ? 'config CUI prints browser recovery guide'
              : hasZeroSpendLocalVoiceGuide
                ? 'config CUI prints zero-spend local voice fallback guide'
                : hasProviderFallbackGuide
                  ? 'config CUI prints provider warning plus local voice-command fallback'
                  : 'config CUI prints the guided Realtime work-next prepare path')
          : fail('briefing.cui_worknext', 'CUI work-next guide', 'expected --print-work-next to print browser recovery, routed preview continuation, Realtime prepare, provider-warning fallback, or zero-spend local voice guide', { output: output.slice(0, 2200) }),
      );
    } catch (error) {
      out.push(fail('briefing.cui_worknext', 'CUI work-next guide', error instanceof Error ? error.message : String(error)));
    }

    const localRoutePreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '状态',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_cui_route_continue',
      },
      timeoutMs: 15000,
    });
    const localRouteId = localRoutePreview.data?.route?.routing?.id || '';
    const localRouteLane = localRoutePreview.data?.route?.routing?.lane || localRoutePreview.data?.route?.lane || '';
    try {
      const cuiRun = await execFileAsync('node', [
        'scripts/config-cui.cjs',
        '--run-work-next',
        '--action-id',
        `route:${localRouteId}`,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cuiRun.stdout || ''}\n${cuiRun.stderr || ''}`;
      out.push(
        localRoutePreview.ok &&
          localRouteId &&
          localRouteLane === 'local' &&
          output.includes(`Action: route:${localRouteId}`) &&
          output.includes('Recovery: route_preview_execute (executable)') &&
          output.includes('Work item executed.')
          ? ok('briefing.cui_worknext_run_route', 'CUI run route work-next', `executed local preview route ${localRouteId}`)
          : fail('briefing.cui_worknext_run_route', 'CUI run route work-next', 'expected CUI to execute a targeted local route preview', {
            routePreview: localRoutePreview.data,
            localRouteLane,
            output: output.slice(0, 2200),
          }),
      );
    } catch (error) {
      out.push(fail('briefing.cui_worknext_run_route', 'CUI run route work-next', error instanceof Error ? error.message : String(error), {
        routePreview: localRoutePreview.data,
        routeId: localRouteId,
      }));
    }

    const lastVoicePreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '状态',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_cui_last_voice_route',
      },
      timeoutMs: 15000,
    });
    const lastVoiceRouteId = lastVoicePreview.data?.route?.routing?.id || '';
    try {
      const cuiLastRun = await execFileAsync('node', [
        'scripts/config-cui.cjs',
        '--run-work-next',
        '--last-voice-route',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 20000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cuiLastRun.stdout || ''}\n${cuiLastRun.stderr || ''}`;
      out.push(
        lastVoicePreview.ok &&
          lastVoiceRouteId &&
          output.includes(`Last voice route: ${lastVoiceRouteId}`) &&
          output.includes(`Action: route:${lastVoiceRouteId}`) &&
          output.includes('Recovery: route_preview_execute (executable)') &&
          output.includes('Work item executed.')
          ? ok('briefing.cui_worknext_last_voice_route', 'CUI run latest voice route', `executed latest voice preview route ${lastVoiceRouteId}`)
          : fail('briefing.cui_worknext_last_voice_route', 'CUI run latest voice route', 'expected CUI to execute the latest executable voice preview route', {
            routePreview: lastVoicePreview.data,
            output: output.slice(0, 2200),
          }),
      );
    } catch (error) {
      out.push(fail('briefing.cui_worknext_last_voice_route', 'CUI run latest voice route', error instanceof Error ? error.message : String(error), {
        routePreview: lastVoicePreview.data,
        routeId: lastVoiceRouteId,
      }));
    }

    const routeSeed = await ctx.api('/api/tasks/parallel', {
      method: 'POST',
      body: {
        execute: true,
        source: 'eval_route_worknext',
        parallelGroup: `eval-route-worknext-${Date.now()}`,
        tasks: [
          { command: 'node -e "console.log(\\"route-a\\")"', mode: 'cli', owner: 'eval-route-a', scope: 'eval/route-worknext.md', access: 'write' },
          { command: 'node -e "console.log(\\"route-b\\")"', mode: 'cli', owner: 'eval-route-b', scope: 'eval/route-worknext.md', access: 'write' },
        ],
      },
    });
    const blockedRoute = Array.isArray(routeSeed.data?.results)
      ? routeSeed.data.results.find((item) => item.routing?.status === 'blocked')?.routing
      : null;
    const routeWorkNext = blockedRoute?.id
      ? await ctx.api(`/api/work/next?actionId=${encodeURIComponent(`route:${blockedRoute.id}`)}`)
      : null;
    const routeNext = routeWorkNext?.data?.next || {};
    out.push(
      routeSeed.ok &&
        routeSeed.data?.ok === false &&
        blockedRoute?.id &&
        routeWorkNext?.ok &&
        routeNext.ok === true &&
        routeNext.executed === false &&
        routeNext.action?.id === `route:${blockedRoute.id}` &&
        routeNext.action?.routeRecovery?.candidateCount >= 1 &&
        routeNext.result?.routeRecovery?.recommended?.type === 'inspect_route' &&
        String(routeNext.output || '').includes('候选:')
        ? ok('briefing.route_worknext_recovery', 'Route work-next recovery envelope', `route:${blockedRoute.id} -> ${routeNext.result.routeRecovery.recommended.label}`)
        : fail('briefing.route_worknext_recovery', 'Route work-next recovery envelope', 'explicit route work-next did not expose recovery candidates for a blocked routed task', {
          routeSeed: routeSeed.data,
          routeWorkNext: routeWorkNext?.data,
        }),
    );

    const handoffResponse = await ctx.api('/api/work/handoff?maxChars=760&nextLimit=2&followUpLimit=2');
    const handoff = handoffResponse.data?.handoff;
    const handoffReady = Boolean(
      handoffResponse.ok &&
      handoff &&
      typeof handoff.ok === 'boolean' &&
      typeof handoff.spokenSummary === 'string' &&
      handoff.spokenSummary.trim() &&
      handoff.spokenSummary.length <= 760 &&
      handoff.progress &&
      typeof handoff.progress.spokenSummary === 'string' &&
      handoff.briefing &&
      Array.isArray(handoff.nextActions) &&
      Array.isArray(handoff.followUps) &&
      handoff.collaboration?.counts,
    );
    out.push(
      handoffReady
        ? ok('briefing.handoff', 'Spoken work handoff', handoff.spokenSummary.slice(0, 180), {
          nextActions: handoff.nextActions.length,
          followUps: handoff.followUps.length,
          progress: handoff.progress.spokenSummary,
        })
        : fail('briefing.handoff', 'Spoken work handoff', `GET /api/work/handoff did not return a coherent voice-ready handoff (${handoffResponse.status})`, handoffResponse.data),
    );

    return out;
  },
};
