import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

const REQUIRED_TOOLS = [
  'plan_context',
  'observe_now',
  'get_mac_context',
  'get_browser_context',
  'get_browser_activity',
  'get_config_check',
  'get_perception_consent',
  'get_screen_privacy',
  'preview_screen_privacy_region_preset',
  'apply_screen_privacy_region_preset',
  'get_control_mode',
  'get_attention_policy',
  'get_attention_explanation',
  'get_work_progress',
  'get_realtime_evidence',
  'get_realtime_dogfood_acceptance',
  'save_realtime_dogfood_archive',
  'get_productivity_dogfood_archive',
  'save_productivity_dogfood_archive',
  'get_realtime_dogfood_session',
  'start_realtime_dogfood_session',
  'mark_realtime_dogfood_step',
  'end_realtime_dogfood_session',
  'get_worker_recovery',
  'run_worker_recovery',
  'get_autopilot_status',
  'get_work_handoff',
  'get_collaboration_state',
  'get_local_capabilities',
  'get_learning_profile',
  'get_learning_evolution',
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
      realtime.screenPrivacy?.realtimeAllowed &&
        realtime.screenPrivacy?.enforcement?.appWindowContextFilter === true &&
        realtime.screenPrivacy?.ruleCounts &&
        typeof realtime.screenPrivacy?.rulesSummary === 'string'
        ? ok('realtime.screen.allowed', 'Screen context allowed', `${realtime.screenPrivacy.mode || 'mode?'} allows realtime screen context with ${realtime.screenPrivacy.ruleCounts.enabled || 0} privacy rule(s)`)
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
    const localMissing = REQUIRED_TOOLS.filter((name) => !(realtime.toolNames || []).includes(name));
    out.push(
      localMissing.length === 0
        ? ok('realtime.tools.local_required', 'Realtime local required tool inventory', `${REQUIRED_TOOLS.length} locally required tool(s) present`)
        : fail('realtime.tools.local_required', 'Realtime local required tool inventory', `missing locally required tool(s): ${localMissing.join(', ')}`, { localMissing }),
    );

    const failedInstructions = Array.isArray(realtime.failedInstructionChecks)
      ? realtime.failedInstructionChecks
      : Object.entries(realtime.instructionChecks || {}).filter(([, passed]) => !passed).map(([name]) => name);
    out.push(
      failedInstructions.length === 0
        ? ok('realtime.instructions', 'Realtime instruction guardrails', `${Object.keys(realtime.instructionChecks || {}).length} invariant(s) present`)
        : fail('realtime.instructions', 'Realtime instruction guardrails', `missing invariant(s): ${failedInstructions.join(', ')}`),
    );

    const browserActivityTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_browser_activity', arguments: { limit: 5 } },
    });
    const browserActivityOutput = parseToolOutput(browserActivityTool);
    out.push(
      browserActivityTool.ok &&
        browserActivityTool.data?.ok === true &&
        browserActivityOutput?.privacy?.metadataOnly === true &&
        browserActivityOutput?.privacy?.noPageText === true &&
        Array.isArray(browserActivityOutput.recent) &&
        Array.isArray(browserActivityOutput.topHosts)
        ? ok('realtime.browser_activity_tool', 'Realtime browser activity tool', `${browserActivityOutput.recent.length} recent page context(s)`)
        : fail('realtime.browser_activity_tool', 'Realtime browser activity tool', `tool execute ${browserActivityTool.status}`, browserActivityTool.data),
    );

    const browserWorkflowTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'run_browser_workflow',
        arguments: {
          intent: 'extract_actions',
          mode: 'quick',
          execute: false,
          instruction: 'Extract follow-up actions from this page without submitting any form.',
          page: {
            available: true,
            supported: true,
            app: 'FixtureBrowser',
            title: 'Realtime Browser Fixture',
            url: 'https://example.test/realtime-browser-fixture',
            metaDescription: 'Fixture page for Realtime browser workflow evidence.',
            headings: ['Realtime Browser Dogfood', 'Follow-up Actions'],
            text: [
              'JAVIS realtime browser fixture.',
              'Action: inspect the current page before acting.',
              'Action: keep form submission disabled until the user explicitly confirms.',
              'Private fixture token: rt-browser-secret-do-not-return.',
            ].join('\n'),
            links: [
              { text: 'Operator runbook', href: 'https://example.test/realtime-browser-runbook' },
            ],
          },
          scope: 'eval:realtime:browser_workflow',
          parallelGroup: 'realtime:browser_workflow',
          source: 'eval_realtime_browser_workflow',
        },
      },
    });
    const browserWorkflowOutput = parseToolOutput(browserWorkflowTool);
    const browserWorkflowBody = JSON.stringify(browserWorkflowOutput || {});
    out.push(
      browserWorkflowTool.ok &&
        browserWorkflowTool.data?.ok === true &&
        browserWorkflowOutput?.ok === true &&
        browserWorkflowOutput?.intent === 'extract_actions' &&
        browserWorkflowOutput?.preview === true &&
        browserWorkflowOutput?.executed === false &&
        browserWorkflowOutput?.queued === false &&
        browserWorkflowOutput?.workflow?.status === 'done' &&
        browserWorkflowOutput?.routing?.status === 'done' &&
        browserWorkflowOutput?.page?.title === 'Realtime Browser Fixture' &&
        browserWorkflowOutput?.page?.linkCount === 1 &&
        /Preview only/.test(String(browserWorkflowOutput?.output || '')) &&
        !browserWorkflowBody.includes('rt-browser-secret-do-not-return')
        ? ok('realtime.browser_workflow_tool', 'Realtime browser workflow voice tool', 'previewed extract_actions without queue, model call, or browser action')
        : fail('realtime.browser_workflow_tool', 'Realtime browser workflow voice tool', `tool execute ${browserWorkflowTool.status}`, browserWorkflowTool.data),
    );

    const browserEvidence = await ctx.api('/api/realtime/evidence');
    const browserToolEvidence = browserEvidence.data?.evidence?.browserTools;
    const browserToolEvents = Array.isArray(browserToolEvidence?.recent) ? browserToolEvidence.recent : [];
    out.push(
      browserEvidence.ok &&
        browserToolEvidence?.hasWorkflow === true &&
        browserToolEvidence?.hasSafeWorkflowPreview === true &&
        browserToolEvents.some((event) => (
          event.name === 'run_browser_workflow' &&
          event.source === 'eval' &&
          event.browser?.action === 'workflow' &&
          event.browser?.intent === 'extract_actions' &&
          event.browser?.safePreview === true &&
          event.browser?.title === 'Realtime Browser Fixture'
        ))
        ? ok('realtime.browser_workflow_tool_evidence', 'Realtime browser workflow tool evidence', 'run_browser_workflow is visible in safe Realtime browser evidence')
        : fail('realtime.browser_workflow_tool_evidence', 'Realtime browser workflow tool evidence', 'expected run_browser_workflow to appear in realtime evidence', browserToolEvidence),
    );

    const productivityDogfoodTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'save_productivity_dogfood_archive',
        arguments: { limit: 2 },
      },
      timeoutMs: 45000,
    });
    const productivityDogfoodOutput = parseToolOutput(productivityDogfoodTool);
    const productivityDogfoodArchive = productivityDogfoodOutput.archive || {};
    out.push(
      productivityDogfoodTool.ok &&
        productivityDogfoodTool.data?.ok === true &&
        productivityDogfoodOutput.saved === true &&
        productivityDogfoodArchive.ok === true &&
        productivityDogfoodArchive.counts?.total === 4 &&
        productivityDogfoodArchive.counts?.pass === 4 &&
        productivityDogfoodArchive.safety?.previewOnly === true &&
        productivityDogfoodArchive.safety?.startsApps === false &&
        productivityDogfoodArchive.safety?.sendsMessages === false &&
        productivityDogfoodArchive.safety?.mutatesUserFiles === false
        ? ok('realtime.productivity_dogfood_tool', 'Realtime productivity dogfood voice tool', 'saved four-app productivity preview evidence safely')
        : fail('realtime.productivity_dogfood_tool', 'Realtime productivity dogfood voice tool', `tool execute ${productivityDogfoodTool.status}`, productivityDogfoodTool.data),
    );

    const productivityDogfoodEvidence = await ctx.api('/api/realtime/evidence');
    const productivityDogfoodToolEvidence = productivityDogfoodEvidence.data?.evidence?.productivityDogfoodTools;
    const productivityDogfoodEvents = Array.isArray(productivityDogfoodToolEvidence?.recent) ? productivityDogfoodToolEvidence.recent : [];
    out.push(
      productivityDogfoodEvidence.ok &&
        productivityDogfoodToolEvidence?.hasSavedArchive === true &&
        productivityDogfoodToolEvidence?.hasSafePreview === true &&
        productivityDogfoodToolEvidence?.sendsMessages === false &&
        productivityDogfoodToolEvidence?.mutatesUserFiles === false &&
        productivityDogfoodEvents.some((event) => (
          event.name === 'save_productivity_dogfood_archive' &&
          event.source === 'eval' &&
          event.productivityDogfood?.saved === true &&
          event.productivityDogfood?.previewOnly === true &&
          event.productivityDogfood?.pass === 4
        ))
        ? ok('realtime.productivity_dogfood_tool_evidence', 'Realtime productivity dogfood evidence', 'save_productivity_dogfood_archive is visible in Realtime evidence')
        : fail('realtime.productivity_dogfood_tool_evidence', 'Realtime productivity dogfood evidence', 'expected save_productivity_dogfood_archive to appear in realtime evidence', productivityDogfoodToolEvidence),
    );

    const perceptionTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_perception_consent', arguments: { limit: 5 } },
    });
    const perceptionOutput = parseToolOutput(perceptionTool);
    const perceptionSurfaces = Array.isArray(perceptionOutput?.surfaces) ? perceptionOutput.surfaces : [];
    const perceptionSurfaceIds = new Set(perceptionSurfaces.map((surface) => surface.id));
    const requiredPerceptionSurfaces = [
      'screen_context',
      'voice_microphone',
      'ambient_observer',
      'browser_activity',
      'browser_page_reader',
      'clipboard',
      'accessibility_tree',
      'app_control',
      'local_learning',
      'worker_tools',
    ];
    out.push(
      perceptionTool.ok &&
        perceptionTool.data?.ok === true &&
        perceptionOutput?.ok === true &&
        perceptionOutput.policy?.localOnly === true &&
        perceptionOutput.policy?.passiveByDefault === true &&
        perceptionOutput.policy?.requiresUserIntentForAction === true &&
        requiredPerceptionSurfaces.every((id) => perceptionSurfaceIds.has(id)) &&
        perceptionSurfaces.every((surface) => (
          typeof surface.enabled === 'boolean' &&
          typeof surface.status === 'string' &&
          typeof surface.rawContentStored === 'boolean' &&
          Array.isArray(surface.controls) &&
          Array.isArray(surface.auditTypes)
        ))
        ? ok('realtime.perception_consent_tool', 'Realtime perception consent tool', `${perceptionSurfaces.length} surface(s) · ${perceptionOutput.summary || ''}`)
        : fail('realtime.perception_consent_tool', 'Realtime perception consent tool', `tool execute ${perceptionTool.status}`, perceptionTool.data),
    );

    const screenPrivacyBeforeTool = await ctx.api('/api/screen/privacy');
    const originalScreenPrivacy = screenPrivacyBeforeTool.data?.privacy || {};
    const originalScreenPrivacyRules = Array.isArray(originalScreenPrivacy.rules) ? originalScreenPrivacy.rules : [];
    const screenPrivacyTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_screen_privacy', arguments: { includeRules: true } },
    });
    const screenPrivacyOutput = parseToolOutput(screenPrivacyTool);
    const regionPresetIds = new Set((screenPrivacyOutput?.regionPresets?.presets || []).map((preset) => preset.id));
    const screenRegionPreviewTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'preview_screen_privacy_region_preset',
        arguments: { id: 'notch_band', width: 96, height: 64 },
      },
    });
    const screenRegionPreviewOutput = parseToolOutput(screenRegionPreviewTool);
    const screenRegionApplyTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'apply_screen_privacy_region_preset',
        arguments: { id: 'notch_band' },
      },
    });
    const screenRegionApplyOutput = parseToolOutput(screenRegionApplyTool);
    const screenPrivacyRestore = await ctx.api('/api/screen/privacy', {
      method: 'PUT',
      body: {
        source: 'eval_realtime_screen_privacy_restore',
        mode: originalScreenPrivacy.mode || 'private',
        rules: originalScreenPrivacyRules,
      },
    });
    out.push(
      screenPrivacyTool.ok &&
        screenPrivacyTool.data?.ok === true &&
        screenPrivacyOutput?.ok === true &&
        screenPrivacyOutput?.privacy?.mode &&
        screenPrivacyOutput?.recommendedPreset?.preset?.id === 'sensitive_defaults' &&
        regionPresetIds.has('notch_band') &&
        regionPresetIds.has('top_right_notifications') &&
        screenRegionPreviewTool.ok &&
        screenRegionPreviewTool.data?.ok === true &&
        screenRegionPreviewOutput?.preset?.id === 'notch_band' &&
        screenRegionPreviewOutput?.maskPreview?.preview?.mask?.applied === true &&
        screenRegionApplyTool.ok &&
        screenRegionApplyTool.data?.ok === true &&
        screenRegionApplyOutput?.applied === true &&
        screenRegionApplyOutput?.rule?.id === 'region_preset_notch_band' &&
        screenRegionApplyOutput?.privacy?.enforcement?.regionRendererMask === true &&
        screenPrivacyRestore.ok &&
        JSON.stringify(screenPrivacyRestore.data?.privacy?.rules || []) === JSON.stringify(originalScreenPrivacyRules)
        ? ok('realtime.screen_privacy_tools', 'Realtime screen privacy tools', 'voice tools can read, preview, and apply screen region masks, then restore local privacy rules')
        : fail('realtime.screen_privacy_tools', 'Realtime screen privacy tools', 'screen privacy Realtime tools did not expose or apply expected region preset safely', {
          screenPrivacyTool: screenPrivacyTool.data,
          screenRegionPreviewTool: screenRegionPreviewTool.data,
          screenRegionApplyTool: screenRegionApplyTool.data,
          screenPrivacyRestore: screenPrivacyRestore.data,
        }),
    );

    const learningTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_learning_profile', arguments: { limit: 3 } },
    });
    const learningOutput = parseToolOutput(learningTool);
    out.push(
      learningTool.ok &&
        learningTool.data?.ok === true &&
        learningOutput?.ok === true &&
        typeof learningOutput.spokenSummary === 'string' &&
        learningOutput.privacy?.localOnly === true &&
        learningOutput.privacy?.modelFreeDistillation === true &&
        learningOutput.privacy?.inferredNotExplicitMemory === true &&
        learningOutput.privacy?.noRawScreenshots === true &&
        learningOutput.privacy?.noClipboardText === true &&
        learningOutput.privacy?.noPageBodies === true &&
        learningOutput.privacy?.noPermissionGrant === true &&
        typeof learningOutput.profile?.sourceEventCount === 'number' &&
        Array.isArray(learningOutput.profile?.signals)
        ? ok('realtime.learning_profile_tool', 'Realtime local learning profile tool', `${learningOutput.profile.sourceEventCount} source event(s) · ${learningOutput.spokenSummary}`)
        : fail('realtime.learning_profile_tool', 'Realtime local learning profile tool', `tool execute ${learningTool.status}`, learningTool.data),
    );

    const learningEvolutionTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_learning_evolution', arguments: { recentLimit: 8, baselineLimit: 24 } },
    });
    const learningEvolutionOutput = parseToolOutput(learningEvolutionTool);
    out.push(
      learningEvolutionTool.ok &&
        learningEvolutionTool.data?.ok === true &&
        learningEvolutionOutput?.ok === true &&
        typeof learningEvolutionOutput.spokenSummary === 'string' &&
        Array.isArray(learningEvolutionOutput.changes) &&
        learningEvolutionOutput.windows?.recent &&
        learningEvolutionOutput.windows?.baseline &&
        learningEvolutionOutput.privacy?.localOnly === true &&
        learningEvolutionOutput.privacy?.metadataOnly === true &&
        learningEvolutionOutput.privacy?.modelFreeDistillation === true &&
        learningEvolutionOutput.privacy?.inferredNotExplicitMemory === true &&
        learningEvolutionOutput.privacy?.noRawScreenshots === true &&
        learningEvolutionOutput.privacy?.noClipboardText === true &&
        learningEvolutionOutput.privacy?.noPageBodies === true &&
        learningEvolutionOutput.privacy?.noPermissionGrant === true
        ? ok('realtime.learning_evolution_tool', 'Realtime local learning evolution tool', `${learningEvolutionOutput.windows.recent.count || 0} recent · ${learningEvolutionOutput.windows.baseline.count || 0} baseline · ${learningEvolutionOutput.spokenSummary}`)
        : fail('realtime.learning_evolution_tool', 'Realtime local learning evolution tool', `tool execute ${learningEvolutionTool.status}`, learningEvolutionTool.data),
    );

    const learningEvidence = await ctx.api('/api/realtime/evidence');
    const learningToolEvidence = learningEvidence.data?.evidence?.learningTools;
    const learningToolEvents = Array.isArray(learningToolEvidence?.recent) ? learningToolEvidence.recent : [];
    out.push(
      learningEvidence.ok &&
        learningToolEvidence?.hasLearningProfile === true &&
        learningToolEvidence?.hasLearningEvolution === true &&
        learningToolEvidence?.privacySafe === true &&
        learningToolEvents.some((event) => (
          event.name === 'get_learning_profile' &&
          event.source === 'eval' &&
          event.learning?.localOnly === true &&
          event.learning?.noRawScreenshots === true &&
          event.learning?.noClipboardText === true &&
            event.learning?.noPageBodies === true &&
            event.learning?.noPermissionGrant === true
        )) &&
        learningToolEvents.some((event) => (
          event.name === 'get_learning_evolution' &&
            event.source === 'eval' &&
            event.learning?.hasEvolution === true &&
            event.learning?.localOnly === true &&
            event.learning?.noRawScreenshots === true &&
            event.learning?.noClipboardText === true &&
            event.learning?.noPageBodies === true &&
            event.learning?.noPermissionGrant === true
        ))
        ? ok('realtime.learning_profile_tool_evidence', 'Realtime local learning tool evidence', 'get_learning_profile and get_learning_evolution are visible in privacy-safe Realtime evidence')
        : fail('realtime.learning_profile_tool_evidence', 'Realtime local learning profile tool evidence', 'expected get_learning_profile to appear in realtime evidence', learningToolEvidence),
    );

    const capabilityApi = await ctx.api('/api/capabilities?query=browser&includeNext=false');
    const capabilityApiOutput = capabilityApi.data?.capabilities;
    out.push(
      capabilityApi.ok &&
        capabilityApiOutput?.ok === true &&
        capabilityApiOutput?.next === null &&
        capabilityApiOutput?.controlMode?.mode &&
        Array.isArray(capabilityApiOutput.capabilities) &&
        capabilityApiOutput.capabilities.some((item) => item.id === 'browser' && item.recommendedTools?.includes('run_browser_workflow')) &&
        Array.isArray(capabilityApiOutput.guardrails) &&
        capabilityApiOutput.guardrails.some((item) => /confirmation/i.test(item))
        ? ok('realtime.local_capabilities_api', 'Realtime local capability API', `${capabilityApiOutput.capabilities.length} matched capability row(s)`)
        : fail('realtime.local_capabilities_api', 'Realtime local capability API', `GET /api/capabilities ${capabilityApi.status}`, capabilityApi.data),
    );

    const capabilityTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'get_local_capabilities',
        arguments: { query: 'browser', includeNext: false },
      },
    });
    const capabilityToolOutput = parseToolOutput(capabilityTool);
    out.push(
      capabilityTool.ok &&
        capabilityTool.data?.ok === true &&
        capabilityToolOutput?.ok === true &&
        capabilityToolOutput?.next === null &&
        capabilityToolOutput?.policy &&
        capabilityToolOutput?.controlMode?.mode &&
        typeof capabilityToolOutput.spokenSummary === 'string' &&
        Array.isArray(capabilityToolOutput.recommendedStart) &&
        capabilityToolOutput.recommendedStart.some((item) => item.tool === 'route_task') &&
        Array.isArray(capabilityToolOutput.capabilities) &&
        capabilityToolOutput.capabilities.some((item) => item.id === 'browser' && item.recommendedTools?.includes('read_browser_page'))
        ? ok('realtime.local_capabilities_tool', 'Realtime local capability voice tool', `${capabilityToolOutput.spokenSummary}`)
        : fail('realtime.local_capabilities_tool', 'Realtime local capability voice tool', `tool execute ${capabilityTool.status}`, capabilityTool.data),
    );

    const capabilityEvidence = await ctx.api('/api/realtime/evidence');
    const capabilityToolEvidence = capabilityEvidence.data?.evidence?.capabilityTools;
    const capabilityToolEvents = Array.isArray(capabilityToolEvidence?.recent) ? capabilityToolEvidence.recent : [];
    out.push(
      capabilityEvidence.ok &&
        capabilityToolEvidence?.hasCapabilityMap === true &&
        capabilityToolEvidence?.hasRecommendedTools === true &&
        capabilityToolEvidence?.hasLocalExecutionState === true &&
        capabilityToolEvents.some((event) => (
          event.name === 'get_local_capabilities' &&
          event.source === 'eval' &&
          event.capability?.hasCapabilityMap === true &&
          event.capability?.recommendedTools?.includes('run_browser_workflow')
        ))
        ? ok('realtime.local_capabilities_tool_evidence', 'Realtime local capability voice tool evidence', 'get_local_capabilities is visible in Realtime evidence')
        : fail('realtime.local_capabilities_tool_evidence', 'Realtime local capability voice tool evidence', 'expected get_local_capabilities to appear in realtime evidence', capabilityToolEvidence),
    );

    try {
      const capabilitiesCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-capabilities', '--query', 'browser'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${capabilitiesCui.stdout || ''}\n${capabilitiesCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Local Capabilities') &&
          output.includes('Control:') &&
          output.includes('Guardrails:') &&
          output.includes('Recommended start tools:') &&
          output.includes('browser') &&
          output.includes('run_browser_workflow')
          ? ok('realtime.local_capabilities_cui', 'Realtime local capability CUI', 'config CUI prints the local capability map')
          : fail('realtime.local_capabilities_cui', 'Realtime local capability CUI', 'expected config CUI to print capability map details', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.local_capabilities_cui', 'Realtime local capability CUI', error instanceof Error ? error.message : String(error)));
    }

    let realtimeDemoId = '';
    const existingDemos = await ctx.api('/api/demonstrations?limit=1');
    let activeDemo = existingDemos.data?.demonstrations?.active || null;
    const activeDemoIsEvalArtifact =
      activeDemo &&
      activeDemo.title === 'Eval Realtime UI demonstration' &&
      activeDemo.goal === 'Verify Realtime Record and Replay tool evidence';
    if (activeDemoIsEvalArtifact) {
      await ctx.api(`/api/demonstrations/${encodeURIComponent(activeDemo.id)}`, {
        method: 'DELETE',
        body: { source: 'eval_stale_recording_cleanup' },
      });
      activeDemo = null;
    }
    if (activeDemo && activeDemo.source !== 'eval') {
      out.push(warn(
        'realtime.demonstration_tool_flow',
        'Realtime UI demonstration tool flow',
        `skipped because a user demonstration is already recording: ${activeDemo.title || activeDemo.id}`,
      ));
    } else {
      try {
        const demoStart = await ctx.api('/api/tools/execute', {
          method: 'POST',
          body: {
            source: 'eval',
            name: 'start_ui_demonstration',
            arguments: {
              title: 'Eval Realtime UI demonstration',
              goal: 'Verify Realtime Record and Replay tool evidence',
              captureInitial: false,
            },
          },
        });
        const demoStartOutput = parseToolOutput(demoStart);
        realtimeDemoId = demoStartOutput?.demonstration?.id || '';
        const demoCapture = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'capture_ui_demonstration_step',
              arguments: {
                demonstrationId: realtimeDemoId,
                instruction: 'Open the repeatable panel and confirm the saved state',
                observation: {
                  frontmost: { app: 'EvalApp', windowTitle: 'Realtime Demo Window', available: true },
                  browser: { available: false },
                  screen: { width: 1200, height: 800, privacyMode: 'private', source: 'eval' },
                  accessibility: { available: true, app: 'EvalApp', windowTitle: 'Realtime Demo Window', nodeCount: 1, outline: '1 AXButton "Confirm"' },
                },
              },
            },
          })
          : { ok: false, data: {} };
        const demoCaptureOutput = parseToolOutput(demoCapture);
        const demoFinish = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'finish_ui_demonstration',
              arguments: { demonstrationId: realtimeDemoId },
            },
          })
          : { ok: false, data: {} };
        const demoFinishOutput = parseToolOutput(demoFinish);
        const demoList = await ctx.api('/api/tools/execute', {
          method: 'POST',
          body: {
            source: 'eval',
            name: 'get_ui_demonstrations',
            arguments: { status: 'done', limit: 5 },
          },
        });
        const demoListOutput = parseToolOutput(demoList);
        const demoReplayPlan = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'plan_ui_demonstration_replay',
              arguments: { demonstrationId: realtimeDemoId, instruction: 'Prepare safe replay only' },
            },
          })
          : { ok: false, data: {} };
        const demoReplayPlanOutput = parseToolOutput(demoReplayPlan);
        const demoReplayBlocked = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'run_ui_demonstration_replay',
              arguments: { demonstrationId: realtimeDemoId, instruction: 'Attempt replay without confirmation' },
            },
          })
          : { ok: false, data: {} };
        const demoReplayBlockedOutput = parseToolOutput(demoReplayBlocked);
        const demoSkillDraft = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'draft_ui_demonstration_skill',
              arguments: { demonstrationId: realtimeDemoId, title: 'Eval Realtime demonstrated workflow skill' },
            },
          })
          : { ok: false, data: {} };
        const demoSkillDraftOutput = parseToolOutput(demoSkillDraft);
        const demoSkillSaveBlocked = realtimeDemoId
          ? await ctx.api('/api/tools/execute', {
            method: 'POST',
            body: {
              source: 'eval',
              name: 'save_ui_demonstration_skill',
              arguments: { demonstrationId: realtimeDemoId, title: 'Eval Realtime demonstrated workflow skill' },
            },
          })
          : { ok: false, data: {} };
        const demoSkillSaveBlockedOutput = parseToolOutput(demoSkillSaveBlocked);

        out.push(
          demoStart.ok &&
            demoStart.data?.ok === true &&
            realtimeDemoId &&
            demoCapture.ok &&
            demoCapture.data?.ok === true &&
            demoCaptureOutput?.step?.id &&
            demoFinish.ok &&
            demoFinish.data?.ok === true &&
            demoFinishOutput?.demonstration?.status === 'done' &&
            demoList.ok &&
            Array.isArray(demoListOutput?.recent) &&
            demoReplayPlan.ok &&
            demoReplayPlan.data?.ok === true &&
            demoReplayPlanOutput?.replayMode === 'safe_preview' &&
            demoReplayPlanOutput?.execute === false &&
            demoReplayPlanOutput?.safety?.reobserveBeforeActing === true &&
            demoReplayPlanOutput?.safety?.noCoordinates === true &&
            demoReplayBlocked.ok &&
            demoReplayBlocked.data?.ok === false &&
            demoReplayBlockedOutput?.confirmationRequired === true &&
            demoSkillDraft.ok &&
            demoSkillDraft.data?.ok === true &&
            demoSkillDraftOutput?.recordReplayInspired === true &&
            String(demoSkillDraftOutput?.skill?.markdown || '').includes('# Replay Plan') &&
            demoSkillSaveBlocked.ok &&
            demoSkillSaveBlocked.data?.ok === false &&
            demoSkillSaveBlockedOutput?.requiresConfirmation === true
            ? ok('realtime.demonstration_tool_flow', 'Realtime UI demonstration tool flow', `${realtimeDemoId} · replay preview + skill draft + confirmation gate`)
            : fail('realtime.demonstration_tool_flow', 'Realtime UI demonstration tool flow', 'expected Record & Replay tool sequence with safe replay and save confirmation gate', {
              start: demoStart.data,
              capture: demoCapture.data,
              finish: demoFinish.data,
              replay: demoReplayPlan.data,
              blocked: demoReplayBlocked.data,
              draft: demoSkillDraft.data,
              save: demoSkillSaveBlocked.data,
            }),
        );

        const demoEvidence = await ctx.api('/api/realtime/evidence');
        const demoToolEvidence = demoEvidence.data?.evidence?.demonstrationTools;
        const demoToolEvents = Array.isArray(demoToolEvidence?.recent) ? demoToolEvidence.recent : [];
        out.push(
          demoEvidence.ok &&
            demoToolEvidence?.hasSafeReplayPlan === true &&
            demoToolEvidence?.hasDraft === true &&
            demoToolEvidence?.hasConfirmationGate === true &&
            demoToolEvidence?.localOnly === true &&
            demoToolEvidence?.noRawStored === true &&
            demoToolEvents.some((event) => event.name === 'plan_ui_demonstration_replay' && event.source === 'eval' && event.demonstration?.previewOnly === true && event.demonstration?.reobserveBeforeActing === true) &&
            demoToolEvents.some((event) => event.name === 'draft_ui_demonstration_skill' && event.source === 'eval' && event.demonstration?.recordReplayInspired === true) &&
            demoToolEvents.some((event) => event.name === 'save_ui_demonstration_skill' && event.source === 'eval' && event.demonstration?.requiresConfirmation === true)
            ? ok('realtime.demonstration_tool_evidence', 'Realtime UI demonstration tool evidence', `actions=${(demoToolEvidence.observedActions || []).join(', ')}`)
            : fail('realtime.demonstration_tool_evidence', 'Realtime UI demonstration tool evidence', 'expected UI demonstration calls to be visible in realtime evidence', demoToolEvidence),
        );
      } finally {
        if (realtimeDemoId) {
          await ctx.api(`/api/demonstrations/${encodeURIComponent(realtimeDemoId)}`, {
            method: 'DELETE',
            body: { source: 'eval_cleanup' },
          });
        }
      }
    }

    const workerRecoveryTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_worker_recovery', arguments: { limit: 5, includeInternal: true } },
    });
    const workerRecoveryOutput = parseToolOutput(workerRecoveryTool);
    out.push(
      workerRecoveryTool.ok &&
        workerRecoveryTool.data?.ok === true &&
        workerRecoveryOutput?.ok === true &&
        workerRecoveryOutput?.counts &&
        typeof workerRecoveryOutput.counts.recoverable === 'number' &&
        Array.isArray(workerRecoveryOutput.items) &&
        typeof workerRecoveryOutput.summary === 'string' &&
        typeof workerRecoveryOutput.nextAction === 'string'
        ? ok('realtime.worker_recovery_tool', 'Realtime worker recovery tool', `${workerRecoveryOutput.counts.recoverable} recoverable failed job(s)`)
        : fail('realtime.worker_recovery_tool', 'Realtime worker recovery tool', `tool execute ${workerRecoveryTool.status}`, workerRecoveryTool.data),
    );

    const inboxTriageTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'triage_inbox', arguments: { limit: 5 } },
    });
    const inboxTriageOutput = parseToolOutput(inboxTriageTool);
    out.push(
      inboxTriageTool.ok &&
        inboxTriageTool.data?.ok === true &&
        inboxTriageOutput?.ok === true &&
        inboxTriageOutput.groups &&
        Array.isArray(inboxTriageOutput.groups.byLane) &&
        Array.isArray(inboxTriageOutput.groups.bySource) &&
        inboxTriageOutput.confirmationPolicy?.requiresExplicitUserIntent === true &&
        typeof inboxTriageOutput.spokenSummary === 'string'
        ? ok('realtime.inbox_triage_tool', 'Realtime Inbox triage tool', `open=${inboxTriageOutput.counts?.open || 0} · groups=${inboxTriageOutput.groups.byLane.length}`)
        : fail('realtime.inbox_triage_tool', 'Realtime Inbox triage tool', `tool execute ${inboxTriageTool.status}`, inboxTriageTool.data),
    );

    const attentionTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_attention_policy', arguments: {} },
    });
    const attentionOutput = parseToolOutput(attentionTool);
    out.push(
      attentionTool.ok &&
        attentionTool.data?.ok === true &&
        attentionOutput?.ok === true &&
        ['quiet', 'watching', 'waiting', 'notify'].includes(attentionOutput.level) &&
        typeof attentionOutput.shouldNotify === 'boolean' &&
        typeof attentionOutput.petState === 'string' &&
        attentionOutput.cooldown &&
        typeof attentionOutput.cooldown.remainingMs === 'number' &&
        Array.isArray(attentionOutput.reasons)
        ? ok('realtime.attention_policy_tool', 'Realtime attention policy tool', `${attentionOutput.level} · pet=${attentionOutput.petState}`)
        : fail('realtime.attention_policy_tool', 'Realtime attention policy tool', `tool execute ${attentionTool.status}`, attentionTool.data),
    );

    const attentionExplanationTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_attention_explanation', arguments: { limit: 3 } },
    });
    const attentionExplanationOutput = parseToolOutput(attentionExplanationTool);
    out.push(
      attentionExplanationTool.ok &&
        attentionExplanationTool.data?.ok === true &&
        attentionExplanationOutput?.ok === true &&
        typeof attentionExplanationOutput.spokenSummary === 'string' &&
        attentionExplanationOutput.spokenSummary.length > 0 &&
        attentionExplanationOutput.spokenSummary.length <= 420 &&
        attentionExplanationOutput.policy?.ok === true &&
        attentionExplanationOutput.history?.operatorOnly === true &&
        attentionExplanationOutput.history?.desktopPet === false &&
        attentionExplanationOutput.guidance?.desktopPetStillMinimal === true
        ? ok('realtime.attention_explanation_tool', 'Realtime attention explanation tool', attentionExplanationOutput.spokenSummary)
        : fail('realtime.attention_explanation_tool', 'Realtime attention explanation tool', `tool execute ${attentionExplanationTool.status}`, attentionExplanationTool.data),
    );

    const attentionEvidence = await ctx.api('/api/realtime/evidence');
    const attentionToolEvidence = attentionEvidence.data?.evidence?.attentionTools;
    const attentionToolEvents = Array.isArray(attentionToolEvidence?.recent) ? attentionToolEvidence.recent : [];
    out.push(
      attentionEvidence.ok &&
        attentionToolEvidence?.hasExplanation === true &&
        attentionToolEvents.some((event) => event.name === 'get_attention_explanation' && event.source === 'eval' && event.attention?.spokenSummary && event.attention?.desktopPetStillMinimal === true)
        ? ok('realtime.attention_tool_evidence', 'Realtime attention tool evidence', `${attentionToolEvidence.count || 0} attention explanation call(s) visible`)
        : fail('realtime.attention_tool_evidence', 'Realtime attention tool evidence', 'expected get_attention_explanation calls to be visible in realtime evidence', attentionToolEvidence),
    );

    const perceptionEvidence = await ctx.api('/api/realtime/evidence');
    const perceptionToolEvidence = perceptionEvidence.data?.evidence?.perceptionTools;
    const perceptionToolEvents = Array.isArray(perceptionToolEvidence?.recent) ? perceptionToolEvidence.recent : [];
    out.push(
      perceptionEvidence.ok &&
        perceptionToolEvidence?.hasConsent === true &&
        perceptionToolEvents.some((event) => (
          event.name === 'get_perception_consent' &&
          event.source === 'eval' &&
          event.perception?.surfaceCount >= 8 &&
          event.perception?.localOnly === true &&
          event.perception?.requiresUserIntentForAction === true &&
          event.perception?.desktopPetStillMinimal === true
        ))
        ? ok('realtime.perception_tool_evidence', 'Realtime perception tool evidence', `${perceptionToolEvidence.count || 0} perception consent call(s) visible`)
        : fail('realtime.perception_tool_evidence', 'Realtime perception tool evidence', 'expected get_perception_consent calls to be visible in realtime evidence', perceptionToolEvidence),
    );

    const autopilotStatusTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: { source: 'eval', name: 'get_autopilot_status', arguments: { workflowLimit: 6, jobLimit: 6 } },
    });
    const autopilotStatusOutput = parseToolOutput(autopilotStatusTool);
    out.push(
      autopilotStatusTool.ok &&
        autopilotStatusTool.data?.ok === true &&
        autopilotStatusOutput?.ok === true &&
        typeof autopilotStatusOutput.spokenSummary === 'string' &&
        typeof autopilotStatusOutput.skipSummary === 'string' &&
        typeof autopilotStatusOutput.nextWait === 'string' &&
        typeof autopilotStatusOutput.canActNow === 'boolean' &&
        autopilotStatusOutput.candidateCounts &&
        typeof autopilotStatusOutput.candidateCounts.total === 'number' &&
        typeof autopilotStatusOutput.candidateCounts.autoExecutable === 'number' &&
        Array.isArray(autopilotStatusOutput.waitingFor) &&
        autopilotStatusOutput.decisionPreview &&
        Array.isArray(autopilotStatusOutput.candidates) &&
        autopilotStatusOutput.candidates.every((candidate) => candidate.id && candidate.decision && typeof candidate.decision.reason === 'string')
        ? ok('realtime.autopilot_status_tool', 'Realtime autopilot status tool', `${autopilotStatusOutput.canActNow ? 'ready' : 'waiting'} · ${autopilotStatusOutput.reason || autopilotStatusOutput.nextWait} · ${autopilotStatusOutput.candidateCounts.autoExecutable} auto/${autopilotStatusOutput.candidateCounts.total}`)
        : fail('realtime.autopilot_status_tool', 'Realtime autopilot status tool', `tool execute ${autopilotStatusTool.status}`, autopilotStatusTool.data),
    );

    const autopilotEvidence = await ctx.api('/api/realtime/evidence');
    const autopilotToolEvidence = autopilotEvidence.data?.evidence?.autopilotTools;
    const autopilotToolEvents = Array.isArray(autopilotToolEvidence?.recent) ? autopilotToolEvidence.recent : [];
    out.push(
        autopilotEvidence.ok &&
        autopilotToolEvidence?.hasStatus === true &&
        autopilotToolEvents.some((event) => event.name === 'get_autopilot_status' && event.source === 'eval' && event.autopilot?.spokenSummary && typeof event.autopilot.firstWaitingFor === 'string' && typeof event.autopilot.autoExecutableCount === 'number')
        ? ok('realtime.autopilot_tool_evidence', 'Realtime autopilot tool evidence', `${autopilotToolEvidence.count || 0} autopilot status call(s) visible`)
        : fail('realtime.autopilot_tool_evidence', 'Realtime autopilot tool evidence', 'expected get_autopilot_status calls to be visible in realtime evidence', autopilotToolEvidence),
    );

    const realtimeEvidenceTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'get_realtime_evidence',
        arguments: { includeChecklist: true, includeRecentTools: true, promptLimit: 2 },
      },
    });
    const realtimeEvidenceOutput = parseToolOutput(realtimeEvidenceTool);
    const realtimeEvidenceChecklistIds = new Set((realtimeEvidenceOutput?.checklist || []).map((step) => step.id));
    out.push(
      realtimeEvidenceTool.ok &&
        realtimeEvidenceTool.data?.ok === true &&
        realtimeEvidenceOutput?.ok === true &&
        ['ready', 'pending', 'blocked'].includes(realtimeEvidenceOutput.status) &&
        typeof realtimeEvidenceOutput.phase === 'string' &&
        typeof realtimeEvidenceOutput.summary === 'string' &&
        typeof realtimeEvidenceOutput.nextAction === 'string' &&
        realtimeEvidenceOutput.voiceHealth?.hasOpenAiKey === true &&
        ['providerReady', 'sessionNegotiated', 'voiceSessionLive', 'progressInjectedFromRenderer', 'passiveContextOnly', 'spokenSummaryReady'].every((key) => typeof realtimeEvidenceOutput.checks?.[key] === 'boolean') &&
        realtimeEvidenceChecklistIds.has('session_negotiated') &&
        realtimeEvidenceChecklistIds.has('voice_session_live') &&
        realtimeEvidenceChecklistIds.has('worker_progress_injected') &&
        realtimeEvidenceOutput.dogfood?.monitor?.endpoint === '/api/realtime/evidence' &&
        Array.isArray(realtimeEvidenceOutput.dogfood?.prompts) &&
        realtimeEvidenceOutput.voiceLatency &&
        typeof realtimeEvidenceOutput.voiceLatency.nextAction === 'string' &&
        realtimeEvidenceOutput.tools?.handoff &&
        realtimeEvidenceOutput.tools?.autopilot &&
        realtimeEvidenceOutput.tools?.shortcuts &&
        realtimeEvidenceOutput.tools?.dogfoodSession &&
        realtimeEvidenceOutput.tools?.attention &&
        realtimeEvidenceOutput.tools?.perception &&
        realtimeEvidenceOutput.tools?.capabilities &&
        realtimeEvidenceOutput.tools?.learning &&
        realtimeEvidenceOutput.tools?.browser
        ? ok('realtime.evidence_tool', 'Realtime evidence voice tool', `${realtimeEvidenceOutput.status}/${realtimeEvidenceOutput.phase} · ${realtimeEvidenceOutput.nextAction}`)
        : fail('realtime.evidence_tool', 'Realtime evidence voice tool', `tool execute ${realtimeEvidenceTool.status}`, realtimeEvidenceTool.data),
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

    const handoffTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'get_work_handoff',
        arguments: { maxChars: 500, nextLimit: 2, followUpLimit: 2 },
      },
    });
    const handoffOutput = parseToolOutput(handoffTool);
    out.push(
      handoffTool.ok &&
        handoffTool.data?.ok === true &&
        typeof handoffOutput?.spokenSummary === 'string' &&
        handoffOutput.spokenSummary.trim().length > 0 &&
        handoffOutput.spokenSummary.length <= 500
        ? ok('realtime.handoff_tool', 'Realtime work handoff tool', handoffOutput.spokenSummary)
        : fail('realtime.handoff_tool', 'Realtime work handoff tool', `tool execute ${handoffTool.status}`, handoffTool.data),
    );

    const handoffEvidence = await ctx.api('/api/realtime/evidence');
    const handoffToolEvidence = handoffEvidence.data?.evidence?.handoffTools;
    const handoffToolEvents = Array.isArray(handoffToolEvidence?.recent) ? handoffToolEvidence.recent : [];
    out.push(
      handoffEvidence.ok &&
        handoffToolEvidence?.hasHandoff === true &&
        handoffToolEvents.some((event) => event.name === 'get_work_handoff' && event.source === 'eval' && event.handoff?.spokenSummary)
        ? ok('realtime.handoff_tool_evidence', 'Realtime handoff tool evidence', `${handoffToolEvidence.count || 0} handoff call(s) visible`)
        : fail('realtime.handoff_tool_evidence', 'Realtime handoff tool evidence', 'expected get_work_handoff calls to be visible in realtime evidence', handoffToolEvidence),
    );

    const dogfoodSessionTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'get_realtime_dogfood_session',
        arguments: { limit: 3 },
      },
    });
    const dogfoodSessionOutput = parseToolOutput(dogfoodSessionTool);
    out.push(
      dogfoodSessionTool.ok &&
        dogfoodSessionTool.data?.ok === true &&
        dogfoodSessionOutput?.manualOnly === true &&
        dogfoodSessionOutput?.startsMicrophone === false &&
        dogfoodSessionOutput?.prompt?.startsMicrophone === false &&
        typeof dogfoodSessionOutput?.prompt?.copyText === 'string'
        ? ok('realtime.dogfood_session_tool_snapshot', 'Realtime dogfood session voice tool snapshot', `${dogfoodSessionOutput.counts?.active || 0} active session(s)`)
        : fail('realtime.dogfood_session_tool_snapshot', 'Realtime dogfood session voice tool snapshot', `tool execute ${dogfoodSessionTool.status}`, dogfoodSessionTool.data),
    );

    const dogfoodSessionStartTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'start_realtime_dogfood_session',
        arguments: {
          title: 'Eval realtime voice dogfood tool session',
          allowConcurrent: true,
        },
      },
    });
    const dogfoodSessionStartOutput = parseToolOutput(dogfoodSessionStartTool);
    const dogfoodToolSession = dogfoodSessionStartOutput?.session;
    const dogfoodToolSessionId = dogfoodToolSession?.id || '';
    const dogfoodToolStepId = dogfoodToolSession?.steps?.find((step) => step.id === 'open_monitor')?.id || dogfoodToolSession?.steps?.[0]?.id || '';
    out.push(
      dogfoodSessionStartTool.ok &&
        dogfoodSessionStartTool.data?.ok === true &&
        dogfoodSessionStartOutput?.ok === true &&
        dogfoodSessionStartOutput?.manualOnly === true &&
        dogfoodSessionStartOutput?.startsMicrophone === false &&
        dogfoodToolSession?.status === 'active' &&
        dogfoodToolSession?.manualOnly === true &&
        dogfoodToolSession?.startsMicrophone === false &&
        dogfoodToolSessionId &&
        dogfoodToolStepId
        ? ok('realtime.dogfood_session_tool_start', 'Realtime dogfood session voice tool start', `${dogfoodToolSessionId} · ${dogfoodToolSession.counts?.operatorDone || 0}/${dogfoodToolSession.counts?.total || 0} operator done`)
        : fail('realtime.dogfood_session_tool_start', 'Realtime dogfood session voice tool start', 'expected voice tool to start a manual operator session without starting microphone capture', dogfoodSessionStartTool.data),
    );

    if (dogfoodToolSessionId && dogfoodToolStepId) {
      const dogfoodSessionMarkTool = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'mark_realtime_dogfood_step',
          arguments: {
            sessionId: dogfoodToolSessionId,
            stepId: dogfoodToolStepId,
            status: 'done',
            note: 'Eval marked this voice-tool dogfood step without starting microphone capture.',
          },
        },
      });
      const dogfoodSessionMarkOutput = parseToolOutput(dogfoodSessionMarkTool);
      out.push(
        dogfoodSessionMarkTool.ok &&
          dogfoodSessionMarkTool.data?.ok === true &&
          dogfoodSessionMarkOutput?.ok === true &&
          dogfoodSessionMarkOutput?.startsMicrophone === false &&
          dogfoodSessionMarkOutput?.step?.id === dogfoodToolStepId &&
          dogfoodSessionMarkOutput?.step?.operatorDone === true
          ? ok('realtime.dogfood_session_tool_mark', 'Realtime dogfood session voice tool mark', `${dogfoodToolStepId} marked done`)
          : fail('realtime.dogfood_session_tool_mark', 'Realtime dogfood session voice tool mark', 'expected voice tool to mark a dogfood step', dogfoodSessionMarkTool.data),
      );

      const dogfoodSessionEndTool = await ctx.api('/api/tools/execute', {
        method: 'POST',
        body: {
          source: 'eval',
          name: 'end_realtime_dogfood_session',
          arguments: {
            sessionId: dogfoodToolSessionId,
            status: 'cancelled',
            note: 'Eval cleanup.',
          },
        },
      });
      const dogfoodSessionEndOutput = parseToolOutput(dogfoodSessionEndTool);
      out.push(
        dogfoodSessionEndTool.ok &&
          dogfoodSessionEndTool.data?.ok === true &&
          dogfoodSessionEndOutput?.ok === true &&
          dogfoodSessionEndOutput?.startsMicrophone === false &&
          dogfoodSessionEndOutput?.session?.id === dogfoodToolSessionId &&
          dogfoodSessionEndOutput?.session?.status === 'cancelled'
          ? ok('realtime.dogfood_session_tool_end', 'Realtime dogfood session voice tool end', `${dogfoodToolSessionId} cleaned up`)
          : fail('realtime.dogfood_session_tool_end', 'Realtime dogfood session voice tool end', 'expected voice tool to end the operator session', dogfoodSessionEndTool.data),
      );
    } else {
      out.push(fail('realtime.dogfood_session_tool_mark', 'Realtime dogfood session voice tool mark', 'session voice tool start did not return a markable step', dogfoodSessionStartTool.data));
      out.push(fail('realtime.dogfood_session_tool_end', 'Realtime dogfood session voice tool end', 'session voice tool start did not return an id to clean up', dogfoodSessionStartTool.data));
    }

    const dogfoodSessionEvidence = await ctx.api('/api/realtime/evidence');
    const dogfoodSessionToolEvidence = dogfoodSessionEvidence.data?.evidence?.dogfoodSessionTools;
    const dogfoodSessionToolEvents = Array.isArray(dogfoodSessionToolEvidence?.recent) ? dogfoodSessionToolEvidence.recent : [];
    out.push(
      dogfoodSessionEvidence.ok &&
        dogfoodSessionToolEvidence?.hasSnapshot === true &&
        dogfoodSessionToolEvidence?.hasStart === true &&
        dogfoodSessionToolEvidence?.hasMark === true &&
        dogfoodSessionToolEvidence?.hasEnd === true &&
        dogfoodSessionToolEvidence?.startsMicrophone === false &&
        dogfoodSessionToolEvents.some((event) => event.name === 'start_realtime_dogfood_session' && event.source === 'eval' && event.dogfoodSession?.sessionId) &&
        dogfoodSessionToolEvents.some((event) => event.name === 'mark_realtime_dogfood_step' && event.source === 'eval' && event.dogfoodSession?.stepOperatorDone === true) &&
        dogfoodSessionToolEvents.some((event) => event.name === 'end_realtime_dogfood_session' && event.source === 'eval' && event.dogfoodSession?.sessionStatus === 'cancelled')
        ? ok('realtime.dogfood_session_tool_evidence', 'Realtime dogfood session voice tool evidence', `actions=${(dogfoodSessionToolEvidence.observedActions || []).join(', ')}`)
        : fail('realtime.dogfood_session_tool_evidence', 'Realtime dogfood session voice tool evidence', 'expected dogfood session voice tool calls to be visible in realtime evidence', dogfoodSessionToolEvidence),
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
          output.includes('Dogfood session tools:') &&
          output.includes('Handoff tool:') &&
          output.includes('Autopilot tool:') &&
          output.includes('Attention explanation tool:') &&
          output.includes('Perception consent tool:') &&
          output.includes('Local capability tool:') &&
          output.includes('Local learning tool:') &&
          output.includes('Browser tools:') &&
          output.includes('UI demonstration tools:') &&
          output.includes('Dogfood drill:') &&
          output.includes('Latency:') &&
          output.includes('Recent realtime tool calls:') &&
          output.includes('- sync ') &&
          output.includes('confirm_required') &&
          output.includes('save') &&
          output.includes('forget') &&
          output.includes('called=yes') &&
          output.includes('get_realtime_dogfood_session') &&
          output.includes('start_realtime_dogfood_session') &&
          output.includes('no-mic') &&
          output.includes('get_work_handoff') &&
          output.includes('get_autopilot_status') &&
          output.includes('get_attention_explanation') &&
          output.includes('get_perception_consent') &&
          output.includes('get_local_capabilities') &&
          output.includes('get_learning_profile') &&
          output.includes('get_learning_evolution') &&
          output.includes('run_browser_workflow') &&
          output.includes('draft_ui_demonstration_skill')
          ? ok('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', 'config CUI prints shortcut, dogfood-session, handoff, autopilot, attention, perception, capability, learning, browser, UI demonstration, tool-call, and progress sync evidence')
          : fail('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', 'expected config CUI to print shortcut, dogfood-session, handoff, autopilot, attention, perception, capability, learning, browser, UI demonstration, tool-call, and progress sync evidence', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_tool_evidence', 'Realtime CUI tool evidence', error instanceof Error ? error.message : String(error)));
    }

    try {
      const promptCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-dogfood-prompt'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${promptCui.stdout || ''}\n${promptCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Realtime Dogfood Prompt') &&
          output.includes('starts microphone=no') &&
          output.includes('/api/realtime/evidence') &&
          output.includes('Next:')
          ? ok('realtime.cui_dogfood_prompt', 'Realtime CUI dogfood prompt', 'config CUI prints the next manual dogfood prompt without starting voice')
          : fail('realtime.cui_dogfood_prompt', 'Realtime CUI dogfood prompt', 'expected config CUI to print the next dogfood prompt and evidence endpoint', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_dogfood_prompt', 'Realtime CUI dogfood prompt', error instanceof Error ? error.message : String(error)));
    }

    try {
      const sessionCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-dogfood-session'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${sessionCui.stdout || ''}\n${sessionCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Realtime Dogfood Session') &&
          output.includes('starts microphone=no') &&
          output.includes('Evidence sync: auto=yes') &&
          output.includes('Next prompt:') &&
          output.includes('npm run config -> V. Watch Realtime voice evidence')
          ? ok('realtime.cui_dogfood_session', 'Realtime CUI dogfood session', 'config CUI prints the manual dogfood session tracker')
          : fail('realtime.cui_dogfood_session', 'Realtime CUI dogfood session', 'expected config CUI to print dogfood session tracker state', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_dogfood_session', 'Realtime CUI dogfood session', error instanceof Error ? error.message : String(error)));
    }

    try {
      const handoff = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-work-handoff'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${handoff.stdout || ''}\n${handoff.stderr || ''}`;
      out.push(
        output.includes('JAVIS Work Handoff') &&
          output.includes('Details:') &&
          output.includes('- progress:') &&
          output.includes('- next:') &&
          output.includes('- continuations:')
          ? ok('realtime.cui_handoff', 'Realtime CUI work handoff', 'config CUI prints a voice-ready handoff summary')
          : fail('realtime.cui_handoff', 'Realtime CUI work handoff', 'expected config CUI to print the work handoff summary and detail fields', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_handoff', 'Realtime CUI work handoff', error instanceof Error ? error.message : String(error)));
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

    const latencyBase = Date.now();
    const latencyRecord = await ctx.api('/api/realtime/latency', {
      method: 'POST',
      body: {
        source: 'eval',
        sessionId: 'eval-latency',
        micMode: 'open',
        screenLive: false,
        startedAt: latencyBase,
        micReadyAt: latencyBase + 120,
        offerCreatedAt: latencyBase + 240,
        negotiationStartedAt: latencyBase + 260,
        answerReceivedAt: latencyBase + 760,
        remoteDescriptionAt: latencyBase + 820,
        dataChannelOpenAt: latencyBase + 1100,
        firstProgressInjectionAt: latencyBase + 1900,
        status: 'live',
        stage: 'progress_injected',
        ok: true,
      },
    });
    const latency = latencyRecord.data?.latency;
    out.push(
      latencyRecord.ok &&
        latency?.source === 'eval' &&
        latency?.sessionId === 'eval-latency' &&
        latency?.startToLiveMs === 1100 &&
        latency?.negotiationMs === 500 &&
        latency?.liveToFirstProgressMs === 800 &&
        latency?.quality === 'fast' &&
        latencyRecord.data?.conversation?.lastRealtimeLatencyReceipt?.sessionId === 'eval-latency'
        ? ok('realtime.latency_evidence', 'Realtime voice latency evidence', 'latency receipt normalizes click-to-live and progress timing')
        : fail('realtime.latency_evidence', 'Realtime voice latency evidence', `POST /api/realtime/latency ${latencyRecord.status}`, latencyRecord.data),
    );

    const rendererSource = fs.readFileSync('src/App.tsx', 'utf8');
    const rendererNegotiationEvidenceOk =
      rendererSource.includes('/api/realtime/session-negotiation') &&
      rendererSource.includes("source: 'renderer'") &&
      rendererSource.includes('offerBytes') &&
      rendererSource.includes('answerBytes') &&
      rendererSource.includes('statusCode') &&
      rendererSource.includes('durationMs') &&
      rendererSource.includes('setRemoteDescription') &&
      rendererSource.includes('recordRealtimeNegotiation');
    out.push(
      rendererNegotiationEvidenceOk
        ? ok('realtime.renderer_negotiation_evidence', 'Renderer negotiation evidence reporter', 'renderer records real WebRTC offer/answer evidence after SDP negotiation')
        : fail('realtime.renderer_negotiation_evidence', 'Renderer negotiation evidence reporter', 'renderer no longer records WebRTC negotiation evidence', {
            hasEndpoint: rendererSource.includes('/api/realtime/session-negotiation'),
            hasRecorder: rendererSource.includes('recordRealtimeNegotiation'),
          }),
    );

    const rendererLatencyEvidenceOk =
      rendererSource.includes('/api/realtime/latency') &&
      rendererSource.includes('recordRealtimeLatency') &&
      rendererSource.includes('dataChannelOpenAt') &&
      rendererSource.includes('firstProgressInjectionAt') &&
      rendererSource.includes('startToLiveMs');
    out.push(
      rendererLatencyEvidenceOk
        ? ok('realtime.renderer_latency_evidence', 'Renderer latency evidence reporter', 'renderer records real WebRTC start-to-live and first-progress timing')
        : fail('realtime.renderer_latency_evidence', 'Renderer latency evidence reporter', 'renderer no longer records Realtime voice latency evidence', {
            hasEndpoint: rendererSource.includes('/api/realtime/latency'),
            hasRecorder: rendererSource.includes('recordRealtimeLatency'),
          }),
    );

    const rendererDogfoodHandlerIndex = rendererSource.indexOf('const handleRendererDogfood =');
    const rendererDogfoodListenerIndex = rendererSource.indexOf("window.addEventListener('javis:realtime-dogfood'", rendererDogfoodHandlerIndex);
    const rendererDogfoodEffectEndIndex = rendererSource.indexOf('  }, [])', rendererDogfoodListenerIndex);
    const rendererDogfoodListener =
      rendererDogfoodHandlerIndex >= 0 && rendererDogfoodListenerIndex >= 0 && rendererDogfoodEffectEndIndex >= 0
        ? rendererSource.slice(rendererDogfoodHandlerIndex, rendererDogfoodEffectEndIndex + '  }, [])'.length)
        : '';
    const rendererDogfoodListenerStable =
      rendererDogfoodListener.includes('voiceStatusRef.current') &&
      rendererDogfoodListener.includes('screenLiveRef.current') &&
      rendererDogfoodListener.includes('postRendererDogfoodEventRef.current') &&
      rendererDogfoodListener.includes("voiceStatusRef.current === 'error'") &&
      rendererDogfoodListener.includes("type: voiceErrored ? 'voice_error' : 'timeout'") &&
      !rendererDogfoodListener.includes('beginAssistantSession()') &&
      !/\}, \[[^\]]*voiceStatus[^\]]*\]\)/.test(rendererDogfoodListener);
    out.push(
      rendererDogfoodListenerStable
        ? ok('realtime.renderer_dogfood_listener_stability', 'Renderer dogfood listener stability', 'renderer dogfood wait survives voice status transitions during startup')
        : fail('realtime.renderer_dogfood_listener_stability', 'Renderer dogfood listener stability', 'renderer dogfood listener can be cancelled by its own voice startup state changes', {
            hasVoiceStatusRef: rendererDogfoodListener.includes('voiceStatusRef.current'),
            hasScreenLiveRef: rendererDogfoodListener.includes('screenLiveRef.current'),
            hasStableTelemetryRef: rendererDogfoodListener.includes('postRendererDogfoodEventRef.current'),
            hasVoiceErrorFastPath: rendererDogfoodListener.includes("voiceStatusRef.current === 'error'"),
            callsBeginAssistantSession: rendererDogfoodListener.includes('beginAssistantSession()'),
          }),
    );

    const evidence = await ctx.api('/api/realtime/evidence');
    const e = evidence.data?.evidence;
    const checklistIds = new Set((Array.isArray(e?.checklist) ? e.checklist : []).map((step) => step.id));
    const requiredChecklist = [
      'provider_ready',
      'session_negotiated',
      'voice_session_live',
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
        ['providerReady', 'sessionNegotiated', 'voiceSessionLive', 'progressInjectedFromRenderer', 'passiveContextOnly', 'spokenSummaryReady'].every((key) => typeof e.checks[key] === 'boolean') &&
        structuredEvidenceOk &&
        typeof e.nextAction === 'string' &&
        Array.isArray(e.drill?.steps) &&
        e.drill.steps.some((step) => step.id === 'start_live_voice') &&
        e.drill.steps.some((step) => step.id === 'ask_work_handoff') &&
        e.drill.steps.some((step) => step.id === 'ask_autopilot_status') &&
        e.drill.steps.some((step) => step.id === 'ask_local_capabilities') &&
        e.drill.steps.some((step) => step.id === 'ask_learning_profile') &&
        e.drill.steps.some((step) => step.id === 'ask_learning_evolution') &&
        e.drill.steps.some((step) => step.id === 'ask_browser_workflow') &&
        e.drill.steps.some((step) => step.id === 'save_productivity_dogfood_archive') &&
        e.drill.steps.some((step) => step.id === 'route_recalled_shortcut') &&
        e.gapSummary?.manualOnly === true &&
        e.gapSummary?.startsMicrophone === false &&
        e.gapSummary?.counts?.total === e.drill.steps.length &&
        e.gapSummary?.counts?.pending === e.drill.pending.length &&
        e.gapSummary?.nextStep?.id === (e.drill.pending[0]?.id || 'complete') &&
        typeof e.gapSummary?.nextPrompt?.copyText === 'string' &&
        e.handoffTools?.hasHandoff === true &&
        e.autopilotTools?.hasStatus === true &&
        e.capabilityTools?.hasCapabilityMap === true &&
        e.learningTools?.hasLearningProfile === true &&
        e.learningTools?.hasLearningEvolution === true &&
        e.browserTools?.hasWorkflow === true &&
        e.browserTools?.hasSafeWorkflowPreview === true &&
        e.productivityDogfoodTools?.hasSavedArchive === true &&
        e.productivityDogfoodTools?.hasSafePreview === true &&
        e.latency?.quality === 'fast' &&
        e.progress?.spokenSummary
        ? ok('realtime.evidence_checklist', 'Realtime evidence checklist', `${e.status}/${e.phase} · ${e.nextAction}`)
        : fail('realtime.evidence_checklist', 'Realtime evidence checklist', `GET /api/realtime/evidence ${evidence.status}`, evidence.data),
    );

    const dogfood = await ctx.api('/api/realtime/dogfood');
    const d = dogfood.data?.dogfood;
    const dogfoodStepIds = new Set((Array.isArray(d?.steps) ? d.steps : []).map((step) => step.id));
    const dogfoodGuide = d?.dogfoodGuide || {};
    const dogfoodRequiredSteps = [
      'provider_ready',
      'session_negotiated',
      'voice_session_live',
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
        d.startDrill?.path === '/api/realtime/dogfood/start' &&
        d.prepareProgress?.path === '/api/realtime/dogfood/prepare' &&
        d.monitor?.endpoint === '/api/realtime/evidence' &&
        d.drill?.manualOnly === true &&
        Array.isArray(d.drill?.steps) &&
        d.drill.steps.some((step) => step.id === 'ask_progress') &&
        d.drill.steps.some((step) => step.id === 'ask_work_handoff') &&
        d.drill.steps.some((step) => step.id === 'ask_autopilot_status') &&
        d.drill.steps.some((step) => step.id === 'ask_attention_explanation') &&
        d.drill.steps.some((step) => step.id === 'ask_perception_consent') &&
        d.drill.steps.some((step) => step.id === 'ask_local_capabilities') &&
        d.drill.steps.some((step) => step.id === 'ask_learning_profile') &&
        d.drill.steps.some((step) => step.id === 'ask_learning_evolution') &&
        d.drill.steps.some((step) => step.id === 'ask_browser_workflow') &&
        d.drill.steps.some((step) => step.id === 'save_productivity_dogfood_archive') &&
        d.drill.steps.some((step) => step.id === 'teach_ui_demonstration') &&
        d.gapSummary?.manualOnly === true &&
        d.gapSummary?.startsMicrophone === false &&
        d.gapSummary?.counts?.total === d.drill.steps.length &&
        d.gapSummary?.counts?.pending === d.drill.pending.length &&
        d.gapSummary?.nextStep?.id === (d.drill.pending[0]?.id || 'complete') &&
        typeof d.gapSummary?.summary === 'string' &&
        d.handoffTools?.hasHandoff === true &&
        d.autopilotTools?.hasStatus === true &&
        d.attentionTools?.hasExplanation === true &&
        d.perceptionTools?.hasConsent === true &&
        d.capabilityTools?.hasCapabilityMap === true &&
        d.capabilityTools?.hasRecommendedTools === true &&
        d.learningTools?.hasLearningProfile === true &&
        d.learningTools?.hasLearningEvolution === true &&
        d.learningTools?.privacySafe === true &&
        d.browserTools?.hasWorkflow === true &&
        d.browserTools?.hasSafeWorkflowPreview === true &&
        d.productivityDogfoodTools?.hasSavedArchive === true &&
        d.productivityDogfoodTools?.hasSafePreview === true &&
        d.demonstrationTools?.hasSafeReplayPlan === true &&
        d.demonstrationTools?.hasDraft === true &&
        d.demonstrationTools?.hasConfirmationGate === true &&
        d.demonstrationTools?.noRawStored === true &&
        dogfoodGuide.start?.endpoint?.path === '/api/realtime/dogfood/start' &&
        dogfoodGuide.monitor?.endpoint === '/api/realtime/evidence' &&
        Array.isArray(dogfoodGuide.prompts) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('现在做到哪了')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('为什么你现在是绿色')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('能看到什么')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('能做什么')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('学到了')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('变化')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('当前网页')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('生产力四应用')) &&
        dogfoodGuide.prompts.some((prompt) => prompt.includes('开始记录')) &&
        Array.isArray(dogfoodGuide.expectedEvidence) &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_work_handoff') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_autopilot_status') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_attention_explanation') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_perception_consent') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_local_capabilities') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_learning_profile') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'get_learning_evolution') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'run_browser_workflow') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'save_productivity_dogfood_archive') &&
        dogfoodGuide.expectedEvidence.some((item) => item.tool === 'draft_ui_demonstration_skill') &&
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
      'ask_work_handoff',
      'ask_autopilot_status',
      'ask_attention_explanation',
      'ask_perception_consent',
      'ask_local_capabilities',
      'ask_learning_profile',
      'ask_browser_workflow',
      'save_productivity_dogfood_archive',
      'teach_ui_demonstration',
      'list_shortcuts',
      'save_shortcut_with_confirmation',
      'route_recalled_shortcut',
      'forget_shortcut',
    ];
    const drillGuide = drill.data?.evidence?.dogfood?.dogfoodGuide || {};
    out.push(
      drill.ok &&
        drillData?.manualOnly === true &&
        drillData?.autoEligible === false &&
        drillRequired.every((id) => drillIds.has(id)) &&
        drillGuide.monitor?.endpoint === '/api/realtime/evidence' &&
        Array.isArray(drillGuide.prompts) &&
        drillGuide.prompts.some((prompt) => prompt.includes('现在做到哪了')) &&
        drillGuide.prompts.some((prompt) => prompt.includes('为什么你现在是绿色')) &&
        drillGuide.prompts.some((prompt) => prompt.includes('能做什么')) &&
        drillGuide.prompts.some((prompt) => prompt.includes('学到了')) &&
        drillGuide.prompts.some((prompt) => prompt.includes('当前网页')) &&
        drillGuide.prompts.some((prompt) => prompt.includes('生产力四应用')) &&
        Array.isArray(drillData.prompts) &&
        drillData.prompts.some((prompt) => prompt.includes('autopilot')) &&
        drillData.prompts.some((prompt) => prompt.includes('为什么你现在是绿色')) &&
        drillData.prompts.some((prompt) => prompt.includes('能看到什么')) &&
        drillData.prompts.some((prompt) => prompt.includes('能做什么')) &&
        drillData.prompts.some((prompt) => prompt.includes('学到了')) &&
        drillData.prompts.some((prompt) => prompt.includes('当前网页')) &&
        drillData.prompts.some((prompt) => prompt.includes('生产力四应用')) &&
        drillData.prompts.some((prompt) => prompt.includes('开始记录')) &&
        drillData.prompts.some((prompt) => prompt.includes('后台现在怎么样')) &&
        drill.data?.evidence?.drill?.steps?.length === drillData.steps.length
        ? ok('realtime.dogfood_drill', 'Realtime dogfood drill', `${drillData.status || 'pending'} · ${drillData.summary || ''}`)
        : fail('realtime.dogfood_drill', 'Realtime dogfood drill', `GET /api/realtime/dogfood/drill ${drill.status}`, drill.data),
    );

    const dogfoodPrompt = await ctx.api('/api/realtime/dogfood/prompt');
    const dogfoodPromptData = dogfoodPrompt.data?.prompt;
    out.push(
      dogfoodPrompt.ok &&
        dogfoodPromptData?.manualOnly === true &&
        dogfoodPromptData?.requiresUserPresence === true &&
        dogfoodPromptData?.startsMicrophone === false &&
        dogfoodPromptData?.monitor?.endpoint === '/api/realtime/evidence' &&
        typeof dogfoodPromptData.prompt === 'string' &&
        dogfoodPromptData.prompt.length > 0 &&
        typeof dogfoodPromptData.copyText === 'string' &&
        dogfoodPromptData.copyText.length > 0 &&
        dogfoodPromptData.step?.id &&
        Array.isArray(dogfoodPromptData.allPrompts)
        ? ok('realtime.dogfood_prompt', 'Realtime dogfood next prompt', `${dogfoodPromptData.step.label || dogfoodPromptData.step.id}: ${dogfoodPromptData.copyText}`)
        : fail('realtime.dogfood_prompt', 'Realtime dogfood next prompt', `GET /api/realtime/dogfood/prompt ${dogfoodPrompt.status}`, dogfoodPrompt.data),
    );

    const dogfoodPromptCopy = await ctx.api('/api/realtime/dogfood/prompt/copy', {
      method: 'POST',
      body: {
        dryRun: true,
        source: 'eval',
      },
    });
    out.push(
      dogfoodPromptCopy.ok &&
        dogfoodPromptCopy.data?.ok === true &&
        dogfoodPromptCopy.data?.dryRun === true &&
        dogfoodPromptCopy.data?.copied === false &&
        dogfoodPromptCopy.data?.wouldCopy === true &&
        dogfoodPromptCopy.data?.startsMicrophone === false &&
        dogfoodPromptCopy.data?.prompt?.manualOnly === true &&
        typeof dogfoodPromptCopy.data?.text === 'string' &&
        dogfoodPromptCopy.data.text.length > 0
        ? ok('realtime.dogfood_prompt_copy_dry_run', 'Realtime dogfood prompt copy dry-run', dogfoodPromptCopy.data.text)
        : fail('realtime.dogfood_prompt_copy_dry_run', 'Realtime dogfood prompt copy dry-run', `POST /api/realtime/dogfood/prompt/copy ${dogfoodPromptCopy.status}`, dogfoodPromptCopy.data),
    );

    const dogfoodBrief = await ctx.api('/api/realtime/dogfood/brief');
    const dogfoodBriefData = dogfoodBrief.data?.brief;
    out.push(
      dogfoodBrief.ok &&
        dogfoodBriefData?.manualOnly === true &&
        dogfoodBriefData?.startsMicrophone === false &&
        dogfoodBriefData?.requiresUserPresence === true &&
        dogfoodBriefData?.monitor?.endpoint === '/api/realtime/evidence' &&
        dogfoodBriefData?.monitor?.brief?.includes('--print-realtime-dogfood-brief') &&
        dogfoodBriefData?.start?.hotkey &&
        dogfoodBriefData?.counts?.steps >= 17 &&
        dogfoodBriefData?.gapSummary?.counts?.total === dogfoodBriefData.counts.steps &&
        dogfoodBriefData?.gapSummary?.counts?.pending === dogfoodBriefData.counts.pending &&
        dogfoodBriefData?.gapSummary?.startsMicrophone === false &&
        typeof dogfoodBriefData?.gapSummary?.nextPrompt?.copyText === 'string' &&
        dogfoodBriefData?.safety?.recordReplayRequiresConfirmation === true &&
        Array.isArray(dogfoodBriefData.prompts) &&
        dogfoodBriefData.prompts.some((prompt) => prompt.includes('能做什么')) &&
        dogfoodBriefData.prompts.some((prompt) => prompt.includes('学到了')) &&
        dogfoodBriefData.prompts.some((prompt) => prompt.includes('当前网页')) &&
        dogfoodBriefData.prompts.some((prompt) => prompt.includes('开始记录')) &&
        Array.isArray(dogfoodBriefData.evidenceTools) &&
        dogfoodBriefData.evidenceTools.some((item) => item.id === 'capability' && item.tool === 'get_local_capabilities') &&
        dogfoodBriefData.evidenceTools.some((item) => item.id === 'learning' && item.tool === 'get_learning_profile') &&
        dogfoodBriefData.evidenceTools.some((item) => item.id === 'browser' && item.tool === 'run_browser_workflow') &&
        dogfoodBriefData.evidenceTools.some((item) => item.id === 'demonstration' && item.tool === 'draft_ui_demonstration_skill')
        ? ok('realtime.dogfood_brief', 'Realtime dogfood operator brief', `${dogfoodBriefData.counts.ready}/${dogfoodBriefData.counts.steps} ready · next=${dogfoodBriefData.nextPrompt?.copyText || dogfoodBriefData.currentStep?.label || '-'}`)
        : fail('realtime.dogfood_brief', 'Realtime dogfood operator brief', `GET /api/realtime/dogfood/brief ${dogfoodBrief.status}`, dogfoodBrief.data),
    );

    try {
      const briefCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-dogfood-brief'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${briefCui.stdout || ''}\n${briefCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Realtime Dogfood Brief') &&
          output.includes('starts microphone=no') &&
          output.includes('Prompt script:') &&
          output.includes('Evidence gates:') &&
          output.includes('Gap:') &&
          output.includes('get_local_capabilities') &&
          output.includes('get_learning_profile') &&
          output.includes('run_browser_workflow') &&
          output.includes('开始记录') &&
          output.includes('/api/realtime/evidence')
          ? ok('realtime.cui_dogfood_brief', 'Realtime CUI dogfood brief', 'config CUI prints one-page live dogfood brief without starting voice')
          : fail('realtime.cui_dogfood_brief', 'Realtime CUI dogfood brief', 'expected CUI brief to print prompt script, evidence gates, and monitor endpoint', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_dogfood_brief', 'Realtime CUI dogfood brief', error instanceof Error ? error.message : String(error)));
    }

    const acceptance = await ctx.api('/api/realtime/dogfood/acceptance?auditLimit=12');
    const acceptanceData = acceptance.data?.acceptance;
    const acceptanceGateIds = new Set((Array.isArray(acceptanceData?.gates) ? acceptanceData.gates : []).map((gate) => gate.id));
    const acceptanceGroupIds = new Set((Array.isArray(acceptanceData?.groups) ? acceptanceData.groups : []).map((group) => group.id));
    const requiredAcceptanceGates = [
      'start_live_voice',
      'inject_worker_progress',
      'ask_progress',
      'ask_work_handoff',
      'ask_autopilot_status',
      'ask_attention_explanation',
      'ask_perception_consent',
      'ask_local_capabilities',
      'ask_learning_profile',
      'ask_browser_workflow',
      'save_productivity_dogfood_archive',
      'teach_ui_demonstration',
      'save_shortcut_with_confirmation',
      'route_recalled_shortcut',
      'archive_saved',
    ];
    out.push(
      acceptance.ok &&
        acceptanceData?.manualOnly === true &&
        acceptanceData?.startsMicrophone === false &&
        acceptanceData?.requiresUserPresence === true &&
        acceptanceData?.accepted === false &&
        acceptanceData?.status === 'pending' &&
        acceptanceData?.counts?.gates >= 18 &&
        acceptanceData?.counts?.gaps >= 1 &&
        requiredAcceptanceGates.every((id) => acceptanceGateIds.has(id)) &&
        ['operator', 'live_voice', 'spoken_answer', 'voice_tools', 'learning_loop', 'computer_tools', 'shortcut_loop', 'audit_trail'].every((id) => acceptanceGroupIds.has(id)) &&
        acceptanceData?.nextGap?.id &&
        acceptanceData?.archive?.saved === false &&
        acceptanceData?.safety?.rawAudioStored === false &&
        acceptanceData?.safety?.screenImageIncluded === false &&
        acceptanceData?.safety?.actionPolicyBypassed === false
        ? ok('realtime.dogfood_acceptance', 'Realtime dogfood acceptance report', `${acceptanceData.counts.passed}/${acceptanceData.counts.gates} gate(s) pass · next=${acceptanceData.nextGap?.id || '-'}`)
        : fail('realtime.dogfood_acceptance', 'Realtime dogfood acceptance report', `GET /api/realtime/dogfood/acceptance ${acceptance.status}`, acceptance.data),
    );

    const acceptanceSave = await ctx.api('/api/realtime/dogfood/acceptance', {
      method: 'POST',
      body: {
        source: 'eval',
        auditLimit: 5,
        saveArchive: true,
      },
    });
    const acceptanceSavedData = acceptanceSave.data?.acceptance;
    const archiveSavedGate = (acceptanceSavedData?.gates || []).find((gate) => gate.id === 'archive_saved');
    out.push(
      acceptanceSave.ok &&
        acceptanceSave.data?.saved === true &&
        acceptanceSavedData?.manualOnly === true &&
        acceptanceSavedData?.startsMicrophone === false &&
        acceptanceSavedData?.archive?.saved === true &&
        archiveSavedGate?.ok === true &&
        acceptanceSave.data?.archive?.file?.path &&
        fs.existsSync(acceptanceSave.data.archive.file.path) &&
        acceptanceSave.data?.archive?.safety?.rawAudioStored === false
        ? ok('realtime.dogfood_acceptance_save', 'Realtime dogfood acceptance save path', acceptanceSave.data.archive.file.path)
        : fail('realtime.dogfood_acceptance_save', 'Realtime dogfood acceptance save path', `POST /api/realtime/dogfood/acceptance ${acceptanceSave.status}`, acceptanceSave.data),
    );

    try {
      const acceptanceCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-dogfood-acceptance'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${acceptanceCui.stdout || ''}\n${acceptanceCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Realtime Dogfood Acceptance') &&
          output.includes('starts microphone=no') &&
          output.includes('Archive required: not saved') &&
          output.includes('Missing gates:') &&
          output.includes('policy bypass=no')
          ? ok('realtime.cui_dogfood_acceptance', 'Realtime CUI dogfood acceptance', 'config CUI prints acceptance gates without starting voice')
          : fail('realtime.cui_dogfood_acceptance', 'Realtime CUI dogfood acceptance', 'expected CUI acceptance to print gates, archive status, and safety markers', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_dogfood_acceptance', 'Realtime CUI dogfood acceptance', error instanceof Error ? error.message : String(error)));
    }

    const acceptanceTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'get_realtime_dogfood_acceptance',
        arguments: { auditLimit: 5 },
      },
    });
    const acceptanceToolOutput = parseToolOutput(acceptanceTool);
    out.push(
      acceptanceTool.ok &&
        acceptanceTool.data?.ok === true &&
        acceptanceToolOutput?.acceptance?.manualOnly === true &&
        acceptanceToolOutput?.acceptance?.startsMicrophone === false &&
        acceptanceToolOutput?.acceptance?.counts?.gates >= 18 &&
        Array.isArray(acceptanceToolOutput?.acceptance?.gates)
        ? ok('realtime.dogfood_acceptance_tool', 'Realtime dogfood acceptance voice tool', `${acceptanceToolOutput.acceptance.counts.passed}/${acceptanceToolOutput.acceptance.counts.gates} gate(s) pass`)
        : fail('realtime.dogfood_acceptance_tool', 'Realtime dogfood acceptance voice tool', `tool execute ${acceptanceTool.status}`, acceptanceTool.data),
    );

    try {
      const acceptanceScript = await execFileAsync('node', ['scripts/realtime-dogfood-renderer.mjs', '--acceptance-only', '--no-save-archive'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${acceptanceScript.stdout || ''}\n${acceptanceScript.stderr || ''}`;
      out.push(
        output.includes('Acceptance:') &&
          output.includes('accepted=no') &&
          output.includes('gates=') &&
          output.includes('next=') &&
          !output.includes('Refusing to start microphone')
          ? ok('realtime.renderer_dogfood_acceptance_script', 'Renderer dogfood acceptance script', 'acceptance-only script prints current pass/gap result without starting mic')
          : fail('realtime.renderer_dogfood_acceptance_script', 'Renderer dogfood acceptance script', 'expected acceptance-only renderer script to print current acceptance summary', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.renderer_dogfood_acceptance_script', 'Renderer dogfood acceptance script', error instanceof Error ? error.message : String(error)));
    }

    const archivePreview = await ctx.api('/api/realtime/dogfood/archive?limit=3&auditLimit=12');
    const archivePreviewData = archivePreview.data?.archive;
    out.push(
      archivePreview.ok &&
        archivePreviewData?.manualOnly === true &&
        archivePreviewData?.startsMicrophone === false &&
        archivePreviewData?.requiresUserPresence === true &&
        archivePreviewData?.saved === false &&
        archivePreviewData?.safety?.rawAudioStored === false &&
        archivePreviewData?.safety?.screenImageIncluded === false &&
        archivePreviewData?.file?.path?.includes('realtime-dogfood-archives') &&
        archivePreviewData?.brief?.startsMicrophone === false &&
        archivePreviewData?.gapSummary?.startsMicrophone === false &&
        archivePreviewData?.gapSummary?.counts?.total === archivePreviewData?.counts?.steps &&
        typeof archivePreviewData?.gapSummary?.summary === 'string' &&
        archivePreviewData.gapSummary.summary.length > 0 &&
        archivePreviewData?.evidence?.checks &&
        Array.isArray(archivePreviewData?.recentAudit) &&
        Array.isArray(archivePreview.data?.archives?.items)
        ? ok('realtime.dogfood_archive_preview', 'Realtime dogfood archive preview', `${archivePreviewData.status}/${archivePreviewData.phase} · ${archivePreviewData.archiveSummary || ''}`)
        : fail('realtime.dogfood_archive_preview', 'Realtime dogfood archive preview', `GET /api/realtime/dogfood/archive ${archivePreview.status}`, archivePreview.data),
    );

    const archiveSave = await ctx.api('/api/realtime/dogfood/archive', {
      method: 'POST',
      body: {
        source: 'eval',
        auditLimit: 12,
      },
    });
    const savedArchive = archiveSave.data?.archive;
    let savedArchiveDisk = null;
    if (savedArchive?.file?.path && fs.existsSync(savedArchive.file.path)) {
      try {
        savedArchiveDisk = JSON.parse(fs.readFileSync(savedArchive.file.path, 'utf8'));
      } catch {
        savedArchiveDisk = null;
      }
    }
    out.push(
      archiveSave.ok &&
        archiveSave.data?.saved === true &&
        savedArchive?.saved === true &&
        savedArchive?.manualOnly === true &&
        savedArchive?.startsMicrophone === false &&
        savedArchive?.safety?.writesLocalJsonOnly === true &&
        savedArchive?.gapSummary?.startsMicrophone === false &&
        savedArchive?.file?.path?.includes('realtime-dogfood-archives') &&
        fs.existsSync(savedArchive.file.path) &&
        savedArchiveDisk?.id === savedArchive.id &&
        savedArchiveDisk?.gapSummary?.summary === savedArchive.gapSummary.summary &&
        savedArchiveDisk?.safety?.rawAudioStored === false &&
        archiveSave.data?.metadata?.gapSummary &&
        archiveSave.data?.metadata?.startsMicrophone === false &&
        Array.isArray(archiveSave.data?.archives?.items)
        ? ok('realtime.dogfood_archive_save', 'Realtime dogfood archive save', savedArchive.file.path)
        : fail('realtime.dogfood_archive_save', 'Realtime dogfood archive save', `POST /api/realtime/dogfood/archive ${archiveSave.status}`, archiveSave.data),
    );

    const archiveTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'save_realtime_dogfood_archive',
        arguments: { auditLimit: 5 },
      },
    });
    const archiveToolOutput = parseToolOutput(archiveTool);
    out.push(
      archiveTool.ok &&
        archiveTool.data?.ok === true &&
        archiveToolOutput?.ok === true &&
        archiveToolOutput?.saved === true &&
        archiveToolOutput?.archive?.startsMicrophone === false &&
        archiveToolOutput?.archive?.file?.path &&
        fs.existsSync(archiveToolOutput.archive.file.path)
        ? ok('realtime.dogfood_archive_tool', 'Realtime dogfood archive voice tool', archiveToolOutput.archive.file.path)
        : fail('realtime.dogfood_archive_tool', 'Realtime dogfood archive voice tool', `tool execute ${archiveTool.status}`, archiveTool.data),
    );

    const rendererDogfoodPreview = await ctx.api('/api/realtime/dogfood/renderer/start', {
      method: 'POST',
      timeoutMs: 30000,
      body: {
        execute: false,
        source: 'eval',
      },
    });
    out.push(
      rendererDogfoodPreview.ok &&
        rendererDogfoodPreview.data?.executed === false &&
        rendererDogfoodPreview.data?.startsMicrophone === true &&
        rendererDogfoodPreview.data?.requiresMicConfirmation === true &&
        rendererDogfoodPreview.data?.detail?.action === 'start' &&
        Array.isArray(rendererDogfoodPreview.data?.detail?.prompts) &&
        rendererDogfoodPreview.data.detail.prompts.length > 0
        ? ok('realtime.renderer_dogfood_preview', 'Realtime renderer dogfood preview', 'renderer dogfood trigger previews without starting microphone')
        : fail('realtime.renderer_dogfood_preview', 'Realtime renderer dogfood preview', `POST /api/realtime/dogfood/renderer/start ${rendererDogfoodPreview.status}`, rendererDogfoodPreview.data),
    );

    const rendererDogfoodGuard = await ctx.api('/api/realtime/dogfood/renderer/start', {
      method: 'POST',
      timeoutMs: 30000,
      body: {
        execute: true,
        confirmMic: false,
        source: 'eval',
      },
      retries: 0,
    });
    out.push(
      rendererDogfoodGuard.status === 409 &&
        rendererDogfoodGuard.data?.ok === false &&
        rendererDogfoodGuard.data?.startsMicrophone === true &&
        rendererDogfoodGuard.data?.requiresMicConfirmation === true &&
        /confirmMic:true/.test(rendererDogfoodGuard.data?.output || '')
        ? ok('realtime.renderer_dogfood_mic_gate', 'Realtime renderer dogfood mic gate', 'execute:true is rejected unless confirmMic:true is present')
        : fail('realtime.renderer_dogfood_mic_gate', 'Realtime renderer dogfood mic gate', `expected 409 confirmation gate, got ${rendererDogfoodGuard.status}`, rendererDogfoodGuard.data),
    );

    try {
      const archiveCui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-realtime-dogfood-archive'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${archiveCui.stdout || ''}\n${archiveCui.stderr || ''}`;
      out.push(
        output.includes('JAVIS Realtime Dogfood Archive') &&
          output.includes('starts microphone=no') &&
          output.includes('raw audio stored=no') &&
          output.includes('File:') &&
          output.includes('Gap:') &&
          output.includes('realtime-dogfood-archives')
          ? ok('realtime.cui_dogfood_archive', 'Realtime CUI dogfood archive', 'config CUI previews the local dogfood evidence archive without starting voice')
          : fail('realtime.cui_dogfood_archive', 'Realtime CUI dogfood archive', 'expected CUI archive output to print file path and no-mic safety', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('realtime.cui_dogfood_archive', 'Realtime CUI dogfood archive', error instanceof Error ? error.message : String(error)));
    }

    const dogfoodSessionBefore = await ctx.api('/api/realtime/dogfood/session');
    out.push(
      dogfoodSessionBefore.ok &&
        dogfoodSessionBefore.data?.sessions?.manualOnly === true &&
        dogfoodSessionBefore.data?.sessions?.startsMicrophone === false &&
        dogfoodSessionBefore.data?.sessions?.prompt?.startsMicrophone === false &&
        dogfoodSessionBefore.data?.sessions?.autoSync?.enabled === true &&
        dogfoodSessionBefore.data?.sessions?.prompt?.copyText
        ? ok('realtime.dogfood_operator_session_snapshot', 'Realtime dogfood operator session snapshot', `${dogfoodSessionBefore.data.sessions.counts?.active || 0} active session(s)`)
        : fail('realtime.dogfood_operator_session_snapshot', 'Realtime dogfood operator session snapshot', `GET /api/realtime/dogfood/session ${dogfoodSessionBefore.status}`, dogfoodSessionBefore.data),
    );

    const dogfoodSessionStart = await ctx.api('/api/realtime/dogfood/session/start', {
      method: 'POST',
      body: {
        source: 'eval',
        allowConcurrent: true,
        title: 'Eval realtime dogfood operator session',
      },
    });
    const dogfoodSession = dogfoodSessionStart.data?.session;
    const dogfoodSessionStepId = dogfoodSession?.steps?.find((step) => step.id === 'open_monitor')?.id || dogfoodSession?.steps?.[0]?.id || '';
    out.push(
      dogfoodSessionStart.ok &&
        dogfoodSessionStart.data?.ok === true &&
        dogfoodSessionStart.data?.manualOnly === true &&
        dogfoodSessionStart.data?.startsMicrophone === false &&
        dogfoodSession?.status === 'active' &&
        dogfoodSession?.manualOnly === true &&
        dogfoodSession?.startsMicrophone === false &&
        dogfoodSession?.monitor?.endpoint === '/api/realtime/evidence' &&
        dogfoodSessionStart.data?.autoSync?.enabled === true &&
        dogfoodSessionStart.data?.autoSync?.changed === true &&
        dogfoodSessionStart.data?.autoSync?.syncedSteps === dogfoodSession?.counts?.evidenceReady &&
        dogfoodSession?.autoSync?.stickyEvidence === true &&
        dogfoodSession?.autoSync?.syncCount >= 1 &&
        dogfoodSession?.counts?.currentEvidenceReady <= dogfoodSession?.counts?.evidenceReady &&
        dogfoodSessionStepId
        ? ok('realtime.dogfood_operator_session_start', 'Realtime dogfood operator session start', `${dogfoodSession.id} · ${dogfoodSession.counts?.evidenceReady || 0}/${dogfoodSession.counts?.total || 0} evidence ready · auto-sync=${dogfoodSessionStart.data.autoSync.syncedSteps}`)
        : fail('realtime.dogfood_operator_session_start', 'Realtime dogfood operator session start', `POST /api/realtime/dogfood/session/start ${dogfoodSessionStart.status}`, dogfoodSessionStart.data),
    );

    if (dogfoodSession?.id && dogfoodSessionStepId) {
      const markSession = await ctx.api(`/api/realtime/dogfood/session/${encodeURIComponent(dogfoodSession.id)}/steps/${encodeURIComponent(dogfoodSessionStepId)}`, {
        method: 'POST',
        body: {
          source: 'eval',
          status: 'done',
          note: 'Eval marked the operator step without starting microphone capture.',
        },
      });
      out.push(
        markSession.ok &&
          markSession.data?.ok === true &&
          markSession.data?.startsMicrophone === false &&
          markSession.data?.step?.id === dogfoodSessionStepId &&
          markSession.data?.step?.operatorDone === true
          ? ok('realtime.dogfood_operator_step_mark', 'Realtime dogfood operator step mark', `${dogfoodSessionStepId} marked done`)
          : fail('realtime.dogfood_operator_step_mark', 'Realtime dogfood operator step mark', `POST step mark ${markSession.status}`, markSession.data),
      );

      const finishSession = await ctx.api(`/api/realtime/dogfood/session/${encodeURIComponent(dogfoodSession.id)}/end`, {
        method: 'POST',
        body: {
          source: 'eval',
          status: 'cancelled',
          note: 'Eval cleanup.',
        },
      });
      out.push(
        finishSession.ok &&
          finishSession.data?.ok === true &&
          finishSession.data?.startsMicrophone === false &&
          finishSession.data?.session?.id === dogfoodSession.id &&
          finishSession.data?.session?.status === 'cancelled'
          ? ok('realtime.dogfood_operator_session_end', 'Realtime dogfood operator session end', `${dogfoodSession.id} cleaned up`)
          : fail('realtime.dogfood_operator_session_end', 'Realtime dogfood operator session end', `POST session end ${finishSession.status}`, finishSession.data),
      );
    } else {
      out.push(fail('realtime.dogfood_operator_step_mark', 'Realtime dogfood operator step mark', 'session start did not return a markable step', dogfoodSessionStart.data));
      out.push(fail('realtime.dogfood_operator_session_end', 'Realtime dogfood operator session end', 'session start did not return an id to clean up', dogfoodSessionStart.data));
    }

    const startPreview = await ctx.api('/api/realtime/dogfood/start', {
      method: 'POST',
      body: {
        execute: false,
        source: 'eval',
      },
    });
    out.push(
      startPreview.ok &&
        startPreview.data?.manualOnly === true &&
        startPreview.data?.executed === false &&
        startPreview.data?.autoEligible === false &&
        startPreview.data?.prepareWhenLive === true &&
        startPreview.data?.dogfoodGuide?.monitor?.endpoint === '/api/realtime/evidence' &&
        Array.isArray(startPreview.data?.dogfoodGuide?.prompts) &&
        startPreview.data.dogfoodGuide.prompts.some((prompt) => prompt.includes('现在做到哪了')) &&
        startPreview.data.dogfoodGuide.prompts.some((prompt) => prompt.includes('为什么你现在是绿色')) &&
        String(startPreview.data?.output || '').includes('get_work_handoff') &&
        String(startPreview.data?.output || '').includes('get_attention_explanation') &&
        startPreview.data?.drill?.manualOnly === true &&
        startPreview.data?.start?.hotkey &&
        typeof startPreview.data?.output === 'string' &&
        startPreview.data.output.includes('Preview Realtime voice dogfood drill')
        ? ok('realtime.dogfood_start_preview', 'Realtime dogfood drill start preview', startPreview.data.drill.summary || 'preview ready')
        : fail('realtime.dogfood_start_preview', 'Realtime dogfood drill start preview', `POST /api/realtime/dogfood/start ${startPreview.status}`, startPreview.data),
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
