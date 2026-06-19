#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.JAVIS_API_BASE || 'http://127.0.0.1:3417';
const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const dataDir = process.env.JAVIS_DATA_DIR || path.join(appSupportDir, 'Runtime');
const apiTokenFile = process.env.JAVIS_API_TOKEN_FILE || path.join(dataDir, 'api-token');

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(apiTokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const opts = {};
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--') {
      positionals.push(...rest.slice(index + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq >= 0) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      index += 1;
    } else {
      opts[key] = true;
    }
  }
  return { command, opts, positionals };
}

function opt(opts, ...names) {
  for (const name of names) {
    const value = opts[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function boolOpt(opts, ...names) {
  const value = opt(opts, ...names);
  return value === true || String(value || '').toLowerCase() === 'true';
}

function numberOpt(opts, fallback, ...names) {
  const value = Number(opt(opts, ...names));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function request(apiPath, options = {}) {
  const token = readApiToken();
  const headers = {
    ...(token ? { 'X-JAVIS-Token': token } : {}),
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(`${baseUrl}${apiPath}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { output: text };
  }
  if (!response.ok) {
    const message = data?.details || data?.error || data?.output || response.statusText;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

function printHelp() {
  console.log(`JAVIS collaboration CLI

Usage:
  npm run collab -- status [--json] [--limit 20]
  npm run collab -- claim --scope <path-or-scope> --task <task> [--agent claude-code] [--owner "Claude Code"] [--lane claude] [--access write]
  npm run collab -- heartbeat <claim-id> [--ttl-ms 1800000]
  npm run collab -- release <claim-id> [--status done] [--result <summary>]

Examples:
  npm run collab -- claim --agent claude-code --owner "Claude Code" --lane claude --scope "docs/OPERATIONS.md" --task "Update operations docs"
  npm run collab -- heartbeat <claim-id>
  npm run collab -- release <claim-id> --status done --result "Docs updated"
`);
}

function formatTime(ms) {
  if (!ms) return '-';
  return new Date(Number(ms)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function printClaimLine(claim) {
  const expires = claim.expiresAt ? ` expires=${formatTime(claim.expiresAt)}` : '';
  console.log(`- ${claim.id} ${claim.owner || claim.agent} ${claim.access}:${claim.key || claim.scope || '-'}${expires}`);
  if (claim.task) console.log(`  ${claim.task}`);
}

async function statusCommand(opts) {
  const limit = numberOpt(opts, 20, 'limit');
  const data = await request(`/api/collaboration?limit=${encodeURIComponent(limit)}`);
  if (boolOpt(opts, 'json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  const collaboration = data.collaboration || {};
  const counts = collaboration.counts || {};
  console.log(`Collaboration: ${counts.active || 0} active, ${counts.conflicts || 0} conflict pair(s), ${counts.total || 0} total`);
  const active = collaboration.active || [];
  if (!active.length) {
    console.log('Active claims: none');
    return;
  }
  console.log('Active claims:');
  for (const claim of active) printClaimLine(claim);
}

async function claimCommand(opts) {
  const scope = opt(opts, 'scope', 'path', 'file', 'directory');
  const task = opt(opts, 'task', 'title', 'goal') || scope;
  if (!scope && !task) throw new Error('Missing --scope or --task.');
  const body = {
    agent: opt(opts, 'agent') || process.env.JAVIS_COLLAB_AGENT || 'external-agent',
    owner: opt(opts, 'owner') || process.env.JAVIS_COLLAB_OWNER || opt(opts, 'agent') || 'External Agent',
    lane: opt(opts, 'lane', 'mode') || process.env.JAVIS_COLLAB_LANE || undefined,
    scope,
    key: opt(opts, 'key', 'ownership-key'),
    task,
    access: opt(opts, 'access') || 'write',
    ttlMs: numberOpt(opts, 1800000, 'ttl-ms', 'ttlMs'),
    force: boolOpt(opts, 'force'),
    source: 'collab_cli',
  };
  const data = await request('/api/collaboration/claims', { method: 'POST', body });
  if (boolOpt(opts, 'json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(data.output || 'Collaboration claim active.');
  console.log(`id: ${data.claim?.id}`);
  console.log(`heartbeat: npm run collab -- heartbeat ${data.claim?.id}`);
  console.log(`release: npm run collab -- release ${data.claim?.id} --status done`);
}

async function heartbeatCommand(positionals, opts) {
  const id = positionals[0] || opt(opts, 'id', 'claim-id');
  if (!id) throw new Error('Missing claim id.');
  const data = await request(`/api/collaboration/claims/${encodeURIComponent(id)}/heartbeat`, {
    method: 'POST',
    body: {
      ttlMs: numberOpt(opts, 1800000, 'ttl-ms', 'ttlMs'),
      source: 'collab_cli',
    },
  });
  if (boolOpt(opts, 'json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(data.output || `Collaboration claim refreshed: ${id}`);
}

async function releaseCommand(positionals, opts) {
  const id = positionals[0] || opt(opts, 'id', 'claim-id');
  if (!id) throw new Error('Missing claim id.');
  const data = await request(`/api/collaboration/claims/${encodeURIComponent(id)}/release`, {
    method: 'POST',
    body: {
      status: opt(opts, 'status') || 'done',
      result: opt(opts, 'result', 'summary') || '',
      source: 'collab_cli',
    },
  });
  if (boolOpt(opts, 'json')) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  console.log(data.output || `Collaboration claim released: ${id}`);
}

async function main() {
  const { command, opts, positionals } = parseArgs(process.argv.slice(2));
  if (command === 'help' || boolOpt(opts, 'help', 'h')) {
    printHelp();
    return;
  }
  if (command === 'status' || command === 'list') return statusCommand(opts);
  if (command === 'claim') return claimCommand(opts);
  if (command === 'heartbeat') return heartbeatCommand(positionals, opts);
  if (command === 'release' || command === 'done') return releaseCommand(positionals, opts);
  throw new Error(`Unknown command: ${command}. Run: npm run collab -- help`);
}

try {
  await main();
} catch (error) {
  const jsonMode = process.argv.includes('--json');
  if (jsonMode) {
    console.log(JSON.stringify({
      ok: false,
      status: error instanceof ApiError ? error.status : undefined,
      error: error instanceof Error ? error.message : String(error),
      data: error instanceof ApiError ? error.data : undefined,
    }, null, 2));
  } else {
    console.error(`JAVIS collab failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof ApiError && error.data?.conflicts?.length) {
      console.error('Conflicts:');
      for (const conflict of error.data.conflicts) {
        console.error(`- ${conflict.owner || conflict.agent} ${conflict.access}:${conflict.key || conflict.scope}`);
      }
    }
  }
  process.exitCode = error instanceof ApiError && error.status === 409 ? 2 : 1;
}
