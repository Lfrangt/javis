#!/usr/bin/env node
// JAVIS evaluation harness runner.
//
// Runs read-only lane checks against the live local API and prints a scorecard.
// Fulfils the GOAL "Evaluation harness" commitment and ROADMAP Phase 4
// "Evaluation suite". Safe by default: checks only read or preview (execute:false).
//
// Usage:
//   node scripts/eval/run.mjs                 # all lanes
//   node scripts/eval/run.mjs --only=briefing,memory
//   node scripts/eval/run.mjs --json
//   npm run eval
//
// Token/port auto-discovered like scripts/doctor.mjs.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { makeContext, scoreResults } from './_client.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const checksDir = path.join(here, 'checks');

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const listMode = argv.includes('--list');
const onlyArg = argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
const configuredLaneTimeoutMs = Number(process.env.JAVIS_EVAL_LANE_TIMEOUT_MS || 300000);
const LANE_TIMEOUT_MS = Number.isFinite(configuredLaneTimeoutMs)
  ? Math.max(30000, Math.min(600000, configuredLaneTimeoutMs))
  : 300000;

async function loadChecks() {
  let files = [];
  try {
    files = fs.readdirSync(checksDir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return [];
  }
  const modules = [];
  for (const file of files) {
    const mod = await import(url.pathToFileURL(path.join(checksDir, file)).href);
    const def = mod.default || mod;
    if (def && typeof def.run === 'function' && def.lane) modules.push(def);
  }
  return modules;
}

function icon(status) {
  return { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP' }[status] || status.toUpperCase();
}

function bar(score) {
  const filled = Math.round(score * 20);
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${(score * 10).toFixed(1)}/10`;
}

async function runLaneWithTimeout(mod, ctx) {
  let timer;
  try {
    return await Promise.race([
      mod.run(ctx),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`lane timed out after ${LANE_TIMEOUT_MS}ms`));
        }, LANE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const ctx = makeContext();
  let modules = await loadChecks();
  if (listMode) {
    const lanes = modules.map((m) => m.lane);
    if (jsonMode) console.log(JSON.stringify({ lanes }, null, 2));
    else console.log(lanes.join('\n'));
    return;
  }
  if (only) {
    const available = new Set(modules.map((m) => m.lane));
    const missing = only.filter((lane) => !available.has(lane));
    modules = modules.filter((m) => only.includes(m.lane));
    if (missing.length) {
      const msg = `Unknown eval lane(s): ${missing.join(', ')}. Available: ${Array.from(available).join(', ')}`;
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
      else console.error(msg);
      process.exitCode = 1;
      return;
    }
  }
  if (!modules.length) {
    const msg = `No eval checks found in ${checksDir}.`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }

  // Preflight: is JAVIS reachable at all?
  const health = await ctx.api('/api/health');
  if (!health.ok && health.status !== 401) {
    const msg = `JAVIS not reachable at ${ctx.baseUrl} (${health.error || health.status}). Start it: npm run desktop`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }
  if (health.status === 401) {
    const msg = `401 from ${ctx.baseUrl}: local API token missing or wrong.`;
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    process.exitCode = 1;
    return;
  }

  const lanes = [];
  for (const mod of modules) {
    let results = [];
    try {
      results = await runLaneWithTimeout(mod, ctx);
    } catch (error) {
      results = [{ id: `${mod.lane}.error`, label: `${mod.lane} crashed`, status: 'fail', detail: error instanceof Error ? error.message : String(error) }];
    }
    lanes.push({ lane: mod.lane, results, ...scoreResults(results) });
  }

  const allResults = lanes.flatMap((l) => l.results);
  const overall = scoreResults(allResults);

  if (jsonMode) {
    console.log(JSON.stringify({ baseUrl: ctx.baseUrl, overall, lanes }, null, 2));
  } else {
    console.log(`JAVIS evaluation  —  ${ctx.baseUrl}`);
    console.log('');
    for (const l of lanes) {
      console.log(`▸ ${l.lane}  ${bar(l.score)}  (${l.counts.pass}P ${l.counts.warn}W ${l.counts.fail}F ${l.counts.skip}S)`);
      for (const r of l.results) {
        console.log(`    [${icon(r.status)}] ${r.label}: ${r.detail}`);
      }
    }
    console.log('');
    console.log(`OVERALL  ${bar(overall.score)}   ${overall.counts.pass} pass · ${overall.counts.warn} warn · ${overall.counts.fail} fail · ${overall.counts.skip} skip`);
  }

  if (overall.counts.fail > 0) process.exitCode = 1;
}

await main();

// Node's built-in fetch can keep an idle local HTTP socket alive long enough to
// make the eval CLI appear hung after all checks have printed. This runner is a
// terminal/test-gate entrypoint, so exit explicitly once the scorecard is done.
setImmediate(() => process.exit(process.exitCode || 0));
