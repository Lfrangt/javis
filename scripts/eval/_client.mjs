// Shared client + result contract for the JAVIS evaluation harness.
//
// Every check module exports `{ lane, run }` where `run(ctx)` returns an array
// of result objects: { id, label, status, detail, evidence? }.
//   status: 'pass' | 'warn' | 'fail' | 'skip'
//
// ctx = { baseUrl, token, api(path, {method, body, timeoutMs}) }
// api() returns { status, ok, data } and never throws (network errors become
// { ok:false, status:0, error }). Read-only by default — modules must not
// perform irreversible actions; use execute:false / preview routes only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveBaseUrl() {
  return process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
}

export function resolveToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  const appSupportDir = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
  const dataDir = process.env.JAVIS_DATA_DIR || path.join(appSupportDir, 'Runtime');
  const tokenFile = process.env.JAVIS_API_TOKEN_FILE || path.join(dataDir, 'api-token');
  try {
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

export function makeContext() {
  const baseUrl = resolveBaseUrl();
  const token = resolveToken();
  async function api(pathname, { method = 'GET', body, timeoutMs = 10000 } = {}) {
    const headers = {};
    if (token) headers['X-JAVIS-Token'] = token;
    if (body) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return { status: response.status, ok: response.ok, data };
    } catch (error) {
      return { status: 0, ok: false, data: null, error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { baseUrl, token, api };
}

// Result helpers — keep modules terse.
export const ok = (id, label, detail, evidence) => ({ id, label, status: 'pass', detail, evidence });
export const warn = (id, label, detail, evidence) => ({ id, label, status: 'warn', detail, evidence });
export const fail = (id, label, detail, evidence) => ({ id, label, status: 'fail', detail, evidence });
export const skip = (id, label, detail, evidence) => ({ id, label, status: 'skip', detail, evidence });

// assert(cond, id, label, passDetail, failDetail) -> result
export function assert(cond, id, label, passDetail, failDetail, evidence) {
  return cond ? ok(id, label, passDetail, evidence) : fail(id, label, failDetail, evidence);
}

export const STATUS_WEIGHT = { pass: 1, warn: 0.5, fail: 0, skip: null };

export function scoreResults(results) {
  let earned = 0;
  let possible = 0;
  const counts = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const r of results) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    const w = STATUS_WEIGHT[r.status];
    if (w === null) continue;
    possible += 1;
    earned += w;
  }
  const score = possible ? earned / possible : 1;
  return { counts, earned, possible, score };
}
