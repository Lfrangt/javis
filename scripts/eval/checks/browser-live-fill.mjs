import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, fail, skip } from '../_client.mjs';

const execFileAsync = promisify(execFile);
const LIVE_FLAG = 'JAVIS_EVAL_BROWSER_LIVE_FILL';
const DEFAULT_BROWSER_CANDIDATES = [
  'Google Chrome',
  'Arc',
  'Comet',
  'Brave Browser',
  'Microsoft Edge',
  'Safari',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dogfoodPageHtml(runId) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>JAVIS Browser Fill Dogfood ${escapeHtml(runId)}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; margin: 32px; max-width: 720px; }
      label { display: block; margin: 16px 0 6px; font-weight: 600; }
      input, select { width: 320px; padding: 8px; font-size: 15px; }
      button { margin-top: 18px; padding: 8px 12px; }
    </style>
  </head>
  <body>
    <h1>JAVIS Browser Fill Dogfood</h1>
    <p id="status">not submitted</p>
    <form id="dogfood-form">
      <label for="name">Name</label>
      <input id="name" name="name" placeholder="Full name" autocomplete="off">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" placeholder="Email address" autocomplete="off">
      <label for="plan">Plan</label>
      <select id="plan" name="plan">
        <option value="">Choose a plan</option>
        <option value="starter">Starter</option>
        <option value="pro">Pro</option>
      </select>
      <button id="submit" type="submit">Submit</button>
    </form>
    <script>
      document.getElementById('dogfood-form').addEventListener('submit', (event) => {
        event.preventDefault();
        document.getElementById('status').textContent = 'submitted';
      });
    </script>
  </body>
</html>`;
}

function startDogfoodServer(runId) {
  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(dogfoodPageHtml(runId));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function closeDogfoodServer(server) {
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

async function installedBrowserApps() {
  const explicit = String(process.env.JAVIS_EVAL_BROWSER_APP || '').trim();
  const candidates = explicit ? [explicit] : DEFAULT_BROWSER_CANDIDATES;
  const apps = [];
  for (const app of candidates) {
    try {
      await execFileAsync('/usr/bin/open', ['-Ra', app], { timeout: 5000 });
      apps.push(app);
    } catch {
      // Try the next supported browser.
    }
  }
  return apps;
}

async function openBrowser(app, targetUrl) {
  if (app === 'Google Chrome') {
    const executable = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!fs.existsSync(executable)) {
      await execFileAsync('/usr/bin/open', ['-a', app, targetUrl], { timeout: 8000 });
      return;
    }
    const profile = path.join(os.tmpdir(), 'javis-browser-live-fill-chrome-profile');
    const child = spawn(executable, [
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl,
    ], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    await sleep(2500);
    return;
  }
  await execFileAsync('/usr/bin/open', ['-a', app, targetUrl], { timeout: 8000 });
}

async function closeDogfoodBrowserTabs(app, urlNeedle) {
  const quotedNeedle = JSON.stringify(urlNeedle);
  const quotedApp = JSON.stringify(app);
  const chromiumScript = `
tell application ${quotedApp}
  repeat with browserWindow in windows
    set matchingTabs to {}
    repeat with browserTab in tabs of browserWindow
      try
        if (URL of browserTab as text) contains ${quotedNeedle} then set end of matchingTabs to browserTab
      end try
    end repeat
    repeat with browserTab in matchingTabs
      close browserTab
    end repeat
  end repeat
end tell
`.trim();
  const safariScript = `
tell application ${quotedApp}
  repeat with browserDocument in documents
    try
      if (URL of browserDocument as text) contains ${quotedNeedle} then close browserDocument
    end try
  end repeat
end tell
`.trim();
  const script = app.startsWith('Safari') ? safariScript : chromiumScript;
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 5000 });
  } catch {
    // Cleanup is best-effort; the dogfood result itself is already recorded.
  }
}

async function waitForBrowserContext(ctx, app, urlNeedle, timeoutMs = 18000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const res = await ctx.api(`/api/browser/context?app=${encodeURIComponent(app)}`, { timeoutMs: 10000 });
    latest = res.data?.context || res.data || { status: res.status, error: res.error };
    if (res.ok && latest?.available && String(latest.url || '').includes(urlNeedle)) return latest;
    await sleep(1000);
  }
  return latest;
}

export default {
  lane: 'browser-live-fill',
  async run(ctx) {
    const out = [];

    if (process.env[LIVE_FLAG] !== 'true') {
      out.push(skip(
        'browser_live_fill.opt_in',
        'Live browser fill dogfood',
        `set ${LIVE_FLAG}=true to open a local test form in a supported browser and run confirmed fill verification`,
      ));
      return out;
    }
    if (process.platform !== 'darwin') {
      out.push(skip('browser_live_fill.platform', 'Live browser fill dogfood', 'requires macOS browser automation'));
      return out;
    }

    const apps = await installedBrowserApps();
    if (!apps.length) {
      out.push(skip('browser_live_fill.browser', 'Supported browser app', 'no supported browser app found; set JAVIS_EVAL_BROWSER_APP'));
      return out;
    }

    const runId = `m${Date.now().toString(36)}`;
    const server = await startDogfoodServer(runId);
    const port = server.address().port;
    const targetUrl = `http://127.0.0.1:${port}/?run=${encodeURIComponent(runId)}`;
    const urlNeedle = `127.0.0.1:${port}`;
    const name = `JAVIS Live ${runId}`;
    const email = `javis-${runId}@example.test`;

    let app = '';
    try {
      let context = null;
      const attempts = [];
      for (const candidate of apps) {
        try {
          await openBrowser(candidate, targetUrl);
          const candidateContext = await waitForBrowserContext(ctx, candidate, urlNeedle);
          attempts.push({
            app: candidate,
            available: Boolean(candidateContext?.available),
            title: candidateContext?.title || '',
            url: candidateContext?.url || '',
            error: candidateContext?.error || '',
          });
          if (candidateContext?.available && String(candidateContext.url || '').includes(urlNeedle)) {
            app = candidate;
            context = candidateContext;
            break;
          }
        } catch (error) {
          attempts.push({ app: candidate, available: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      out.push(
        app && context?.available && String(context.url || '').includes(urlNeedle)
          ? ok('browser_live_fill.context', 'Live dogfood page opened', `${app} · ${context.title || context.url}`)
          : fail('browser_live_fill.context', 'Live dogfood page opened', `no supported browser reached ${targetUrl}`, { attempts }),
      );
      if (!app || !context?.available || !String(context.url || '').includes(urlNeedle)) return out;

      const javascript = await ctx.api(`/api/browser/javascript?app=${encodeURIComponent(app)}`, { timeoutMs: 20000 });
      const js = javascript.data?.javascript;
      out.push(
        javascript.ok && js?.enabled
          ? ok('browser_live_fill.javascript', 'Browser JavaScript bridge', `${js.bridge || 'bridge'} enabled`)
          : fail('browser_live_fill.javascript', 'Browser JavaScript bridge', js?.error || `HTTP ${javascript.status}`, javascript.data),
      );
      if (!javascript.ok || !js?.enabled) return out;

      const dom = await ctx.api(`/api/browser/dom?app=${encodeURIComponent(app)}&limit=20`, { timeoutMs: 20000 });
      const controls = dom.data?.dom?.elements || [];
      const hasExpectedControls = ['Name', 'Email', 'Plan'].every((label) => controls.some((item) => item.label === label || item.name?.toLowerCase() === label.toLowerCase()));
      out.push(
        dom.ok && hasExpectedControls
          ? ok('browser_live_fill.dom', 'Live DOM controls', `${controls.length} control(s), expected form fields visible`)
          : fail('browser_live_fill.dom', 'Live DOM controls', 'expected Name, Email, and Plan controls in live DOM snapshot', dom.data),
      );
      if (!dom.ok || !hasExpectedControls) return out;

      const fill = await ctx.api('/api/browser/fill-draft', {
        method: 'POST',
        timeoutMs: 60000,
        body: {
          app,
          source: 'eval_browser_live_fill',
          fields: { Name: name, Email: email, Plan: 'Pro' },
          execute: true,
          confirm: true,
        },
      });
      const data = fill.data || {};
      const verified = data.verification || {};
      const recovery = data.recovery || {};
      const privateEvidence = JSON.stringify({
        verification: data.verification,
        recovery: data.recovery,
        results: data.results,
      });
      const resultValuesRedacted = (data.results || []).every((result) => {
        const value = String(result.plan?.args?.value || '');
        return !value.includes(email) && (!value || value.startsWith('[redacted '));
      });
      out.push(
        fill.ok &&
          data.ok === true &&
          data.executed === true &&
          verified.status === 'verified' &&
          verified.verifiedCount === 3 &&
          recovery.needed === false &&
          resultValuesRedacted &&
          !privateEvidence.includes(email)
          ? ok('browser_live_fill.verified_fill', 'Confirmed fill verification', `verified ${verified.verifiedCount}/3 field(s), recovery=${recovery.status}`)
          : fail('browser_live_fill.verified_fill', 'Confirmed fill verification', `POST /api/browser/fill-draft ${fill.status}`, data),
      );

      const page = await ctx.api(`/api/browser/page?app=${encodeURIComponent(app)}&maxChars=1200`, { timeoutMs: 20000 });
      const text = String(page.data?.page?.text || '');
      out.push(
        page.ok && text.includes('not submitted') && !text.includes('submitted submitted')
          ? ok('browser_live_fill.no_submit', 'Form was not submitted', 'page still reports not submitted after fill')
          : fail('browser_live_fill.no_submit', 'Form was not submitted', 'form status did not prove non-submit behavior', page.data),
      );
    } finally {
      if (app) await closeDogfoodBrowserTabs(app, urlNeedle);
      await closeDogfoodServer(server);
    }

    return out;
  },
};
