#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const API_BASE = process.env.JAVIS_API_BASE || `http://127.0.0.1:${process.env.JAVIS_API_PORT || 3417}`;
const RETRY_ATTEMPTS = Math.max(1, Math.min(20, Number(process.env.JAVIS_BOARD_RETRY_ATTEMPTS || 8)));
const RETRY_DELAY_MS = Math.max(100, Math.min(3000, Number(process.env.JAVIS_BOARD_RETRY_DELAY_MS || 500)));
const REQUEST_TIMEOUT_MS = Math.max(1000, Math.min(30000, Number(process.env.JAVIS_BOARD_REQUEST_TIMEOUT_MS || 10000)));

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : fallback;
}

function compact(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function transient(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code) ||
    /ECONNREFUSED|ECONNRESET|socket hang up|timeout|timed out/i.test(message);
}

function requestJson(urlText) {
  const url = new URL(urlText);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let data = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = raw;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(data?.details || data?.error || `HTTP ${res.statusCode}`));
          return;
        }
        resolve(data);
      });
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      error.code = 'ETIMEDOUT';
      req.destroy(error);
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchBoard(endpoint) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await requestJson(endpoint);
    } catch (error) {
      lastError = error;
      if (!transient(error) || attempt >= RETRY_ATTEMPTS) break;
      await sleep(Math.min(RETRY_DELAY_MS * attempt, 3000));
    }
  }
  throw new Error(`JAVIS resident API unavailable after ${RETRY_ATTEMPTS} attempt(s): ${lastError?.message || 'unknown error'}`);
}

function boardUrl(file, endpoint) {
  const url = new URL(pathToFileURL(file).toString());
  url.searchParams.set('api', endpoint);
  return url.toString();
}

function openBoard(url) {
  const opener = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32'
    ? ['/c', 'start', '', url]
    : [url];
  const child = spawn(opener, args, {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

function printHelp() {
  console.log('Usage: npm run board [-- --no-open] [-- --api http://127.0.0.1:3417/api/progress-board]');
  console.log('Reads the local no-spend progress board first, then opens docs/javis-status-board.html unless --no-open is set.');
}

function printSummary(board, file, endpoint, opened) {
  const voice = board.voiceSetup || {};
  const display = voice.display || {};
  const recovery = board.recovery || {};
  const freeActions = Array.isArray(board.freeNextActions) ? board.freeNextActions : [];
  console.log('JAVIS Status Board');
  console.log('==================');
  console.log(`File: ${file}`);
  console.log(`API: ready · ${endpoint}`);
  console.log(`Status: ${board.status || '-'} · ${compact(board.summary || '', 260)}`);
  if (display.summary) console.log(`Realtime: ${compact(display.summary, 320)}`);
  if (display.nextAction) console.log(`Realtime next: ${compact(display.nextAction, 260)}`);
  if (recovery.label || recovery.summary) {
    const recoveryDetail = recovery.actionId === 'readiness:realtime_voice_provider'
      ? '只预览 provider 检查；真实验证需要你在场、输入费用口令，并可能消耗一次 OpenAI 请求。'
      : recovery.needsUser
        ? '这一步需要你确认或在场；看板只预览。'
      : compact(recovery.summary || '', 260);
    console.log(`Recovery: ${compact(recovery.label || '-', 100)} · ${compact(recoveryDetail, 260)}`);
  }
  if (freeActions.length) {
    const labels = freeActions.slice(0, 5).map((action) => compact(action.label || action.id || '', 60)).filter(Boolean);
    console.log(`Zero-cost now: ${labels.join(' · ')}`);
  }
  console.log(`Timeline: ${(board.timeline || []).length} item(s) · Nodes: ${(board.nodes || []).length}`);
  console.log('Safety: no OpenAI/mic/Realtime/workers/actions; sanitized public board endpoint only.');
  console.log(`Open: ${opened ? 'yes' : 'no'}`);
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printHelp();
    return;
  }
  const noOpen = hasFlag('--no-open') || hasFlag('--print') || hasFlag('--dry-run');
  const file = path.join(process.cwd(), 'docs', 'javis-status-board.html');
  const endpoint = argValue('--api', new URL('/api/progress-board', API_BASE).toString());
  const result = await fetchBoard(endpoint);
  const board = result.board || result;
  const url = boardUrl(file, endpoint);
  if (!noOpen) openBoard(url);
  printSummary(board, file, endpoint, !noOpen);
  if (hasFlag('--url')) console.log(`URL: ${url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
