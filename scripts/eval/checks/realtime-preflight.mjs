import { ok, fail } from '../_client.mjs';
import { runRealtimePayloadAudit } from '../../realtime-payload-audit.mjs';

const EXPECTED_ACCEPTANCE_GATES = new Set([
  'open_monitor',
  'start_live_voice',
  'inject_worker_progress',
  'sync_latest_progress',
  'ask_progress',
  'ask_work_handoff',
  'ask_autopilot_status',
  'ask_attention_explanation',
  'ask_perception_consent',
  'ask_local_capabilities',
  'plan_mcp_tool_call',
  'review_and_resolve_approval',
  'manage_collaboration_claim',
  'ask_learning_profile',
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

export default {
  lane: 'realtime-preflight',
  async run(ctx) {
    const out = [];
    const [config, renderer, pack, acceptanceResponse, evidence] = await Promise.all([
      ctx.api('/api/realtime/config?micMode=open', { timeoutMs: 10000 }),
      ctx.api('/api/realtime/dogfood/renderer', { timeoutMs: 10000 }),
      ctx.api('/api/realtime/dogfood/pack', { timeoutMs: 10000 }),
      ctx.api('/api/realtime/dogfood/acceptance', { timeoutMs: 10000 }),
      ctx.api('/api/realtime/evidence', { timeoutMs: 10000 }),
    ]);

    const realtime = config.data?.realtime || {};
    const manifest = realtime.toolManifestBudget || {};
    out.push(
      config.ok &&
        realtime.hasOpenAiKey === true &&
        realtime.voiceHealth?.status === 'ready' &&
        realtime.preflightContextEnabled === true &&
        realtime.screenPrivacy?.realtimeAllowed === true &&
        manifest.ok === true &&
        manifest.toolCount <= manifest.maxTools &&
        manifest.bytes <= manifest.maxBytes
        ? ok('realtime_preflight.config', 'Realtime config preflight', `${realtime.model || 'model?'} · ${manifest.toolCount}/${manifest.maxTools} tools · ${Math.ceil((manifest.bytes || 0) / 1024)}KB manifest`)
        : fail('realtime_preflight.config', 'Realtime config preflight', `GET /api/realtime/config ${config.status}`, { realtime }),
    );

    const rendererDogfood = renderer.data?.rendererDogfood || {};
    const preflight = rendererDogfood.preflight || {};
    const rendererBlockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
    out.push(
      renderer.ok &&
        rendererDogfood.ok === true &&
        preflight.status === 'ready' &&
        preflight.readyToStart === true &&
        preflight.manualOnly === true &&
        preflight.startsMicrophone === false &&
        preflight.triggerStartsMicrophone === true &&
        preflight.requiresMicConfirmation === true &&
        preflight.rendererAvailable === true &&
        preflight.providerReady === true &&
        rendererBlockers.length === 0 &&
        preflight.safety?.preflightStartsMicrophone === false &&
        preflight.safety?.executeRequiresConfirmMic === true &&
        preflight.safety?.microphoneOnlyAfterExplicitConfirmation === true
        ? ok('realtime_preflight.renderer', 'Renderer live-voice preflight', `${preflight.status} · confirmMic required · prompt=${preflight.nextPrompt?.copyText || ''}`)
        : fail('realtime_preflight.renderer', 'Renderer live-voice preflight', `GET /api/realtime/dogfood/renderer ${renderer.status}`, { preflight }),
    );

    const drillPack = pack.data?.pack || {};
    const startStep = Array.isArray(drillPack.operatorSteps)
      ? drillPack.operatorSteps.find((step) => step.id === 'start_live_voice')
      : null;
    const acceptancePassed = Number(drillPack.readiness?.acceptancePassed || 0);
    const acceptanceGates = Number(drillPack.readiness?.acceptanceGates || 0);
    out.push(
      pack.ok &&
        drillPack.readyToStart === true &&
        drillPack.manualOnly === true &&
        drillPack.startsMicrophone === false &&
        drillPack.currentActionStartsMicrophone === false &&
        drillPack.triggerStartsMicrophone === true &&
        drillPack.requiresMicConfirmation === true &&
        drillPack.requiresUserPresence === true &&
        drillPack.readiness?.rendererReady === true &&
        drillPack.readiness?.providerReady === true &&
        drillPack.readiness?.nextPromptReady === true &&
        acceptanceGates >= EXPECTED_ACCEPTANCE_GATES.size &&
        acceptancePassed < acceptanceGates &&
        startStep?.startsMicrophone === true &&
        startStep?.requiresMicConfirmation === true &&
        String(drillPack.commands?.start || '').includes('--confirm-mic')
        ? ok('realtime_preflight.pack', 'Realtime live drill pack preflight', `${acceptancePassed}/${acceptanceGates} acceptance gate(s) already ready`)
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
    out.push(
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
        unexpectedGaps.length === 0
        ? ok('realtime_preflight.acceptance_remaining', 'Realtime pre-live acceptance gaps', `${acceptance.counts.passed}/${acceptance.counts.gates} passed; remaining=${gaps.join(', ')}`)
        : fail('realtime_preflight.acceptance_remaining', 'Realtime pre-live acceptance gaps', `GET /api/realtime/dogfood/acceptance ${acceptanceResponse.status}`, { gaps, unexpectedGaps, missingExpectedGates, missingExpectedGroups, acceptance }),
    );

    const evidenceData = evidence.data?.evidence || {};
    out.push(
      evidence.ok &&
        evidenceData.checks?.providerReady === true &&
        evidenceData.checks?.spokenSummaryReady === true &&
        evidenceData.checks?.sessionNegotiated === false &&
        evidenceData.blocker?.id === 'session_negotiated' &&
        evidenceData.voiceHealth?.status === 'ready'
        ? ok('realtime_preflight.evidence_state', 'Realtime evidence pre-live state', `${evidenceData.status || 'pending'}/${evidenceData.phase || 'needs_live_session'} · blocker=${evidenceData.blocker.id}`)
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
