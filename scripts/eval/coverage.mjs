#!/usr/bin/env node
// API coverage report for the eval suite.
//
// Cross-references every HTTP route registered in electron/main.cjs against the
// /api/... paths referenced by the eval check modules, so the "1:1 README →
// regression coverage" goal is a repeatable metric instead of a manual audit.
//
// Usage:
//   node scripts/eval/coverage.mjs            # human report
//   node scripts/eval/coverage.mjs --json     # machine-readable
//   node scripts/eval/coverage.mjs --uncovered # list only uncovered routes
//   npm run eval:coverage
//
// Matching is path-shape based: route params (:id) and trailing ids are
// normalized so `/api/jobs/:id/cancel` matches a check that hits
// `/api/jobs/${id}/cancel`. This is a static cross-reference — it proves a route
// is *referenced* by a check, not that the check meaningfully asserts on it.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const mainFile = path.join(repoRoot, 'electron', 'main.cjs');
const checksDir = path.join(here, 'checks');

const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');
const uncoveredOnly = argv.includes('--uncovered');
// GET routes are read-safe, so an uncovered GET is an actionable smoke-test gap.
// Uncovered mutation routes (POST/PUT/DELETE) are lower priority — read-only eval
// lanes legitimately skip them. --get-only narrows the report to actionable gaps.
const getOnly = argv.includes('--get-only');

// Normalize a route path to a comparable shape: lowercase, strip a trailing
// slash, replace :param and ${...} template segments and bare numeric/uuid-ish
// ids with a wildcard token.
function normalizePath(raw) {
  let p = String(raw || '').trim().toLowerCase();
  p = p.split('?')[0];
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (seg.startsWith(':')) return '*';
      if (seg.includes('${')) return '*';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}/.test(seg)) return '*';
      if (/^\d+$/.test(seg)) return '*';
      if (/-\d{6,}$/.test(seg)) return '*'; // eval-generated ids like job-1781…
      return seg;
    })
    .join('/');
}

function extractRoutes(source) {
  const routes = [];
  const re = /\bapi\.(get|post|put|delete)\(\s*'(\/api\/[^']+)'/g;
  let m;
  while ((m = re.exec(source))) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], norm: normalizePath(m[2]) });
  }
  return routes;
}

function extractReferencedPaths(source) {
  const refs = new Set();
  // Match string and template-literal /api/... references.
  const re = /['"`](\/api\/[^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(source))) {
    refs.add(normalizePath(m[1]));
  }
  return refs;
}

function main() {
  if (!fs.existsSync(mainFile)) {
    console.error(`main.cjs not found at ${mainFile}`);
    process.exitCode = 1;
    return;
  }
  const mainSource = fs.readFileSync(mainFile, 'utf8');
  const routes = extractRoutes(mainSource);

  // Dedupe routes by method+norm (a path may be registered once per method).
  const seen = new Set();
  const uniqueRoutes = [];
  for (const r of routes) {
    const key = `${r.method} ${r.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRoutes.push(r);
  }

  // Gather all referenced paths across check modules.
  const referenced = new Set();
  const byLane = {};
  let checkFiles = [];
  try {
    checkFiles = fs.readdirSync(checksDir).filter((f) => f.endsWith('.mjs'));
  } catch {
    checkFiles = [];
  }
  for (const file of checkFiles) {
    const src = fs.readFileSync(path.join(checksDir, file), 'utf8');
    const laneRefs = extractReferencedPaths(src);
    byLane[file.replace('.mjs', '')] = laneRefs;
    for (const ref of laneRefs) referenced.add(ref);
  }

  // A route is covered if its normalized path is referenced (method-agnostic:
  // referencing the path at all counts, since one check often exercises GET+POST).
  const referencedPaths = new Set(referenced);
  const coveredNorms = new Set();
  const covered = [];
  const uncovered = [];
  for (const r of uniqueRoutes) {
    const isCovered = referencedPaths.has(r.norm);
    if (isCovered) {
      covered.push(r);
      coveredNorms.add(r.norm);
    } else {
      uncovered.push(r);
    }
  }

  const distinctPaths = new Set(uniqueRoutes.map((r) => r.norm));
  const coveragePct = distinctPaths.size ? coveredNorms.size / distinctPaths.size : 1;

  if (jsonMode) {
    console.log(JSON.stringify({
      totalRoutes: uniqueRoutes.length,
      distinctPaths: distinctPaths.size,
      coveredPaths: coveredNorms.size,
      coveragePct: Number(coveragePct.toFixed(4)),
      lanes: checkFiles.length,
      uncovered: uncovered.map((r) => ({ method: r.method, path: r.path })),
    }, null, 2));
    return;
  }

  const uncoveredGet = uncovered.filter((r) => r.method === 'GET');
  const uncoveredMutation = uncovered.filter((r) => r.method !== 'GET');

  if (uncoveredOnly || getOnly) {
    const list = getOnly ? uncoveredGet : uncovered;
    for (const r of list.sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`${r.method.padEnd(6)} ${r.path}`);
    }
    console.log(`\n${list.length} uncovered ${getOnly ? 'read-only GET ' : ''}route(s) of ${uniqueRoutes.length}`);
    if (list.length) process.exitCode = 1;
    return;
  }

  console.log('JAVIS API eval coverage');
  console.log('');
  const filled = Math.round(coveragePct * 30);
  console.log(`${'█'.repeat(filled)}${'░'.repeat(30 - filled)} ${(coveragePct * 100).toFixed(1)}%`);
  console.log(`${coveredNorms.size}/${distinctPaths.size} distinct route paths referenced by ${checkFiles.length} eval lane(s) · ${uniqueRoutes.length} total route registrations`);
  console.log(`${uncoveredGet.length} uncovered read-only GET (actionable) · ${uncoveredMutation.length} uncovered mutation (lower priority)`);
  console.log('');
  if (uncovered.length) {
    console.log(`Uncovered routes (${uncovered.length}):`);
    // Group by first path segment after /api/ for readability.
    const groups = {};
    for (const r of uncovered) {
      const cluster = r.path.split('/')[2] || '(root)';
      (groups[cluster] ||= []).push(r);
    }
    for (const cluster of Object.keys(groups).sort()) {
      console.log(`  ${cluster}/`);
      for (const r of groups[cluster].sort((a, b) => a.path.localeCompare(b.path))) {
        console.log(`    ${r.method.padEnd(6)} ${r.path}`);
      }
    }
  } else {
    console.log('All registered routes are referenced by at least one eval lane.');
  }
}

main();
