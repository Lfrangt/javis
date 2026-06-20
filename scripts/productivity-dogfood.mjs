import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(API_TOKEN_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find((item) => item.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function request(apiPath, options = {}) {
  const apiToken = readApiToken();
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(apiToken ? { 'X-JAVIS-Token': apiToken } : {}),
  };
  const response = await fetch(`${API_BASE}${apiPath}`, {
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
  return { ok: response.ok, status: response.status, data };
}

function defaultPayload() {
  const intent = argValue('intent', 'note_capture');
  const actionId = argValue('action', intent === 'email_draft' ? 'draft_email' : intent === 'calendar_event' ? 'create_event' : intent === 'reminder_create' ? 'create_reminder' : 'create_note');
  const app = argValue('app', intent === 'email_draft' ? 'Mail' : intent === 'calendar_event' ? 'Calendar' : intent === 'reminder_create' ? 'Reminders' : 'Notes');
  const title = argValue('title', 'JAVIS productivity dogfood');
  const body = argValue('body', 'Created by JAVIS productivity dogfood preview.');
  const shouldRecord = hasFlag('record') || (hasFlag('execute') && hasFlag('confirm'));
  return {
    instruction: argValue('instruction', `Dogfood ${app} ${actionId}`),
    intent,
    stage: argValue('stage', intent === 'email_draft' ? 'draft' : 'create'),
    app,
    actionId,
    execute: hasFlag('execute'),
    confirm: hasFlag('confirm'),
    title,
    body,
    dueAt: argValue('dueAt', ''),
    startAt: argValue('startAt', ''),
    endAt: argValue('endAt', ''),
    recipient: argValue('recipient', ''),
    subject: argValue('subject', title),
    location: argValue('location', ''),
    recordWorkflow: shouldRecord,
    recordRouting: shouldRecord,
    source: 'dogfood_productivity_live',
  };
}

function printResult(result) {
  const action = result.action || {};
  const workflow = result.workflow || {};
  console.log('Productivity Dogfood');
  console.log('====================');
  console.log(`API: ${API_BASE}`);
  console.log(`Status: ${result.status || (result.ok ? 'done' : 'blocked')} · executed=${result.executed ? 'yes' : 'no'} · action=${action.id || '-'}`);
  console.log(`Native: ${action.nativeAutomation ? 'yes' : 'no'} · app=${result.plan?.selectedApp?.name || action.nativeKind || '-'}`);
  if (result.requiresConfirmation) console.log('Gate: confirm:true required before execution.');
  if (result.approval?.id) console.log(`Approval: ${result.approval.id}`);
  if (workflow.id) console.log(`Workflow: ${workflow.id}`);
  if (Array.isArray(result.missingRequirements) && result.missingRequirements.length) {
    console.log(`Missing: ${result.missingRequirements.join(', ')}`);
  }
  if (Array.isArray(result.recoveryHints) && result.recoveryHints.length) {
    console.log('Recovery:');
    for (const hint of result.recoveryHints.slice(0, 6)) console.log(`- ${hint}`);
  }
  if (result.output) {
    console.log('');
    console.log(result.output);
  }
}

async function main() {
  const payload = defaultPayload();
  const response = await request('/api/productivity/action', {
    method: 'POST',
    body: payload,
  });
  if (!response.ok || response.data?.ok === false) {
    printResult(response.data?.result || response.data || { ok: false, status: 'blocked', output: `HTTP ${response.status}` });
    process.exitCode = 1;
    return;
  }
  printResult(response.data?.result || response.data);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
