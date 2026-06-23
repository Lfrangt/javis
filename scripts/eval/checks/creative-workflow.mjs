import { ok, fail } from '../_client.mjs';

// Creative app workflows (README: "Creative app workflows: recognize video
// editing and music composition requests, choose a likely NLE/DAW … return
// stage action packs"). Preview-only (execute:false) — plans the workflow and
// picks the app, runs nothing.
const NLE = /Final Cut Pro|DaVinci Resolve|Premiere|iMovie|CapCut/i;
const DAW = /Logic Pro|GarageBand|Ableton|FL Studio|Pro Tools/i;

export default {
  lane: 'creative-workflow',
  async run(ctx) {
    const out = [];

    const video = await ctx.api('/api/creative/workflow', {
      method: 'POST',
      body: { instruction: 'trim and add subtitles to a clip', intent: 'video_edit', execute: false, source: 'eval' },
      timeoutMs: 15000,
    });
    const v = video.data || {};
    const vApp = v.selectedApp?.name || v.selectedApp || '';
    out.push(
      video.ok && v.ok === true && v.executed === false && NLE.test(String(vApp)) && (v.stages || []).length > 0 && (v.actionPacks || []).length > 0
        ? ok('creative.video', 'Video edit workflow plan', `app=${vApp} · ${v.stages.length} stage(s) · ${v.actionPacks.length} action pack(s) · ${(v.candidates || []).length} candidate(s)`)
        : fail('creative.video', 'Video edit workflow plan', `did not plan a video-edit workflow (app=${vApp}, executed=${v.executed}, stages=${(v.stages || []).length})`, v),
    );

    const music = await ctx.api('/api/creative/workflow', {
      method: 'POST',
      body: { instruction: 'sketch a MIDI melody and mix', intent: 'music_compose', execute: false, source: 'eval' },
      timeoutMs: 15000,
    });
    const m = music.data || {};
    const mApp = m.selectedApp?.name || m.selectedApp || '';
    out.push(
      music.ok && m.ok === true && m.executed === false && DAW.test(String(mApp)) && (m.stages || []).length > 0
        ? ok('creative.music', 'Music compose workflow plan', `app=${mApp} · ${m.stages.length} stage(s) · ${(m.nextActions || []).length} next action(s)`)
        : fail('creative.music', 'Music compose workflow plan', `did not plan a music-compose workflow (app=${mApp}, executed=${m.executed}, stages=${(m.stages || []).length})`, m),
    );

    return out;
  },
};
