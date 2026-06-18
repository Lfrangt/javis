#!/usr/bin/env node
// Verify Accessibility (AX) targeting for web-content editables (e.g. a docked
// Gemini composer in Chrome). Codifies the Reproduction + Acceptance criteria of
// docs/issues/2026-06-17-gemini-pane-ax-targeting.md into a repeatable check.
//
// Read-only by default: it reads the AX tree and previews a set_value target
// without performing any action. Pass --execute to actually type and verify
// (this requires Level 3 local execution to be enabled in JAVIS).
//
// Usage:
//   node scripts/verify-ax-targeting.mjs
//   node scripts/verify-ax-targeting.mjs --instruction "type into the Gemini box"
//   node scripts/verify-ax-targeting.mjs --execute --content "hello from JAVIS"
//   node scripts/verify-ax-targeting.mjs --require-chromium
//   node scripts/verify-ax-targeting.mjs --json
//
// Point it at the frontmost app you want to test (focus Chrome with the Gemini
// pane docked on the right, then run this). It targets whatever is frontmost,
// exactly like JAVIS does.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
const opts = new Map(
  argv
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=')];
    }),
);
function opt(name, fallback) {
  if (opts.has(name)) return opts.get(name);
  const idx = argv.indexOf(`--${name}`);
  if (idx !== -1 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return fallback;
}

const baseUrl = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const dataDir = process.env.JAVIS_DATA_DIR || path.join(appSupportDir, 'Runtime');
const apiTokenFile = process.env.JAVIS_API_TOKEN_FILE || path.join(dataDir, 'api-token');

const jsonMode = flags.has('--json');
const doExecute = flags.has('--execute');
const requireChromium = flags.has('--require-chromium');
const instruction = opt('instruction', 'type into the Gemini box');
const content = opt('content', 'JAVIS AX target check');
const maxNodes = Number(opt('max-nodes', 240));
const maxDepth = Number(opt('max-depth', 9));

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(apiTokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

const token = readApiToken();

async function api(pathname, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers['X-JAVIS-Token'] = token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, data };
}

// Heuristic: does this AX node look like a web text composer/editable?
function looksEditable(node = {}) {
  const role = String(node.role || '');
  const settableRoles = ['AXComboBox', 'AXSearchField', 'AXTextArea', 'AXTextField'];
  const text = [
    node.role,
    node.subrole,
    node.roleDescription,
    node.domRole,
    node.editable,
    node.placeholder,
    node.title,
    node.name,
    node.domIdentifier,
    node.domClassList,
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  const editableSignal = /(^|[^a-z])true([^a-z]|$)|contenteditable|editable|textbox|searchbox|rich.?textarea|text area|text field|composer|compose|input/.test(text);
  return settableRoles.includes(role) || editableSignal;
}

function looksLikeComposer(node = {}) {
  const text = [node.placeholder, node.title, node.name, node.domIdentifier, node.roleDescription]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return /gemini|ask|message|prompt|compose|chat|search|type/.test(text);
}

const results = [];
function record(id, label, status, detail, evidence) {
  results.push({ id, label, status, detail, evidence });
}

async function main() {
  // 0. Service reachable
  const health = await api('/api/health').catch(() => null);
  if (!health || (!health.ok && health.status !== 401)) {
    record('service', 'JAVIS resident service', 'fail', `Not reachable at ${baseUrl}. Start JAVIS first.`);
    return;
  }
  if (health.status === 401) {
    record('auth', 'Local API token', 'fail', `401 from ${baseUrl}. Token missing or wrong (looked in ${apiTokenFile}).`);
    return;
  }
  record('service', 'JAVIS resident service', 'pass', `Reachable at ${baseUrl}.`);

  // 1. Read the AX tree (Fix A + B): is the web AX tree exposed and reachable?
  const tree = await api(`/api/accessibility/tree?maxNodes=${maxNodes}&maxDepth=${maxDepth}`);
  if (!tree.ok || !tree.data?.tree) {
    record('tree', 'AX tree read', 'fail', tree.data?.details || tree.data?.error || `HTTP ${tree.status}`);
    return;
  }
  const t = tree.data.tree;
  const nodes = Array.isArray(t.nodes) ? t.nodes : [];
  const chromiumApp = /chrome|chromium|brave|edge|arc|comet/i.test(String(t.app || ''));

  record(
    'tree',
    'AX tree read',
    t.available ? 'pass' : requireChromium ? 'fail' : 'warn',
    `app="${t.app || '?'}" nodes=${t.nodeCount} truncated=${t.truncated} maxNodes=${t.maxNodes} maxDepth=${t.maxDepth}`,
    { app: t.app, windowTitle: t.windowTitle, nodeCount: t.nodeCount, truncated: t.truncated },
  );
  if (!t.available) {
    record('fix-a-activate', 'Fix A · Chromium web AX activated', 'skip', 'AX tree is not available; focus a normal app or Chrome tab and retry.');
    record('fix-b-budget', 'Fix B · walk budget reaches editables', 'skip', 'AX tree is not available.');
    record('fix-d-expose', 'Fix D · editable composer exposed with label', 'skip', 'AX tree is not available.');
    record('plan', 'Target selection (plan)', 'skip', 'AX tree is not available.');
    record('fix-c-target', 'Fix C · set_value resolves the editable', 'skip', 'AX tree is not available.');
    record('fix-e-execute', 'Fix E · execute + verify', 'skip', 'AX tree is not available.');
    return;
  }

  // Fix A: Chromium web accessibility activated before the read.
  if (chromiumApp) {
    const activated = t.chromiumAccessibilityActivated;
    record(
      'fix-a-activate',
      'Fix A · Chromium web AX activated',
      activated ? 'pass' : 'warn',
      activated
        ? 'AXManualAccessibility/AXEnhancedUserInterface was set on the Chromium app before reading.'
        : 'chromiumAccessibilityActivated is falsy — web AX tree may be shallow/empty.',
      { chromiumAccessibilityActivated: activated },
    );
  } else {
    record(
      'fix-a-activate',
      'Fix A · Chromium web AX activated',
      requireChromium ? 'fail' : 'skip',
      `Frontmost app "${t.app}" is not Chromium. Focus Chrome to test the Gemini case.`,
    );
    if (requireChromium) return;
  }

  // Fix B: budget deep enough to reach editables without truncation starving the right pane.
  record(
    'fix-b-budget',
    'Fix B · walk budget reaches editables',
    t.truncated && nodes.length >= maxNodes ? 'warn' : 'pass',
    t.truncated
      ? `Tree truncated at ${t.nodeCount} nodes — a right-docked composer may still be starved. Consider raising read_accessibility_tree.maxNodes.`
      : `Tree fully walked (${t.nodeCount} nodes, not truncated).`,
  );

  if (!chromiumApp) {
    record('fix-d-expose', 'Fix D · editable composer exposed with label', 'skip', 'Gemini composer checks require Chromium frontmost.');
    record('plan', 'Target selection (plan)', 'skip', 'Skipped because the frontmost app is not Chromium.');
    record('fix-c-target', 'Fix C · set_value resolves the editable', 'skip', 'Skipped because the frontmost app is not Chromium.');
    record('fix-e-execute', 'Fix E · execute + verify', 'skip', 'Skipped because the frontmost app is not Chromium.');
    return;
  }

  // Fix D: editable composer nodes are present with a usable role + label.
  const editableNodes = nodes.filter(looksEditable);
  const composerNodes = editableNodes.filter(looksLikeComposer);
  record(
    'fix-d-expose',
    'Fix D · editable composer exposed with label',
    editableNodes.length ? (composerNodes.length ? 'pass' : 'warn') : 'fail',
    editableNodes.length
      ? `${editableNodes.length} editable node(s); ${composerNodes.length} look like a composer (gemini/ask/message/search).`
      : 'No editable text node found in the AX tree.',
    {
      editable: editableNodes.slice(0, 6).map((n) => ({ id: n.id, role: n.role, domRole: n.domRole, placeholder: n.placeholder, label: n.label || n.name })),
    },
  );

  // 2. Plan (read-only): does scoring surface the editable as a top candidate?
  const plan = await api('/api/accessibility/plan', {
    method: 'POST',
    body: { instruction, action: 'set_value', content, maxNodes, maxDepth },
  });
  if (plan.ok && plan.data) {
    const rec = plan.data.recommended || {};
    const cands = Array.isArray(plan.data.candidates) ? plan.data.candidates : [];
    const top = cands[0];
    const recIsEditable = rec.nodeId && looksEditable(nodes.find((n) => n.id === rec.nodeId) || { role: rec.role });
    record(
      'plan',
      'Target selection (plan)',
      rec.type === 'dry_run_ui_target' && recIsEditable ? 'pass' : rec.type === 'dry_run_ui_target' ? 'warn' : 'fail',
      rec.type === 'dry_run_ui_target'
        ? `Recommended #${rec.nodeId} ${rec.role} "${rec.label || ''}" (top score ${top?.score ?? '?'}, ${cands.length} candidates).`
        : `No target: ${rec.summary || plan.data.tree?.error || 'no_target'}.`,
      { recommended: rec, topCandidates: cands.slice(0, 5) },
    );
  } else {
    record('plan', 'Target selection (plan)', 'fail', plan.data?.details || `HTTP ${plan.status}`);
  }

  // 3. Control preview (read-only): does set_value resolve a real target (not no_target)?
  const preview = await api('/api/accessibility/control', {
    method: 'POST',
    body: { instruction, action: 'set_value', content, execute: false, maxNodes, maxDepth },
  });
  const pv = preview.data || {};
  record(
    'fix-c-target',
    'Fix C · set_value resolves the editable',
    pv.target?.nodeId ? 'pass' : 'fail',
    pv.target?.nodeId
      ? `set_value would target #${pv.target.nodeId} ${pv.target.role} "${pv.target.label || ''}". ${pv.evaluation?.needsApproval ? `(needs approval: ${pv.evaluation.reason})` : ''}`
      : `No settable target resolved: ${pv.output || pv.plan?.recommended?.summary || 'no_target'}.`,
    { target: pv.target, evaluation: pv.evaluation },
  );

  // 4. Optional execute + verify (Fix E). Off unless --execute.
  if (doExecute) {
    const exec = await api('/api/accessibility/control', {
      method: 'POST',
      body: { instruction, action: 'set_value', content, execute: true, maxNodes, maxDepth },
    });
    const ev = exec.data || {};
    if (ev.approval) {
      record('fix-e-execute', 'Fix E · execute + verify', 'warn', `Blocked on approval: ${ev.approval.summary}. Approve it or set JAVIS_TRUSTED_LOCAL_MODE/maxAutoRiskLevel.`, { approval: ev.approval });
    } else if (ev.executed) {
      const verified = ev.verified ?? ev.output;
      record('fix-e-execute', 'Fix E · execute + verify', 'pass', `Executed: ${ev.output}`, { output: ev.output, verified });
    } else {
      record('fix-e-execute', 'Fix E · execute + verify', 'fail', ev.output || ev.data?.details || `HTTP ${exec.status}. Is JAVIS_ENABLE_LOCAL_EXEC=true?`);
    }
  } else {
    record('fix-e-execute', 'Fix E · execute + verify', 'skip', 'Read-only run. Re-run with --execute to type and verify (needs Level 3 local exec).');
  }
}

function icon(status) {
  return { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }[status] || status.toUpperCase();
}

try {
  await main();
} catch (error) {
  record('error', 'Harness error', 'fail', error instanceof Error ? error.message : String(error));
}

if (jsonMode) {
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  console.log(JSON.stringify({ baseUrl, instruction, results, counts }, null, 2));
} else {
  console.log(`JAVIS AX targeting check  —  ${baseUrl}`);
  console.log(`instruction: "${instruction}"  budget: ${maxNodes}/${maxDepth}  mode: ${doExecute ? 'execute' : 'read-only'}`);
  console.log('');
  for (const r of results) {
    console.log(`[${icon(r.status)}] ${r.label}: ${r.detail}`);
  }
  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log('');
  console.log(`${fails} fail, ${warns} warn, ${results.filter((r) => r.status === 'pass').length} pass`);
}

if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
