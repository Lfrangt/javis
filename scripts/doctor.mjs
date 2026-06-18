import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const baseUrl = process.env.JAVIS_API_BASE || 'http://127.0.0.1:3417';
const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const dataDir = process.env.JAVIS_DATA_DIR || path.join(appSupportDir, 'Runtime');
const apiTokenFile = process.env.JAVIS_API_TOKEN_FILE || path.join(dataDir, 'api-token');
const jsonMode = args.has('--json');
const allowBlocked = args.has('--allow-blocked');

function readApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    return fs.readFileSync(apiTokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

async function readDoctorReport() {
  const token = readApiToken();
  const response = await fetch(`${baseUrl}/api/doctor/report`, {
    headers: token ? { 'X-JAVIS-Token': token } : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.details || data?.error || response.statusText;
    throw new Error(message);
  }
  return data.doctor;
}

function statusIcon(status) {
  if (status === 'ready') return 'OK';
  if (status === 'warning') return 'WARN';
  return 'BLOCKED';
}

function printHuman(report) {
  console.log(`JAVIS doctor: ${report.label}`);
  console.log(`${report.summary}`);
  console.log(`Checks: ${report.counts.ready} ready, ${report.counts.warning} warning, ${report.counts.blocked} blocked`);
  console.log(`API: ${report.health.api.baseUrl} pid=${report.health.pid} status=${report.health.status}`);
  console.log('');
  for (const check of report.checks) {
    const next = check.next ? ` Next: ${check.next}` : '';
    console.log(`[${statusIcon(check.status)}] ${check.label}: ${check.summary}${next}`);
  }
}

try {
  const report = await readDoctorReport();
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (report.overall === 'blocked' && !allowBlocked) process.exitCode = 1;
} catch (error) {
  if (jsonMode) {
    console.log(JSON.stringify({ ok: false, overall: 'blocked', error: error instanceof Error ? error.message : String(error) }, null, 2));
  } else {
    console.error(`JAVIS doctor failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Is the resident service running at ${baseUrl}?`);
  }
  if (!allowBlocked) process.exitCode = 1;
}
