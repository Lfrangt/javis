import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');
const ARCHIVE_DIR = process.env.JAVIS_PRODUCTIVITY_DOGFOOD_ARCHIVE_DIR || path.join(DATA_DIR, 'productivity-dogfood-archives');

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

function compactText(value, maxLength = 700) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function futureIso(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

function normalizeResult(response) {
  return response.data?.result || response.data || { ok: false, status: 'blocked', output: `HTTP ${response.status}` };
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

function defaultPayload(overrides = {}) {
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
    ...overrides,
  };
}

function suitePayloads() {
  const execute = hasFlag('execute');
  const confirm = hasFlag('confirm');
  const shouldRecord = hasFlag('record') || (execute && confirm);
  const title = argValue('title', 'JAVIS productivity dogfood');
  const body = argValue('body', 'Created by JAVIS productivity dogfood preview.');
  const dueAt = argValue('dueAt', futureIso(24 * 60));
  const startAt = argValue('startAt', futureIso(25 * 60));
  const endAt = argValue('endAt', futureIso(26 * 60));
  const recipient = argValue('recipient', 'javis-dogfood@example.invalid');
  const common = {
    execute,
    confirm,
    recordWorkflow: shouldRecord,
    recordRouting: shouldRecord,
    source: 'dogfood_productivity_live_suite',
  };
  return [
    {
      id: 'notes_note_capture',
      instruction: 'Dogfood Notes note capture',
      intent: 'note_capture',
      stage: 'create',
      app: 'Notes',
      actionId: 'create_note',
      title: `${title} Notes`,
      body,
      ...common,
    },
    {
      id: 'reminders_create',
      instruction: 'Dogfood Reminders reminder creation',
      intent: 'reminder_create',
      stage: 'create',
      app: 'Reminders',
      actionId: 'create_reminder',
      title: `${title} Reminder`,
      body,
      dueAt,
      ...common,
    },
    {
      id: 'calendar_create_event',
      instruction: 'Dogfood Calendar event creation',
      intent: 'calendar_event',
      stage: 'create',
      app: 'Calendar',
      actionId: 'create_event',
      title: `${title} Calendar`,
      body,
      startAt,
      endAt,
      location: argValue('location', 'JAVIS local dogfood'),
      ...common,
    },
    {
      id: 'mail_draft',
      instruction: 'Dogfood Mail visible draft creation',
      intent: 'email_draft',
      stage: 'draft',
      app: 'Mail',
      actionId: 'draft_email',
      title: `${title} Mail`,
      body,
      recipient,
      subject: argValue('subject', `${title} Mail draft`),
      ...common,
    },
  ];
}

function summarizeCase(payload, response, result) {
  const action = result.action || {};
  const workflow = result.workflow || {};
  const ok = response.ok && result.ok !== false;
  return {
    id: payload.id || `${payload.app}_${payload.actionId}`,
    app: payload.app,
    intent: payload.intent,
    actionId: payload.actionId,
    stage: payload.stage,
    ok,
    httpStatus: response.status,
    status: result.status || (ok ? 'done' : 'blocked'),
    executed: Boolean(result.executed),
    requiresConfirmation: Boolean(result.requiresConfirmation),
    nativeAutomation: Boolean(action.nativeAutomation),
    nativeKind: action.nativeKind || '',
    workflowId: workflow.id || '',
    approvalId: result.approval?.id || '',
    missingRequirements: Array.isArray(result.missingRequirements) ? result.missingRequirements : [],
    recoveryHints: Array.isArray(result.recoveryHints) ? result.recoveryHints.slice(0, 8) : [],
    selectedApp: result.plan?.selectedApp?.name || '',
    output: compactText(result.output),
  };
}

function archivePathFor(generatedAt, id) {
  const safeTime = generatedAt.replace(/[:.]/g, '-');
  return path.join(ARCHIVE_DIR, `${safeTime}-${id}.json`);
}

function buildArchive(cases, generatedAt = new Date().toISOString()) {
  const executed = cases.filter((item) => item.executed).length;
  const total = cases.length;
  const pass = cases.filter((item) => item.ok).length;
  const executeRequested = hasFlag('execute');
  const archive = {
    kind: 'productivity_dogfood_archive',
    version: 1,
    id: randomUUID(),
    generatedAt,
    apiBase: API_BASE,
    suite: true,
    execute: executeRequested,
    confirm: hasFlag('confirm'),
    saved: false,
    archiveFile: '',
    summary: `${pass}/${total} productivity dogfood cases passed`,
    counts: {
      total,
      pass,
      fail: total - pass,
      executed,
      preview: total - executed,
      nativeAutomation: cases.filter((item) => item.nativeAutomation).length,
      workflows: cases.filter((item) => item.workflowId).length,
    },
    safety: {
      previewOnly: !executeRequested,
      startsApps: executed > 0,
      executesProductivityActions: executed > 0,
      sendsMessages: false,
      mutatesUserFiles: false,
      mutatesUserRecords: executed > 0,
      storesRawAudio: false,
      storesScreenshots: false,
      recordsWorkflowHistory: cases.some((item) => item.workflowId),
    },
    cases,
  };
  return { ...archive, ok: archive.counts.fail === 0 };
}

function saveArchive(archive) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const filePath = archivePathFor(archive.generatedAt, archive.id);
  const saved = { ...archive, saved: true, archiveFile: filePath };
  fs.writeFileSync(filePath, `${JSON.stringify(saved, null, 2)}\n`);
  return saved;
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

function printArchive(archive) {
  console.log('Productivity Dogfood Suite');
  console.log('==========================');
  console.log(`API: ${API_BASE}`);
  console.log(`Status: ${archive.ok ? 'passed' : 'failed'} · cases=${archive.counts.pass}/${archive.counts.total} · executed=${archive.counts.executed}`);
  console.log(`Safety: previewOnly=${archive.safety.previewOnly ? 'yes' : 'no'} · sendsMessages=${archive.safety.sendsMessages ? 'yes' : 'no'} · mutatesFiles=${archive.safety.mutatesUserFiles ? 'yes' : 'no'}`);
  if (archive.saved) console.log(`Archive: ${archive.archiveFile}`);
  for (const item of archive.cases) {
    console.log(`- ${item.app}: ${item.ok ? 'ok' : 'blocked'} · ${item.status} · action=${item.actionId} · executed=${item.executed ? 'yes' : 'no'}`);
    if (item.missingRequirements.length) console.log(`  missing=${item.missingRequirements.join(', ')}`);
  }
}

async function runSuite() {
  const cases = [];
  for (const payload of suitePayloads()) {
    const response = await request('/api/productivity/action', {
      method: 'POST',
      body: payload,
    });
    cases.push(summarizeCase(payload, response, normalizeResult(response)));
  }
  const shouldSave = hasFlag('suite') || hasFlag('all-apps') || hasFlag('archive') || hasFlag('save-archive');
  const archive = buildArchive(cases);
  return shouldSave ? saveArchive(archive) : archive;
}

async function main() {
  if (hasFlag('suite') || hasFlag('all-apps')) {
    const archive = await runSuite();
    if (hasFlag('json')) {
      console.log(JSON.stringify(archive, null, 2));
    } else {
      printArchive(archive);
    }
    process.exitCode = archive.ok ? 0 : 1;
    return;
  }

  const payload = defaultPayload();
  const response = await request('/api/productivity/action', {
    method: 'POST',
    body: payload,
  });
  const result = normalizeResult(response);
  if (!response.ok || response.data?.ok === false) {
    if (hasFlag('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result);
    }
    process.exitCode = 1;
    return;
  }
  if (hasFlag('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
