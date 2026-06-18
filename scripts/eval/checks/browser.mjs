import { ok, warn } from '../_client.mjs';

export default {
  lane: 'browser',
  async run(ctx) {
    const out = [];

    const context = await ctx.api('/api/browser/context');
    const c = context.data?.context;
    out.push(
      context.ok && c
        ? ok('browser.context', 'Browser context', c.available ? `${c.app || 'browser'} · ${c.title || c.url || 'active tab'}` : 'no supported active browser tab', { available: c.available })
        : warn('browser.context', 'Browser context', `GET /api/browser/context ${context.status} ${context.error || ''}`),
    );

    const javascript = await ctx.api('/api/browser/javascript');
    const js = javascript.data?.javascript;
    out.push(
      javascript.ok && js
        ? ok('browser.javascript', 'Browser JavaScript bridge', `${js.enabled ? 'enabled' : 'not enabled'}${js.bridge ? ` via ${js.bridge}` : ''}`, { supported: js.supported, available: js.available, enabled: js.enabled })
        : warn('browser.javascript', 'Browser JavaScript bridge', `GET /api/browser/javascript ${javascript.status} ${javascript.error || ''}`),
    );

    const dom = await ctx.api('/api/browser/dom?limit=5', { timeoutMs: 15000 });
    const d = dom.data?.dom;
    out.push(
      dom.ok && d
        ? ok('browser.dom', 'Browser DOM snapshot', d.available ? `${(d.controls || d.elements || []).length} visible control(s)` : 'DOM snapshot unavailable for current app/tab', { available: d.available })
        : warn('browser.dom', 'Browser DOM snapshot', `GET /api/browser/dom ${dom.status} ${dom.error || ''}`),
    );

    return out;
  },
};
