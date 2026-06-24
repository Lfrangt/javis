import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { ok, warn, fail } from '../_client.mjs';

const OPENAI_KEY_SYNC_STATUSES = new Set(['loaded', 'restart_required', 'loaded_from_process_env', 'missing', 'unknown']);

function noOpenAiSecretLeak(value) {
  return !String(value || '').includes('sk-');
}

function openAiKeySyncLooksSafe(keySync = {}) {
  return keySync.version === 1 &&
    OPENAI_KEY_SYNC_STATUSES.has(String(keySync.status || '')) &&
    keySync.safety?.readOnly === true &&
    keySync.safety?.callsOpenAI === false &&
    keySync.safety?.createsSpendLease === false &&
    keySync.safety?.startsMicrophone === false &&
    keySync.safety?.usesRealtime === false &&
    keySync.safety?.exposesSecretValues === false &&
    keySync.safety?.fingerprintOnly === true &&
    typeof keySync.configuredAtStartup === 'boolean' &&
    typeof keySync.envFile?.openAiApiKeyPresent === 'boolean' &&
    typeof keySync.requiresRestart === 'boolean' &&
    noOpenAiSecretLeak(JSON.stringify(keySync));
}

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

    const wakeBeforeCount = Number(w?.triggerCount || 0);
    const wakeTriggerResponse = await ctx.api('/api/wake/trigger', {
      method: 'POST',
      body: {
        source: 'eval_resident_wake_trigger',
        phrase: 'JAVIS eval wake trigger',
      },
    });
    const wakeTrigger = wakeTriggerResponse.data?.wake || {};
    const wakeTriggerSafety = wakeTriggerResponse.data?.safety || {};
    const wakeTriggerHandoff = wakeTrigger.handoff || {};
    out.push(
      wakeTriggerResponse.ok &&
        wakeTriggerResponse.data?.ok === true &&
        wakeTrigger.pending === true &&
        wakeTrigger.lastSource === 'eval_resident_wake_trigger' &&
        wakeTrigger.lastPhrase === 'JAVIS eval wake trigger' &&
        Number(wakeTrigger.triggerCount || 0) >= wakeBeforeCount + 1 &&
        wakeTriggerHandoff.ready === true &&
        ['local_voice_fallback', 'realtime_or_local'].includes(wakeTriggerHandoff.mode) &&
        wakeTriggerHandoff.safety?.readOnly === true &&
        wakeTriggerHandoff.safety?.startsMicrophone === false &&
        wakeTriggerHandoff.safety?.usesRealtime === false &&
        wakeTriggerHandoff.safety?.storesRawAudio === false &&
        wakeTriggerSafety.wakeOnly === true &&
        wakeTriggerSafety.startsMicrophone === false &&
        wakeTriggerSafety.usesRealtime === false &&
        wakeTriggerSafety.opensTerminal === false &&
        wakeTriggerSafety.executesCommand === false &&
        wakeTriggerSafety.mutatesFiles === false &&
        wakeTriggerSafety.storesRawAudio === false &&
        wakeTriggerSafety.storesScreenImage === false
        ? ok('resident.wake_trigger', 'Wake trigger contract', `${wakeTrigger.lastSource} · handoff=${wakeTriggerHandoff.mode} · no mic/terminal/action`)
        : fail('resident.wake_trigger', 'Wake trigger contract', 'wake trigger must only mark a pending wake and return a safe handoff without starting microphone, Realtime, Terminal, commands, or file mutations', {
          status: wakeTriggerResponse.status,
          body: wakeTriggerResponse.data,
        }),
    );

    const guide = await ctx.api('/api/setup/guide');
    const g = guide.data?.guide;
    out.push(
      guide.ok && g
        ? ok('resident.setup', 'Setup guide', `overall=${g.overall} · ${(g.steps || []).length} step(s) · next=${g.nextStep?.label || g.nextStep?.id || 'none'}`)
        : warn('resident.setup', 'Setup guide', `GET /api/setup/guide ${guide.status} ${guide.error || ''}`),
    );

    const watchdogCheck = spawnSync('npm', ['run', 'resident:watchdog:check', '--', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
      },
    });
    let watchdogState = null;
    try {
      const jsonStart = String(watchdogCheck.stdout || '').indexOf('{');
      watchdogState = JSON.parse(String(watchdogCheck.stdout || '').slice(jsonStart));
    } catch {}
    out.push(
      watchdogCheck.status === 0 &&
        watchdogState?.status === 'healthy' &&
        watchdogState?.safety?.localHealthOnly === true &&
        watchdogState?.safety?.callsOpenAi === false &&
        watchdogState?.safety?.startsMicrophone === false &&
        watchdogState?.safety?.capturesScreen === false &&
        watchdogState?.safety?.mutatesUserFiles === false
        ? ok('resident.watchdog_check', 'Resident watchdog health check', `healthy · api=${watchdogState.apiPort} · pid=${watchdogState.pid || 'unknown'} · ${watchdogState.elapsedMs}ms`)
        : fail('resident.watchdog_check', 'Resident watchdog health check', 'watchdog dry-run should prove local health without side effects', {
          status: watchdogCheck.status,
          stdout: String(watchdogCheck.stdout || '').slice(0, 2000),
          stderr: String(watchdogCheck.stderr || '').slice(0, 2000),
        }),
    );

    const recoveryBundleResponse = await ctx.api('/api/setup/recovery-bundle');
    const bundle = recoveryBundleResponse.data?.bundle || {};
    const bundleRaw = JSON.stringify(bundle);
    const bundleVoiceStandby = bundle.voice?.standby || {};
    const bundleLocalVoice = bundle.voice?.localFallback || {};
    const bundleRealtimeKind = bundle.voice?.realtime?.recovery?.kind || bundle.voice?.realtime?.kind || '';
    const bundleTapToSummon = bundle.pet?.window?.tapToSummon || {};
    const bundlePolicy = bundle.automation?.policy || {};
    const bundleAllow = bundlePolicy.allow || {};
    const bundlePermissions = Array.isArray(bundle.permissions) ? bundle.permissions : [];
    const bundleCapabilities = Array.isArray(bundle.automation?.capabilities) ? bundle.automation.capabilities : [];
    const bundleFreeNextActions = Array.isArray(bundle.freeNextActions) ? bundle.freeNextActions : [];
    const bundleFreeNextIds = new Set(bundleFreeNextActions.map((action) => action.id));
    const setupBundleCui = spawnSync(process.execPath, ['scripts/config-cui.cjs', '--print-setup-recovery-bundle'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const setupBundleCuiOutput = String(setupBundleCui.stdout || '');
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
        bundle.resident?.watchdog?.installed === true &&
        bundle.resident?.watchdog?.loaded === true &&
        bundle.resident?.watchdog?.ready === true &&
        bundle.resident?.watchdog?.safety?.callsOpenAi === false &&
        bundle.resident?.watchdog?.safety?.startsMicrophone === false &&
        bundle.resident?.watchdog?.safety?.capturesScreen === false &&
        bundle.endpoints?.residentWatchdog === '/api/resident/status' &&
        bundle.commands?.residentWatchdog?.includes('resident:watchdog:check') &&
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
        bundleTapToSummon.version === 1 &&
        bundleTapToSummon.endpoint === '/api/window/summon' &&
        bundleTapToSummon.localInputDefault === true &&
        bundleTapToSummon.realtimeTapAllowed === false &&
        bundleTapToSummon.currentAction?.id === 'open_compact_local_input' &&
        bundleTapToSummon.currentAction?.mode === 'compose' &&
        bundleTapToSummon.currentAction?.startsMicrophone === false &&
        bundleTapToSummon.currentAction?.usesRealtime === false &&
        bundleTapToSummon.safety?.residentStartsMicrophone === false &&
        bundleTapToSummon.safety?.residentUsesRealtime === false &&
        bundleTapToSummon.safety?.opensTerminal === false &&
        bundleTapToSummon.safety?.realtimeReadyMayStartRendererVoice === false &&
        bundleTapToSummon.safety?.realtimeTapRequiresExplicitEnv === true &&
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
        bundleFreeNextIds.has('free:local_voice') &&
        bundleFreeNextIds.has('free:status_board') &&
        bundleFreeNextIds.has('free:capabilities') &&
        bundleFreeNextIds.has('free:browser_control') &&
        bundleFreeNextActions.every((action) =>
          action.noCost === true &&
          action.readOnly === true &&
          action.startsMicrophone === false &&
          action.usesRealtime === false &&
          action.callsOpenAi === false &&
          action.startsWorkers === false &&
          action.executesActions === false &&
          action.mutatesFiles === false
        ) &&
        setupBundleCui.status === 0 &&
        setupBundleCuiOutput.includes('Zero-cost now') &&
        setupBundleCuiOutput.includes('npm run board -- --no-open') &&
        setupBundleCuiOutput.includes('npm run browser:control') &&
        setupBundleCuiOutput.includes('npm run config -- --print-capabilities --include-next') &&
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
          cui: {
            status: setupBundleCui.status,
            stdout: setupBundleCuiOutput.slice(0, 1600),
            stderr: String(setupBundleCui.stderr || '').slice(0, 1200),
          },
        }),
	    );

	    const overnightResponse = await ctx.api('/api/overnight/status');
	    const overnight = overnightResponse.data?.overnight || {};
	    const overnightRaw = JSON.stringify(overnight);
	    const overnightSpendGuard = overnight.openAiSpendGuard || {};
	    const overnightSpendZeroLocked = Boolean(
	      overnightSpendGuard.emergencyZeroSpendLock === true ||
	        (overnightSpendGuard.hardSpendLock === true &&
	          overnightSpendGuard.mode === 'off' &&
	          Number(overnightSpendGuard.dailyRequestLimit || 0) === 0),
	    );
	    const overnightSpendManualGuarded = Boolean(
	      overnightSpendGuard.mode === 'manual' &&
	        overnightSpendGuard.hardSpendLock === false &&
	        Number(overnightSpendGuard.dailyRequestLimit || 0) > 0 &&
	        Number(overnightSpendGuard.unattendedDailyRequestLimit || 0) === 0 &&
	        overnightSpendGuard.allowAutopilotCloud === false &&
	        overnightSpendGuard.allowRendererStartupProbe === false &&
	        overnightSpendGuard.requireSpendConfirmationPhrase === true &&
	        overnightSpendGuard.requireSpendLease === true,
	    );
	    const overnightSpendPostureOk = Boolean(
	      overnightSpendGuard.egressGuardEnabled === true &&
	        overnightSpendGuard.safety?.unscopedOpenAiEgressBlocked === true &&
	        (overnightSpendZeroLocked ||
	          (overnightSpendManualGuarded && ['unsafe_cloud', 'attention'].includes(overnight.status))),
	    );
	    const overnightPreparePreviewResponse = await ctx.api('/api/overnight/prepare', {
	      method: 'POST',
	      body: {
	        execute: false,
	        source: 'eval_resident_overnight_preview',
	      },
	    });
	    const overnightPreparePreview = overnightPreparePreviewResponse.data || {};
	    const overnightCui = spawnSync('npm', ['run', 'overnight'], {
	      cwd: process.cwd(),
	      encoding: 'utf8',
	      timeout: 20000,
	      env: {
	        ...process.env,
	        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
	      },
	    });
	    out.push(
	      overnightResponse.ok &&
	        overnight.version === 1 &&
	        ['ready', 'needs_keep_awake', 'unsafe_cloud', 'blocked', 'attention'].includes(overnight.status) &&
	        typeof overnight.readyForOvernight === 'boolean' &&
	        overnight.endpoints?.status === '/api/overnight/status' &&
	        overnight.endpoints?.prepare === '/api/overnight/prepare' &&
        overnight.commands?.status === 'npm run overnight' &&
        overnight.commands?.prepare === 'npm run overnight:start' &&
        overnight.commands?.openAiSpend === 'npm run openai:spend' &&
        overnight.commands?.openAiIncident === 'npm run openai:incident' &&
        overnight.commands?.openAiLockdown === 'npm run openai:lockdown' &&
        overnight.commands?.residentWatchdog === 'npm run resident:watchdog:check' &&
        overnight.endpoints?.openAiSpendIncident === '/api/openai/spend-incident-report' &&
	        typeof overnight.resident?.loaded === 'boolean' &&
	        overnight.resident?.watchdog?.loaded === true &&
	        overnight.resident?.watchdog?.ready === true &&
	        overnight.resident?.watchdog?.safety?.callsOpenAi === false &&
	        overnight.resident?.watchdog?.safety?.startsMicrophone === false &&
	        overnight.resident?.watchdog?.safety?.capturesScreen === false &&
	        typeof overnight.keepAwake?.active === 'boolean' &&
	        overnightSpendPostureOk &&
	        ['local_fallback_ready', 'realtime_ready'].includes(overnight.voice?.standby?.mode) &&
	        typeof overnight.autopilot?.enabled === 'boolean' &&
	        overnight.autopilot?.safety?.enabledByOvernight === false &&
	        overnight.autopilot?.safety?.startsAutomaticallyFromPrepare === false &&
	        overnight.progress?.counts &&
	        typeof overnight.blockers?.count === 'number' &&
	        overnight.safety?.readOnly === true &&
	        overnight.safety?.callsOpenAi === false &&
	        overnight.safety?.startsMicrophone === false &&
	        overnight.safety?.usesRealtime === false &&
	        overnight.safety?.capturesScreen === false &&
	        overnight.safety?.startsWorkers === false &&
	        overnight.safety?.enablesAutopilot === false &&
	        overnight.safety?.mutatesUserFiles === false &&
	        overnight.safety?.changesLaunchdJob === false &&
	        !/sk-[A-Za-z0-9_-]{16,}/.test(overnightRaw) &&
	        !overnightRaw.includes('imageDataUrl')
	        ? ok('resident.overnight_status', 'Overnight resident status pack', `${overnight.status} · keepAwake=${overnight.keepAwake?.active ? 'active' : 'off'} · cloud=${overnightSpendGuard.mode}/${overnightSpendGuard.dailyRequestLimit}`)
	        : fail('resident.overnight_status', 'Overnight resident status pack', 'expected overnight pack with resident, keep-awake, explicit spend posture, voice fallback, progress, blockers, autopilot posture, and safety contract', {
	          status: overnightResponse.status,
	          overnight,
	        }),
	    );
	    out.push(
	      overnightPreparePreviewResponse.ok &&
	        overnightPreparePreview.ok === true &&
	        overnightPreparePreview.executed === false &&
	        overnightPreparePreview.preview === true &&
	        overnightPreparePreview.keepAwakeResult === null &&
	        overnightPreparePreview.overnight?.version === 1 &&
	        overnightPreparePreview.safety?.callsOpenAi === false &&
	        overnightPreparePreview.safety?.startsMicrophone === false &&
	        overnightPreparePreview.safety?.usesRealtime === false &&
	        overnightPreparePreview.safety?.startsWorkers === false &&
	        overnightPreparePreview.safety?.enablesAutopilot === false &&
	        overnightPreparePreview.safety?.mutatesUserFiles === false &&
	        overnightPreparePreview.safety?.mutatesProjectFiles === false &&
	        overnightPreparePreview.safety?.changesLaunchdJob === false &&
	        overnightCui.status === 0 &&
	        overnightCui.stdout.includes('JAVIS Overnight Resident') &&
	        overnightCui.stdout.includes('calls OpenAI=no') &&
	        overnightCui.stdout.includes('starts mic=no') &&
	        overnightCui.stdout.includes('starts workers=no')
	        ? ok('resident.overnight_prepare_preview', 'Overnight prepare preview/CUI', 'preview and CUI are no-cloud/no-mic/no-worker and make no launchd change')
	        : fail('resident.overnight_prepare_preview', 'Overnight prepare preview/CUI', 'expected overnight prepare preview and npm run overnight to avoid side effects and expose the safety contract', {
	          status: overnightPreparePreviewResponse.status,
	          preview: overnightPreparePreview,
	          cuiStatus: overnightCui.status,
	          stdout: overnightCui.stdout,
	          stderr: overnightCui.stderr,
	        }),
	    );

	    const setupNextPreviewResponse = await ctx.api('/api/setup/next', {
	      method: 'POST',
      body: {
        execute: false,
        source: 'eval_resident_setup_next_preview',
      },
    });
    const setupNextPreview = setupNextPreviewResponse.data || {};
    const setupNextSafety = setupNextPreview.safety || {};
    const setupAction = setupNextPreview.setupAction;
    out.push(
      setupNextPreviewResponse.ok &&
        setupNextPreview.ok === true &&
        setupNextPreview.executed === false &&
        setupNextPreview.previewOnly === true &&
        setupNextPreview.actionResult === null &&
        setupNextSafety.previewOnly === true &&
        setupNextSafety.startsMicrophone === false &&
        setupNextSafety.callsOpenAi === false &&
        setupNextSafety.grantsPermissions === false &&
        setupNextSafety.writesApiKey === false &&
        setupNextSafety.changesActionPolicy === false &&
        setupNextSafety.mutatesFiles === false &&
        setupNextSafety.opensFinder === false &&
        setupNextSafety.opensSystemUi === false &&
        setupNextSafety.opensBrowser === false &&
        (setupAction === null ||
          (setupAction.endpoint === '/api/setup/next' &&
            setupAction.method === 'POST' &&
            setupAction.startsMicrophone === false))
        ? ok('resident.setup_next_preview', 'Setup next preview', setupAction ? `${setupAction.action} · no side effects` : 'ready · no setup action')
        : fail('resident.setup_next_preview', 'Setup next preview', 'execute:false must preview the next setup action without opening UI, mutating files, calling OpenAI, or starting microphone capture', {
          status: setupNextPreviewResponse.status,
          body: setupNextPreview,
        }),
    );

    const voiceStandbyResponse = await ctx.api('/api/voice/standby');
    const voiceStandby = voiceStandbyResponse.data?.standby || {};
    const voiceStandbyPromptPack = voiceStandby.promptPack || {};
    const voiceStandbyInputMode = voiceStandby.inputMode || {};
    const voiceStandbyRetryPolicy = voiceStandby.provider?.retryPolicy || {};
    const voiceStandbyKeySync = voiceStandby.provider?.keySync || {};
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
        voiceStandbyInputMode.mode === 'typed_local_intake' &&
        voiceStandbyInputMode.micDefault === 'off' &&
        voiceStandbyInputMode.startsMuted === true &&
        voiceStandbyInputMode.startsMicrophone === false &&
        voiceStandbyInputMode.usesRealtime === false &&
        voiceStandbyInputMode.callsOpenAI === false &&
        openAiKeySyncLooksSafe(voiceStandbyKeySync) &&
        typeof voiceStandby.spendGuard?.zeroSpendLocked === 'boolean' &&
        (voiceStandby.provider?.status === 'ready' ||
          (voiceStandbyRetryPolicy.active === true &&
            ['spend_locked', 'probe_due', 'cooldown', 'probe_running'].includes(voiceStandbyRetryPolicy.state) &&
            voiceStandbyRetryPolicy.shouldUseLocalFallback === true &&
            voiceStandbyRetryPolicy.safety?.startsMicrophone === false)) &&
        (!bundleRealtimeKind || ['provider_unverified', 'spend_locked'].includes(bundleRealtimeKind) || voiceStandby.provider?.kind === bundleRealtimeKind) &&
        voiceStandby.local?.available === true &&
        voiceStandby.local?.input?.endpoint === '/api/voice/command' &&
        voiceStandby.local?.input?.openLoopEndpoint === '/api/voice/open-local-loop' &&
        voiceStandby.local?.inputMode?.mode === 'typed_local_intake' &&
        typeof voiceStandbyPromptPack.nextUtterance === 'string' &&
        voiceStandbyPromptPack.nextUtterance.length > 0 &&
        Array.isArray(voiceStandbyPromptPack.examples) &&
        voiceStandbyPromptPack.examples.length >= 3 &&
        (voiceStandby.mode !== 'local_fallback_ready' ||
          voiceStandbyPromptPack.settings?.showProgressBoardPrompt === false ||
          voiceStandbyPromptPack.examples.some((example) => String(example.utterance || '').includes('进度看板'))) &&
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
        voiceStandby.safety?.callsOpenAI === false &&
        voiceStandbyCui.status === 0 &&
        voiceStandbyCui.stdout.includes('JAVIS Voice Standby') &&
        voiceStandbyCui.stdout.includes('Input mode: Local typed input') &&
        voiceStandbyCui.stdout.includes('key sync:') &&
        noOpenAiSecretLeak(voiceStandbyCui.stdout) &&
        (voiceStandby.provider?.status === 'ready' || voiceStandbyCui.stdout.includes('retry:')) &&
        voiceStandbyCui.stdout.includes('Try saying') &&
        voiceStandbyCui.stdout.includes('local loop: npm run voice:chat')
        ? ok('resident.voice_standby', 'Voice standby/fallback status', `${voiceStandby.mode} · key=${voiceStandbyKeySync.status} · primary=${voiceStandby.primaryAction.id}`)
        : fail('resident.voice_standby', 'Voice standby/fallback status', 'expected unified voice standby contract plus CUI output', {
          status: voiceStandbyResponse.status,
          voiceStandby,
          cui: voiceStandbyCui.stdout,
          cuiError: voiceStandbyCui.stderr,
          cuiStatus: voiceStandbyCui.status,
        }),
    );

    const promptSettingsBeforeResponse = await ctx.api('/api/voice/prompt-settings');
    const originalProgressBoardPrompt = promptSettingsBeforeResponse.data?.settings?.showProgressBoardPrompt !== false;
    const disablePromptResponse = await ctx.api('/api/voice/prompt-settings', {
      method: 'POST',
      body: {
        source: 'eval_resident_disable_progress_board_prompt',
        showProgressBoardPrompt: false,
      },
    });
    const disabledStandbyResponse = await ctx.api('/api/voice/standby');
    const disabledPromptPack = disabledStandbyResponse.data?.standby?.promptPack || {};
    const enablePromptResponse = await ctx.api('/api/voice/prompt-settings', {
      method: 'POST',
      body: {
        source: 'eval_resident_enable_progress_board_prompt',
        showProgressBoardPrompt: true,
      },
    });
    const enabledStandbyResponse = await ctx.api('/api/voice/standby');
    const enabledStandby = enabledStandbyResponse.data?.standby || {};
    const enabledPromptPack = enabledStandby.promptPack || {};
    await ctx.api('/api/voice/prompt-settings', {
      method: 'POST',
      body: {
        source: 'eval_resident_restore_progress_board_prompt',
        showProgressBoardPrompt: originalProgressBoardPrompt,
      },
    });
    const disabledExamples = Array.isArray(disabledPromptPack.examples) ? disabledPromptPack.examples : [];
    const enabledExamples = Array.isArray(enabledPromptPack.examples) ? enabledPromptPack.examples : [];
    const configSourceForPromptSettings = fs.readFileSync('scripts/config-cui.cjs', 'utf8');
    const mainSourceForPromptSettings = fs.readFileSync('electron/main.cjs', 'utf8');
    const packageJsonForPromptSettings = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const promptSettingsCuiReady =
      mainSourceForPromptSettings.includes("api.get('/api/voice/prompt-settings'") &&
      mainSourceForPromptSettings.includes("api.post('/api/voice/prompt-settings'") &&
      configSourceForPromptSettings.includes('--print-voice-prompt-settings') &&
      configSourceForPromptSettings.includes('--enable-progress-board-prompt') &&
      configSourceForPromptSettings.includes('--disable-progress-board-prompt') &&
      packageJsonForPromptSettings.scripts?.['voice:prompts'] &&
      packageJsonForPromptSettings.scripts?.['voice:prompt-board:on'] &&
      packageJsonForPromptSettings.scripts?.['voice:prompt-board:off'];
    out.push(
      promptSettingsBeforeResponse.ok &&
        disablePromptResponse.ok &&
        disablePromptResponse.data?.settings?.showProgressBoardPrompt === false &&
        disabledStandbyResponse.ok &&
        disabledPromptPack.settings?.showProgressBoardPrompt === false &&
        disabledExamples.every((example) => !String(example.utterance || '').includes('进度看板')) &&
        enablePromptResponse.ok &&
        enablePromptResponse.data?.settings?.showProgressBoardPrompt === true &&
        enabledStandbyResponse.ok &&
        enabledPromptPack.settings?.showProgressBoardPrompt === true &&
        (enabledStandby.mode !== 'local_fallback_ready' ||
          enabledExamples.some((example) => String(example.utterance || '').includes('进度看板'))) &&
        promptSettingsCuiReady
        ? ok('resident.voice_prompt_settings_toggle', 'Voice prompt settings toggle', 'progress-board standby prompt can be disabled/enabled through local API and CUI commands without mic, Realtime, cloud, worker, or action side effects')
        : fail('resident.voice_prompt_settings_toggle', 'Voice prompt settings toggle', 'expected progress-board prompt setting to disable/enable standby prompt examples and expose API/CUI controls', {
          before: promptSettingsBeforeResponse.data,
          disable: disablePromptResponse.data,
          disabledStandby: disabledStandbyResponse.data,
          enable: enablePromptResponse.data,
          enabledStandby: enabledStandbyResponse.data,
          promptSettingsCuiReady,
        }),
    );

    const voiceSetupResponse = await ctx.api('/api/voice/setup');
    const voiceSetup = voiceSetupResponse.data?.setup || voiceSetupResponse.data?.guide || {};
    const voiceSetupChecklist = Array.isArray(voiceSetup.goLiveChecklist) ? voiceSetup.goLiveChecklist : [];
    const voiceSetupKeySync = voiceSetup.provider?.keySync || {};
    const voiceSetupCui = spawnSync('npm', ['run', 'voice:setup'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
      },
    });
    out.push(
      voiceSetupResponse.ok &&
        voiceSetup.version === 1 &&
        voiceSetup.microphone &&
        typeof voiceSetup.microphone.status === 'string' &&
        typeof voiceSetup.microphone.ready === 'boolean' &&
        voiceSetup.provider?.status &&
        openAiKeySyncLooksSafe(voiceSetupKeySync) &&
        voiceSetup.spendGuard?.mode &&
        voiceSetup.localFallback?.endpoint === '/api/voice/command' &&
        voiceSetup.safety?.readOnly === true &&
        voiceSetup.safety?.callsOpenAI === false &&
        voiceSetup.safety?.createsSpendLease === false &&
        voiceSetup.safety?.startsMicrophone === false &&
        voiceSetup.safety?.usesRealtime === false &&
        voiceSetupChecklist.some((item) => item.id === 'microphone_permission' && item.startsMicrophone === false && item.callsOpenAI === false && (item.command === '' || item.command === 'npm run voice:mic')) &&
        voiceSetupChecklist.some((item) => item.id === 'provider_probe_preview' && item.status === 'ready' && item.startsMicrophone === false && item.callsOpenAI === false) &&
        voiceSetupChecklist.some((item) => item.id === 'provider_probe_execute' && item.startsMicrophone === false && item.manualOnly === true) &&
        voiceSetupChecklist.some((item) => item.id === 'live_renderer_voice' && item.startsMicrophone === true && item.manualOnly === true) &&
        voiceSetupCui.status === 0 &&
        voiceSetupCui.stdout.includes('Realtime recovery:') &&
        voiceSetupCui.stdout.includes('Key sync:') &&
        noOpenAiSecretLeak(voiceSetupCui.stdout) &&
        voiceSetupCui.stdout.includes('Microphone:') &&
        voiceSetupCui.stdout.includes('Go-live checklist:') &&
        voiceSetupCui.stdout.includes('No-cost now:') &&
        voiceSetupCui.stdout.includes('Provider probe runbook') &&
        voiceSetupCui.stdout.includes('npm run dogfood:realtime-provider-probe:run') &&
        voiceSetupCui.stdout.includes('execution calls OpenAI=yes') &&
        voiceSetupCui.stdout.includes('execution starts mic=no') &&
        voiceSetupCui.stdout.includes('live voice still needs confirmMic=yes')
        ? ok('resident.voice_setup_checklist', 'Voice setup checklist', `${voiceSetup.status || '-'} · key=${voiceSetupKeySync.status} · mic=${voiceSetup.microphone.status} · checklist=${voiceSetupChecklist.length}`)
        : fail('resident.voice_setup_checklist', 'Voice setup checklist', 'expected read-only voice setup packet with microphone, provider, spend guard, local fallback, and go-live checklist', {
          status: voiceSetupResponse.status,
          setup: voiceSetupResponse.data,
          cui: voiceSetupCui.stdout,
          cuiError: voiceSetupCui.stderr,
          cuiStatus: voiceSetupCui.status,
        }),
    );

    const progressBoardResponse = await ctx.api('/api/progress-board');
    const progressBoard = progressBoardResponse.data?.board || {};
    const boardVoiceSetup = progressBoard.voiceSetup || {};
    const boardVoiceDisplay = boardVoiceSetup.display || {};
    const boardChecklist = Array.isArray(boardVoiceSetup.goLiveChecklist) ? boardVoiceSetup.goLiveChecklist : [];
    const boardTimeline = Array.isArray(progressBoard.timeline) ? progressBoard.timeline : [];
    const boardRecovery = progressBoard.recovery || {};
    const boardHtml = fs.readFileSync('docs/javis-status-board.html', 'utf8');
    const boardCli = spawnSync(process.execPath, ['scripts/open-status-board.cjs', '--no-open', '--url'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const boardCliOutput = String(boardCli.stdout || '');
    const boardCliUnavailable = spawnSync(process.execPath, ['scripts/open-status-board.cjs', '--no-open'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        JAVIS_API_BASE: 'http://127.0.0.1:9',
        JAVIS_BOARD_RETRY_ATTEMPTS: '2',
        JAVIS_BOARD_RETRY_DELAY_MS: '100',
        JAVIS_BOARD_REQUEST_TIMEOUT_MS: '1000',
      },
    });
    const boardCliUnavailableError = String(boardCliUnavailable.stderr || boardCliUnavailable.stdout || '');
    out.push(
      progressBoardResponse.ok &&
        progressBoard.version === 1 &&
        ['ready', 'running', 'warning', 'blocked'].includes(progressBoard.status) &&
        Number.isFinite(Number(progressBoard.performance?.durationMs)) &&
        progressBoard.performance?.parallelReads === true &&
        progressBoard.performance?.skippedDuplicateBrowserReadiness === true &&
        Number(progressBoard.performance?.sectionTimeoutMs || 0) >= 500 &&
        Number(progressBoard.performance?.targetMs || 0) >= 500 &&
        progressBoard.timelineSource?.kind === 'local_audit_tail' &&
        progressBoard.timelineSource?.rawLogsReturned === false &&
        progressBoard.timelineSource?.returnsUserText === false &&
        boardTimeline.length > 0 &&
        boardTimeline.every((item) => typeof item.title === 'string' && typeof item.body === 'string' && !('data' in item) && !('raw' in item)) &&
        boardVoiceSetup.version === 1 &&
        ['ready', 'warning', 'blocked'].includes(boardVoiceSetup.status) &&
        boardVoiceSetup.microphone &&
        typeof boardVoiceSetup.microphone.status === 'string' &&
        typeof boardVoiceSetup.microphone.ready === 'boolean' &&
        boardVoiceSetup.provider?.status &&
        openAiKeySyncLooksSafe(boardVoiceSetup.provider?.keySync || {}) &&
        typeof boardVoiceDisplay.label === 'string' &&
        typeof boardVoiceDisplay.summary === 'string' &&
        boardVoiceDisplay.summary.includes('API key') &&
        typeof boardVoiceDisplay.keySummary === 'string' &&
        boardVoiceDisplay.keySummary.includes('API key') &&
        typeof boardVoiceDisplay.microphoneSummary === 'string' &&
        typeof boardVoiceDisplay.providerSummary === 'string' &&
        typeof boardVoiceDisplay.spendSummary === 'string' &&
        typeof boardVoiceDisplay.nextAction === 'string' &&
        (boardVoiceSetup.status === 'ready' || boardVoiceDisplay.nextAction.includes('provider 检查')) &&
        boardVoiceSetup.spendGuard?.mode &&
        boardVoiceSetup.localFallback?.endpoint === '/api/voice/command' &&
        boardChecklist.some((item) => item.id === 'microphone_permission' && item.displayLabel === '麦克风权限' && item.startsMicrophone === false && item.callsOpenAI === false) &&
        boardChecklist.some((item) => item.id === 'provider_probe_preview' && item.displayDetail?.includes('不打 OpenAI') && item.status === 'ready' && item.startsMicrophone === false && item.callsOpenAI === false) &&
        boardChecklist.some((item) => item.id === 'provider_probe_execute' && item.displayLabel?.includes('no-mic') && item.startsMicrophone === false && item.manualOnly === true) &&
        boardChecklist.some((item) => item.id === 'live_renderer_voice' && item.displayLabel === '启动实时语音' && item.startsMicrophone === true && item.manualOnly === true) &&
        boardVoiceSetup.safety?.readOnly === true &&
        boardVoiceSetup.safety?.callsOpenAI === false &&
        boardVoiceSetup.safety?.createsSpendLease === false &&
        boardVoiceSetup.safety?.startsMicrophone === false &&
        boardVoiceSetup.safety?.usesRealtime === false &&
        boardRecovery.version === 1 &&
        ['ready', 'warning', 'blocked'].includes(boardRecovery.status) &&
        typeof boardRecovery.label === 'string' &&
        typeof boardRecovery.summary === 'string' &&
        typeof boardRecovery.command === 'string' &&
        boardRecovery.previewOnly === true &&
        boardRecovery.executed === false &&
        typeof boardRecovery.gates?.manualOnly === 'boolean' &&
        typeof boardRecovery.gates?.callsOpenAI === 'boolean' &&
        boardRecovery.safety?.readOnly === true &&
        boardRecovery.safety?.callsOpenAi === false &&
        boardRecovery.safety?.createsSpendLease === false &&
        boardRecovery.safety?.startsMicrophone === false &&
        boardRecovery.safety?.usesRealtime === false &&
        boardRecovery.safety?.startsWorkers === false &&
        boardRecovery.safety?.executesActions === false &&
        boardRecovery.safety?.returnsRawLogs === false &&
        progressBoard.safety?.callsOpenAi === false &&
        progressBoard.safety?.startsMicrophone === false &&
        progressBoard.safety?.usesRealtime === false &&
        progressBoard.safety?.startsWorkers === false &&
        progressBoard.safety?.executesActions === false &&
        progressBoard.safety?.returnsRawLogs === false &&
        boardHtml.includes('id="voice-panel"') &&
        boardHtml.includes('id="recovery-panel"') &&
        boardHtml.includes('voice-brief') &&
        boardHtml.includes('renderVoiceSetup') &&
        boardHtml.includes('renderRecovery') &&
        boardHtml.includes('setup.display?.summary') &&
        boardHtml.includes('Key sync') &&
        boardHtml.includes('goLiveChecklist') &&
        boardHtml.includes('下一步恢复') &&
        boardHtml.includes('接口耗时') &&
        boardHtml.includes('不返回原始日志') &&
        boardCli.status === 0 &&
        boardCliOutput.includes('JAVIS Status Board') &&
        boardCliOutput.includes('API: ready') &&
        boardCliOutput.includes('Realtime: API key') &&
        boardCliOutput.includes('Open: no') &&
        boardCliOutput.includes('Safety: no OpenAI/mic/Realtime/workers/actions') &&
        boardCliOutput.includes('file:///') &&
        boardCliUnavailable.status !== 0 &&
        boardCliUnavailableError.includes('JAVIS resident API unavailable after 2 attempt')
        ? ok('resident.progress_board_voice_setup', 'Progress board voice setup panel', `${boardVoiceSetup.rawStatus || boardVoiceSetup.status} · recovery=${boardRecovery.actionId || boardRecovery.label} · checklist=${boardChecklist.length} · timeline=${boardTimeline.length} · safety=no mic/no spend`)
        : fail('resident.progress_board_voice_setup', 'Progress board voice setup panel', 'expected public progress board and HTML to embed sanitized read-only voice setup/go-live/recovery evidence without OpenAI, mic, Realtime, workers, or actions', {
          status: progressBoardResponse.status,
          board: progressBoard,
          htmlHasVoicePanel: boardHtml.includes('id="voice-panel"'),
          htmlHasRecoveryPanel: boardHtml.includes('id="recovery-panel"'),
          cli: {
            status: boardCli.status,
            stdout: boardCliOutput.slice(0, 1600),
            stderr: String(boardCli.stderr || '').slice(0, 1200),
            unavailableStatus: boardCliUnavailable.status,
            unavailable: boardCliUnavailableError.slice(0, 1200),
          },
        }),
    );

    const sessionPromptGoal = `eval voice standby session prompt ${Date.now()}`;
    let cleanupSessionPromptId = '';
    try {
      const sessionsBeforePrompt = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
      let activePromptSession = sessionsBeforePrompt.data?.sessions?.active || null;
      if (!activePromptSession?.id) {
        const startPromptSession = await ctx.api('/api/sessions/start', {
          method: 'POST',
          body: {
            goal: sessionPromptGoal,
            source: 'eval_voice_standby_session_prompt',
          },
          timeoutMs: 10000,
        });
        activePromptSession = startPromptSession.data?.session || null;
        cleanupSessionPromptId = activePromptSession?.id || '';
      }
      const sessionStandbyResponse = await ctx.api('/api/voice/standby', { timeoutMs: 10000 });
      const sessionStandby = sessionStandbyResponse.data?.standby || {};
      const sessionPetResponse = await ctx.api('/api/pet/status', { timeoutMs: 10000 });
      const sessionPet = sessionPetResponse.data || {};
      const sessionWakeResponse = await ctx.api('/api/wake/status', { timeoutMs: 10000 });
      const sessionWake = sessionWakeResponse.data?.wake || {};
      const standbyExamples = sessionStandby.promptPack?.examples || [];
      const petExamples = sessionPet.localVoice?.promptPack?.examples || [];
      const wakeExamples = sessionWake.handoff?.promptPack?.examples || [];
      out.push(
        activePromptSession?.id &&
          sessionStandbyResponse.ok &&
          sessionPetResponse.ok &&
          sessionWakeResponse.ok &&
          sessionStandby.promptPack?.nextUtterance === '会话汇报' &&
          standbyExamples.some((example) => example.id === 'session_check_in' && example.utterance === '会话汇报') &&
          standbyExamples.some((example) => example.id === 'session_note') &&
          petExamples.some((example) => example.id === 'session_check_in') &&
          wakeExamples.some((example) => example.id === 'session_check_in') &&
          sessionStandby.promptPack?.safety?.startsMicrophone === false &&
          sessionPet.localVoice?.promptPack?.safety?.startsMicrophone === false &&
          sessionWake.handoff?.promptPack?.safety?.startsMicrophone === false
          ? ok('resident.voice_standby_session_prompt', 'Voice standby session-aware prompt pack', `${activePromptSession.title || activePromptSession.goal} -> 会话汇报`)
          : fail('resident.voice_standby_session_prompt', 'Voice standby session-aware prompt pack', 'active work sessions should rank session check-in prompts across standby, pet, and wake surfaces without mic/realtime', {
              activePromptSession,
              sessionStandby: sessionStandby.promptPack,
              sessionPet: sessionPet.localVoice?.promptPack,
              sessionWake: sessionWake.handoff?.promptPack,
            }),
      );
    } catch (error) {
      out.push(fail('resident.voice_standby_session_prompt', 'Voice standby session-aware prompt pack', error instanceof Error ? error.message : String(error)));
    } finally {
      if (cleanupSessionPromptId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionPromptId)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_standby_session_prompt_cleanup',
            note: 'Cleaning up eval-created voice standby session prompt.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionPromptId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
    }

    const voiceStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '实时语音连上了吗，为什么现在不能直接说话？',
        execute: false,
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
        voiceStatusCommand.executed === false &&
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

    const residentHealthCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: 'JAVIS 你还活着吗，常驻服务和 watchdog 自恢复状态怎么样？',
        execute: false,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_health_local_command',
      },
      timeoutMs: 10000,
    });
    const residentHealthCommand = residentHealthCommandResponse.data || {};
    const residentHealthRoute = residentHealthCommand.route || {};
    const residentHealth = residentHealthRoute.data?.residentHealth || {};
    out.push(
      residentHealthCommandResponse.ok &&
        residentHealthCommand.ok === true &&
        residentHealthCommand.executed === false &&
        residentHealthRoute.localCommand?.intent === 'resident_health' &&
        residentHealthRoute.decision?.localCommand === 'resident_health' &&
        String(residentHealthRoute.output || '').includes('Resident health:') &&
        String(residentHealthRoute.output || '').includes('Self-heal:') &&
        residentHealth.version === 1 &&
        residentHealth.resident?.loaded === true &&
        residentHealth.resident?.matchesProject === true &&
        residentHealth.watchdog?.installed === true &&
        residentHealth.safety?.readOnly === true &&
        residentHealth.safety?.callsOpenAI === false &&
        residentHealth.safety?.startsMicrophone === false &&
        residentHealth.safety?.usesRealtime === false &&
        residentHealth.safety?.capturesScreen === false &&
        residentHealth.safety?.startsWorkers === false &&
        residentHealthRoute.contextPlan?.needs?.residentState === true &&
        residentHealthRoute.contextPlan?.needs?.screen === false &&
        residentHealthRoute.contextPlan?.needs?.accessibility === false
        ? ok('resident.health_local_command', 'Resident health local command', `resident=${residentHealth.status || '-'} · watchdog=${residentHealth.watchdog?.ready ? 'ready' : 'attention'}`)
        : fail('resident.health_local_command', 'Resident health local command', 'expected resident/watchdog health question to route to a read-only resident_health fast path', {
          status: residentHealthCommandResponse.status,
          body: residentHealthCommand,
        }),
    );

    const perceptionStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你现在在看我的屏幕吗，最近看到什么窗口？',
        execute: false,
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
        perceptionStatusCommand.executed === false &&
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

    const recentActivityCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '我刚才在电脑上干嘛？',
        execute: false,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_recent_activity_local_command',
      },
      timeoutMs: 10000,
    });
    const recentActivityCommand = recentActivityCommandResponse.data || {};
    const recentActivityRoute = recentActivityCommand.route || {};
    const recentActivity = recentActivityRoute.data?.activity || {};
    out.push(
      recentActivityCommandResponse.ok &&
        recentActivityCommand.ok === true &&
        recentActivityRoute.localCommand?.intent === 'recent_activity' &&
        recentActivityRoute.decision?.localCommand === 'recent_activity' &&
        String(recentActivityRoute.output || '').includes('Recent activity:') &&
        recentActivity.ok === true &&
        recentActivity.kind === 'recent_activity' &&
        recentActivity.privacy?.localOnly === true &&
        recentActivity.privacy?.metadataOnly === true &&
        recentActivity.privacy?.noRawScreenshots === true &&
        recentActivity.privacy?.noClipboardText === true &&
        recentActivity.privacy?.noPageBodies === true &&
        recentActivity.safety?.readOnly === true &&
        recentActivity.safety?.capturesScreenNow === false &&
        recentActivity.safety?.startsMicrophone === false &&
        recentActivity.safety?.usesRealtime === false &&
        recentActivity.safety?.returnsBrowserPageText === false &&
        recentActivityRoute.contextPlan?.needs?.recentActivity === true &&
        recentActivityRoute.contextPlan?.needs?.screen === false &&
        recentActivityRoute.contextPlan?.needs?.browserPage === false
        ? ok('resident.recent_activity_local_command', 'Recent activity local command', `${recentActivity.count || 0} metadata sample(s) · ${recentActivity.recent?.length || 0} segment(s)`)
        : fail('resident.recent_activity_local_command', 'Recent activity local command', 'expected natural recent-activity question to route to a read-only metadata-only recent_activity fast path', {
          status: recentActivityCommandResponse.status,
          body: recentActivityCommand,
        }),
    );

    const approvalStatusCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '现在有没有需要我确认的审批，哪些动作卡住了？',
        execute: false,
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
        approvalStatusCommand.executed === false &&
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
        execute: false,
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
    const blockerRunbook = blockerStatus.realtimeProviderRunbook || blockerStatus.voice?.providerProbe?.runbook || {};
    const blockerRunbookReady = blockerStatus.voice?.status === 'ready' || (
      blockerRunbook.interactiveCommand === 'npm run dogfood:realtime-provider-probe:run' &&
      blockerRunbook.phrase === 'SPEND OPENAI' &&
      blockerRunbook.safety?.executionCallsOpenAi === true &&
      blockerRunbook.safety?.executionStartsMicrophone === false &&
      String(blockerStatusRoute.output || '').includes('Realtime verify: npm run dogfood:realtime-provider-probe:run') &&
      String(blockerStatusRoute.output || '').includes('Phrase: SPEND OPENAI') &&
      String(blockerStatusRoute.output || '').includes('starts mic=no') &&
      String(blockerStatusRoute.output || '').includes('execution calls OpenAI=yes')
    );
    out.push(
      blockerStatusCommandResponse.ok &&
        blockerStatusCommand.ok === true &&
        blockerStatusCommand.executed === false &&
        blockerStatusRoute.localCommand?.intent === 'blocker_status' &&
        blockerStatusRoute.decision?.localCommand === 'blocker_status' &&
        String(blockerStatusRoute.output || '').includes('Blockers:') &&
        blockerRunbookReady &&
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

    const blockerItems = Array.isArray(blockerStatus.blockers) ? blockerStatus.blockers : [];
    const explicitAutopilotBlockersResponse = await ctx.api('/api/blockers?includeAutopilot=true&jobLimit=5&workflowLimit=5&approvalLimit=5', {
      timeoutMs: 10000,
    });
    const explicitAutopilotBlockers = explicitAutopilotBlockersResponse.data?.blockers || {};
    const explicitAutopilotItems = Array.isArray(explicitAutopilotBlockers.blockers) ? explicitAutopilotBlockers.blockers : [];
    const autopilotDetailPresent = blockerStatus.autopilot &&
      typeof blockerStatus.autopilot.enabled === 'boolean' &&
      Array.isArray(blockerStatus.autopilot.waitingFor);
    out.push(
      !blockerItems.some((item) => item.id === 'autopilot_waiting' || item.id === 'autopilot_disabled') &&
        autopilotDetailPresent &&
        (
          !blockerStatus.autopilot.enabled ||
          blockerStatus.autopilot.canActNow ||
          (
            explicitAutopilotBlockersResponse.ok &&
            explicitAutopilotItems.some((item) => item.id === 'autopilot_waiting' || item.id === 'autopilot_disabled')
          )
        )
        ? ok('resident.blocker_status_autopilot_quiet_default', 'Blocker status keeps autopilot quiet by default', 'autopilot wait details remain in the payload and are opt-in as blocker rows')
        : fail('resident.blocker_status_autopilot_quiet_default', 'Blocker status keeps autopilot quiet by default', 'expected default blockers to omit autopilot_waiting while preserving explicit autopilot evidence', {
            blockerItems,
            autopilot: blockerStatus.autopilot,
            explicitAutopilotItems,
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

    const browserRecoveryRecommended = String(unblockPreviewApi.recommendedAction?.id || '').startsWith('browser_recovery:');
    const browserRecoveryBlocker = Array.isArray(blockerStatus.blockers)
      ? blockerStatus.blockers.find((item) => item.id === 'browser_recovery')
      : null;
    out.push(
      !browserRecoveryRecommended ||
        (
          browserRecoveryBlocker &&
          browserRecoveryBlocker.source === 'browser_recovery' &&
          /Google Chrome|browser|route:/i.test(String(browserRecoveryBlocker.next || browserRecoveryBlocker.summary || ''))
        )
        ? ok('resident.blocker_status_browser_recovery', 'Blocker status browser recovery', browserRecoveryRecommended ? 'browser recovery is surfaced as the actionable blocker' : 'no browser recovery candidate active')
        : fail('resident.blocker_status_browser_recovery', 'Blocker status browser recovery', 'expected /api/blockers and blocker_status voice path to surface browser_recovery when work-next recommends opening or retrying supported browser work', {
          recommendedAction: unblockPreviewApi.recommendedAction,
          blockers: blockerStatus.blockers,
        }),
    );

    const unblockPreviewCommandResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '怎么解除这些阻塞，下一步能安全准备什么？',
        execute: false,
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
    const unblockRunbook = unblockPreview.realtimeProviderRunbook || unblockPreview.blockers?.realtimeProviderRunbook || unblockPreview.blockers?.voice?.providerProbe?.runbook || {};
    const unblockRunbookReady = unblockPreview.blockers?.voice?.status === 'ready' || (
      unblockRunbook.interactiveCommand === 'npm run dogfood:realtime-provider-probe:run' &&
      unblockRunbook.phrase === 'SPEND OPENAI' &&
      unblockRunbook.safety?.executionCallsOpenAi === true &&
      unblockRunbook.safety?.executionStartsMicrophone === false &&
      String(unblockPreviewRoute.output || '').includes('Realtime verify: npm run dogfood:realtime-provider-probe:run') &&
      String(unblockPreviewRoute.output || '').includes('Phrase: SPEND OPENAI') &&
      String(unblockPreviewRoute.output || '').includes('starts mic=no') &&
      String(unblockPreviewRoute.output || '').includes('execution calls OpenAI=yes')
    );
    out.push(
      unblockPreviewCommandResponse.ok &&
        unblockPreviewCommand.ok === true &&
        unblockPreviewCommand.executed === false &&
        unblockPreviewRoute.localCommand?.intent === 'unblock_preview' &&
        unblockPreviewRoute.decision?.localCommand === 'unblock_preview' &&
        String(unblockPreviewRoute.output || '').includes('Unblock preview:') &&
        unblockRunbookReady &&
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

    const safeNextWithoutRealtimeResponse = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '除了实时语音，下一步可以安全推进什么？',
        execute: false,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_resident_unblock_preview_without_realtime',
      },
      timeoutMs: 10000,
    });
    const safeNextWithoutRealtime = safeNextWithoutRealtimeResponse.data || {};
    const safeNextRoute = safeNextWithoutRealtime.route || {};
    const safeNextPreview = safeNextRoute.data?.unblockPreview || {};
    out.push(
      safeNextWithoutRealtimeResponse.ok &&
        safeNextWithoutRealtime.ok === true &&
        safeNextWithoutRealtime.executed === false &&
        safeNextRoute.localCommand?.intent === 'unblock_preview' &&
        safeNextRoute.decision?.localCommand === 'unblock_preview' &&
        String(safeNextRoute.output || '').includes('Unblock preview:') &&
        safeNextPreview.version === 1 &&
        safeNextPreview.safety?.readOnly === true &&
        safeNextPreview.safety?.startsMicrophone === false &&
        safeNextPreview.safety?.usesRealtime === false &&
        safeNextPreview.safety?.startsWorkers === false &&
        safeNextPreview.safety?.executesWorkNext === false
        ? ok('resident.unblock_preview_without_realtime', 'Unblock preview skips Realtime blocker', '除了实时语音 routes to read-only unblock_preview instead of generic quick routing')
        : fail('resident.unblock_preview_without_realtime', 'Unblock preview skips Realtime blocker', 'expected safe-next-without-Realtime phrasing to route to unblock_preview without side effects', {
          status: safeNextWithoutRealtimeResponse.status,
          body: safeNextWithoutRealtime,
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
        voiceStandbyPrimary.safety?.wouldUseRealtime === Boolean(voiceStandbyPrimary.primaryAction?.usesRealtime) &&
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
        voiceStandbyWorkNextResult.safety?.wouldUseRealtime === Boolean(voiceStandbyWorkNextResult.primaryAction?.usesRealtime) &&
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

    const win = await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'pet',
        focus: false,
      },
      timeoutMs: 10000,
    });
    const win2 = win.data?.window;
    out.push(
      win.ok &&
        win2 &&
        win2.mode === 'pet' &&
        win2.surface === 'visible' &&
        win2.visible === true &&
        win2.hidden === false &&
        win2.closed === false &&
        win2.classroomMode?.available === true &&
        win2.controls?.hide === '/api/window/hide' &&
        win2.controls?.show === '/api/window/show' &&
        win2.controls?.close === '/api/window/close' &&
        win2.parkCorner === 'notch' &&
        Number(win2.width || 0) <= 148 &&
        Number(win2.height || 0) <= 40 &&
        win2.hotkeyRegistered === true &&
        win2.summonHotkeyRegistered === true &&
        win2.captureHotkeyRegistered === true
        ? ok('resident.window', 'Pet window + hotkeys', `mode=${win2.mode} ${win2.width}x${win2.height} surface=${win2.surface} park=${win2.parkCorner} hotkey=${win2.hotkeyRegistered ? 'on' : 'off'} summon=${win2.summonHotkeyRegistered ? 'on' : 'off'} capture=${win2.captureHotkeyRegistered ? 'on' : 'off'}`)
        : warn('resident.window', 'Pet window + hotkeys', `POST /api/window/mode pet ${win.status} ${win.error || ''}`, { window: win2 }),
    );

    const classroomEnable = await ctx.api('/api/window/classroom', {
      method: 'POST',
      body: {
        enabled: true,
        source: 'eval_resident_classroom',
        reason: 'eval_classroom',
      },
      timeoutMs: 10000,
    });
    const classroomEnabledWindow = classroomEnable.data?.window || {};
    const classroomState = await ctx.api('/api/window/classroom', { timeoutMs: 10000 });
    const classroomStateWindow = classroomState.data?.window || {};
    const classroomFile = classroomState.data?.windowStateFile || classroomEnabledWindow.windowStateFile || '';
    let persistedClassroom = {};
    try {
      persistedClassroom = classroomFile && fs.existsSync(classroomFile)
        ? JSON.parse(fs.readFileSync(classroomFile, 'utf8'))
        : {};
    } catch {
      persistedClassroom = {};
    }
    const classroomDisable = await ctx.api('/api/window/classroom', {
      method: 'POST',
      body: {
        enabled: false,
        source: 'eval_resident_classroom_restore',
        show: true,
        focus: false,
      },
      timeoutMs: 10000,
    });
    const classroomRestoredWindow = classroomDisable.data?.window || {};
    out.push(
      classroomEnable.ok &&
        classroomEnabledWindow.surface === 'hidden' &&
        classroomEnabledWindow.visible === false &&
        classroomEnabledWindow.classroomMode?.active === true &&
        classroomEnabledWindow.classroomMode?.persisted === true &&
        classroomEnable.data?.safety?.startsMicrophone === false &&
        classroomEnable.data?.safety?.usesRealtime === false &&
        classroomEnable.data?.safety?.callsOpenAI === false &&
        classroomState.ok &&
        classroomStateWindow.classroomMode?.active === true &&
        persistedClassroom.hidden === true &&
        persistedClassroom.classroomMode?.active === true &&
        classroomDisable.ok &&
        classroomRestoredWindow.surface === 'visible' &&
        classroomRestoredWindow.visible === true &&
        classroomRestoredWindow.classroomMode?.active === false
        ? ok('resident.classroom_mode', 'Classroom mode hides pet', `hidden=${classroomEnabledWindow.surface} restored=${classroomRestoredWindow.surface}`)
        : fail('resident.classroom_mode', 'Classroom mode hides pet', 'expected classroom mode to hide the pet persistently without microphone, Realtime, OpenAI, workers, or resident shutdown', {
          enableStatus: classroomEnable.status,
          enable: classroomEnable.data,
          stateStatus: classroomState.status,
          state: classroomState.data,
          persistedClassroom,
          disableStatus: classroomDisable.status,
          disable: classroomDisable.data,
        }),
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
        composeWindow.composeAutoPark?.enabled === true &&
        composeWindow.composeAutoPark?.active === true &&
        Number(composeWindow.composeAutoPark?.timeoutMs || 0) >= 60000 &&
        restoredWindowResponse.ok &&
        restoredWindow.mode === 'pet' &&
        Number(restoredWindow.width || 0) <= 148 &&
        Number(restoredWindow.height || 0) <= 40 &&
        restoredWindow.composeAutoPark?.active === false
        ? ok('resident.window_compose', 'Compose window mode', `compose=${composeWindow.width}x${composeWindow.height} restored=${restoredWindow.width}x${restoredWindow.height}`)
        : fail('resident.window_compose', 'Compose window mode', 'expected quiet local-input compose window to open and restore to pet', {
          composeStatus: composeWindowResponse.status,
          composeWindow,
          restoreStatus: restoredWindowResponse.status,
          restoredWindow,
        }),
    );

    {
      const wakeBeforeSummonResponse = await ctx.api('/api/wake/status', { timeoutMs: 10000 });
      const wakeBeforeSummonCount = Number(wakeBeforeSummonResponse.data?.wake?.triggerCount || 0);
      const summonWindowResponse = await ctx.api('/api/window/summon', {
        method: 'POST',
        body: {
          source: 'eval_resident_summon_compose',
          wake: true,
        },
        timeoutMs: 10000,
      });
      const summonWindow = summonWindowResponse.data?.window || {};
      const summonLocalInputDefault = summonWindowResponse.data?.localInputDefault === true;
      const summonRealtimeTapAllowed = summonWindowResponse.data?.realtimeTapAllowed === true;
      const summonTap = summonWindowResponse.data?.tapToSummon || summonWindow.tapToSummon || {};
      const wakeAfterSummonCount = Number(summonWindowResponse.data?.wake?.triggerCount || 0);
      const summonRestoreResponse = await ctx.api('/api/window/mode', {
        method: 'POST',
        body: {
          mode: 'pet',
          focus: false,
        },
        timeoutMs: 10000,
      });
      out.push(
        wakeBeforeSummonResponse.ok &&
          summonWindowResponse.ok &&
          summonLocalInputDefault === true &&
          summonRealtimeTapAllowed === false &&
          summonWindow.mode === 'compose' &&
          summonTap.version === 1 &&
          summonTap.enabled === true &&
          summonTap.registered === true &&
          summonTap.endpoint === '/api/window/summon' &&
          summonTap.localInputDefault === true &&
          summonTap.realtimeTapAllowed === false &&
          summonTap.currentAction?.id === 'open_compact_local_input' &&
          summonTap.currentAction?.mode === 'compose' &&
          summonTap.currentAction?.startsMicrophone === false &&
          summonTap.currentAction?.usesRealtime === false &&
          summonTap.safety?.residentStartsMicrophone === false &&
          summonTap.safety?.residentUsesRealtime === false &&
          summonTap.safety?.opensTerminal === false &&
          summonTap.safety?.fallbackStartsMicrophone === false &&
          summonTap.safety?.fallbackUsesRealtime === false &&
          summonTap.safety?.fallbackCallsOpenAi === false &&
          summonTap.safety?.realtimeReadyMayStartRendererVoice === false &&
          wakeAfterSummonCount === wakeBeforeSummonCount &&
          summonRestoreResponse.ok &&
          summonRestoreResponse.data?.window?.mode === 'pet'
          ? ok('resident.summon_compose', 'Summon opens local input by default', `${summonWindow.width}x${summonWindow.height} · action=${summonTap.currentAction?.id || '-'} · wakeDelta=${wakeAfterSummonCount - wakeBeforeSummonCount}`)
          : fail('resident.summon_compose', 'Summon opens local input by default', 'expected summon/tap path to open compose and suppress wake/realtime unless explicitly enabled', {
            wakeBefore: wakeBeforeSummonResponse.data,
            status: summonWindowResponse.status,
            body: summonWindowResponse.data,
            summonTap,
            restoreStatus: summonRestoreResponse.status,
            restoreBody: summonRestoreResponse.data,
          }),
      );
    }

    const summonMainSource = fs.readFileSync('electron/main.cjs', 'utf8');
    out.push(
      summonMainSource.includes('const opensLocalInput = tapToSummon.currentAction?.id ===') &&
        summonMainSource.includes("applyWindowMode(opensLocalInput ? 'compose' : 'pet'") &&
        summonMainSource.includes('const wakeTriggered = options.wake !== false && !opensLocalInput') &&
        summonMainSource.includes('TAP_TO_REALTIME_ENABLED')
        ? ok('resident.summon_compose_static', 'Summon local-input default wiring', 'summon uses compose and suppresses wake unless realtime tap is explicitly allowed')
        : fail('resident.summon_compose_static', 'Summon local-input default wiring', 'expected summonJavis to default tap-to-summon to local compose input with wake suppressed'),
    );

    const terminalSource = fs.readFileSync('electron/main.cjs', 'utf8');
    out.push(
      terminalSource.includes('function isLocalVoiceTerminalLoopCommand') &&
        terminalSource.includes("appendAudit('terminal.voice_loop_blocked'") &&
        terminalSource.includes('voice_terminal_loop_disabled_product_default') &&
        terminalSource.includes('Blocked Terminal voice loop and opened JAVIS local input inside the desktop pet instead.') &&
        terminalSource.includes("opensTerminal: false")
        ? ok('resident.voice_terminal_loop_guard', 'Voice Terminal loop guard', 'app-level Terminal opener blocks voice:chat loops and redirects to compose')
        : fail('resident.voice_terminal_loop_guard', 'Voice Terminal loop guard', 'expected app-level terminal opener to block voice:chat loops by default'),
    );

    const stopResidentSource = fs.readFileSync('scripts/stop-resident-processes.cjs', 'utf8');
    out.push(
      stopResidentSource.includes('repeat with t in tabs of w') &&
        stopResidentSource.includes('contents of t contains "JAVIS Local Voice Command Loop"') &&
        stopResidentSource.includes('contents of t contains "npm run voice:chat"') &&
        stopResidentSource.includes('contents of t contains "local-voice-command-dogfood"')
        ? ok('resident.voice_terminal_cleanup_all_tabs', 'Voice Terminal cleanup scans all tabs', 'resident stop/restart closes stale voice:chat Terminal windows even when the loop is not the selected tab')
        : fail('resident.voice_terminal_cleanup_all_tabs', 'Voice Terminal cleanup scans all tabs', 'expected stop-resident cleanup to inspect every Terminal tab for stale voice:chat loops'),
    );
    const packageSource = fs.readFileSync('package.json', 'utf8');
    out.push(
      stopResidentSource.includes('const voiceTerminalsOnly') &&
        stopResidentSource.includes("cliArgs.has('--voice-terminals')") &&
        stopResidentSource.includes('if (voiceTerminalsOnly)') &&
        stopResidentSource.includes('Closed stale JAVIS voice Terminal window(s)') &&
        packageSource.includes('"voice:cleanup": "node scripts/stop-resident-processes.cjs --voice-terminals"')
        ? ok('resident.voice_terminal_cleanup_only_flag', 'Voice Terminal cleanup-only flag', 'voice:cleanup closes stale voice terminals without stopping the resident app')
        : fail('resident.voice_terminal_cleanup_only_flag', 'Voice Terminal cleanup-only flag', 'expected --voice-terminals to clean voice Terminal windows without entering resident stop flow'),
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
    const trafficLegend = Array.isArray(traffic.legend) ? traffic.legend : [];
    const trafficColors = new Set(['red', 'yellow', 'green']);
    const trafficStates = new Set(['idle', 'fallback_ready', 'watching', 'waking', 'connecting', 'listening', 'working', 'attention', 'blocked']);
    const trafficUrgency = new Set(['quiet', 'ambient', 'active', 'interrupt']);
    const trafficPulses = new Set(['off', 'slow', 'live', 'attention']);
    const voiceFallback = p.voiceHealth?.fallback || {};
    const localVoice = p.localVoice || {};
    const localVoiceInteraction = localVoice.interaction || {};
    const localVoiceInputMode = localVoice.inputMode || {};
    const localVoicePromptPack = localVoice.promptPack || {};
    const petWakeHandoff = p.wake?.handoff || {};
    const petWakePromptPack = petWakeHandoff.promptPack || {};
    const petTapToSummon = p.window?.tapToSummon || {};
    const localBlocker = localVoice.blocker || {};
    const fallbackBlocker = voiceFallback.blocker || {};
    const wakeBlocker = petWakeHandoff.blocker || {};
    const raw = JSON.stringify(p);
    const rawBytes = Buffer.byteLength(raw, 'utf8');
    const contractMinHeadroom = Number(contract.minHeadroomBytes || 0);
    const contractHeadroom = Number(contract.headroomBytes || 0);
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
        contract.outputBytes === rawBytes &&
        contractMinHeadroom >= 500 &&
        contractHeadroom === contract.maxTargetBytes - rawBytes &&
        contractHeadroom >= contractMinHeadroom &&
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
        typeof traffic.meaning === 'string' &&
        traffic.meaning.length > 0 &&
        typeof traffic.nextAction === 'string' &&
        traffic.nextAction.length > 0 &&
        trafficLegend.length === 3 &&
        ['green', 'yellow', 'red'].every((color) => trafficLegend.some((item) =>
          item.color === color &&
          typeof item.meaning === 'string' &&
          item.meaning.length > 0 &&
          typeof item.nextAction === 'string' &&
          item.nextAction.length > 0,
        )) &&
        typeof traffic.accessibleLabel === 'string' &&
        traffic.accessibleLabel.includes('JAVIS') &&
        traffic.accessibleLabel.includes('Next:') &&
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
        localVoiceInputMode.mode === 'typed_local_intake' &&
        localVoiceInputMode.micDefault === 'off' &&
        localVoiceInputMode.startsMuted === true &&
        localVoiceInputMode.openMicToggle === false &&
        localVoiceInputMode.startsMicrophone === false &&
        localVoiceInputMode.usesRealtime === false &&
        localVoiceInputMode.callsOpenAI === false &&
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
        localVoice.safety?.callsOpenAI === false &&
        localVoice.safety?.storesRawAudio === false &&
        localVoice.safety?.storesScreenImage === false &&
        localVoice.safety?.storesClipboardText === false &&
        localVoice.safety?.storesAccessibilityNodes === false &&
        (localVoice.history?.latest === null || typeof localVoice.history?.latest?.transcriptPreview === 'string') &&
        petWakeHandoff.ready === true &&
        ['local_voice_fallback', 'realtime_or_local'].includes(petWakeHandoff.mode) &&
        petWakeHandoff.input?.endpoint === '/api/voice/command' &&
        petWakeHandoff.inputMode?.mode === 'typed_local_intake' &&
        petWakeHandoff.inputMode?.micDefault === 'off' &&
        petWakePromptPack.nextUtterance === localVoicePromptPack.nextUtterance &&
        String(petWakeHandoff.input?.cliCommand || '').includes('npm run voice') &&
        (petWakeHandoff.mode === 'local_voice_fallback' ? wakeBlocker.active === true : typeof wakeBlocker.active === 'boolean') &&
        petWakeHandoff.safety?.readOnly === true &&
        petWakeHandoff.safety?.startsMicrophone === false &&
        petWakeHandoff.safety?.usesRealtime === false &&
        petWakeHandoff.safety?.storesRawAudio === false &&
        p.window?.mode &&
        petTapToSummon.version === 1 &&
        p.window?.summonHotkey &&
        petTapToSummon.registered === true &&
        petTapToSummon.endpoint === '/api/window/summon' &&
        petTapToSummon.localInputDefault === true &&
        petTapToSummon.realtimeTapAllowed === false &&
        petTapToSummon.currentAction?.id === 'open_compact_local_input' &&
        petTapToSummon.safety?.residentStartsMicrophone === false &&
        petTapToSummon.safety?.residentUsesRealtime === false &&
        petTapToSummon.safety?.opensTerminal === false &&
        petTapToSummon.safety?.fallbackCallsOpenAi === false &&
        petTapToSummon.safety?.realtimeReadyMayStartRendererVoice === false &&
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
        ? ok('resident.pet_status_lightweight', 'Pet status lightweight payload', `${traffic.color}/${traffic.state} · ${p.presence.mode} · localVoice=${localVoice.mode} · ${rawBytes}/${contract.maxTargetBytes} bytes · headroom=${contractHeadroom}`)
        : fail('resident.pet_status_lightweight', 'Pet status lightweight payload', `expected slim pet payload, got ${pet.status}`, {
          forbiddenTopLevel,
          unexpectedTopLevel,
          hasImage: Boolean(p.screen?.imageDataUrl),
          hasRuntimeDataDir: Boolean(p.runtime?.dataDir),
          rawBytes,
          contractHeadroom,
          contractMinHeadroom,
          contract,
          pet: p.pet,
          traffic,
          voiceFallback,
          localVoice,
          localVoiceInteraction,
          localBlocker,
          petWakeHandoff,
          petTapToSummon,
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
        localLoopDefaultExecute.terminalLoop?.disabledByResident === true &&
        localLoopDefaultExecute.terminalLoop?.manualOnly === true &&
        localLoopDefaultExecute.terminalLoop?.opensTerminal === false &&
        localLoopDefaultExecute.terminalLoop?.requiresExplicitConfirmation === true &&
        localLoopDefaultRestore.ok &&
        localLoopDefaultRestore.data?.window?.mode === 'pet'
        ? ok('resident.local_voice_loop_no_terminal_default', 'Local voice loop no-Terminal default', 'execute opens compose and marks Terminal loop as manual-only')
        : fail('resident.local_voice_loop_no_terminal_default', 'Local voice loop no-Terminal default', 'expected execute=true to open compose and avoid Terminal from resident/API entrypoints', {
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
        localLoopExplicitTerminal.terminalLoop?.disabledByResident === true &&
        localLoopExplicitTerminal.terminalLoop?.manualOnly === true &&
        localLoopExplicitTerminal.terminalLoop?.opensTerminal === false &&
        localLoopExplicitTerminal.terminalLoop?.requestedTerminal === true &&
        localLoopExplicitRestore.ok &&
        localLoopExplicitRestore.data?.window?.mode === 'pet'
        ? ok('resident.local_voice_loop_terminal_api_disabled', 'Local voice loop Terminal API disabled', 'even explicit Terminal requests redirect to compose from resident/API')
        : fail('resident.local_voice_loop_terminal_api_disabled', 'Local voice loop Terminal API disabled', 'expected explicit Terminal request to stay in pet compose and mark the CLI loop as manual-only', {
          status: localLoopExplicitTerminalResponse.status,
          body: localLoopExplicitTerminal,
          restoreStatus: localLoopExplicitRestore.status,
          restoreBody: localLoopExplicitRestore.data,
        }),
    );

    const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
    const loopSource = fs.readFileSync('scripts/local-voice-command-dogfood.mjs', 'utf8');
    const installSource = fs.readFileSync('scripts/install-launch-agent.cjs', 'utf8');
    const launcherSource = fs.readFileSync('scripts/resident-launcher.cjs', 'utf8');
    const bootstrapSource = fs.readFileSync('electron/bootstrap.cjs', 'utf8');
    const stopSource = fs.readFileSync('scripts/stop-resident-processes.cjs', 'utf8');
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const hasLocalLoopApiTerminalBlock =
      mainSource.includes('function openLocalVoiceLoop') &&
      mainSource.includes('allowTerminal') &&
      mainSource.includes('confirmTerminal') &&
      mainSource.includes("reason: 'terminal_loop_disabled_product_default'") &&
      mainSource.includes('terminalLoopManualOnly: true') &&
      mainSource.includes('disabledByResident: true') &&
      mainSource.includes('manualOnly: true') &&
      mainSource.includes('openLocalVoiceInput(sourceText, { execute: true })') &&
      mainSource.includes("appendAudit('local_voice_loop.redirected_to_compose'") &&
      mainSource.includes('opensTerminal: false') &&
      !mainSource.includes("auditType: 'local_voice_loop.opened'") &&
      !mainSource.includes('localVoiceLoopTerminalWindowSnapshot') &&
      !mainSource.includes('LOCAL_VOICE_LOOP_STATE_FILE') &&
      !mainSource.includes('JAVIS_DEV_ALLOW_TERMINAL_VOICE_LOOP') &&
      loopSource.includes('LOCAL_VOICE_CHAT_LOCK_FILE') &&
      loopSource.includes('acquireLocalVoiceChatLock') &&
      loopSource.includes('localVoiceChatLockOwnerActive') &&
      loopSource.includes('reusedExisting: true') &&
      stopSource.includes('local-voice-chat.lock.json') &&
      stopSource.includes('cleanupLocalVoiceLoopArtifacts') &&
      packageJson.scripts?.['resident:stop'] === 'node scripts/stop-resident-processes.cjs';
    out.push(
      hasLocalLoopApiTerminalBlock
        ? ok('resident.local_voice_loop_api_terminal_disabled', 'Local voice loop API Terminal disabled', 'resident/API loop requests always redirect to compose; manual CLI loop keeps its own lock')
        : fail('resident.local_voice_loop_api_terminal_disabled', 'Local voice loop API Terminal disabled', 'expected /api/voice/open-local-loop to have no Terminal-opening path and keep manual CLI lock cleanup'),
    );

    const hasResidentLaunchNoTerminalLoop =
      installSource.includes('const launchAgentWorkingDirectory = homeDir') &&
      installSource.includes("const residentLauncherScript = path.join(repoRoot, 'scripts', 'resident-launcher.cjs')") &&
      installSource.includes('function buildMainProcessBundleForResident') &&
      installSource.includes("const rolldownExecutable = path.join(repoRoot, 'node_modules', '.bin', 'rolldown')") &&
      installSource.includes("const electronMainBundle = path.join(repoRoot, 'electron', 'main.bundle.cjs')") &&
      installSource.includes("'--external'") &&
      installSource.includes("'electron'") &&
      installSource.includes('<string>${xmlEscape(process.execPath)}</string>') &&
      installSource.includes('<string>${xmlEscape(residentLauncherScript)}</string>') &&
      !installSource.includes("electron', 'cli.js'") &&
      !installSource.includes("const command = 'npm run start:desktop'") &&
      !installSource.includes('<string>-c</string>') &&
      !installSource.includes('<string>-lc</string>') &&
      installSource.includes("JAVIS_ALLOW_TERMINAL_VOICE_LOOP: 'false'") &&
      installSource.includes('residentLaunchEnv') &&
      installSource.includes('watchdogLaunchEnv') &&
      installSource.includes('plistEnvironmentXml(residentLaunchEnv)') &&
      installSource.includes('plistEnvironmentXml(watchdogLaunchEnv)') &&
      installSource.includes("JAVIS_REPO_ROOT: repoRoot") &&
      installSource.includes("JAVIS_OPENAI_PARANOID_ZERO_SPEND: 'true'") &&
      launcherSource.includes('waitForHealthyChild') &&
      launcherSource.includes('resident API did not become healthy') &&
      launcherSource.includes("JAVIS_RESIDENT_LAUNCHER: 'true'") &&
      launcherSource.includes('JAVIS_RESIDENT_LAUNCHER_ATTEMPT') &&
      launcherSource.includes('startupAttempts') &&
      launcherSource.includes('startupRetryDelayMs') &&
      launcherSource.includes('spawnElectronChild') &&
      launcherSource.includes('startup attempt') &&
      launcherSource.includes("spawn(electronExecutable, [repoRoot]") &&
      bootstrapSource.includes("main.bundle.cjs") &&
      bootstrapSource.includes("readFileBufferInChunksSync") &&
      launcherSource.includes("path: '/api/health?lite=watchdog'") &&
      launcherSource.includes("stdio: ['ignore', 'inherit', 'inherit']") &&
      launcherSource.includes("stopChild('SIGTERM')") &&
      installSource.includes('JAVIS_RESIDENT_STARTUP_ATTEMPTS') &&
      installSource.includes('JAVIS_RESIDENT_STARTUP_RETRY_DELAY_MS') &&
      !launcherSource.includes("shell: true") &&
      stopSource.includes('isProjectLocalVoiceLoopProcess') &&
      stopSource.includes('npm run voice:chat') &&
      stopSource.includes('local-voice-command-dogfood\\.mjs.*--chat');
    out.push(
      hasResidentLaunchNoTerminalLoop
        ? ok('resident.launch_agent_no_terminal_loop', 'Launch agent avoids Terminal voice loop', 'resident startup uses home cwd, health-gated launcher, JAVIS_REPO_ROOT, and clears stale local voice loops')
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

    const hasWakeStatusLoop =
      loopSource.includes("command === 'wake'") &&
      loopSource.includes('/api/wake/status') &&
      loopSource.includes('formatLoopWakeStatus') &&
      loopSource.includes('does not start wake engine, microphone, Realtime');
    out.push(
      hasWakeStatusLoop
        ? ok('resident.local_voice_loop_wake_status', 'Local voice loop wake-status command', '/wake reads trigger/engine/handoff state without starting wake engine, microphone, Realtime, or actions')
        : fail('resident.local_voice_loop_wake_status', 'Local voice loop wake-status command', 'expected /wake slash command to read /api/wake/status with read-only safety copy'),
    );

    const hasPromptSuggestionsFastPath =
      mainSource.includes('function naturalPromptSuggestionsLocalCommand') &&
      mainSource.includes("intent: 'prompt_suggestions'") &&
      mainSource.includes('formatPromptSuggestionsForLocalCommand') &&
      mainSource.includes('不调用云模型') &&
      loopSource.includes("command === 'try'") &&
      loopSource.includes('formatLoopPromptSuggestions') &&
      loopSource.includes('does not start microphone, Realtime, Terminal, screen capture, or model calls.');
    out.push(
      hasPromptSuggestionsFastPath
        ? ok('resident.voice_prompt_suggestions_fast_path', 'Voice prompt suggestions fast path', 'natural prompt questions and /try read the standby prompt pack without model, microphone, or Terminal')
        : fail('resident.voice_prompt_suggestions_fast_path', 'Voice prompt suggestions fast path', 'expected local prompt_suggestions intent and /try to read /api/voice/standby safely'),
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

    const hasPetBrowserRecoveryQuieting =
      mainSource.includes('function isQuietBrowserRecoveryAttentionRoute') &&
      mainSource.includes('const petAttentionRoutes = activeRoutes.filter((route) => !isQuietBrowserRecoveryAttentionRoute(route))') &&
      mainSource.includes('browserUnavailableRouteBlocker(route, route)') &&
      mainSource.includes('!isQuietBrowserRecoveryAttentionRoute(route)') &&
      mainSource.includes('function browserUnavailableRecoveryAction');
    out.push(
      hasPetBrowserRecoveryQuieting
        ? ok('resident.pet_browser_recovery_quieting', 'Pet browser recovery quieting', 'browser-window recovery stays in work-next while routine blocked routes are filtered from pet attention')
        : fail('resident.pet_browser_recovery_quieting', 'Pet browser recovery quieting', 'expected browser-window-unavailable routes to stay recoverable without making the pet interruptive'),
    );

    const hasBlockerBrowserRecovery =
      mainSource.includes("blockerItem(\n      'browser_recovery'") &&
      mainSource.includes('const browserBlockedRoutes = blockedRoutes.filter((route) => browserUnavailableRouteBlocker(route, route))') &&
      mainSource.includes('const nonBrowserBlockedRoutes = browserRecovery') &&
      mainSource.includes('browserRecovery.browserRecovery?.next');
    out.push(
      hasBlockerBrowserRecovery
        ? ok('resident.blocker_browser_recovery_static', 'Blocker browser recovery wiring', 'browser-window blockers become an actionable blocker_status recovery item instead of only generic routed-work noise')
        : fail('resident.blocker_browser_recovery_static', 'Blocker browser recovery wiring', 'expected blockerStatusSnapshot to split browser recovery from generic blocked_routes'),
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

    const hasContextAwarePromptPack =
      mainSource.includes('function localVoicePromptContextSnapshot') &&
      mainSource.includes('browserActivitySnapshot({ limit: 3 })') &&
      mainSource.includes('appUiCacheStateSnapshot()') &&
      mainSource.includes('activeRoutingSnapshot(8)') &&
      mainSource.includes("localVoicePromptExample('progress_board', '打开本地进度看板，告诉我现在卡在哪里')") &&
      mainSource.includes("localVoicePromptExample('continue', '继续刚才那个')") &&
      mainSource.includes("localVoicePromptExample('browser_dom', '当前网页有哪些按钮？')") &&
      mainSource.includes("localVoicePromptExample('app_ui', '这个界面能点什么？')");
    out.push(
      hasContextAwarePromptPack
        ? ok('resident.context_aware_voice_prompt_pack', 'Context-aware voice prompt pack', 'standby prompt examples are ranked from local work, browser, app UI, and continuation context without new capture')
        : fail('resident.context_aware_voice_prompt_pack', 'Context-aware voice prompt pack', 'expected promptPack to use existing work/browser/app/UI context before static examples'),
    );

    const hasMultiSlotAppUiCache =
      mainSource.includes('const APP_UI_CACHE_MAX_ENTRIES') &&
      mainSource.includes('const accessibilityTreeCache = new Map()') &&
      mainSource.includes('function rememberAccessibilityTree') &&
      mainSource.includes('function findCachedAccessibilityTree') &&
      mainSource.includes("cacheSlot: 'lru'") &&
      mainSource.includes('entries: accessibilityTreeCache.size') &&
      mainSource.includes('slots=${cache.entries ?? 0}/${cache.maxEntries');
    out.push(
      hasMultiSlotAppUiCache
        ? ok('resident.app_ui_multi_slot_cache', 'App UI multi-slot cache', 'Accessibility outline cache keeps bounded app/window slots so ambient prewarm does not evict the previous current-window outline')
        : fail('resident.app_ui_multi_slot_cache', 'App UI multi-slot cache', 'expected bounded app/window AX outline cache with LRU lookup and CUI slot count'),
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
      launchAgentWorkingDirectory === os.homedir() &&
      launchAgentPlist.includes('/scripts/resident-launcher.cjs') &&
      !launchAgentPlist.includes('/node_modules/electron/cli.js') &&
      launchAgentPlist.includes(process.cwd()) &&
      launchAgentPlist.includes('<key>JAVIS_REPO_ROOT</key>') &&
      launchAgentPlist.includes('<key>JAVIS_ALLOW_TERMINAL_VOICE_LOOP</key>') &&
      launchAgentPlist.includes('<string>false</string>') &&
      !launchAgentPlist.includes('<string>-c</string>') &&
      !launchAgentPlist.includes('<string>-lc</string>');
    out.push(
      launchAgentUsesSafeWorkingDirectory
        ? ok('resident.launchagent_safe_cwd', 'LaunchAgent safe startup cwd', 'plist starts from home, passes JAVIS_REPO_ROOT, and launches the health-gated resident launcher with Terminal voice loop disabled')
        : fail('resident.launchagent_safe_cwd', 'LaunchAgent safe startup cwd', 'expected LaunchAgent WorkingDirectory to avoid protected project cwd and pass JAVIS_REPO_ROOT to the health-gated resident launcher', {
            launchAgentPath,
            installed: fs.existsSync(launchAgentPath),
            workingDirectory: launchAgentWorkingDirectory,
            expectedWorkingDirectory: os.homedir(),
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
    const statusConversation = status.data?.conversation || {};
    const statusPresence = status.data?.presence || {};
    const statusAttention = statusPresence.attention || {};
    const statusMicrophone = statusConversation.microphone || {};
    const realtimeReady = statusVoiceHealth.status === 'ready';
    out.push(
      status.ok &&
        statusLocalVoice.available === true &&
        statusLocalVoice.input?.endpoint === '/api/voice/command' &&
        statusLocalVoice.inputMode?.mode === 'typed_local_intake' &&
        statusLocalVoice.inputMode?.micDefault === 'off' &&
        statusLocalVoice.inputMode?.startsMuted === true &&
        statusLocalVoice.inputMode?.startsMicrophone === false &&
        statusLocalVoice.inputMode?.usesRealtime === false &&
        statusLocalVoice.inputMode?.callsOpenAI === false &&
        statusLocalVoice.safety?.startsMicrophone === false &&
        statusLocalVoice.safety?.usesRealtime === false &&
        statusLocalVoice.safety?.callsOpenAI === false &&
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
    const quietZeroSpendFallback = statusVoiceHealth.kind === 'spend_locked' && statusLocalVoice.mode === 'fallback_ready';
    const setupAttentionActive =
      statusPresence.mode === 'setup_blocked' ||
      ['setup_blocked', 'setup_degraded'].includes(statusAttention.topReason?.id);
    out.push(
      status.ok &&
        (!quietZeroSpendFallback ||
          setupAttentionActive ||
          (statusPresence.mode === 'fallback_ready' &&
            statusPresence.label === 'Local fallback ready' &&
            statusAttention.topReason?.id !== 'setup_degraded' &&
            !String(statusAttention.summary || '').includes('Setup needs attention')))
        ? ok('resident.zero_spend_presence_quiet', 'Zero-spend presence quiet', quietZeroSpendFallback ? 'zero-spend Realtime warning stays in local fallback ready presence' : 'Realtime is not in zero-spend fallback mode')
        : fail('resident.zero_spend_presence_quiet', 'Zero-spend presence quiet', 'zero-spend Realtime fallback should not surface as Needs attention in presence/attention', {
          voiceHealth: statusVoiceHealth,
          localVoice: statusLocalVoice,
          presence: statusPresence,
          attention: statusAttention,
        }),
    );

    const blockerCui = spawnSync('npm', ['run', 'config', '--', '--print-blockers'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
      },
    });
    const blockerOutput = `${blockerCui.stdout || ''}\n${blockerCui.stderr || ''}`;
    const expectedMicState = statusConversation.active
      ? statusConversation.micMode === 'push' ? 'armed' : 'open'
      : 'off';
    out.push(
      status.ok &&
        statusMicrophone.active === Boolean(statusConversation.active) &&
        statusMicrophone.state === expectedMicState &&
        statusMicrophone.requestedMode === (statusConversation.micMode || 'open') &&
        statusMicrophone.startsMicrophone === Boolean(statusConversation.active) &&
        statusMicrophone.usesRealtime === Boolean(statusConversation.active) &&
        blockerCui.status === 0 &&
        !blockerOutput.includes('Voice: idle · mic open') &&
        (statusConversation.active || blockerOutput.includes('Voice: idle · mic off'))
        ? ok('resident.conversation_effective_mic_state', 'Conversation effective microphone state', `${statusConversation.status || 'idle'} · mic=${statusMicrophone.state}`)
        : fail('resident.conversation_effective_mic_state', 'Conversation effective microphone state', 'idle resident voice status must report actual microphone off instead of configured open mode', {
          conversation: statusConversation,
          microphone: statusMicrophone,
          blockerOutput: blockerOutput.slice(0, 1200),
        }),
    );
    const blockerHasSetupAttention =
      /Setup needs attention|Screen capture|Accessibility|setup_blocked|setup_degraded/i.test(blockerOutput);
    out.push(
      blockerCui.status === 0 &&
        (!quietZeroSpendFallback ||
          blockerHasSetupAttention ||
          (blockerOutput.includes('Presence: Local fallback ready') &&
            !blockerOutput.includes('Attention: watching · pet yellow · notify no · Setup needs attention')))
        ? ok('resident.zero_spend_cui_quiet', 'Zero-spend CUI quiet presence', quietZeroSpendFallback ? 'CUI shows local fallback ready without setup attention noise' : 'Realtime is not in zero-spend fallback mode')
        : fail('resident.zero_spend_cui_quiet', 'Zero-spend CUI quiet presence', 'CUI blocker output should show local fallback ready and avoid setup attention noise when zero-spend lock is intentional', {
          blockerOutput: blockerOutput.slice(0, 2000),
          quietZeroSpendFallback,
        }),
    );

    const spendGuardResponse = await ctx.api('/api/openai/spend-guard');
    const spendGuard = spendGuardResponse.data?.spendGuard || {};
    const egressGuard = spendGuardResponse.data?.egressGuard || {};
    const spendForensics = spendGuardResponse.data?.forensics || {};
    const spendKeySync = spendGuard.runtimeKeyIsolation?.keySync || {};
    const spendGuardTotalBefore = Number(spendGuard.counts?.total || 0);
    const spendGuardBlockedBefore = Number(spendGuard.counts?.blocked || 0);
    const spendGuardZeroLocked = Boolean(
      spendForensics.zeroLocked === true ||
        spendGuard.emergencyZeroSpendLock === true ||
        (spendGuard.hardSpendLock === true &&
          spendGuard.mode === 'off' &&
          Number(spendGuard.dailyRequestLimit || 0) === 0 &&
          Number(spendGuard.unattendedDailyRequestLimit || 0) === 0),
    );
    const spendGuardManualGuarded = Boolean(
      !spendGuardZeroLocked &&
        spendGuard.mode === 'manual' &&
        spendGuard.hardSpendLock === false &&
        Number(spendGuard.dailyRequestLimit || 0) > 0 &&
        Number(spendGuard.remaining?.total || 0) > 0 &&
        Number(spendGuard.unattendedDailyRequestLimit || 0) === 0 &&
        spendGuard.allowAutopilotCloud === false &&
        spendGuard.allowRendererStartupProbe === false,
    );
    const spendRuntimeKeyIsolationOk = Boolean(
      spendGuard.runtimeKeyIsolation?.enabled === true &&
        spendGuard.runtimeKeyIsolation?.openAiApiKeyInProcessEnv === false &&
        Number(spendGuard.runtimeKeyIsolation?.openAiCredentialKeyCount || 0) === 0 &&
        spendGuard.runtimeKeyIsolation?.memoryKeyVault?.enabled === true &&
        spendGuard.runtimeKeyIsolation?.safety?.defaultRuntimeProcessEnvOpenAiCredentialsBlocked === true &&
        spendGuard.runtimeKeyIsolation?.safety?.childProcessesCannotInheritRuntimeOpenAiCredentials === true &&
        (spendGuardZeroLocked
          ? spendGuard.runtimeKeyIsolation?.availableForGuardedCalls === false &&
            spendGuard.runtimeKeyIsolation?.safety?.zeroSpendModeDoesNotRetainKeyInMemory === true
          : spendGuardManualGuarded &&
            spendGuard.runtimeKeyIsolation?.availableForGuardedCalls === true &&
            spendGuard.runtimeKeyIsolation?.memoryKeyVault?.active === false),
    );
    const spendForensicsOk = Boolean(
      spendForensics.version === 1 &&
        spendForensics.likelyBillableFromJavis === false &&
        spendForensics.safety?.callsOpenAI === false &&
        spendForensics.safety?.createsSpendLease === false &&
        (spendGuardZeroLocked
          ? spendForensics.zeroLocked === true && spendForensics.status === 'zero_spend_locked'
          : spendGuardManualGuarded &&
            spendForensics.zeroLocked === false &&
            spendForensics.manualGuardedNoSpend === true &&
            spendForensics.safeNoSpend === true &&
            spendForensics.status === 'manual_guarded_no_spend'),
    );
    out.push(
      spendGuardResponse.ok &&
        (spendGuardZeroLocked || spendGuardManualGuarded) &&
        spendGuard.egressGuardEnabled === true &&
        spendGuard.egressGuardMode === 'scoped_allow_only' &&
        spendGuard.unattendedDailyRequestLimit === 0 &&
        spendGuard.allowAutopilotCloud === false &&
        spendGuard.allowRendererStartupProbe === false &&
        spendGuard.requireSpendConfirmationPhrase === true &&
        spendGuard.requireSpendLease === true &&
        spendGuard.spendLease?.oneRequestOnly === true &&
        Number(spendGuard.spendLeaseTtlMs || 0) >= 5000 &&
        spendRuntimeKeyIsolationOk &&
        openAiKeySyncLooksSafe(spendKeySync) &&
        spendGuard.childEnvGuard?.enabled === true &&
        spendGuard.childEnvGuard?.defaultChildReceivesOpenAiCredentials === false &&
        spendGuard.childEnvGuard?.blocksInlineCredentialEnv === true &&
        spendGuard.autopilotRequiresExplicitEnv === true &&
        spendGuard.safety?.unscopedOpenAiEgressBlocked === true &&
        spendGuard.safety?.oneRequestLeaseRequired === true &&
        spendGuard.safety?.childProcessOpenAiCredentialsBlocked === true &&
        spendGuard.safety?.runtimeProcessEnvOpenAiCredentialsBlocked === true &&
        egressGuard.enabled === true &&
        egressGuard.installed === true &&
        egressGuard.mode === 'scoped_allow_only' &&
        egressGuard.safety?.blocksUnscopedOpenAiFetch === true &&
        spendForensicsOk &&
        spendGuard.safety?.confirmationPhraseRequired === true &&
        spendGuard.safety?.unattendedCloudDefaultBlocked === true
        ? ok('resident.openai_spend_guard_runtime', 'OpenAI spend guard runtime', `mode=${spendGuard.mode} · key=${spendKeySync.status} · hardLock=${spendGuard.hardSpendLock} · egress=${egressGuard.mode} · runtimeEnv=${spendGuard.runtimeKeyIsolation?.openAiApiKeyInProcessEnv ? 'present' : 'isolated'} · callable=${spendGuard.runtimeKeyIsolation?.availableForGuardedCalls ? 'yes' : 'no'} · today=${spendGuard.counts?.total || 0}/${spendGuard.dailyRequestLimit} · unattended=${spendGuard.counts?.unattended || 0}/${spendGuard.unattendedDailyRequestLimit}`)
        : fail('resident.openai_spend_guard_runtime', 'OpenAI spend guard runtime', 'expected resident runtime to be zero-locked or manual-guarded while blocking unattended/autopilot calls and renderer startup probes', {
          status: spendGuardResponse.status,
          body: spendGuardResponse.data,
        }),
    );
    const spendSentinelResponse = await ctx.api('/api/openai/spend-sentinel');
    const spendSentinel = spendSentinelResponse.data?.sentinel || {};
    const spendSentinelCheckResponse = await ctx.api('/api/openai/spend-sentinel/check', {
      method: 'POST',
      body: {
        source: 'eval_resident_spend_sentinel_check',
      },
      timeoutMs: 10000,
    });
    const spendSentinelCheck = spendSentinelCheckResponse.data?.sentinel || {};
    const spendGuardAfterSentinelResponse = await ctx.api('/api/openai/spend-guard');
    const spendGuardAfterSentinel = spendGuardAfterSentinelResponse.data?.spendGuard || {};
    const sentinelCui = spawnSync(process.execPath, ['scripts/config-cui.cjs', '--print-openai-spend-sentinel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    });
    const sentinelCuiOutput = String(sentinelCui.stdout || '');
    const configCuiSourceForRequestRetry = fs.readFileSync('scripts/config-cui.cjs', 'utf8');
    const sentinelCuiUnavailable = spawnSync(process.execPath, ['scripts/config-cui.cjs', '--print-openai-spend-sentinel'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        JAVIS_API_BASE: 'http://127.0.0.1:9',
        JAVIS_CUI_REQUEST_RETRY_ATTEMPTS: '2',
        JAVIS_CUI_REQUEST_RETRY_DELAY_MS: '100',
        JAVIS_CUI_REQUEST_TIMEOUT_MS: '1000',
      },
    });
    const sentinelCuiUnavailableError = String(sentinelCuiUnavailable.stderr || sentinelCuiUnavailable.stdout || '');
    const spendSentinelZeroLocked = Boolean(
      spendSentinel.forensics?.zeroLocked === true &&
        (spendSentinel.guard?.emergencyZeroSpendLock === true ||
          (spendSentinel.guard?.hardSpendLock === true &&
            spendSentinel.guard?.paranoidZeroSpend === true &&
            spendSentinel.guard?.mode === 'off')) &&
        spendSentinel.guard?.guardedCallsHaveApiKey === false,
    );
    const spendSentinelManualGuarded = Boolean(
      spendSentinel.status === 'clear' &&
        spendSentinel.clear === true &&
        spendSentinel.forensics?.likelyBillableFromJavis === false &&
        spendSentinel.forensics?.zeroLocked === false &&
        spendSentinel.guard?.hardSpendLock === false &&
        spendSentinel.guard?.paranoidZeroSpend === false &&
        spendSentinel.guard?.mode === 'manual' &&
        spendSentinel.guard?.childEnvGuardEnabled === true,
    );
    const spendSentinelCheckZeroLocked = Boolean(
      spendSentinelCheck.status === 'clear' &&
        spendSentinelCheck.clear === true &&
        spendSentinelCheck.forensics?.zeroLocked === true,
    );
    const spendSentinelCheckManualGuarded = Boolean(
      spendSentinelCheck.status === 'clear' &&
        spendSentinelCheck.clear === true &&
        spendSentinelCheck.forensics?.likelyBillableFromJavis === false &&
        spendSentinelCheck.forensics?.zeroLocked === false &&
        spendSentinelCheck.guard?.mode === 'manual',
    );
    out.push(
      spendSentinelResponse.ok &&
        spendSentinel.ok === true &&
        spendSentinel.version === 1 &&
        spendSentinel.enabled === true &&
        spendSentinel.running === true &&
        spendSentinel.counts?.allowedToday === 0 &&
        spendSentinel.counts?.activeLeases === 0 &&
        spendSentinel.guard?.runtimeKeyEnvIsolated === true &&
        spendSentinel.guard?.memoryKeyVaultEnabled === true &&
        spendSentinel.guard?.childEnvGuardEnabled === true &&
        (spendSentinelZeroLocked || spendSentinelManualGuarded) &&
        spendSentinel.safety?.callsOpenAI === false &&
        spendSentinel.safety?.createsSpendLease === false &&
        spendSentinel.safety?.startsMicrophone === false &&
        spendSentinel.safety?.usesRealtime === false &&
        spendSentinel.safety?.startsWorkers === false &&
        spendSentinelCheckResponse.ok &&
        spendSentinelCheck.ok === true &&
        (spendSentinelCheckZeroLocked || spendSentinelCheckManualGuarded) &&
        spendSentinelCheck.safety?.callsOpenAI === false &&
        spendGuardAfterSentinelResponse.ok &&
        Number(spendGuardAfterSentinel.counts?.total || 0) === spendGuardTotalBefore &&
        Number(spendGuardAfterSentinel.spendLease?.activeCount || 0) === 0 &&
        sentinelCui.status === 0 &&
        sentinelCuiOutput.includes('JAVIS OpenAI Spend Sentinel') &&
        sentinelCuiOutput.includes('Status: clear') &&
        sentinelCuiOutput.includes('Safety: local guard state only') &&
        configCuiSourceForRequestRetry.includes('REQUEST_RETRY_ATTEMPTS') &&
        configCuiSourceForRequestRetry.includes('isTransientApiConnectError') &&
        configCuiSourceForRequestRetry.includes("['GET', 'HEAD'].includes(method)") &&
        configCuiSourceForRequestRetry.includes('JAVIS resident API unavailable after') &&
        configCuiSourceForRequestRetry.includes("retry: true, timeoutMs: 15000") &&
        sentinelCuiUnavailable.status !== 0 &&
        sentinelCuiUnavailableError.includes('JAVIS resident API unavailable after 2 attempt')
        ? ok('resident.openai_spend_sentinel', 'OpenAI spend sentinel', `${spendSentinelCheck.status || spendSentinel.status} · checks=${spendSentinelCheck.watcher?.checkCount ?? spendSentinel.watcher?.checkCount ?? 0} · allowed=${spendSentinel.counts?.allowedToday || 0} · leases=${spendSentinel.counts?.activeLeases || 0}`)
        : fail('resident.openai_spend_sentinel', 'OpenAI spend sentinel', 'expected resident/CUI spend sentinel to report clear zero-lock or clear manual-guarded state without OpenAI calls, leases, mic, Realtime, or worker side effects', {
          status: spendSentinelResponse.status,
          sentinel: spendSentinelResponse.data,
          check: spendSentinelCheckResponse.data,
          spendGuardAfter: spendGuardAfterSentinelResponse.data,
          cui: {
            status: sentinelCui.status,
            stdout: sentinelCuiOutput.slice(0, 1600),
            stderr: String(sentinelCui.stderr || '').slice(0, 1200),
            unavailableStatus: sentinelCuiUnavailable.status,
            unavailable: sentinelCuiUnavailableError.slice(0, 1200),
          },
        }),
    );
	    const zeroLockdownResponse = await ctx.api('/api/openai/zero-spend-lockdown', {
	      method: 'POST',
	      body: {
	        source: 'eval_resident_zero_spend_lockdown',
	        reason: 'eval verifies emergency lock prevents surprise OpenAI spend',
	      },
	      timeoutMs: 10000,
	    });
	    const zeroLockdown = zeroLockdownResponse.data || {};
	    const spendGuardAfterZeroLockdown = zeroLockdown.spendGuard || {};
	    const postLockDecisionResponse = await ctx.api('/api/openai/spend-guard/check', {
	      method: 'POST',
	      body: {
	        kind: 'responses_text',
	        source: 'eval_post_zero_lockdown_confirmed_request',
	        model: 'gpt-test',
	        confirmOpenAiSpend: true,
	        confirmOpenAiSpendPhrase: 'SPEND OPENAI',
	      },
	      timeoutMs: 10000,
	    });
	    const postLockDecision = postLockDecisionResponse.data?.decision || {};
	    const spendGuardAfterZeroLockdownCheckResponse = await ctx.api('/api/openai/spend-guard');
	    const spendGuardAfterZeroLockdownCheck = spendGuardAfterZeroLockdownCheckResponse.data?.spendGuard || {};
	    out.push(
	      zeroLockdownResponse.ok &&
	        zeroLockdown.ok === true &&
	        zeroLockdown.emergencyLock?.ok === true &&
	        zeroLockdown.emergencyLock?.safety?.callsOpenAI === false &&
	        zeroLockdown.emergencyLock?.safety?.createsSpendLease === false &&
	        zeroLockdown.safety?.startsMicrophone === false &&
	        zeroLockdown.safety?.usesRealtime === false &&
	        zeroLockdown.safety?.startsRealtimeSession === false &&
	        zeroLockdown.safety?.startsWorkers === false &&
	        spendGuardAfterZeroLockdown.emergencyZeroSpendLock === true &&
	        spendGuardAfterZeroLockdown.spendLease?.activeCount === 0 &&
	        postLockDecisionResponse.ok &&
	        postLockDecision.allowed === false &&
	        Array.isArray(postLockDecision.reasons) &&
	        postLockDecision.reasons.includes('emergency_zero_spend_lock_active') &&
	        spendGuardAfterZeroLockdownCheckResponse.ok &&
	        Number(spendGuardAfterZeroLockdownCheck.counts?.total || 0) === spendGuardTotalBefore
	        ? ok('resident.openai_zero_spend_lockdown', 'OpenAI zero-spend lockdown', 'runtime lockdown clears leases and blocks even a confirmed spend preflight without OpenAI egress')
	        : fail('resident.openai_zero_spend_lockdown', 'OpenAI zero-spend lockdown', 'expected runtime lockdown to block current-process OpenAI spend immediately without cloud, mic, Realtime, worker, or lease side effects', {
	          status: zeroLockdownResponse.status,
	          lockdown: zeroLockdown,
	          decision: postLockDecisionResponse.data,
	          spendGuardAfter: spendGuardAfterZeroLockdownCheckResponse.data,
	        }),
	    );
	    const spendIncidentResponse = await ctx.api('/api/openai/spend-incident-report');
	    const spendIncident = spendIncidentResponse.data?.incident || {};
	    out.push(
	      spendIncidentResponse.ok &&
	        spendIncident.version === 1 &&
	        spendIncident.conclusion?.id === 'no_local_javis_allowed_spend' &&
	        spendIncident.forensics?.likelyBillableFromJavis === false &&
	        spendIncident.forensics?.zeroLocked === true &&
	        spendIncident.externalBoundary?.dashboardRequiredForBillingTruth === true &&
	        spendIncident.safety?.callsOpenAI === false &&
	        spendIncident.safety?.createsSpendLease === false &&
	        spendIncident.safety?.startsMicrophone === false &&
	        spendIncident.safety?.usesRealtime === false &&
	        spendIncident.safety?.startsWorkers === false &&
	        spendIncident.safety?.capturesScreen === false &&
	        spendIncident.safety?.opensTerminal === false
	        ? ok('resident.openai_spend_incident_runtime', 'OpenAI spend incident runtime', `${spendIncident.conclusion?.label || 'incident'} · localAllowed=${spendIncident.spendGuard?.counts?.total || 0}/${spendIncident.spendGuard?.dailyRequestLimit ?? 0} · zeroLocked=${spendIncident.forensics?.zeroLocked ? 'yes' : 'no'}`)
	        : fail('resident.openai_spend_incident_runtime', 'OpenAI spend incident runtime', 'expected local-only spend incident report with no OpenAI call, spend lease, mic, Realtime, worker, screen, or Terminal side effects', {
	          status: spendIncidentResponse.status,
	          body: spendIncidentResponse.data,
	        }),
	    );
	    const egressProbeResponse = await ctx.api('/api/openai/egress-guard/probe', {
	      method: 'POST',
	      body: { source: 'eval_unscoped_openai_egress_probe' },
	      timeoutMs: 10000,
	    });
	    const egressProbe = egressProbeResponse.data || {};
	    const spendGuardAfterEgressProbeResponse = await ctx.api('/api/openai/spend-guard');
	    const spendGuardAfterEgressProbe = spendGuardAfterEgressProbeResponse.data?.spendGuard || {};
	    out.push(
	      egressProbeResponse.ok &&
	        egressProbe.ok === true &&
	        egressProbe.blocked === true &&
	        egressProbe.preview === true &&
	        egressProbe.executed === false &&
	        egressProbe.decision?.allowed === false &&
	        egressProbe.decision?.source === 'eval_unscoped_openai_egress_probe' &&
	        Array.isArray(egressProbe.decision?.reasons) &&
	        egressProbe.decision.reasons.includes('unscoped_openai_egress_blocked') &&
	        egressProbe.safety?.callsOpenAi === false &&
	        egressProbe.safety?.recordsBlockedSpend === false &&
	        egressProbe.egressGuard?.installed === true &&
	        spendGuardAfterEgressProbeResponse.ok &&
	        Number(spendGuardAfterEgressProbe.counts?.total || 0) === spendGuardTotalBefore &&
	        Number(spendGuardAfterEgressProbe.counts?.blocked || 0) === spendGuardBlockedBefore
	        ? ok('resident.openai_egress_guard_probe', 'OpenAI egress guard probe', 'default probe previews the OpenAI egress block without a fetch or blocked-count event')
	        : fail('resident.openai_egress_guard_probe', 'OpenAI egress guard probe', 'expected default OpenAI egress probe to preview locally without a fetch, spend total increment, or blocked-count increment', {
	          status: egressProbeResponse.status,
	          body: egressProbe,
	          spendGuardBefore: spendGuard,
	          spendGuardAfter: spendGuardAfterEgressProbe,
	        }),
	    );
	    const providerProbePreviewResponse = await ctx.api('/api/realtime/provider/probe');
	    const providerProbePreview = providerProbePreviewResponse.data?.probe || providerProbePreviewResponse.data || {};
	    const providerProbePreviewCui = spawnSync('npm', ['run', 'dogfood:realtime-provider-probe'], {
	      cwd: process.cwd(),
	      encoding: 'utf8',
	      timeout: 15000,
	      maxBuffer: 1024 * 1024,
	      env: {
	        ...process.env,
	        ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
	      },
	    });
	    out.push(
	      providerProbePreviewResponse.ok &&
	        providerProbePreview.status &&
	        providerProbePreview.startsMicrophone === false &&
	        providerProbePreview.requiresMicConfirmation === false &&
	        providerProbePreview.requiresOpenAiSpendConfirmation === true &&
	        providerProbePreview.openAiSpendConfirmation?.required === true &&
	        openAiKeySyncLooksSafe(providerProbePreview.keySync || {}) &&
	        noOpenAiSecretLeak(JSON.stringify(providerProbePreview)) &&
	        providerProbePreviewCui.status === 0 &&
	        providerProbePreviewCui.stdout.includes('JAVIS Realtime Provider Probe') &&
	        providerProbePreviewCui.stdout.includes('Key sync:') &&
	        noOpenAiSecretLeak(providerProbePreviewCui.stdout)
	        ? ok('resident.realtime_provider_probe_key_sync_preview', 'Realtime provider probe key sync preview', `${providerProbePreview.status} · key=${providerProbePreview.keySync?.status || '-'} · restart=${providerProbePreview.keySync?.requiresRestart ? 'yes' : 'no'}`)
	        : fail('resident.realtime_provider_probe_key_sync_preview', 'Realtime provider probe key sync preview', 'expected no-mic/no-spend provider probe preview to expose safe key sync without leaking API secrets', {
	          status: providerProbePreviewResponse.status,
	          body: providerProbePreviewResponse.data,
	          cui: providerProbePreviewCui.stdout,
	          cuiError: providerProbePreviewCui.stderr,
	          cuiStatus: providerProbePreviewCui.status,
	        }),
	    );
	    const unconfirmedProviderProbeResponse = await ctx.api('/api/realtime/provider/probe', {
	      method: 'POST',
	      body: {
	        execute: true,
	        source: 'cui_cli',
	      },
	      timeoutMs: 10000,
	    });
	    const unconfirmedProviderProbe = unconfirmedProviderProbeResponse.data || {};
	    const spendGuardAfterUnconfirmedResponse = await ctx.api('/api/openai/spend-guard');
	    const spendGuardAfterUnconfirmed = spendGuardAfterUnconfirmedResponse.data?.spendGuard || {};
		    out.push(
		      unconfirmedProviderProbeResponse.status === 428 &&
		        unconfirmedProviderProbe.ok === false &&
	        unconfirmedProviderProbe.executed === false &&
	        unconfirmedProviderProbe.openAiSpendConfirmation?.required === true &&
	        unconfirmedProviderProbe.openAiSpendConfirmation?.confirmed === false &&
	        String(unconfirmedProviderProbe.output || '').includes('OpenAI spend confirmation required') &&
	        spendGuardAfterUnconfirmedResponse.ok &&
	        Number(spendGuardAfterUnconfirmed.counts?.total || 0) === spendGuardTotalBefore
	        ? ok('resident.openai_spend_confirmation_gate', 'OpenAI provider probe confirmation gate', 'unconfirmed provider-probe execution returns 428 and does not reserve OpenAI spend')
	        : fail('resident.openai_spend_confirmation_gate', 'OpenAI provider probe confirmation gate', 'expected unconfirmed provider-probe execution to stop before any OpenAI spend reservation', {
	          status: unconfirmedProviderProbeResponse.status,
	          body: unconfirmedProviderProbe,
	          spendGuardBefore: spendGuard,
	          spendGuardAfter: spendGuardAfterUnconfirmed,
		        }),
		    );

		    const childEnvProbeResponse = await ctx.api('/api/openai/child-env-guard/probe', {
		      method: 'POST',
		      body: {
		        command: 'OPENAI_API_KEY=sk-test echo should-not-run',
		        source: 'eval_resident_child_env_guard',
		      },
		    });
		    const childEnvProbe = childEnvProbeResponse.data?.childEnvGuard || {};
		    out.push(
		      childEnvProbeResponse.ok &&
		        childEnvProbe.ok === true &&
			        childEnvProbe.guard?.enabled === true &&
			        childEnvProbe.guard?.defaultChildReceivesOpenAiCredentials === false &&
			        childEnvProbe.guard?.blocksInlineCredentialEnv === true &&
			        childEnvProbe.guard?.defaultChildProcessEnv === 'openai_credentials_redacted' &&
				        childEnvProbe.guard?.runtimeKeyIsolation?.enabled === true &&
				        childEnvProbe.guard?.runtimeKeyIsolation?.openAiApiKeyInProcessEnv === false &&
				        Number(childEnvProbe.guard?.runtimeKeyIsolation?.openAiCredentialKeyCount || 0) === 0 &&
				        childEnvProbe.guard?.runtimeKeyIsolation?.availableForGuardedCalls === false &&
				        childEnvProbe.guard?.runtimeKeyIsolation?.memoryKeyVault?.enabled === true &&
				        childEnvProbe.guard?.safety?.mcpConfiguredEnvCredentialsBlocked === true &&
			        childEnvProbe.guard?.safety?.knownChildEntrypointsUseSanitizedEnv === true &&
			        childEnvProbe.guard?.safety?.runtimeProcessEnvOpenAiCredentialsBlocked === true &&
			        childEnvProbe.sanitizedHasOpenAiCredentials === false &&
			        childEnvProbe.mcpSanitizedHasOpenAiCredentials === false &&
			        childEnvProbe.mcpAllowedEnvPreserved === true &&
			        Array.isArray(childEnvProbe.mcpRedactedKeys) &&
			        childEnvProbe.mcpRedactedKeys.includes('OPENAI_API_KEY') &&
			        childEnvProbe.mcpRedactedKeys.includes('JAVIS_API_TOKEN') &&
			        childEnvProbe.inlineInjectionBlocked === true &&
			        childEnvProbe.inlineInjectionReason === 'inline_openai_credential_env_blocked' &&
			        childEnvProbe.safety?.readOnly === true &&
		        childEnvProbe.safety?.startsProcess === false &&
		        childEnvProbe.safety?.callsOpenAi === false &&
		        childEnvProbe.safety?.usesRealtime === false &&
		        childEnvProbe.safety?.startsMicrophone === false &&
		        childEnvProbe.safety?.exposesApiKey === false
		        ? ok('resident.openai_child_env_guard_probe', 'OpenAI child env guard probe', `guarded=${childEnvProbe.guard?.enabled} · parentHasCreds=${childEnvProbe.parentHasOpenAiCredentials ? 'yes' : 'no'} · sanitizedCreds=${childEnvProbe.sanitizedHasOpenAiCredentials ? 'yes' : 'no'} · inline=${childEnvProbe.inlineInjectionBlocked ? 'blocked' : 'allowed'}`)
		        : fail('resident.openai_child_env_guard_probe', 'OpenAI child env guard probe', 'expected child process env guard to strip OpenAI credentials and block inline OPENAI_API_KEY assignment without starting a process', {
		          status: childEnvProbeResponse.status,
		          body: childEnvProbeResponse.data,
		        }),
		    );

		    const confirmedNoLeaseProviderProbeResponse = await ctx.api('/api/realtime/provider/probe', {
		      method: 'POST',
		      body: {
		        execute: true,
		        source: 'cui_cli',
		        confirmOpenAiSpend: true,
		        confirmOpenAiSpendPhrase: 'SPEND OPENAI',
		      },
		      timeoutMs: 10000,
		    });
		    const confirmedNoLeaseProviderProbe = confirmedNoLeaseProviderProbeResponse.data || {};
		    const spendGuardAfterNoLeaseResponse = await ctx.api('/api/openai/spend-guard');
		    const spendGuardAfterNoLease = spendGuardAfterNoLeaseResponse.data?.spendGuard || {};
		    out.push(
		      confirmedNoLeaseProviderProbeResponse.status === 428 &&
		        confirmedNoLeaseProviderProbe.ok === false &&
		        confirmedNoLeaseProviderProbe.executed === false &&
		        confirmedNoLeaseProviderProbe.openAiSpendConfirmation?.confirmed === true &&
		        confirmedNoLeaseProviderProbe.openAiSpendConfirmation?.lease?.ok === false &&
		        confirmedNoLeaseProviderProbe.openAiSpendConfirmation?.lease?.reason === 'spend_lease_required' &&
		        String(confirmedNoLeaseProviderProbe.output || '').includes('one-request spend lease required') &&
		        spendGuardAfterNoLeaseResponse.ok &&
		        Number(spendGuardAfterNoLease.counts?.total || 0) === spendGuardTotalBefore
		        ? ok('resident.openai_spend_lease_gate', 'OpenAI one-request spend lease gate', 'phrase-confirmed provider probe without a one-request lease returns 428 and does not reserve OpenAI spend')
		        : fail('resident.openai_spend_lease_gate', 'OpenAI one-request spend lease gate', 'expected phrase-confirmed provider-probe execution without a lease to stop before any OpenAI spend reservation', {
		          status: confirmedNoLeaseProviderProbeResponse.status,
		          body: confirmedNoLeaseProviderProbe,
		          spendGuardBefore: spendGuard,
		          spendGuardAfter: spendGuardAfterNoLease,
		        }),
		    );

		    const spendGuardDryRunResponse = await ctx.api('/api/openai/spend-guard/check', {
	      method: 'POST',
	      body: {
	        kind: 'responses_text',
	        source: 'voice_manual_check',
	        confirmOpenAiSpend: true,
	        confirmOpenAiSpendPhrase: 'SPEND OPENAI',
	      },
	    });
	    const spendGuardDryRun = spendGuardDryRunResponse.data?.decision || {};
	    const spendGuardAfterDryRunResponse = await ctx.api('/api/openai/spend-guard');
	    const spendGuardAfterDryRun = spendGuardAfterDryRunResponse.data?.spendGuard || {};
	    out.push(
	      spendGuardDryRunResponse.ok &&
	        spendGuardDryRun.allowed === false &&
	        spendGuardDryRun.confirmed === true &&
	        Array.isArray(spendGuardDryRun.reasons) &&
	        (spendGuardDryRun.reasons.includes('emergency_zero_spend_lock_active') ||
	          (spendGuardDryRun.reasons.includes('hard_spend_lock_enabled') &&
	            spendGuardDryRun.reasons.includes('cloud_mode_off') &&
	            spendGuardDryRun.reasons.includes('daily_request_limit_reached'))) &&
	        spendGuardAfterDryRunResponse.ok &&
	        Number(spendGuardAfterDryRun.counts?.total || 0) === spendGuardTotalBefore
	        ? ok('resident.openai_spend_hard_lock_dry_run', 'OpenAI hard spend lock dry-run', `blocked reasons=${spendGuardDryRun.reasons.join(',')}`)
	        : fail('resident.openai_spend_hard_lock_dry_run', 'OpenAI hard spend lock dry-run', 'expected dry-run guard check to block phrase-confirmed calls after runtime lockdown or while hard lock/off/zero-budget defaults are active without reserving spend', {
	          status: spendGuardDryRunResponse.status,
	          dryRun: spendGuardDryRun,
	          spendGuardAfterDryRun,
	        }),
	    );

	    const zeroReleaseResponse = await ctx.api('/api/openai/zero-spend-release', {
	      method: 'POST',
	      body: {
	        source: 'eval_resident_zero_spend_release',
	        reason: 'eval cleanup after verifying emergency zero-spend lock',
	      },
	      timeoutMs: 10000,
	    });
	    const zeroRelease = zeroReleaseResponse.data || {};
	    const spendGuardAfterZeroRelease = zeroRelease.after || {};
	    const zeroReleaseForensics = zeroRelease.forensics || {};
	    const zeroReleaseManualGuarded = Boolean(
	      spendGuardManualGuarded &&
	        zeroReleaseForensics.zeroLocked === false &&
	        zeroReleaseForensics.manualGuardedNoSpend === true &&
	        zeroReleaseForensics.status === 'manual_guarded_no_spend' &&
	        spendGuardAfterZeroRelease.runtimeKeyIsolation?.availableForGuardedCalls === true,
	    );
	    const zeroReleaseStillZeroLocked = Boolean(
	      spendGuardZeroLocked &&
	        zeroReleaseForensics.zeroLocked === true &&
	        spendGuardAfterZeroRelease.runtimeKeyIsolation?.availableForGuardedCalls === false,
	    );
	    out.push(
	      zeroReleaseResponse.ok &&
	        zeroRelease.ok === true &&
	        zeroRelease.safety?.callsOpenAI === false &&
	        zeroRelease.safety?.createsSpendLease === false &&
	        zeroRelease.safety?.startsMicrophone === false &&
	        zeroRelease.safety?.usesRealtime === false &&
	        zeroRelease.safety?.startsRealtimeSession === false &&
	        zeroRelease.safety?.startsWorkers === false &&
	        spendGuardAfterZeroRelease.emergencyZeroSpendLock === false &&
	        Number(spendGuardAfterZeroRelease.counts?.total || 0) === spendGuardTotalBefore &&
	        Number(spendGuardAfterZeroRelease.spendLease?.activeCount || 0) === 0 &&
	        (zeroReleaseManualGuarded || zeroReleaseStillZeroLocked)
	        ? ok('resident.openai_zero_spend_release', 'OpenAI zero-spend emergency release', `status=${zeroReleaseForensics.status || '-'} · restored=${zeroRelease.restoredKeyToMemory ? 'yes' : 'no'} · leases=${zeroRelease.clearedSpendLeases || 0}`)
	        : fail('resident.openai_zero_spend_release', 'OpenAI zero-spend emergency release', 'expected eval cleanup to release the temporary emergency lock without OpenAI calls, leases, mic, Realtime, workers, or spend-count changes', {
	          status: zeroReleaseResponse.status,
	          release: zeroReleaseResponse.data,
	        }),
	    );

	    const envExampleSource = fs.readFileSync('.env.example', 'utf8');
	    const configCuiSource = fs.readFileSync('scripts/config-cui.cjs', 'utf8');
	    const rendererSource = fs.readFileSync('src/App.tsx', 'utf8');
	    const hasOpenAiSpendGuardStatic =
	      mainSource.includes('OPENAI_SPEND_GUARD_FILE') &&
	      mainSource.includes('class OpenAiSpendGuardBlocked') &&
	      mainSource.includes('function assertOpenAiSpendAllowed') &&
	      mainSource.includes('function openAiSpendConfirmationSnapshot') &&
	      mainSource.includes('OPENAI_HARD_SPEND_LOCK') &&
	      mainSource.includes('OPENAI_REQUIRE_SPEND_CONFIRMATION_PHRASE') &&
	      mainSource.includes('openai_spend_confirmation_required') &&
	      mainSource.includes('confirmOpenAiSpend') &&
	      mainSource.includes('confirmOpenAiSpendPhrase') &&
	      mainSource.includes('const AUTOPILOT_ENABLED = process.env.JAVIS_AUTOPILOT_ENABLED === \'true\';') &&
	      mainSource.includes('OPENAI_UNATTENDED_DAILY_REQUEST_LIMIT') &&
		      mainSource.includes('OPENAI_ALLOW_RENDERER_STARTUP_PROBE') &&
		      mainSource.includes('OPENAI_EGRESS_GUARD_ENABLED') &&
		      mainSource.includes('OPENAI_REQUIRE_SPEND_LEASE') &&
		      mainSource.includes('OPENAI_SPEND_LEASE_TTL_MS') &&
				      mainSource.includes('OPENAI_CHILD_ENV_GUARD_ENABLED') &&
				      mainSource.includes('OPENAI_RUNTIME_KEY_ISOLATION') &&
				      mainSource.includes('OPENAI_MEMORY_KEY_VAULT') &&
				      mainSource.includes('function vaultOpenAiApiKeyFromMemory') &&
				      mainSource.includes('zeroSpendModeDoesNotRetainKeyInMemory') &&
				      mainSource.includes('OPENAI_RUNTIME_ENV_ISOLATED_KEYS') &&
			      mainSource.includes('function openAiRuntimeKeyIsolationSnapshot') &&
			      mainSource.includes('function openAiApiKeySyncSnapshot') &&
			      mainSource.includes('function openAiSafeKeyFingerprint') &&
			      mainSource.includes('function readOpenAiEnvFileKeySnapshot') &&
			      mainSource.includes('exposesSecretValues: false') &&
			      mainSource.includes('function createOpenAiSpendLease') &&
			      mainSource.includes('function sanitizeChildProcessEnv') &&
			      mainSource.includes('function guardedChildProcessOptions') &&
			      mainSource.includes('function assertOpenAiChildEnvCommandAllowed') &&
			      mainSource.includes('function openAiChildEnvGuardProbe') &&
			      mainSource.includes('defaultChildProcessEnv') &&
			      mainSource.includes('mcpConfiguredEnvCredentialsBlocked') &&
			      mainSource.includes('knownChildEntrypointsUseSanitizedEnv') &&
			      mainSource.includes('JAVIS_OPENAI_CHILD_ENV_MCP_REDACTED_KEYS') &&
			      mainSource.includes("source: 'wake_engine'") &&
			      mainSource.includes("env: guardedChildProcessEnv({ source: 'local_speech' })") &&
			      mainSource.includes('function openAiSpendForensicsSnapshot') &&
			      mainSource.includes('function openAiSpendIncidentReportSnapshot') &&
			      mainSource.includes('function releaseOpenAiEmergencyZeroSpendLock') &&
			      mainSource.includes('naturalOpenAiSpendIncidentLocalCommand') &&
			      mainSource.includes("api.get('/api/openai/spend-incident-report'") &&
			      mainSource.includes("api.post('/api/openai/zero-spend-release'") &&
			      mainSource.includes("'openai_spend_status', 'openai_spend_incident'") &&
		      mainSource.includes('likelyBillableFromJavis') &&
		      mainSource.includes('blockedBySource') &&
		      mainSource.includes('Allowed sources: none in local guard records.') &&
		      mainSource.includes('spend_lease_required') &&
		      mainSource.includes('renderer_startup_probe_disabled') &&
		      mainSource.includes('function installOpenAiEgressGuard') &&
		      mainSource.includes('function openAiEgressGuardSnapshot') &&
		      mainSource.includes('function withOpenAiEgressSource') &&
			      mainSource.includes('currentOpenAiEgressSource(') &&
			      mainSource.includes('unscoped_openai_egress_blocked') &&
			      mainSource.includes('confirmLocalFirewallProbe') &&
			      mainSource.includes('recordsBlockedSpend: false') &&
			      mainSource.includes("api.post('/api/openai/egress-guard/probe'") &&
		      mainSource.includes("api.post('/api/openai/child-env-guard/probe'") &&
		      mainSource.includes('await withOpenAiEgressAllowed(spendDecision') &&
	      mainSource.includes("kind: isProviderProbe ? 'realtime_provider_probe' : 'realtime_session'") &&
		      mainSource.includes("api.get('/api/openai/spend-guard'") &&
		      mainSource.includes("api.post('/api/openai/spend-guard/check'") &&
		      mainSource.includes("api.post('/api/openai/spend-lease'") &&
		      mainSource.includes('async function callOpenAIResponses({') &&
	      mainSource.includes("manualOnlyReason = 'OpenAI provider probes can consume API quota and require explicit user action.'") &&
	      mainSource.includes('source: options.source || \'observe_vision\'') &&
		      rendererSource.includes("source: detail.source || 'renderer_provider_probe'") &&
		      rendererSource.includes("params.set('confirmOpenAiSpend', 'true')") &&
		      rendererSource.includes("params.set('confirmOpenAiSpendPhrase', detail.confirmOpenAiSpendPhrase)") &&
		      rendererSource.includes("params.set('openAiSpendLeaseId', detail.openAiSpendLeaseId)") &&
		      configCuiSource.includes('async function stopRealtimeForOpenAiLockdown') &&
		      configCuiSource.includes("source: 'openai_lockdown'") &&
			      configCuiSource.includes('stopScreen: true') &&
			      configCuiSource.includes('Realtime voice stop:') &&
			      configCuiSource.includes('runtime key env isolated') &&
			      configCuiSource.includes('Forensics: likely billable from JAVIS=') &&
			      configCuiSource.includes('printOpenAiSpendIncident') &&
			      configCuiSource.includes('SI. Show OpenAI spend incident report') &&
			      configCuiSource.includes('MCP key env=') &&
			      configCuiSource.includes('Latest allowed: none in local guard records') &&
			      configCuiSource.includes('releaseOpenAiEmergencyLock') &&
      packageSource.includes('"dogfood:realtime-provider-probe": "node scripts/config-cui.cjs --print-realtime-provider-probe"') &&
      packageSource.includes('"dogfood:realtime-provider-probe:run": "node scripts/config-cui.cjs --run-realtime-provider-probe"') &&
      packageSource.includes('"openai:incident": "node scripts/config-cui.cjs --print-openai-spend-incident"') &&
      packageSource.includes('"openai:lockdown": "node scripts/config-cui.cjs --lock-openai-spend"') &&
      packageSource.includes('"openai:zero": "node scripts/config-cui.cjs --lock-openai-spend"') &&
      packageSource.includes('"openai:recover": "node scripts/config-cui.cjs --recover-openai-spend"') &&
      packageSource.includes('"voice:mic": "node scripts/config-cui.cjs --open-microphone-settings"') &&
      envExampleSource.includes('JAVIS_OPENAI_HARD_SPEND_LOCK=true') &&
	      envExampleSource.includes('JAVIS_OPENAI_REQUIRE_SPEND_CONFIRMATION_PHRASE=true') &&
	      envExampleSource.includes('JAVIS_OPENAI_SPEND_CONFIRMATION_PHRASE=SPEND OPENAI') &&
	      envExampleSource.includes('JAVIS_OPENAI_CLOUD_MODE=off') &&
	      envExampleSource.includes('JAVIS_OPENAI_DAILY_REQUEST_LIMIT=0') &&
	      envExampleSource.includes('JAVIS_OPENAI_UNATTENDED_DAILY_REQUEST_LIMIT=0') &&
		      envExampleSource.includes('JAVIS_OPENAI_ALLOW_AUTOPILOT=false') &&
		      envExampleSource.includes('JAVIS_OPENAI_ALLOW_RENDERER_STARTUP_PROBE=false') &&
		      envExampleSource.includes('JAVIS_OPENAI_EGRESS_GUARD=true') &&
		      envExampleSource.includes('JAVIS_OPENAI_REQUIRE_SPEND_LEASE=true') &&
			      envExampleSource.includes('JAVIS_OPENAI_SPEND_LEASE_TTL_MS=60000') &&
			      envExampleSource.includes('JAVIS_OPENAI_CHILD_ENV_GUARD=true') &&
			      envExampleSource.includes('JAVIS_OPENAI_RUNTIME_KEY_ISOLATION=true') &&
			      envExampleSource.includes('JAVIS_OPENAI_MEMORY_KEY_VAULT=true');
	    out.push(
		      hasOpenAiSpendGuardStatic
		        ? ok('resident.openai_spend_guard_static', 'OpenAI spend guard static contract', 'OpenAI calls and worker child env are guarded, lockdown stops existing Realtime voice, autopilot requires explicit env, startup probes are opt-in, and .env.example documents zero-spend defaults')
	        : fail('resident.openai_spend_guard_static', 'OpenAI spend guard static contract', 'expected source to guard OpenAI calls and document zero-spend defaults'),
	    );

    const recoveryResponse = await ctx.api('/api/realtime/provider/recovery');
    const recovery = recoveryResponse.data?.recovery || {};
    const recoverySteps = Array.isArray(recovery.steps) ? recovery.steps : [];
    const retryPolicy = recovery.retryPolicy || {};
    const recoveryKeySync = recovery.keySync || {};
    out.push(
      recoveryResponse.ok &&
        recovery.version === 1 &&
        typeof recovery.active === 'boolean' &&
        openAiKeySyncLooksSafe(recoveryKeySync) &&
        (recovery.active === false ||
          (retryPolicy.active === true &&
            ['spend_locked', 'probe_due', 'cooldown', 'probe_running'].includes(retryPolicy.state) &&
            retryPolicy.shouldUseLocalFallback === true &&
            retryPolicy.safety?.startsMicrophone === false &&
            retryPolicy.safety?.storesRawAudio === false)) &&
        recovery.chatGptSubscriptionCoversApi === false &&
        String(recovery.subscriptionBoundary || '').includes('OpenAI API Platform billing') &&
        (!recovery.billingLikely || (
          String(recovery.next || '').includes('ChatGPT app subscriptions') &&
          String(recovery.next || '').includes('API/Realtime usage')
        )) &&
        recovery.localFallback?.endpoint === '/api/voice/command' &&
        String(recovery.localFallback?.command || '').includes('voice:chat') &&
        recovery.safety?.startsMicrophone === false &&
        recovery.safety?.usesRealtime === false &&
        recovery.safety?.storesRawAudio === false &&
        (!recovery.billingLikely || recoverySteps.some((step) => step.id === 'open_api_billing' && step.url))
        ? ok('resident.realtime_provider_recovery', 'Realtime provider recovery plan', `${recovery.kind || 'ready'} · key=${recoveryKeySync.status} · active=${recovery.active} · steps=${recoverySteps.length}`)
        : fail('resident.realtime_provider_recovery', 'Realtime provider recovery plan', 'expected safe Realtime recovery payload with API billing boundary and local fallback', {
            recovery,
            status: recoveryResponse.status,
          }),
    );

    const appSource = fs.readFileSync('src/App.tsx', 'utf8');
    const startupCheckIndex = appSource.indexOf('const startupBlock = await readRealtimeStartupBlock().catch');
    const getUserMediaIndex = appSource.indexOf('navigator.mediaDevices.getUserMedia');
    const hasPushToTalkDefault =
      appSource.includes("useState<MicMode>('push')") &&
      appSource.includes('track.enabled = micMode === \'open\'') &&
      appSource.includes("event.code !== 'Space'") &&
      appSource.includes('input_audio_buffer.commit') &&
      appSource.includes('pushToTalkPointerRef') &&
      appSource.includes('ptt-capsule') &&
      appSource.includes('Hold the capsule or press Space. Release to send.') &&
      appSource.includes('`/api/realtime/config?micMode=${micMode}`');
    out.push(
      hasPushToTalkDefault
        ? ok('resident.push_to_talk_default', 'Push-to-talk default voice mode', 'renderer defaults to PTT, gates mic tracks, supports Space and compact-capsule hold-to-talk')
        : fail('resident.push_to_talk_default', 'Push-to-talk default voice mode', 'expected renderer to default to PTT and expose compact hold-to-talk without open mic by default'),
    );
    out.push(
	      appSource.includes('runRealtimeProviderRecoveryProbe') &&
	        appSource.includes('shouldRetryRealtimeProviderBeforeMic') &&
	        appSource.includes("source: 'renderer_startup_recovery'") &&
	        appSource.includes('execute: false') &&
	        appSource.includes('/api/realtime/provider/probe') &&
	        appSource.includes('不会调用 OpenAI，也不会打开麦克风') &&
	        startupCheckIndex >= 0 &&
	        getUserMediaIndex > startupCheckIndex
	        ? ok('resident.pet_realtime_startup_probe_gate', 'Pet Realtime startup recovery gate', 'renderer previews provider recovery before getUserMedia and never spends OpenAI quota from startup')
	        : fail('resident.pet_realtime_startup_probe_gate', 'Pet Realtime startup recovery gate', 'expected renderer startup to preview provider recovery without OpenAI spend before opening the microphone'),
	    );

    return out;
  },
};
