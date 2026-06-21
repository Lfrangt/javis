import fs from 'node:fs';
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
        voiceStandby.local?.safety?.startsMicrophone === false &&
        voiceStandby.local?.safety?.usesRealtime === false &&
        voiceStandby.local?.safety?.storesRawAudio === false &&
        voiceStandby.safety?.storesRawAudio === false &&
        voiceStandbyCui.status === 0 &&
        voiceStandbyCui.stdout.includes('JAVIS Voice Standby') &&
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
    const petWakeHandoff = p.wake?.handoff || {};
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
            /local no-mic voice\/text loop is ready/i.test(String(traffic.reason || '')) &&
            !/^Routed work needs attention:/i.test(String(traffic.reason || '')))) &&
        localVoice.input?.endpoint === '/api/voice/command' &&
        localVoice.input?.historyEndpoint === '/api/voice/history' &&
        localVoice.input?.openLoopEndpoint === '/api/voice/open-local-loop' &&
        String(localVoice.input?.cliCommand || '').includes('npm run voice') &&
        String(localVoice.input?.openLoopCommand || '').includes('npm run voice:chat') &&
        String(localVoice.input?.historyCommand || '').includes('--print-voice-history') &&
        ['open_local_voice_loop', 'start_realtime_voice'].includes(localVoiceInteraction.capsuleClick) &&
        localVoiceInteraction.keepsPetCompact === true &&
        (localVoice.mode === 'fallback_ready'
          ? localVoiceInteraction.opensTerminal === true &&
            localVoiceInteraction.startsMicrophone === false &&
            localVoiceInteraction.usesRealtime === false &&
            localVoiceInteraction.endpoint === '/api/voice/open-local-loop'
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

    const resident = await ctx.api('/api/resident/status');
    const res = resident.data?.resident;
    out.push(
      resident.ok && res
        ? ok('resident.launchagent', 'LaunchAgent status', `installed=${res.installed} loaded=${res.loaded}${res.pid ? ` pid=${res.pid}` : ''} matchesProject=${res.matchesProject}`)
        : warn('resident.launchagent', 'LaunchAgent status', `GET /api/resident/status ${resident.status} ${resident.error || ''}`),
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
