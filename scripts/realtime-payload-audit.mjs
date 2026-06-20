#!/usr/bin/env node

import path from 'node:path';
import url from 'node:url';

import { makeContext } from './eval/_client.mjs';

export const REALTIME_PAYLOAD_CASES = [
  {
    id: 'dogfood_acceptance',
    label: 'Realtime dogfood acceptance',
    tool: 'get_realtime_dogfood_acceptance',
    arguments: {},
    maxBytes: 16000,
    expectCompact: true,
  },
  {
    id: 'perception_consent',
    label: 'Perception consent',
    tool: 'get_perception_consent',
    arguments: {},
    maxBytes: 13000,
    expectCompact: true,
  },
  {
    id: 'autopilot_status',
    label: 'Autopilot status',
    tool: 'get_autopilot_status',
    arguments: { workflowLimit: 6, jobLimit: 6 },
    maxBytes: 13000,
    expectCompact: true,
  },
  {
    id: 'routing_speed_code',
    label: 'Routing speed policy - code',
    tool: 'get_routing_speed_policy',
    arguments: { message: '修复这个 Electron bug 并跑测试。' },
    maxBytes: 12000,
    expectCompact: true,
    forbiddenPaths: ['decision.contextPlan', 'decision.contract'],
  },
  {
    id: 'routing_speed_browser',
    label: 'Routing speed policy - browser',
    tool: 'get_routing_speed_policy',
    arguments: { message: '帮我看看当前网页，提取下一步操作，先不要提交表单。', includeScreen: true },
    maxBytes: 12000,
    expectCompact: true,
    forbiddenPaths: ['decision.contextPlan', 'decision.contract'],
  },
  {
    id: 'work_next',
    label: 'Work next preview',
    tool: 'get_work_next',
    arguments: {},
    maxBytes: 11000,
    expectCompact: true,
  },
  {
    id: 'realtime_evidence',
    label: 'Realtime evidence',
    tool: 'get_realtime_evidence',
    arguments: {},
    maxBytes: 10000,
    expectCompact: false,
  },
  {
    id: 'work_handoff',
    label: 'Work handoff',
    tool: 'get_work_handoff',
    arguments: {},
    maxBytes: 10000,
    expectCompact: true,
  },
  {
    id: 'learning_distillation',
    label: 'Learning distillation',
    tool: 'get_learning_distillation',
    arguments: { recentLimit: 8, baselineLimit: 24, skillLimit: 4 },
    maxBytes: 9000,
    expectCompact: true,
    forbiddenPaths: ['state.learningFile', 'artifacts.skills.recent.0.path'],
  },
  {
    id: 'local_capabilities_browser',
    label: 'Local capabilities - browser',
    tool: 'get_local_capabilities',
    arguments: { query: 'browser', includeNext: false },
    maxBytes: 10000,
    expectCompact: true,
  },
  {
    id: 'attention_explanation',
    label: 'Attention explanation',
    tool: 'get_attention_explanation',
    arguments: { limit: 3 },
    maxBytes: 6000,
    expectCompact: false,
  },
];

function objectPathValue(object, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

function parseOutput(output) {
  try {
    return JSON.parse(output || '{}');
  } catch {
    return null;
  }
}

function compactResultEvidence(parsed) {
  return {
    compact: parsed?.responseBudget?.compact === true,
    responseBudgetBytes: parsed?.responseBudget?.outputBytes || null,
    summary: String(parsed?.spokenSummary || parsed?.summary || '').slice(0, 180),
    decision: parsed?.decision
      ? {
        lane: parsed.decision.lane || '',
        profile: parsed.decision.speedProfile?.id || '',
        toolFirst: parsed.decision.toolFirst?.recommended === true,
      }
      : undefined,
  };
}

export async function runRealtimePayloadAudit(ctx = makeContext(), cases = REALTIME_PAYLOAD_CASES) {
  const results = [];
  for (const testCase of cases) {
    const response = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'payload_budget',
        name: testCase.tool,
        arguments: testCase.arguments || {},
      },
      timeoutMs: testCase.timeoutMs || 30000,
    });
    const output = response.data?.output || '';
    const parsed = parseOutput(output);
    const bytes = Buffer.byteLength(output, 'utf8');
    const compact = parsed?.responseBudget?.compact === true;
    const forbiddenPresent = (testCase.forbiddenPaths || []).filter((dottedPath) => objectPathValue(parsed, dottedPath) !== undefined);
    const failures = [];
    if (!response.ok) failures.push(`HTTP ${response.status}`);
    if (response.data?.ok === false) failures.push('tool returned ok=false');
    if (!parsed || parsed.ok === false) failures.push('output is not ok JSON');
    if (bytes <= 0) failures.push('empty output');
    if (bytes > testCase.maxBytes) failures.push(`${bytes}B exceeds ${testCase.maxBytes}B`);
    if (testCase.expectCompact && !compact) failures.push('missing compact responseBudget');
    if (forbiddenPresent.length) failures.push(`forbidden field(s): ${forbiddenPresent.join(', ')}`);
    results.push({
      id: testCase.id,
      label: testCase.label,
      tool: testCase.tool,
      ok: failures.length === 0,
      failures,
      bytes,
      maxBytes: testCase.maxBytes,
      compact,
      evidence: compactResultEvidence(parsed),
    });
  }
  const counts = {
    pass: results.filter((result) => result.ok).length,
    fail: results.filter((result) => !result.ok).length,
    total: results.length,
  };
  const largest = [...results].sort((a, b) => b.bytes - a.bytes)[0] || null;
  return {
    ok: counts.fail === 0,
    generatedAt: new Date().toISOString(),
    baseUrl: ctx.baseUrl,
    counts,
    largest,
    results,
  };
}

function printHuman(report) {
  console.log(`Realtime payload budget - ${report.baseUrl}`);
  for (const result of report.results) {
    const status = result.ok ? 'PASS' : 'FAIL';
    const compact = result.compact ? 'compact' : 'plain';
    const detail = result.ok ? '' : ` - ${result.failures.join('; ')}`;
    console.log(`${status} ${result.id}: ${result.bytes}/${result.maxBytes}B ${compact}${detail}`);
  }
  console.log(`Summary: ${report.counts.pass}/${report.counts.total} pass`);
}

async function main() {
  const json = process.argv.includes('--json');
  const report = await runRealtimePayloadAudit();
  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? url.pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  await main();
}
