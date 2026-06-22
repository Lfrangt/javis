import { ok, warn, fail } from '../_client.mjs';
import { runRealtimePayloadAudit } from '../../realtime-payload-audit.mjs';

const EXPECTED_ACCEPTANCE_GATES = new Set([
  'open_monitor',
  'start_live_voice',
  'inject_worker_progress',
  'sync_latest_progress',
  'ask_progress',
  'ask_work_handoff',
  'delegate_worker_task',
  'ask_autopilot_status',
  'ask_attention_explanation',
  'ask_perception_consent',
  'ask_local_capabilities',
  'plan_mcp_tool_call',
  'review_and_resolve_approval',
  'manage_collaboration_claim',
  'ask_learning_profile',
  'prepare_record_replay_teaching_packet',
  'ask_browser_workflow',
  'save_productivity_dogfood_archive',
  'teach_ui_demonstration',
  'list_shortcuts',
  'save_shortcut_with_confirmation',
  'route_recalled_shortcut',
  'forget_shortcut',
  'archive_saved',
]);

const EXPECTED_ACCEPTANCE_GROUPS = new Set([
  'operator',
  'live_voice',
  'spoken_answer',
  'voice_tools',
  'learning_loop',
  'computer_tools',
  'shortcut_loop',
  'audit_trail',
]);

function acceptanceGaps(acceptance = {}) {
  const gates = Array.isArray(acceptance.gates) ? acceptance.gates : [];
  return gates
    .filter((gate) => gate?.ok !== true)
    .map((gate) => gate.id)
    .filter(Boolean);
}

function isRecoverableProviderHealth(voiceHealth = {}) {
  return voiceHealth?.status === 'warning' && ['quota_or_rate_limit', 'provider_unverified'].includes(voiceHealth?.kind);
}

function providerHealthLabel(voiceHealth = {}) {
  return voiceHealth?.kind || voiceHealth?.status || 'provider_warning';
}

function hasProviderNotReadyBlocker(blockers = []) {
  return blockers.some((blocker) => blocker?.id === 'provider_not_ready');
}

export default {
  lane: 'realtime-preflight',
  async run(ctx) {
    const out = [];
    const [config, renderer, providerProbe, providerProbePreview, unconfirmedProviderProbeExecute, pack, acceptanceResponse, evidence] = await Promise.all([
      ctx.api('/api/realtime/config?micMode=open', { timeoutMs: 30000 }),
      ctx.api('/api/realtime/dogfood/renderer', { timeoutMs: 30000 }),
      ctx.api('/api/realtime/provider/probe', { timeoutMs: 30000 }),
      ctx.api('/api/realtime/provider/probe', {
        method: 'POST',
        body: { execute: false, source: 'eval_realtime_preflight' },
        timeoutMs: 30000,
      }),
      ctx.api('/api/realtime/provider/probe', {
        method: 'POST',
        body: { execute: true, source: 'cui_cli' },
        timeoutMs: 30000,
      }),
      ctx.api('/api/realtime/dogfood/pack', { timeoutMs: 30000 }),
      ctx.api('/api/realtime/dogfood/acceptance', { timeoutMs: 30000 }),
      ctx.api('/api/realtime/evidence', { timeoutMs: 30000 }),
    ]);

    const realtime = config.data?.realtime || {};
    const manifest = realtime.toolManifestBudget || {};
    const configCoreReady = config.ok &&
      realtime.hasOpenAiKey === true &&
      realtime.preflightContextEnabled === true &&
      realtime.screenPrivacy?.realtimeAllowed === true &&
      manifest.ok === true &&
      manifest.toolCount <= manifest.maxTools &&
      manifest.bytes <= manifest.maxBytes;
    const configQuotaGated = configCoreReady &&
      isRecoverableProviderHealth(realtime.voiceHealth) &&
      realtime.voiceHealth?.recovery?.active === true &&
      realtime.voiceHealth?.recovery?.localFallback?.available === true &&
      realtime.voiceHealth?.fallback?.available === true &&
      realtime.voiceHealth?.fallback?.safety?.startsMicrophone === false &&
      realtime.voiceHealth?.fallback?.safety?.usesRealtime === false;
    out.push(
      configCoreReady &&
        realtime.voiceHealth?.status === 'ready'
        ? ok('realtime_preflight.config', 'Realtime config preflight', `${realtime.model || 'model?'} · ${manifest.toolCount}/${manifest.maxTools} tools · ${Math.ceil((manifest.bytes || 0) / 1024)}KB manifest`)
        : configQuotaGated
          ? warn('realtime_preflight.config', 'Realtime config preflight', `${providerHealthLabel(realtime.voiceHealth)} gated · fallback=${realtime.voiceHealth.fallback.lane} · ${manifest.toolCount}/${manifest.maxTools} tools`)
        : fail('realtime_preflight.config', 'Realtime config preflight', `GET /api/realtime/config ${config.status}`, { realtime }),
    );

    const probe = providerProbe.data?.probe || {};
    const probePreview = providerProbePreview.data || {};
    out.push(
      providerProbe.ok &&
        providerProbePreview.ok &&
        probe.startsMicrophone === false &&
        probe.requiresMicConfirmation === false &&
        probe.safety?.startsMicrophone === false &&
        probe.safety?.capturesAudio === false &&
        probePreview.executed === false &&
        probePreview.startsMicrophone === false &&
        probePreview.requiresMicConfirmation === false &&
        probePreview.requiresOpenAiSpendConfirmation === true &&
	        probePreview.openAiSpendConfirmation?.required === true &&
	        probePreview.openAiSpendConfirmation?.confirmed === false &&
	        probePreview.endpoint?.executeBody?.confirmOpenAiSpend === true &&
	        probePreview.endpoint?.executeBody?.confirmOpenAiSpendPhrase === '<type spend phrase>' &&
	        probePreview.detail?.action === 'probe'
        ? ok('realtime_preflight.provider_probe_preview', 'No-mic Realtime provider probe preview', `${probe.status || 'idle'} · renderer=${probe.rendererAvailable ? 'ready' : 'missing'} · key=${probe.hasOpenAiKey ? 'present' : 'missing'} · spend confirmation required`)
        : fail('realtime_preflight.provider_probe_preview', 'No-mic Realtime provider probe preview', `GET/POST /api/realtime/provider/probe ${providerProbe.status}/${providerProbePreview.status}`, { probe, preview: probePreview }),
    );

    const unconfirmedProbe = unconfirmedProviderProbeExecute.data || {};
    out.push(
      unconfirmedProviderProbeExecute.status === 428 &&
        unconfirmedProbe.ok === false &&
        unconfirmedProbe.executed === false &&
        unconfirmedProbe.openAiSpendConfirmation?.required === true &&
        unconfirmedProbe.openAiSpendConfirmation?.confirmed === false &&
        String(unconfirmedProbe.output || '').includes('OpenAI spend confirmation required')
        ? ok('realtime_preflight.provider_probe_spend_confirmation', 'Provider probe spend confirmation gate', 'execute:true without confirmOpenAiSpend stops at 428 before any OpenAI provider request')
        : fail('realtime_preflight.provider_probe_spend_confirmation', 'Provider probe spend confirmation gate', 'expected execute:true without confirmOpenAiSpend to return 428 and remain unexecuted', {
          status: unconfirmedProviderProbeExecute.status,
          body: unconfirmedProbe,
        }),
    );

    const autopilot = await ctx.api('/api/autopilot');
    const autopilotCandidates = autopilot.data?.decisionPreview?.candidates || [];
    const providerCandidate = autopilotCandidates.find((candidate) => candidate.id === 'readiness:realtime_voice_provider') || null;
    const providerCandidateReason = providerCandidate?.decision?.reason || '';
    const providerCandidateCovered =
      realtime.voiceHealth?.status === 'ready' ||
      (
        providerCandidate?.providerProbe === true &&
        providerCandidate.startsMicrophone === false &&
        providerCandidate.requiresMicConfirmation === false &&
        providerCandidate.requiresUserPresence === true &&
        providerCandidate.manualOnly === true &&
        providerCandidate.autoEligible === false &&
        providerCandidate.autopilotEligible === false &&
        providerCandidate.decision?.executable === false &&
        [
          'manual_only',
          'openai_spend_confirmation_required',
          'realtime_provider_probe_fresh',
          'realtime_provider_probe_running',
        ].includes(providerCandidateReason)
      );
    out.push(
      autopilot.ok && providerCandidateCovered
        ? ok('realtime_preflight.provider_probe_autopilot_candidate', 'No-mic provider probe manual candidate', realtime.voiceHealth?.status === 'ready'
          ? 'provider ready; no recovery candidate needed'
          : `${providerCandidateReason} · manualOnly=${providerCandidate.manualOnly} · autopilot=${providerCandidate.autopilotEligible}`)
        : fail('realtime_preflight.provider_probe_autopilot_candidate', 'No-mic provider probe manual candidate', 'provider readiness should expose provider probe as manual-only and not autopilot-executable because it can spend API quota', {
            voiceHealth: realtime.voiceHealth,
            candidate: providerCandidate,
            candidates: autopilotCandidates.slice(0, 6),
          }),
    );

    const rendererDogfood = renderer.data?.rendererDogfood || {};
    const preflight = rendererDogfood.preflight || {};
    const rendererBlockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
    const rendererSafetyOk = preflight.manualOnly === true &&
      preflight.startsMicrophone === false &&
      preflight.triggerStartsMicrophone === true &&
      preflight.requiresMicConfirmation === true &&
      preflight.rendererAvailable === true &&
      preflight.safety?.preflightStartsMicrophone === false &&
      preflight.safety?.executeRequiresConfirmMic === true &&
      preflight.safety?.microphoneOnlyAfterExplicitConfirmation === true;
    const rendererQuotaGated = renderer.ok &&
      rendererDogfood.ok === true &&
      preflight.status === 'blocked' &&
      preflight.readyToStart === false &&
      rendererSafetyOk &&
      preflight.providerReady === false &&
      isRecoverableProviderHealth(preflight.provider) &&
      hasProviderNotReadyBlocker(rendererBlockers);
    out.push(
      renderer.ok &&
        rendererDogfood.ok === true &&
        preflight.status === 'ready' &&
        preflight.readyToStart === true &&
        rendererSafetyOk &&
        preflight.providerReady === true &&
        rendererBlockers.length === 0
        ? ok('realtime_preflight.renderer', 'Renderer live-voice preflight', `${preflight.status} · confirmMic required · prompt=${preflight.nextPrompt?.copyText || ''}`)
        : rendererQuotaGated
          ? warn('realtime_preflight.renderer', 'Renderer live-voice preflight', `${providerHealthLabel(preflight.provider)} gated · mic blocked until confirmMic · ${preflight.provider?.summary || 'provider not ready'}`)
        : fail('realtime_preflight.renderer', 'Renderer live-voice preflight', `GET /api/realtime/dogfood/renderer ${renderer.status}`, { preflight }),
    );

    const drillPack = pack.data?.pack || {};
    const startStep = Array.isArray(drillPack.operatorSteps)
      ? drillPack.operatorSteps.find((step) => step.id === 'start_live_voice')
      : null;
    const packBlockers = Array.isArray(drillPack.blockers) ? drillPack.blockers : [];
    const acceptancePassed = Number(drillPack.readiness?.acceptancePassed || 0);
    const acceptanceGates = Number(drillPack.readiness?.acceptanceGates || 0);
    const liveGateRunbook = drillPack.liveGateRunbook || {};
    const liveGateIds = new Set(Array.isArray(liveGateRunbook.gateIds) ? liveGateRunbook.gateIds : []);
    const liveGateRunbookOk = liveGateRunbook.manualOnly === true &&
      liveGateRunbook.startsMicrophone === false &&
      liveGateRunbook.triggerStartsMicrophone === true &&
      liveGateRunbook.requiresMicConfirmation === true &&
      liveGateRunbook.autopilotEligible === false &&
      liveGateIds.has('start_live_voice') &&
      liveGateIds.has('inject_worker_progress') &&
      liveGateIds.has('sync_latest_progress') &&
      liveGateIds.has('ask_progress') &&
      String(liveGateRunbook.command || '').includes('--require-acceptance') &&
      String(liveGateRunbook.progressPrompt || '').includes('后台');
    const packSafetyOk = drillPack.manualOnly === true &&
      drillPack.startsMicrophone === false &&
      drillPack.currentActionStartsMicrophone === false &&
      drillPack.triggerStartsMicrophone === true &&
      drillPack.requiresMicConfirmation === true &&
      drillPack.requiresUserPresence === true &&
      drillPack.readiness?.rendererReady === true &&
      drillPack.readiness?.nextPromptReady === true &&
      acceptanceGates >= EXPECTED_ACCEPTANCE_GATES.size &&
      acceptancePassed < acceptanceGates &&
      liveGateRunbookOk &&
      startStep?.startsMicrophone === true &&
      startStep?.requiresMicConfirmation === true &&
      String(drillPack.commands?.start || '').includes('--confirm-mic');
    const packQuotaGated = pack.ok &&
      drillPack.readyToStart === false &&
      packSafetyOk &&
      drillPack.readiness?.providerReady === false &&
      hasProviderNotReadyBlocker(packBlockers) &&
      drillPack.safety?.preflightStartsMicrophone === false &&
      drillPack.safety?.packStartsMicrophone === false &&
      drillPack.safety?.providerProbeStartsMicrophone === false &&
      drillPack.safety?.unattendedStartBlocked === true;
    out.push(
      pack.ok &&
        drillPack.readyToStart === true &&
        packSafetyOk &&
        drillPack.readiness?.providerReady === true
        ? ok('realtime_preflight.pack', 'Realtime live drill pack preflight', `${acceptancePassed}/${acceptanceGates} acceptance gate(s) already ready`)
        : packQuotaGated
          ? warn('realtime_preflight.pack', 'Realtime live drill pack preflight', `provider gated · ${acceptancePassed}/${acceptanceGates} gate(s) ready · start command remains confirmMic-only`)
        : fail('realtime_preflight.pack', 'Realtime live drill pack preflight', `GET /api/realtime/dogfood/pack ${pack.status}`, { pack: drillPack }),
    );

    const acceptance = acceptanceResponse.data?.acceptance || {};
    const acceptanceGatesList = Array.isArray(acceptance.gates) ? acceptance.gates : [];
    const acceptanceGateIds = new Set(acceptanceGatesList.map((gate) => gate.id).filter(Boolean));
    const missingExpectedGates = [...EXPECTED_ACCEPTANCE_GATES].filter((id) => !acceptanceGateIds.has(id));
    const acceptanceGroupIds = new Set(
      (Array.isArray(acceptance.groups) ? acceptance.groups : []).map((group) => group.id).filter(Boolean),
    );
    const missingExpectedGroups = [...EXPECTED_ACCEPTANCE_GROUPS].filter((id) => !acceptanceGroupIds.has(id));
    const gaps = acceptanceGaps(acceptance);
    const unexpectedGaps = gaps.filter((id) => !EXPECTED_ACCEPTANCE_GATES.has(id));
    const acceptanceAcceptedOk = acceptanceResponse.ok &&
      acceptance.accepted === true &&
      acceptance.status === 'accepted' &&
      acceptance.manualOnly === true &&
      acceptance.startsMicrophone === false &&
      acceptance.requiresUserPresence === true &&
      Number(acceptance.counts?.gates || 0) >= EXPECTED_ACCEPTANCE_GATES.size &&
      Number(acceptance.counts?.gaps || 0) === 0 &&
      missingExpectedGates.length === 0 &&
      missingExpectedGroups.length === 0 &&
      acceptance.actionPlan?.accepted === true &&
      acceptance.actionPlan?.status === 'accepted' &&
      ['accepted', 'archive_accepted_run'].includes(acceptance.actionPlan?.primary?.id) &&
      acceptance.safety?.rawAudioStored === false &&
      acceptance.safety?.screenImageIncluded === false &&
      acceptance.safety?.actionPolicyBypassed === false &&
      gaps.length === 0;
    const acceptancePendingOk =
      acceptanceResponse.ok &&
        acceptance.accepted === false &&
        acceptance.status === 'pending' &&
        acceptance.manualOnly === true &&
        acceptance.startsMicrophone === false &&
        acceptance.requiresUserPresence === true &&
        Number(acceptance.counts?.gates || 0) >= EXPECTED_ACCEPTANCE_GATES.size &&
        Number(acceptance.counts?.gaps || 0) >= 1 &&
        missingExpectedGates.length === 0 &&
        missingExpectedGroups.length === 0 &&
        acceptance.nextGap?.id === 'start_live_voice' &&
        ['waiting_for_user', 'can_prepare', 'pending'].includes(acceptance.actionPlan?.status) &&
        acceptance.actionPlan?.primary?.id === 'start_live_voice' &&
        acceptance.actionPlan.primary.requiresMicConfirmation === true &&
        acceptance.actionPlan.primary.startsMicrophone === true &&
        acceptance.actionPlan.primary.canPreview === false &&
        Array.isArray(acceptance.actionPlan?.previewable) &&
        acceptance.actionPlan.previewable.some((action) => action.readOnly === true && action.startsMicrophone === false) &&
        Array.isArray(acceptance.actionPlan?.manual) &&
        acceptance.actionPlan.manual.some((action) => action.requiresLiveVoice === true || action.requiresMicConfirmation === true) &&
        acceptance.actionPlan.askUserOnlyFor?.some((item) => /microphone|WebRTC|approval/i.test(item)) &&
        acceptance.actionPlan.boundaries?.some((item) => /confirmMic:true|action policy/i.test(item)) &&
        acceptance.safety?.rawAudioStored === false &&
        acceptance.safety?.screenImageIncluded === false &&
        acceptance.safety?.actionPolicyBypassed === false &&
        gaps.length > 0 &&
        unexpectedGaps.length === 0;
    out.push(
      acceptanceAcceptedOk
        ? ok('realtime_preflight.acceptance_remaining', 'Realtime pre-live acceptance gaps', `${acceptance.counts.passed}/${acceptance.counts.gates} accepted; no remaining gaps`)
        : acceptancePendingOk
          ? ok('realtime_preflight.acceptance_remaining', 'Realtime pre-live acceptance gaps', `${acceptance.counts.passed}/${acceptance.counts.gates} passed; remaining=${gaps.join(', ')}`)
        : fail('realtime_preflight.acceptance_remaining', 'Realtime pre-live acceptance gaps', `GET /api/realtime/dogfood/acceptance ${acceptanceResponse.status}`, { gaps, unexpectedGaps, missingExpectedGates, missingExpectedGroups, acceptance }),
    );

    const evidenceData = evidence.data?.evidence || {};
    const evidenceReadyOk = evidence.ok &&
      evidenceData.status === 'ready' &&
      evidenceData.phase === 'ready' &&
      evidenceData.checks?.providerReady === true &&
      evidenceData.checks?.sessionNegotiated === true &&
      evidenceData.checks?.voiceSessionLive === true &&
      evidenceData.checks?.progressInjectedFromRenderer === true &&
      evidenceData.checks?.progressVersionSynced === true &&
      evidenceData.checks?.passiveContextOnly === true &&
      evidenceData.checks?.spokenSummaryReady === true &&
      !evidenceData.blocker &&
      evidenceData.voiceHealth?.status === 'ready';
    const evidenceRendererControl = evidenceData.rendererControl || {};
    const evidenceControl = evidenceRendererControl.control || {};
    const evidenceConversation = evidenceRendererControl.conversation || {};
    const evidencePostStopOk = evidence.ok &&
      evidenceData.checks?.providerReady === true &&
      evidenceData.checks?.sessionNegotiated === true &&
      evidenceData.checks?.voiceSessionLive === false &&
      evidenceData.checks?.progressInjectedFromRenderer === true &&
      evidenceData.checks?.passiveContextOnly === true &&
      evidenceData.checks?.spokenSummaryReady === true &&
      evidenceData.blocker?.id === 'voice_session_live' &&
      evidenceData.voiceHealth?.status === 'ready' &&
      evidenceConversation.active === false &&
      evidenceConversation.status === 'idle' &&
      evidenceControl.action === 'stop' &&
      ['stopped', 'already_idle'].includes(evidenceControl.status);
    const evidenceQuotaGated = evidence.ok &&
      evidenceData.checks?.providerReady === false &&
      evidenceData.checks?.spokenSummaryReady === true &&
      evidenceData.checks?.sessionNegotiated === false &&
      evidenceData.blocker?.id === 'provider_ready' &&
      isRecoverableProviderHealth(evidenceData.voiceHealth) &&
      evidenceData.voiceHealth?.recovery?.active === true &&
      evidenceData.voiceHealth?.recovery?.localFallback?.available === true;
    out.push(
      evidenceReadyOk
        ? ok('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `${evidenceData.status}/${evidenceData.phase} · live evidence ready`)
        : evidencePostStopOk
          ? ok('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `${evidenceData.status || 'pending'}/${evidenceData.phase || 'needs_live_voice'} · renderer stopped live voice`)
        : evidence.ok &&
        evidenceData.checks?.providerReady === true &&
        evidenceData.checks?.spokenSummaryReady === true &&
        evidenceData.checks?.sessionNegotiated === false &&
        evidenceData.blocker?.id === 'session_negotiated' &&
        evidenceData.voiceHealth?.status === 'ready'
          ? ok('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `${evidenceData.status || 'pending'}/${evidenceData.phase || 'needs_live_session'} · blocker=${evidenceData.blocker.id}`)
        : evidenceQuotaGated
          ? warn('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `${evidenceData.status || 'pending'}/${evidenceData.phase || 'provider_attention'} · ${providerHealthLabel(evidenceData.voiceHealth)} gated · fallback available`)
        : fail('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `GET /api/realtime/evidence ${evidence.status}`, evidence.data),
    );

    const payloadReport = await runRealtimePayloadAudit(ctx);
    out.push(
      payloadReport.ok
        ? ok('realtime_preflight.payload_budget', 'Realtime payload budget before live dogfood', `${payloadReport.counts.pass}/${payloadReport.counts.total} payload(s) within budget`)
        : fail('realtime_preflight.payload_budget', 'Realtime payload budget before live dogfood', `${payloadReport.counts.fail} payload budget failure(s)`, payloadReport.results.filter((result) => !result.ok)),
    );

    return out;
  },
};
