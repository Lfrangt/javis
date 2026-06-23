#!/usr/bin/env node
// Acceptance test for the AXWebArea-rooted read fix.
//
// Runs the AXWebArea PoC (scripts/ax-webarea-poc.js) against the frontmost
// Chromium app and gives a PASS/FAIL verdict: does descending to AXWebArea and
// BFS-walking from there reach a web composer within a small node budget (and
// well under the read timeout)? This is the reproducible acceptance gate for the
// read-timeout fix recommended in docs/issues/2026-06-22-ax-execute-index-drift.md.
//
// Usage: focus Chrome with a contenteditable/composer page (or Gemini), then:
//   node scripts/verify-ax-webarea.mjs
//   node scripts/verify-ax-webarea.mjs --json
//   npm run verify:ax-webarea
//
// Read-only — only reads the AX tree, performs no action.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import url from 'node:url';

const execFileAsync = promisify(execFile);
const here = path.dirname(url.fileURLToPath(import.meta.url));
const poc = path.join(here, 'ax-webarea-poc.js');

const jsonMode = process.argv.includes('--json');
// Reaching the composer within this many nodes from AXWebArea = the fix works.
const NODE_BUDGET = 60;
const MS_BUDGET = 3000;

async function frontmost() {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'tell application "System Events" to name of first application process whose frontmost is true'], { timeout: 5000 });
    return String(stdout).trim();
  } catch {
    return '';
  }
}

async function main() {
  const app = await frontmost();
  const isChromium = /Chrome|Chromium|Brave|Edge|Arc|Comet/i.test(app);

  let result;
  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', poc], { timeout: 40000, maxBuffer: 1_000_000 });
    result = JSON.parse(String(stdout || '{}'));
  } catch (error) {
    result = { error: error?.killed ? 'poc_timeout' : String(error?.message || error) };
  }

  const reached = result.composer && Number(result.composer.scanned) <= NODE_BUDGET;
  const fast = Number(result.scanMs || Infinity) + Number(result.findMs || 0) <= MS_BUDGET;
  const pass = Boolean(result.webAreaFound && reached && fast);

  if (jsonMode) {
    console.log(JSON.stringify({ app, isChromium, pass, budget: { nodes: NODE_BUDGET, ms: MS_BUDGET }, result }, null, 2));
  } else {
    console.log(`AXWebArea-rooted read acceptance — frontmost="${app || '?'}"`);
    if (!isChromium) {
      console.log(`[SKIP] frontmost app is not Chromium — focus Chrome (with a composer/Gemini page) and re-run.`);
    } else if (result.error) {
      console.log(`[FAIL] PoC error: ${result.error}`);
    } else if (!result.webAreaFound) {
      console.log(`[FAIL] No AXWebArea found (findMs=${result.findMs}). Web content may not be exposed; ensure the tab is live (not discarded).`);
    } else if (!result.composer) {
      console.log(`[FAIL] AXWebArea found in ${result.findMs}ms but no composer within ${result.nodesScanned} nodes scanned.`);
    } else {
      const tag = pass ? 'PASS' : 'WARN';
      console.log(`[${tag}] composer (${result.composer.role}) reached in ${result.composer.scanned} node(s) · find ${result.findMs}ms + scan ${result.scanMs}ms`);
      console.log(pass
        ? `      → AXWebArea-rooted read reaches the composer within ${NODE_BUDGET} nodes / ${MS_BUDGET}ms. The read-timeout fix works; root the AX read at AXWebArea for Chromium.`
        : `      → reached but over budget (${NODE_BUDGET} nodes / ${MS_BUDGET}ms). Still far better than window-rooted, but review.`);
    }
  }

  if (isChromium && !pass) process.exitCode = 1;
}

await main();
