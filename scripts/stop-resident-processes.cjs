#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const apiPort = Number(process.env.JAVIS_API_PORT || readEnvValue('JAVIS_API_PORT') || 3417);
const selfPid = process.pid;
const dataDir = process.env.JAVIS_DATA_DIR || path.join(process.env.HOME || '', 'Library', 'Application Support', 'JAVIS', 'Runtime');
const localVoiceChatLockFile = path.join(dataDir, 'local-voice-chat.lock.json');
const cliArgs = new Set(process.argv.slice(2));
const voiceTerminalsOnly = cliArgs.has('--voice-terminals') || cliArgs.has('--voice-terminals-only');

function readEnvValue(key) {
  try {
    const envPath = path.join(repoRoot, '.env');
    if (!fs.existsSync(envPath)) return '';
    const line = fs.readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((item) => item.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
}

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function listProcesses() {
  return run('ps', ['-wwaxo', 'pid=,ppid=,command='])
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null;
    })
    .filter(Boolean);
}

function processCwd(pid) {
  const output = run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = output.split(/\r?\n/).find((item) => item.startsWith('n'));
  return line ? line.slice(1) : '';
}

function apiListenerPids() {
  return run('lsof', ['-nP', `-iTCP:${apiPort}`, '-sTCP:LISTEN', '-t'])
    .split(/\s+/)
    .map((item) => Number(item))
    .filter(Boolean);
}

function isProjectResidentProcess(processInfo) {
  if (!processInfo || processInfo.pid === selfPid) return false;
  const command = processInfo.command || '';
  if (/Electron(?:\s|$)/i.test(command) && command.includes(repoRoot)) return true;
  if (!/(npm run start:desktop|node .*electron|Electron \.)/i.test(command)) return false;
  if (command.includes(repoRoot)) return true;
  return processCwd(processInfo.pid) === repoRoot;
}

function isProjectLocalVoiceLoopProcess(processInfo) {
  if (!processInfo || processInfo.pid === selfPid) return false;
  const command = processInfo.command || '';
  if (!/(npm run voice:chat|local-voice-command-dogfood\.mjs.*--chat)/i.test(command)) return false;
  if (command.includes(repoRoot)) return true;
  return processCwd(processInfo.pid) === repoRoot;
}

function descendantPids(processes, parentPids) {
  const childrenByParent = new Map();
  for (const item of processes) {
    if (!childrenByParent.has(item.ppid)) childrenByParent.set(item.ppid, []);
    childrenByParent.get(item.ppid).push(item.pid);
  }
  const result = new Set();
  const stack = [...parentPids];
  while (stack.length) {
    const pid = stack.pop();
    for (const child of childrenByParent.get(pid) || []) {
      if (result.has(child) || child === selfPid) continue;
      result.add(child);
      stack.push(child);
    }
  }
  return result;
}

function stopPid(pid, signal = 'SIGTERM') {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function cleanupLocalVoiceLoopArtifacts() {
  let removedLockFile = false;
  try {
    fs.unlinkSync(localVoiceChatLockFile);
    removedLockFile = true;
  } catch {}

  const closeWindowsScript = [
    'tell application "System Events"',
    '  set terminalRunning to exists process "Terminal"',
    'end tell',
    'if terminalRunning is false then return "0"',
    'tell application "Terminal"',
    '  set closedCount to 0',
    '  repeat with w in windows',
    '    set shouldClose to false',
    '    try',
    '      if (name of w contains "npm run voice:chat") or (name of w contains "local-voice-command-dogfood") then set shouldClose to true',
    '    end try',
    '    try',
    '      if (contents of selected tab of w contains "JAVIS Local Voice Command Loop") or (contents of selected tab of w contains "npm run voice:chat") then set shouldClose to true',
    '    end try',
    '    try',
    '      repeat with t in tabs of w',
    '        if (contents of t contains "JAVIS Local Voice Command Loop") or (contents of t contains "npm run voice:chat") or (contents of t contains "local-voice-command-dogfood") then set shouldClose to true',
    '      end repeat',
    '    end try',
    '    if shouldClose then',
    '      set closedCount to closedCount + 1',
    '      close w',
    '    end if',
    '  end repeat',
    '  return closedCount as text',
    'end tell',
  ].join('\n');
  const closedOutput = run('/usr/bin/osascript', ['-e', closeWindowsScript]).trim();
  const closedTerminalWindows = Number.parseInt(closedOutput, 10);
  return {
    removedLockFile,
    closedTerminalWindows: Number.isFinite(closedTerminalWindows) ? closedTerminalWindows : 0,
  };
}

function main() {
  if (voiceTerminalsOnly) {
    const cleanup = cleanupLocalVoiceLoopArtifacts();
    console.log(`Closed stale JAVIS voice Terminal window(s): ${cleanup.closedTerminalWindows}.`);
    return;
  }

  const processes = listProcesses();
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const targets = new Set();

  for (const pid of apiListenerPids()) {
    const processInfo = byPid.get(pid);
    if (isProjectResidentProcess(processInfo) || processCwd(pid) === repoRoot) targets.add(pid);
  }
  for (const processInfo of processes) {
    if (isProjectResidentProcess(processInfo)) targets.add(processInfo.pid);
    if (isProjectLocalVoiceLoopProcess(processInfo)) targets.add(processInfo.pid);
  }
  for (const pid of descendantPids(processes, targets)) {
    const processInfo = byPid.get(pid);
    if (!processInfo || processInfo.command.includes(repoRoot) || processCwd(pid) === repoRoot) {
      targets.add(pid);
    }
  }

  const ordered = [...targets]
    .filter((pid) => pid && pid !== selfPid)
    .sort((a, b) => b - a);
  if (!ordered.length) {
    const cleanup = cleanupLocalVoiceLoopArtifacts();
    console.log(`No stale JAVIS resident processes found. Closed stale JAVIS voice Terminal window(s): ${cleanup.closedTerminalWindows}.`);
    return;
  }

  for (const pid of ordered) stopPid(pid, 'SIGTERM');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
  const remaining = new Map(listProcesses().map((item) => [item.pid, item]));
  for (const pid of ordered) {
    const processInfo = remaining.get(pid);
    if (isProjectResidentProcess(processInfo)) stopPid(pid, 'SIGKILL');
  }
  const cleanup = cleanupLocalVoiceLoopArtifacts();
  console.log(`Stopped stale JAVIS resident process(es): ${ordered.join(', ')}. Closed stale JAVIS voice Terminal window(s): ${cleanup.closedTerminalWindows}.`);
}

main();
