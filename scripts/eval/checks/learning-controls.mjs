import { ok, fail, skip } from '../_client.mjs';

// Local user-distillation control loop mutations (README: "pause/resume,
// prompt-inclusion, delete, promote-to-memory, and app/site/folder exclusion
// controls"). Exercises the reversible controls — distill (idempotent),
// exclusion add/remove, pause/resume — and restores the original state. Skips
// promote/remember/skill-draft-save (those create durable memories/files).
export default {
  lane: 'learning-controls',
  async run(ctx) {
    const out = [];

    const before = await ctx.api('/api/learning');
    const l0 = before.data?.learning;
    if (!before.ok || !l0?.controls) {
      out.push(fail('lc.read', 'Learning controls', `GET /api/learning ${before.status} ${before.error || ''}`));
      return out;
    }
    if (!l0.configured) {
      out.push(skip('lc.read', 'Learning controls', 'ambient learning not configured (JAVIS_AMBIENT_LEARNING=false) — control mutations not exercised'));
      return out;
    }
    const wasPaused = Boolean(l0.controls.paused);

    // distill — idempotent refresh, safe to call.
    const distill = await ctx.api('/api/learning/distill', { method: 'POST', body: { source: 'eval' } });
    out.push(
      distill.ok && distill.data?.ok !== false
        ? ok('lc.distill', 'Distill refresh', `profile refreshed (${distill.data?.learning?.profile?.sourceEventCount ?? '?'} event(s))`)
        : fail('lc.distill', 'Distill refresh', `POST /api/learning/distill ${distill.status} ${distill.error || ''}`),
    );

    // exclusion add → verify → remove → verify (reversible).
    const probe = '__eval_probe_app__';
    const add = await ctx.api('/api/learning/exclusions', { method: 'POST', body: { kind: 'app', value: probe, source: 'eval' } });
    const added = (add.data?.learning?.controls?.excludedApps || []).includes(probe);
    const remove = await ctx.api('/api/learning/exclusions', { method: 'DELETE', body: { kind: 'app', value: probe, source: 'eval' } });
    const removed = !(remove.data?.learning?.controls?.excludedApps || []).includes(probe);
    out.push(
      add.ok && added && remove.ok && removed
        ? ok('lc.exclusions', 'Exclusion add/remove', 'app exclusion added then cleanly removed')
        : fail('lc.exclusions', 'Exclusion add/remove', `add=${add.status}/${added} remove=${remove.status}/${removed}`, { add: add.data, remove: remove.data }),
    );

    // pause → verify → resume → restore original paused state.
    let pausedOk = false;
    let resumedOk = false;
    try {
      const pause = await ctx.api('/api/learning/pause', { method: 'POST', body: { source: 'eval' } });
      pausedOk = pause.ok && pause.data?.learning?.controls?.paused === true;
      const resume = await ctx.api('/api/learning/resume', { method: 'POST', body: { source: 'eval' } });
      resumedOk = resume.ok && resume.data?.learning?.controls?.paused === false;
    } finally {
      // Restore whatever the original paused state was.
      await ctx.api(wasPaused ? '/api/learning/pause' : '/api/learning/resume', { method: 'POST', body: { source: 'eval' } });
    }
    out.push(
      pausedOk && resumedOk
        ? ok('lc.pause_resume', 'Pause/resume', `pause and resume both took effect · restored to paused=${wasPaused}`)
        : fail('lc.pause_resume', 'Pause/resume', `pause=${pausedOk} resume=${resumedOk}`),
    );

    // Confirm we left the controls as we found them.
    const after = await ctx.api('/api/learning');
    const lc = after.data?.learning?.controls || {};
    const restored = Boolean(lc.paused) === wasPaused && !(lc.excludedApps || []).includes(probe);
    out.push(
      restored
        ? ok('lc.restore', 'State restored', `paused=${lc.paused} · no eval exclusions left`)
        : fail('lc.restore', 'State restored', `controls not restored (paused=${lc.paused}, expected ${wasPaused})`, lc),
    );

    return out;
  },
};
