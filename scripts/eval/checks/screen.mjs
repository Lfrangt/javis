import { ok, warn, fail } from '../_client.mjs';

// Screen privacy mode (README: "Private screen mode that downscales/blurs frames
// before they leave the renderer"). Read-only — reads the mode, never changes it.
export default {
  lane: 'screen',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/screen/privacy');
    const privacy = r.data?.privacy;
    if (!r.ok || !privacy) {
      out.push(fail('screen.privacy', 'Screen privacy mode', `GET /api/screen/privacy ${r.status} ${r.error || ''}`));
      return out;
    }
    const mode = privacy.mode || privacy.value || (typeof privacy === 'string' ? privacy : '');
    out.push(
      mode
        ? ok('screen.privacy', 'Screen privacy mode', `mode=${mode}${mode === 'private' ? ' (frames downscaled/blurred before leaving renderer — safe default)' : ''}`, { mode })
        : warn('screen.privacy', 'Screen privacy mode', `privacy state present but no mode field (${Object.keys(privacy).slice(0, 6).join(',')})`, { privacy }),
    );

    return out;
  },
};
