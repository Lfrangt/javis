#!/usr/bin/env node
// AX read budget scan — data for the read-timeout decision.
//
// Sweeps /api/accessibility/tree across node/depth budgets against the current
// frontmost app and reports, per budget: wall-clock, node count, error (notably
// accessibility_tree_read_timeout), truncation, and whether an editable/composer
// node was reachable. Run it with the target app (e.g. Chrome + Gemini) focused.
//
// Purpose: quantify the read-timeout wall documented in
// docs/issues/2026-06-22-ax-execute-index-drift.md, and find the budget that
// completes under the timeout while still reaching the composer — input for a
// "reduced-budget retry on read-timeout" fix in the AX read path.
//
// Usage:
//   node scripts/ax-read-budget-scan.mjs
//   node scripts/ax-read-budget-scan.mjs --json
//   node scripts/ax-read-budget-scan.mjs --runs 3   # repeat each budget N times
//
// Read-only — only reads the AX tree, performs no action.

import { makeContext } from './eval/_client.mjs';

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const runsArg = argv.find((a) => a.startsWith('--runs'));
const runs = Math.max(1, Math.min(5, Number((runsArg && (runsArg.split('=')[1] || argv[argv.indexOf(runsArg) + 1])) || 1)));

const BUDGETS = [
  [40, 6],
  [60, 8],
  [80, 10],
  [120, 10],
  [160, 10],
  [240, 12],
];

function looksEditable(node = {}) {
  const role = String(node.role || '');
  if (['AXComboBox', 'AXSearchField', 'AXTextArea', 'AXTextField'].includes(role)) return true;
  const text = [node.role, node.subrole, node.roleDescription, node.domRole, node.editable, node.placeholder, node.title, node.name, node.domIdentifier]
    .map((v) => String(v || '').toLowerCase()).join(' ');
  return /(^|[^a-z])true([^a-z]|$)|contenteditable|editable|textbox|searchbox|rich.?textarea|text area|text field|composer|compose|input|ask|gemini|message|prompt/.test(text);
}

async function main() {
  const { api, baseUrl } = makeContext();
  const health = await api('/api/health');
  if (!health.ok && health.status !== 401) {
    const msg = `JAVIS not reachable at ${baseUrl} (${health.error || health.status}).`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg })); else console.error(msg);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const [maxNodes, maxDepth] of BUDGETS) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      const r = await api(`/api/accessibility/tree?maxNodes=${maxNodes}&maxDepth=${maxDepth}`, { timeoutMs: 35000, retries: 0 });
      const ms = Math.round(performance.now() - t0);
      const t = r.data?.tree || {};
      const nodes = Array.isArray(t.nodes) ? t.nodes : [];
      samples.push({
        ms,
        app: t.app || '',
        nodeCount: t.nodeCount || 0,
        truncated: Boolean(t.truncated),
        error: t.error || '',
        editableHits: nodes.filter(looksEditable).length,
      });
    }
    const timeouts = samples.filter((s) => s.error === 'accessibility_tree_read_timeout').length;
    const completed = samples.filter((s) => !s.error).length;
    const reachedComposer = samples.filter((s) => s.editableHits > 0).length;
    const avgMs = Math.round(samples.reduce((a, s) => a + s.ms, 0) / samples.length);
    rows.push({ maxNodes, maxDepth, runs, completed, timeouts, reachedComposer, avgMs, samples });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ baseUrl, runs, rows }, null, 2));
    return;
  }

  const app = rows.flatMap((r) => r.samples).map((s) => s.app).find(Boolean) || '(unknown)';
  console.log(`AX read budget scan — frontmost="${app}" — ${runs} run(s)/budget`);
  console.log('');
  console.log('budget     avgMs   complete  timeout  composer  nodes(last)');
  for (const r of rows) {
    const last = r.samples[r.samples.length - 1];
    const flag = r.timeouts === r.runs ? ' ✗ all-timeout' : r.reachedComposer === r.runs && r.completed === r.runs ? ' ✓ reliable+composer' : '';
    console.log(
      `${String(r.maxNodes).padStart(3)}/${String(r.maxDepth).padEnd(2)}   ${String(r.avgMs).padStart(6)}   ${String(r.completed).padStart(2)}/${r.runs}      ${String(r.timeouts).padStart(2)}/${r.runs}     ${String(r.reachedComposer).padStart(2)}/${r.runs}      ${last.nodeCount}${flag}`,
    );
  }
  console.log('');
  const sweet = rows.find((r) => r.completed === r.runs && r.reachedComposer === r.runs);
  console.log(sweet
    ? `Sweet spot: ${sweet.maxNodes}/${sweet.maxDepth} completes under timeout AND reaches a composer (~${sweet.avgMs}ms). A reduced-budget retry at this level would survive read-timeout.`
    : 'No budget both completed and reached a composer this run — focus a stable app/tab and re-run (frontmost may have been stolen, or the page AX tree is too heavy at every budget).');
}

await main();
