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
    const trafficStates = new Set(['idle', 'watching', 'waking', 'connecting', 'listening', 'working', 'attention', 'blocked']);
    const trafficUrgency = new Set(['quiet', 'ambient', 'active', 'interrupt']);
    const trafficPulses = new Set(['off', 'slow', 'live', 'attention']);
    const voiceFallback = p.voiceHealth?.fallback || {};
    const localVoice = p.localVoice || {};
    const petWakeHandoff = p.wake?.handoff || {};
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
        localVoice.available === true &&
        ['standby', 'fallback_ready'].includes(localVoice.mode) &&
        localVoice.input?.endpoint === '/api/voice/command' &&
        localVoice.input?.historyEndpoint === '/api/voice/history' &&
        String(localVoice.input?.cliCommand || '').includes('npm run voice') &&
        String(localVoice.input?.historyCommand || '').includes('--print-voice-history') &&
        localVoice.privacy?.localOnly === true &&
        localVoice.privacy?.transcriptPreviewOnly === true &&
        localVoice.privacy?.noRawAudio === true &&
        localVoice.privacy?.noScreenImages === true &&
        localVoice.privacy?.noClipboardText === true &&
        localVoice.privacy?.noAccessibilityNodes === true &&
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
          petWakeHandoff,
        }),
    );

    const resident = await ctx.api('/api/resident/status');
    const res = resident.data?.resident;
    out.push(
      resident.ok && res
        ? ok('resident.launchagent', 'LaunchAgent status', `installed=${res.installed} loaded=${res.loaded}${res.pid ? ` pid=${res.pid}` : ''} matchesProject=${res.matchesProject}`)
        : warn('resident.launchagent', 'LaunchAgent status', `GET /api/resident/status ${resident.status} ${resident.error || ''}`),
    );

    return out;
  },
};
