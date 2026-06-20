import { ok, warn, fail } from '../_client.mjs';

// Resident control surface (README: wake state, setup guide + one-step fix,
// global hotkeys / pet window state, LaunchAgent resident status). Read-only.
export default {
  lane: 'resident',
  async run(ctx) {
    const out = [];

    const wake = await ctx.api('/api/wake/status');
    const w = wake.data?.wake;
    out.push(
      wake.ok && w && Array.isArray(w.words)
        ? ok('resident.wake', 'Wake state', `${w.words.length} wake word(s) · softWakeOnly=${w.softWakeOnly} triggers=${w.triggerCount ?? 0}`)
        : warn('resident.wake', 'Wake state', `GET /api/wake/status ${wake.status} ${wake.error || ''}`),
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
      win.ok && win2
        ? ok('resident.window', 'Pet window + hotkeys', `mode=${win2.mode} park=${win2.parkCorner} hotkey=${win2.hotkeyRegistered ? 'on' : 'off'} summon=${win2.summonHotkeyRegistered ? 'on' : 'off'} capture=${win2.captureHotkeyRegistered ? 'on' : 'off'}`)
        : warn('resident.window', 'Pet window + hotkeys', `GET /api/window/state ${win.status} ${win.error || ''}`),
    );

    const pet = await ctx.api('/api/pet/status');
    const p = pet.data || {};
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(p, key);
    const forbiddenTopLevel = ['models', 'routing', 'collaboration', 'memory', 'learnedProfile', 'shortcuts', 'demonstrations', 'workflows']
      .filter((key) => hasOwn(key));
    const queue = Array.isArray(p.queue) ? p.queue : [];
    out.push(
      pet.ok &&
        p.pet?.lightweight === true &&
        p.pet?.detailEndpoint === '/api/status' &&
        Array.isArray(p.pet?.excludes) &&
        p.pet.excludes.includes('screen.imageDataUrl') &&
        typeof p.pet?.color === 'string' &&
        p.window?.mode &&
        p.presence?.intervention?.passiveByDefault === true &&
        p.presence?.intervention?.requiresUserIntent === true &&
        !p.screen?.imageDataUrl &&
        !p.screenPrivacy?.rules &&
        !p.screen?.privacy?.rules &&
        !p.runtime?.dataDir &&
        forbiddenTopLevel.length === 0 &&
        queue.every((job) => !Object.prototype.hasOwnProperty.call(job, 'log') && !Object.prototype.hasOwnProperty.call(job, 'result'))
        ? ok('resident.pet_status_lightweight', 'Pet status lightweight payload', `${p.pet.color} · ${p.presence.mode} · detail=${p.pet.detailEndpoint}`)
        : fail('resident.pet_status_lightweight', 'Pet status lightweight payload', `expected slim pet payload, got ${pet.status}`, {
          forbiddenTopLevel,
          hasImage: Boolean(p.screen?.imageDataUrl),
          hasRuntimeDataDir: Boolean(p.runtime?.dataDir),
          pet: p.pet,
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
