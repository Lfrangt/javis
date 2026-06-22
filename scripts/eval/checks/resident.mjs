import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { ok, warn, fail } from '../_client.mjs';

// Resident control surface (README: wake state, setup guide + one-step fix,
// global hotkeys / pet window state, LaunchAgent resident status). Read-only.
export default {
  lane: 'resident',
  async run(ctx) {
    const out = [];

    const wake = await ctx.api('/api/wake/status');
    const w = wake.data?.wake;
    const wakeHandoff = w?.handoff || {};
    out.push(
      wake.ok &&
        w &&
        Array.isArray(w.words) &&
        wakeHandoff.ready === true &&
        ['local_voice_fallback', 'realtime_or_local'].includes(wakeHandoff.mode) &&
        wakeHandoff.input?.endpoint === '/api/voice/command' &&
        String(wakeHandoff.input?.cliCommand || '').includes('npm run voice') &&
        wakeHandoff.safety?.readOnly === true &&
        wakeHandoff.safety?.startsMicrophone === false &&
        wakeHandoff.safety?.usesRealtime === false &&
        wakeHandoff.safety?.storesRawAudio === false
        ? ok('resident.wake', 'Wake state', `${w.words.length} wake word(s) · handoff=${wakeHandoff.mode} · softWakeOnly=${w.softWakeOnly} triggers=${w.triggerCount ?? 0}`)
        : warn('resident.wake', 'Wake state', `GET /api/wake/status ${wake.status} ${wake.error || ''}`, { wake: w }),
    );

    const guide = await ctx.api('/api/setup/guide');
    const g = guide.data?.guide;
    out.push(
      guide.ok && g
        ? ok('resident.setup', 'Setup guide', `overall=${g.overall} · ${(g.steps || []).length} step(s) · next=${g.nextStep?.label || g.nextStep?.id || 'none'}`)
        : warn('resident.setup', 'Setup guide', `GET /api/setup/guide ${guide.status} ${guide.error || ''}`),
    );

    const recoveryBundleResponse = await ctx.api('/api/setup/recovery-bundle');
    const bundle = recoveryBundleResponse.data?.bundle || {};
    const bundleRaw = JSON.stringify(bundle);
    const bundleVoiceStandby = bundle.voice?.standby || {};
    const bundleLocalVoice = bundle.voice?.localFallback || {};
    const bundlePolicy = bundle.automation?.policy || {};
    const bundleAllow = bundlePolicy.allow || {};
    const bundlePermissions = Array.isArray(bundle.permissions) ? bundle.permissions : [];
    const bundleCapabilities = Array.isArray(bundle.automation?.capabilities) ? bundle.automation.capabilities : [];
    out.push(
      recoveryBundleResponse.ok &&
        bundle.version === 1 &&
        ['ready', 'degraded', 'blocked'].includes(bundle.overall) &&
        bundle.endpoints?.setupGuide === '/api/setup/guide' &&
        bundle.endpoints?.doctor === '/api/doctor/report' &&
        bundle.endpoints?.keepAwake === '/api/keep-awake/status' &&
        bundle.endpoints?.voiceStandby === '/api/voice/standby' &&
        bundle.commands?.bundle?.includes('--print-setup-recovery-bundle') &&
        bundle.commands?.keepAwakeStart?.includes('keepawake:start') &&
        bundle.commands?.voiceStandby?.includes('voice:standby') &&
        typeof bundle.resident?.installed === 'boolean' &&
        typeof bundle.resident?.loaded === 'boolean' &&
        typeof bundle.resident?.matchesProject === 'boolean' &&
        typeof bundle.keepAwake?.active === 'boolean' &&
        bundle.keepAwake?.plan?.command === '/usr/bin/caffeinate' &&
        bundle.keepAwake?.plan?.screenMaySleep === true &&
        bundle.keepAwake?.safety?.startsMicrophone === false &&
        bundle.keepAwake?.safety?.callsOpenAi === false &&
        bundle.keepAwake?.safety?.mutatesProjectFiles === false &&
        bundle.readiness?.counts?.total > 0 &&
        bundlePermissions.some((item) => item.id === 'screen_permission') &&
        bundlePermissions.some((item) => item.id === 'accessibility_permission') &&
        bundleCapabilities.some((item) => item.id === 'browser_control_policy') &&
        bundleCapabilities.some((item) => item.id === 'cli_command_policy') &&
        bundleLocalVoice.available === true &&
        bundleLocalVoice.input?.endpoint === '/api/voice/command' &&
        bundleLocalVoice.safety?.startsMicrophone === false &&
        bundleLocalVoice.safety?.usesRealtime === false &&
        bundleLocalVoice.safety?.storesRawAudio === false &&
        ['realtime_ready', 'local_fallback_ready'].includes(bundleVoiceStandby.mode) &&
        bundleVoiceStandby.primaryAction?.id &&
        bundleVoiceStandby.local?.input?.endpoint === '/api/voice/command' &&
        bundleVoiceStandby.local?.safety?.startsMicrophone === false &&
        bundleVoiceStandby.local?.safety?.usesRealtime === false &&
        bundleVoiceStandby.local?.safety?.storesRawAudio === false &&
        bundleVoiceStandby.safety?.storesRawAudio === false &&
        bundle.voice?.realtime?.recovery?.localFallback?.endpoint === '/api/voice/command' &&
        typeof bundle.automation?.localExecutionEnabled === 'boolean' &&
        typeof bundle.automation?.trustedLocalMode === 'boolean' &&
        bundle.automation?.controlMode?.mode &&
        typeof bundlePolicy.maxAutoRiskLevel === 'number' &&
        bundleAllow.files?.rootCount >= 0 &&
        Array.isArray(bundleAllow.cli?.allowedCommands) &&
        Array.isArray(bundle.nextActions) &&
        bundle.safety?.readOnly === true &&
        bundle.safety?.startsMicrophone === false &&
        bundle.safety?.callsOpenAi === false &&
        bundle.safety?.mutatesFiles === false &&
        bundle.safety?.exposesApiToken === false &&
        !/sk-[A-Za-z0-9_-]{16,}/.test(bundleRaw) &&
        !bundleRaw.includes('imageDataUrl')
        ? ok('resident.setup_recovery_bundle', 'Resident setup recovery bundle', `${bundle.overall} · resident=${bundle.resident?.loaded ? 'loaded' : 'not-loaded'} · voice=${bundle.voice?.realtime?.status || 'unknown'} · actions=${bundle.nextActions.length}`)
        : fail('resident.setup_recovery_bundle', 'Resident setup recovery bundle', 'expected compact read-only resident recovery bundle with setup, permissions, voice fallback, automation, and safety contract', {
          status: recoveryBundleResponse.status,
          bundle,
        }),
    );

    const voiceStandbyResponse = await ctx.api('/api/voice/standby');
    const voiceStandby = voiceStandbyResponse.data?.standby || {};
    const voiceStandbyPromptPack = voiceStandby.promptPack || {};
    const voiceStandbyCui = spawnSync('npm', ['run', 'voice:standby'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
      },
    });
    out.push(
      voiceStandbyResponse.ok &&
        voiceStandby.version === 1 &&
        ['realtime_ready', 'local_fallback_ready'].includes(voiceStandby.mode) &&
        voiceStandby.primaryAction?.id &&
        voiceStandby.local?.available === true &&
        voiceStandby.local?.input?.endpoint === '/api/voice/command' &&
        voiceStandby.local?.input?.openLoopEndpoint === '/api/voice/open-local-loop' &&
        typeof voiceStandbyPromptPack.nextUtterance === 'string' &&
        voiceStandbyPromptPack.nextUtterance.length > 0 &&
        Array.isArray(voiceStandbyPromptPack.examples) &&
        voiceStandbyPromptPack.examples.length >= 3 &&
        voiceStandbyPromptPack.safety?.opensTerminal === false &&
        (voiceStandby.mode === 'local_fallback_ready'
          ? voiceStandbyPromptPack.safety?.startsMicrophone === false &&
            voiceStandbyPromptPack.safety?.usesRealtime === false
          : typeof voiceStandbyPromptPack.safety?.startsMicrophone === 'boolean') &&
        voiceStandby.local?.promptPack?.nextUtterance === voiceStandbyPromptPack.nextUtterance &&
        voiceStandby.local?.safety?.startsMicrophone === false &&
        voiceStandby.local?.safety?.usesRealtime === false &&
        voiceStandby.local?.safety?.storesRawAudio === false &&
        voiceStandby.safety?.storesRawAudio === false &&
        voiceStandbyCui.status === 0 &&
        voiceStandbyCui.stdout.includes('JAVIS Voice Standby') &&
        voiceStandbyCui.stdout.includes('Try saying') &&
        voiceStandbyCui.stdout.includes('local loop: npm run voice:chat')
        ? ok('resident.voice_standby', 'Voice standby/fallback status', `${voiceStandby.mode} · primary=${voiceStandby.primaryAction.id}`)
        : fail('resident.voice_standby', 'Voice standby/fallback status', 'expected unified voice standby contract plus CUI output', {
          status: voiceStandbyResponse.status,
          voiceStandby,
          cui: voiceStandbyCui.stdout,
          cuiError: voiceStandbyCui.stderr,
          cuiStatus: voiceStandbyCui.status,
        }),
    );

    const voiceStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '实时语音连上了吗，为什么现在不能直接说话？',
        execute: true,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_voice_status_local_command',
      },
      timeoutMs: 10000,
    });
    const voiceStatusCommand = voiceStatusCommandResponse.data || {};
    const voiceStatusRoute = voiceStatusCommand.route || {};
    const voiceStatus = voiceStatusRoute.data?.voiceStatus || {};
    out.push(
      voiceStatusCommandResponse.ok &&
        voiceStatusCommand.ok === true &&
        voiceStatusRoute.localCommand?.intent === 'voice_status' &&
        voiceStatusRoute.decision?.localCommand === 'voice_status' &&
        String(voiceStatusRoute.output || '').includes('Voice:') &&
        voiceStatus.standby?.version === 1 &&
        voiceStatus.safety?.readOnly === true &&
        voiceStatus.safety?.startsMicrophone === false &&
        voiceStatus.safety?.usesRealtime === false &&
        voiceStatus.safety?.storesRawAudio === false &&
        voiceStatus.safety?.opensTerminal === false &&
        voiceStatusRoute.contextPlan?.needs?.residentState === true &&
        voiceStatusRoute.contextPlan?.needs?.screen === false &&
        voiceStatusRoute.contextPlan?.needs?.accessibility === false
        ? ok('resident.voice_status_local_command', 'Voice status local command', `${voiceStatus.standby.mode} · primary=${voiceStatus.standby.primaryAction?.id || '-'}`)
        : fail('resident.voice_status_local_command', 'Voice status local command', 'expected natural Realtime/mic status question to route to a read-only voice_status fast path', {
          status: voiceStatusCommandResponse.status,
          body: voiceStatusCommand,
        }),
    );

    const perceptionStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你现在在看我的屏幕吗，最近看到什么窗口？',
        execute: true,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_perception_status_local_command',
      },
      timeoutMs: 10000,
    });
    const perceptionStatusCommand = perceptionStatusCommandResponse.data || {};
    const perceptionStatusRoute = perceptionStatusCommand.route || {};
    const perceptionStatus = perceptionStatusRoute.data?.perceptionStatus || {};
    out.push(
      perceptionStatusCommandResponse.ok &&
        perceptionStatusCommand.ok === true &&
        perceptionStatusRoute.localCommand?.intent === 'perception_status' &&
        perceptionStatusRoute.decision?.localCommand === 'perception_status' &&
        String(perceptionStatusRoute.output || '').includes('Perception:') &&
        perceptionStatus.version === 1 &&
        perceptionStatus.perception?.ok === true &&
        typeof perceptionStatus.perception?.counts?.total === 'number' &&
        perceptionStatus.safety?.readOnly === true &&
        perceptionStatus.safety?.capturesScreenNow === false &&
        perceptionStatus.safety?.startsMicrophone === false &&
        perceptionStatus.safety?.usesRealtime === false &&
        perceptionStatus.safety?.returnsScreenImage === false &&
        perceptionStatus.safety?.returnsBrowserPageText === false &&
        perceptionStatus.safety?.returnsFullAccessibilityTree === false &&
        perceptionStatusRoute.contextPlan?.needs?.residentState === true &&
        perceptionStatusRoute.contextPlan?.needs?.screen === false &&
        perceptionStatusRoute.contextPlan?.needs?.accessibility === false &&
        perceptionStatusRoute.contextPlan?.needs?.browserPage === false
        ? ok('resident.perception_status_local_command', 'Perception status local command', `${perceptionStatus.perception.counts.active || 0} active surface(s) · screen=${perceptionStatus.screen?.available ? 'cached' : 'waiting'}`)
        : fail('resident.perception_status_local_command', 'Perception status local command', 'expected natural screen/watch status question to route to a read-only perception_status fast path', {
          status: perceptionStatusCommandResponse.status,
          body: perceptionStatusCommand,
        }),
    );

    const approvalStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '现在有没有需要我确认的审批，哪些动作卡住了？',
        execute: true,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_approval_status_local_command',
      },
      timeoutMs: 10000,
    });
    const approvalStatusCommand = approvalStatusCommandResponse.data || {};
    const approvalStatusRoute = approvalStatusCommand.route || {};
    const approvalStatus = approvalStatusRoute.data?.approvalStatus || {};
    out.push(
      approvalStatusCommandResponse.ok &&
        approvalStatusCommand.ok === true &&
        approvalStatusRoute.localCommand?.intent === 'approval_status' &&
        approvalStatusRoute.decision?.localCommand === 'approval_status' &&
        String(approvalStatusRoute.output || '').includes('Approvals:') &&
        approvalStatus.version === 1 &&
        Array.isArray(approvalStatus.pending) &&
        typeof approvalStatus.counts?.total === 'number' &&
        approvalStatus.safety?.readOnly === true &&
        approvalStatus.safety?.resolvesApprovals === false &&
        approvalStatus.safety?.executesActions === false &&
        approvalStatus.safety?.startsMicrophone === false &&
        approvalStatus.safety?.usesRealtime === false &&
        approvalStatus.safety?.opensTerminal === false &&
        approvalStatus.safety?.capturesScreenNow === false &&
        approvalStatus.safety?.mutatesUserFiles === false &&
        approvalStatusRoute.contextPlan?.needs?.residentState === true &&
        approvalStatusRoute.contextPlan?.needs?.screen === false &&
        approvalStatusRoute.contextPlan?.needs?.accessibility === false
        ? ok('resident.approval_status_local_command', 'Approval status local command', `${approvalStatus.count || 0} pending approval(s) · control=${approvalStatus.controlMode?.mode || '-'}`)
        : fail('resident.approval_status_local_command', 'Approval status local command', 'expected natural approval/confirmation question to route to a read-only approval_status fast path', {
          status: approvalStatusCommandResponse.status,
          body: approvalStatusCommand,
        }),
    );

    const blockerStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '现在有哪些阻塞卡住了，为什么不动？',
        execute: true,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_blocker_status_local_command',
      },
      timeoutMs: 10000,
    });
    const blockerStatusCommand = blockerStatusCommandResponse.data || {};
    const blockerStatusRoute = blockerStatusCommand.route || {};
    const blockerStatus = blockerStatusRoute.data?.blockerStatus || {};
    out.push(
      blockerStatusCommandResponse.ok &&
        blockerStatusCommand.ok === true &&
        blockerStatusRoute.localCommand?.intent === 'blocker_status' &&
        blockerStatusRoute.decision?.localCommand === 'blocker_status' &&
        String(blockerStatusRoute.output || '').includes('Blockers:') &&
        blockerStatus.version === 1 &&
        Array.isArray(blockerStatus.blockers) &&
        typeof blockerStatus.counts?.total === 'number' &&
        blockerStatus.safety?.readOnly === true &&
        blockerStatus.safety?.executesActions === false &&
        blockerStatus.safety?.resolvesApprovals === false &&
        blockerStatus.safety?.startsWorkers === false &&
        blockerStatus.safety?.startsMicrophone === false &&
        blockerStatus.safety?.usesRealtime === false &&
        blockerStatus.safety?.opensTerminal === false &&
        blockerStatus.safety?.capturesScreenNow === false &&
        blockerStatus.safety?.mutatesUserFiles === false &&
        blockerStatusRoute.contextPlan?.needs?.residentState === true &&
        blockerStatusRoute.contextPlan?.needs?.screen === false &&
        blockerStatusRoute.contextPlan?.needs?.accessibility === false
        ? ok('resident.blocker_status_local_command', 'Blocker status local command', `${blockerStatus.counts.total || 0} blocker(s) · top=${blockerStatus.top?.id || 'none'}`)
        : fail('resident.blocker_status_local_command', 'Blocker status local command', 'expected natural blocked/stuck question to route to a read-only blocker_status fast path', {
          status: blockerStatusCommandResponse.status,
          body: blockerStatusCommand,
        }),
    );

    const blockerStatusText = JSON.stringify(blockerStatus);
    out.push(
      !blockerStatusText.includes('frontmost_app_is_not_supported_browser') &&
        !blockerStatusText.includes('browser context unavailable') &&
        !blockerStatusText.includes('browser target unavailable')
        ? ok('resident.blocker_status_filters_transient_browser_preview', 'Blocker status filters transient browser previews', 'unsupported-browser preview failures stay in history instead of active blockers')
        : fail('resident.blocker_status_filters_transient_browser_preview', 'Blocker status filters transient browser previews', 'expected transient browser preview failures to stay out of active blocker summaries', {
          blockers: blockerStatus.blockers,
          counts: blockerStatus.counts,
        }),
    );

    const unblockPreviewApiResponse = await ctx.api('/api/unblock/preview?jobLimit=5&workflowLimit=5&approvalLimit=5', {
      timeoutMs: 10000,
    });
    const unblockPreviewApi = unblockPreviewApiResponse.data?.unblock || {};
    out.push(
      unblockPreviewApiResponse.ok &&
        unblockPreviewApi.version === 1 &&
        unblockPreviewApi.safety?.readOnly === true &&
        unblockPreviewApi.safety?.executesWorkNext === false &&
        unblockPreviewApi.safety?.executesActions === false &&
        unblockPreviewApi.safety?.resolvesApprovals === false &&
        unblockPreviewApi.safety?.startsWorkers === false &&
        unblockPreviewApi.safety?.startsMicrophone === false &&
        unblockPreviewApi.safety?.usesRealtime === false &&
        unblockPreviewApi.safety?.opensTerminal === false &&
        unblockPreviewApi.safety?.capturesScreenNow === false &&
        unblockPreviewApi.safety?.mutatesUserFiles === false &&
        unblockPreviewApi.next?.executed === false
        ? ok('resident.unblock_preview_api', 'Unblock preview API', `${unblockPreviewApi.status || '-'} · action=${unblockPreviewApi.recommendedAction?.id || 'none'}`)
        : fail('resident.unblock_preview_api', 'Unblock preview API', 'expected /api/unblock/preview to combine blockers plus work-next preview without side effects', {
          status: unblockPreviewApiResponse.status,
          body: unblockPreviewApiResponse.data,
        }),
    );

    const unblockPreviewCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '怎么解除这些阻塞，下一步能安全准备什么？',
        execute: true,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_unblock_preview_local_command',
      },
      timeoutMs: 10000,
    });
    const unblockPreviewCommand = unblockPreviewCommandResponse.data || {};
    const unblockPreviewRoute = unblockPreviewCommand.route || {};
    const unblockPreview = unblockPreviewRoute.data?.unblockPreview || {};
    out.push(
      unblockPreviewCommandResponse.ok &&
        unblockPreviewCommand.ok === true &&
        unblockPreviewRoute.localCommand?.intent === 'unblock_preview' &&
        unblockPreviewRoute.decision?.localCommand === 'unblock_preview' &&
        String(unblockPreviewRoute.output || '').includes('Unblock preview:') &&
        unblockPreview.version === 1 &&
        unblockPreview.safety?.readOnly === true &&
        unblockPreview.safety?.executesWorkNext === false &&
        unblockPreview.safety?.executesActions === false &&
        unblockPreview.safety?.resolvesApprovals === false &&
        unblockPreview.safety?.startsWorkers === false &&
        unblockPreview.safety?.startsMicrophone === false &&
        unblockPreview.safety?.usesRealtime === false &&
        unblockPreview.safety?.opensTerminal === false &&
        unblockPreview.safety?.capturesScreenNow === false &&
        unblockPreview.safety?.mutatesUserFiles === false &&
        unblockPreview.next?.executed === false &&
        unblockPreviewRoute.contextPlan?.needs?.residentState === true &&
        unblockPreviewRoute.contextPlan?.needs?.screen === false &&
        unblockPreviewRoute.contextPlan?.needs?.accessibility === false
        ? ok('resident.unblock_preview_local_command', 'Unblock preview local command', `${unblockPreview.status || '-'} · action=${unblockPreview.recommendedAction?.id || 'none'}`)
        : fail('resident.unblock_preview_local_command', 'Unblock preview local command', 'expected natural unblock/recovery question to route to read-only unblock_preview fast path', {
          status: unblockPreviewCommandResponse.status,
          body: unblockPreviewCommand,
        }),
    );

    const voiceStandbyPrimaryPreview = await ctx.api('/api/voice/standby', {
      method: 'POST',
      body: {
        execute: false,
        source: 'eval_resident_voice_standby_primary_preview',
      },
      timeoutMs: 10000,
    });
    const voiceStandbyPrimary = voiceStandbyPrimaryPreview.data || {};
    out.push(
      voiceStandbyPrimaryPreview.ok &&
        voiceStandbyPrimary.ok === true &&
        voiceStandbyPrimary.executed === false &&
        voiceStandbyPrimary.mode === voiceStandby.mode &&
        voiceStandbyPrimary.primaryAction?.id === voiceStandby.primaryAction?.id &&
        voiceStandbyPrimary.action?.executed === false &&
        voiceStandbyPrimary.safety?.startsMicrophone === false &&
        voiceStandbyPrimary.safety?.usesRealtime === false &&
        voiceStandbyPrimary.safety?.storesRawAudio === false &&
        voiceStandbyPrimary.safety?.opensTerminal === false
        ? ok('resident.voice_standby_primary_preview', 'Voice standby primary action preview', `${voiceStandbyPrimary.mode} · primary=${voiceStandbyPrimary.primaryAction?.id}`)
        : fail('resident.voice_standby_primary_preview', 'Voice standby primary action preview', 'expected POST /api/voice/standby preview to prepare the current primary voice action without side effects', {
          status: voiceStandbyPrimaryPreview.status,
          voiceStandbyPrimary,
        }),
    );

    const voiceStandbyWorkNextPreview = await ctx.api('/api/work/next?actionId=voice%3Astandby_primary', {
      timeoutMs: 10000,
    });
    const voiceStandbyWorkNext = voiceStandbyWorkNextPreview.data?.next || {};
    const voiceStandbyWorkNextResult = voiceStandbyWorkNext.result || {};
    out.push(
      voiceStandbyWorkNextPreview.ok &&
        voiceStandbyWorkNext.ok === true &&
        voiceStandbyWorkNext.executed === false &&
        voiceStandbyWorkNext.action?.id === 'voice:standby_primary' &&
        voiceStandbyWorkNext.action?.source === 'voice_standby' &&
        voiceStandbyWorkNext.action?.executable === true &&
        voiceStandbyWorkNextResult.executed === false &&
        voiceStandbyWorkNextResult.primaryAction?.id === voiceStandby.primaryAction?.id &&
        voiceStandbyWorkNextResult.safety?.startsMicrophone === false &&
        voiceStandbyWorkNextResult.safety?.usesRealtime === false &&
        voiceStandbyWorkNextResult.safety?.storesRawAudio === false &&
        voiceStandbyWorkNextResult.safety?.opensTerminal === false &&
        String(voiceStandbyWorkNext.output || '').includes('Preview mode')
        ? ok('resident.voice_standby_work_next_preview', 'Voice standby work-next preview', `${voiceStandbyWorkNext.action?.label || '-'} · primary=${voiceStandbyWorkNextResult.primaryAction?.id}`)
        : fail('resident.voice_standby_work_next_preview', 'Voice standby work-next preview', 'expected work-next voice standby primary preview without mic, realtime, raw audio, or Terminal', {
          status: voiceStandbyWorkNextPreview.status,
          voiceStandbyWorkNext,
        }),
    );

    const keepAwakeStatus = await ctx.api('/api/keep-awake/status');
    const keepAwake = keepAwakeStatus.data?.keepAwake || {};
    const keepAwakePreview = await ctx.api('/api/keep-awake/start', {
      method: 'POST',
      body: {
        execute: false,
        source: 'eval_resident_keep_awake_preview',
      },
      timeoutMs: 10000,
    });
    const keepAwakePreviewBody = keepAwakePreview.data || {};
    const keepAwakeCui = spawnSync('npm', ['run', 'config', '--', '--print-keep-awake'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
      },
    });
    out.push(
      keepAwakeStatus.ok &&
        keepAwake.version === 1 &&
        keepAwake.plan?.command === '/usr/bin/caffeinate' &&
        Array.isArray(keepAwake.plan?.args) &&
        keepAwake.plan.args.includes('-i') &&
        keepAwake.plan.args.includes('-m') &&
        keepAwake.plan.args.includes('-s') &&
        keepAwake.plan.screenMaySleep === true &&
        keepAwake.safety?.startsMicrophone === false &&
        keepAwake.safety?.usesRealtime === false &&
        keepAwake.safety?.callsOpenAi === false &&
        keepAwake.safety?.mutatesProjectFiles === false &&
        keepAwakePreview.ok &&
        keepAwakePreviewBody.executed === false &&
        keepAwakePreviewBody.preview === true &&
        keepAwakePreviewBody.safety?.changesLaunchdJob === true &&
        keepAwakeCui.status === 0 &&
        keepAwakeCui.stdout.includes('JAVIS Keep-Awake') &&
        keepAwakeCui.stdout.includes('screen may sleep=yes')
        ? ok('resident.keep_awake_status', 'Keep-awake resident status', `${keepAwake.active ? 'active' : 'off'} · command=${keepAwake.plan.commandLine}`)
        : fail('resident.keep_awake_status', 'Keep-awake resident status', 'expected read-only keep-awake status plus no-execute preview and CUI output', {
          status: keepAwakeStatus.status,
          keepAwake,
          preview: keepAwakePreviewBody,
          cui: keepAwakeCui.stdout,
          cuiError: keepAwakeCui.stderr,
          cuiStatus: keepAwakeCui.status,
        }),
    );

    const win = await ctx.api('/api/window/state');
    const win2 = win.data?.window;
    out.push(
      win.ok &&
        win2 &&
        win2.parkCorner === 'notch' &&
        Number(win2.width || 0) <= 148 &&
        Number(win2.height || 0) <= 40
        ? ok('resident.window', 'Pet window + hotkeys', `mode=${win2.mode} ${win2.width}x${win2.height} park=${win2.parkCorner} hotkey=${win2.hotkeyRegistered ? 'on' : 'off'} summon=${win2.summonHotkeyRegistered ? 'on' : 'off'} capture=${win2.captureHotkeyRegistered ? 'on' : 'off'}`)
        : warn('resident.window', 'Pet window + hotkeys', `GET /api/window/state ${win.status} ${win.error || ''}`),
    );

    const composeWindowResponse = await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'compose',
        focus: false,
      },
      timeoutMs: 10000,
    });
    const composeWindow = composeWindowResponse.data?.window || {};
    const restoredWindowResponse = await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'pet',
        focus: false,
      },
      timeoutMs: 10000,
    });
    const restoredWindow = restoredWindowResponse.data?.window || {};
    out.push(
      composeWindowResponse.ok &&
        composeWindow.mode === 'compose' &&
        Number(composeWindow.width || 0) <= 520 &&
        Number(composeWindow.height || 0) <= 56 &&
        restoredWindowResponse.ok &&
        restoredWindow.mode === 'pet' &&
        Number(restoredWindow.width || 0) <= 148 &&
        Number(restoredWindow.height || 0) <= 40
        ? ok('resident.window_compose', 'Compose window mode', `compose=${composeWindow.width}x${composeWindow.height} restored=${restoredWindow.width}x${restoredWindow.height}`)
        : fail('resident.window_compose', 'Compose window mode', 'expected quiet local-input compose window to open and restore to pet', {
          composeStatus: composeWindowResponse.status,
          composeWindow,
          restoreStatus: restoredWindowResponse.status,
          restoredWindow,
        }),
    );

    if (voiceStandby.mode === 'local_fallback_ready') {
      const summonWindowResponse = await ctx.api('/api/window/summon', {
        method: 'POST',
        body: {
          source: 'eval_resident_summon_compose',
          wake: false,
        },
        timeoutMs: 10000,
      });
      const summonWindow = summonWindowResponse.data?.window || {};
      const summonRestoreResponse = await ctx.api('/api/window/mode', {
        method: 'POST',
        body: {
          mode: 'pet',
          focus: false,
        },
        timeoutMs: 10000,
      });
      out.push(
        summonWindowResponse.ok &&
          summonWindowResponse.data?.fallbackReady === true &&
          summonWindow.mode === 'compose' &&
          summonRestoreResponse.ok &&
          summonRestoreResponse.data?.window?.mode === 'pet'
          ? ok('resident.summon_compose', 'Summon opens compose in fallback mode', `${summonWindow.width}x${summonWindow.height} · wake=${summonWindowResponse.data?.wake?.triggerCount || 0}`)
          : fail('resident.summon_compose', 'Summon opens compose in fallback mode', 'expected summon to open compose directly when Realtime is blocked without starting microphone', {
            status: summonWindowResponse.status,
            body: summonWindowResponse.data,
            restoreStatus: summonRestoreResponse.status,
            restoreBody: summonRestoreResponse.data,
          }),
      );
    } else {
      const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
      out.push(
        mainSource.includes("applyWindowMode(fallbackReady ? 'compose' : 'pet'") &&
          mainSource.includes('fallbackReady = voiceHealth.status !==') &&
          mainSource.includes('JAVIS local input opened')
          ? ok('resident.summon_compose_static', 'Summon compose fallback wiring', 'summon is wired to compose mode when voice health is not ready')
          : fail('resident.summon_compose_static', 'Summon compose fallback wiring', 'expected summonJavis to route fallback-ready state to compose mode'),
      );
    }

    const pet = await ctx.api('/api/pet/status');
    const p = pet.data || {};
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(p, key);
    const actualTopLevel = Object.keys(p);
    const contract = p.payloadContract || {};
    const allowedTopLevel = new Set(Array.isArray(contract.allowedTopLevel) ? contract.allowedTopLevel : []);
    const contractForbidden = Array.isArray(contract.forbiddenTopLevel) ? contract.forbiddenTopLevel : [];
    const forbiddenTopLevel = ['models', 'routing', 'collaboration', 'memory', 'memories', 'learning', 'learnedProfile', 'shortcuts', 'demonstrations', 'workflows', 'ambient', 'laneContracts', 'doctor', 'config', 'macContext', 'audit']
      .filter((key) => hasOwn(key));
    const unexpectedTopLevel = allowedTopLevel.size
      ? actualTopLevel.filter((key) => !allowedTopLevel.has(key))
      : [];
    const queue = Array.isArray(p.queue) ? p.queue : [];
    const traffic = p.pet?.trafficLight || {};
    const trafficColors = new Set(['red', 'yellow', 'green']);
    const trafficStates = new Set(['idle', 'fallback_ready', 'watching', 'waking', 'connecting', 'listening', 'working', 'attention', 'blocked']);
    const trafficUrgency = new Set(['quiet', 'ambient', 'active', 'interrupt']);
    const trafficPulses = new Set(['off', 'slow', 'live', 'attention']);
    const voiceFallback = p.voiceHealth?.fallback || {};
    const localVoice = p.localVoice || {};
    const localVoiceInteraction = localVoice.interaction || {};
    const localVoicePromptPack = localVoice.promptPack || {};
    const petWakeHandoff = p.wake?.handoff || {};
    const petWakePromptPack = petWakeHandoff.promptPack || {};
    const localBlocker = localVoice.blocker || {};
    const fallbackBlocker = voiceFallback.blocker || {};
    const wakeBlocker = petWakeHandoff.blocker || {};
    const raw = JSON.stringify(p);
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const hasForbiddenNestedKey = (value, forbidden) => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some((item) => hasForbiddenNestedKey(item, forbidden));
      return Object.keys(value).some((key) => forbidden.includes(key) || hasForbiddenNestedKey(value[key], forbidden));
    };
    const forbiddenNestedKeys = ['imageDataUrl', 'dataDir', 'log', 'result', 'ledger', 'models', 'learning', 'routing'];
    out.push(
      pet.ok &&
        p.pet?.lightweight === true &&
        p.pet?.detailEndpoint === '/api/status' &&
        Array.isArray(p.pet?.excludes) &&
        p.pet.excludes.includes('screen.imageDataUrl') &&
        p.pet.excludes.includes('model identifiers') &&
        contract.version === 1 &&
        contract.maxTargetBytes >= rawBytes &&
        contract.outputBytes > 0 &&
        rawBytes <= contract.maxTargetBytes &&
        contract.screenImagesAllowed === false &&
        contract.rawLogsAllowed === false &&
        contract.rawRuntimePathsAllowed === false &&
        contract.diagnosticsEndpoint === '/api/status' &&
        contractForbidden.includes('models') &&
        contractForbidden.includes('learning') &&
        contractForbidden.includes('routing') &&
        contractForbidden.includes('workflows') &&
        typeof p.pet?.color === 'string' &&
        traffic.version === 1 &&
        trafficColors.has(traffic.color) &&
        traffic.activeLight === traffic.color &&
        trafficStates.has(traffic.state) &&
        trafficUrgency.has(traffic.urgency) &&
        trafficPulses.has(traffic.pulse) &&
        typeof traffic.sourceMode === 'string' &&
        typeof traffic.label === 'string' &&
        typeof traffic.reason === 'string' &&
        typeof traffic.accessibleLabel === 'string' &&
        traffic.accessibleLabel.includes('JAVIS') &&
        traffic.startsMicrophone === false &&
        traffic.passiveByDefault === true &&
        voiceFallback.available === true &&
        voiceFallback.endpoint === '/api/voice/command' &&
        voiceFallback.lane === 'local_voice_command' &&
        voiceFallback.safety?.startsMicrophone === false &&
        voiceFallback.safety?.usesRealtime === false &&
        voiceFallback.safety?.storesRawAudio === false &&
        typeof fallbackBlocker.active === 'boolean' &&
        localVoice.available === true &&
        ['standby', 'fallback_ready'].includes(localVoice.mode) &&
        (localVoice.mode !== 'fallback_ready' ||
          p.voiceHealth?.status !== 'warning' ||
          (p.pet?.mode === 'fallback_ready' &&
            traffic.state === 'fallback_ready' &&
            traffic.color === 'yellow' &&
            traffic.urgency === 'ambient' &&
            traffic.pulse === 'off' &&
            /local no-mic input is ready/i.test(String(traffic.reason || '')) &&
            !/^Routed work needs attention:/i.test(String(traffic.reason || '')))) &&
        localVoice.input?.endpoint === '/api/voice/command' &&
        localVoice.input?.historyEndpoint === '/api/voice/history' &&
        localVoice.input?.openLoopEndpoint === '/api/voice/open-local-loop' &&
        String(localVoice.input?.cliCommand || '').includes('npm run voice') &&
        String(localVoice.input?.openLoopCommand || '').includes('npm run voice:chat') &&
        String(localVoice.input?.historyCommand || '').includes('--print-voice-history') &&
        typeof localVoicePromptPack.nextUtterance === 'string' &&
        localVoicePromptPack.nextUtterance.length > 0 &&
        localVoicePromptPack.placeholder === localVoicePromptPack.nextUtterance &&
        Array.isArray(localVoicePromptPack.examples) &&
        localVoicePromptPack.examples.length >= 3 &&
        localVoicePromptPack.safety?.opensTerminal === false &&
        (localVoice.mode === 'fallback_ready'
          ? localVoicePromptPack.safety?.startsMicrophone === false &&
            localVoicePromptPack.safety?.usesRealtime === false
          : typeof localVoicePromptPack.safety?.startsMicrophone === 'boolean') &&
        ['open_local_input', 'open_local_voice_loop', 'start_realtime_voice'].includes(localVoiceInteraction.capsuleClick) &&
        localVoiceInteraction.keepsPetCompact === true &&
        (localVoice.mode === 'fallback_ready'
          ? localVoiceInteraction.opensTerminal === false &&
            localVoiceInteraction.startsMicrophone === false &&
            localVoiceInteraction.usesRealtime === false &&
            localVoiceInteraction.endpoint === '/api/voice/command' &&
            localVoiceInteraction.method === 'POST' &&
            !localVoiceInteraction.actionId &&
            localVoiceInteraction.primaryActionEndpoint === '/api/voice/command' &&
            !localVoiceInteraction.terminalLoopEndpoint &&
            localVoiceInteraction.terminalLoopRequiresConfirmation === true
          : localVoiceInteraction.startsMicrophone === true &&
            localVoiceInteraction.usesRealtime === true) &&
        localVoice.privacy?.localOnly === true &&
        localVoice.privacy?.transcriptPreviewOnly === true &&
        localVoice.privacy?.noRawAudio === true &&
        localVoice.privacy?.noScreenImages === true &&
        localVoice.privacy?.noClipboardText === true &&
        localVoice.privacy?.noAccessibilityNodes === true &&
        typeof localBlocker.active === 'boolean' &&
        (localVoice.mode === 'fallback_ready' ? localBlocker.active === true : localBlocker.active === false) &&
        localVoice.safety?.startsMicrophone === false &&
        localVoice.safety?.usesRealtime === false &&
        localVoice.safety?.storesRawAudio === false &&
        localVoice.safety?.storesScreenImage === false &&
        localVoice.safety?.storesClipboardText === false &&
        localVoice.safety?.storesAccessibilityNodes === false &&
        (localVoice.history?.latest === null || typeof localVoice.history?.latest?.transcriptPreview === 'string') &&
        petWakeHandoff.ready === true &&
        ['local_voice_fallback', 'realtime_or_local'].includes(petWakeHandoff.mode) &&
        petWakeHandoff.input?.endpoint === '/api/voice/command' &&
        petWakePromptPack.nextUtterance === localVoicePromptPack.nextUtterance &&
        String(petWakeHandoff.input?.cliCommand || '').includes('npm run voice') &&
        (petWakeHandoff.mode === 'local_voice_fallback' ? wakeBlocker.active === true : typeof wakeBlocker.active === 'boolean') &&
        petWakeHandoff.safety?.readOnly === true &&
        petWakeHandoff.safety?.startsMicrophone === false &&
        petWakeHandoff.safety?.usesRealtime === false &&
        petWakeHandoff.safety?.storesRawAudio === false &&
        p.window?.mode &&
        p.presence?.intervention?.passiveByDefault === true &&
        p.presence?.intervention?.requiresUserIntent === true &&
        !p.screen?.imageDataUrl &&
        !p.screenPrivacy?.rules &&
        !p.screen?.privacy?.rules &&
        !p.runtime?.dataDir &&
        forbiddenTopLevel.length === 0 &&
        unexpectedTopLevel.length === 0 &&
        !hasForbiddenNestedKey(p, forbiddenNestedKeys) &&
        queue.every((job) => !Object.prototype.hasOwnProperty.call(job, 'log') && !Object.prototype.hasOwnProperty.call(job, 'result'))
        ? ok('resident.pet_status_lightweight', 'Pet status lightweight payload', `${traffic.color}/${traffic.state} · ${p.presence.mode} · localVoice=${localVoice.mode} · ${rawBytes}/${contract.maxTargetBytes} bytes`)
        : fail('resident.pet_status_lightweight', 'Pet status lightweight payload', `expected slim pet payload, got ${pet.status}`, {
          forbiddenTopLevel,
          unexpectedTopLevel,
          hasImage: Boolean(p.screen?.imageDataUrl),
          hasRuntimeDataDir: Boolean(p.runtime?.dataDir),
          rawBytes,
          contract,
          pet: p.pet,
          traffic,
          voiceFallback,
          localVoice,
          localVoiceInteraction,
          localBlocker,
          petWakeHandoff,
        }),
    );

    const localLoopPreview = await ctx.api('/api/voice/open-local-loop', {
      method: 'POST',
      body: {
        execute: false,
        source: 'eval_resident_local_voice_loop_preview',
      },
      timeoutMs: 10000,
    });
    const localLoop = localLoopPreview.data || {};
    out.push(
      localLoopPreview.ok &&
        localLoop.ok === true &&
        localLoop.executed === false &&
        String(localLoop.command || '').includes('npm run voice:chat') &&
        localLoop.safety?.startsMicrophone === false &&
        localLoop.safety?.usesRealtime === false &&
        localLoop.safety?.storesRawAudio === false &&
        localLoop.safety?.opensTerminal === false
        ? ok('resident.local_voice_loop_preview', 'Local voice loop opener preview', 'preview prepares npm run voice:chat without opening Terminal, mic, Realtime, or raw audio')
        : fail('resident.local_voice_loop_preview', 'Local voice loop opener preview', `POST /api/voice/open-local-loop ${localLoopPreview.status}`, localLoopPreview.data),
    );

    const localLoopDefaultExecuteResponse = await ctx.api('/api/voice/open-local-loop', {
      method: 'POST',
      body: {
        execute: true,
        source: 'eval_resident_local_voice_loop_default_execute',
      },
      timeoutMs: 10000,
    });
    const localLoopDefaultExecute = localLoopDefaultExecuteResponse.data || {};
    const localLoopDefaultRestore = await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'pet',
        focus: false,
        source: 'eval_resident_local_voice_loop_default_restore',
      },
      timeoutMs: 10000,
    });
    out.push(
      localLoopDefaultExecuteResponse.ok &&
        localLoopDefaultExecute.ok === true &&
        localLoopDefaultExecute.executed === true &&
        localLoopDefaultExecute.redirectedToCompose === true &&
        localLoopDefaultExecute.window?.mode === 'compose' &&
        localLoopDefaultExecute.safety?.startsMicrophone === false &&
        localLoopDefaultExecute.safety?.usesRealtime === false &&
        localLoopDefaultExecute.safety?.storesRawAudio === false &&
        localLoopDefaultExecute.safety?.opensTerminal === false &&
        localLoopDefaultExecute.terminalLoop?.requiresExplicitConfirmation === true &&
        localLoopDefaultRestore.ok &&
        localLoopDefaultRestore.data?.window?.mode === 'pet'
        ? ok('resident.local_voice_loop_no_terminal_default', 'Local voice loop no-Terminal default', 'execute opens compose unless Terminal is explicitly confirmed')
        : fail('resident.local_voice_loop_no_terminal_default', 'Local voice loop no-Terminal default', 'expected execute=true to open compose and avoid Terminal without allowTerminal+confirmTerminal', {
          status: localLoopDefaultExecuteResponse.status,
          body: localLoopDefaultExecute,
          restoreStatus: localLoopDefaultRestore.status,
          restoreBody: localLoopDefaultRestore.data,
        }),
    );

    const localLoopExplicitTerminalResponse = await ctx.api('/api/voice/open-local-loop', {
      method: 'POST',
      body: {
        execute: true,
        allowTerminal: true,
        confirmTerminal: true,
        source: 'eval_resident_local_voice_loop_terminal_disabled',
      },
      timeoutMs: 10000,
    });
    const localLoopExplicitTerminal = localLoopExplicitTerminalResponse.data || {};
    const localLoopExplicitRestore = await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'pet',
        focus: false,
        source: 'eval_resident_local_voice_loop_terminal_disabled_restore',
      },
      timeoutMs: 10000,
    });
    out.push(
      localLoopExplicitTerminalResponse.ok &&
        localLoopExplicitTerminal.ok === true &&
        localLoopExplicitTerminal.executed === true &&
        localLoopExplicitTerminal.redirectedToCompose === true &&
        localLoopExplicitTerminal.safety?.opensTerminal === false &&
        localLoopExplicitTerminal.terminalLoop?.disabledByDefault === true &&
        localLoopExplicitTerminal.terminalLoop?.enableEnv === 'JAVIS_ALLOW_TERMINAL_VOICE_LOOP' &&
        localLoopExplicitRestore.ok &&
        localLoopExplicitRestore.data?.window?.mode === 'pet'
        ? ok('resident.local_voice_loop_terminal_env_gate', 'Local voice loop Terminal env gate', 'even explicit Terminal requests redirect to compose unless JAVIS_ALLOW_TERMINAL_VOICE_LOOP=true')
        : fail('resident.local_voice_loop_terminal_env_gate', 'Local voice loop Terminal env gate', 'expected explicit Terminal request to stay in pet compose by default', {
          status: localLoopExplicitTerminalResponse.status,
          body: localLoopExplicitTerminal,
          restoreStatus: localLoopExplicitRestore.status,
          restoreBody: localLoopExplicitRestore.data,
        }),
    );

    const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
    const loopSource = fs.readFileSync('scripts/local-voice-command-dogfood.mjs', 'utf8');
    const installSource = fs.readFileSync('scripts/install-launch-agent.cjs', 'utf8');
    const stopSource = fs.readFileSync('scripts/stop-resident-processes.cjs', 'utf8');
    const hasLocalLoopDedupe =
      mainSource.includes('localVoiceLoopRunningSnapshot') &&
      mainSource.includes('localVoiceLoopTerminalWindowSnapshot') &&
      mainSource.includes('LOCAL_VOICE_LOOP_STATE_FILE') &&
      mainSource.includes('LOCAL_VOICE_LOOP_DEBOUNCE_MS') &&
      mainSource.includes('JAVIS_ALLOW_TERMINAL_VOICE_LOOP') &&
      mainSource.includes('allowTerminal') &&
      mainSource.includes('confirmTerminal') &&
      mainSource.includes('terminal_loop_disabled_by_default') &&
      mainSource.includes("appendAudit('local_voice_loop.redirected_to_compose'") &&
      mainSource.includes("appendAudit('local_voice_loop.reused'") &&
      mainSource.includes('reusedExisting: true') &&
      mainSource.includes('terminalWindowCount') &&
      mainSource.includes('stateRecentlyOpened') &&
      mainSource.includes('opensTerminal: false');
    out.push(
      hasLocalLoopDedupe
        ? ok('resident.local_voice_loop_dedupe', 'Local voice loop dedupe guard', 'existing, visible, or just-opened voice loop is reused instead of opening another Terminal window')
        : fail('resident.local_voice_loop_dedupe', 'Local voice loop dedupe guard', 'expected /api/voice/open-local-loop to reuse existing voice loop windows and persisted recent opens'),
    );

    const hasResidentLaunchNoTerminalLoop =
      installSource.includes('const launchAgentWorkingDirectory = repoRoot') &&
      installSource.includes("const command = 'npm run start:desktop'") &&
      installSource.includes('<string>-c</string>') &&
      !installSource.includes('<string>-lc</string>') &&
      installSource.includes('<key>JAVIS_ALLOW_TERMINAL_VOICE_LOOP</key>') &&
      installSource.includes('<string>false</string>') &&
      stopSource.includes('isProjectLocalVoiceLoopProcess') &&
      stopSource.includes('npm run voice:chat') &&
      stopSource.includes('local-voice-command-dogfood\\.mjs.*--chat');
    out.push(
      hasResidentLaunchNoTerminalLoop
        ? ok('resident.launch_agent_no_terminal_loop', 'Launch agent avoids Terminal voice loop', 'resident startup uses project cwd, non-login shell, and clears stale local voice loops')
        : fail('resident.launch_agent_no_terminal_loop', 'Launch agent avoids Terminal voice loop', 'expected launch agent install/stop scripts to prevent runaway voice:chat Terminal loops'),
    );

    const hasVoiceStatusLoop =
      loopSource.includes("command === 'voice'") &&
      loopSource.includes('/api/voice/standby') &&
      loopSource.includes('formatLoopVoiceStatus') &&
      loopSource.includes('does not start microphone, Realtime, Terminal');
    out.push(
      hasVoiceStatusLoop
        ? ok('resident.local_voice_loop_voice_status', 'Local voice loop voice-status command', '/voice reads standby state without microphone, Realtime, or Terminal')
        : fail('resident.local_voice_loop_voice_status', 'Local voice loop voice-status command', 'expected /voice slash command to read /api/voice/standby with read-only safety copy'),
    );

    const hasPerceptionStatusLoop =
      loopSource.includes("command === 'see'") &&
      loopSource.includes('/api/perception/consent?limit=5') &&
      loopSource.includes('formatLoopPerceptionStatus') &&
      loopSource.includes('does not capture a new screen frame');
    out.push(
      hasPerceptionStatusLoop
        ? ok('resident.local_voice_loop_perception_status', 'Local voice loop perception-status command', '/see reads perception consent without screen capture, images, page text, or microphone')
        : fail('resident.local_voice_loop_perception_status', 'Local voice loop perception-status command', 'expected /see slash command to read /api/perception/consent with read-only safety copy'),
    );

    const hasApprovalStatusLoop =
      loopSource.includes("command === 'approvals'") &&
      loopSource.includes('get_pending_approvals') &&
      loopSource.includes('formatLoopApprovals') &&
      loopSource.includes('does not approve, reject, execute actions');
    out.push(
      hasApprovalStatusLoop
        ? ok('resident.local_voice_loop_approval_status', 'Local voice loop approval-status command', '/approvals reads pending confirmation gates without resolving or executing them')
        : fail('resident.local_voice_loop_approval_status', 'Local voice loop approval-status command', 'expected /approvals slash command to read summarized pending approvals with read-only safety copy'),
    );

    const hasBlockerStatusLoop =
      loopSource.includes("command === 'blockers'") &&
      loopSource.includes('/api/blockers?jobLimit=5&workflowLimit=5&approvalLimit=5') &&
      loopSource.includes('formatLoopBlockers') &&
      loopSource.includes('does not execute actions, resolve approvals, start workers');
    out.push(
      hasBlockerStatusLoop
        ? ok('resident.local_voice_loop_blocker_status', 'Local voice loop blocker-status command', '/blockers reads voice, approvals, work, routes, and autopilot blockers without side effects')
        : fail('resident.local_voice_loop_blocker_status', 'Local voice loop blocker-status command', 'expected /blockers slash command to read /api/blockers with read-only safety copy'),
    );

    const hasRoutingNoiseFilter =
      mainSource.includes('function isUserVisibleRoutingAttentionRecord') &&
      mainSource.includes('function isNonActionableBlockedWorkflow') &&
      mainSource.includes('function workflowHasActionableRecovery') &&
      mainSource.includes('frontmost_app_is_not_supported_browser') &&
      mainSource.includes('isUserVisibleRoutingAttentionRecord(record)') &&
      mainSource.includes('!isNonActionableBlockedWorkflow(workflow)');
    out.push(
      hasRoutingNoiseFilter
        ? ok('resident.routing_noise_filter', 'Routing noise filter', 'non-actionable browser preview failures do not become active routed-work blockers')
        : fail('resident.routing_noise_filter', 'Routing noise filter', 'expected active routing/workflow blockers to filter transient unsupported-browser preview failures'),
    );

    const hasBrowserUnavailableFallbackTarget =
      mainSource.includes('let lastSupportedResult = null') &&
      mainSource.includes('function compactBrowserContextError') &&
      mainSource.includes("return 'browser_window_unavailable'") &&
      mainSource.includes('error: compactBrowserContextError(error)') &&
      mainSource.includes("appendAudit('browser_context.auto_target_unavailable'") &&
      mainSource.includes('return lastSupportedResult') &&
      mainSource.includes('fallbackAttempted: appName !== frontmost.app');
    out.push(
      hasBrowserUnavailableFallbackTarget
        ? ok('resident.browser_unavailable_fallback_target', 'Browser unavailable fallback target', 'running supported browser stays the default target even when its current tab is not readable')
        : fail('resident.browser_unavailable_fallback_target', 'Browser unavailable fallback target', 'expected browser context fallback to keep a supported running browser as the default target instead of falling back to the unsupported frontmost app'),
    );

    const hasUnblockPreviewLoop =
      loopSource.includes("command === 'unblock'") &&
      loopSource.includes('/api/unblock/preview?jobLimit=5&workflowLimit=5&approvalLimit=5') &&
      loopSource.includes('formatLoopUnblock') &&
      loopSource.includes('does not execute work-next, resolve approvals, start workers');
    out.push(
      hasUnblockPreviewLoop
        ? ok('resident.local_voice_loop_unblock_preview', 'Local voice loop unblock preview command', '/unblock combines blockers and next action preview without side effects')
        : fail('resident.local_voice_loop_unblock_preview', 'Local voice loop unblock preview command', 'expected /unblock slash command to read /api/unblock/preview with read-only safety copy'),
    );

    const hasLearningDistillationLocalCommand =
      mainSource.includes('function naturalLearningDistillationLocalCommand') &&
      mainSource.includes("intent: 'learning_distillation'") &&
      mainSource.includes('learningDistillationVoiceSnapshot') &&
      mainSource.includes('formatLearningDistillationForLocalCommand') &&
      loopSource.includes("command === 'learn'") &&
      loopSource.includes('get_learning_distillation') &&
      loopSource.includes('formatLoopLearning') &&
      loopSource.includes('does not save memory, save skills, grant permissions, execute actions');
    out.push(
      hasLearningDistillationLocalCommand
        ? ok('resident.local_learning_distillation_fast_path', 'Local learning distillation fast path', 'natural learning questions and /learn read metadata-only user distillation without cloud, microphone, or actions')
        : fail('resident.local_learning_distillation_fast_path', 'Local learning distillation fast path', 'expected natural learning_distillation and /learn loop command to read local distillation with strict no-action safety copy'),
    );

    const petStandbyNoTerminal =
      mainSource.includes("id: 'open_local_input'") &&
      mainSource.includes('openLocalVoiceInput') &&
      mainSource.includes("appendAudit('local_voice_input.opened'") &&
      mainSource.includes("applyWindowMode('compose'") &&
      !mainSource.includes("id: 'open_local_voice_loop',");
    out.push(
      petStandbyNoTerminal
        ? ok('resident.voice_standby_no_terminal_default', 'Voice standby no-Terminal default', 'fallback standby opens the pet local input instead of launching a Terminal loop')
        : fail('resident.voice_standby_no_terminal_default', 'Voice standby no-Terminal default', 'expected fallback standby primary action to open compose/pet local input without Terminal'),
    );

    const resident = await ctx.api('/api/resident/status');
    const res = resident.data?.resident;
    out.push(
      resident.ok && res
        ? ok('resident.launchagent', 'LaunchAgent status', `installed=${res.installed} loaded=${res.loaded}${res.pid ? ` pid=${res.pid}` : ''} matchesProject=${res.matchesProject}`)
        : warn('resident.launchagent', 'LaunchAgent status', `GET /api/resident/status ${resident.status} ${resident.error || ''}`),
    );

    const launchAgentPath = `${os.homedir()}/Library/LaunchAgents/com.haoge.javis.plist`;
    const launchAgentPlist = fs.existsSync(launchAgentPath) ? fs.readFileSync(launchAgentPath, 'utf8') : '';
    const launchAgentWorkingDirectory = launchAgentPlist.match(/<key>WorkingDirectory<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || '';
    const launchAgentUsesSafeWorkingDirectory =
      launchAgentWorkingDirectory === process.cwd() &&
      launchAgentPlist.includes('<string>-c</string>') &&
      launchAgentPlist.includes('<string>npm run start:desktop</string>') &&
      launchAgentPlist.includes('<key>JAVIS_ALLOW_TERMINAL_VOICE_LOOP</key>') &&
      launchAgentPlist.includes('<string>false</string>');
    out.push(
      launchAgentUsesSafeWorkingDirectory
        ? ok('resident.launchagent_safe_cwd', 'LaunchAgent safe startup cwd', 'plist starts directly in the project cwd with Terminal voice loop disabled')
        : fail('resident.launchagent_safe_cwd', 'LaunchAgent safe startup cwd', 'expected LaunchAgent WorkingDirectory to be the project directory with Terminal voice loop disabled', {
            launchAgentPath,
            installed: fs.existsSync(launchAgentPath),
            workingDirectory: launchAgentWorkingDirectory,
            expectedWorkingDirectory: process.cwd(),
          }),
    );

    const singleInstanceGuard =
      mainSource.includes('requestSingleInstanceLock') &&
      mainSource.includes("app.on('second-instance'") &&
      mainSource.includes("appendAudit('process.second_instance'") &&
      mainSource.includes("summonJavis('second_instance'") &&
      mainSource.includes('HAS_SINGLE_INSTANCE_LOCK') &&
      mainSource.includes('startJavisApp()');
    out.push(
      singleInstanceGuard
        ? ok('resident.single_instance_guard', 'Resident single-instance guard', 'second launches reuse the existing resident and summon the pet instead of starting another API/window process')
        : fail('resident.single_instance_guard', 'Resident single-instance guard', 'expected Electron requestSingleInstanceLock plus second-instance summon handling'),
    );

    const rendererRecoveryGuard =
      mainSource.includes('function scheduleRendererRecovery') &&
      mainSource.includes("appendAudit('renderer.recovery_scheduled'") &&
      mainSource.includes("appendAudit('renderer.recovery_reload'") &&
      mainSource.includes("scheduleRendererRecovery('load_failed'") &&
      mainSource.includes("scheduleRendererRecovery('process_gone'") &&
      mainSource.includes('function resetRendererRecovery') &&
      mainSource.includes("resetRendererRecovery('did_finish_load'") &&
      mainSource.includes('function rendererHealthSnapshot') &&
      mainSource.includes("api.get('/api/renderer/status'") &&
      mainSource.includes('rendererState.lastLoadStartedAt') &&
      mainSource.includes('rendererState.lastLoadedAt') &&
      mainSource.includes('loadRendererIntoWindow');
    out.push(
      rendererRecoveryGuard
        ? ok('resident.renderer_recovery_guard', 'Renderer recovery guard', 'load failures and renderer crashes schedule bounded reloads, reset after load, and expose health')
        : fail('resident.renderer_recovery_guard', 'Renderer recovery guard', 'expected renderer load failure/process-gone recovery plus renderer health exposure'),
    );

    const status = await ctx.api('/api/status');
    const statusVoiceHealth = status.data?.voiceHealth || {};
    const statusLocalVoice = status.data?.localVoice || {};
    const realtimeReady = statusVoiceHealth.status === 'ready';
    out.push(
      status.ok &&
        statusLocalVoice.available === true &&
        statusLocalVoice.input?.endpoint === '/api/voice/command' &&
        statusLocalVoice.safety?.startsMicrophone === false &&
        statusLocalVoice.safety?.usesRealtime === false &&
        statusLocalVoice.safety?.storesRawAudio === false &&
        (realtimeReady
          ? statusLocalVoice.mode === 'standby'
          : statusLocalVoice.mode === 'fallback_ready' && statusLocalVoice.blocker?.active === true)
        ? ok('resident.status_local_voice_consistency', 'Status local voice consistency', `${statusVoiceHealth.status || 'unknown'} -> ${statusLocalVoice.mode}`)
        : fail('resident.status_local_voice_consistency', 'Status local voice consistency', 'GET /api/status must expose localVoice fallback_ready when Realtime is not ready', {
          voiceHealth: statusVoiceHealth,
          localVoice: statusLocalVoice,
        }),
    );

    const recoveryResponse = await ctx.api('/api/realtime/provider/recovery');
    const recovery = recoveryResponse.data?.recovery || {};
    const recoverySteps = Array.isArray(recovery.steps) ? recovery.steps : [];
    out.push(
      recoveryResponse.ok &&
        recovery.version === 1 &&
        typeof recovery.active === 'boolean' &&
        recovery.chatGptSubscriptionCoversApi === false &&
        String(recovery.subscriptionBoundary || '').includes('OpenAI API Platform billing') &&
        recovery.localFallback?.endpoint === '/api/voice/command' &&
        String(recovery.localFallback?.command || '').includes('voice:chat') &&
        recovery.safety?.startsMicrophone === false &&
        recovery.safety?.usesRealtime === false &&
        recovery.safety?.storesRawAudio === false &&
        (!recovery.billingLikely || recoverySteps.some((step) => step.id === 'open_api_billing' && step.url))
        ? ok('resident.realtime_provider_recovery', 'Realtime provider recovery plan', `${recovery.kind || 'ready'} · active=${recovery.active} · steps=${recoverySteps.length}`)
        : fail('resident.realtime_provider_recovery', 'Realtime provider recovery plan', 'expected safe Realtime recovery payload with API billing boundary and local fallback', {
            recovery,
            status: recoveryResponse.status,
          }),
    );

    const appSource = fs.readFileSync('src/App.tsx', 'utf8');
    const startupCheckIndex = appSource.indexOf('const startupBlock = await readRealtimeStartupBlock().catch');
    const getUserMediaIndex = appSource.indexOf('navigator.mediaDevices.getUserMedia');
    out.push(
      appSource.includes('runRealtimeProviderRecoveryProbe') &&
        appSource.includes('shouldRetryRealtimeProviderBeforeMic') &&
        appSource.includes("source: 'renderer_startup_recovery'") &&
        appSource.includes('/api/realtime/provider/probe') &&
        appSource.includes('成功后才会打开麦克风') &&
        startupCheckIndex >= 0 &&
        getUserMediaIndex > startupCheckIndex
        ? ok('resident.pet_realtime_startup_probe_gate', 'Pet Realtime startup recovery gate', 'renderer retries a no-mic provider probe before getUserMedia when provider health is recoverable')
        : fail('resident.pet_realtime_startup_probe_gate', 'Pet Realtime startup recovery gate', 'expected renderer startup to verify provider with a no-mic probe before opening the microphone'),
    );

    return out;
  },
};
