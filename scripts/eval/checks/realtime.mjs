import { ok, warn, fail } from '../_client.mjs';

const REQUIRED_TOOLS = [
  'plan_context',
  'observe_now',
  'get_mac_context',
  'get_browser_context',
  'get_config_check',
  'get_control_mode',
  'get_work_progress',
  'get_collaboration_state',
  'read_browser_page',
  'run_browser_workflow',
  'route_task',
  'route_parallel_tasks',
  'delegate_task',
  'run_cli_tool',
  'run_mac_action',
  'run_file_action',
];

export default {
  lane: 'realtime',
  async run(ctx) {
    const out = [];

    const config = await ctx.api('/api/realtime/config?micMode=open');
    const realtime = config.data?.realtime;
    if (!config.ok || !realtime) {
      out.push(fail('realtime.config', 'Realtime config snapshot', `GET /api/realtime/config ${config.status} ${config.error || config.data?.error || ''}`));
      return out;
    }
    out.push(ok('realtime.config', 'Realtime config snapshot', `${realtime.model || 'model?'} · voice=${realtime.voice || 'voice?'} · tools=${realtime.toolCount ?? 0}`));

    out.push(
      realtime.hasOpenAiKey
        ? ok('realtime.key', 'Realtime API key', 'OPENAI_API_KEY is available to the resident')
        : fail('realtime.key', 'Realtime API key', 'OPENAI_API_KEY is missing, so voice sessions cannot start'),
    );

    out.push(
      realtime.voiceHealth?.summary && realtime.voiceHealth?.status
        ? realtime.voiceHealth.status === 'ready'
          ? ok('realtime.voice_health', 'Realtime voice health', realtime.voiceHealth.summary)
          : warn('realtime.voice_health', 'Realtime voice health', realtime.voiceHealth.summary, realtime.voiceHealth)
        : fail('realtime.voice_health', 'Realtime voice health', 'config snapshot did not expose provider health state'),
    );

    out.push(
      realtime.preflightContextEnabled
        ? ok('realtime.preflight.enabled', 'Realtime preflight', 'preflight context injection is enabled')
        : fail('realtime.preflight.enabled', 'Realtime preflight', 'JAVIS_REALTIME_PREFLIGHT_CONTEXT_ENABLED is disabled'),
    );

    out.push(
      realtime.screenPrivacy?.realtimeAllowed
        ? ok('realtime.screen.allowed', 'Screen context allowed', `${realtime.screenPrivacy.mode || 'mode?'} allows realtime screen context`)
        : fail('realtime.screen.allowed', 'Screen context allowed', `screen privacy mode ${realtime.screenPrivacy?.mode || 'unknown'} blocks realtime screen context`, realtime.screenPrivacy),
    );

    const missing = Array.isArray(realtime.requiredTools?.missing)
      ? realtime.requiredTools.missing
      : REQUIRED_TOOLS.filter((name) => !(realtime.toolNames || []).includes(name));
    out.push(
      missing.length === 0
        ? ok('realtime.tools.required', 'Realtime tool inventory', `${REQUIRED_TOOLS.length} required tool(s) present`)
        : fail('realtime.tools.required', 'Realtime tool inventory', `missing: ${missing.join(', ')}`, { missing }),
    );

    const failedInstructions = Array.isArray(realtime.failedInstructionChecks)
      ? realtime.failedInstructionChecks
      : Object.entries(realtime.instructionChecks || {}).filter(([, passed]) => !passed).map(([name]) => name);
    out.push(
      failedInstructions.length === 0
        ? ok('realtime.instructions', 'Realtime instruction guardrails', `${Object.keys(realtime.instructionChecks || {}).length} invariant(s) present`)
        : fail('realtime.instructions', 'Realtime instruction guardrails', `missing invariant(s): ${failedInstructions.join(', ')}`),
    );

    const context = await ctx.api('/api/realtime/context?source=eval');
    const c = context.data?.context;
    if (!context.ok || !c) {
      out.push(fail('realtime.context', 'Realtime preflight context', `GET /api/realtime/context ${context.status} ${context.error || context.data?.error || ''}`));
    } else {
      const hasCoreContext = Boolean(c.presence && c.mac && c.screen && c.briefing);
      out.push(
        hasCoreContext
          ? ok('realtime.context', 'Realtime preflight context', `presence=${c.presence.mode || c.presence.label || 'ok'} · nextActions=${(c.briefing.nextActions || []).length}`)
          : fail('realtime.context', 'Realtime preflight context', `missing core keys: ${['presence', 'mac', 'screen', 'briefing'].filter((key) => !c[key]).join(', ')}`, c),
      );
    }

    const progress = await ctx.api('/api/work/progress');
    const p = progress.data?.progress;
    out.push(
      progress.ok && p && Array.isArray(p.workerGroups) && typeof p.workerSummary === 'string'
        ? ok('realtime.progress', 'Silent work progress source', `active=${(p.activeJobs || []).length} · workerGroups=${p.workerGroups.length} · blocked=${(p.blockedWorkflows || []).length} · next=${(p.nextActions || []).length}`)
        : warn('realtime.progress', 'Silent work progress source', `GET /api/work/progress ${progress.status} ${progress.error || ''}`),
    );
    out.push(
      progress.ok && p && typeof p.spokenSummary === 'string' && p.spokenSummary.trim() && p.spokenSummary.length <= 420
        ? ok('realtime.progress_spoken', 'Spoken progress summary', p.spokenSummary)
        : warn('realtime.progress_spoken', 'Spoken progress summary', 'progress response did not include a short spokenSummary', { spokenSummary: p?.spokenSummary }),
    );

    const negotiation = await ctx.api('/api/realtime/session-negotiation', {
      method: 'POST',
      body: {
        dryRun: true,
        source: 'eval',
        sessionId: 'eval-negotiation',
        micMode: 'open',
        offerBytes: 1234,
        answerBytes: 2345,
        statusCode: 200,
        ok: true,
        durationMs: 345,
      },
    });
    const n = negotiation.data?.negotiation;
    out.push(
      negotiation.ok &&
        n?.source === 'eval' &&
        n?.sessionId === 'eval-negotiation' &&
        n?.micMode === 'open' &&
        n?.offerBytes === 1234 &&
        n?.answerBytes === 2345 &&
        n?.statusCode === 200 &&
        n?.ok === true
        ? ok('realtime.negotiation_evidence', 'Realtime negotiation evidence', 'session negotiation receipt normalizes WebRTC offer/answer metadata')
        : fail('realtime.negotiation_evidence', 'Realtime negotiation evidence', `POST /api/realtime/session-negotiation ${negotiation.status}`, negotiation.data),
    );

    const evidence = await ctx.api('/api/realtime/evidence');
    const e = evidence.data?.evidence;
    out.push(
      evidence.ok &&
        e &&
        typeof e.readyForVoiceProgressQuestion === 'boolean' &&
        e.checks &&
        ['sessionNegotiated', 'progressInjectedFromRenderer', 'passiveContextOnly', 'spokenSummaryReady'].every((key) => typeof e.checks[key] === 'boolean') &&
        typeof e.nextAction === 'string' &&
        e.progress?.spokenSummary
        ? ok('realtime.evidence_checklist', 'Realtime evidence checklist', `${e.readyForVoiceProgressQuestion ? 'ready' : 'pending'} · ${e.nextAction}`)
        : fail('realtime.evidence_checklist', 'Realtime evidence checklist', `GET /api/realtime/evidence ${evidence.status}`, evidence.data),
    );

    return out;
  },
};
