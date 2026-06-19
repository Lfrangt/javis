import { ok, warn, fail } from '../_client.mjs';

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

    const fixturePage = {
      available: true,
      supported: true,
      app: 'FixtureBrowser',
      title: 'Signup Form',
      url: 'https://example.test/signup',
      text: 'Name Email Plan',
    };
    const fixtureDom = {
      available: true,
      supported: true,
      app: 'FixtureBrowser',
      title: 'Signup Form',
      url: 'https://example.test/signup',
      elements: [
        { id: '1', selector: '#name', tag: 'input', type: 'text', label: 'Name', placeholder: 'Full name', name: 'name', disabled: false },
        { id: '2', selector: '#email', tag: 'input', type: 'email', label: 'Email', placeholder: 'Email address', name: 'email', disabled: false },
        { id: '3', selector: '#plan', tag: 'select', type: '', label: 'Plan', placeholder: '', name: 'plan', disabled: false },
        { id: '4', selector: '#password', tag: 'input', type: 'password', label: 'Password', placeholder: 'Password', name: 'password', disabled: false },
      ],
    };

    const fillDraft = await ctx.api('/api/browser/fill-draft', {
      method: 'POST',
      body: {
        page: fixturePage,
        dom: fixtureDom,
        fields: {
          Name: 'Haoge',
          Email: 'haoge@example.com',
          Plan: 'Pro',
          Password: 'secret-password',
        },
        execute: false,
      },
    });
    out.push(
      fillDraft.ok &&
        fillDraft.data?.intent === 'fill_draft' &&
        fillDraft.data?.executed === false &&
        fillDraft.data?.plan?.steps?.length === 3 &&
        fillDraft.data?.plan?.blocked?.length === 1 &&
        fillDraft.data?.plan?.steps?.every((step) => !String(step.value || '').includes('haoge@example.com')) &&
        !JSON.stringify(fillDraft.data?.fields || []).includes('secret-password') &&
        fillDraft.data?.fields?.find((field) => field.name === 'Password')?.valuePreview === '[sensitive]' &&
        fillDraft.data?.results?.every((result) => result.status === 'previewed')
        ? ok('browser.fill_draft_preview', 'Browser fill draft preview', '3 field fill draft(s), 1 sensitive field blocked')
        : fail('browser.fill_draft_preview', 'Browser fill draft preview', `POST /api/browser/fill-draft ${fillDraft.status}`, fillDraft.data),
    );

    const fixtureExecute = await ctx.api('/api/browser/fill-draft', {
      method: 'POST',
      body: {
        page: fixturePage,
        dom: fixtureDom,
        fields: { Email: 'haoge@example.com' },
        execute: true,
        confirm: true,
      },
    });
    out.push(
      fixtureExecute.ok &&
        fixtureExecute.data?.executed === false &&
        fixtureExecute.data?.results?.[0]?.status === 'blocked' &&
        /fixture/i.test(String(fixtureExecute.data?.output || ''))
        ? ok('browser.fill_draft_fixture_gate', 'Browser fill draft fixture gate', 'fixture DOM cannot execute browser fills')
        : fail('browser.fill_draft_fixture_gate', 'Browser fill draft fixture gate', `POST /api/browser/fill-draft ${fixtureExecute.status}`, fixtureExecute.data),
    );

    return out;
  },
};
