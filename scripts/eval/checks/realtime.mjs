import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

const REQUIRED_TOOLS = [
  'plan_context',
  'observe_now',
  'get_mac_context',
  'get_browser_context',
  'get_config_check',
  'get_control_mode',
  'get_work_progress',
  'get_collaboration_state',
  'search_local_skills',
  'get_skill_shortcuts',
  'get_skill_shortcut_candidates',
  'save_skill_shortcut',
  'forget_skill_shortcut',
  'get_ui_demonstrations',
  'start_ui_demonstration',
  'capture_ui_demonstration_step',
  'finish_ui_demonstration',
  'plan_ui_demonstration_replay',
  'run_ui_demonstration_replay',
  'draft_ui_demonstration_skill',
  'save_ui_demonstration_skill',
  'read_browser_page',
  'run_browser_workflow',
  'route_task',
  'route_parallel_tasks',
  'delegate_task',
  'run_cli_tool',
  'run_mac_action',
  'run_file_action',
];

function parseToolOutput(response) {
  try {
    return JSON.parse(response.data?.output || '{}');
  } catch {
    return null;
  }
}

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

    const shortcutList = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_skill_shortcuts', arguments: { limit: 3 } },
    });
    const shortcutListOutput = parseToolOutput(shortcutList);
    out.push(
      shortcutList.ok &&
        shortcutList.data?.ok === true &&
        shortcutListOutput?.counts &&
        Array.isArray(shortcutListOutput.items)
        ? ok('realtime.shortcut_list_tool', 'Realtime shortcut list tool', `${shortcutListOutput.counts.total || 0} saved shortcut(s)`)
        : fail('realtime.shortcut_list_tool', 'Realtime shortcut list tool', `tool execute ${shortcutList.status}`, shortcutList.data),
    );

    const shortcutCandidates = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_skill_shortcut_candidates', arguments: { limit: 3 } },
    });
    const shortcutCandidateOutput = parseToolOutput(shortcutCandidates);
    out.push(
      shortcutCandidates.ok &&
        shortcutCandidates.data?.ok === true &&
        typeof shortcutCandidateOutput?.count === 'number' &&
        Array.isArray(shortcutCandidateOutput.items)
        ? ok('realtime.shortcut_candidate_tool', 'Realtime shortcut candidate tool', `${shortcutCandidateOutput.count} candidate(s)`)
        : fail('realtime.shortcut_candidate_tool', 'Realtime shortcut candidate tool', `tool execute ${shortcutCandidates.status}`, shortcutCandidates.data),
    );

    const shortcutPhrase = `eval realtime shortcut ${Date.now().toString(36)}`;
    let savedShortcutId = '';
    try {
      const skillRecallPlan = {
        applied: true,
        matched: 1,
        decisionEffect: 'eval_realtime_shortcut_tool',
        summary: 'Eval-only realtime shortcut tool plan.',
        primarySkill: {
          name: 'eval-realtime-shortcut-skill',
          kind: 'eval',
          summary: 'Eval-only shortcut tool skill.',
        },
        skills: [{
          name: 'eval-realtime-shortcut-skill',
          kind: 'eval',
          summary: 'Eval-only shortcut tool skill.',
        }],
        recommendedTools: ['search_local_skills'],
        planSteps: ['Use this only as eval evidence.'],
        confirmationRequired: true,
        confirmationGates: ['action_policy', 'control_mode'],
        shortcutCandidate: {
          eligible: true,
          reason: 'Eval verifies realtime shortcut save gate.',
          nextAction: 'Confirm before save.',
        },
      };
      const savePreview = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'save_skill_shortcut',
          arguments: {
            phrase: shortcutPhrase,
            skillRecallPlan,
          },
        },
        retries: 0,
      });
      const savePreviewOutput = parseToolOutput(savePreview);
      out.push(
        savePreview.ok &&
          savePreview.data?.ok === false &&
          savePreviewOutput?.requiresConfirmation === true &&
          savePreviewOutput?.status === 409
          ? ok('realtime.shortcut_save_gate_tool', 'Realtime shortcut save gate', 'save_skill_shortcut requires confirm:true before writing')
          : fail('realtime.shortcut_save_gate_tool', 'Realtime shortcut save gate', 'expected save tool to require confirmation', savePreview.data),
      );

      const saveConfirmed = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'save_skill_shortcut',
          arguments: {
            phrase: shortcutPhrase,
            skillRecallPlan,
            confirm: true,
          },
        },
        retries: 0,
      });
      const saveConfirmedOutput = parseToolOutput(saveConfirmed);
      savedShortcutId = saveConfirmedOutput?.shortcut?.id || '';
      out.push(
        saveConfirmed.ok &&
          saveConfirmed.data?.ok === true &&
          savedShortcutId &&
          saveConfirmedOutput?.shortcut?.phrase === shortcutPhrase
          ? ok('realtime.shortcut_save_tool', 'Realtime shortcut save tool', `saved ${shortcutPhrase}`)
          : fail('realtime.shortcut_save_tool', 'Realtime shortcut save tool', 'expected confirmed save tool to persist shortcut', saveConfirmed.data),
      );

      const forget = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'forget_skill_shortcut',
          arguments: {
            id: savedShortcutId,
          },
        },
        retries: 0,
      });
      const forgetOutput = parseToolOutput(forget);
      if (forgetOutput?.ok) savedShortcutId = '';
      out.push(
        forget.ok &&
          forget.data?.ok === true &&
          forgetOutput?.removed?.phrase === shortcutPhrase
          ? ok('realtime.shortcut_forget_tool', 'Realtime shortcut forget tool', `removed ${shortcutPhrase}`)
          : fail('realtime.shortcut_forget_tool', 'Realtime shortcut forget tool', 'expected forget tool to delete saved shortcut', forget.data),
      );
    } finally {
      if (savedShortcutId) {
        await ctx.api(`/api/shortcuts/${encodeURIComponent(savedShortcutId)}?source=eval_cleanup`, {
          method: 'DELETE',
          retries: 0,
        });
      }
    }

    const shortcutEvidence = await ctx.api('/api/realtime/evidence');
    const shortcutToolEvidence = shortcutEvidence.data?.evidence?.shortcutTools;
    const shortcutToolEvents = Array.isArray(shortcutToolEvidence?.recent) ? shortcutToolEvidence.recent : [];
    const shortcutEventNames = new Set(shortcutToolEvents.map((event) => event.name));
    const shortcutActions = new Set(shortcutToolEvents.map((event) => event.shortcut?.action).filter(Boolean));
    out.push(
      shortcutEvidence.ok &&
        shortcutToolEvidence?.hasConfirmationGate === true &&
        shortcutToolEvidence?.hasSave === true &&
        shortcutToolEvidence?.hasForget === true &&
        shortcutToolEvidence?.hasList === true &&
        shortcutToolEvidence?.hasCandidates === true &&
        shortcutEventNames.has('save_skill_shortcut') &&
        shortcutEventNames.has('forget_skill_shortcut') &&
        shortcutToolEvents.some((event) => event.source === 'eval')
        ? ok('realtime.shortcut_tool_evidence', 'Realtime shortcut tool evidence', `actions=${Array.from(shortcutActions).join(', ')}`)
        : fail('realtime.shortcut_tool_evidence', 'Realtime shortcut tool evidence', 'expected shortcut tool calls to be visible in realtime evidence', shortcutToolEvidence),
    );

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-evidence'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      out.push(
        output.includes('Shortcut tools:') &&
          output.includes('Dogfood drill:') &&
          output.includes('Recent realtime tool calls:') &&
          output.includes('confirm_required') &&
          output.includes('save') &&
          output.includes('forget')
          ? ok('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', 'config CUI prints shortcut and recent tool-call evidence')
          : fail('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', 'expected config CUI to print shortcut tool evidence', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', error instanceof Error ? error.message : String(error)));
    }

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
    const checklistIds = new Set((Array.isArray(e?.checklist) ? e.checklist : []).map((step) => step.id));
    const requiredChecklist = [
      'provider_ready',
      'session_negotiated',
      'worker_progress_injected',
      'passive_context_only',
      'spoken_summary_ready',
    ];
    const structuredEvidenceOk = Boolean(
      e &&
        ['ready', 'pending', 'blocked'].includes(e.status) &&
        typeof e.phase === 'string' &&
        e.phase.length > 0 &&
        Array.isArray(e.checklist) &&
        requiredChecklist.every((id) => checklistIds.has(id)) &&
        (e.readyForVoiceProgressQuestion ? e.status === 'ready' && !e.blocker : e.blocker && typeof e.blocker.id === 'string'),
    );
    out.push(
      evidence.ok &&
        e &&
        typeof e.readyForVoiceProgressQuestion === 'boolean' &&
        e.checks &&
        ['providerReady', 'sessionNegotiated', 'progressInjectedFromRenderer', 'passiveContextOnly', 'spokenSummaryReady'].every((key) => typeof e.checks[key] === 'boolean') &&
        structuredEvidenceOk &&
        typeof e.nextAction === 'string' &&
        Array.isArray(e.drill?.steps) &&
        e.drill.steps.some((step) => step.id === 'start_live_voice') &&
        e.drill.steps.some((step) => step.id === 'route_recalled_shortcut') &&
        e.progress?.spokenSummary
        ? ok('realtime.evidence_checklist', 'Realtime evidence checklist', `${e.status}/${e.phase} · ${e.nextAction}`)
        : fail('realtime.evidence_checklist', 'Realtime evidence checklist', `GET /api/realtime/evidence ${evidence.status}`, evidence.data),
    );

    const dogfood = await ctx.api('/api/realtime/dogfood');
    const d = dogfood.data?.dogfood;
    const dogfoodStepIds = new Set((Array.isArray(d?.steps) ? d.steps : []).map((step) => step.id));
    const dogfoodRequiredSteps = [
      'provider_ready',
      'session_negotiated',
      'worker_progress_injected',
      'passive_context_only',
      'spoken_summary_ready',
    ];
    out.push(
      dogfood.ok &&
        d &&
        d.manualOnly === true &&
        d.autoEligible === false &&
        d.autopilotEligible === false &&
        d.requiresUserPresence === true &&
        d.safety?.startsMicrophoneOnlyAfterUserAction === true &&
        d.start?.workNext?.path === '/api/work/next' &&
        d.prepareProgress?.path === '/api/realtime/dogfood/prepare' &&
        d.monitor?.endpoint === '/api/realtime/evidence' &&
        d.drill?.manualOnly === true &&
        Array.isArray(d.drill?.steps) &&
        d.drill.steps.some((step) => step.id === 'ask_progress') &&
        Array.isArray(d.drill?.prompts) &&
        d.drill.prompts.includes('后台现在怎么样') &&
        typeof d.promptWhenReady === 'string' &&
        dogfoodRequiredSteps.every((id) => dogfoodStepIds.has(id))
        ? ok('realtime.dogfood_runbook', 'Realtime dogfood runbook', `${d.status}/${d.phase || '-'} · manual-only · ${d.nextAction || ''}`)
        : fail('realtime.dogfood_runbook', 'Realtime dogfood runbook', `GET /api/realtime/dogfood ${dogfood.status}`, dogfood.data),
    );

    const drill = await ctx.api('/api/realtime/dogfood/drill');
    const drillData = drill.data?.drill;
    const drillIds = new Set((Array.isArray(drillData?.steps) ? drillData.steps : []).map((step) => step.id));
    const drillRequired = [
      'open_monitor',
      'start_live_voice',
      'inject_worker_progress',
      'ask_progress',
      'list_shortcuts',
      'save_shortcut_with_confirmation',
      'route_recalled_shortcut',
      'forget_shortcut',
    ];
    out.push(
      drill.ok &&
        drillData?.manualOnly === true &&
        drillData?.autoEligible === false &&
        drillRequired.every((id) => drillIds.has(id)) &&
        Array.isArray(drillData.prompts) &&
        drillData.prompts.some((prompt) => prompt.includes('后台现在怎么样')) &&
        drill.data?.evidence?.drill?.steps?.length === drillData.steps.length
        ? ok('realtime.dogfood_drill', 'Realtime dogfood drill', `${drillData.status || 'pending'} · ${drillData.summary || ''}`)
        : fail('realtime.dogfood_drill', 'Realtime dogfood drill', `GET /api/realtime/dogfood/drill ${drill.status}`, drill.data),
    );

    const prepare = await ctx.api('/api/realtime/dogfood/prepare', {
      method: 'POST',
      body: {
        execute: false,
        durationMs: 5000,
        source: 'eval',
      },
    });
    const prep = prepare.data;
    const prepResult = prep?.result || {};
    out.push(
      prepare.ok &&
        prep &&
        prep.manualOnly === true &&
        prep.executed === false &&
        prep.durationMs === 5000 &&
        prepResult.executed === false &&
        prepResult.parallelGroup &&
        Array.isArray(prepResult.results) &&
        prepResult.results[0]?.ownership?.access === 'read'
        ? ok('realtime.dogfood_prepare_preview', 'Realtime dogfood progress sample preview', `${prep.durationMs}ms · ${prepResult.parallelGroup}`)
        : fail('realtime.dogfood_prepare_preview', 'Realtime dogfood progress sample preview', `POST /api/realtime/dogfood/prepare ${prepare.status}`, prepare.data),
    );

    return out;
  },
};
