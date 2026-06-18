#!/usr/bin/env node
// Routing lane classifier eval.
//
// Sends a labeled corpus through POST /api/tasks/route (preview, execute:false)
// and reports lane-classification accuracy. Guards the deterministic router
// (routeTaskDecision: realtime/quick → background → codex → claude) against
// regressions, and documents expected routing by example. Preview-only — never
// executes a routed task, but it may append local routing records.
//
// Usage:
//   node scripts/eval-routing.mjs
//   node scripts/eval-routing.mjs --json
//   npm run eval:routing
//
// Cases that get intercepted by a deterministic local command (open app/url,
// search, inbox, status …) are reported as SKIP, since that is also valid.

import { makeContext } from './eval/_client.mjs';

// Each case targets a specific rule in routeTaskDecision. Labels are derived
// from the rule cascade, so a mismatch means the router's behavior drifted.
const CORPUS = [
  // quick / realtime — short, simple, no code/long/computer signal
  { task: '你好，帮我取个英文名', lane: 'quick', why: 'short, no signals' },
  { task: 'What is two plus two?', lane: 'quick', why: 'simple question' },
  { task: '谢谢你的帮助', lane: 'quick', why: 'short chit-chat' },
  { task: 'is it going to rain ideas today?', lane: 'quick', why: 'simple question form' },

  // codex — code signal + action/length
  { task: '修复这个登录 bug', lane: 'codex', why: 'codeSignal(bug)+action(修复)' },
  { task: 'implement a REST api endpoint for login', lane: 'codex', why: 'codeSignal(api,endpoint)+action(implement)' },
  { task: 'refactor the electron main process module', lane: 'codex', why: 'codeSignal(electron)+action(refactor)' },
  { task: 'fix the failing lint errors in the build', lane: 'codex', why: 'codeSignal(lint,build)+action(fix)' },
  { task: '帮我调试这个 React 组件的报错', lane: 'codex', why: 'codeSignal(react)+action(调试)' },

  // background / deep — long-work or computer-work signal
  { task: '调研一下三个竞品并写一份对比报告', lane: 'background', why: 'longWorkSignal(调研,报告)' },
  { task: '总结这篇文章的核心要点', lane: 'background', why: 'longWorkSignal(总结)' },
  { task: '分析我最近一周的工作习惯', lane: 'background', why: 'longWorkSignal(分析)' },
  { task: 'research the best vector database and summarize the tradeoffs', lane: 'background', why: 'longWorkSignal(research,summarize)' },

  // claude — explicit request
  { task: '用 claude 帮我写一段文档', lane: 'claude', why: 'explicitClaude' },
  { task: 'let claude code review this change', lane: 'claude', why: 'explicitClaude(claude code)' },

  // codex — explicit request
  { task: '让 codex 跑一下测试套件', lane: 'codex', why: 'explicitCodex' },
];

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');

async function main() {
  const { api, baseUrl } = makeContext();

  const health = await api('/api/health');
  if (!health.ok && health.status !== 401) {
    const msg = `JAVIS not reachable at ${baseUrl} (${health.error || health.status}).`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const c of CORPUS) {
    const r = await api('/api/tasks/route', {
      method: 'POST',
      body: { message: c.task, execute: false, useMemory: false, source: 'eval-routing' },
    });
    const decision = r.data?.decision || r.data?.result?.decision;
    const lane = decision?.lane;
    const isLocal = Boolean(decision?.localCommand) || lane === 'local';
    let status;
    if (!r.ok || !decision) status = 'error';
    else if (isLocal) status = 'skip';
    else if (lane === c.lane) status = 'pass';
    else status = 'fail';
    rows.push({ ...c, got: lane || `HTTP ${r.status}`, status, confidence: decision?.confidence, reason: decision?.reason });
  }

  const graded = rows.filter((r) => r.status === 'pass' || r.status === 'fail');
  const passed = rows.filter((r) => r.status === 'pass').length;
  const accuracy = graded.length ? passed / graded.length : 1;
  const counts = rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});

  if (jsonMode) {
    console.log(JSON.stringify({ baseUrl, accuracy, counts, rows }, null, 2));
  } else {
    console.log(`Routing classifier eval  —  ${baseUrl}`);
    console.log('');
    for (const r of rows) {
      const tag = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', error: 'ERR ' }[r.status];
      const got = r.status === 'fail' ? `  (got ${r.got}, expected ${r.lane})` : r.status === 'skip' ? '  (local command)' : '';
      console.log(`[${tag}] ${r.lane.padEnd(10)} ${JSON.stringify(r.task).slice(0, 52)}${got}`);
    }
    console.log('');
    console.log(`accuracy ${(accuracy * 100).toFixed(0)}%  (${passed}/${graded.length} graded · ${counts.skip || 0} skip · ${counts.error || 0} err)`);
  }

  if ((counts.fail || 0) > 0 || (counts.error || 0) > 0) process.exitCode = 1;
}

await main();
