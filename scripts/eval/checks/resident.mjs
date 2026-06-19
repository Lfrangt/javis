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
