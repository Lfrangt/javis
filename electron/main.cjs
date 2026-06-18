const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { promisify } = require('node:util');

const dotenv = require('dotenv');
const express = require('express');
const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  globalShortcut,
  Menu,
  nativeImage,
  Notification,
  screen,
  session,
  systemPreferences,
  Tray,
} = require('electron');

dotenv.config({ path: path.join(process.cwd(), '.env') });

const execFileAsync = promisify(execFile);
const API_PORT = Number(process.env.JAVIS_API_PORT || 3417);
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const WAKE_WORDS = (process.env.JAVIS_WAKE_WORDS || 'JAVIS,Jarvis,贾维斯,小贾')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const WAKE_TRIGGER_TTL_MS = Math.max(1000, Math.min(60000, Number(process.env.JAVIS_WAKE_TRIGGER_TTL_MS || 10000)));
const WAKE_ENGINE_CMD = String(process.env.JAVIS_WAKE_ENGINE_CMD || '').trim();
const LOCAL_EXEC_ENABLED = process.env.JAVIS_ENABLE_LOCAL_EXEC === 'true';
const TRUSTED_LOCAL_MODE = process.env.JAVIS_TRUSTED_LOCAL_MODE === 'true';
const APP_SUPPORT_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'JAVIS');
const DATA_DIR = process.env.JAVIS_DATA_DIR || path.join(APP_SUPPORT_DIR, 'Runtime');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');
const ROUTING_FILE = path.join(DATA_DIR, 'routing.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const ACTION_POLICY_FILE = path.join(DATA_DIR, 'action-policy.json');
const API_TOKEN_FILE = process.env.JAVIS_API_TOKEN_FILE || path.join(DATA_DIR, 'api-token');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');
const INBOX_FILE = path.join(DATA_DIR, 'inbox.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SCREEN_PRIVACY_FILE = path.join(DATA_DIR, 'screen-privacy.json');
const AMBIENT_FILE = path.join(DATA_DIR, 'ambient.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learned-profile.json');
const LAUNCH_AGENT_LABEL = 'com.haoge.javis';
const LAUNCH_AGENT_FILE = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCH_AGENT_LABEL}.plist`);
const RESIDENT_OUT_LOG = path.join(process.cwd(), 'logs', 'resident.out.log');
const RESIDENT_ERR_LOG = path.join(process.cwd(), 'logs', 'resident.err.log');
const TOGGLE_HOTKEY = process.env.JAVIS_TOGGLE_HOTKEY || 'Control+Shift+Space';
const CAPTURE_HOTKEY = process.env.JAVIS_CAPTURE_HOTKEY === 'false' ? '' : (process.env.JAVIS_CAPTURE_HOTKEY || 'Control+Shift+I');
const WINDOW_PARK_CORNER = parseParkCorner(process.env.JAVIS_WINDOW_PARK_CORNER || 'notch');
const WINDOW_PARK_DISPLAY = process.env.JAVIS_WINDOW_PARK_DISPLAY === 'current' ? 'current' : 'primary';
const WINDOW_PARK_MARGIN = Math.max(0, Math.min(160, Number(process.env.JAVIS_WINDOW_PARK_MARGIN || 24)));
const WINDOW_NOTCH_TOP_OFFSET = Math.max(0, Math.min(40, Number(process.env.JAVIS_WINDOW_NOTCH_TOP_OFFSET || 5)));
const CHROME_DEBUG_PORT = Math.max(0, Math.min(65535, Number(process.env.JAVIS_CHROME_DEBUG_PORT || 9222)));
const CHROME_CDP_PROFILE_DIR = process.env.JAVIS_CHROME_CDP_PROFILE_DIR || path.join(DATA_DIR, 'chrome-cdp-profile');
const NOTIFICATIONS_ENABLED = process.env.JAVIS_NOTIFICATIONS !== 'false';
const AMBIENT_OBSERVE_ENABLED = process.env.JAVIS_AMBIENT_OBSERVE === 'true';
const AMBIENT_CAPTURE_SCREEN = process.env.JAVIS_AMBIENT_CAPTURE_SCREEN === 'true';
const AMBIENT_INTERVAL_MS = Math.max(2500, Math.min(60000, Number(process.env.JAVIS_AMBIENT_INTERVAL_MS || 8000)));
const AMBIENT_LEARNING_ENABLED = process.env.JAVIS_AMBIENT_LEARNING === 'true';
const AMBIENT_LEARNING_INTERVAL_MS = Math.max(15000, Math.min(600000, Number(process.env.JAVIS_AMBIENT_LEARNING_INTERVAL_MS || 60000)));
const INCLUDE_LEARNING_IN_PROMPTS = process.env.JAVIS_INCLUDE_LEARNING_IN_PROMPTS !== 'false';
const LEARNING_AUTO_MEMORY_ENABLED = process.env.JAVIS_LEARNING_AUTO_MEMORY !== 'false';
const LEARNING_AUTO_MEMORY_MIN_EVENTS = Math.max(5, Math.min(200, Number(process.env.JAVIS_LEARNING_AUTO_MEMORY_MIN_EVENTS || 20)));
const AUTOPILOT_ENABLED = process.env.JAVIS_AUTOPILOT_ENABLED === 'true'
  || (process.env.JAVIS_AUTOPILOT_ENABLED !== 'false' && LOCAL_EXEC_ENABLED && TRUSTED_LOCAL_MODE);
const AUTOPILOT_INTERVAL_MS = Math.max(30000, Math.min(1800000, Number(process.env.JAVIS_AUTOPILOT_INTERVAL_MS || 120000)));
const CONVERSATION_STALE_MS = Math.max(30000, Math.min(600000, Number(process.env.JAVIS_CONVERSATION_STALE_MS || 120000)));
const REALTIME_PREFLIGHT_CONTEXT_ENABLED = process.env.JAVIS_REALTIME_PREFLIGHT_CONTEXT !== 'false';
const API_AUTH_ENABLED = process.env.JAVIS_API_AUTH !== 'false';
const MAX_PERSISTED_JOBS = Number(process.env.JAVIS_MAX_PERSISTED_JOBS || 200);
const MAX_PERSISTED_WORKFLOWS = Number(process.env.JAVIS_MAX_PERSISTED_WORKFLOWS || 300);
const MAX_PERSISTED_ROUTING = Number(process.env.JAVIS_MAX_PERSISTED_ROUTING || 500);
const MAX_PERSISTED_APPROVALS = Number(process.env.JAVIS_MAX_PERSISTED_APPROVALS || 200);
const MAX_PERSISTED_MEMORIES = Number(process.env.JAVIS_MAX_PERSISTED_MEMORIES || 500);
const MAX_PERSISTED_INBOX = Number(process.env.JAVIS_MAX_PERSISTED_INBOX || 300);
const MAX_PERSISTED_SESSIONS = Number(process.env.JAVIS_MAX_PERSISTED_SESSIONS || 200);
const MAX_PERSISTED_AMBIENT = Number(process.env.JAVIS_MAX_PERSISTED_AMBIENT || 500);
const MAX_PARALLEL_TASKS = Math.max(2, Math.min(12, Number(process.env.JAVIS_MAX_PARALLEL_TASKS || 6)));
const MAX_BROWSER_SEARCH_QUERIES = Math.max(1, Math.min(6, Number(process.env.JAVIS_MAX_BROWSER_SEARCH_QUERIES || 4)));
const MAX_BROWSER_PAGE_LINKS = Math.max(5, Math.min(120, Number(process.env.JAVIS_MAX_BROWSER_PAGE_LINKS || 40)));
const MAX_RECOVERY_JOB_ATTEMPTS = Math.max(0, Math.min(5, Number(process.env.JAVIS_MAX_RECOVERY_JOB_ATTEMPTS || 2)));
const MAX_LEARNING_SOURCE_EVENTS = Math.max(20, Math.min(500, Number(process.env.JAVIS_MAX_LEARNING_SOURCE_EVENTS || 200)));
const startedAt = Date.now();
const packageInfo = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
const DEFAULT_FILE_ROOTS = [
  process.cwd(),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Downloads'),
];
const DEFAULT_WRITE_ROOTS = process.env.JAVIS_ALLOWED_WRITE_ROOTS
  ? process.env.JAVIS_ALLOWED_WRITE_ROOTS.split(',').map((item) => item.trim()).filter(Boolean)
  : TRUSTED_LOCAL_MODE
    ? DEFAULT_FILE_ROOTS
    : [process.cwd()];
const DEFAULT_CLI_COMMANDS = process.env.JAVIS_ALLOWED_CLI_COMMANDS
  ? process.env.JAVIS_ALLOWED_CLI_COMMANDS.split(',').map((item) => item.trim()).filter(Boolean)
  : TRUSTED_LOCAL_MODE
    ? ['*']
    : ['codex', 'claude', 'gh', 'git', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'python', 'python3', 'uv', 'say'];
const FILE_ACTIONS = [
  'list_directory',
  'read_file',
  'search_files',
  'write_file',
  'create_directory',
  'copy_file',
  'move_file',
];
const DEFAULT_SCREEN_PRIVACY = {
  version: 1,
  mode: process.env.JAVIS_SCREEN_PRIVACY_MODE === 'clear' ? 'clear' : 'private',
  updatedAt: Date.now(),
};

const DEFAULT_ACTION_POLICY = {
  version: 1,
  dryRun: process.env.JAVIS_ACTION_DRY_RUN === 'true',
  maxAutoRiskLevel: Number(process.env.JAVIS_MAX_AUTO_RISK_LEVEL || 2),
  requireApprovalAtRiskLevel: Number(process.env.JAVIS_REQUIRE_APPROVAL_AT_RISK_LEVEL || 3),
  allow: {
    open_url: { enabled: true, allowedHosts: ['*'] },
    open_app: { enabled: true, allowedApps: ['*'] },
    type_text: { enabled: true },
    hotkey: { enabled: true, allowedKeys: ['*'] },
    read_clipboard: { enabled: true, maxBytes: 20000 },
    write_clipboard: { enabled: true, maxBytes: 20000 },
    clear_clipboard: { enabled: true },
    read_accessibility_tree: { enabled: true, maxNodes: 240, maxDepth: 9 },
    ax_press: {
      enabled: true,
      allowedRoles: ['AXButton', 'AXCheckBox', 'AXLink', 'AXMenuButton', 'AXMenuItem', 'AXPopUpButton', 'AXRadioButton', 'AXTab'],
    },
    ax_set_value: {
      enabled: true,
      allowedRoles: ['AXComboBox', 'AXSearchField', 'AXTextArea', 'AXTextField'],
      maxBytes: 20000,
    },
    browser_control: {
      enabled: true,
      allowedActions: ['back', 'forward', 'reload', 'new_tab', 'close_tab', 'focus_address', 'open_url', 'search', 'dom_click', 'dom_fill', 'dom_select'],
    },
    code_agent: {
      enabled: true,
      allowedCommands: ['codex', 'claude'],
      maxTimeoutMs: 3600000,
    },
    cli_command: {
      enabled: true,
      allowedCommands: DEFAULT_CLI_COMMANDS,
      maxCommandLength: 4000,
      maxTimeoutMs: 600000,
    },
    read_browser_page: { enabled: true, maxChars: 30000 },
    list_directory: { enabled: true, allowedRoots: DEFAULT_FILE_ROOTS },
    read_file: { enabled: true, allowedRoots: DEFAULT_FILE_ROOTS, maxBytes: 400000 },
    search_files: { enabled: true, allowedRoots: DEFAULT_FILE_ROOTS, maxResults: 80 },
    write_file: { enabled: true, allowedRoots: DEFAULT_WRITE_ROOTS, maxBytes: 400000 },
    create_directory: { enabled: true, allowedRoots: DEFAULT_WRITE_ROOTS },
    copy_file: { enabled: true, allowedRoots: DEFAULT_WRITE_ROOTS, maxBytes: 400000 },
    move_file: { enabled: true, allowedRoots: DEFAULT_WRITE_ROOTS },
  },
};

class ActionApprovalRequired extends Error {
  constructor(approval) {
    super(`Approval required for ${approval.action}`);
    this.name = 'ActionApprovalRequired';
    this.approval = approval;
  }
}

class JobCancelled extends Error {
  constructor(message = 'Job was cancelled.') {
    super(message);
    this.name = 'JobCancelled';
  }
}

class JobRecoveryFailure extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'JobRecoveryFailure';
    this.failureKind = String(options.failureKind || 'command_failed');
    this.recoveryPlan = options.recoveryPlan || null;
    this.attempt = options.attempt || null;
  }
}

const models = {
  realtime: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2',
  realtimeVoice: process.env.OPENAI_REALTIME_VOICE || 'marin',
  fast: process.env.OPENAI_FAST_MODEL || 'gpt-5.4-mini',
  background: process.env.OPENAI_BACKGROUND_MODEL || 'gpt-5.5',
  vision: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_FAST_MODEL || 'gpt-5.4-mini',
};

const jobs = new Map();
const workflows = new Map();
const routingRecords = new Map();
const approvals = new Map();
const memories = new Map();
const inboxItems = new Map();
const workSessions = new Map();
const ambientEvents = [];
const activeJobRuns = new Map();
let learnedProfile = null;
const windowModes = {
  pet: { width: 196, height: 56 },
  panel: { width: 196, height: 56 },
};
let latestScreen = null;
let latestAccessibilityTree = null;
let apiServer;
let mainWindow;
let speechProcess = null;
let actionPolicy;
let apiToken = '';
let screenPrivacy;
let currentWindowMode = 'pet';
let currentParkCorner = WINDOW_PARK_CORNER;
let toggleHotkeyRegistered = false;
let captureHotkeyRegistered = false;
let lastInboxCapture = null;
let menuBarTray = null;
let menuBarUpdatedAt = 0;
let ambientTimer = null;
let ambientSampling = false;
let learningTimer = null;
let learningBusy = false;
let autopilotTimer = null;
let autopilotBusy = false;
let autopilotState = {
  enabled: AUTOPILOT_ENABLED,
  intervalMs: AUTOPILOT_INTERVAL_MS,
  running: false,
  tickCount: 0,
  executedCount: 0,
  skippedCount: 0,
  lastTickAt: 0,
  lastExecutedAt: 0,
  lastAction: null,
  lastResult: '',
  lastError: '',
};
let wakeEngineProcess = null;
let wakeState = {
  lastTriggerAt: 0,
  lastSource: '',
  lastPhrase: '',
  triggerCount: 0,
  engineRunning: false,
  enginePid: null,
  engineLastLine: '',
  engineLastError: '',
  engineStartedAt: 0,
};
let conversationState = {
  status: 'idle',
  sessionId: '',
  micMode: 'open',
  screenLive: false,
  source: '',
  error: '',
  startedAt: 0,
  liveAt: 0,
  endedAt: 0,
  updatedAt: 0,
  lastHeartbeatAt: 0,
  transitionCount: 0,
};
const notificationState = {
  enabled: NOTIFICATIONS_ENABLED,
  sent: 0,
  skipped: 0,
  last: null,
};

ensureRuntimeStorage();
apiToken = loadOrCreateApiToken();
actionPolicy = loadActionPolicy();
screenPrivacy = loadScreenPrivacy();
loadPersistedJobs();
loadPersistedWorkflows();
loadPersistedRouting();
loadPersistedApprovals();
loadPersistedMemories();
loadPersistedInbox();
loadPersistedSessions();
loadPersistedAmbient();
loadPersistedLearning();
appendAudit('process.start', {
  pid: process.pid,
  version: packageInfo.version,
  dataDir: DATA_DIR,
  localExecutionEnabled: LOCAL_EXEC_ENABLED,
  actionPolicy: {
    dryRun: actionPolicy.dryRun,
    maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
    requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
  },
  apiAuth: {
    enabled: API_AUTH_ENABLED,
    tokenFile: API_TOKEN_FILE,
  },
});

function parseParkCorner(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['notch', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(normalized)
    ? normalized
    : 'notch';
}

function windowBoundsSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const bounds = mainWindow.getBounds();
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

function windowTargetForMode(mode = currentWindowMode) {
  return windowModes[mode] || windowModes.pet;
}

function displayForWindow(displayMode = WINDOW_PARK_DISPLAY) {
  try {
    if (displayMode === 'primary') {
      return screen.getPrimaryDisplay();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      return screen.getDisplayMatching(mainWindow.getBounds());
    }
    return screen.getPrimaryDisplay();
  } catch {
    return {
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      workArea: { x: 0, y: 0, width: 1440, height: 900 },
    };
  }
}

function displayWorkAreaForWindow(displayMode = WINDOW_PARK_DISPLAY) {
  return displayForWindow(displayMode).workArea;
}

function enforceWindowSize(mode = currentWindowMode) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const target = windowTargetForMode(mode);
  try {
    const bounds = mainWindow.getBounds();
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(1, 1);
    mainWindow.setMaximumSize(10000, 10000);
    mainWindow.setBounds(
      {
        ...bounds,
        width: target.width,
        height: target.height,
      },
      false,
    );
    mainWindow.setSize(target.width, target.height, false);
    mainWindow.setMinimumSize(target.width, target.height);
    mainWindow.setMaximumSize(target.width, target.height);
    mainWindow.setResizable(false);
  } catch (error) {
    appendAudit('window.size_enforce_failed', {
      mode,
      width: target.width,
      height: target.height,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return windowBoundsSnapshot();
}

function scheduleWindowSizeEnforcement(source = 'window') {
  for (const delay of [0, 160, 700, 1500]) {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      enforceWindowSize(currentWindowMode);
      parkWindow(source, { corner: currentParkCorner, display: WINDOW_PARK_DISPLAY, menu: false });
    }, delay);
  }
}

function parkedPosition(mode = currentWindowMode, corner = currentParkCorner, displayMode = WINDOW_PARK_DISPLAY) {
  const target = windowTargetForMode(mode);
  const display = displayForWindow(displayMode);
  const bounds = display.bounds || display.workArea || { x: 0, y: 0, width: 1440, height: 900 };
  const workArea = displayWorkAreaForWindow(displayMode);
  const safeCorner = parseParkCorner(corner);
  if (safeCorner === 'notch') {
    return {
      x: Math.round(bounds.x + ((bounds.width - target.width) / 2)),
      y: Math.round(bounds.y + WINDOW_NOTCH_TOP_OFFSET),
      corner: safeCorner,
      display: displayMode === 'current' ? 'current' : 'primary',
      margin: WINDOW_NOTCH_TOP_OFFSET,
    };
  }
  const x = safeCorner.endsWith('right')
    ? workArea.x + workArea.width - target.width - WINDOW_PARK_MARGIN
    : workArea.x + WINDOW_PARK_MARGIN;
  const y = safeCorner.startsWith('bottom')
    ? workArea.y + workArea.height - target.height - WINDOW_PARK_MARGIN
    : workArea.y + WINDOW_PARK_MARGIN;
  return {
    x: Math.round(x),
    y: Math.round(y),
    corner: safeCorner,
    display: displayMode === 'current' ? 'current' : 'primary',
    margin: WINDOW_PARK_MARGIN,
  };
}

function parkWindow(source = 'api', options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return windowStateSnapshot();
  if (options.corner) currentParkCorner = parseParkCorner(options.corner);
  const displayMode = options.display === 'current' ? 'current' : options.display === 'primary' ? 'primary' : WINDOW_PARK_DISPLAY;
  enforceWindowSize(currentWindowMode);
  const position = parkedPosition(currentWindowMode, currentParkCorner, displayMode);
  const target = windowTargetForMode(currentWindowMode);
  mainWindow.setBounds({ x: position.x, y: position.y, width: target.width, height: target.height }, false);
  mainWindow.setPosition(position.x, position.y, false);
  appendAudit('window.park', {
    source,
    mode: currentWindowMode,
    corner: position.corner,
    display: position.display,
    margin: position.margin,
    x: position.x,
    y: position.y,
  });
  if (options.menu !== false) updateMenuBarMenu();
  return windowStateSnapshot();
}

function moveWindow(source = 'api', options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return windowStateSnapshot();
  enforceWindowSize(currentWindowMode);
  const current = mainWindow.getBounds();
  const x = Number.isFinite(Number(options.x)) ? Math.round(Number(options.x)) : current.x;
  const y = Number.isFinite(Number(options.y)) ? Math.round(Number(options.y)) : current.y;
  const target = windowTargetForMode(currentWindowMode);
  mainWindow.setBounds({ x, y, width: target.width, height: target.height }, false);
  appendAudit('window.move', {
    source,
    mode: currentWindowMode,
    x,
    y,
  });
  updateMenuBarMenu();
  return windowStateSnapshot();
}

function windowStateSnapshot() {
  return {
    mode: currentWindowMode,
    hotkey: TOGGLE_HOTKEY,
    hotkeyRegistered: toggleHotkeyRegistered,
    captureHotkey: CAPTURE_HOTKEY,
    captureHotkeyRegistered,
    lastInboxCapture,
    position: windowBoundsSnapshot(),
    parkCorner: currentParkCorner,
    parkDisplay: WINDOW_PARK_DISPLAY,
    parkMargin: WINDOW_PARK_MARGIN,
    ...windowModes[currentWindowMode],
  };
}

function menuBarAvailable() {
  return Boolean(menuBarTray && (typeof menuBarTray.isDestroyed !== 'function' || !menuBarTray.isDestroyed()));
}

function menuBarSnapshot() {
  return {
    available: menuBarAvailable(),
    updatedAt: menuBarUpdatedAt || null,
  };
}

function notificationSupported() {
  try {
    return typeof Notification?.isSupported === 'function' ? Notification.isSupported() : false;
  } catch {
    return false;
  }
}

function notificationSnapshot() {
  return {
    enabled: NOTIFICATIONS_ENABLED,
    supported: notificationSupported(),
    sent: notificationState.sent,
    skipped: notificationState.skipped,
    last: notificationState.last,
  };
}

function notifyResident(title, body, data = {}) {
  const cleanTitle = String(title || 'JAVIS').slice(0, 80);
  const cleanBody = compactRecordText(body || '', 180);
  const record = {
    title: cleanTitle,
    body: cleanBody,
    data,
    createdAt: Date.now(),
  };

  if (!NOTIFICATIONS_ENABLED || !notificationSupported()) {
    notificationState.skipped += 1;
    notificationState.last = { ...record, delivered: false, reason: NOTIFICATIONS_ENABLED ? 'unsupported' : 'disabled' };
    appendAudit('notification.skipped', notificationState.last);
    return false;
  }

  try {
    const notification = new Notification({
      title: cleanTitle,
      body: cleanBody,
      silent: true,
    });
    notification.on('click', () => {
      openConfigCui('notification');
    });
    notification.show();
    notificationState.sent += 1;
    notificationState.last = { ...record, delivered: true };
    appendAudit('notification.sent', notificationState.last);
    return true;
  } catch (error) {
    notificationState.skipped += 1;
    notificationState.last = {
      ...record,
      delivered: false,
      reason: error instanceof Error ? error.message : String(error),
    };
    appendAudit('notification.failed', notificationState.last);
    return false;
  }
}

function applyWindowMode(mode, options = {}) {
  const nextMode = 'pet';
  currentWindowMode = nextMode;
  if (mainWindow && !mainWindow.isDestroyed()) {
    enforceWindowSize(nextMode);
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (options.park !== false) {
      parkWindow(options.source || 'api', { corner: options.corner, display: options.display, menu: false });
    }
    if (options.focus) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      mainWindow.showInactive();
    }
  }
  appendAudit('window.mode', { mode: nextMode, source: options.source || 'api' });
  updateMenuBarMenu();
  return windowStateSnapshot();
}

function toggleWindowMode(source = 'hotkey') {
  return applyWindowMode('pet', { source, focus: false });
}

function captureClipboardToInbox(source = 'hotkey') {
  const item = createInboxItem({ fromClipboard: true, source });
  lastInboxCapture = {
    id: item.id,
    title: item.title,
    source,
    createdAt: Date.now(),
  };
  appendAudit('inbox.clipboard_captured', {
    id: item.id,
    source,
    title: item.title,
    hotkey: source === 'hotkey' ? CAPTURE_HOTKEY : '',
  });
  notifyResident('JAVIS inbox captured', 'Clipboard text was saved to Inbox.', { type: 'inbox', id: item.id, source });
  updateMenuBarMenu();
  return item;
}

function registerGlobalHotkeys() {
  if (TOGGLE_HOTKEY && !toggleHotkeyRegistered) try {
    toggleHotkeyRegistered = globalShortcut.register(TOGGLE_HOTKEY, () => {
      toggleWindowMode('hotkey');
    });
    appendAudit('hotkey.register', { hotkey: TOGGLE_HOTKEY, registered: toggleHotkeyRegistered });
  } catch (error) {
    toggleHotkeyRegistered = false;
    appendAudit('hotkey.register_failed', {
      hotkey: TOGGLE_HOTKEY,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (CAPTURE_HOTKEY && !captureHotkeyRegistered) try {
    captureHotkeyRegistered = globalShortcut.register(CAPTURE_HOTKEY, () => {
      try {
        captureClipboardToInbox('hotkey');
      } catch (error) {
        appendAudit('hotkey.capture_failed', {
          hotkey: CAPTURE_HOTKEY,
          error: error instanceof Error ? error.message : String(error),
        });
        notifyResident('JAVIS inbox capture failed', error instanceof Error ? error.message : String(error), { type: 'inbox', source: 'hotkey' });
      }
    });
    appendAudit('hotkey.register', { hotkey: CAPTURE_HOTKEY, purpose: 'capture_inbox', registered: captureHotkeyRegistered });
  } catch (error) {
    captureHotkeyRegistered = false;
    appendAudit('hotkey.register_failed', {
      hotkey: CAPTURE_HOTKEY,
      purpose: 'capture_inbox',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return toggleHotkeyRegistered || captureHotkeyRegistered;
}

function createMenuBarImage() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<path fill="black" d="M9 1.4c4.2 0 7.6 3.4 7.6 7.6s-3.4 7.6-7.6 7.6S1.4 13.2 1.4 9 4.8 1.4 9 1.4Z"/>',
    '<path fill="white" d="M5.3 8.2h1.4v2c0 1 .5 1.5 1.4 1.5.9 0 1.4-.5 1.4-1.5V5.4h1.6v4.8c0 1.9-1.1 3-3 3s-2.8-1-2.8-3V8.2Z"/>',
    '<path fill="white" d="M11.9 5.4h1.6v7.5h-1.6z"/>',
    '</svg>',
  ].join('');
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  image.setTemplateImage(true);
  return image;
}

function runMenuBarSetupAction(action) {
  runSetupAction(action)
    .then((result) => {
      appendAudit('menubar.setup_action.completed', { action, ok: result.ok, output: result.output });
      updateMenuBarMenu();
    })
    .catch((error) => {
      appendAudit('menubar.setup_action.failed', {
        action,
        error: error instanceof Error ? error.message : String(error),
      });
      updateMenuBarMenu();
    });
}

function openConfigCui(source = 'api') {
  const command = `cd ${shQuote(process.cwd())} && npm run config:cui`;
  const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const child = spawn('osascript', [
    '-e',
    `tell application "Terminal" to do script "${escapedCommand}"`,
    '-e',
    'tell application "Terminal" to activate',
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  appendAudit('config_cui.opened', { source, command: 'npm run config:cui' });
  return {
    ok: true,
    output: 'Opened JAVIS terminal config.',
    command: 'npm run config:cui',
  };
}

function menuBarStatusLabel(readiness) {
  if (readiness.overall === 'ready') return 'Ready';
  if (readiness.overall === 'blocked') return `Blocked: ${readiness.primaryIssue?.label || 'Setup'}`;
  return `Needs attention: ${readiness.primaryIssue?.label || 'Setup'}`;
}

function updateMenuBarMenu() {
  if (!menuBarAvailable()) return;
  const readiness = readinessSnapshot();
  const briefing = workflowBriefing({ workflowLimit: 3, jobLimit: 3 });
  const firstAction = briefing.nextActions?.[0] || null;
  const inbox = inboxCounts();
  const nextInbox = inboxSnapshot(1, 'open')[0] || null;
  const activeSession = activeSessionSnapshot();
  const nextSummary = compactRecordText(firstAction?.summary || briefing.summary, 92);
  const menu = Menu.buildFromTemplate([
    { label: 'JAVIS', enabled: false },
    { label: menuBarStatusLabel(readiness), enabled: false },
    { label: activeSession ? `Session: ${compactRecordText(activeSession.title, 42)}` : 'Session: idle', enabled: false },
    { label: `${inbox.open} open inbox item(s)`, enabled: false },
    { type: 'separator' },
    {
      label: 'Park Pet',
      accelerator: TOGGLE_HOTKEY,
      click: () => applyWindowMode('pet', { source: 'menubar', focus: false }),
    },
    {
      label: `Park to ${WINDOW_PARK_CORNER === 'notch' ? 'Mac notch' : WINDOW_PARK_CORNER}`,
      click: () => parkWindow('menubar'),
    },
    {
      label: 'Open Config Terminal',
      click: () => openConfigCui('menubar'),
    },
    {
      label: 'Refresh Status',
      click: () => updateMenuBarMenu(),
    },
    {
      label: latestScreen ? 'Refresh Screen Frame' : 'Capture Screen Frame',
      click: () => {
        captureResidentScreen({ source: 'menubar' })
          .then((screenFrame) => {
            notifyResident('JAVIS screen captured', `${screenFrame.width}x${screenFrame.height} ${screenFrame.privacy?.label || screenFrame.privacy?.mode || 'screen'} frame ready.`, {
              type: 'screen',
              source: 'menubar',
            });
            updateMenuBarMenu();
          })
          .catch((error) => {
            notifyResident('JAVIS screen capture failed', error instanceof Error ? error.message : String(error), {
              type: 'screen',
              source: 'menubar',
            });
          });
      },
    },
    { type: 'separator' },
    { label: firstAction ? `Next: ${firstAction.label}` : 'Next: Ready', enabled: false },
    { label: nextSummary, enabled: false },
    nextInbox ? { label: `Inbox: ${compactRecordText(nextInbox.title, 56)}`, enabled: false } : { label: 'Inbox: empty', enabled: false },
    activeSession
      ? {
          label: 'End Current Session',
          click: () => {
            try {
              endWorkSession(activeSession.id, { source: 'menubar' });
            } catch (error) {
              notifyResident('JAVIS session end failed', error instanceof Error ? error.message : String(error), { type: 'session', source: 'menubar' });
            }
          },
        }
      : { label: 'End Current Session', enabled: false },
    { type: 'separator' },
    {
      label: 'Capture Clipboard to Inbox',
      accelerator: CAPTURE_HOTKEY || undefined,
      click: () => {
        try {
          captureClipboardToInbox('menubar');
        } catch (error) {
          notifyResident('JAVIS inbox capture failed', error instanceof Error ? error.message : String(error), { type: 'inbox', source: 'menubar' });
        }
      },
    },
    {
      label: 'Open .env',
      click: () => runMenuBarSetupAction('prepare_env_file'),
    },
    {
      label: 'Open Screen Recording Settings',
      click: () => runMenuBarSetupAction('open_screen_settings'),
    },
    {
      label: 'Open Accessibility Settings',
      click: () => runMenuBarSetupAction('open_accessibility_settings'),
    },
    {
      label: 'Open Runtime Folder',
      click: () => runMenuBarSetupAction('open_runtime_dir'),
    },
    {
      label: 'Send Test Notification',
      click: () => notifyResident('JAVIS test notification', 'Resident notifications are working.', { type: 'test', source: 'menubar' }),
    },
    { type: 'separator' },
    {
      label: 'Quit JAVIS',
      click: () => app.quit(),
    },
  ]);
  menuBarTray.setToolTip(`JAVIS - ${readiness.label}: ${compactRecordText(readiness.summary, 120)}`);
  menuBarTray.setContextMenu(menu);
  menuBarUpdatedAt = Date.now();
}

function createMenuBarTray() {
  if (menuBarAvailable()) return true;
  try {
    menuBarTray = new Tray(createMenuBarImage());
    menuBarTray.setTitle('');
    menuBarTray.on('click', () => {
      updateMenuBarMenu();
      menuBarTray.popUpContextMenu();
    });
    menuBarTray.on('right-click', () => updateMenuBarMenu());
    updateMenuBarMenu();
    appendAudit('menubar.ready', { available: true });
    return true;
  } catch (error) {
    menuBarTray = null;
    appendAudit('menubar.failed', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function ensureRuntimeStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacyJobsFile = path.join(APP_SUPPORT_DIR, 'jobs.json');
  const legacyAuditFile = path.join(APP_SUPPORT_DIR, 'audit.jsonl');
  if (!process.env.JAVIS_DATA_DIR && fs.existsSync(legacyJobsFile) && !fs.existsSync(JOBS_FILE)) {
    fs.copyFileSync(legacyJobsFile, JOBS_FILE);
  }
  if (!process.env.JAVIS_DATA_DIR && fs.existsSync(legacyAuditFile) && !fs.existsSync(AUDIT_FILE)) {
    fs.copyFileSync(legacyAuditFile, AUDIT_FILE);
  }
}

function loadOrCreateApiToken() {
  const envToken = String(process.env.JAVIS_API_TOKEN || '').trim();
  if (envToken) return envToken;
  try {
    if (fs.existsSync(API_TOKEN_FILE)) {
      const token = fs.readFileSync(API_TOKEN_FILE, 'utf8').trim();
      if (token.length >= 32) {
        try {
          fs.chmodSync(API_TOKEN_FILE, 0o600);
        } catch {}
        return token;
      }
    }
  } catch {}

  const token = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(API_TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(API_TOKEN_FILE, 0o600);
  } catch {}
  return token;
}

function apiTokenMatches(value) {
  if (!API_AUTH_ENABLED) return true;
  const candidate = String(value || '').trim();
  if (!candidate || !apiToken) return false;
  const expected = Buffer.from(apiToken);
  const actual = Buffer.from(candidate);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function requestApiToken(req) {
  const explicit = req.get('x-javis-token') || req.get('x-javis-api-token');
  if (explicit) return explicit;
  const authorization = String(req.get('authorization') || '').trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function trustedApiOrigins() {
  const origins = new Set([
    'null',
    'file://',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ]);
  const rendererUrl = String(process.env.JAVIS_RENDERER_URL || '').trim();
  if (rendererUrl) {
    try {
      origins.add(new URL(rendererUrl).origin);
    } catch {}
  }
  return origins;
}

function isTrustedApiOrigin(origin) {
  if (!origin) return true;
  return trustedApiOrigins().has(String(origin));
}

function isPublicApiPath(pathname) {
  return pathname === '/api/health';
}

function apiAuthSnapshot() {
  return {
    enabled: API_AUTH_ENABLED,
    tokenFile: API_TOKEN_FILE,
    header: 'X-JAVIS-Token',
  };
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function uniqueStringList(value, fallback) {
  const list = Array.isArray(value) ? value : fallback;
  return Array.from(new Set(list.map((item) => String(item).trim()).filter(Boolean)));
}

function browserAllowedActionsList(value) {
  const current = uniqueStringList(value, DEFAULT_ACTION_POLICY.allow.browser_control.allowedActions);
  return Array.from(new Set([...current, ...DEFAULT_ACTION_POLICY.allow.browser_control.allowedActions]));
}

function isProjectOnlyRootList(roots) {
  if (!Array.isArray(roots) || roots.length !== 1) return false;
  try {
    return path.resolve(resolvePath(roots[0])) === path.resolve(process.cwd());
  } catch {
    return false;
  }
}

function mutationAllowedRoots(value, fallback) {
  const roots = uniqueStringList(value, fallback);
  if (TRUSTED_LOCAL_MODE && isProjectOnlyRootList(roots)) {
    return DEFAULT_WRITE_ROOTS;
  }
  return roots;
}

function normalizeActionPolicy(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    dryRun: typeof raw.dryRun === 'boolean' ? raw.dryRun : DEFAULT_ACTION_POLICY.dryRun,
    maxAutoRiskLevel: Math.max(0, Math.min(4, Number(raw.maxAutoRiskLevel ?? DEFAULT_ACTION_POLICY.maxAutoRiskLevel))),
    requireApprovalAtRiskLevel: Math.max(
      0,
      Math.min(4, Number(raw.requireApprovalAtRiskLevel ?? DEFAULT_ACTION_POLICY.requireApprovalAtRiskLevel)),
    ),
    allow: {
      open_url: {
        enabled: raw.allow?.open_url?.enabled !== false,
        allowedHosts: uniqueStringList(raw.allow?.open_url?.allowedHosts, DEFAULT_ACTION_POLICY.allow.open_url.allowedHosts),
      },
      open_app: {
        enabled: raw.allow?.open_app?.enabled !== false,
        allowedApps: uniqueStringList(raw.allow?.open_app?.allowedApps, DEFAULT_ACTION_POLICY.allow.open_app.allowedApps),
      },
      type_text: {
        enabled: raw.allow?.type_text?.enabled !== false,
      },
      hotkey: {
        enabled: raw.allow?.hotkey?.enabled !== false,
        allowedKeys: uniqueStringList(raw.allow?.hotkey?.allowedKeys, DEFAULT_ACTION_POLICY.allow.hotkey.allowedKeys),
      },
      read_clipboard: {
        enabled: raw.allow?.read_clipboard?.enabled !== false,
        maxBytes: Math.max(1, Number(raw.allow?.read_clipboard?.maxBytes || DEFAULT_ACTION_POLICY.allow.read_clipboard.maxBytes)),
      },
      write_clipboard: {
        enabled: raw.allow?.write_clipboard?.enabled !== false,
        maxBytes: Math.max(1, Number(raw.allow?.write_clipboard?.maxBytes || DEFAULT_ACTION_POLICY.allow.write_clipboard.maxBytes)),
      },
      clear_clipboard: {
        enabled: raw.allow?.clear_clipboard?.enabled !== false,
      },
      read_accessibility_tree: {
        enabled: raw.allow?.read_accessibility_tree?.enabled !== false,
        maxNodes: Math.max(
          DEFAULT_ACTION_POLICY.allow.read_accessibility_tree.maxNodes,
          Math.min(500, Number(raw.allow?.read_accessibility_tree?.maxNodes || DEFAULT_ACTION_POLICY.allow.read_accessibility_tree.maxNodes)),
        ),
        maxDepth: Math.max(
          DEFAULT_ACTION_POLICY.allow.read_accessibility_tree.maxDepth,
          Math.min(12, Number(raw.allow?.read_accessibility_tree?.maxDepth || DEFAULT_ACTION_POLICY.allow.read_accessibility_tree.maxDepth)),
        ),
      },
      ax_press: {
        enabled: raw.allow?.ax_press?.enabled !== false,
        allowedRoles: uniqueStringList(raw.allow?.ax_press?.allowedRoles, DEFAULT_ACTION_POLICY.allow.ax_press.allowedRoles),
      },
      ax_set_value: {
        enabled: raw.allow?.ax_set_value?.enabled !== false,
        allowedRoles: uniqueStringList(raw.allow?.ax_set_value?.allowedRoles, DEFAULT_ACTION_POLICY.allow.ax_set_value.allowedRoles),
        maxBytes: Math.max(1, Number(raw.allow?.ax_set_value?.maxBytes || DEFAULT_ACTION_POLICY.allow.ax_set_value.maxBytes)),
      },
      browser_control: {
        enabled: raw.allow?.browser_control?.enabled !== false,
        allowedActions: browserAllowedActionsList(raw.allow?.browser_control?.allowedActions),
      },
      code_agent: {
        enabled: raw.allow?.code_agent?.enabled !== false,
        allowedCommands: uniqueStringList(raw.allow?.code_agent?.allowedCommands, DEFAULT_ACTION_POLICY.allow.code_agent.allowedCommands),
        maxTimeoutMs: Math.max(
          1000,
          Math.min(3600000, Number(raw.allow?.code_agent?.maxTimeoutMs || DEFAULT_ACTION_POLICY.allow.code_agent.maxTimeoutMs)),
        ),
      },
      cli_command: {
        enabled: raw.allow?.cli_command?.enabled !== false,
        allowedCommands: uniqueStringList(raw.allow?.cli_command?.allowedCommands, DEFAULT_ACTION_POLICY.allow.cli_command.allowedCommands),
        maxCommandLength: Math.max(
          80,
          Math.min(20000, Number(raw.allow?.cli_command?.maxCommandLength || DEFAULT_ACTION_POLICY.allow.cli_command.maxCommandLength)),
        ),
        maxTimeoutMs: Math.max(
          1000,
          Math.min(3600000, Number(raw.allow?.cli_command?.maxTimeoutMs || DEFAULT_ACTION_POLICY.allow.cli_command.maxTimeoutMs)),
        ),
      },
      read_browser_page: {
        enabled: raw.allow?.read_browser_page?.enabled !== false,
        maxChars: Math.max(1000, Math.min(120000, Number(raw.allow?.read_browser_page?.maxChars || DEFAULT_ACTION_POLICY.allow.read_browser_page.maxChars))),
      },
      list_directory: {
        enabled: raw.allow?.list_directory?.enabled !== false,
        allowedRoots: uniqueStringList(raw.allow?.list_directory?.allowedRoots, DEFAULT_ACTION_POLICY.allow.list_directory.allowedRoots),
      },
      read_file: {
        enabled: raw.allow?.read_file?.enabled !== false,
        allowedRoots: uniqueStringList(raw.allow?.read_file?.allowedRoots, DEFAULT_ACTION_POLICY.allow.read_file.allowedRoots),
        maxBytes: Math.max(1, Number(raw.allow?.read_file?.maxBytes || DEFAULT_ACTION_POLICY.allow.read_file.maxBytes)),
      },
      search_files: {
        enabled: raw.allow?.search_files?.enabled !== false,
        allowedRoots: uniqueStringList(raw.allow?.search_files?.allowedRoots, DEFAULT_ACTION_POLICY.allow.search_files.allowedRoots),
        maxResults: Math.max(1, Math.min(500, Number(raw.allow?.search_files?.maxResults || DEFAULT_ACTION_POLICY.allow.search_files.maxResults))),
      },
      write_file: {
        enabled: raw.allow?.write_file?.enabled !== false,
        allowedRoots: mutationAllowedRoots(raw.allow?.write_file?.allowedRoots, DEFAULT_ACTION_POLICY.allow.write_file.allowedRoots),
        maxBytes: Math.max(1, Number(raw.allow?.write_file?.maxBytes || DEFAULT_ACTION_POLICY.allow.write_file.maxBytes)),
      },
      create_directory: {
        enabled: raw.allow?.create_directory?.enabled !== false,
        allowedRoots: mutationAllowedRoots(raw.allow?.create_directory?.allowedRoots, DEFAULT_ACTION_POLICY.allow.create_directory.allowedRoots),
      },
      copy_file: {
        enabled: raw.allow?.copy_file?.enabled !== false,
        allowedRoots: mutationAllowedRoots(raw.allow?.copy_file?.allowedRoots, DEFAULT_ACTION_POLICY.allow.copy_file.allowedRoots),
        maxBytes: Math.max(1, Number(raw.allow?.copy_file?.maxBytes || DEFAULT_ACTION_POLICY.allow.copy_file.maxBytes)),
      },
      move_file: {
        enabled: raw.allow?.move_file?.enabled !== false,
        allowedRoots: mutationAllowedRoots(raw.allow?.move_file?.allowedRoots, DEFAULT_ACTION_POLICY.allow.move_file.allowedRoots),
      },
    },
  };
}

function loadActionPolicy() {
  if (!fs.existsSync(ACTION_POLICY_FILE)) {
    const policy = normalizeActionPolicy(DEFAULT_ACTION_POLICY);
    writeJsonAtomic(ACTION_POLICY_FILE, policy);
    return policy;
  }

  try {
    const policy = normalizeActionPolicy(JSON.parse(fs.readFileSync(ACTION_POLICY_FILE, 'utf8')));
    writeJsonAtomic(ACTION_POLICY_FILE, policy);
    return policy;
  } catch (error) {
    appendAudit('action_policy.load_failed', { message: error instanceof Error ? error.message : String(error) });
    return normalizeActionPolicy(DEFAULT_ACTION_POLICY);
  }
}

function persistActionPolicy() {
  writeJsonAtomic(ACTION_POLICY_FILE, actionPolicy);
}

function normalizeScreenPrivacy(value = {}) {
  const mode = String(value.mode || DEFAULT_SCREEN_PRIVACY.mode) === 'clear' ? 'clear' : 'private';
  const privateMode = mode === 'private';
  return {
    version: 1,
    mode,
    label: privateMode ? 'Private' : 'Clear',
    maxWidth: privateMode ? 640 : 1280,
    blurPx: privateMode ? 5 : 0,
    jpegQuality: privateMode ? 0.46 : 0.72,
    realtimeAllowed: true,
    updatedAt: Number(value.updatedAt || Date.now()),
  };
}

function loadScreenPrivacy() {
  if (!fs.existsSync(SCREEN_PRIVACY_FILE)) {
    const value = normalizeScreenPrivacy(DEFAULT_SCREEN_PRIVACY);
    writeJsonAtomic(SCREEN_PRIVACY_FILE, value);
    return value;
  }
  try {
    const value = normalizeScreenPrivacy(JSON.parse(fs.readFileSync(SCREEN_PRIVACY_FILE, 'utf8')));
    writeJsonAtomic(SCREEN_PRIVACY_FILE, value);
    return value;
  } catch (error) {
    appendAudit('screen_privacy.load_failed', { message: error instanceof Error ? error.message : String(error) });
    return normalizeScreenPrivacy(DEFAULT_SCREEN_PRIVACY);
  }
}

function persistScreenPrivacy() {
  writeJsonAtomic(SCREEN_PRIVACY_FILE, screenPrivacy);
}

function screenPrivacySnapshot() {
  return { ...screenPrivacy };
}

function updateScreenPrivacy(options = {}) {
  screenPrivacy = normalizeScreenPrivacy({
    ...screenPrivacy,
    mode: options.mode,
    updatedAt: Date.now(),
  });
  persistScreenPrivacy();
  appendAudit('screen_privacy.updated', {
    mode: screenPrivacy.mode,
    source: String(options.source || 'api').slice(0, 80),
  });
  return screenPrivacySnapshot();
}

function clearLatestScreen(source = 'api') {
  latestScreen = null;
  appendAudit('screen.frame_cleared', { source: String(source || 'api').slice(0, 80) });
  return null;
}

function latestScreenSnapshot(options = {}) {
  if (!latestScreen) return null;
  const snapshot = {
    width: latestScreen.width,
    height: latestScreen.height,
    updatedAt: latestScreen.updatedAt,
    privacy: latestScreen.privacy || screenPrivacySnapshot(),
    source: latestScreen.source || 'unknown',
    displayId: latestScreen.displayId || '',
    displayName: latestScreen.displayName || '',
  };
  if (options.includeImage) snapshot.imageDataUrl = latestScreen.imageDataUrl || '';
  return snapshot;
}

function latestScreenAgeMs() {
  if (!latestScreen?.updatedAt) return Infinity;
  return Math.max(0, Date.now() - Number(latestScreen.updatedAt));
}

function hasFreshLatestScreen(maxAgeMs) {
  return Number.isFinite(latestScreenAgeMs()) && latestScreenAgeMs() <= Math.max(0, Number(maxAgeMs || 0));
}

function transformScreenImageForPrivacy(image, privacy) {
  if (privacy.mode !== 'private') return image;
  const size = image.getSize();
  const factor = Math.max(3, Math.min(12, Number(privacy.blurPx || 5) + 2));
  const small = image.resize({
    width: Math.max(24, Math.round(size.width / factor)),
    height: Math.max(14, Math.round(size.height / factor)),
    quality: 'worst',
  });
  return small.resize({
    width: size.width,
    height: size.height,
    quality: 'worst',
  });
}

function resizeScreenImageForPrivacy(image, privacy) {
  const size = image.getSize();
  const maxWidth = privacy.mode === 'private'
    ? Math.max(320, Number(privacy.maxWidth || 640))
    : Math.max(640, Number(privacy.maxWidth || 1280));
  if (!size.width || size.width <= maxWidth) return image;
  return image.resize({
    width: maxWidth,
    height: Math.max(180, Math.round(size.height * (maxWidth / size.width))),
    quality: 'best',
  });
}

function prepareScreenImageForStorage(image, privacy) {
  return transformScreenImageForPrivacy(resizeScreenImageForPrivacy(image, privacy), privacy);
}

function nativeImageToDataUrl(image, privacy) {
  const buffer = image.toJPEG(Math.max(1, Math.min(100, Math.round((privacy.jpegQuality || 0.46) * 100))));
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

async function captureScreenWithScreencapture() {
  if (process.platform !== 'darwin') throw new Error('screencapture_fallback_unsupported');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'javis-screen-'));
  const target = path.join(dir, 'screen.jpg');
  try {
    await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'jpg', target], { timeout: 10000 });
    const image = nativeImage.createFromPath(target);
    if (image.isEmpty()) throw new Error('screencapture_thumbnail_empty');
    return image;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Temporary cleanup is best-effort.
    }
  }
}

async function captureResidentScreen(options = {}) {
  const privacy = screenPrivacySnapshot();
  const display = screen.getPrimaryDisplay();
  const scale = privacy.mode === 'private'
    ? Math.min(1, Math.max(320, privacy.maxWidth || 640) / Math.max(1, display.size.width))
    : Math.min(1, Math.max(640, privacy.maxWidth || 1280) / Math.max(1, display.size.width));
  const thumbnailSize = {
    width: Math.max(320, Math.round(display.size.width * scale)),
    height: Math.max(180, Math.round(display.size.height * scale)),
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false,
  });
  const preferredDisplayId = String(options.displayId || display.id || '');
  const source =
    sources.find((item) => String(item.display_id || '') === preferredDisplayId)
    || sources[0];
  let capturedImage = source && !source.thumbnail.isEmpty() ? source.thumbnail : null;
  let captureSource = 'desktopCapturer';
  if (!capturedImage) {
    capturedImage = await captureScreenWithScreencapture();
    captureSource = 'screencapture';
  }
  const storedImage = prepareScreenImageForStorage(capturedImage, privacy);
  const storedSize = storedImage.getSize();

  latestScreen = {
    imageDataUrl: nativeImageToDataUrl(storedImage, privacy),
    width: storedSize.width,
    height: storedSize.height,
    privacy,
    source: 'resident',
    displayId: String(source?.display_id || display.id || ''),
    displayName: source?.name || captureSource,
    updatedAt: Date.now(),
  };
  appendAudit('screen.frame_captured', {
    source: String(options.source || 'resident').slice(0, 80),
    captureSource,
    width: latestScreen.width,
    height: latestScreen.height,
    privacy: privacy.mode,
    displayId: latestScreen.displayId,
    displayName: latestScreen.displayName,
  });
  return latestScreenSnapshot({ includeImage: Boolean(options.includeImage) });
}

function appendAudit(type, data = {}) {
  const record = {
    ts: new Date().toISOString(),
    type,
    data,
  };
  try {
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    fs.appendFileSync(
      path.join(process.cwd(), 'javis-error.log'),
      `${new Date().toISOString()} audit_write_failed ${error.stack || error}\n`,
    );
  }
}

function normalizeJobAttempts(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((attempt) => (attempt && typeof attempt === 'object' ? {
      id: String(attempt.id || crypto.randomUUID()).slice(0, 120),
      tool: String(attempt.tool || attempt.mode || '').slice(0, 80),
      command: redactCommandForLog(attempt.command || ''),
      status: String(attempt.status || '').slice(0, 40),
      summary: compactRecordText(attempt.summary || attempt.error || '', 500),
      startedAt: Number(attempt.startedAt || 0),
      completedAt: Number(attempt.completedAt || 0),
    } : null))
    .filter(Boolean)
    .slice(-12);
}

function normalizeRecoveryPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const nextActions = Array.isArray(plan.nextActions) ? plan.nextActions : [];
  const diagnostics = plan.diagnostics && typeof plan.diagnostics === 'object' ? plan.diagnostics : null;
  return {
    failureKind: String(plan.failureKind || '').slice(0, 80),
    summary: compactRecordText(plan.summary || '', 800),
    attempted: Array.isArray(plan.attempted)
      ? plan.attempted.map((item) => compactRecordText(item, 240)).filter(Boolean).slice(0, 8)
      : [],
    nextActions: nextActions
      .map((action) => (action && typeof action === 'object' ? {
        label: compactRecordText(action.label || '', 120),
        type: String(action.type || 'manual').slice(0, 80),
        mode: String(action.mode || '').slice(0, 40),
        riskLevel: Math.max(0, Math.min(4, Number(action.riskLevel || 0))),
        autoEligible: Boolean(action.autoEligible),
        command: redactCommandForLog(action.command || ''),
        reason: compactRecordText(action.reason || '', 300),
      } : null))
      .filter(Boolean)
      .slice(0, 8),
    diagnostics: diagnostics ? {
      overall: String(diagnostics.overall || '').slice(0, 40),
      summary: compactRecordText(diagnostics.summary || '', 500),
      counts: {
        ready: Math.max(0, Number(diagnostics.counts?.ready || 0)),
        warning: Math.max(0, Number(diagnostics.counts?.warning || 0)),
        blocked: Math.max(0, Number(diagnostics.counts?.blocked || 0)),
        total: Math.max(0, Number(diagnostics.counts?.total || 0)),
      },
      primaryIssue: diagnostics.primaryIssue && typeof diagnostics.primaryIssue === 'object' ? {
        id: String(diagnostics.primaryIssue.id || '').slice(0, 80),
        label: compactRecordText(diagnostics.primaryIssue.label || '', 120),
        status: String(diagnostics.primaryIssue.status || '').slice(0, 40),
        summary: compactRecordText(diagnostics.primaryIssue.summary || '', 300),
        next: compactRecordText(diagnostics.primaryIssue.next || '', 300),
      } : null,
      runtime: diagnostics.runtime && typeof diagnostics.runtime === 'object' ? {
        localExecutionEnabled: Boolean(diagnostics.runtime.localExecutionEnabled),
        trustedLocalMode: Boolean(diagnostics.runtime.trustedLocalMode),
        dryRun: Boolean(diagnostics.runtime.dryRun),
        maxAutoRiskLevel: Math.max(0, Math.min(4, Number(diagnostics.runtime.maxAutoRiskLevel || 0))),
        requireApprovalAtRiskLevel: Math.max(0, Math.min(4, Number(diagnostics.runtime.requireApprovalAtRiskLevel || 0))),
      } : null,
      workers: diagnostics.workers && typeof diagnostics.workers === 'object' ? {
        codex: diagnostics.workers.codex && typeof diagnostics.workers.codex === 'object' ? {
          available: Boolean(diagnostics.workers.codex.available),
          command: redactCommandForLog(diagnostics.workers.codex.command || ''),
        } : null,
        claude: diagnostics.workers.claude && typeof diagnostics.workers.claude === 'object' ? {
          available: Boolean(diagnostics.workers.claude.available),
          command: redactCommandForLog(diagnostics.workers.claude.command || ''),
        } : null,
      } : null,
      policy: diagnostics.policy && typeof diagnostics.policy === 'object' ? {
        codeAgentEnabled: diagnostics.policy.codeAgentEnabled !== false,
        codeAgentAllowedCommands: uniqueStringList(diagnostics.policy.codeAgentAllowedCommands, []),
      } : null,
    } : null,
    generatedAt: Number(plan.generatedAt || Date.now()),
  };
}

function normalizePersistedJob(job) {
  if (!job || typeof job !== 'object' || !job.id) return null;
  const status = ['queued', 'running', 'done', 'failed', 'cancelled'].includes(job.status) ? job.status : 'failed';
  const interrupted = status === 'queued' || status === 'running';
  return {
    id: String(job.id),
    title: String(job.title || 'Untitled task').slice(0, 120),
    mode: ['background', 'codex', 'claude', 'cli'].includes(job.mode) ? job.mode : 'background',
    status: interrupted ? 'failed' : status,
    createdAt: Number(job.createdAt || Date.now()),
    updatedAt: interrupted ? Date.now() : Number(job.updatedAt || Date.now()),
    startedAt: interrupted ? Number(job.startedAt || 0) : Number(job.startedAt || 0),
    completedAt: interrupted ? Date.now() : Number(job.completedAt || 0),
    pid: interrupted ? null : job.pid || null,
    source: String(job.source || ''),
    workflowId: String(job.workflowId || ''),
    parentJobId: String(job.parentJobId || ''),
    recoveryForJobId: String(job.recoveryForJobId || ''),
    task: String(job.task || job.command || job.title || '').slice(0, 24000),
    command: String(job.command || '').slice(0, 4000),
    timeoutMs: Math.max(1000, Math.min(3600000, Number(job.timeoutMs || 180000))),
    cancelRequested: false,
    log: interrupted ? 'Interrupted by previous JAVIS shutdown.' : String(job.log || ''),
    result: interrupted ? 'This job was not completed before the previous process exited.' : String(job.result || ''),
    attempts: normalizeJobAttempts(job.attempts),
    failureKind: String(job.failureKind || '').slice(0, 80),
    recoveryPlan: normalizeRecoveryPlan(job.recoveryPlan),
  };
}

function redactUrlForStorage(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname}${parsed.search ? '?[redacted]' : ''}${parsed.hash ? '#[redacted]' : ''}`;
    }
    return raw;
  } catch {
    return raw.replace(/[?#].*$/, (suffix) => (suffix.startsWith('?') ? '?[redacted]' : '#[redacted]'));
  }
}

function normalizePersistedWorkflow(workflow, fromDisk = false) {
  if (!workflow || typeof workflow !== 'object' || !workflow.id) return null;
  const status = ['queued', 'running', 'done', 'failed', 'cancelled', 'blocked'].includes(workflow.status)
    ? workflow.status
    : 'failed';
  const interrupted = fromDisk && (status === 'queued' || status === 'running');
  const target = workflow.target && typeof workflow.target === 'object' ? workflow.target : {};
  return {
    id: String(workflow.id),
    kind: String(workflow.kind || 'general').slice(0, 60),
    source: String(workflow.source || '').slice(0, 80),
    status: interrupted ? 'failed' : status,
    title: String(workflow.title || 'Untitled workflow').slice(0, 180),
    intent: String(workflow.intent || '').slice(0, 80),
    mode: String(workflow.mode || '').slice(0, 40),
    request: String(workflow.request || '').slice(0, 12000),
    result: interrupted ? 'Workflow was interrupted by previous JAVIS shutdown.' : String(workflow.result || '').slice(0, 100000),
    parentWorkflowId: String(workflow.parentWorkflowId || ''),
    target: {
      app: String(target.app || '').slice(0, 120),
      title: String(target.title || '').slice(0, 300),
      url: redactUrlForStorage(target.url).slice(0, 2000),
      path: String(target.path || '').slice(0, 2000),
      type: String(target.type || '').slice(0, 80),
      fallback: String(target.fallback || '').slice(0, 80),
      textLength: Number(target.textLength || 0),
      returnedLength: Number(target.returnedLength || 0),
      resultCount: Number(target.resultCount || 0),
    },
    jobId: String(workflow.jobId || ''),
    createdAt: Number(workflow.createdAt || Date.now()),
    updatedAt: interrupted ? Date.now() : Number(workflow.updatedAt || Date.now()),
    completedAt: interrupted ? Date.now() : Number(workflow.completedAt || 0),
  };
}

function normalizeRoutingStatus(value) {
  const status = String(value || '').trim();
  return ['preview', 'queued', 'running', 'done', 'failed', 'cancelled', 'blocked', 'approval_required'].includes(status)
    ? status
    : 'preview';
}

function normalizeRoutingLane(value) {
  const lane = String(value || '').trim().toLowerCase();
  return ['quick', 'background', 'codex', 'claude', 'local'].includes(lane) ? lane : 'quick';
}

function ownerForRoutingLane(lane) {
  if (lane === 'background') return 'background';
  if (lane === 'codex') return 'codex';
  if (lane === 'claude') return 'claude';
  if (lane === 'local') return 'local';
  return 'realtime';
}

function normalizePersistedRoutingRecord(record) {
  if (!record || typeof record !== 'object' || !record.id) return null;
  const lane = normalizeRoutingLane(record.lane);
  const status = normalizeRoutingStatus(record.status);
  const completedAt = ['done', 'failed', 'cancelled', 'blocked'].includes(status)
    ? Number(record.completedAt || Date.now())
    : Number(record.completedAt || 0);
  return {
    id: String(record.id),
    taskTitle: compactRecordText(record.taskTitle || record.title || 'Untitled routed task', 180),
    lane,
    label: String(record.label || (lane === 'background' ? 'Deep' : lane === 'local' ? 'Local' : lane)).slice(0, 80),
    owner: String(record.owner || ownerForRoutingLane(lane)).slice(0, 80),
    scope: compactRecordText(record.scope || '', 220),
    parallelGroup: String(record.parallelGroup || lane).slice(0, 120),
    approvalRequirement: String(record.approvalRequirement || 'none').slice(0, 120),
    status,
    source: String(record.source || 'router').slice(0, 80),
    execute: Boolean(record.execute),
    confidence: Number(record.confidence || 0),
    reason: compactRecordText(record.reason || '', 240),
    jobId: String(record.jobId || '').slice(0, 120),
    workflowId: String(record.workflowId || '').slice(0, 120),
    localCommand: String(record.localCommand || '').slice(0, 80),
    resultLink: String(record.resultLink || '').slice(0, 500),
    resultSummary: compactRecordText(record.resultSummary || '', 500),
    attempts: normalizeJobAttempts(record.attempts),
    failureKind: String(record.failureKind || '').slice(0, 80),
    recoveryPlan: normalizeRecoveryPlan(record.recoveryPlan),
    memoryMatches: Math.max(0, Number(record.memoryMatches || 0)),
    createdAt: Number(record.createdAt || Date.now()),
    updatedAt: Number(record.updatedAt || Date.now()),
    completedAt,
  };
}

function cloneJsonObject(value, fallback = {}) {
  try {
    return JSON.parse(JSON.stringify(value || fallback));
  } catch {
    return fallback;
  }
}

function normalizeApprovalContinuation(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type !== 'app_workflow') return null;
  const remainingSteps = Array.isArray(value.remainingSteps)
    ? value.remainingSteps.slice(0, 12).map((step, index) => ({
        ...cloneJsonObject(step),
        index,
      }))
    : [];
  return {
    type: 'app_workflow',
    workflowId: String(value.workflowId || '').slice(0, 120),
    title: String(value.title || '').slice(0, 180),
    instruction: String(value.instruction || '').slice(0, 2000),
    stepIndex: Math.max(0, Number(value.stepIndex || 0)),
    source: String(value.source || 'approval').slice(0, 80),
    remainingSteps,
  };
}

function normalizePersistedApproval(approval) {
  if (!approval || typeof approval !== 'object' || !approval.id) return null;
  const status = ['pending', 'approved', 'rejected', 'executed', 'failed'].includes(approval.status)
    ? approval.status
    : 'failed';
  return {
    id: String(approval.id),
    action: String(approval.action || ''),
    riskLevel: Math.max(0, Math.min(4, Number(approval.riskLevel || 0))),
    reason: String(approval.reason || ''),
    summary: String(approval.summary || '').slice(0, 240),
    args: approval.args && typeof approval.args === 'object' ? approval.args : {},
    continuation: normalizeApprovalContinuation(approval.continuation),
    status,
    createdAt: Number(approval.createdAt || Date.now()),
    updatedAt: Number(approval.updatedAt || Date.now()),
    result: String(approval.result || ''),
  };
}

function normalizeMemoryTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim());
  return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean)))
    .slice(0, 12)
    .map((item) => item.slice(0, 48));
}

function normalizePersistedMemory(memory) {
  if (!memory || typeof memory !== 'object' || !memory.id) return null;
  const kind = ['fact', 'preference', 'project', 'task', 'note'].includes(memory.kind) ? memory.kind : 'note';
  const text = String(memory.text || '').trim().slice(0, 8000);
  if (!text) return null;
  return {
    id: String(memory.id),
    kind,
    scope: String(memory.scope || 'local').slice(0, 80),
    text,
    tags: normalizeMemoryTags(memory.tags),
    source: String(memory.source || 'user').slice(0, 80),
    createdAt: Number(memory.createdAt || Date.now()),
    updatedAt: Number(memory.updatedAt || Date.now()),
  };
}

function normalizePersistedInboxItem(item) {
  if (!item || typeof item !== 'object' || !item.id) return null;
  const status = ['open', 'done', 'cancelled'].includes(item.status) ? item.status : 'open';
  const body = String(item.body || item.text || '').trim().slice(0, 20000);
  const title = String(item.title || body.split('\n').find(Boolean) || 'Untitled inbox item').trim().slice(0, 160);
  const route = item.route && typeof item.route === 'object'
    ? {
        lane: String(item.route.lane || '').slice(0, 40),
        label: String(item.route.label || '').slice(0, 80),
        queued: Boolean(item.route.queued),
        jobId: String(item.route.jobId || '').slice(0, 80),
        output: String(item.route.output || '').slice(0, 1200),
        routedAt: Number(item.route.routedAt || 0),
      }
    : null;
  if (!title && !body) return null;
  return {
    id: String(item.id),
    title: title || 'Untitled inbox item',
    body,
    status,
    priority: Math.max(1, Math.min(4, Number(item.priority || 3))),
    source: String(item.source || 'manual').slice(0, 80),
    tags: normalizeMemoryTags(item.tags),
    route,
    createdAt: Number(item.createdAt || Date.now()),
    updatedAt: Number(item.updatedAt || Date.now()),
    completedAt: status === 'done' || status === 'cancelled' ? Number(item.completedAt || Date.now()) : 0,
  };
}

function normalizeSessionEventRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const kind = String(ref.kind || ref.type || '').trim().slice(0, 40);
  const id = String(ref.id || '').trim().slice(0, 120);
  const status = String(ref.status || '').trim().slice(0, 40);
  if (!kind && !id && !status) return null;
  return { kind, id, status };
}

function normalizePersistedSession(session) {
  if (!session || typeof session !== 'object' || !session.id) return null;
  const status = ['active', 'done', 'cancelled'].includes(session.status) ? session.status : 'done';
  const title = String(session.title || session.goal || 'Untitled session').trim().slice(0, 180);
  const goal = String(session.goal || title).trim().slice(0, 2000);
  if (!title && !goal) return null;
  const events = Array.isArray(session.events)
    ? session.events
      .map((event) => {
        if (!event || typeof event !== 'object') return null;
        const text = String(event.text || event.body || '').trim().slice(0, 4000);
        if (!text) return null;
        return {
          id: String(event.id || crypto.randomUUID()),
          type: String(event.type || 'note').slice(0, 40),
          text,
          source: String(event.source || 'manual').slice(0, 80),
          ref: normalizeSessionEventRef(event.ref),
          createdAt: Number(event.createdAt || Date.now()),
        };
      })
      .filter(Boolean)
      .slice(-200)
    : [];
  return {
    id: String(session.id),
    title: title || goal.slice(0, 180) || 'Untitled session',
    goal: goal || title || 'Untitled session',
    status,
    source: String(session.source || 'manual').slice(0, 80),
    tags: normalizeMemoryTags(session.tags),
    events,
    summary: String(session.summary || '').slice(0, 8000),
    createdAt: Number(session.createdAt || Date.now()),
    updatedAt: Number(session.updatedAt || Date.now()),
    completedAt: status === 'active' ? 0 : Number(session.completedAt || Date.now()),
  };
}

function normalizeAmbientEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const frontmost = event.frontmost && typeof event.frontmost === 'object' ? event.frontmost : {};
  const browser = event.browser && typeof event.browser === 'object' ? event.browser : {};
  const screenFrame = event.screen && typeof event.screen === 'object' ? event.screen : {};
  return {
    id: String(event.id || crypto.randomUUID()),
    source: String(event.source || 'ambient').slice(0, 80),
    frontmost: {
      app: String(frontmost.app || '').slice(0, 120),
      windowTitle: String(frontmost.windowTitle || '').slice(0, 300),
      available: Boolean(frontmost.available),
    },
    browser: {
      available: Boolean(browser.available),
      app: String(browser.app || '').slice(0, 120),
      title: String(browser.title || '').slice(0, 300),
      url: redactUrlForStorage(browser.url || '').slice(0, 2000),
      source: String(browser.source || '').slice(0, 80),
    },
    screen: {
      width: Number(screenFrame.width || 0),
      height: Number(screenFrame.height || 0),
      source: String(screenFrame.source || '').slice(0, 80),
      displayId: String(screenFrame.displayId || '').slice(0, 120),
      displayName: String(screenFrame.displayName || '').slice(0, 200),
      updatedAt: Number(screenFrame.updatedAt || 0),
      privacyMode: String(screenFrame.privacy?.mode || screenFrame.privacyMode || '').slice(0, 40),
    },
    createdAt: Number(event.createdAt || Date.now()),
  };
}

function normalizeLearningList(value, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? item : null))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeLearnedProfile(profile = {}) {
  const now = Date.now();
  return {
    version: 1,
    enabled: AMBIENT_LEARNING_ENABLED,
    updatedAt: Number(profile.updatedAt || 0),
    lastDistilledAt: Number(profile.lastDistilledAt || 0),
    sourceEventCount: Number(profile.sourceEventCount || 0),
    sourceRange: profile.sourceRange && typeof profile.sourceRange === 'object'
      ? {
          oldestAt: Number(profile.sourceRange.oldestAt || 0),
          newestAt: Number(profile.sourceRange.newestAt || 0),
        }
      : { oldestAt: 0, newestAt: 0 },
    summary: String(profile.summary || 'No learned ambient profile yet.').slice(0, 1200),
    topApps: normalizeLearningList(profile.topApps).map((item) => ({
      name: String(item.name || '').slice(0, 120),
      count: Number(item.count || 0),
      share: Number(item.share || 0),
      lastSeenAt: Number(item.lastSeenAt || 0),
    })).filter((item) => item.name),
    topBrowserHosts: normalizeLearningList(profile.topBrowserHosts).map((item) => ({
      host: String(item.host || '').slice(0, 200),
      title: String(item.title || '').slice(0, 200),
      count: Number(item.count || 0),
      share: Number(item.share || 0),
      lastSeenAt: Number(item.lastSeenAt || 0),
    })).filter((item) => item.host),
    recentContexts: normalizeLearningList(profile.recentContexts, 10).map((item) => ({
      app: String(item.app || '').slice(0, 120),
      title: String(item.title || '').slice(0, 220),
      host: String(item.host || '').slice(0, 200),
      createdAt: Number(item.createdAt || 0),
    })).filter((item) => item.app || item.title || item.host),
    activeHours: normalizeLearningList(profile.activeHours, 24).map((item) => ({
      hour: Math.max(0, Math.min(23, Number(item.hour || 0))),
      count: Number(item.count || 0),
    })).filter((item) => item.count > 0),
    signals: Array.isArray(profile.signals)
      ? profile.signals.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    createdAt: Number(profile.createdAt || now),
  };
}

function loadPersistedJobs() {
  if (!fs.existsSync(JOBS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    const list = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    for (const rawJob of list) {
      const job = normalizePersistedJob(rawJob);
      if (job) jobs.set(job.id, job);
    }
    persistJobs();
    reconcileFailedJobsWithRecoveryPlans();
    appendAudit('jobs.loaded', { count: jobs.size });
  } catch (error) {
    appendAudit('jobs.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function failedJobRecoveryError(job) {
  const evidence = [
    job?.result,
    job?.log,
  ].filter(Boolean).join('\n').trim();
  const error = new Error(evidence || 'JAVIS job failed without a recovery plan.');
  if (job?.failureKind) error.failureKind = job.failureKind;
  return error;
}

function shouldBackfillRecoveryPlan(job) {
  if (!job || job.status !== 'failed') return false;
  if (job.recoveryPlan?.nextActions?.length) return false;
  if (!originalTaskForJob(job)) return false;
  return true;
}

function recoveryPlanResultText(job, recoveryPlan) {
  return [
    job.result || 'Job failed before a recovery plan was recorded.',
    recoveryPlan?.summary ? `Recovery: ${recoveryPlan.summary}` : '',
    recoveryPlan?.nextActions?.length
      ? `Next actions:\n${recoveryPlan.nextActions.map((action, index) => `${index + 1}. ${action.label}: ${action.reason}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
}

function reconcileFailedJobsWithRecoveryPlans() {
  let updated = 0;
  for (const job of Array.from(jobs.values())) {
    if (!shouldBackfillRecoveryPlan(job)) continue;
    const error = failedJobRecoveryError(job);
    const recoveryPlan = buildRecoveryPlanForJob(job, error);
    const failureKind = recoveryPlan?.failureKind || classifyJobFailure(error, job);
    setJob(job.id, {
      failureKind,
      recoveryPlan,
      result: recoveryPlanResultText(job, recoveryPlan),
      log: `${job.log || ''}\nRecovery plan backfilled after startup: ${failureKind}.`,
    });
    updated += 1;
  }
  if (updated) appendAudit('jobs.recovery_backfilled', { count: updated });
}

function loadPersistedWorkflows() {
  if (!fs.existsSync(WORKFLOWS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8'));
    const list = Array.isArray(parsed?.workflows) ? parsed.workflows : [];
    for (const rawWorkflow of list) {
      const workflow = normalizePersistedWorkflow(rawWorkflow, true);
      if (workflow) workflows.set(workflow.id, workflow);
    }
    persistWorkflows();
    appendAudit('workflows.loaded', { count: workflows.size });
  } catch (error) {
    appendAudit('workflows.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedRouting() {
  if (!fs.existsSync(ROUTING_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8'));
    const list = Array.isArray(parsed?.records) ? parsed.records : [];
    for (const rawRecord of list) {
      const record = normalizePersistedRoutingRecord(rawRecord);
      if (record) routingRecords.set(record.id, record);
    }
    reconcileRoutingRecords();
    persistRouting();
    appendAudit('routing.loaded', { count: routingRecords.size });
  } catch (error) {
    appendAudit('routing.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedApprovals() {
  if (!fs.existsSync(APPROVALS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(APPROVALS_FILE, 'utf8'));
    const list = Array.isArray(parsed?.approvals) ? parsed.approvals : [];
    for (const rawApproval of list) {
      const approval = normalizePersistedApproval(rawApproval);
      if (approval) approvals.set(approval.id, approval);
    }
    persistApprovals();
    appendAudit('approvals.loaded', { count: approvals.size });
  } catch (error) {
    appendAudit('approvals.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedMemories() {
  if (!fs.existsSync(MEMORIES_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORIES_FILE, 'utf8'));
    const list = Array.isArray(parsed?.memories) ? parsed.memories : [];
    for (const rawMemory of list) {
      const memory = normalizePersistedMemory(rawMemory);
      if (memory) memories.set(memory.id, memory);
    }
    persistMemories();
    appendAudit('memories.loaded', { count: memories.size });
  } catch (error) {
    appendAudit('memories.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedInbox() {
  if (!fs.existsSync(INBOX_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(INBOX_FILE, 'utf8'));
    const list = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const rawItem of list) {
      const item = normalizePersistedInboxItem(rawItem);
      if (item) inboxItems.set(item.id, item);
    }
    persistInbox();
    appendAudit('inbox.loaded', { count: inboxItems.size });
  } catch (error) {
    appendAudit('inbox.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    for (const rawSession of list) {
      const session = normalizePersistedSession(rawSession);
      if (session) workSessions.set(session.id, session);
    }
    persistSessions();
    appendAudit('sessions.loaded', { count: workSessions.size });
  } catch (error) {
    appendAudit('sessions.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedAmbient() {
  if (!fs.existsSync(AMBIENT_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(AMBIENT_FILE, 'utf8'));
    const list = Array.isArray(parsed?.events) ? parsed.events : [];
    ambientEvents.splice(0, ambientEvents.length);
    for (const rawEvent of list) {
      const event = normalizeAmbientEvent(rawEvent);
      if (event) ambientEvents.push(event);
    }
    persistAmbient();
    appendAudit('ambient.loaded', { count: ambientEvents.length });
  } catch (error) {
    appendAudit('ambient.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function loadPersistedLearning() {
  if (!fs.existsSync(LEARNING_FILE)) {
    learnedProfile = normalizeLearnedProfile();
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
    learnedProfile = normalizeLearnedProfile(parsed?.profile || parsed);
    appendAudit('learning.loaded', { sourceEventCount: learnedProfile.sourceEventCount });
  } catch (error) {
    learnedProfile = normalizeLearnedProfile();
    appendAudit('learning.load_failed', { message: error instanceof Error ? error.message : String(error) });
  }
}

function persistJobs() {
  const jobsForStorage = Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PERSISTED_JOBS);
  writeJsonAtomic(JOBS_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    jobs: jobsForStorage,
  });
}

function persistWorkflows() {
  const workflowsForStorage = Array.from(workflows.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PERSISTED_WORKFLOWS);
  writeJsonAtomic(WORKFLOWS_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    workflows: workflowsForStorage,
  });
}

function persistRouting() {
  const recordsForStorage = Array.from(routingRecords.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, MAX_PERSISTED_ROUTING));
  writeJsonAtomic(ROUTING_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    records: recordsForStorage,
  });
}

function persistApprovals() {
  const approvalsForStorage = Array.from(approvals.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PERSISTED_APPROVALS);
  writeJsonAtomic(APPROVALS_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    approvals: approvalsForStorage,
  });
}

function persistMemories() {
  const memoriesForStorage = Array.from(memories.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_MEMORIES);
  writeJsonAtomic(MEMORIES_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    memories: memoriesForStorage,
  });
}

function persistInbox() {
  const itemsForStorage = Array.from(inboxItems.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_INBOX);
  writeJsonAtomic(INBOX_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: itemsForStorage,
  });
}

function persistSessions() {
  const sessionsForStorage = Array.from(workSessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_PERSISTED_SESSIONS);
  writeJsonAtomic(SESSIONS_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: sessionsForStorage,
  });
}

function persistAmbient() {
  const eventsForStorage = ambientEvents
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PERSISTED_AMBIENT);
  writeJsonAtomic(AMBIENT_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    events: eventsForStorage,
  });
}

function persistLearning() {
  const profile = normalizeLearnedProfile(learnedProfile || {});
  learnedProfile = profile;
  writeJsonAtomic(LEARNING_FILE, {
    version: 1,
    updatedAt: new Date().toISOString(),
    profile,
  });
}

function ambientSnapshot(limit = 20) {
  return ambientEvents
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(200, Number(limit || 20))));
}

function browserHostFromAmbientEvent(event) {
  const rawUrl = String(event?.browser?.url || '').trim();
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '').slice(0, 200);
  } catch {
    return '';
  }
}

function incrementLearningCounter(map, key, patch = {}) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  const existing = map.get(normalizedKey) || {
    key: normalizedKey,
    count: 0,
    lastSeenAt: 0,
    ...patch,
  };
  existing.count += 1;
  existing.lastSeenAt = Math.max(existing.lastSeenAt || 0, Number(patch.lastSeenAt || 0));
  map.set(normalizedKey, { ...existing, ...patch, count: existing.count, lastSeenAt: existing.lastSeenAt });
}

function sanitizeLearningTitle(value, app = '') {
  let text = compactRecordText(value, 180)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted-key]')
    .replace(/gh[pousr]_[A-Za-z0-9_]{10,}/g, '[redacted-token]')
    .replace(/(api[-_ ]?key|token|secret|password)=("[^"]*"|'[^']*'|[^\s]+)/gi, '$1=[redacted]')
    .trim();
  if (/terminal|iterm/i.test(String(app || '')) && text.length > 80) {
    text = text.split('—').slice(0, 2).join('—').trim() || text.slice(0, 80);
  }
  return text;
}

function learningCounterList(map, total, mapper, limit = 8) {
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || b.lastSeenAt - a.lastSeenAt)
    .slice(0, limit)
    .map((item) => ({
      ...mapper(item),
      count: item.count,
      share: total ? Number((item.count / total).toFixed(3)) : 0,
      lastSeenAt: item.lastSeenAt || 0,
    }));
}

function uniqueRecentAmbientContexts(events, limit = 6) {
  const seen = new Set();
  const contexts = [];
  for (const event of events) {
    const app = String(event.frontmost?.app || '').trim();
    const title = sanitizeLearningTitle(event.browser?.title || event.frontmost?.windowTitle || '', app);
    const host = browserHostFromAmbientEvent(event);
    const key = [app, title, host].join('\n');
    if (!app && !title && !host) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    contexts.push({
      app,
      title,
      host,
      createdAt: Number(event.createdAt || 0),
    });
    if (contexts.length >= limit) break;
  }
  return contexts;
}

function learnedProfileSummary(profile) {
  const parts = [];
  const total = Number(profile.sourceEventCount || 0);
  if (!total) return 'No ambient learning has been distilled yet.';
  const topApps = profile.topApps.slice(0, 3).map((item) => `${item.name} ${Math.round(item.share * 100)}%`);
  const topHosts = profile.topBrowserHosts.slice(0, 3).map((item) => item.host);
  parts.push(`Distilled from ${total} local ambient observation(s).`);
  if (topApps.length) parts.push(`Primary apps: ${topApps.join(', ')}.`);
  if (topHosts.length) parts.push(`Frequent browser hosts: ${topHosts.join(', ')}.`);
  if (profile.activeHours.length) {
    const hours = profile.activeHours
      .slice(0, 3)
      .map((item) => `${String(item.hour).padStart(2, '0')}:00`)
      .join(', ');
    parts.push(`Common active hours: ${hours}.`);
  }
  return parts.join(' ');
}

function learningSignalsFromProfile(profile) {
  const signals = [];
  const primaryApp = profile.topApps[0];
  if (primaryApp) signals.push(`current work often happens in ${primaryApp.name}`);
  const primaryHost = profile.topBrowserHosts[0];
  if (primaryHost) signals.push(`recent browser focus often includes ${primaryHost.host}`);
  const recent = profile.recentContexts[0];
  if (recent?.app || recent?.title) {
    signals.push(`latest observed context: ${[recent.app, recent.host || recent.title].filter(Boolean).join(' · ')}`);
  }
  return signals.slice(0, 6);
}

function distillAmbientLearning(options = {}) {
  const force = options.force === true;
  if (!AMBIENT_LEARNING_ENABLED && !force) return learningStateSnapshot();
  if (learningBusy) return learningStateSnapshot();
  learningBusy = true;
  try {
    const events = ambientSnapshot(MAX_LEARNING_SOURCE_EVENTS)
      .filter((event) => event?.frontmost?.available || event?.browser?.available)
      .sort((a, b) => b.createdAt - a.createdAt);
    const total = events.length;
    const appCounts = new Map();
    const hostCounts = new Map();
    const hourCounts = new Map();

    for (const event of events) {
      const createdAt = Number(event.createdAt || 0);
      const appName = String(event.frontmost?.app || '').trim();
      incrementLearningCounter(appCounts, appName, { name: appName, lastSeenAt: createdAt });

      const host = browserHostFromAmbientEvent(event);
      incrementLearningCounter(hostCounts, host, {
        host,
        title: sanitizeLearningTitle(event.browser?.title || '', event.browser?.app || event.frontmost?.app || ''),
        lastSeenAt: createdAt,
      });

      if (createdAt) {
        const hour = new Date(createdAt).getHours();
        incrementLearningCounter(hourCounts, String(hour), { hour, lastSeenAt: createdAt });
      }
    }

    const eventTimes = events.map((event) => Number(event.createdAt || 0)).filter(Boolean);
    const nextProfile = normalizeLearnedProfile({
      ...(learnedProfile || {}),
      enabled: AMBIENT_LEARNING_ENABLED,
      updatedAt: Date.now(),
      lastDistilledAt: Date.now(),
      sourceEventCount: total,
      sourceRange: {
        oldestAt: eventTimes.length ? Math.min(...eventTimes) : 0,
        newestAt: eventTimes.length ? Math.max(...eventTimes) : 0,
      },
      topApps: learningCounterList(appCounts, total, (item) => ({ name: item.name || item.key })),
      topBrowserHosts: learningCounterList(hostCounts, total, (item) => ({ host: item.host || item.key, title: item.title || '' })),
      activeHours: learningCounterList(hourCounts, total, (item) => ({ hour: Number(item.hour || item.key) }), 6),
      recentContexts: uniqueRecentAmbientContexts(events, 6),
    });
    nextProfile.summary = learnedProfileSummary(nextProfile);
    nextProfile.signals = learningSignalsFromProfile(nextProfile);
    learnedProfile = nextProfile;
    persistLearning();
    appendAudit('learning.distilled', {
      source: String(options.source || 'ambient').slice(0, 80),
      sourceEventCount: total,
      topApp: learnedProfile.topApps[0]?.name || '',
      topHost: learnedProfile.topBrowserHosts[0]?.host || '',
    });
    if (LEARNING_AUTO_MEMORY_ENABLED && total >= LEARNING_AUTO_MEMORY_MIN_EVENTS) {
      try {
        upsertLearningProfileMemory(learnedProfile, options.source || 'learning_auto');
      } catch (error) {
        appendAudit('learning.memory_auto_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return learningStateSnapshot();
  } catch (error) {
    appendAudit('learning.distill_failed', { message: error instanceof Error ? error.message : String(error) });
    return learningStateSnapshot();
  } finally {
    learningBusy = false;
  }
}

function learningStateSnapshot() {
  if (!learnedProfile) learnedProfile = normalizeLearnedProfile();
  return {
    enabled: AMBIENT_LEARNING_ENABLED,
    includeInPrompts: INCLUDE_LEARNING_IN_PROMPTS,
    intervalMs: AMBIENT_LEARNING_INTERVAL_MS,
    sourceEventLimit: MAX_LEARNING_SOURCE_EVENTS,
    learningFile: LEARNING_FILE,
    profile: normalizeLearnedProfile(learnedProfile),
  };
}

function learningContextForPrompt() {
  const profile = learningStateSnapshot().profile;
  if (!AMBIENT_LEARNING_ENABLED || !INCLUDE_LEARNING_IN_PROMPTS || !profile.sourceEventCount) return '';
  return [
    'Local inferred user profile from passive ambient metadata. Treat as lightweight context, not explicit user-approved memory:',
    profile.summary,
    profile.signals.length ? `Signals: ${profile.signals.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function approvalSnapshot(limit = 20) {
  return Array.from(approvals.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function pendingApprovalSnapshot(limit = 20) {
  return approvalSnapshot(limit).filter((approval) => approval.status === 'pending');
}

function memorySnapshot(limit = 50) {
  return Array.from(memories.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, limit)));
}

function inboxSnapshot(limit = 50, status = '') {
  const wantedStatus = String(status || '').trim();
  return Array.from(inboxItems.values())
    .filter((item) => !wantedStatus || item.status === wantedStatus)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return a.priority - b.priority || b.updatedAt - a.updatedAt;
    })
    .slice(0, Math.max(1, Math.min(200, Number(limit || 50))));
}

function inboxCounts() {
  return Array.from(inboxItems.values()).reduce(
    (counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1;
      counts.total += 1;
      return counts;
    },
    { total: 0, open: 0, done: 0, cancelled: 0 },
  );
}

function sessionSnapshot(limit = 20, status = '') {
  const wantedStatus = String(status || '').trim();
  return Array.from(workSessions.values())
    .filter((session) => !wantedStatus || session.status === wantedStatus)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, Math.max(1, Math.min(200, Number(limit || 20))));
}

function activeSessionSnapshot() {
  return sessionSnapshot(1, 'active')[0] || null;
}

function sessionCounts() {
  return Array.from(workSessions.values()).reduce(
    (counts, session) => {
      counts[session.status] = (counts[session.status] || 0) + 1;
      counts.total += 1;
      return counts;
    },
    { total: 0, active: 0, done: 0, cancelled: 0 },
  );
}

function memoryQueryTokens(value) {
  const text = String(value || '').toLowerCase();
  const tokens = text.match(/[a-z0-9_]+|[\u4e00-\u9fff]{2,}/gi) || [];
  const expanded = [];
  for (const token of tokens) {
    expanded.push(token);
    if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        expanded.push(token.slice(index, index + 2));
      }
    }
  }
  return Array.from(new Set(expanded.filter(Boolean))).slice(0, 40);
}

function memorySearchScore(memory, queryTokens) {
  if (!queryTokens.length) return 1;
  const haystack = `${memory.kind} ${memory.scope} ${memory.text} ${memory.tags.join(' ')}`.toLowerCase();
  return queryTokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function searchMemories(options = {}) {
  const query = String(options.query || '').trim().toLowerCase();
  const scope = String(options.scope || '').trim().toLowerCase();
  const kind = String(options.kind || '').trim();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const queryTokens = memoryQueryTokens(query);
  const results = Array.from(memories.values())
    .filter((memory) => !kind || memory.kind === kind)
    .filter((memory) => !scope || memory.scope.toLowerCase() === scope)
    .map((memory) => ({ memory, score: memorySearchScore(memory, queryTokens) }))
    .filter((item) => !queryTokens.length || item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, limit)
    .map((item) => item.memory);
  return {
    query,
    scope: scope || '',
    kind,
    total: memories.size,
    results,
  };
}

function uniqueMemories(list) {
  const seen = new Set();
  return list.filter((memory) => {
    if (!memory || seen.has(memory.id)) return false;
    seen.add(memory.id);
    return true;
  });
}

function formatMemoriesForPrompt(list = []) {
  return list
    .slice(0, 5)
    .map((memory, index) => {
      const tags = memory.tags.length ? ` tags=${memory.tags.join(',')}` : '';
      const source = memory.source && memory.source !== 'user' ? ` source=${memory.source}` : '';
      return `${index + 1}. [${memory.kind}/${memory.scope}${source}${tags}] ${memory.text}`;
    })
    .join('\n');
}

function memoryContextForTask(task, options = {}) {
  if (options.useMemory === false) {
    return { matches: [], learning: null, prompt: '' };
  }
  const queryMatches = searchMemories({ query: task, limit: Number(options.memoryLimit || 3) }).results;
  const recentPreferences = memorySnapshot(20)
    .filter((memory) => memory.kind === 'preference')
    .slice(0, 2);
  const matches = uniqueMemories([...queryMatches, ...recentPreferences]).slice(0, Number(options.memoryLimit || 5));
  const learningPrompt = learningContextForPrompt();
  const memoryPrompt = matches.length
    ? ['Relevant local memories. User-sourced memories are explicit; learning-sourced memories are inferred local context:', formatMemoriesForPrompt(matches)].join('\n')
    : '';
  return {
    matches,
    learning: learningPrompt ? learningStateSnapshot().profile : null,
    prompt: [learningPrompt, memoryPrompt].filter(Boolean).join('\n\n'),
  };
}

function rememberMemory(options = {}) {
  const text = String(options.text || options.content || '').trim();
  if (!text) throw new Error('Missing memory text.');
  if (Buffer.byteLength(text, 'utf8') > 16000) throw new Error('Memory text is too large.');
  const memory = normalizePersistedMemory({
    id: crypto.randomUUID(),
    kind: options.kind,
    scope: options.scope || 'local',
    text,
    tags: options.tags,
    source: options.source || 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!memory) throw new Error('Memory text is empty.');
  memories.set(memory.id, memory);
  persistMemories();
  appendAudit('memory.created', {
    id: memory.id,
    kind: memory.kind,
    scope: memory.scope,
    tags: memory.tags,
    textLength: memory.text.length,
  });
  return memory;
}

function learningMemoryText(profile) {
  const topApps = (profile.topApps || [])
    .slice(0, 5)
    .map((item) => `${item.name} ${Math.round(Number(item.share || 0) * 100)}%`)
    .join(', ');
  const hosts = (profile.topBrowserHosts || [])
    .slice(0, 5)
    .map((item) => item.host)
    .filter(Boolean)
    .join(', ');
  const hours = (profile.activeHours || [])
    .slice(0, 4)
    .map((item) => `${String(item.hour).padStart(2, '0')}:00`)
    .join(', ');
  return [
    `Inferred local ambient profile from ${profile.sourceEventCount || 0} observation(s).`,
    profile.summary || '',
    profile.signals?.length ? `Signals: ${profile.signals.join('; ')}` : '',
    topApps ? `Frequent apps: ${topApps}.` : '',
    hosts ? `Frequent browser hosts: ${hosts}.` : '',
    hours ? `Common active hours: ${hours}.` : '',
    'Treat this as lightweight inferred context, not a user-confirmed preference.',
  ].filter(Boolean).join('\n');
}

function upsertLearningProfileMemory(profile, source = 'learning_memory') {
  if (!profile?.sourceEventCount) throw new Error('No learning profile is available yet.');
  const text = learningMemoryText(profile);
  const existing = Array.from(memories.values()).find((memory) => (
    memory.source === 'learning' && memory.tags.includes('ambient-profile')
  ));
  const next = normalizePersistedMemory({
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    kind: 'note',
    scope: 'ambient',
    text,
    tags: ['ambient-profile', 'learning', 'inferred'],
    source: 'learning',
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  if (!next) throw new Error('Learning memory is empty.');
  memories.set(next.id, next);
  persistMemories();
  appendAudit('learning.memory_upserted', {
    id: next.id,
    source: String(source || 'learning_memory').slice(0, 80),
    sourceEventCount: profile.sourceEventCount,
    textLength: next.text.length,
  });
  return next;
}

function rememberLearningProfile(options = {}) {
  const force = options.force !== false;
  const learning = distillAmbientLearning({ source: options.source || 'learning_memory', force });
  const profile = learning.profile || learningStateSnapshot().profile;
  const memory = upsertLearningProfileMemory(profile, options.source || 'learning_memory');
  return {
    ok: true,
    memory,
    learning,
  };
}

function removeMemory(id) {
  const memoryId = String(id || '').trim();
  const existing = memories.get(memoryId);
  if (!existing) return null;
  memories.delete(memoryId);
  persistMemories();
  appendAudit('memory.removed', {
    id: existing.id,
    kind: existing.kind,
    scope: existing.scope,
  });
  return existing;
}

function createInboxItem(options = {}) {
  const fromClipboard = Boolean(options.fromClipboard);
  const clipboardText = fromClipboard ? clipboard.readText() || '' : '';
  const body = String(options.body || options.text || clipboardText || '').trim();
  const title = String(options.title || body.split('\n').find(Boolean) || '').trim();
  if (!body && !title) throw new Error('Missing inbox item text.');
  if (Buffer.byteLength(body, 'utf8') > 20000) throw new Error('Inbox item text is too large.');

  const item = normalizePersistedInboxItem({
    id: crypto.randomUUID(),
    title,
    body,
    status: 'open',
    priority: options.priority,
    source: options.source || (fromClipboard ? 'clipboard' : 'api'),
    tags: options.tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!item) throw new Error('Inbox item text is empty.');
  inboxItems.set(item.id, item);
  persistInbox();
  appendAudit('inbox.created', {
    id: item.id,
    source: item.source,
    priority: item.priority,
    title: item.title,
    bodyLength: item.body.length,
  });
  recordActiveSessionEvent('inbox_created', `Inbox captured: ${compactRecordText(item.title, 120)}`, item.source || 'inbox', {
    kind: 'inbox',
    id: item.id,
    status: item.status,
  });
  updateMenuBarMenu();
  return item;
}

function setInboxItem(id, patch = {}) {
  const itemId = String(id || '').trim();
  const existing = inboxItems.get(itemId);
  if (!existing) return null;
  const status = patch.status || existing.status;
  const next = normalizePersistedInboxItem({
    ...existing,
    ...patch,
    status,
    updatedAt: Date.now(),
    completedAt:
      (status === 'done' || status === 'cancelled')
        ? Number(patch.completedAt || existing.completedAt || Date.now())
        : 0,
  });
  if (!next) return null;
  inboxItems.set(itemId, next);
  persistInbox();
  appendAudit('inbox.updated', {
    id: next.id,
    status: next.status,
    priority: next.priority,
    title: next.title,
  });
  updateMenuBarMenu();
  return next;
}

function removeInboxItem(id) {
  const itemId = String(id || '').trim();
  const existing = inboxItems.get(itemId);
  if (!existing) return null;
  inboxItems.delete(itemId);
  persistInbox();
  appendAudit('inbox.removed', {
    id: existing.id,
    status: existing.status,
    title: existing.title,
  });
  updateMenuBarMenu();
  return existing;
}

function findInboxItemForAction(id) {
  const requestedId = String(id || '').trim();
  if (requestedId) return inboxItems.get(requestedId) || null;
  return inboxSnapshot(1, 'open')[0] || null;
}

function inboxTaskPrompt(item, instruction = '') {
  return [
    `Inbox item: ${item.title}`,
    item.body && item.body !== item.title ? `Details:\n${item.body}` : '',
    instruction ? `Instruction:\n${instruction}` : '',
    `Source: ${item.source}`,
    item.tags?.length ? `Tags: ${item.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function inboxItemAgeLabel(item) {
  return progressAgeLabel(item.updatedAt || item.createdAt);
}

function triageInbox(options = {}) {
  const limit = Math.max(1, Math.min(30, Number(options.limit || 12)));
  const items = inboxSnapshot(limit, 'open')
    .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const triaged = items.map((item, index) => {
    const task = inboxTaskPrompt(item, String(options.instruction || '').trim());
    const decision = routeTaskDecision(task, { execute: false, mode: options.mode || options.lane });
    const age = inboxItemAgeLabel(item);
    const summary = `${index + 1}. P${item.priority} · ${item.title} · ${age} · 建议 ${decision.label}`;
    return {
      id: item.id,
      title: item.title,
      body: item.body,
      priority: item.priority,
      source: item.source,
      tags: item.tags,
      age,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      decision: {
        lane: decision.lane,
        mode: decision.mode,
        label: decision.label,
        reason: decision.reason,
        confidence: decision.confidence,
      },
      summary,
    };
  });
  const counts = inboxCounts();
  const output = triaged.length
    ? [
        `Inbox 有 ${counts.open} 个 open item。`,
        triaged.slice(0, 8).map((item) => `${item.summary}\n   ${compactRecordText(item.decision.reason, 110)}`).join('\n'),
        `建议先处理: ${triaged[0].title}。`,
      ].join('\n')
    : `Inbox 为空。共 ${counts.total} 条，open ${counts.open} 条。`;

  appendAudit('inbox.triaged', {
    open: counts.open,
    returned: triaged.length,
    source: String(options.source || 'api').slice(0, 80),
  });

  return {
    ok: true,
    output,
    counts,
    items: triaged,
    next: triaged[0] || null,
  };
}

async function routeInboxItem(options = {}) {
  const item = findInboxItemForAction(options.id || options.inboxId);
  if (!item) {
    return { ok: false, status: 404, output: 'Inbox item not found.', inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') } };
  }
  if (item.status !== 'open' && options.allowClosed !== true) {
    return {
      ok: false,
      status: 409,
      item,
      output: `Inbox item is already ${item.status}.`,
      inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') },
    };
  }

  const execute = options.execute !== false;
  const task = inboxTaskPrompt(item, String(options.instruction || '').trim());
  const route = await routeTask({
    message: task,
    execute,
    includeScreen: Boolean(options.includeScreen),
    useMemory: options.useMemory !== false,
    memoryLimit: options.memoryLimit,
    mode: options.mode || options.lane,
    source: options.source || 'inbox',
    scope: options.scope || `inbox:${item.id}`,
    parallelGroup: options.parallelGroup || options.group || 'inbox',
  });
  const routeMeta = {
    lane: route.decision?.lane || '',
    label: route.decision?.label || '',
    queued: Boolean(route.queued),
    jobId: route.job?.id || '',
    output: route.output || '',
    routedAt: Date.now(),
  };

  let nextItem = item;
  if (execute && route.ok) {
    nextItem = setInboxItem(item.id, {
      status: 'done',
      completedAt: Date.now(),
      route: routeMeta,
    }) || item;
  }

  appendAudit('inbox.routed', {
    id: item.id,
    execute,
    ok: route.ok,
    lane: route.decision?.lane || '',
    queued: Boolean(route.queued),
    jobId: route.job?.id || '',
  });
  recordActiveSessionEvent(
    execute ? 'inbox_routed' : 'inbox_route_preview',
    `Inbox ${execute ? 'routed' : 'checked'} via ${route.decision?.label || route.decision?.lane || 'router'}: ${compactRecordText(item.title, 120)}`,
    'inbox',
    {
      kind: 'inbox',
      id: nextItem.id,
      status: nextItem.status,
    },
  );

  return {
    ok: Boolean(route.ok),
    item: nextItem,
    task,
    route,
    inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') },
    output: route.output,
  };
}

async function processNextInbox(options = {}) {
  const triage = triageInbox({
    ...(options || {}),
    source: options.source || 'process_next',
  });
  const selected = triage.next;
  if (!selected) {
    return {
      ok: false,
      status: 404,
      output: 'Inbox 为空，没有可处理的下一项。',
      triage,
      inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') },
    };
  }

  const result = await routeInboxItem({
    id: selected.id,
    instruction: options.instruction,
    execute: options.execute !== false,
    includeScreen: Boolean(options.includeScreen),
    mode: options.mode || options.lane,
    useMemory: options.useMemory,
    memoryLimit: options.memoryLimit,
  });
  const decision = result.route?.decision;
  const output = [
    `处理下一项 Inbox: ${selected.title}`,
    decision ? `分工: ${decision.label} · ${compactRecordText(decision.reason, 140)}` : '',
    result.route?.queued && result.route?.job ? `已进入后台队列: ${result.route.job.id}` : '',
    result.output ? compactRecordText(result.output, 1200) : '',
  ]
    .filter(Boolean)
    .join('\n');

  appendAudit('inbox.process_next', {
    id: selected.id,
    ok: Boolean(result.ok),
    execute: options.execute !== false,
    lane: decision?.lane || '',
    queued: Boolean(result.route?.queued),
    jobId: result.route?.job?.id || '',
    source: String(options.source || 'api').slice(0, 80),
  });

  return {
    ok: Boolean(result.ok),
    status: result.status || (result.ok ? 200 : 500),
    output,
    selected,
    item: result.item,
    triage,
    route: result.route,
    inbox: result.inbox,
  };
}

function createSessionSummary(session) {
  const durationMs = (session.completedAt || Date.now()) - session.createdAt;
  const minutes = Math.max(0, Math.round(durationMs / 60000));
  const eventLines = session.events
    .slice(-8)
    .map((event, index) => `${index + 1}. [${event.type}] ${event.text}`)
    .join('\n');
  return [
    `${session.title} · ${minutes} min · ${session.events.length} event(s).`,
    session.goal ? `Goal: ${session.goal}` : '',
    eventLines ? `Recent events:\n${eventLines}` : 'No session events were recorded.',
  ]
    .filter(Boolean)
    .join('\n');
}

function sessionCheckIn(options = {}) {
  const limit = Math.max(1, Math.min(8, Number(options.limit || 4)));
  const active = activeSessionSnapshot();
  const counts = sessionCounts();
  const briefing = workflowBriefing({
    workflowLimit: options.workflowLimit || 4,
    jobLimit: options.jobLimit || 4,
  });
  const recentEvents = active ? active.events.slice(-limit) : [];
  const eventLines = recentEvents.map((event, index) => {
    const ref = event.ref?.kind && event.ref?.status ? ` · ${event.ref.kind}:${event.ref.status}` : '';
    return `${index + 1}. ${event.type}${ref}: ${compactRecordText(event.text, 150)}`;
  });
  const nextActions = (briefing.nextActions || []).slice(0, 3);
  const nextLines = nextActions.map((action, index) => `${index + 1}. ${action.label}: ${compactRecordText(action.summary, 150)}`);
  const routingLines = (briefing.routingLedger || [])
    .slice(0, 4)
    .map((entry, index) => `${index + 1}. ${entry.lane}/${entry.status} · ${entry.owner} · ${compactRecordText(entry.taskTitle, 110)}${entry.blocker ? ` · blocker: ${compactRecordText(entry.blocker, 90)}` : ''}${entry.nextAction ? ` · next: ${compactRecordText(entry.nextAction, 100)}` : ''}`);
  const output = active
    ? [
        `当前会话: ${active.title}`,
        active.goal && active.goal !== active.title ? `目标: ${compactRecordText(active.goal, 180)}` : '',
        `已经记录 ${active.events.length} 个事件。`,
        eventLines.length ? `最近进展:\n${eventLines.join('\n')}` : '最近还没有新事件。',
        routingLines.length ? `分流中的工作:\n${routingLines.join('\n')}` : '',
        nextLines.length ? `下一步:\n${nextLines.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `当前没有 active session。历史 session 共 ${counts.total} 个。`,
        briefing.summary,
        routingLines.length ? `分流中的工作:\n${routingLines.join('\n')}` : '',
        nextLines.length ? `下一步:\n${nextLines.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');

  appendAudit('session.check_in', {
    activeSessionId: active?.id || '',
    events: active?.events.length || 0,
    nextActions: nextActions.length,
    source: String(options.source || 'api').slice(0, 80),
  });

  return {
    ok: true,
    output,
    active,
    counts,
    recentEvents,
    nextActions,
    briefing,
  };
}

function findSessionForResume(id = '') {
  const requestedId = String(id || '').trim();
  if (requestedId) {
    const session = workSessions.get(requestedId) || null;
    return session && session.status !== 'active' ? session : null;
  }
  return Array.from(workSessions.values())
    .filter((session) => session.status !== 'active')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
}

function startWorkSession(options = {}) {
  const goal = String(options.goal || options.title || '').trim();
  if (!goal) throw new Error('Missing session goal.');
  const existing = activeSessionSnapshot();
  if (existing && options.replace !== true) {
    throw new Error(`A work session is already active: ${existing.title}`);
  }
  if (existing && options.replace === true) {
    endWorkSession(existing.id, { status: 'cancelled', note: 'Replaced by a new session.' });
  }
  const session = normalizePersistedSession({
    id: crypto.randomUUID(),
    title: String(options.title || goal).trim(),
    goal,
    status: 'active',
    source: options.source || 'api',
    tags: options.tags,
    events: [
      {
        id: crypto.randomUUID(),
        type: 'start',
        text: goal,
        source: options.source || 'api',
        createdAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!session) throw new Error('Session goal is empty.');
  workSessions.set(session.id, session);
  persistSessions();
  appendAudit('session.started', { id: session.id, title: session.title, source: session.source });
  updateMenuBarMenu();
  return session;
}

function resumeWorkSession(options = {}) {
  const previous = findSessionForResume(options.id || options.sessionId);
  if (!previous) throw new Error('No completed work session is available to resume.');
  const existing = activeSessionSnapshot();
  if (existing && options.replace !== true) {
    throw new Error(`A work session is already active: ${existing.title}`);
  }

  const source = options.source || 'api';
  const goal = String(options.goal || previous.goal || previous.title || '').trim();
  const session = startWorkSession({
    goal,
    title: String(options.title || previous.title || goal).trim(),
    tags: previous.tags,
    source,
    replace: Boolean(options.replace),
  });
  const previousSummary = previous.summary || createSessionSummary(previous);
  const eventText = [
    `Resumed from previous session: ${previous.title}`,
    previousSummary ? `Previous summary:\n${previousSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const result = addWorkSessionEvent(session.id, {
    type: 'resume',
    text: eventText,
    source,
    ref: {
      kind: 'session',
      id: previous.id,
      status: previous.status,
    },
  });
  appendAudit('session.resumed', {
    id: result.session.id,
    previousId: previous.id,
    source: String(source).slice(0, 80),
  });
  return {
    ok: true,
    session: result.session,
    previous,
    event: result.event,
    checkIn: sessionCheckIn({ source }),
  };
}

function addWorkSessionEvent(id, options = {}) {
  const sessionId = String(id || '').trim();
  const session = sessionId ? workSessions.get(sessionId) : activeSessionSnapshot();
  if (!session) throw new Error('No active work session.');
  if (session.status !== 'active' && options.allowClosed !== true) {
    throw new Error(`Session is already ${session.status}.`);
  }
  const text = String(options.text || options.body || '').trim();
  if (!text) throw new Error('Missing session event text.');
  const ref = normalizeSessionEventRef(options.ref);
  const event = {
    id: crypto.randomUUID(),
    type: String(options.type || 'note').slice(0, 40),
    text: text.slice(0, 4000),
    source: String(options.source || 'api').slice(0, 80),
    ref,
    createdAt: Date.now(),
  };
  const next = normalizePersistedSession({
    ...session,
    events: [...session.events, event].slice(-200),
    updatedAt: Date.now(),
  });
  workSessions.set(next.id, next);
  persistSessions();
  appendAudit('session.event', {
    id: next.id,
    type: event.type,
    source: event.source,
    ref: event.ref,
    textLength: event.text.length,
  });
  updateMenuBarMenu();
  return { session: next, event };
}

function recordActiveSessionEvent(type, text, source = 'system', ref = null) {
  const session = activeSessionSnapshot();
  if (!session) return null;
  try {
    return addWorkSessionEvent(session.id, {
      type,
      text,
      source,
      ref,
    });
  } catch (error) {
    appendAudit('session.auto_event_failed', {
      type: String(type || '').slice(0, 40),
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function endWorkSession(id, options = {}) {
  const sessionId = String(id || '').trim();
  const session = sessionId ? workSessions.get(sessionId) : activeSessionSnapshot();
  if (!session) throw new Error('No active work session.');
  if (session.status !== 'active') return session;
  let next = session;
  const note = String(options.note || '').trim();
  if (note) {
    next = addWorkSessionEvent(session.id, {
      type: 'end_note',
      text: note,
      source: options.source || 'api',
    }).session;
  }
  const status = options.status === 'cancelled' ? 'cancelled' : 'done';
  const completedAt = Date.now();
  const summary = String(options.summary || createSessionSummary({ ...next, status, completedAt })).slice(0, 8000);
  const ended = normalizePersistedSession({
    ...next,
    status,
    summary,
    completedAt,
    updatedAt: completedAt,
  });
  workSessions.set(ended.id, ended);
  persistSessions();
  appendAudit('session.ended', { id: ended.id, status: ended.status, events: ended.events.length });
  notifyResident('JAVIS session ended', ended.summary, { type: 'session', id: ended.id, status: ended.status });
  updateMenuBarMenu();
  return ended;
}

function removeWorkSession(id) {
  const sessionId = String(id || '').trim();
  const session = workSessions.get(sessionId);
  if (!session) return null;
  workSessions.delete(sessionId);
  persistSessions();
  appendAudit('session.removed', { id: session.id, status: session.status, title: session.title });
  updateMenuBarMenu();
  return session;
}

function setApproval(id, patch) {
  const existing = approvals.get(id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  approvals.set(id, next);
  persistApprovals();
  appendAudit('approval.status', {
    id,
    action: next.action,
    riskLevel: next.riskLevel,
    status: next.status,
  });
  if (patch.status && patch.status !== existing.status) {
  recordActiveSessionEvent('approval_status', `Approval ${next.status}: ${compactRecordText(next.summary, 120)}`, 'approval', {
      kind: 'approval',
      id: next.id,
      status: next.status,
    });
  }
  return next;
}

function createActionApproval(plan, reason, continuation = null) {
  const id = crypto.randomUUID();
  const approval = {
    id,
    action: plan.action,
    riskLevel: plan.riskLevel,
    reason,
    summary: plan.summary,
    args: plan.args,
    continuation: normalizeApprovalContinuation(continuation),
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: '',
  };
  approvals.set(id, approval);
  persistApprovals();
  appendAudit('approval.created', {
    id,
    action: approval.action,
    riskLevel: approval.riskLevel,
    reason,
    summary: approval.summary,
    hasContinuation: Boolean(approval.continuation),
  });
  recordActiveSessionEvent('approval_created', `Approval needed: ${compactRecordText(approval.summary, 120)}`, 'approval', {
    kind: 'approval',
    id: approval.id,
    status: approval.status,
  });
  notifyResident('JAVIS approval needed', approval.summary, {
    type: 'approval',
    id: approval.id,
    action: approval.action,
    riskLevel: approval.riskLevel,
  });
  return approval;
}

function readRecentAudit(limit = 80) {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(200, limit))).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, type: 'audit.parse_failed', data: { line } };
    }
  });
}

function commandExists(command) {
  const raw = String(command || '').trim();
  if (!raw) return false;
  const executable = raw.split(/\s+/)[0];
  if (executable.includes(path.sep)) {
    return fs.existsSync(executable);
  }
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => fs.existsSync(path.join(dir, executable)));
}

function residentDomain() {
  const uid = process.getuid?.();
  return uid === undefined ? '' : `gui/${uid}`;
}

function residentServiceTarget() {
  const domain = residentDomain();
  return domain ? `${domain}/${LAUNCH_AGENT_LABEL}` : '';
}

function residentPlistContent() {
  const command = `cd ${shQuote(process.cwd())} && npm run start:desktop`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(process.cwd())}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(RESIDENT_OUT_LOG)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(RESIDENT_ERR_LOG)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}</string>
  </dict>
</dict>
</plist>
`;
}

async function residentLaunchctlState() {
  const target = residentServiceTarget();
  if (!target) return { available: false, loaded: false, raw: '', pid: null, error: 'launchctl_domain_unavailable' };
  try {
    const { stdout } = await execFileAsync('launchctl', ['print', target], { timeout: 3000, maxBuffer: 1024 * 512 });
    const text = String(stdout || '');
    const pid = Number(text.match(/\bpid\s*=\s*(\d+)/)?.[1] || 0) || null;
    return { available: true, loaded: true, raw: text.slice(0, 2000), pid, error: '' };
  } catch (error) {
    return { available: true, loaded: false, raw: '', pid: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function residentStatusSnapshot() {
  const launchctl = await residentLaunchctlState();
  const installed = fs.existsSync(LAUNCH_AGENT_FILE);
  const plist = installed ? fs.readFileSync(LAUNCH_AGENT_FILE, 'utf8') : '';
  const expectedCommand = `cd ${shQuote(process.cwd())} && npm run start:desktop`;
  return {
    label: LAUNCH_AGENT_LABEL,
    installed,
    loaded: launchctl.loaded,
    pid: launchctl.pid,
    plistPath: LAUNCH_AGENT_FILE,
    outLog: RESIDENT_OUT_LOG,
    errLog: RESIDENT_ERR_LOG,
    target: residentServiceTarget(),
    matchesProject: installed ? plist.includes(xmlEscape(process.cwd())) || plist.includes(process.cwd()) : false,
    expectedCommand,
    launchctlError: launchctl.loaded ? '' : launchctl.error,
  };
}

async function installResidentAgent() {
  const distIndex = path.join(process.cwd(), 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('Built renderer is missing. Run npm run build before installing resident mode.');
  }
  fs.mkdirSync(path.dirname(LAUNCH_AGENT_FILE), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
  fs.writeFileSync(LAUNCH_AGENT_FILE, residentPlistContent(), 'utf8');
  appendAudit('resident.installed', { plistPath: LAUNCH_AGENT_FILE, startNow: false });
  return residentStatusSnapshot();
}

async function uninstallResidentAgent() {
  const target = residentServiceTarget();
  if (target) {
    try {
      await execFileAsync('launchctl', ['bootout', residentDomain(), LAUNCH_AGENT_FILE], { timeout: 5000 });
    } catch {
      // It is fine if the agent is not currently loaded.
    }
    try {
      await execFileAsync('launchctl', ['disable', target], { timeout: 3000 });
    } catch {
      // It is fine if the agent was never enabled.
    }
  }
  if (fs.existsSync(LAUNCH_AGENT_FILE)) fs.unlinkSync(LAUNCH_AGENT_FILE);
  appendAudit('resident.uninstalled', { plistPath: LAUNCH_AGENT_FILE });
  return residentStatusSnapshot();
}

function hashSafetyIdentifier() {
  const raw = `${os.userInfo().username}:javis-local-agent`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function clipboardSnapshot(includeText = false) {
  const text = clipboard.readText() || '';
  const maxPreview = 220;
  return {
    hasText: text.length > 0,
    length: text.length,
    preview: text ? text.slice(0, maxPreview) : '',
    text: includeText ? text : undefined,
    truncated: text.length > maxPreview,
  };
}

function appleScriptString(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function frontmostAppSnapshot() {
  if (process.platform !== 'darwin') {
    return { available: false, app: '', windowTitle: '', error: 'frontmost_app_is_macos_only' };
  }

  const script = [
    'tell application "System Events"',
    '  set frontApp to name of first application process whose frontmost is true',
    '  set windowTitle to ""',
    '  try',
    '    tell process frontApp',
    '      set windowTitle to name of front window',
    '    end tell',
    '  end try',
    'end tell',
    'return frontApp & linefeed & windowTitle',
  ].join('\n');

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2000 });
    const [appName = '', ...titleParts] = String(stdout || '').trimEnd().split(/\r?\n/);
    return {
      available: true,
      app: appName,
      windowTitle: titleParts.join('\n'),
      error: '',
    };
  } catch (error) {
    return {
      available: false,
      app: '',
      windowTitle: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const CHROMIUM_BROWSER_APPS = new Set([
  'Arc',
  'Brave Browser',
  'Chromium',
  'Comet',
  'Dia',
  'Google Chrome',
  'Google Chrome Canary',
  'Microsoft Edge',
  'Opera',
  'Vivaldi',
]);

const SAFARI_BROWSER_APPS = new Set(['Safari', 'Safari Technology Preview']);
const BROWSER_APP_ORDER = [
  'Google Chrome',
  'Arc',
  'Comet',
  'Brave Browser',
  'Safari',
  'Microsoft Edge',
  'Dia',
  'Chromium',
  'Google Chrome Canary',
  'Safari Technology Preview',
  'Opera',
  'Vivaldi',
];

function isSupportedBrowserApp(appName) {
  return SAFARI_BROWSER_APPS.has(appName) || CHROMIUM_BROWSER_APPS.has(appName);
}

async function runningApplicationNames() {
  if (process.platform !== 'darwin') return [];
  const script = [
    'tell application "System Events"',
    '  set appNames to name of application processes',
    'end tell',
    'set AppleScript\'s text item delimiters to linefeed',
    'return appNames as text',
  ].join('\n');
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2000 });
    return String(stdout || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function browserAppCandidates(runningNames = [], preferredApp = '') {
  const running = new Set(runningNames);
  const candidates = [];
  const add = (appName) => {
    const name = String(appName || '').trim();
    if (!name || !isSupportedBrowserApp(name) || candidates.includes(name)) return;
    if (preferredApp && name === preferredApp) {
      candidates.push(name);
      return;
    }
    if (running.has(name)) candidates.push(name);
  };
  add(preferredApp);
  for (const appName of BROWSER_APP_ORDER) add(appName);
  for (const appName of runningNames) add(appName);
  return candidates;
}

async function readBrowserContextForApp(appName, source = 'requested') {
  const isSafari = SAFARI_BROWSER_APPS.has(appName);
  const isChromium = CHROMIUM_BROWSER_APPS.has(appName);

  if (!appName || (!isSafari && !isChromium)) {
    return {
      available: false,
      supported: false,
      app: appName,
      title: '',
      url: '',
      source,
      error: appName ? 'frontmost_app_is_not_supported_browser' : 'no_frontmost_app',
    };
  }

  const quotedApp = appleScriptString(appName);
  const script = isSafari
    ? [
        `tell application ${quotedApp}`,
        '  if not (exists front document) then error "No front document"',
        '  set pageUrl to URL of front document',
        '  set pageTitle to name of front document',
        'end tell',
        'return pageTitle & linefeed & pageUrl',
      ].join('\n')
    : [
        `tell application ${quotedApp}`,
        '  if not (exists front window) then error "No front window"',
        '  set pageUrl to URL of active tab of front window',
        '  set pageTitle to title of active tab of front window',
        'end tell',
        'return pageTitle & linefeed & pageUrl',
      ].join('\n');

  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2500 });
    const [title = '', ...urlParts] = String(stdout || '').trimEnd().split(/\r?\n/);
    const url = urlParts.join('\n');
    return {
      available: Boolean(url || title),
      supported: true,
      app: appName,
      title,
      url,
      source,
      error: '',
    };
  } catch (error) {
    return {
      available: false,
      supported: true,
      app: appName,
      title: '',
      url: '',
      source,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function browserContextSnapshot(options = {}) {
  const frontmost = options.frontmost || await frontmostAppSnapshot();
  const requestedApp = String(options.app || '').trim();
  if (requestedApp) return readBrowserContextForApp(requestedApp, 'requested');

  let frontmostResult = null;
  if (frontmost.app && isSupportedBrowserApp(frontmost.app)) {
    frontmostResult = await readBrowserContextForApp(frontmost.app, 'frontmost');
    if (frontmostResult.available) return frontmostResult;
  }

  const runningNames = await runningApplicationNames();
  for (const appName of browserAppCandidates(runningNames, frontmost.app)) {
    if (appName === frontmost.app && frontmostResult) continue;
    const result = await readBrowserContextForApp(appName, 'auto');
    if (result.available) {
      appendAudit('browser_context.auto_selected', {
        app: result.app,
        title: result.title,
        url: result.url,
        frontmost: frontmost.app || '',
      });
      return result;
    }
  }

  return frontmostResult || {
    available: false,
    supported: false,
    app: frontmost.app || '',
    title: '',
    url: '',
    source: 'auto',
    error: frontmost.app ? 'frontmost_app_is_not_supported_browser' : 'no_supported_browser_page',
  };
}

function normalizeAccessibilityTreeOptions(options = {}) {
  const policy = actionPolicy.allow?.read_accessibility_tree || DEFAULT_ACTION_POLICY.allow.read_accessibility_tree;
  return {
    maxNodes: Math.max(10, Math.min(policy.maxNodes || 120, Number(options.maxNodes || policy.maxNodes || 120))),
    maxDepth: Math.max(1, Math.min(policy.maxDepth || 6, Number(options.maxDepth || policy.maxDepth || 6))),
  };
}

function compactAccessibilityLabel(node = {}) {
  return [node.name, node.description, node.value, node.placeholder, node.title, node.domIdentifier, node.domRole]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .find(Boolean) || '';
}

function accessibilityTreeOutline(tree, limit = 40) {
  return (tree.nodes || [])
    .slice(0, limit)
    .map((node) => {
      const indent = '  '.repeat(Math.min(8, Number(node.depth || 0)));
      const label = compactAccessibilityLabel(node);
      const enabled = node.enabled === false ? ' disabled' : '';
      return `${indent}${node.id} ${node.role || 'AXElement'}${enabled}${label ? ` "${label}"` : ''}`;
    })
    .join('\n');
}

async function accessibilityTreeSnapshot(options = {}) {
  const policy = actionPolicy.allow?.read_accessibility_tree;
  const { maxNodes, maxDepth } = normalizeAccessibilityTreeOptions(options);
  const accessibilityTrusted =
    typeof systemPreferences?.isTrustedAccessibilityClient === 'function'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : null;

  if (!policy?.enabled) {
    return {
      available: false,
      app: '',
      windowTitle: '',
      accessibilityTrusted,
      nodes: [],
      nodeCount: 0,
      truncated: false,
      maxNodes,
      maxDepth,
      outline: '',
      error: 'read_accessibility_tree_disabled_by_policy',
    };
  }

  if (process.platform !== 'darwin') {
    return {
      available: false,
      app: '',
      windowTitle: '',
      accessibilityTrusted,
      nodes: [],
      nodeCount: 0,
      truncated: false,
      maxNodes,
      maxDepth,
      outline: '',
      error: 'accessibility_tree_is_macos_only',
    };
  }

  if (accessibilityTrusted === false) {
    return {
      available: false,
      app: '',
      windowTitle: '',
      accessibilityTrusted,
      nodes: [],
      nodeCount: 0,
      truncated: false,
      maxNodes,
      maxDepth,
      outline: '',
      error: 'accessibility_permission_not_granted',
    };
  }

  const script = `
const maxNodes = ${JSON.stringify(maxNodes)};
const maxDepth = ${JSON.stringify(maxDepth)};
const systemEvents = Application('System Events');

function readProp(element, name) {
  try {
    const value = element[name]();
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\\t\\r\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

function readAttribute(element, name) {
  try {
    const value = element.attributes.byName(name).value();
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map((item) => String(item)).join(' ');
    return String(value).replace(/[\\t\\r\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

function writeAttribute(element, name, value) {
  try {
    const attribute = element.attributes.byName(name);
    if (attribute.value && attribute.value.set) {
      attribute.value.set(value);
      return true;
    }
    attribute.value = value;
    return true;
  } catch (_) {
    return false;
  }
}

function readBool(element, name) {
  try {
    const value = element[name]();
    if (value === true) return true;
    if (value === false) return false;
    return null;
  } catch (_) {
    return null;
  }
}

function readPair(element, name) {
  const value = readProp(element, name);
  if (!value) return null;
  const parts = value.split(',').map((part) => Number(String(part).trim()));
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null;
  return { x: parts[0], y: parts[1] };
}

function childrenOf(element) {
  try {
    return element.uiElements();
  } catch (_) {
    return [];
  }
}

function nodeLabel(node) {
  return [node.name, node.description, node.value, node.placeholder, node.title, node.domIdentifier, node.domRole].filter(Boolean)[0] || '';
}

function isChromiumApp(name) {
  return /Google Chrome|Chrome Canary|Chromium|Brave Browser|Microsoft Edge|Arc|Comet/i.test(String(name || ''));
}

function readNode(element, depth, parentId, childCount) {
  const id = String(nodes.length + 1);
  const node = {
    id,
    parentId,
    depth,
    role: readProp(element, 'role'),
    subrole: readProp(element, 'subrole'),
    roleDescription: readProp(element, 'roleDescription'),
    name: readProp(element, 'name'),
    description: readProp(element, 'description'),
    value: readProp(element, 'value'),
    placeholder: readAttribute(element, 'AXPlaceholderValue'),
    title: readAttribute(element, 'AXTitle'),
    domIdentifier: readAttribute(element, 'AXDOMIdentifier'),
    domClassList: readAttribute(element, 'AXDOMClassList'),
    domRole: readAttribute(element, 'AXDOMRole'),
    editable: readAttribute(element, 'AXEditable'),
    focused: readAttribute(element, 'AXFocused'),
    enabled: readBool(element, 'enabled'),
    position: readPair(element, 'position'),
    size: readPair(element, 'size'),
    childCount,
  };
  node.label = nodeLabel(node);
  return node;
}

const processes = systemEvents.applicationProcesses.whose({ frontmost: true })();
if (!processes.length) {
  JSON.stringify({ available: false, app: '', windowTitle: '', nodes: [], nodeCount: 0, truncated: false, maxNodes, maxDepth, error: 'no_frontmost_app' });
} else {
  const process = processes[0];
  const appName = readProp(process, 'name');
  let chromiumAccessibilityActivated = false;
  if (isChromiumApp(appName)) {
    chromiumAccessibilityActivated =
      writeAttribute(process, 'AXManualAccessibility', true)
      || writeAttribute(process, 'AXEnhancedUserInterface', true);
  }
  const windows = process.windows();
  let root = null;
  for (const window of windows) {
    const children = childrenOf(window);
    if (readProp(window, 'subrole') === 'AXStandardWindow' && children.length) {
      root = window;
      break;
    }
  }
  if (!root) {
    root = windows.find((window) => childrenOf(window).length) || windows[0] || process;
  }

  var nodes = [];
  function walk(element, depth, parentId) {
    if (nodes.length >= maxNodes) return;
    const children = childrenOf(element);
    const node = readNode(element, depth, parentId, children.length);
    nodes.push(node);
    if (depth >= maxDepth) return;
    for (const child of children) {
      if (nodes.length >= maxNodes) break;
      walk(child, depth + 1, node.id);
    }
  }

  walk(root, 0, '');
  JSON.stringify({
    available: nodes.length > 0,
    app: readProp(process, 'name'),
    windowTitle: readProp(root, 'name'),
    rootRole: readProp(root, 'role'),
    rootSubrole: readProp(root, 'subrole'),
    nodeCount: nodes.length,
    truncated: nodes.length >= maxNodes,
    maxNodes,
    maxDepth,
    nodes,
    chromiumAccessibilityActivated,
    error: '',
    generatedAt: new Date().toISOString(),
  });
}
`;

  try {
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 12000, maxBuffer: 3_000_000 });
    const tree = JSON.parse(String(stdout || '{}'));
    const result = {
      accessibilityTrusted,
      ...tree,
      outline: accessibilityTreeOutline(tree),
    };
    latestAccessibilityTree = {
      tree: result,
      cachedAt: Date.now(),
    };
    appendAudit('accessibility_tree.read', {
      app: result.app,
      windowTitle: result.windowTitle,
      nodeCount: result.nodeCount,
      truncated: result.truncated,
      maxDepth,
      maxNodes,
    });
    return result;
  } catch (error) {
    const result = {
      available: false,
      app: '',
      windowTitle: '',
      accessibilityTrusted,
      nodes: [],
      nodeCount: 0,
      truncated: false,
      maxNodes,
      maxDepth,
      outline: '',
      error: error?.killed
        ? 'accessibility_tree_read_timeout'
        : String(error?.stderr || (error instanceof Error ? error.message : error)).split('\n')[0].slice(0, 500),
    };
    latestAccessibilityTree = {
      tree: result,
      cachedAt: Date.now(),
    };
    return result;
  }
}

function cachedAccessibilityTreeSnapshot(options = {}) {
  const { maxNodes, maxDepth } = normalizeAccessibilityTreeOptions(options);
  const maxAgeMs = Math.max(0, Math.min(60000, Number(options.maxAgeMs ?? 6000)));
  if (options.useCache !== false && latestAccessibilityTree?.tree && Date.now() - latestAccessibilityTree.cachedAt <= maxAgeMs) {
    const tree = latestAccessibilityTree.tree;
    if (Number(tree.maxNodes || 0) >= maxNodes && Number(tree.maxDepth || 0) >= maxDepth) {
      return Promise.resolve({
        ...tree,
        cached: true,
        cacheAgeMs: Date.now() - latestAccessibilityTree.cachedAt,
      });
    }
  }
  return accessibilityTreeSnapshot({ ...options, maxNodes, maxDepth });
}

const ACTIONABLE_AX_ROLES = new Set([
  'AXButton',
  'AXCheckBox',
  'AXComboBox',
  'AXLink',
  'AXMenuButton',
  'AXMenuItem',
  'AXPopUpButton',
  'AXRadioButton',
  'AXSearchField',
  'AXTab',
  'AXTextArea',
  'AXTextField',
]);

function accessibilityNodeSearchText(node) {
  return [
    node.role,
    node.subrole,
    node.roleDescription,
    node.name,
    node.description,
    node.value,
    node.placeholder,
    node.title,
    node.domIdentifier,
    node.domClassList,
    node.domRole,
    node.editable,
    node.focused,
  ]
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function accessibilityInstructionTokens(instruction) {
  return Array.from(
    new Set(
      String(instruction || '')
        .toLowerCase()
        .split(/[^a-z0-9_\u4e00-\u9fff]+/u)
        .map((token) => token.trim())
        .filter((token) => (
          token.length >= 2
          || /^[0-9]$/.test(token)
          || /^[\u4e00-\u9fff]$/u.test(token)
        )),
    ),
  ).slice(0, 16);
}

function matchedAccessibilityTokens(node, tokens, instruction = '') {
  const labelParts = [
    node.name,
    node.description,
    node.value,
    node.placeholder,
    node.title,
    node.domIdentifier,
    node.domClassList,
    node.domRole,
    node.roleDescription,
  ]
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);
  const text = accessibilityNodeSearchText(node);
  const instructionText = String(instruction || '').toLowerCase();
  const matches = new Set(tokens.filter((token) => text.includes(token)));
  for (const label of labelParts) {
    if (label.length >= 2 && instructionText.includes(label)) matches.add(label);
  }
  return Array.from(matches);
}

function scoreAccessibilityNode(node, tokens, matchedTokens = matchedAccessibilityTokens(node, tokens)) {
  const hasInstruction = tokens.length > 0;
  const label = compactAccessibilityLabel(node);
  let score = ACTIONABLE_AX_ROLES.has(node.role) ? 8 : 0;
  if (node.enabled === false) score -= 3;
  if (node.focused === 'true') score += 3;
  if (/text|search|edit|input|textbox|composer|compose|ask/i.test(accessibilityNodeSearchText(node))) score += 2;
  if (label) score += 2;
  for (const token of matchedTokens) score += 5;
  if (hasInstruction && matchedTokens.length === 0) score = Math.max(0, score - 9);
  return score;
}

function accessibilityActionPlan(options = {}) {
  const instruction = String(options.instruction || '').trim();
  return accessibilityTreeSnapshot(options).then((tree) => {
    const tokens = accessibilityInstructionTokens(instruction);
    const scored = (tree.nodes || [])
      .map((node) => {
        const matchedTokens = matchedAccessibilityTokens(node, tokens, instruction);
        return {
          id: node.id,
          role: node.role,
          label: compactAccessibilityLabel(node),
          enabled: node.enabled,
          position: node.position,
          size: node.size,
          depth: node.depth,
          matchedTokens,
          score: scoreAccessibilityNode(node, tokens, matchedTokens),
        };
      })
      .filter((node) => node.score > 0)
      .sort((a, b) => b.score - a.score || a.depth - b.depth)
      .slice(0, 8);

    const best = scored.find((node) => (
      tokens.length === 0 || (node.matchedTokens.length > 0 && ACTIONABLE_AX_ROLES.has(node.role))
    )) || null;
    return {
      ok: tree.available,
      instruction,
      app: tree.app,
      windowTitle: tree.windowTitle,
      tree: {
        available: tree.available,
        nodeCount: tree.nodeCount,
        truncated: tree.truncated,
        maxDepth: tree.maxDepth,
        maxNodes: tree.maxNodes,
        outline: tree.outline,
        error: tree.error,
      },
      candidates: scored,
      recommended: best
        ? {
            type: 'dry_run_ui_target',
            nodeId: best.id,
            role: best.role,
            label: best.label,
            summary: `Candidate ${best.id}: ${best.role}${best.label ? ` "${best.label}"` : ''}`,
            executableNow: false,
            requiresConfirmation: true,
            nextStep: 'Confirm the target, then preview ax_press or ax_set_value through the guarded action policy.',
          }
        : {
            type: 'no_target',
            summary: tree.error || 'No strong actionable UI target found.',
            executableNow: false,
            requiresConfirmation: false,
            nextStep: 'Ask the user for a more specific target or inspect the screen.',
          },
    };
  });
}

function normalizeAccessibilityControlAction(value, content) {
  const action = String(value || '').trim();
  if (action === 'set_value' || action === 'ax_set_value') return 'ax_set_value';
  if (action === 'press' || action === 'ax_press') return 'ax_press';
  return String(content || '').trim() ? 'ax_set_value' : 'ax_press';
}

async function controlCurrentApp(options = {}) {
  const instruction = String(options.instruction || '').trim();
  if (!instruction) throw new Error('Missing UI control instruction.');

  const content = String(options.content ?? options.value ?? '');
  const action = normalizeAccessibilityControlAction(options.action, content);
  if (action === 'ax_set_value' && !content) throw new Error('Missing content for set_value UI action.');

  const maxNodes = options.maxNodes || 120;
  const maxDepth = options.maxDepth || 6;
  const plan = await accessibilityActionPlan({ instruction, maxNodes, maxDepth });
  const target = plan.recommended?.nodeId
    ? {
        nodeId: plan.recommended.nodeId,
        role: plan.recommended.role || '',
        label: plan.recommended.label || '',
      }
    : null;
  const execute = options.execute !== false;
  const recordWorkflow = options.recordWorkflow !== false;

  if (!plan.ok || !target) {
    const output = plan.recommended?.summary || plan.tree?.error || 'No usable UI target found.';
    appendAudit('accessibility_control.no_target', {
      instruction: compactRecordText(instruction, 180),
      app: plan.app,
      windowTitle: plan.windowTitle,
      output,
    });
    return {
      ok: false,
      executed: false,
      action,
      instruction,
      plan,
      target,
      output,
    };
  }

  const actionArgs = {
    action,
    nodeId: target.nodeId,
    expectedRole: target.role,
    expectedLabel: target.label,
    content,
    maxNodes,
    maxDepth,
  };
  const previewPlan = buildLocalActionPlan(actionArgs);
  const evaluation = evaluateMacActionPlan(previewPlan, { preview: true });

  if (!execute) {
    const output = `Prepared ${previewPlan.summary}${evaluation.needsApproval ? ` (${evaluation.reason})` : ''}.`;
    appendAudit('accessibility_control.preview', {
      instruction: compactRecordText(instruction, 180),
      action,
      app: plan.app,
      windowTitle: plan.windowTitle,
      nodeId: target.nodeId,
      role: target.role,
      label: target.label,
      reason: evaluation.reason || '',
    });
    return {
      ok: true,
      executed: false,
      action,
      instruction,
      plan,
      target,
      preview: previewPlan,
      evaluation,
      output,
    };
  }

  try {
    const output = await executeLocalAction(actionArgs, { approvalContext: options.approvalContext });
    const workflow = recordWorkflow
      ? createWorkflowRecord({
          kind: 'accessibility',
          source: 'accessibility_control',
          status: 'done',
          title: `ui · ${target.label || target.role || plan.app || 'current app'}`.slice(0, 180),
          intent: 'control_current_app',
          mode: 'local',
          request: instruction,
          result: output,
          target: {
            app: plan.app,
            windowTitle: plan.windowTitle,
            nodeId: target.nodeId,
            role: target.role,
            label: target.label,
            action,
          },
        })
      : null;
    appendAudit('accessibility_control.executed', {
      instruction: compactRecordText(instruction, 180),
      action,
      app: plan.app,
      windowTitle: plan.windowTitle,
      nodeId: target.nodeId,
      role: target.role,
      label: target.label,
      workflowId: workflow?.id || '',
    });
    return {
      ok: true,
      executed: true,
      action,
      instruction,
      plan,
      target,
      workflow,
      output,
    };
  } catch (error) {
    if (error instanceof ActionApprovalRequired) {
      return {
        ok: false,
        executed: false,
        action,
        instruction,
        plan,
        target,
        approval: error.approval,
        output: `Approval required before I can ${error.approval.summary}.`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    if (recordWorkflow) {
      createWorkflowRecord({
        kind: 'accessibility',
        source: 'accessibility_control',
        status: 'blocked',
        title: `ui blocked · ${target.label || target.role || plan.app || 'current app'}`.slice(0, 180),
        intent: 'control_current_app',
        mode: 'local',
        request: instruction,
        result: message,
        target: {
          app: plan.app,
          windowTitle: plan.windowTitle,
          nodeId: target.nodeId,
          role: target.role,
          label: target.label,
          action,
        },
      });
    }
    return {
      ok: false,
      executed: false,
      action,
      instruction,
      plan,
      target,
      output: message,
    };
  }
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(10000, Number(ms || 0)))));
}

function normalizeAppWorkflowStep(raw = {}, index = 0) {
  const type = String(raw.type || raw.kind || raw.action || '').trim();
  const normalizedType = {
    app: 'open_app',
    url: 'open_url',
    ui: 'control_current_app',
    control: 'control_current_app',
    accessibility: 'control_current_app',
    browser: 'browser_dom',
    browser_dom_action: 'browser_dom',
    webpage: 'browser_dom',
    mac: 'mac_action',
    file: 'file_action',
    sleep: 'wait',
  }[type] || type;
  const label = String(raw.label || raw.title || normalizedType || `step ${index + 1}`).slice(0, 100);
  return {
    ...raw,
    type: normalizedType,
    label,
    index,
  };
}

function normalizeAppWorkflowSteps(value) {
  if (!Array.isArray(value)) throw new Error('steps must be an array.');
  return value
    .slice(0, 12)
    .map((step, index) => normalizeAppWorkflowStep(step, index));
}

function appWorkflowApprovalContext(context = {}, step = {}) {
  if (!context.workflowId || !Array.isArray(context.steps)) return null;
  const stepIndex = Number(step.index || 0);
  const remainingSteps = context.steps.filter((item) => Number(item.index || 0) > stepIndex);
  return {
    type: 'app_workflow',
    workflowId: context.workflowId,
    title: context.title || '',
    instruction: context.instruction || '',
    stepIndex,
    source: context.source || 'app_workflow',
    remainingSteps,
  };
}

function appWorkflowActionArgs(step) {
  if (step.type === 'open_app') {
    const value = String(step.app || step.value || step.name || '').trim();
    if (!value) throw new Error('open_app step requires app.');
    return { action: 'open_app', value };
  }

  if (step.type === 'open_url') {
    const value = String(step.url || step.value || '').trim();
    if (!value) throw new Error('open_url step requires url.');
    return { action: 'open_url', value };
  }

  if (step.type === 'hotkey') {
    const keys = String(step.keys || step.value || '').trim();
    if (!keys) throw new Error('hotkey step requires keys.');
    return { action: 'hotkey', keys };
  }

  if (step.type === 'type_text') {
    const value = String(step.text ?? step.value ?? step.content ?? '');
    if (!value) throw new Error('type_text step requires text.');
    return { action: 'type_text', value };
  }

  if (step.type === 'mac_action') {
    const args = { ...(step.args || step) };
    delete args.type;
    delete args.kind;
    delete args.label;
    delete args.title;
    delete args.index;
    if (!args.action) throw new Error('mac_action step requires action.');
    return args;
  }

  if (step.type === 'file_action') {
    const args = { ...(step.args || step) };
    delete args.type;
    delete args.kind;
    delete args.label;
    delete args.title;
    delete args.index;
    if (!args.action) throw new Error('file_action step requires action.');
    return args;
  }

  throw new Error(`Unsupported app workflow action step: ${step.type}`);
}

function previewLocalWorkflowAction(args) {
  const plan = buildLocalActionPlan(args);
  const evaluation = evaluateMacActionPlan(plan, { preview: true });
  return {
    action: plan.action,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
    target: plan.target,
    evaluation,
  };
}

async function runAppWorkflowStep(step, execute, context = {}) {
  const approvalContext = appWorkflowApprovalContext(context, step);
  if (step.type === 'wait') {
    const ms = Math.max(0, Math.min(10000, Number(step.ms || step.durationMs || step.value || 500)));
    if (execute) await waitMs(ms);
    return {
      status: execute ? 'executed' : 'previewed',
      type: step.type,
      label: step.label,
      summary: `Wait ${ms}ms`,
      output: execute ? `Waited ${ms}ms.` : `Would wait ${ms}ms.`,
    };
  }

  if (step.type === 'control_current_app') {
    const instruction = String(step.instruction || step.text || '').trim();
    if (!instruction) throw new Error('control_current_app step requires instruction.');
    const requestedAction = [
      step.controlAction,
      step.uiAction,
      step.actionName,
      step.axAction,
      step.mode,
      step.action,
    ].find((value) => ['press', 'set_value', 'ax_press', 'ax_set_value'].includes(String(value || '').trim()));
    const result = await controlCurrentApp({
      instruction,
      action: requestedAction,
      content: step.content ?? step.value,
      execute,
      maxNodes: step.maxNodes,
      maxDepth: step.maxDepth,
      recordWorkflow: false,
      approvalContext,
    });
    return {
      status: result.ok ? (result.executed ? 'executed' : 'previewed') : result.approval ? 'approval_required' : 'blocked',
      type: step.type,
      label: step.label,
      summary: result.target
        ? `${result.action} ${result.target.role}${result.target.label ? ` "${result.target.label}"` : ''}`
        : instruction,
      output: result.output,
      target: result.target,
      approval: result.approval,
    };
  }

  if (step.type === 'browser_dom') {
    const requestedAction = [
      step.domAction,
      step.browserAction,
      step.actionName,
      step.mode,
      step.action,
    ].find((value) => ['click', 'fill', 'select'].includes(String(value || '').trim()));
    const result = await executeBrowserDomAction({
      action: requestedAction || 'click',
      app: step.app,
      selector: step.selector,
      query: step.query || step.label || step.text,
      value: step.value ?? step.content,
      execute,
      source: 'app_workflow',
    }, { preview: !execute, approvalContext });
    return {
      status: result.ok ? (result.executed ? 'executed' : 'previewed') : result.approval ? 'approval_required' : 'blocked',
      type: step.type,
      label: step.label,
      summary: result.plan?.summary || result.action || step.label,
      output: result.output,
      approval: result.approval,
      preview: result.plan ? { plan: result.plan, evaluation: result.evaluation } : undefined,
    };
  }

  const args = appWorkflowActionArgs(step);
  const preview = previewLocalWorkflowAction(args);
  if (!execute) {
    return {
      status: 'previewed',
      type: step.type,
      label: step.label,
      summary: preview.summary,
      output: `Prepared ${preview.summary}${preview.evaluation.needsApproval ? ` (${preview.evaluation.reason})` : ''}.`,
      preview,
    };
  }

  try {
    const output = await executeLocalAction(args, { approvalContext });
    return {
      status: 'executed',
      type: step.type,
      label: step.label,
      summary: preview.summary,
      output,
      preview,
    };
  } catch (error) {
    if (error instanceof ActionApprovalRequired) {
      return {
        status: 'approval_required',
        type: step.type,
        label: step.label,
        summary: preview.summary,
        output: `Approval required before I can ${error.approval.summary}.`,
        approval: error.approval,
        preview,
      };
    }
    return {
      status: 'blocked',
      type: step.type,
      label: step.label,
      summary: preview.summary,
      output: error instanceof Error ? error.message : String(error),
      preview,
    };
  }
}

function formatAppWorkflowResults(results = []) {
  return results
    .map((result, index) => `${index + 1}. ${result.status}: ${result.summary || result.label}${result.output ? ` · ${compactRecordText(result.output, 180)}` : ''}`)
    .join('\n');
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Empty JSON response.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('No JSON object found.');
  }
}

function appNameFromInstruction(instruction) {
  const text = String(instruction || '').trim();
  const explicit = text.match(/(?:open|launch|打开|启动)\s+([A-Za-z][A-Za-z0-9 ._-]{1,40})/i);
  if (explicit) return explicit[1].trim();
  const knownApps = [
    ['Calculator', ['calculator', '计算器']],
    ['Finder', ['finder', '访达']],
    ['Safari', ['safari']],
    ['Google Chrome', ['chrome', 'google chrome', '谷歌浏览器']],
    ['Notes', ['notes', '备忘录']],
    ['TextEdit', ['textedit', 'text edit', '文本编辑']],
    ['Obsidian', ['obsidian']],
    ['System Settings', ['system settings', '系统设置']],
  ];
  const lower = text.toLowerCase();
  const hit = knownApps.find(([_app, aliases]) => aliases.some((alias) => lower.includes(alias.toLowerCase())));
  return hit?.[0] || '';
}

function typedTextFromInstruction(instruction) {
  const text = String(instruction || '').trim();
  const match = text.match(/(?:type|输入|打字|写下|写入|记下)\s*[:：]?\s*([\s\S]+)$/i);
  if (!match?.[1]) return '';
  const content = match[1]
    .trim()
    .replace(/^[“"‘']+/, '')
    .replace(/[”"’']+$/, '')
    .trim();
  if (!content) return '';
  if (/(?:然后|接着|and then|then).*(?:close|quit|send|submit|delete|关闭|退出|发送|提交|删除)/i.test(content)) return '';
  if (content.length > 500) return '';
  return content;
}

function deterministicAppWorkflowPlan(options = {}, context = {}) {
  const instruction = String(options.instruction || options.goal || '').trim();
  const lower = instruction.toLowerCase();
  const steps = [];
  const appName = appNameFromInstruction(instruction);
  if (appName && /open|launch|打开|启动/.test(lower)) {
    steps.push({ type: 'open_app', app: appName, label: `Open ${appName}` });
    steps.push({ type: 'wait', ms: Number(options.waitMs || 900), label: 'Wait for app' });
  }

  const typedText = appName ? typedTextFromInstruction(instruction) : '';
  if (typedText) {
    steps.push({
      type: 'type_text',
      text: typedText,
      label: `Type ${typedText.length} chars`,
    });
  }

  const wantsClose =
    /close|quit|关闭|关掉|退出/.test(lower) &&
    !/delete|remove|trash|删除|移除|扔进废纸篓/.test(lower);
  if (wantsClose) {
    steps.push({
      type: 'hotkey',
      keys: 'cmd+w',
      label: 'Close window',
    });
  }

  const buttonMatch = instruction.match(/(?:press|click|tap|按|点击|点一下)\s*([^，。,.]+?(?:按钮|button|tab|menu|菜单|链接|link)?)/i);
  if (!wantsClose && buttonMatch) {
    const target = buttonMatch[1].trim();
    if (target) {
      steps.push({
        type: 'control_current_app',
        instruction: /按钮|button/i.test(target) ? `按${target}` : `按${target}按钮`,
        maxNodes: options.maxNodes || 160,
        maxDepth: options.maxDepth || 8,
        label: `Press ${target}`,
      });
    }
  }

  if (!steps.length) return null;
  return {
    ok: true,
    source: 'deterministic',
    title: String(options.title || instruction || `Plan for ${context.frontmost?.app || 'current app'}`).slice(0, 180),
    instruction,
    confidence: steps.length >= 2 || wantsClose ? 0.82 : 0.66,
    needsClarification: false,
    reason: 'Matched a small local app workflow pattern.',
    steps,
  };
}

function safeLocalAppWorkflowPlan(instruction) {
  const text = String(instruction || '').trim();
  if (!text) return null;
  const unsafePattern =
    /\b(delete|remove|trash|erase|destroy|format|send|submit|buy|purchase|pay|payment|checkout|order|post|publish|share|upload|install|uninstall|login|log in|logout|log out|sign in|sign out|password|secret|token|api key)\b|删除|移除|废纸篓|抹掉|格式化|发送|提交|购买|付款|支付|下单|结账|发布|分享|上传|安装|卸载|登录|登入|退出登录|注销|密码|密钥/i;
  if (unsafePattern.test(text)) return null;

  const plan = deterministicAppWorkflowPlan({
    instruction: text,
    maxNodes: 160,
    maxDepth: 8,
    useModel: false,
  });
  if (!plan?.ok || !Array.isArray(plan.steps) || plan.steps.length < 2) return null;

  const hasAppOpen = plan.steps.some((step) => step.type === 'open_app' && step.app);
  const openedApp = plan.steps.find((step) => step.type === 'open_app')?.app || '';
  const hasTypeText = plan.steps.some((step) => step.type === 'type_text');
  const hasSafeAction = plan.steps.some((step) => step.type === 'control_current_app' || step.type === 'type_text' || (step.type === 'hotkey' && normalizeHotkey(step.keys) === 'cmd+w'));
  const onlySafeStepTypes = plan.steps.every((step) => ['open_app', 'wait', 'control_current_app', 'hotkey', 'type_text'].includes(step.type));
  const onlySafeHotkeys = plan.steps.every((step) => step.type !== 'hotkey' || normalizeHotkey(step.keys) === 'cmd+w');
  if (!hasAppOpen || !hasSafeAction || !onlySafeStepTypes || !onlySafeHotkeys) return null;
  if (hasTypeText) {
    const typingApps = new Set(['Notes', 'TextEdit', 'Obsidian']);
    const hasClose = plan.steps.some((step) => step.type === 'hotkey' && normalizeHotkey(step.keys) === 'cmd+w');
    if (!typingApps.has(openedApp) || hasClose) return null;
  }

  const riskyUiPattern = /删除|移除|发送|提交|购买|付款|支付|登录|允许|同意|确认|确定|\b(delete|remove|send|submit|buy|purchase|pay|login|allow|accept|confirm|ok)\b/i;
  if (plan.steps.some((step) => step.type === 'control_current_app' && riskyUiPattern.test(step.instruction || step.label || ''))) {
    return null;
  }

  return plan;
}

function sanitizePlannedAppWorkflow(rawPlan = {}, fallbackTitle = 'Planned app workflow') {
  const steps = normalizeAppWorkflowSteps(rawPlan.steps || []);
  return {
    ok: steps.length > 0,
    source: rawPlan.source || 'model',
    title: String(rawPlan.title || fallbackTitle).slice(0, 180),
    instruction: String(rawPlan.instruction || ''),
    confidence: Math.max(0, Math.min(1, Number(rawPlan.confidence || 0))),
    needsClarification: Boolean(rawPlan.needsClarification),
    reason: String(rawPlan.reason || ''),
    steps,
  };
}

function appWorkflowPlanningPrompt({ instruction, macContext, tree }) {
  return [
    'Plan a short local Mac app workflow as strict JSON only.',
    'Allowed step types: open_app, open_url, wait, control_current_app, browser_dom, hotkey, type_text, mac_action, file_action.',
    'Prefer control_current_app for visible UI targets and keep max 5 steps.',
    'Prefer browser_dom only for explicit webpage element click/fill/select tasks, and do not plan submits, purchases, sends, deletes, logins, or account changes.',
    'Do not plan sends, purchases, deletes, account changes, or irreversible external actions.',
    'If ambiguous, return needsClarification true and an empty steps array.',
    '',
    'JSON shape:',
    '{"title":"...","confidence":0.0,"needsClarification":false,"reason":"...","steps":[{"type":"open_app","app":"Calculator"},{"type":"wait","ms":900},{"type":"control_current_app","instruction":"按关闭按钮"}]}',
    '',
    `User instruction: ${instruction}`,
    '',
    `Frontmost app: ${macContext.frontmost?.app || ''}`,
    `Frontmost window: ${macContext.frontmost?.windowTitle || ''}`,
    `Browser title: ${macContext.browser?.title || ''}`,
    `Browser URL: ${macContext.browser?.url || ''}`,
    '',
    'Accessibility outline:',
    tree.outline || tree.error || '',
  ].join('\n');
}

async function modelAppWorkflowPlan(options = {}, context = {}) {
  if (!OPENAI_API_KEY) return null;
  const instruction = String(options.instruction || options.goal || '').trim();
  const output = await callOpenAIResponses({
    model: models.fast,
    instructions:
      'You are the JAVIS local app workflow planner. Return strict JSON only. Prefer safe previewable local steps. Never include prose outside JSON.',
    input: appWorkflowPlanningPrompt({
      instruction,
      macContext: context.macContext || {},
      tree: context.tree || {},
    }),
    maxOutputTokens: 700,
  });
  const parsed = extractJsonObject(output);
  return sanitizePlannedAppWorkflow({
    ...parsed,
    source: 'model',
    instruction,
  }, instruction || 'Planned app workflow');
}

async function planAppWorkflow(options = {}) {
  const instruction = String(options.instruction || options.goal || '').trim();
  if (!instruction) throw new Error('App workflow planning requires instruction.');
  const maxNodes = options.maxNodes || 120;
  const maxDepth = options.maxDepth || 6;
  const [macContext, tree] = await Promise.all([
    macContextSnapshot({ includeClipboardText: false }),
    accessibilityTreeSnapshot({ maxNodes, maxDepth }),
  ]);
  const context = {
    macContext,
    tree,
    screen: latestScreenSnapshot(),
  };

  let plan = deterministicAppWorkflowPlan({ ...options, instruction, maxNodes, maxDepth }, {
    frontmost: macContext.frontmost || {},
  });
  if (!plan && options.useModel !== false) {
    try {
      plan = await modelAppWorkflowPlan({ ...options, instruction }, { macContext, tree });
    } catch (error) {
      plan = {
        ok: false,
        source: 'model',
        title: String(options.title || instruction).slice(0, 180),
        instruction,
        confidence: 0,
        needsClarification: true,
        reason: error instanceof Error ? error.message : String(error),
        steps: [],
      };
    }
  }

  if (!plan) {
    plan = {
      ok: false,
      source: 'none',
      title: String(options.title || instruction).slice(0, 180),
      instruction,
      confidence: 0,
      needsClarification: true,
      reason: 'No safe app workflow plan matched the instruction.',
      steps: [],
    };
  }

  const sanitized = sanitizePlannedAppWorkflow(plan, instruction);
  sanitized.ok = sanitized.ok && !sanitized.needsClarification;
  const output = sanitized.steps.length
    ? sanitized.steps.map((step, index) => `${index + 1}. ${step.type}: ${step.label || step.instruction || step.app || step.url || ''}`).join('\n')
    : sanitized.reason || 'No plan available.';

  appendAudit('app_workflow.plan', {
    source: sanitized.source,
    ok: sanitized.ok,
    confidence: sanitized.confidence,
    steps: sanitized.steps.length,
    instruction: compactRecordText(instruction, 180),
  });

  return {
    ...sanitized,
    context,
    output,
  };
}

async function planAndMaybeRunAppWorkflow(options = {}) {
  const plan = await planAppWorkflow(options);
  const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
  if (!execute || !plan.ok) {
    return {
      ok: plan.ok,
      executed: false,
      plan,
      output: plan.output,
    };
  }
  const run = await runAppWorkflow({
    title: options.title || plan.title,
    instruction: plan.instruction,
    execute: true,
    steps: plan.steps,
    continueOnError: options.continueOnError,
  });
  return {
    ok: run.ok,
    executed: true,
    plan,
    run,
    workflow: run.workflow,
    output: run.output,
  };
}

async function runAppWorkflow(options = {}) {
  const steps = normalizeAppWorkflowSteps(options.steps || []);
  if (!steps.length) throw new Error('App workflow requires at least one step.');

  const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
  const stopOnError = options.continueOnError !== true;
  const instruction = String(options.instruction || options.goal || '').trim();
  const title = String(options.title || instruction || `app workflow · ${steps.length} step(s)`).slice(0, 180);
  const workflow = createWorkflowRecord({
    kind: 'app',
    source: 'app_workflow',
    status: 'running',
    title,
    intent: 'run_app_workflow',
    mode: execute ? 'local' : 'preview',
    request: instruction || JSON.stringify(steps.map((step) => ({ type: step.type, label: step.label }))),
    target: {
      stepCount: steps.length,
      execute,
    },
  });

  appendAudit('app_workflow.requested', {
    workflowId: workflow.id,
    execute,
    steps: steps.length,
    title,
  });

  const results = [];
  const stepContext = {
    workflowId: workflow.id,
    title,
    instruction,
    steps,
    source: options.source || 'app_workflow',
  };
  for (const step of steps) {
    try {
      const result = await runAppWorkflowStep(step, execute, stepContext);
      results.push({ index: step.index, ...result });
      if (stopOnError && ['blocked', 'approval_required'].includes(result.status)) break;
    } catch (error) {
      results.push({
        index: step.index,
        status: 'blocked',
        type: step.type,
        label: step.label,
        summary: step.label,
        output: error instanceof Error ? error.message : String(error),
      });
      if (stopOnError) break;
    }
  }

  const counts = results.reduce(
    (memo, result) => {
      memo.total += 1;
      memo[result.status] = (memo[result.status] || 0) + 1;
      return memo;
    },
    { total: 0, previewed: 0, executed: 0, approval_required: 0, blocked: 0 },
  );
  const output = formatAppWorkflowResults(results);
  const status = counts.blocked || counts.approval_required ? 'blocked' : 'done';
  const finalWorkflow = setWorkflow(workflow.id, {
    status,
    result: output,
    completedAt: Date.now(),
    target: {
      stepCount: steps.length,
      execute,
      counts,
      completedSteps: results.length,
    },
  });

  appendAudit('app_workflow.completed', {
    workflowId: workflow.id,
    status,
    execute,
    counts,
  });

  return {
    ok: status === 'done',
    executed: execute,
    workflow: finalWorkflow,
    counts,
    results,
    output,
  };
}

function assertValidAccessibilityNodeId(value) {
  const nodeId = String(value || '').trim();
  if (!/^[1-9]\d{0,4}$/.test(nodeId)) throw new Error('Missing or invalid accessibility node id.');
  return nodeId;
}

async function runAccessibilityNodeAction(plan) {
  if (process.platform !== 'darwin') throw new Error('Accessibility actions are macOS-only.');
  const accessibilityTrusted =
    typeof systemPreferences?.isTrustedAccessibilityClient === 'function'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : null;
  if (accessibilityTrusted === false) throw new Error('accessibility_permission_not_granted');

  const actionConfig = actionPolicy.allow?.[plan.action] || {};
  const maxNodes = Math.max(10, Math.min(actionPolicy.allow?.read_accessibility_tree?.maxNodes || 120, Number(plan.metadata?.maxNodes || 120)));
  const maxDepth = Math.max(1, Math.min(actionPolicy.allow?.read_accessibility_tree?.maxDepth || 6, Number(plan.metadata?.maxDepth || 6)));
  const script = `
const nodeId = ${JSON.stringify(String(plan.args.nodeId))};
const action = ${JSON.stringify(plan.action)};
const content = ${JSON.stringify(String(plan.args.content || ''))};
const expectedLabel = ${JSON.stringify(String(plan.args.expectedLabel || ''))};
const expectedRole = ${JSON.stringify(String(plan.args.expectedRole || ''))};
const allowedRoles = ${JSON.stringify(actionConfig.allowedRoles || [])};
const maxNodes = ${JSON.stringify(maxNodes)};
const maxDepth = ${JSON.stringify(maxDepth)};
const systemEvents = Application('System Events');

function readProp(element, name) {
  try {
    const value = element[name]();
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\\t\\r\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

function readAttribute(element, name) {
  try {
    const value = element.attributes.byName(name).value();
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map((item) => String(item)).join(' ');
    return String(value).replace(/[\\t\\r\\n]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

function childrenOf(element) {
  try {
    return element.uiElements();
  } catch (_) {
    return [];
  }
}

function labelOf(element) {
  return [
    readProp(element, 'name'),
    readProp(element, 'description'),
    readProp(element, 'value'),
    readAttribute(element, 'AXPlaceholderValue'),
    readAttribute(element, 'AXTitle'),
    readAttribute(element, 'AXDOMIdentifier'),
    readAttribute(element, 'AXDOMRole'),
  ].filter(Boolean)[0] || '';
}

const processes = systemEvents.applicationProcesses.whose({ frontmost: true })();
if (!processes.length) throw new Error('no_frontmost_app');
const process = processes[0];
const windows = process.windows();
let root = null;
for (const window of windows) {
  const children = childrenOf(window);
  if (readProp(window, 'subrole') === 'AXStandardWindow' && children.length) {
    root = window;
    break;
  }
}
if (!root) root = windows.find((window) => childrenOf(window).length) || windows[0] || process;

const elements = [];
function walk(element, depth) {
  if (elements.length >= maxNodes) return;
  elements.push(element);
  if (depth >= maxDepth) return;
  for (const child of childrenOf(element)) {
    if (elements.length >= maxNodes) break;
    walk(child, depth + 1);
  }
}
walk(root, 0);

const index = Number(nodeId) - 1;
const target = elements[index];
if (!target) throw new Error('accessibility_node_not_found');
const role = readProp(target, 'role');
const label = labelOf(target);
if (allowedRoles.length && !allowedRoles.includes(role)) throw new Error('accessibility_role_not_allowed:' + role);
if (expectedRole && expectedRole !== role) throw new Error('accessibility_role_changed:' + role);
if (expectedLabel && expectedLabel !== label) throw new Error('accessibility_label_changed:' + label);

if (action === 'ax_press') {
  const actionNames = target.actions().map((item) => readProp(item, 'name'));
  if (!actionNames.includes('AXPress')) throw new Error('accessibility_press_not_available');
  target.actions.byName('AXPress').perform();
} else if (action === 'ax_set_value') {
  if (!content) throw new Error('missing_accessibility_value');
  try {
    target.value = content;
  } catch (_) {
    try {
      target.value.set(content);
    } catch (error) {
      throw new Error('accessibility_set_value_failed:' + error.message);
    }
  }
} else {
  throw new Error('unsupported_accessibility_action:' + action);
}

JSON.stringify({
  ok: true,
  app: readProp(process, 'name'),
  windowTitle: readProp(root, 'name'),
  nodeId,
  role,
  label,
  action,
});
`;

  const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 8000, maxBuffer: 1_000_000 });
  const result = JSON.parse(String(stdout || '{}'));
  appendAudit('accessibility_action.executed', {
    action: plan.action,
    nodeId: plan.args.nodeId,
    role: result.role,
    label: result.label,
    app: result.app,
  });
  return `${result.action} executed on ${result.role}${result.label ? ` "${result.label}"` : ''}.`;
}

function normalizeBrowserMaxChars(value) {
  const policyMax = actionPolicy.allow?.read_browser_page?.maxChars || 30000;
  return Math.max(1000, Math.min(policyMax, Number(value || policyMax)));
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlAttributeValue(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match ? decodeHtmlEntities(match[1]) : '';
}

function normalizeBrowserHref(rawHref, baseUrl = '') {
  const raw = String(rawHref || '').trim();
  if (!raw || /^(?:javascript|mailto|tel|sms|data|blob):/i.test(raw)) return '';
  try {
    const url = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const googleTarget = (url.hostname === 'www.google.com' || url.hostname === 'google.com')
      && (url.pathname === '/url' || url.pathname === '/interstitial')
      ? url.searchParams.get('q') || url.searchParams.get('url')
      : '';
    if (googleTarget && /^https?:\/\//i.test(googleTarget)) return new URL(googleTarget).href;
    return url.href;
  } catch {
    return '';
  }
}

function normalizeBrowserLinks(rawLinks = [], pageUrl = '', maxLinks = MAX_BROWSER_PAGE_LINKS) {
  const pageHost = (() => {
    try {
      return pageUrl ? new URL(pageUrl).hostname.replace(/^www\./i, '') : '';
    } catch {
      return '';
    }
  })();
  const seen = new Set();
  const links = [];
  for (const item of Array.isArray(rawLinks) ? rawLinks : []) {
    const href = normalizeBrowserHref(item?.href || item?.url, pageUrl);
    if (!href) continue;
    const key = href.replace(/#.*$/, '');
    if (seen.has(key)) continue;
    let host = '';
    try {
      host = new URL(href).hostname.replace(/^www\./i, '');
    } catch {
      continue;
    }
    const text = compactRecordText(
      String(item?.text || item?.label || item?.title || item?.ariaLabel || host)
        .replace(/\s+/g, ' ')
        .trim(),
      180,
    ) || host;
    seen.add(key);
    links.push({
      index: links.length + 1,
      text,
      href,
      host,
      sameHost: Boolean(pageHost && host === pageHost),
    });
    if (links.length >= maxLinks) break;
  }
  return links;
}

function extractHtmlLinks(html, pageUrl = '') {
  const rawLinks = [];
  const source = String(html || '');
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = htmlAttributeValue(match[1] || '', 'href');
    if (!href) continue;
    const text = decodeHtmlEntities(String(match[2] || '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    rawLinks.push({ href, text });
    if (rawLinks.length >= MAX_BROWSER_PAGE_LINKS * 4) break;
  }
  return normalizeBrowserLinks(rawLinks, pageUrl);
}

function browserSearchResultLinks(page = {}, maxLinks = 10) {
  const links = Array.isArray(page.links) ? page.links : [];
  const pageHost = (() => {
    try {
      return page.url ? new URL(page.url).hostname.replace(/^www\./i, '') : '';
    } catch {
      return '';
    }
  })();
  const isSearchUtilityHost = (host = '') => {
    const normalized = String(host || '').replace(/^www\./i, '');
    return /^google\.[a-z.]+$/i.test(normalized)
      || ['accounts.google.com', 'policies.google.com', 'support.google.com', 'maps.google.com', 'news.google.com', 'translate.google.com', 'webcache.googleusercontent.com'].includes(normalized)
      || /^bing\.[a-z.]+$/i.test(normalized)
      || /^duckduckgo\.[a-z.]+$/i.test(normalized)
      || normalized === 'search.yahoo.com';
  };
  const searchUtilityHosts = new Set([
    'google.com',
    'accounts.google.com',
    'policies.google.com',
    'support.google.com',
    'maps.google.com',
    'news.google.com',
    'webcache.googleusercontent.com',
    'bing.com',
    'duckduckgo.com',
    'search.yahoo.com',
  ]);
  return links
    .filter((link) => {
      if (!link?.href || !link.host) return false;
      if (pageHost && link.host === pageHost) return false;
      if (searchUtilityHosts.has(link.host) || isSearchUtilityHost(link.host)) return false;
      if (/^(Images|Videos|News|Shopping|Maps|Books|Tools|Settings|Privacy|Terms|Google 应用|Google Apps|登录|Sign in|设置|工具|翻译此页|Translate this page)$/i.test(link.text || '')) return false;
      return true;
    })
    .slice(0, maxLinks)
    .map((link, index) => ({ ...link, index: index + 1 }));
}

function browserWorkflowLinksBlock(page = {}, maxLinks = 12) {
  const links = Array.isArray(page.links) ? page.links.slice(0, maxLinks) : [];
  if (!links.length) return '';
  return links.map((link) => `${link.index}. ${link.text} · ${link.href}`).join('\n');
}

function extractHtmlPage(html, maxChars, pageUrl = '') {
  const source = String(html || '');
  const title = decodeHtmlEntities(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const metaTag = source.match(/<meta[^>]+(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>/i)?.[0] || '';
  const metaDescription = htmlAttributeValue(metaTag, 'content');
  const headings = Array.from(source.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);
  const text = decodeHtmlEntities(
    source
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title,
    text: text.slice(0, maxChars),
    textLength: text.length,
    truncated: text.length > maxChars,
    headings,
    metaDescription,
    links: extractHtmlLinks(source, pageUrl),
  };
}

function browserPageFromFileUrl(browser, maxChars, previousError) {
  try {
    const url = new URL(browser.url);
    if (url.protocol !== 'file:') return null;
    const filePath = fileURLToPath(url);
    const html = readUtf8File(filePath, Math.max(maxChars * 4, 1000000));
    const extracted = extractHtmlPage(html, maxChars, browser.url);
    return {
      available: true,
      supported: true,
      app: browser.app,
      title: extracted.title || browser.title,
      url: browser.url,
      text: extracted.text,
      selectedText: '',
      textLength: extracted.textLength,
      truncated: extracted.truncated,
      headings: extracted.headings,
      metaDescription: extracted.metaDescription,
      links: extracted.links,
      fallback: 'file_url',
      error: previousError ? `${previousError}; used file_url fallback` : '',
    };
  } catch {
    return null;
  }
}

async function fetchTextWithLimit(url, maxBytes = 2000000, timeoutMs = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2',
        'User-Agent': `JAVIS/${packageInfo.version} read-only-page-fetch`,
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error(`Response exceeds maxBytes (${contentLength} > ${maxBytes}).`);
    if (!response.body?.getReader) {
      const text = await response.text();
      return text.slice(0, maxBytes);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The response may already be closed.
        }
        throw new Error(`Response exceeds maxBytes (${received} > ${maxBytes}).`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

async function browserPageFromHttpUrl(browser, maxChars, previousError) {
  try {
    const url = new URL(browser.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const maxBytes = Math.min(2500000, Math.max(1000000, maxChars * 8));
    const html = await fetchTextWithLimit(url.toString(), maxBytes);
    const extracted = extractHtmlPage(html, maxChars, browser.url);
    const fallbackText = [extracted.metaDescription, ...(extracted.headings || [])].filter(Boolean).join('\n');
    const text = extracted.text || fallbackText.slice(0, maxChars);
    return {
      available: true,
      supported: true,
      app: browser.app,
      title: extracted.title || browser.title,
      url: browser.url,
      text,
      selectedText: '',
      textLength: extracted.textLength || text.length,
      truncated: extracted.truncated || fallbackText.length > maxChars,
      headings: extracted.headings,
      metaDescription: extracted.metaDescription,
      links: extracted.links,
      fallback: 'url_fetch',
      error: previousError ? `${previousError}; used url_fetch fallback` : '',
    };
  } catch {
    return null;
  }
}

function browserPageFromMetadata(browser, previousError) {
  const text = [`Title: ${browser.title || ''}`, `URL: ${browser.url || ''}`].join('\n').trim();
  return {
    available: true,
    supported: Boolean(browser.supported),
    app: browser.app || '',
    title: browser.title || '',
    url: browser.url || '',
    text,
    selectedText: '',
    textLength: text.length,
    truncated: false,
    headings: [],
    metaDescription: '',
    links: [],
    fallback: 'metadata_only',
    error: previousError ? 'browser_text_unavailable; using title and URL only' : '',
  };
}

async function browserPageSnapshot(options = {}) {
  const actionConfig = actionPolicy.allow?.read_browser_page;
  if (!actionConfig?.enabled) {
    return {
      available: false,
      supported: false,
      app: '',
      title: '',
      url: '',
      text: '',
      selectedText: '',
      textLength: 0,
      truncated: false,
      headings: [],
      metaDescription: '',
      links: [],
      error: 'read_browser_page_disabled_by_policy',
    };
  }

  const maxChars = normalizeBrowserMaxChars(options.maxChars);
  const browser = await browserContextSnapshot({ app: options.app });
  if (!browser.available || !browser.supported) {
    return {
      ...browser,
      text: '',
      selectedText: '',
      textLength: 0,
      truncated: false,
      headings: [],
      metaDescription: '',
      links: [],
    };
  }

  const js = `
(() => {
  const max = ${JSON.stringify(maxChars)};
  const maxLinks = ${JSON.stringify(MAX_BROWSER_PAGE_LINKS)};
  const clean = (value) => String(value || '').replace(/[\\t\\r ]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const visible = (node) => {
    try {
      const style = window.getComputedStyle(node);
      return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && node.getClientRects().length > 0;
    } catch (_) {
      return false;
    }
  };
  const selectedText = clean(window.getSelection ? window.getSelection().toString() : '');
  const bodyText = clean(document.body ? document.body.innerText : '');
  const text = selectedText || bodyText;
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .map((node) => clean(node.innerText))
    .filter(Boolean)
    .slice(0, 40);
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter(visible)
    .map((node) => ({
      text: clean(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || ''),
      href: node.href || node.getAttribute('href') || '',
      title: clean(node.getAttribute('title') || ''),
      ariaLabel: clean(node.getAttribute('aria-label') || '')
    }))
    .filter((link) => link.href)
    .slice(0, maxLinks * 4);
  return JSON.stringify({
    title: document.title || '',
    url: location.href,
    selectedText: selectedText.slice(0, max),
    text: text.slice(0, max),
    textLength: text.length,
    truncated: text.length > max,
    headings,
    metaDescription: meta ? clean(meta.getAttribute('content') || '') : '',
    links
  });
})()
  `.trim();

  try {
    const page = await executeBrowserJavaScriptBridge(browser, js, { timeoutMs: 5000, maxBuffer: 1024 * 1024 * 4 });
    const parsed = JSON.parse(String(page.output || '').trim());
    const result = {
      available: true,
      supported: true,
      bridge: page.bridge,
      app: browser.app,
      title: parsed.title || browser.title,
      url: parsed.url || browser.url,
      text: String(parsed.text || ''),
      selectedText: String(parsed.selectedText || ''),
      textLength: Number(parsed.textLength || 0),
      truncated: Boolean(parsed.truncated),
      headings: Array.isArray(parsed.headings) ? parsed.headings.map(String) : [],
      metaDescription: String(parsed.metaDescription || ''),
      links: normalizeBrowserLinks(parsed.links, parsed.url || browser.url),
      error: '',
    };
    appendAudit('browser_page.read', {
      app: result.app,
      url: result.url,
      textLength: result.textLength,
      returnedLength: result.text.length,
      truncated: result.truncated,
      linkCount: result.links.length,
      bridge: result.bridge,
    });
    return result;
  } catch (error) {
    const message = compactBrowserJavaScriptError(error);
    const fileFallback = browserPageFromFileUrl(browser, maxChars, message);
    if (fileFallback) {
      appendAudit('browser_page.read', {
        app: fileFallback.app,
        url: fileFallback.url,
        textLength: fileFallback.textLength,
        returnedLength: fileFallback.text.length,
        truncated: fileFallback.truncated,
        linkCount: fileFallback.links?.length || 0,
        fallback: fileFallback.fallback,
      });
      return fileFallback;
    }
    const httpFallback = await browserPageFromHttpUrl(browser, maxChars, message);
    if (httpFallback) {
      appendAudit('browser_page.read', {
        app: httpFallback.app,
        url: httpFallback.url,
        textLength: httpFallback.textLength,
        returnedLength: httpFallback.text.length,
        truncated: httpFallback.truncated,
        linkCount: httpFallback.links?.length || 0,
        fallback: httpFallback.fallback,
      });
      return httpFallback;
    }
    const metadataFallback = browserPageFromMetadata(browser, message);
    appendAudit('browser_page.read', {
      app: metadataFallback.app,
      url: metadataFallback.url,
      textLength: metadataFallback.textLength,
      returnedLength: metadataFallback.text.length,
      truncated: metadataFallback.truncated,
      linkCount: 0,
      fallback: metadataFallback.fallback,
    });
    return metadataFallback;
  }
}

async function executeBrowserJavaScript(browser, js, options = {}) {
  const appName = browser?.app || String(options.app || '').trim();
  if (!appName) throw new Error('No supported browser is active.');
  const isSafari = appName === 'Safari' || appName === 'Safari Technology Preview';
  const quotedApp = appleScriptString(appName);
  const quotedJs = appleScriptString(js);
  const script = isSafari
    ? [
        `tell application ${quotedApp}`,
        '  if not (exists front document) then error "No front document"',
        `  set pageResult to do JavaScript ${quotedJs} in front document`,
        'end tell',
        'return pageResult',
      ].join('\n')
    : [
        `tell application ${quotedApp}`,
        '  if not (exists front window) then error "No front window"',
        `  set pageResult to execute active tab of front window javascript ${quotedJs}`,
        'end tell',
        'return pageResult',
      ].join('\n');
  const { stdout } = await execFileAsync('osascript', ['-e', script], {
    timeout: Math.max(1000, Math.min(15000, Number(options.timeoutMs || 6000))),
    maxBuffer: Math.max(1024 * 256, Math.min(1024 * 1024 * 8, Number(options.maxBuffer || 1024 * 1024 * 4))),
  });
  return String(stdout || '').trim();
}

function compactBrowserJavaScriptError(error) {
  const message = String(error?.stderr || (error instanceof Error ? error.message : error) || '');
  if (/AppleScript.*JavaScript|Apple Events|Apple 事件|执行 JavaScript 的功能已关闭|Allow JavaScript from Apple Events/i.test(message)) {
    return 'browser_javascript_from_apple_events_disabled';
  }
  if (/ECONNREFUSED|fetch failed|Failed to fetch/i.test(message)) {
    return 'browser_cdp_unavailable';
  }
  if (/WebSocket/i.test(message)) {
    return 'browser_cdp_websocket_error';
  }
  if (/cdp/i.test(message)) {
    return compactRecordText(message.split('\n')[0], 220) || 'browser_cdp_unavailable';
  }
  return message.split('\n')[0].slice(0, 500) || 'browser_javascript_unavailable';
}

function cdpBaseUrl() {
  return `http://127.0.0.1:${CHROME_DEBUG_PORT}`;
}

async function cdpFetchJson(pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Math.min(5000, Number(options.timeoutMs || 1200))));
  try {
    const response = await fetch(`${cdpBaseUrl()}${pathname}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`cdp_http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function cdpTargetsSnapshot() {
  const targets = await cdpFetchJson('/json/list');
  return Array.isArray(targets) ? targets : [];
}

function normalizeBrowserUrlForMatch(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.toString();
  } catch {
    return String(value || '').trim();
  }
}

function chooseCdpTarget(targets = [], browser = {}) {
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const browserUrl = normalizeBrowserUrlForMatch(browser.url || '');
  if (browserUrl) {
    const exact = pages.find((target) => normalizeBrowserUrlForMatch(target.url || '') === browserUrl);
    if (exact) return exact;
  }
  const title = String(browser.title || '').trim();
  if (title) {
    const titleHit = pages.find((target) => String(target.title || '').trim() === title);
    if (titleHit) return titleHit;
  }
  return pages.find((target) => /^https?:|^file:/i.test(String(target.url || ''))) || pages[0] || null;
}

async function cdpStatusSnapshot(browser = {}) {
  if (!CHROME_DEBUG_PORT) {
    return { enabled: false, port: CHROME_DEBUG_PORT, targets: 0, selectedTarget: null, error: 'chrome_debug_port_disabled' };
  }
  if (typeof WebSocket !== 'function') {
    return { enabled: false, port: CHROME_DEBUG_PORT, targets: 0, selectedTarget: null, error: 'websocket_unavailable' };
  }
  try {
    await cdpFetchJson('/json/version');
    const targets = await cdpTargetsSnapshot();
    const selected = chooseCdpTarget(targets, browser);
    return {
      enabled: Boolean(selected),
      port: CHROME_DEBUG_PORT,
      targets: targets.length,
      selectedTarget: selected
        ? {
            id: selected.id || '',
            title: selected.title || '',
            url: selected.url || '',
          }
        : null,
      error: selected ? '' : 'no_cdp_page_target',
    };
  } catch (error) {
    return {
      enabled: false,
      port: CHROME_DEBUG_PORT,
      targets: 0,
      selectedTarget: null,
      error: compactBrowserJavaScriptError(error) || 'browser_cdp_unavailable',
    };
  }
}

function chromeExecutableForApp(appName = '') {
  const name = String(appName || '').trim();
  const candidates = name === 'Google Chrome Canary'
    ? ['/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

async function waitForCdpReady(browser = {}, timeoutMs = 5000) {
  const deadline = Date.now() + Math.max(1000, Math.min(15000, Number(timeoutMs || 5000)));
  let last = null;
  while (Date.now() < deadline) {
    last = await cdpStatusSnapshot(browser);
    if (last.enabled) return last;
    await waitMs(350);
  }
  return last || await cdpStatusSnapshot(browser);
}

async function launchChromeCdpFallback(browser = {}) {
  const appName = browser.app || 'Google Chrome';
  if (!CHROME_DEBUG_PORT || !['Google Chrome', 'Google Chrome Canary'].includes(appName)) {
    return { ok: false, launched: false, error: 'chrome_cdp_fallback_unsupported_app' };
  }
  const executable = chromeExecutableForApp(appName);
  if (!executable) return { ok: false, launched: false, error: 'chrome_executable_not_found' };
  fs.mkdirSync(CHROME_CDP_PROFILE_DIR, { recursive: true });
  const url = /^https?:|^file:/i.test(String(browser.url || '')) ? browser.url : 'about:blank';
  const child = spawn(executable, [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${CHROME_CDP_PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  appendAudit('browser_cdp.launch_requested', {
    app: appName,
    port: CHROME_DEBUG_PORT,
    profileDir: CHROME_CDP_PROFILE_DIR,
    url,
    pid: child.pid || null,
  });
  const status = await waitForCdpReady({ ...browser, url }, 7000);
  return {
    ok: Boolean(status.enabled),
    launched: true,
    status,
    error: status.enabled ? '' : status.error || 'browser_cdp_unavailable_after_launch',
  };
}

function cdpEvaluateExpression(webSocketUrl, expression, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.max(1000, Math.min(10000, Number(options.timeoutMs || 5000)));
    const ws = new WebSocket(webSocketUrl);
    const requestId = 1;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // Ignore close failures.
      }
      reject(new Error('browser_cdp_evaluate_timeout'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: requestId,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true,
        },
      }));
    });
    ws.addEventListener('message', (event) => {
      let data = null;
      try {
        data = JSON.parse(String(event.data || ''));
      } catch {
        return;
      }
      if (data.id !== requestId) return;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Ignore close failures.
      }
      if (data.error) {
        reject(new Error(data.error.message || 'browser_cdp_evaluate_failed'));
        return;
      }
      if (data.result?.exceptionDetails) {
        reject(new Error(data.result.exceptionDetails.text || 'browser_cdp_runtime_exception'));
        return;
      }
      resolve(data.result?.result?.value ?? '');
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('browser_cdp_websocket_error'));
    });
  });
}

async function executeBrowserJavaScriptViaCdp(browser, js, options = {}) {
  const targets = await cdpTargetsSnapshot();
  const target = chooseCdpTarget(targets, browser);
  if (!target?.webSocketDebuggerUrl) throw new Error('browser_cdp_target_not_found');
  const output = await cdpEvaluateExpression(target.webSocketDebuggerUrl, js, options);
  return String(output || '');
}

async function executeBrowserJavaScriptBridge(browser, js, options = {}) {
  try {
    return {
      output: await executeBrowserJavaScript(browser, js, options),
      bridge: 'apple_events',
    };
  } catch (appleError) {
    const appleMessage = compactBrowserJavaScriptError(appleError);
    try {
      return {
        output: await executeBrowserJavaScriptViaCdp(browser, js, options),
        bridge: 'cdp',
        appleError: appleMessage,
      };
    } catch (cdpError) {
      const cdpMessage = compactBrowserJavaScriptError(cdpError);
      if (appleMessage === 'browser_javascript_from_apple_events_disabled' && ['browser_cdp_unavailable', 'browser_cdp_target_not_found'].includes(cdpMessage)) {
        const launched = await launchChromeCdpFallback(browser);
        if (launched.ok) {
          return {
            output: await executeBrowserJavaScriptViaCdp(browser, js, options),
            bridge: 'cdp',
            appleError: appleMessage,
            cdpLaunched: true,
          };
        }
      }
      const error = new Error(appleMessage || compactBrowserJavaScriptError(cdpError));
      error.appleError = appleMessage;
      error.cdpError = cdpMessage;
      throw error;
    }
  }
}

async function browserJavaScriptStatusSnapshot(options = {}) {
  const browser = await browserContextSnapshot({ app: options.app });
  if (!browser.supported || !browser.available) {
    return {
      available: false,
      supported: Boolean(browser.supported),
      enabled: false,
      app: browser.app || '',
      title: browser.title || '',
      url: browser.url || '',
      error: browser.error || 'no_supported_browser_page',
    };
  }
  const cdp = await cdpStatusSnapshot(browser);
  try {
    const result = await executeBrowserJavaScriptBridge(browser, 'JSON.stringify({ ok: true, title: document.title || "", url: location.href })', {
      timeoutMs: 3000,
      maxBuffer: 1024 * 256,
    });
    const raw = result.output;
    const parsed = JSON.parse(raw || '{}');
    return {
      available: true,
      supported: true,
      enabled: parsed.ok === true,
      bridge: result.bridge,
      appleEventsEnabled: result.bridge === 'apple_events',
      cdpEnabled: result.bridge === 'cdp',
      cdp,
      app: browser.app,
      title: parsed.title || browser.title,
      url: parsed.url || browser.url,
      error: '',
    };
  } catch (error) {
    return {
      available: true,
      supported: true,
      enabled: false,
      bridge: '',
      appleEventsEnabled: false,
      cdpEnabled: false,
      cdp,
      app: browser.app,
      title: browser.title,
      url: browser.url,
      error: compactBrowserJavaScriptError(error),
      appleError: error.appleError || '',
      cdpError: error.cdpError || '',
    };
  }
}

function browserDomSnapshotScript(limit) {
  return `
(() => {
  const limit = ${JSON.stringify(limit)};
  const clean = (value, max = 180) => String(value || '')
    .replace(/[\\t\\r\\n ]+/g, ' ')
    .trim()
    .slice(0, max);
  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char);
  };
  const attrEscape = (value) => String(value).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const selectorFor = (el) => {
    if (el.id) {
      const selector = '#' + cssEscape(el.id);
      if (document.querySelectorAll(selector).length === 1) return selector;
    }
    for (const attr of ['data-testid', 'data-test', 'aria-label', 'name', 'placeholder', 'title']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const selector = el.tagName.toLowerCase() + '[' + attr + '="' + attrEscape(value) + '"]';
      try {
        if (document.querySelectorAll(selector).length === 1) return selector;
      } catch (_) {}
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 5) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) break;
      const sameTag = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = sameTag.indexOf(node) + 1;
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      const selector = parts.join(' > ');
      try {
        if (document.querySelector(selector) === el) return selector;
      } catch (_) {}
      node = parent;
    }
    return parts.join(' > ');
  };
  const labelsFor = (el) => {
    const values = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.innerText,
      el.textContent,
    ];
    if (el.id) {
      const label = document.querySelector('label[for="' + attrEscape(el.id) + '"]');
      if (label) values.unshift(label.innerText);
    }
    if (el.labels) {
      for (const label of Array.from(el.labels)) values.unshift(label.innerText);
    }
    if (['button', 'submit', 'reset'].includes(String(el.type || '').toLowerCase())) values.unshift(el.value);
    return values.map((value) => clean(value)).filter(Boolean);
  };
  const selector = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const elements = Array.from(document.querySelectorAll(selector))
    .filter(visible)
    .slice(0, limit)
    .map((el, index) => {
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const type = clean(el.getAttribute('type') || el.getAttribute('role') || '', 40);
      const labels = labelsFor(el);
      const label = labels[0] || '';
      const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true');
      const valuePreview = tag === 'select'
        ? clean(el.options?.[el.selectedIndex]?.text || '', 80)
        : (['checkbox', 'radio'].includes(String(el.type || '').toLowerCase()) ? String(Boolean(el.checked)) : '');
      return {
        id: String(index + 1),
        selector: selectorFor(el),
        tag,
        type,
        role: clean(el.getAttribute('role') || '', 60),
        label,
        text: clean(el.innerText || el.textContent || '', 160),
        placeholder: clean(el.getAttribute('placeholder') || '', 100),
        name: clean(el.getAttribute('name') || '', 80),
        href: clean(el.getAttribute('href') || '', 220),
        valuePreview,
        disabled,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  return JSON.stringify({
    available: true,
    title: document.title || '',
    url: location.href,
    count: elements.length,
    elements
  });
})()
  `.trim();
}

async function browserDomSnapshot(options = {}) {
  const actionConfig = actionPolicy.allow?.read_browser_page;
  if (!actionConfig?.enabled) {
    return {
      available: false,
      supported: false,
      app: '',
      title: '',
      url: '',
      count: 0,
      elements: [],
      error: 'read_browser_page_disabled_by_policy',
    };
  }
  const browser = await browserContextSnapshot({ app: options.app });
  if (!browser.available || !browser.supported) {
    return {
      ...browser,
      count: 0,
      elements: [],
    };
  }
  const limit = Math.max(1, Math.min(120, Number(options.limit || 60)));
  try {
    const snapshot = await executeBrowserJavaScriptBridge(browser, browserDomSnapshotScript(limit), { timeoutMs: 6000 });
    const parsed = JSON.parse(snapshot.output || '{}');
    const result = {
      available: true,
      supported: true,
      bridge: snapshot.bridge,
      app: browser.app,
      title: String(parsed.title || browser.title || ''),
      url: String(parsed.url || browser.url || ''),
      count: Number(parsed.count || 0),
      elements: Array.isArray(parsed.elements) ? parsed.elements.slice(0, limit) : [],
      error: '',
    };
    appendAudit('browser_dom.read', {
      app: result.app,
      url: result.url,
      count: result.count,
      returned: result.elements.length,
      bridge: result.bridge,
    });
    return result;
  } catch (error) {
    return {
      available: false,
      supported: true,
      app: browser.app,
      title: browser.title,
      url: browser.url,
      count: 0,
      elements: [],
      error: compactBrowserJavaScriptError(error),
      appleError: error.appleError || '',
      cdpError: error.cdpError || '',
    };
  }
}

const BROWSER_DOM_ACTIONS = new Set(['click', 'fill', 'select']);
const BROWSER_DOM_DANGEROUS_RE = /\b(submit|send|buy|purchase|pay|checkout|delete|remove|destroy|confirm|login|log in|sign in|sign up|register|subscribe|unsubscribe|post|publish|share|transfer|withdraw|deposit|trade)\b|提交|发送|购买|付款|支付|删除|移除|确认|登录|注册|发布|分享|转账|提现|充值|交易/i;

function normalizeBrowserDomAction(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const aliases = {
    press: 'click',
    tap: 'click',
    choose: 'select',
    set: 'fill',
    set_value: 'fill',
    type: 'fill',
    input: 'fill',
    点击: 'click',
    按: 'click',
    选择: 'select',
    填写: 'fill',
    输入: 'fill',
  };
  const normalized = aliases[raw] || raw;
  return BROWSER_DOM_ACTIONS.has(normalized) ? normalized : '';
}

function browserDomActionRisk(args = {}, domAction = '') {
  const text = [
    args.query,
    args.label,
    args.text,
    args.selector,
    args.expectedText,
    args.value,
  ].map((item) => String(item || '')).join(' ');
  if (BROWSER_DOM_DANGEROUS_RE.test(text)) return 4;
  if (domAction === 'click') return 3;
  if (domAction === 'fill' || domAction === 'select') return 3;
  return 2;
}

function buildBrowserDomActionPlan(args = {}) {
  const domAction = normalizeBrowserDomAction(args.domAction || args.browserAction || args.action);
  if (!domAction) throw new Error('Unsupported browser DOM action.');
  const browserAction = `dom_${domAction}`;
  const actionConfig = actionPolicy.allow?.browser_control || {};
  if (!valueMatchesAllowlist(browserAction, actionConfig.allowedActions || [])) {
    throw new Error(`Browser action ${browserAction} is not allowed by policy.`);
  }
  const selector = String(args.selector || '').trim().slice(0, 500);
  const query = String(args.query || args.label || args.text || '').trim().slice(0, 300);
  const value = String(args.value ?? args.content ?? '').slice(0, 4000);
  if (!selector && !query) throw new Error('Browser DOM action requires selector or query.');
  if ((domAction === 'fill' || domAction === 'select') && !value) throw new Error('Browser DOM fill/select requires value.');
  const target = selector || query;
  return {
    action: 'browser_control',
    riskLevel: browserDomActionRisk({ ...args, selector, query, value }, domAction),
    summary: domAction === 'click'
      ? `Click browser element ${compactRecordText(target, 120)}`
      : `${domAction === 'select' ? 'Select' : 'Fill'} browser element ${compactRecordText(target, 120)}`,
    target: browserAction,
    args: {
      action: 'browser_control',
      browserAction,
      domAction,
      app: String(args.app || '').trim(),
      selector,
      query,
      value,
    },
    metadata: { browserAction, domAction },
  };
}

function browserDomActionScript(plan) {
  const args = plan.args || {};
  return `
(() => {
  const domAction = ${JSON.stringify(args.domAction)};
  const selector = ${JSON.stringify(args.selector || '')};
  const query = ${JSON.stringify(args.query || '')}.toLowerCase();
  const value = ${JSON.stringify(args.value || '')};
  const clean = (input, max = 220) => String(input || '').replace(/[\\t\\r\\n ]+/g, ' ').trim().slice(0, max);
  const attrEscape = (input) => String(input).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const visible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const labelOf = (el) => {
    const values = [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('alt'),
      el.getAttribute('placeholder'),
      el.getAttribute('name'),
      el.innerText,
      el.textContent,
    ];
    if (el.id) {
      const label = document.querySelector('label[for="' + attrEscape(el.id) + '"]');
      if (label) values.unshift(label.innerText);
    }
    if (el.labels) {
      for (const label of Array.from(el.labels)) values.unshift(label.innerText);
    }
    if (['button', 'submit', 'reset'].includes(String(el.type || '').toLowerCase())) values.unshift(el.value);
    return values.map((item) => clean(item)).filter(Boolean)[0] || '';
  };
  const selectorFor = (el) => {
    if (el.id) return '#' + (window.CSS?.escape ? CSS.escape(el.id) : String(el.id).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char));
    return el.tagName.toLowerCase();
  };
  const interactive = [
    'a[href]', 'button', 'input', 'textarea', 'select',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
    '[contenteditable="true"]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  let target = null;
  if (selector) {
    target = document.querySelector(selector);
  } else {
    target = Array.from(document.querySelectorAll(interactive))
      .filter(visible)
      .find((el) => labelOf(el).toLowerCase().includes(query) || clean(el.innerText || el.textContent).toLowerCase().includes(query));
  }
  if (!target) throw new Error('browser_dom_target_not_found');
  if (!visible(target)) throw new Error('browser_dom_target_not_visible');
  const tag = target.tagName.toLowerCase();
  const type = String(target.getAttribute('type') || '').toLowerCase();
  const label = labelOf(target);
  if (target.disabled || target.getAttribute('aria-disabled') === 'true') throw new Error('browser_dom_target_disabled');
  if ((domAction === 'fill' || domAction === 'select') && type === 'password') throw new Error('browser_dom_password_field_blocked');
  target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  if (typeof target.focus === 'function') target.focus();
  if (domAction === 'click') {
    target.click();
  } else if (domAction === 'select') {
    if (tag !== 'select') throw new Error('browser_dom_target_is_not_select');
    const option = Array.from(target.options).find((item) => item.value === value || clean(item.text).toLowerCase() === value.toLowerCase() || clean(item.text).toLowerCase().includes(value.toLowerCase()));
    if (!option) throw new Error('browser_dom_select_option_not_found');
    target.value = option.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (domAction === 'fill') {
    if (target.isContentEditable) {
      target.textContent = value;
    } else if (tag === 'input' || tag === 'textarea') {
      target.value = value;
    } else {
      throw new Error('browser_dom_target_not_fillable');
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    throw new Error('unsupported_browser_dom_action:' + domAction);
  }
  const rect = target.getBoundingClientRect();
  return JSON.stringify({
    ok: true,
    action: domAction,
    selector: selector || selectorFor(target),
    tag,
    type,
    label,
    url: location.href,
    title: document.title || '',
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
  });
})()
  `.trim();
}

async function runBrowserDomActionPlan(plan, evaluation) {
  if (evaluation.dryRun) {
    appendAudit('browser_dom.dry_run', {
      action: plan.args.domAction,
      riskLevel: plan.riskLevel,
      summary: plan.summary,
    });
    return `[dry-run] ${plan.summary}`;
  }
  const browser = await browserContextSnapshot({ app: plan.args.app });
  if (!browser.supported || !browser.available) throw new Error(browser.error || 'frontmost_app_is_not_supported_browser');
  const executed = await executeBrowserJavaScriptBridge(browser, browserDomActionScript(plan), { timeoutMs: 6000 });
  const result = JSON.parse(executed.output || '{}');
  appendAudit('browser_dom.executed', {
    app: browser.app,
    action: plan.args.domAction,
    selector: result.selector,
    label: compactRecordText(result.label, 120),
    url: result.url || browser.url,
    bridge: executed.bridge,
  });
  return `${result.action} executed on ${result.tag}${result.label ? ` "${result.label}"` : ''}.`;
}

async function executeBrowserDomAction(args = {}, options = {}) {
  const plan = buildBrowserDomActionPlan(args);
  const preview = args.execute === false || options.preview === true;
  appendAudit('browser_dom.requested', {
    action: plan.args.domAction,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
    preview,
    approved: Boolean(options.approved),
  });
  const evaluation = evaluateMacActionPlan(plan, { ...options, preview });
  if (preview) {
    return {
      ok: !evaluation.blocked,
      executed: false,
      action: plan.args.domAction,
      output: `Prepared ${plan.summary}${evaluation.needsApproval ? ` (${evaluation.reason})` : ''}.`,
      plan,
      evaluation,
    };
  }
  const output = await runBrowserDomActionPlan(plan, evaluation);
  appendAudit('browser_dom.completed', {
    action: plan.args.domAction,
    riskLevel: plan.riskLevel,
    dryRun: evaluation.dryRun,
  });
  return {
    ok: true,
    executed: !evaluation.dryRun,
    action: plan.args.domAction,
    output,
    plan,
  };
}

const BROWSER_CONTROL_ACTIONS = new Set([
  'back',
  'forward',
  'reload',
  'new_tab',
  'close_tab',
  'focus_address',
  'open_url',
  'search',
]);

function normalizeBrowserControlAction(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const aliases = {
    refresh: 'reload',
    reload_page: 'reload',
    newtab: 'new_tab',
    new: 'new_tab',
    close: 'close_tab',
    close_current_tab: 'close_tab',
    address: 'focus_address',
    focus_url: 'focus_address',
    open: 'open_url',
    navigate: 'open_url',
    google: 'search',
    web_search: 'search',
    后退: 'back',
    返回: 'back',
    前进: 'forward',
    刷新: 'reload',
    新标签: 'new_tab',
    新建标签: 'new_tab',
    关闭标签: 'close_tab',
    地址栏: 'focus_address',
    打开网址: 'open_url',
    搜索: 'search',
  };
  const normalized = aliases[raw] || raw;
  return BROWSER_CONTROL_ACTIONS.has(normalized) ? normalized : '';
}

function browserControlUrl(args = {}) {
  const action = normalizeBrowserControlAction(args.browserAction || args.action);
  if (action === 'search') {
    const query = String(args.query || args.value || args.text || '').trim();
    if (!query) throw new Error('Browser search requires query.');
    return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  }
  if (action === 'open_url') {
    const raw = String(args.url || args.value || '').trim();
    if (!/^https?:\/\//i.test(raw)) throw new Error('Browser open_url requires an http/https URL.');
    return new URL(raw).href;
  }
  return '';
}

function buildBrowserControlPlan(args = {}) {
  const browserAction = normalizeBrowserControlAction(args.browserAction || args.action);
  if (!browserAction) throw new Error('Unsupported browser control action.');
  const actionConfig = actionPolicy.allow?.browser_control || {};
  if (!valueMatchesAllowlist(browserAction, actionConfig.allowedActions || [])) {
    throw new Error(`Browser action ${browserAction} is not allowed by policy.`);
  }
  const url = browserControlUrl({ ...args, browserAction });
  if (url && !valueMatchesAllowlist(new URL(url).hostname, actionPolicy.allow?.open_url?.allowedHosts || [])) {
    throw new Error(`URL host ${new URL(url).hostname} is not allowed by policy.`);
  }
  const riskLevel = browserAction === 'close_tab' ? 3 : 2;
  const app = String(args.app || '').trim();
  const query = String(args.query || args.text || args.value || '').trim();
  return {
    action: 'browser_control',
    riskLevel,
    summary: browserAction === 'open_url'
      ? `Open browser URL ${url}`
      : browserAction === 'search'
        ? `Search the web for ${query}`
        : `Browser ${browserAction}`,
    target: browserAction,
    args: {
      action: 'browser_control',
      browserAction,
      app,
      url,
      query,
    },
    metadata: { browserAction },
  };
}

async function runBrowserControlPlan(plan, evaluation) {
  if (evaluation.dryRun) {
    appendAudit('browser_control.dry_run', {
      action: plan.args.browserAction,
      riskLevel: plan.riskLevel,
      summary: plan.summary,
    });
    return `[dry-run] ${plan.summary}`;
  }

  const browser = await browserContextSnapshot({ app: plan.args.app });
  if (!browser.supported) throw new Error(browser.error || 'frontmost_app_is_not_supported_browser');
  const appName = browser.app || plan.args.app;
  if (!appName) throw new Error('No supported browser is active.');
  const quotedApp = appleScriptString(appName);
  const browserAction = plan.args.browserAction;
  const keyMap = {
    back: '[',
    forward: ']',
    reload: 'r',
    new_tab: 't',
    close_tab: 'w',
    focus_address: 'l',
  };

  if (browserAction === 'open_url' || browserAction === 'search') {
    const url = plan.args.url;
    const isSafari = appName === 'Safari' || appName === 'Safari Technology Preview';
    const script = isSafari
      ? [
          `tell application ${quotedApp}`,
          '  activate',
          '  if not (exists front document) then make new document',
          `  set URL of front document to ${appleScriptString(url)}`,
          'end tell',
        ].join('\n')
      : [
          `tell application ${quotedApp}`,
          '  activate',
          '  if not (exists front window) then make new window',
          `  set URL of active tab of front window to ${appleScriptString(url)}`,
          'end tell',
        ].join('\n');
    await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
    appendAudit('browser_control.executed', { app: appName, action: browserAction, url });
    return browserAction === 'search'
      ? `Searched in ${appName}: ${plan.args.query}`
      : `Opened in ${appName}: ${url}`;
  }

  const key = keyMap[browserAction];
  if (!key) throw new Error(`Unsupported browser control action: ${browserAction}`);
  const script = [
    `tell application ${quotedApp} to activate`,
    `tell application "System Events" to keystroke ${appleScriptString(key)} using {command down}`,
  ].join('\n');
  await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  appendAudit('browser_control.executed', { app: appName, action: browserAction });
  return `Browser ${browserAction} executed in ${appName}.`;
}

async function executeBrowserControl(args = {}, options = {}) {
  const plan = buildBrowserControlPlan(args);
  appendAudit('browser_control.requested', {
    action: plan.args.browserAction,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
    approved: Boolean(options.approved),
  });
  const evaluation = evaluateMacActionPlan(plan, options);
  const output = await runBrowserControlPlan(plan, evaluation);
  appendAudit('browser_control.completed', {
    action: plan.args.browserAction,
    riskLevel: plan.riskLevel,
    dryRun: evaluation.dryRun,
  });
  return {
    ok: true,
    executed: !evaluation.dryRun,
    action: plan.args.browserAction,
    output,
  };
}

function normalizeBrowserWorkflowIntent(value) {
  const intent = String(value || '').trim();
  if (['summarize', 'extract_actions', 'draft', 'ask', 'act', 'search', 'compare', 'review_result', 'research'].includes(intent)) return intent;
  return 'summarize';
}

function normalizeBrowserWorkflowMode(value) {
  const mode = String(value || '').trim();
  if (['quick', 'background', 'codex', 'claude'].includes(mode)) return mode;
  return 'quick';
}

function browserWorkflowPageSummary(page) {
  return {
    available: Boolean(page.available),
    supported: Boolean(page.supported),
    app: page.app || '',
    title: page.title || '',
    url: page.url || '',
    selectedTextLength: page.selectedText?.length || 0,
    returnedLength: page.text?.length || 0,
    textLength: page.textLength || 0,
    truncated: Boolean(page.truncated),
    fallback: page.fallback || '',
    error: page.error || '',
    headings: Array.isArray(page.headings) ? page.headings.slice(0, 10) : [],
    linkCount: Array.isArray(page.links) ? page.links.length : 0,
    links: Array.isArray(page.links) ? page.links.slice(0, 12) : [],
    searchResults: browserSearchResultLinks(page, 8),
  };
}

function browserWorkflowPrompt(page, intent, instruction) {
  const taskMap = {
    summarize: '总结当前网页，给出关键结论、重要细节、用户下一步可以做什么。',
    extract_actions: '从当前网页提取行动项、截止日期、待办、风险和需要用户确认的事项。',
    draft: '基于当前网页起草一段可直接使用的中文内容；如果用户给了具体要求，严格按要求写。',
    ask: '回答用户关于当前网页的问题；如果网页内容不足，说明缺口。',
    act: '规划并执行当前网页上的安全浏览器操作。',
    search: '搜索网页并总结结果页。',
    compare: '搜索多个查询并比较结果页。',
    review_result: '打开一个搜索结果或 URL，读取目标页面并总结可执行结论。',
    research: '搜索并读取多个结果页面，综合出结论和下一步。',
  };
  const pageText = page.selectedText || page.text || '';
  return [
    `Browser workflow: ${intent} · ${page.title || page.url || 'current page'}`,
    '',
    `User request: ${instruction || taskMap[intent]}`,
    '',
    'Page:',
    `Title: ${page.title || ''}`,
    `URL: ${page.url || ''}`,
    page.metaDescription ? `Description: ${page.metaDescription}` : '',
    page.headings?.length ? `Headings: ${page.headings.slice(0, 16).join(' / ')}` : '',
    browserWorkflowLinksBlock(page) ? `Links:\n${browserWorkflowLinksBlock(page)}` : '',
    '',
    'Page text:',
    pageText,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function normalizeBrowserSearchQueries(options = {}) {
  const rawList = Array.isArray(options.queries)
    ? options.queries
    : Array.isArray(options.query)
      ? options.query
      : [];
  const textQuery = String(options.query || options.instruction || '').trim();
  const splitTextQueries = textQuery
    ? textQuery.split(/\n|;|；|\s+\|\s+/).map((item) => item.trim()).filter(Boolean)
    : [];
  const queries = [...rawList, ...splitTextQueries]
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return Array.from(new Set(queries)).slice(0, MAX_BROWSER_SEARCH_QUERIES);
}

function browserSearchWorkflowPrompt(searches = [], intent = 'search', instruction = '') {
  const payload = searches.map((item, index) => ({
    index: index + 1,
    query: item.query,
    app: item.page?.app || '',
    title: item.page?.title || '',
    url: item.page?.url || '',
    headings: item.page?.headings?.slice(0, 12) || [],
    links: Array.isArray(item.page?.links) ? item.page.links.slice(0, 12) : [],
    candidateResultLinks: browserSearchResultLinks(item.page, 8),
    text: compactRecordText(item.page?.selectedText || item.page?.text || '', 5000),
    error: item.page?.error || '',
  }));
  return [
    `Browser ${intent} workflow.`,
    `User request: ${instruction || searches.map((item) => item.query).join(' ; ')}`,
    '',
    'Use only these browser search result page snapshots. Do not invent facts beyond them.',
    intent === 'compare'
      ? 'Compare the result pages, identify overlaps, conflicts, strongest next links/queries, and concrete next actions.'
      : 'Summarize the result page, identify likely useful next links/queries, and concrete next actions.',
    'Answer in concise Chinese.',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

function browserFailedPageSummary(error) {
  const message = error instanceof Error ? error.message : String(error || 'page unavailable');
  return {
    available: false,
    supported: false,
    app: '',
    title: '',
    url: '',
    selectedTextLength: 0,
    returnedLength: 0,
    textLength: 0,
    truncated: false,
    fallback: '',
    error: message,
    headings: [],
    linkCount: 0,
    links: [],
    searchResults: [],
  };
}

function browserReviewExplicitUrl(options = {}) {
  const direct = String(options.url || options.href || '').trim();
  const instruction = String(options.instruction || options.query || '').trim();
  const fromText = instruction.match(/https?:\/\/[^\s"'<>）)]+/i)?.[0] || '';
  return normalizeBrowserHref(direct || fromText);
}

function normalizeBrowserResultIndex(value) {
  const parsed = Number(value || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(MAX_BROWSER_PAGE_LINKS, Math.floor(parsed)));
}

function selectBrowserReviewLink(candidates = [], options = {}) {
  const links = Array.isArray(candidates) ? candidates : [];
  if (!links.length) return null;
  const preferredHost = String(options.host || options.domain || '').trim().replace(/^www\./i, '').toLowerCase();
  if (preferredHost) {
    const hostHit = links.find((link) => String(link.host || '').toLowerCase().includes(preferredHost));
    if (hostHit) return hostHit;
  }
  const preferredUrl = String(options.urlContains || options.hrefContains || '').trim().toLowerCase();
  if (preferredUrl) {
    const urlHit = links.find((link) => String(link.href || '').toLowerCase().includes(preferredUrl));
    if (urlHit) return urlHit;
  }
  const index = normalizeBrowserResultIndex(options.resultIndex || options.index || options.position);
  return links[index - 1] || links[0] || null;
}

function browserResultReviewPrompt({ request, query, searchPage, selectedLink, targetPage }) {
  const pageText = targetPage?.selectedText || targetPage?.text || '';
  return [
    'Browser result review workflow.',
    `User request: ${request}`,
    query ? `Search query: ${query}` : '',
    selectedLink ? `Selected link: ${selectedLink.text} · ${selectedLink.href}` : '',
    '',
    'Use only the provided target page snapshot. If the page content is insufficient, say what is missing.',
    'Answer in concise Chinese with concrete next actions and useful follow-up links from the page.',
    '',
    searchPage
      ? `Search page candidates:\n${JSON.stringify(browserSearchResultLinks(searchPage, 8), null, 2)}`
      : '',
    '',
    'Target page:',
    `Title: ${targetPage?.title || ''}`,
    `URL: ${targetPage?.url || ''}`,
    targetPage?.metaDescription ? `Description: ${targetPage.metaDescription}` : '',
    targetPage?.headings?.length ? `Headings: ${targetPage.headings.slice(0, 16).join(' / ')}` : '',
    browserWorkflowLinksBlock(targetPage) ? `Links:\n${browserWorkflowLinksBlock(targetPage)}` : '',
    '',
    'Target page text:',
    compactRecordText(pageText, 12000),
  ].filter((line) => line !== '').join('\n');
}

function normalizeBrowserResearchLimit(value) {
  const parsed = Number(value || 3);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function normalizeBrowserResearchUrls(options = {}, maxUrls = 5) {
  const rawList = [
    ...(Array.isArray(options.urls) ? options.urls : []),
    ...(Array.isArray(options.url) ? options.url : [options.url]),
  ];
  const text = String(options.instruction || options.query || '').trim();
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>）)]+/gi)) {
    rawList.push(match[0]);
  }
  const seen = new Set();
  const urls = [];
  for (const raw of rawList) {
    const href = normalizeBrowserHref(raw);
    if (!href) continue;
    const key = href.replace(/#.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(href);
    if (urls.length >= maxUrls) break;
  }
  return urls;
}

function browserResearchLinkFromUrl(href, index = 0) {
  const url = new URL(href);
  return {
    index: index + 1,
    text: href,
    href,
    host: url.hostname.replace(/^www\./i, ''),
    sameHost: false,
  };
}

function browserResearchWorkflowPrompt({ request, query, searchPage, selectedLinks, pages }) {
  const pagePayload = pages.map((item, index) => ({
    index: index + 1,
    selectedLink: item.selected,
    opened: item.openAction?.output || '',
    available: Boolean(item.page?.available),
    title: item.page?.title || '',
    url: item.page?.url || item.selected?.href || '',
    headings: item.page?.headings?.slice(0, 14) || [],
    links: Array.isArray(item.page?.links) ? item.page.links.slice(0, 10) : [],
    text: compactRecordText(item.page?.selectedText || item.page?.text || '', 5000),
    error: item.error || item.page?.error || '',
  }));
  return [
    'Browser multi-page research workflow.',
    `User request: ${request}`,
    query ? `Search query: ${query}` : '',
    '',
    'Use only the provided page snapshots. Compare sources, call out disagreements or missing evidence, and do not invent facts beyond the snapshots.',
    'Answer in concise Chinese. Include: conclusion, source-by-source evidence, concrete next actions, and which link JAVIS should open next if more work is needed.',
    '',
    searchPage
      ? `Search page candidates:\n${JSON.stringify(browserSearchResultLinks(searchPage, 12), null, 2)}`
      : '',
    selectedLinks?.length ? `Selected links:\n${JSON.stringify(selectedLinks, null, 2)}` : '',
    '',
    'Reviewed pages:',
    JSON.stringify(pagePayload, null, 2),
  ].filter((line) => line !== '').join('\n');
}

function parseJsonFromModelText(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty_model_json');
  try {
    return JSON.parse(raw);
  } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const firstObject = raw.indexOf('{');
  const lastObject = raw.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    try {
      return JSON.parse(raw.slice(firstObject, lastObject + 1));
    } catch {}
  }
  const firstArray = raw.indexOf('[');
  const lastArray = raw.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    return JSON.parse(raw.slice(firstArray, lastArray + 1));
  }
  throw new Error('model_output_was_not_json');
}

function normalizeBrowserTaskAction(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const aliases = {
    press: 'click',
    tap: 'click',
    type: 'fill',
    input: 'fill',
    set: 'fill',
    choose: 'select',
    navigate: 'open_url',
    open: 'open_url',
    google: 'search',
    refresh: 'reload',
    pause: 'wait',
    sleep: 'wait',
  };
  return aliases[raw] || raw;
}

function normalizeBrowserTaskPlan(value = {}, maxSteps = 5) {
  const rawSteps = Array.isArray(value) ? value : Array.isArray(value.steps) ? value.steps : [];
  const steps = rawSteps
    .map((step, index) => {
      const action = normalizeBrowserTaskAction(step?.action || step?.type || step?.domAction || step?.browserAction);
      if (!['click', 'fill', 'select', 'wait', 'open_url', 'search', 'reload', 'back', 'forward'].includes(action)) return null;
      return {
        index,
        action,
        selector: String(step.selector || '').slice(0, 500),
        query: String(step.query || step.label || step.text || '').slice(0, 300),
        value: String(step.value ?? step.content ?? step.url ?? '').slice(0, 4000),
        url: String(step.url || '').slice(0, 2000),
        ms: Math.max(100, Math.min(5000, Number(step.ms || step.durationMs || step.waitMs || 600))),
        reason: compactRecordText(step.reason || step.summary || '', 220),
      };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(8, Number(maxSteps || 5))));
  return {
    summary: compactRecordText(value.summary || value.goal || 'Browser task plan', 500),
    successCheck: compactRecordText(value.successCheck || value.success || '', 500),
    steps,
  };
}

function browserTaskPrompt(page, dom, instruction, maxSteps) {
  const elements = (dom.elements || []).slice(0, 80).map((element) => ({
    id: element.id,
    selector: element.selector,
    tag: element.tag,
    type: element.type,
    role: element.role,
    label: element.label,
    text: element.text,
    placeholder: element.placeholder,
    name: element.name,
    valuePreview: element.valuePreview,
    disabled: element.disabled,
  }));
  return [
    'Return only compact JSON. No markdown.',
    `User browser task: ${instruction}`,
    `Max steps: ${maxSteps}`,
    '',
    'Allowed actions:',
    '- open_url: requires url',
    '- search: requires query',
    '- click: requires selector or query',
    '- fill: requires selector or query and value',
    '- select: requires selector or query and value',
    '- wait: requires ms',
    '- reload/back/forward: no target required',
    '',
    'Rules:',
    '- Do not submit forms, send messages, purchase, pay, delete, log in, sign up, publish, trade, or make account changes.',
    '- Prefer selector from DOM elements when available.',
    '- Use click/fill/select only for visible non-disabled controls listed in DOM.',
    '- If the page does not contain enough information to act safely, return steps: [] and explain in summary.',
    '',
    'Schema:',
    '{"summary":"what will be done","successCheck":"how to verify","steps":[{"action":"fill","selector":"...","query":"...","value":"...","reason":"..."}]}',
    '',
    'Current page:',
    JSON.stringify({
      app: page.app,
      title: page.title,
      url: page.url,
      headings: page.headings?.slice(0, 12) || [],
      textPreview: compactRecordText(page.selectedText || page.text || '', 4000),
      dom: {
        title: dom.title,
        url: dom.url,
        count: dom.count,
        elements,
      },
    }),
  ].join('\n');
}

function cleanBrowserTaskQuery(value) {
  return String(value || '')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\b(field|input|textbox|text box|textarea|area|button|link|tab)\b/gi, '')
    .replace(/\b(the|a|an)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function browserTaskElementText(element = {}) {
  return [
    element.label,
    element.text,
    element.placeholder,
    element.name,
    element.type,
    element.role,
    element.selector,
  ].map((item) => String(item || '')).join(' ').toLowerCase();
}

function browserTaskElementKind(element = {}, kind = '') {
  const tag = String(element.tag || '').toLowerCase();
  const type = String(element.type || '').toLowerCase();
  const role = String(element.role || '').toLowerCase();
  if (element.disabled) return false;
  if (kind === 'fill') {
    if (type === 'password') return false;
    if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file'].includes(type)) return false;
    return ['input', 'textarea'].includes(tag) || element.contentEditable === true;
  }
  if (kind === 'select') return tag === 'select';
  if (kind === 'click') {
    return tag === 'button'
      || tag === 'a'
      || ['button', 'link', 'menuitem', 'checkbox', 'radio', 'tab'].includes(role)
      || ['button', 'submit', 'reset'].includes(type);
  }
  return false;
}

function scoreBrowserTaskElement(element = {}, query = '', kind = '') {
  if (!browserTaskElementKind(element, kind)) return -1;
  const cleanedQuery = cleanBrowserTaskQuery(query).toLowerCase();
  if (!cleanedQuery) return 1;
  const haystack = browserTaskElementText(element);
  const label = String(element.label || '').toLowerCase();
  const placeholder = String(element.placeholder || '').toLowerCase();
  const name = String(element.name || '').toLowerCase();
  let score = 0;
  if (label === cleanedQuery) score += 100;
  if (placeholder === cleanedQuery) score += 80;
  if (name === cleanedQuery) score += 70;
  if (haystack.includes(cleanedQuery)) score += 50;
  const words = cleanedQuery.split(/\s+/).filter(Boolean);
  if (words.length && words.every((word) => haystack.includes(word))) score += 20 + words.length;
  if (kind === 'fill' && ['input', 'textarea'].includes(String(element.tag || '').toLowerCase())) score += 4;
  if (kind === 'click' && String(element.tag || '').toLowerCase() === 'button') score += 4;
  return score;
}

function findBrowserTaskElement(dom = {}, query = '', kind = '') {
  const elements = Array.isArray(dom.elements) ? dom.elements : [];
  let best = null;
  let bestScore = -1;
  for (const element of elements) {
    const score = scoreBrowserTaskElement(element, query, kind);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  if (!best || bestScore < (query ? 20 : 1)) return null;
  return best;
}

function cleanBrowserTaskValue(value) {
  return String(value || '')
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.,;，。；]+$/g, '')
    .trim();
}

function parseBrowserTaskFill(segment = '', fullInstruction = '') {
  const text = String(segment || '').trim();
  const patterns = [
    /\b(?:fill|enter|type|input)\s+(?:the\s+)?(.+?)\s+(?:with|as|to)\s+["'`“”‘’]?(.+?)["'`“”‘’]?$/i,
    /\b(?:type|enter|input)\s+["'`“”‘’]?(.+?)["'`“”‘’]?\s+(?:in|into|to)\s+(?:the\s+)?(.+?)$/i,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = text.match(pattern);
    if (!match) continue;
    return index === 0
      ? { query: cleanBrowserTaskQuery(match[1]), value: cleanBrowserTaskValue(match[2]) }
      : { query: cleanBrowserTaskQuery(match[2]), value: cleanBrowserTaskValue(match[1]) };
  }
  const chinese = text.match(/(?:把|在)?(.+?)(?:字段|输入框|框|栏)?(?:填|输入|写入)(?:成|为|:|：)?(.+)$/i);
  if (chinese) return { query: cleanBrowserTaskQuery(chinese[1]), value: cleanBrowserTaskValue(chinese[2]) };
  const quoted = String(fullInstruction || text).match(/["'`“”‘’]([^"'`“”‘’]+)["'`“”‘’]/);
  const withValue = text.match(/\bwith\s+([^,.;]+)$/i);
  const value = cleanBrowserTaskValue(quoted?.[1] || withValue?.[1] || '');
  if (/\b(fill|enter|type|input)\b/i.test(text) && value) {
    return { query: cleanBrowserTaskQuery(text.replace(/\b(fill|enter|type|input|with)\b/gi, '').replace(value, '')), value };
  }
  return null;
}

function parseBrowserTaskClick(segment = '') {
  const text = String(segment || '').trim();
  const english = text.match(/\b(?:click|press|tap)\s+(?:the\s+)?(.+?)$/i);
  if (english) return { query: cleanBrowserTaskQuery(english[1]) };
  const chinese = text.match(/(?:点击|按下|点一下)(.+?)(?:按钮|链接|标签)?$/i);
  if (chinese) return { query: cleanBrowserTaskQuery(chinese[1]) };
  return null;
}

function fallbackBrowserTaskPlan(instruction = '', dom = {}, maxSteps = 5, plannerError = '') {
  const text = String(instruction || '').trim();
  const lower = text.toLowerCase();
  const steps = [];
  const segments = text
    .split(/\bthen\b|\band then\b|\band\b|,|;|，|；|然后|再|并且|并/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!text) {
    return { summary: 'No browser task instruction was provided.', successCheck: '', steps };
  }
  if (BROWSER_DOM_DANGEROUS_RE.test(text)) {
    return {
      summary: 'Local fallback refused to plan a risky browser action.',
      successCheck: '',
      steps,
    };
  }

  for (const segment of segments) {
    if (steps.length >= maxSteps) break;
    const fill = parseBrowserTaskFill(segment, text);
    if (fill?.value) {
      const target = findBrowserTaskElement(dom, fill.query, 'fill');
      if (target?.selector) {
        steps.push({
          action: 'fill',
          selector: target.selector,
          query: fill.query,
          value: fill.value,
          reason: 'Local fallback matched a fillable DOM element.',
        });
        continue;
      }
    }

    const click = parseBrowserTaskClick(segment);
    if (click) {
      const target = findBrowserTaskElement(dom, click.query, 'click');
      if (target?.selector) {
        steps.push({
          action: 'click',
          selector: target.selector,
          query: click.query,
          value: '',
          reason: 'Local fallback matched a clickable DOM element.',
        });
      }
    }
  }

  if (!steps.length && /\b(fill|enter|type|input)\b/i.test(text)) {
    const fill = parseBrowserTaskFill(text, text);
    const target = findBrowserTaskElement(dom, fill?.query || '', 'fill');
    if (fill?.value && target?.selector) {
      steps.push({
        action: 'fill',
        selector: target.selector,
        query: fill.query,
        value: fill.value,
        reason: 'Local fallback used the best fillable DOM element.',
      });
    }
  }

  if (steps.length < maxSteps && /\b(click|press|tap)\b/i.test(lower)) {
    const click = parseBrowserTaskClick(text);
    const alreadyClicked = steps.some((step) => step.action === 'click');
    const target = !alreadyClicked ? findBrowserTaskElement(dom, click?.query || '', 'click') : null;
    if (target?.selector) {
      steps.push({
        action: 'click',
        selector: target.selector,
        query: click?.query || '',
        value: '',
        reason: 'Local fallback used the best clickable DOM element.',
      });
    }
  }

  return normalizeBrowserTaskPlan({
    summary: steps.length
      ? `Local fallback planned ${steps.length} browser step${steps.length === 1 ? '' : 's'}.${plannerError ? ` Model planner failed: ${compactRecordText(plannerError, 180)}` : ''}`
      : `No safe local browser steps could be inferred.${plannerError ? ` Model planner failed: ${compactRecordText(plannerError, 180)}` : ''}`,
    successCheck: 'Read the page after execution and confirm the requested visible state changed.',
    steps,
  }, maxSteps);
}

async function planBrowserTaskSteps(page, dom, instruction, maxSteps) {
  if (!OPENAI_API_KEY) {
    return {
      ...fallbackBrowserTaskPlan(instruction, dom, maxSteps, 'OpenAI API key is not configured.'),
      source: 'local_fallback',
      plannerError: 'OpenAI API key is not configured.',
    };
  }

  let planText = '';
  try {
    planText = await callOpenAIResponses({
      model: models.fast,
      instructions: 'You are the browser task planner inside JAVIS. Return JSON only. Plan safe browser steps using the current page DOM. Never plan irreversible or account-changing actions.',
      input: browserTaskPrompt(page, dom, instruction, maxSteps),
      maxOutputTokens: 900,
    });
    return {
      ...normalizeBrowserTaskPlan(parseJsonFromModelText(planText), maxSteps),
      source: 'model',
      plannerOutput: compactRecordText(planText, 1200),
      plannerError: '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = fallbackBrowserTaskPlan(instruction, dom, maxSteps, message);
    appendAudit('browser_task.plan_failed', {
      error: compactRecordText(message, 500),
      fallbackSteps: fallback.steps.length,
      model: models.fast,
      output: compactRecordText(planText, 1000),
    });
    return {
      ...fallback,
      source: fallback.steps.length ? 'local_fallback' : 'blocked',
      plannerOutput: compactRecordText(planText, 1200),
      plannerError: message,
    };
  }
}

function browserTaskStepLabel(step) {
  if (step.action === 'wait') return `Wait ${step.ms}ms`;
  if (step.action === 'open_url') return `Open ${step.url || step.value}`;
  if (step.action === 'search') return `Search ${step.query || step.value}`;
  if (['reload', 'back', 'forward'].includes(step.action)) return `Browser ${step.action}`;
  return `${step.action} ${step.selector || step.query}`;
}

async function runBrowserTaskStep(step, execute, options = {}) {
  if (step.action === 'wait') {
    if (execute) await waitMs(step.ms);
    return {
      status: execute ? 'executed' : 'previewed',
      action: step.action,
      label: browserTaskStepLabel(step),
      output: execute ? `Waited ${step.ms}ms.` : `Would wait ${step.ms}ms.`,
    };
  }

  if (['click', 'fill', 'select'].includes(step.action)) {
    let result;
    try {
      result = await executeBrowserDomAction({
        action: step.action,
        app: options.app,
        selector: step.selector,
        query: step.query,
        value: step.value,
        execute,
        source: 'browser_task',
      }, { preview: !execute, approvalContext: options.approvalContext });
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          status: 'approval_required',
          action: step.action,
          label: browserTaskStepLabel(step),
          output: `Approval required before I can ${error.approval.summary}.`,
          approval: error.approval,
        };
      }
      throw error;
    }
    return {
      status: result.ok ? (result.executed ? 'executed' : 'previewed') : result.approval ? 'approval_required' : 'blocked',
      action: step.action,
      label: browserTaskStepLabel(step),
      output: result.output,
      approval: result.approval,
      plan: result.plan,
      evaluation: result.evaluation,
    };
  }

  const browserAction = step.action;
  const controlArgs = {
    action: 'browser_control',
    browserAction,
    app: options.app,
    url: step.url || step.value,
    query: step.query || step.value,
  };
  if (!execute) {
    const plan = buildBrowserControlPlan(controlArgs);
    const evaluation = evaluateMacActionPlan(plan, { preview: true });
    return {
      status: evaluation.blocked ? 'blocked' : 'previewed',
      action: step.action,
      label: browserTaskStepLabel(step),
      output: `Prepared ${plan.summary}${evaluation.needsApproval ? ` (${evaluation.reason})` : ''}.`,
      plan,
      evaluation,
    };
  }
  let result;
  try {
    result = await executeBrowserControl(controlArgs, { approvalContext: options.approvalContext });
  } catch (error) {
    if (error instanceof ActionApprovalRequired) {
      return {
        status: 'approval_required',
        action: step.action,
        label: browserTaskStepLabel(step),
        output: `Approval required before I can ${error.approval.summary}.`,
        approval: error.approval,
      };
    }
    throw error;
  }
  return {
    status: result.ok ? (result.executed ? 'executed' : 'previewed') : result.approval ? 'approval_required' : 'blocked',
    action: step.action,
    label: browserTaskStepLabel(step),
    output: result.output,
    approval: result.approval,
  };
}

function formatBrowserTaskResults(results) {
  return results
    .map((result, index) => `${index + 1}. ${result.status}: ${result.label} · ${compactRecordText(result.output, 220)}`)
    .join('\n');
}

async function runBrowserTaskWorkflow(options = {}) {
  const instruction = String(options.instruction || '').trim();
  if (!instruction) throw new Error('Browser act workflow requires an instruction.');
  const execute = options.execute !== false;
  const maxSteps = Math.max(1, Math.min(5, Number(options.maxSteps || 5)));
  const maxChars = normalizeBrowserMaxChars(options.maxChars || 12000);
  const page = await browserPageSnapshot({ app: options.app, maxChars });
  const pageSummary = browserWorkflowPageSummary(page);
  const workflowTitle = `act · ${page.title || page.url || instruction}`.slice(0, 180);

  if (!page.available) {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_task',
      status: 'failed',
      title: workflowTitle,
      intent: 'act',
      mode: 'quick',
      request: instruction,
      target: pageSummary,
      result: page.error || 'No supported browser page is available.',
    });
    const routing = createRoutingRecordForWorkflow({
      task: instruction,
      workflow,
      mode: 'quick',
      source: options.source || 'browser_task',
      scope: options.scope || 'browser:act',
      parallelGroup: options.parallelGroup || options.group || 'browser:quick',
      resultSummary: workflow.result,
    });
    return {
      ok: false,
      mode: 'quick',
      intent: 'act',
      queued: false,
      workflow,
      routing,
      page: pageSummary,
      output: page.error || 'No supported browser page is available.',
    };
  }

  const dom = await browserDomSnapshot({ app: options.app, limit: options.domLimit || 80 });
  const workflow = createWorkflowRecord({
    kind: 'browser',
    source: 'browser_task',
    status: 'running',
    title: workflowTitle,
    intent: 'act',
    mode: 'quick',
    request: instruction,
    target: {
      ...pageSummary,
      resultCount: dom.elements?.length || 0,
    },
  });

  appendAudit('browser_task.requested', {
    app: page.app,
    title: page.title,
    url: page.url,
    execute,
    domCount: dom.elements?.length || 0,
    maxSteps,
  });

  const plan = await planBrowserTaskSteps(page, dom, instruction, maxSteps);
  const results = [];
  for (const step of plan.steps) {
    try {
      const result = await runBrowserTaskStep(step, execute, {
        app: options.app,
        approvalContext: {
          type: 'browser_task',
          workflowId: workflow.id,
          title: workflowTitle,
          instruction,
          stepIndex: step.index,
        },
      });
      results.push({ index: step.index, ...result, reason: step.reason });
      if (['blocked', 'approval_required'].includes(result.status)) break;
      if (execute && result.status === 'executed' && step.action !== 'wait') await waitMs(450);
    } catch (error) {
      results.push({
        index: step.index,
        status: 'blocked',
        action: step.action,
        label: browserTaskStepLabel(step),
        output: error instanceof Error ? error.message : String(error),
        reason: step.reason,
      });
      break;
    }
  }

  const afterPage = await browserPageSnapshot({ app: options.app, maxChars: Math.min(6000, maxChars) }).catch((error) => ({
    available: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  const afterDom = await browserDomSnapshot({ app: options.app, limit: 40 }).catch((error) => ({
    available: false,
    error: error instanceof Error ? error.message : String(error),
    elements: [],
  }));
  const noSafeSteps = plan.steps.length === 0;
  const blocked = noSafeSteps || results.some((result) => ['blocked', 'approval_required'].includes(result.status));
  const output = [
    `Browser task: ${instruction}`,
    `Plan: ${plan.summary}`,
    `Planner: ${plan.source}`,
    plan.plannerError ? `Planner note: ${compactRecordText(plan.plannerError, 260)}` : '',
    plan.successCheck ? `Check: ${plan.successCheck}` : '',
    results.length ? formatBrowserTaskResults(results) : 'No safe executable browser steps were planned.',
    afterPage?.available ? `After: ${afterPage.title || ''} ${afterPage.url || ''}` : `After: ${afterPage?.error || 'unavailable'}`,
  ].filter(Boolean).join('\n');
  const finalWorkflow = setWorkflow(workflow.id, {
    status: blocked ? 'blocked' : execute ? 'done' : 'done',
    result: output,
    completedAt: Date.now(),
    target: {
      ...pageSummary,
      returnedLength: afterPage?.text?.length || pageSummary.returnedLength,
      resultCount: afterDom?.elements?.length || 0,
    },
  });
  appendAudit('browser_task.completed', {
    workflowId: workflow.id,
    status: finalWorkflow?.status,
    steps: plan.steps.length,
    results: results.length,
    execute,
    blocked,
    noSafeSteps,
    planner: plan.source,
  });
  const routing = createRoutingRecordForWorkflow({
    task: instruction,
    workflow: finalWorkflow,
    mode: 'quick',
    source: options.source || 'browser_task',
    scope: options.scope || 'browser:act',
    parallelGroup: options.parallelGroup || options.group || 'browser:quick',
    resultSummary: output,
  });

  return {
    ok: !blocked,
    mode: 'quick',
    intent: 'act',
    queued: false,
    workflow: finalWorkflow,
    routing,
    page: browserWorkflowPageSummary(afterPage?.available ? afterPage : page),
    beforePage: pageSummary,
    dom,
    afterDom,
    plan,
    results,
    output,
  };
}

async function runBrowserSearchWorkflow(options = {}) {
  const intent = normalizeBrowserWorkflowIntent(options.intent) === 'compare' ? 'compare' : 'search';
  const mode = normalizeBrowserWorkflowMode(options.mode);
  const instruction = String(options.instruction || '').trim();
  const queries = normalizeBrowserSearchQueries(options);
  if (!queries.length) throw new Error('Browser search workflow requires query or queries.');
  const execute = options.execute !== false;
  const maxChars = normalizeBrowserMaxChars(options.maxChars || (mode === 'quick' ? 12000 : 24000));
  const waitMsAfterSearch = Math.max(500, Math.min(6000, Number(options.waitMs || 1800)));
  const request = instruction || queries.join(' ; ');
  const workflowTitle = `${intent} · ${queries.join(' vs ')}`.slice(0, 180);

  if (!execute) {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_search_workflow',
      status: 'done',
      title: workflowTitle,
      intent,
      mode,
      request,
      target: {
        app: 'Browser',
        title: 'Search preview',
        url: '',
        fallback: '',
        textLength: 0,
        returnedLength: 0,
        resultCount: queries.length,
      },
      result: `Preview only. Would search: ${queries.join(' ; ')}`,
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode,
      source: options.source || 'browser_search_workflow',
      scope: options.scope || `browser:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: workflow.result,
    });
    return {
      ok: true,
      executed: false,
      queued: false,
      mode,
      intent,
      queries,
      workflow,
      routing,
      searches: [],
      output: workflow.result,
    };
  }

  const workflow = createWorkflowRecord({
    kind: 'browser',
    source: 'browser_search_workflow',
    status: 'running',
    title: workflowTitle,
    intent,
    mode,
    request,
    target: {
      app: 'Browser',
      title: queries[0],
      url: '',
      fallback: '',
      textLength: 0,
      returnedLength: 0,
      resultCount: queries.length,
    },
  });

  const searches = [];
  for (const [index, query] of queries.entries()) {
    try {
      const action = await executeBrowserControl({
        action: 'search',
        query,
        app: options.app,
      }, {
        approvalContext: {
          type: 'browser_search_workflow',
          workflowId: workflow.id,
          title: workflowTitle,
          instruction: request,
          stepIndex: index,
        },
      });
      await waitMs(waitMsAfterSearch);
      const page = await browserPageSnapshot({ app: options.app, maxChars });
      searches.push({
        query,
        action,
        page,
        pageSummary: browserWorkflowPageSummary(page),
      });
    } catch (error) {
      searches.push({
        query,
        error: error instanceof Error ? error.message : String(error),
        page: null,
        pageSummary: { available: false, supported: false, app: '', title: '', url: '', selectedTextLength: 0, returnedLength: 0, textLength: 0, truncated: false, fallback: '', error: error instanceof Error ? error.message : String(error), headings: [] },
      });
      break;
    }
  }

  const failed = searches.some((item) => item.error || !item.page?.available);
  if (failed) {
    const output = [
      `Browser ${intent} blocked.`,
      searches.map((item, index) => `${index + 1}. ${item.query}: ${item.error || item.page?.error || 'page unavailable'}`).join('\n'),
    ].join('\n');
    const finalWorkflow = setWorkflow(workflow.id, {
      status: 'blocked',
      result: output,
      completedAt: Date.now(),
      target: {
        ...(workflow.target || {}),
        resultCount: searches.length,
      },
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      mode,
      source: options.source || 'browser_search_workflow',
      scope: options.scope || `browser:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: output,
    });
    return {
      ok: false,
      executed: true,
      queued: false,
      mode,
      intent,
      queries,
      workflow: finalWorkflow,
      routing,
      searches,
      output,
    };
  }

  const prompt = browserSearchWorkflowPrompt(searches, intent, request);
  const latestPage = searches[searches.length - 1]?.pageSummary || {};
  if (mode !== 'quick') {
    const queuedWorkflow = setWorkflow(workflow.id, {
      status: 'queued',
      target: {
        ...(latestPage || {}),
        resultCount: searches.length,
        searchQueries: queries,
      },
    });
    const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'browser_search_workflow', { workflowId: workflow.id });
    const finalWorkflow = setWorkflow(workflow.id, { jobId: job.id });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      job,
      mode,
      source: options.source || 'browser_search_workflow',
      scope: options.scope || `browser:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
    });
    return {
      ok: true,
      executed: true,
      queued: true,
      mode,
      intent,
      queries,
      workflow: finalWorkflow || queuedWorkflow,
      job,
      routing,
      searches: searches.map((item) => ({ query: item.query, page: item.pageSummary })),
      output: `Queued ${mode} browser ${intent} workflow for ${queries.join(' ; ')}.`,
    };
  }

  const output = await callOpenAIResponsesWithFallback({
    model: models.fast,
    instructions:
      'You are the browser search lane inside JAVIS. Use only the provided search result page snapshots. Answer in concise Chinese with concrete next actions and useful follow-up queries/links.',
    input: prompt,
    maxOutputTokens: intent === 'compare' ? 1200 : 850,
  }, {
    source: 'browser_search_workflow',
    timeoutMs: intent === 'compare' ? 90000 : 60000,
  });
  const finalWorkflow = setWorkflow(workflow.id, {
    status: quickLaneOutputOk(output) ? 'done' : 'blocked',
    result: output,
    completedAt: Date.now(),
    target: {
      ...(latestPage || {}),
      resultCount: searches.length,
      searchQueries: queries,
    },
  });
  const routing = createRoutingRecordForWorkflow({
    task: request,
    workflow: finalWorkflow,
    mode,
    source: options.source || 'browser_search_workflow',
    scope: options.scope || `browser:${intent}`,
    parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
    resultSummary: output,
  });
  return {
    ok: quickLaneOutputOk(output),
    executed: true,
    queued: false,
    mode,
    intent,
    queries,
    workflow: finalWorkflow,
    routing,
    searches: searches.map((item) => ({ query: item.query, page: item.pageSummary })),
    output,
  };
}

async function runBrowserResultReviewWorkflow(options = {}) {
  const mode = normalizeBrowserWorkflowMode(options.mode);
  const instruction = String(options.instruction || '').trim();
  const queries = normalizeBrowserSearchQueries(options);
  const explicitUrl = browserReviewExplicitUrl(options);
  const query = explicitUrl ? '' : queries[0];
  if (!explicitUrl && !query) throw new Error('Browser result review requires a URL or search query.');
  const execute = options.execute !== false;
  const maxChars = normalizeBrowserMaxChars(options.maxChars || (mode === 'quick' ? 14000 : 30000));
  const waitMsAfterSearch = Math.max(500, Math.min(6000, Number(options.waitMs || 1800)));
  const waitMsAfterOpen = Math.max(500, Math.min(8000, Number(options.openWaitMs || options.waitMsAfterOpen || 2200)));
  const request = instruction || explicitUrl || query;
  const workflowTitle = `review_result · ${explicitUrl || query}`.slice(0, 180);

  if (!execute) {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_result_review_workflow',
      status: 'done',
      title: workflowTitle,
      intent: 'review_result',
      mode,
      request,
      target: {
        app: 'Browser',
        title: explicitUrl ? 'URL preview' : 'Search result preview',
        url: explicitUrl,
        fallback: '',
        textLength: 0,
        returnedLength: 0,
        resultCount: explicitUrl ? 1 : 0,
      },
      result: explicitUrl
        ? `Preview only. Would open and review: ${explicitUrl}`
        : `Preview only. Would search "${query}" and review result #${normalizeBrowserResultIndex(options.resultIndex || options.index || options.position)}.`,
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode,
      source: options.source || 'browser_result_review_workflow',
      scope: options.scope || 'browser:review_result',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: workflow.result,
    });
    return {
      ok: true,
      executed: false,
      queued: false,
      mode,
      intent: 'review_result',
      query,
      selected: explicitUrl ? { index: 1, text: explicitUrl, href: explicitUrl, host: new URL(explicitUrl).hostname.replace(/^www\./i, ''), sameHost: false } : null,
      workflow,
      routing,
      output: workflow.result,
    };
  }

  const workflow = createWorkflowRecord({
    kind: 'browser',
    source: 'browser_result_review_workflow',
    status: 'running',
    title: workflowTitle,
    intent: 'review_result',
    mode,
    request,
    target: {
      app: 'Browser',
      title: explicitUrl || query,
      url: explicitUrl,
      fallback: '',
      textLength: 0,
      returnedLength: 0,
      resultCount: 0,
    },
  });

  let search = null;
  let selected = explicitUrl
    ? { index: 1, text: explicitUrl, href: explicitUrl, host: new URL(explicitUrl).hostname.replace(/^www\./i, ''), sameHost: false }
    : null;

  try {
    if (!selected) {
      const action = await executeBrowserControl({
        action: 'search',
        query,
        app: options.app,
      }, {
        approvalContext: {
          type: 'browser_result_review_workflow',
          workflowId: workflow.id,
          title: workflowTitle,
          instruction: request,
          stepIndex: 0,
        },
      });
      await waitMs(waitMsAfterSearch);
      const page = await browserPageSnapshot({ app: options.app, maxChars });
      const candidates = browserSearchResultLinks(page, MAX_BROWSER_PAGE_LINKS);
      selected = selectBrowserReviewLink(candidates, options);
      search = {
        query,
        action,
        page,
        pageSummary: browserWorkflowPageSummary(page),
        candidates: candidates.slice(0, 12),
      };
      if (!page.available) throw new Error(page.error || 'Search result page is unavailable.');
      if (!selected) throw new Error('No reviewable search result link was found.');
    }

    const openAction = await executeBrowserControl({
      action: 'open_url',
      url: selected.href,
      app: options.app,
    }, {
      approvalContext: {
        type: 'browser_result_review_workflow',
        workflowId: workflow.id,
        title: workflowTitle,
        instruction: request,
        stepIndex: selected ? 1 : 0,
      },
    });
    await waitMs(waitMsAfterOpen);
    const targetPage = await browserPageSnapshot({ app: options.app, maxChars });
    const targetSummary = browserWorkflowPageSummary(targetPage);
    if (!targetPage.available) throw new Error(targetPage.error || 'Target page is unavailable.');

    const prompt = browserResultReviewPrompt({
      request,
      query,
      searchPage: search?.page,
      selectedLink: selected,
      targetPage,
    });

    if (mode !== 'quick') {
      const queuedWorkflow = setWorkflow(workflow.id, {
        status: 'queued',
        target: {
          ...targetSummary,
          selected,
          query,
          resultCount: search?.candidates?.length || 1,
        },
      });
      const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'browser_result_review_workflow', { workflowId: workflow.id });
      const finalWorkflow = setWorkflow(workflow.id, { jobId: job.id });
      const routing = createRoutingRecordForWorkflow({
        task: request,
        workflow: finalWorkflow,
        job,
        mode,
        source: options.source || 'browser_result_review_workflow',
        scope: options.scope || 'browser:review_result',
        parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      });
      return {
        ok: true,
        executed: true,
        queued: true,
        mode,
        intent: 'review_result',
        query,
        selected,
        search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
        openAction,
        page: targetSummary,
        workflow: finalWorkflow || queuedWorkflow,
        job,
        routing,
        output: `Queued ${mode} browser result review for ${selected.href}.`,
      };
    }

    const output = await callOpenAIResponsesWithFallback({
      model: models.fast,
      instructions:
        'You are the browser result review lane inside JAVIS. Use only the provided target page snapshot. Answer in concise Chinese with concrete conclusions, useful next links, and what JAVIS should do next.',
      input: prompt,
      maxOutputTokens: 1000,
    }, {
      source: 'browser_result_review_workflow',
      timeoutMs: 70000,
    });
    const finalWorkflow = setWorkflow(workflow.id, {
      status: quickLaneOutputOk(output) ? 'done' : 'blocked',
      result: output,
      completedAt: Date.now(),
      target: {
        ...targetSummary,
        selected,
        query,
        resultCount: search?.candidates?.length || 1,
      },
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      mode,
      source: options.source || 'browser_result_review_workflow',
      scope: options.scope || 'browser:review_result',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: output,
    });
    return {
      ok: quickLaneOutputOk(output),
      executed: true,
      queued: false,
      mode,
      intent: 'review_result',
      query,
      selected,
      search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
      openAction,
      page: targetSummary,
      workflow: finalWorkflow,
      routing,
      output,
    };
  } catch (error) {
    const output = `Browser review_result blocked: ${error instanceof Error ? error.message : String(error)}`;
    const finalWorkflow = setWorkflow(workflow.id, {
      status: 'blocked',
      result: output,
      completedAt: Date.now(),
      target: {
        ...(workflow.target || {}),
        selected,
        query,
        resultCount: search?.candidates?.length || 0,
      },
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      mode,
      source: options.source || 'browser_result_review_workflow',
      scope: options.scope || 'browser:review_result',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: output,
    });
    return {
      ok: false,
      executed: true,
      queued: false,
      mode,
      intent: 'review_result',
      query,
      selected,
      search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
      page: browserFailedPageSummary(error),
      workflow: finalWorkflow,
      routing,
      output,
    };
  }
}

async function runBrowserResearchWorkflow(options = {}) {
  const mode = normalizeBrowserWorkflowMode(options.mode);
  const instruction = String(options.instruction || '').trim();
  const maxPages = normalizeBrowserResearchLimit(options.maxPages || options.limit || options.resultCount);
  const urls = normalizeBrowserResearchUrls(options, maxPages);
  const queries = normalizeBrowserSearchQueries(options);
  const query = urls.length ? '' : queries[0];
  if (!urls.length && !query) throw new Error('Browser research requires a URL list or search query.');
  const execute = options.execute !== false;
  const maxChars = normalizeBrowserMaxChars(options.maxChars || (mode === 'quick' ? 8000 : 14000));
  const waitMsAfterSearch = Math.max(500, Math.min(6000, Number(options.waitMs || 1800)));
  const waitMsAfterOpen = Math.max(500, Math.min(8000, Number(options.openWaitMs || options.waitMsAfterOpen || 2200)));
  const request = instruction || query || urls.join(' ; ');
  const workflowTitle = `research · ${query || urls.join(' ; ')}`.slice(0, 180);

  if (!execute) {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_research_workflow',
      status: 'done',
      title: workflowTitle,
      intent: 'research',
      mode,
      request,
      target: {
        app: 'Browser',
        title: urls.length ? 'URL research preview' : 'Search research preview',
        url: urls[0] || '',
        fallback: '',
        textLength: 0,
        returnedLength: 0,
        resultCount: urls.length || maxPages,
      },
      result: urls.length
        ? `Preview only. Would open and review ${urls.length} URL(s).`
        : `Preview only. Would search "${query}" and review up to ${maxPages} result page(s).`,
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode,
      source: options.source || 'browser_research_workflow',
      scope: options.scope || 'browser:research',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: workflow.result,
    });
    return {
      ok: true,
      executed: false,
      queued: false,
      mode,
      intent: 'research',
      query,
      selectedLinks: urls.map(browserResearchLinkFromUrl),
      pages: [],
      workflow,
      routing,
      output: workflow.result,
    };
  }

  const workflow = createWorkflowRecord({
    kind: 'browser',
    source: 'browser_research_workflow',
    status: 'running',
    title: workflowTitle,
    intent: 'research',
    mode,
    request,
    target: {
      app: 'Browser',
      title: query || urls[0],
      url: urls[0] || '',
      fallback: '',
      textLength: 0,
      returnedLength: 0,
      resultCount: 0,
    },
  });

  let search = null;
  let selectedLinks = urls.map(browserResearchLinkFromUrl);
  const pages = [];

  try {
    if (!selectedLinks.length) {
      const action = await executeBrowserControl({
        action: 'search',
        query,
        app: options.app,
      }, {
        approvalContext: {
          type: 'browser_research_workflow',
          workflowId: workflow.id,
          title: workflowTitle,
          instruction: request,
          stepIndex: 0,
        },
      });
      await waitMs(waitMsAfterSearch);
      const page = await browserPageSnapshot({ app: options.app, maxChars });
      const candidates = browserSearchResultLinks(page, MAX_BROWSER_PAGE_LINKS);
      selectedLinks = candidates.slice(0, maxPages);
      search = {
        query,
        action,
        page,
        pageSummary: browserWorkflowPageSummary(page),
        candidates: candidates.slice(0, 12),
      };
      if (!page.available) throw new Error(page.error || 'Search result page is unavailable.');
      if (!selectedLinks.length) throw new Error('No reviewable search result links were found.');
    } else {
      selectedLinks = selectedLinks.slice(0, maxPages);
    }

    for (const [index, selected] of selectedLinks.entries()) {
      try {
        const openAction = await executeBrowserControl({
          action: 'open_url',
          url: selected.href,
          app: options.app,
        }, {
          approvalContext: {
            type: 'browser_research_workflow',
            workflowId: workflow.id,
            title: workflowTitle,
            instruction: request,
            stepIndex: index + (search ? 1 : 0),
          },
        });
        await waitMs(waitMsAfterOpen);
        const page = await browserPageSnapshot({ app: options.app, maxChars });
        pages.push({
          selected,
          openAction,
          page,
          pageSummary: browserWorkflowPageSummary(page),
          error: page.available ? '' : (page.error || 'Target page is unavailable.'),
        });
      } catch (error) {
        pages.push({
          selected,
          openAction: null,
          page: null,
          pageSummary: browserFailedPageSummary(error),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const availablePages = pages.filter((item) => item.page?.available);
    if (!availablePages.length) throw new Error('No selected research pages could be read.');

    const prompt = browserResearchWorkflowPrompt({
      request,
      query,
      searchPage: search?.page,
      selectedLinks,
      pages,
    });
    const latestPage = availablePages[availablePages.length - 1]?.pageSummary || browserWorkflowPageSummary(availablePages[0].page);

    if (mode !== 'quick') {
      const queuedWorkflow = setWorkflow(workflow.id, {
        status: 'queued',
        target: {
          ...latestPage,
          query,
          selectedLinks,
          resultCount: selectedLinks.length,
          reviewedCount: availablePages.length,
          failedCount: pages.length - availablePages.length,
        },
      });
      const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'browser_research_workflow', { workflowId: workflow.id });
      const finalWorkflow = setWorkflow(workflow.id, { jobId: job.id });
      const routing = createRoutingRecordForWorkflow({
        task: request,
        workflow: finalWorkflow,
        job,
        mode,
        source: options.source || 'browser_research_workflow',
        scope: options.scope || 'browser:research',
        parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      });
      return {
        ok: true,
        executed: true,
        queued: true,
        mode,
        intent: 'research',
        query,
        selectedLinks,
        search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
        pages: pages.map((item) => ({ selected: item.selected, page: item.pageSummary, error: item.error })),
        workflow: finalWorkflow || queuedWorkflow,
        job,
        routing,
        output: `Queued ${mode} browser research over ${availablePages.length}/${selectedLinks.length} page(s).`,
      };
    }

    const output = await callOpenAIResponsesWithFallback({
      model: models.fast,
      instructions:
        'You are the browser research lane inside JAVIS. Use only the provided page snapshots. Synthesize across sources in concise Chinese, include concrete next actions, and note missing evidence.',
      input: prompt,
      maxOutputTokens: 1400,
    }, {
      source: 'browser_research_workflow',
      timeoutMs: 90000,
    });
    const finalWorkflow = setWorkflow(workflow.id, {
      status: quickLaneOutputOk(output) ? 'done' : 'blocked',
      result: output,
      completedAt: Date.now(),
      target: {
        ...latestPage,
        query,
        selectedLinks,
        resultCount: selectedLinks.length,
        reviewedCount: availablePages.length,
        failedCount: pages.length - availablePages.length,
      },
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      mode,
      source: options.source || 'browser_research_workflow',
      scope: options.scope || 'browser:research',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: output,
    });
    return {
      ok: quickLaneOutputOk(output),
      executed: true,
      queued: false,
      mode,
      intent: 'research',
      query,
      selectedLinks,
      search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
      pages: pages.map((item) => ({ selected: item.selected, page: item.pageSummary, error: item.error })),
      workflow: finalWorkflow,
      routing,
      output,
    };
  } catch (error) {
    const output = `Browser research blocked: ${error instanceof Error ? error.message : String(error)}`;
    const finalWorkflow = setWorkflow(workflow.id, {
      status: 'blocked',
      result: output,
      completedAt: Date.now(),
      target: {
        ...(workflow.target || {}),
        query,
        selectedLinks,
        resultCount: selectedLinks.length,
        reviewedCount: pages.filter((item) => item.page?.available).length,
        failedCount: pages.filter((item) => !item.page?.available).length,
      },
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      mode,
      source: options.source || 'browser_research_workflow',
      scope: options.scope || 'browser:research',
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: output,
    });
    return {
      ok: false,
      executed: true,
      queued: false,
      mode,
      intent: 'research',
      query,
      selectedLinks,
      search: search ? { query: search.query, page: search.pageSummary, candidates: search.candidates } : null,
      pages: pages.map((item) => ({ selected: item.selected, page: item.pageSummary, error: item.error })),
      page: browserFailedPageSummary(error),
      workflow: finalWorkflow,
      routing,
      output,
    };
  }
}

async function runBrowserWorkflow(options = {}) {
  const intent = normalizeBrowserWorkflowIntent(options.intent);
  if (intent === 'act') return runBrowserTaskWorkflow(options);
  if (intent === 'review_result') return runBrowserResultReviewWorkflow(options);
  if (intent === 'research') return runBrowserResearchWorkflow(options);
  if (intent === 'search' || intent === 'compare') return runBrowserSearchWorkflow({ ...options, intent });
  const mode = normalizeBrowserWorkflowMode(options.mode);
  const instruction = String(options.instruction || '').trim();
  const maxChars = normalizeBrowserMaxChars(options.maxChars || (mode === 'quick' ? 12000 : 30000));
  const page = await browserPageSnapshot({ app: options.app, maxChars });
  const pageSummary = browserWorkflowPageSummary(page);
  const request = instruction || {
    summarize: 'Summarize current page.',
    extract_actions: 'Extract actions from current page.',
    draft: 'Draft from current page.',
    ask: 'Answer a question about current page.',
  }[intent];
  const workflowTitle = `${intent} · ${page.title || page.url || 'current page'}`.slice(0, 180);

  if (!page.available) {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_workflow',
      status: 'failed',
      title: workflowTitle,
      intent,
      mode,
      request,
      target: pageSummary,
      result: page.error || 'No supported browser page is available.',
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode,
      source: options.source || 'browser_workflow',
      scope: options.scope || `browser:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
      resultSummary: workflow.result,
    });
    return {
      ok: false,
      mode,
      intent,
      workflow,
      routing,
      page: pageSummary,
      output: page.error || 'No supported browser page is available.',
    };
  }

  const prompt = browserWorkflowPrompt(page, intent, instruction);
  appendAudit('browser_workflow.requested', {
    intent,
    mode,
    app: page.app,
    title: page.title,
    url: page.url,
    textLength: page.textLength,
    truncated: page.truncated,
  });

  if (mode !== 'quick') {
    const workflow = createWorkflowRecord({
      kind: 'browser',
      source: 'browser_workflow',
      status: 'queued',
      title: workflowTitle,
      intent,
      mode,
      request,
      target: pageSummary,
    });
    const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'browser_workflow', { workflowId: workflow.id });
    setWorkflow(workflow.id, { jobId: job.id });
    const finalWorkflow = workflows.get(workflow.id);
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      job,
      mode,
      source: options.source || 'browser_workflow',
      scope: options.scope || `browser:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
    });
    return {
      ok: true,
      mode,
      intent,
      queued: true,
      workflow: finalWorkflow,
      job,
      routing,
      page: pageSummary,
      output: `Queued ${mode} browser workflow for ${page.title || page.url}.`,
    };
  }

  const workflow = createWorkflowRecord({
    kind: 'browser',
    source: 'browser_workflow',
    status: 'running',
    title: workflowTitle,
    intent,
    mode,
    request,
    target: pageSummary,
  });
  const output = await callOpenAIResponsesWithFallback({
    model: models.fast,
    instructions:
      'You are the browser workflow lane inside JAVIS. Use only the provided page text and user request. Answer in concise Chinese with practical next steps.',
    input: prompt,
    maxOutputTokens: intent === 'draft' ? 1100 : 800,
  }, {
    source: 'browser_workflow',
    timeoutMs: intent === 'draft' ? 90000 : 60000,
  });

  const finalWorkflow = setWorkflow(workflow.id, {
    status: OPENAI_API_KEY ? 'done' : 'blocked',
    result: output,
    completedAt: Date.now(),
  });
  const routing = createRoutingRecordForWorkflow({
    task: request,
    workflow: finalWorkflow,
    mode,
    source: options.source || 'browser_workflow',
    scope: options.scope || `browser:${intent}`,
    parallelGroup: options.parallelGroup || options.group || `browser:${mode}`,
    resultSummary: output,
  });
  return {
    ok: Boolean(OPENAI_API_KEY),
    mode,
    intent,
    queued: false,
    workflow: finalWorkflow,
    routing,
    page: pageSummary,
    output,
  };
}

function normalizeFileWorkflowIntent(value) {
  const intent = String(value || '').trim();
  if (['list', 'search', 'summarize', 'ask', 'organize'].includes(intent)) return intent;
  return 'list';
}

function normalizeWorkflowMode(value, fallback = 'quick') {
  const mode = String(value || '').trim();
  if (['quick', 'background', 'codex', 'claude'].includes(mode)) return mode;
  return fallback;
}

function localCommandDecision(task) {
  const raw = String(task || '').trim();
  const text = raw.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!text) return null;

  if (/^(status|doctor|brief|briefing|what'?s up|what now|next actions?)$/i.test(text)
    || /^(状态|当前状态|系统状态|下一步|有什么待办|现在该做什么|简报)$/.test(text)) {
    return { intent: 'status', label: 'Local status', args: {} };
  }

  if (/^(work progress|task progress|job status|jobs|background jobs|background work|long tasks?)$/i.test(text)
    || /^(任务进度|任务状态|后台任务|后台进度|工作进度|长任务|任务跑到哪了|后台跑到哪了)$/.test(text)) {
    return { intent: 'work_progress', label: 'Work progress', args: {} };
  }

  if (/^(work next|next work|do next|run next action|execute next action)$/i.test(text)
    || /^(执行下一步|做下一步|开始下一步|下一步工作|工作下一步)$/.test(text)) {
    return { intent: 'work_next', label: 'Work next', args: {} };
  }

  if (/^(capture screen|refresh screen|screen capture|update screen frame|take screenshot)$/i.test(text)
    || /^(刷新屏幕|捕获屏幕|截图|截屏|更新屏幕|刷新屏幕帧)$/.test(text)) {
    return { intent: 'capture_screen', label: 'Capture screen', args: {} };
  }

  if (/^(observe|observe now|look around|look at screen|current screen|current view|what'?s on screen|what do you see)$/i.test(text)
    || /^(观察|观察一下|看一下|看看屏幕|看屏幕|当前屏幕|当前界面|现在屏幕|现在界面|电脑现在什么状态|看看电脑)$/.test(text)) {
    return {
      intent: 'observe_now',
      label: 'Observe now',
      args: {
        captureScreen: 'auto',
        includeAccessibility: true,
        screenMaxAgeMs: 15000,
        accessibilityMaxAgeMs: 8000,
      },
    };
  }

  if (/^(describe screen|describe current screen|vision|screen description)$/i.test(text)
    || /^(描述屏幕|描述当前屏幕|屏幕描述|看图说明|屏幕上有什么)$/.test(text)) {
    return {
      intent: 'describe_screen',
      label: 'Describe screen',
      requiresOpenAiKey: true,
      args: {
        captureScreen: 'auto',
        includeAccessibility: true,
        describeScreen: true,
        screenMaxAgeMs: 8000,
        accessibilityMaxAgeMs: 8000,
      },
    };
  }

  if (/^(browser back|go back|back page|previous page)$/i.test(text)
    || /^(浏览器后退|网页后退|返回上一页|后退)$/.test(text)) {
    return { intent: 'browser_control', label: 'Browser back', requiresLocalExecution: true, args: { browserAction: 'back' } };
  }

  if (/^(browser forward|go forward|forward page|next page)$/i.test(text)
    || /^(浏览器前进|网页前进|前进)$/.test(text)) {
    return { intent: 'browser_control', label: 'Browser forward', requiresLocalExecution: true, args: { browserAction: 'forward' } };
  }

  if (/^(reload|refresh page|reload page|refresh browser)$/i.test(text)
    || /^(刷新网页|刷新页面|刷新浏览器|重新加载)$/.test(text)) {
    return { intent: 'browser_control', label: 'Browser reload', requiresLocalExecution: true, args: { browserAction: 'reload' } };
  }

  if (/^(new tab|open new tab|browser new tab)$/i.test(text)
    || /^(新标签|新建标签|打开新标签页)$/.test(text)) {
    return { intent: 'browser_control', label: 'New tab', requiresLocalExecution: true, args: { browserAction: 'new_tab' } };
  }

  if (/^(close tab|close current tab)$/i.test(text)
    || /^(关闭标签|关闭当前标签|关闭标签页)$/.test(text)) {
    return { intent: 'browser_control', label: 'Close tab', requiresLocalExecution: true, args: { browserAction: 'close_tab' } };
  }

  if (/^(setup guide|setup status|config guide|configuration status)$/i.test(text)
    || /^(设置状态|配置状态|配置检查|设置指南)$/.test(text)) {
    return { intent: 'setup_guide', label: 'Setup guide', args: {} };
  }

  if (/^(fix setup|setup next|next setup|open next setup|fix config|configure javis)$/i.test(text)
    || /^(修复设置|下一步设置|打开下一步设置|修复配置|配置javis|配置JAVIS)$/.test(text)) {
    return { intent: 'setup_next', label: 'Fix setup', args: {} };
  }

  if (/^(check in|check-in|progress|session check in|where are we|what have we done)$/i.test(text)
    || /^(进展|进度|做到哪了|我们做到哪了|汇报一下|工作汇报|会话汇报)$/.test(text)) {
    return { intent: 'session_check_in', label: 'Session check-in', args: {} };
  }

  if (/^(session|work session|current session|session status)$/i.test(text)
    || /^(会话|工作会话|当前会话|session状态)$/.test(text)) {
    return { intent: 'session_status', label: 'Session status', args: {} };
  }

  if (/^(end session|finish session|stop session)$/i.test(text)
    || /^(结束会话|结束工作会话|完成会话|停止会话)$/.test(text)) {
    return { intent: 'end_session', label: 'End session', args: {} };
  }

  if (/^(resume session|resume work session|continue session|continue last session|pick up session)$/i.test(text)
    || /^(继续会话|继续上次|继续上次会话|恢复会话|接着上次)$/.test(text)) {
    return { intent: 'resume_session', label: 'Resume session', args: {} };
  }

  const startSessionMatch =
    text.match(/^(?:start session|start work session|new session|focus on)[:：]?\s+(.+)$/i)
    || text.match(/^(?:开始会话|开始工作会话|新建会话|专注)[:：]?\s*(.+)$/i);
  if (startSessionMatch?.[1]?.trim()) {
    return { intent: 'start_session', label: 'Start session', args: { goal: startSessionMatch[1].trim() } };
  }

  const sessionNoteMatch =
    text.match(/^(?:session note|note session|log session)[:：]?\s+(.+)$/i)
    || text.match(/^(?:会话记录|记录会话|session记录)[:：]?\s*(.+)$/i);
  if (sessionNoteMatch?.[1]?.trim()) {
    return { intent: 'session_note', label: 'Session note', args: { text: sessionNoteMatch[1].trim() } };
  }

  if (/^(inbox|show inbox|list inbox|what'?s in inbox)$/i.test(text)
    || /^(收件箱|查看收件箱|查看inbox|列出inbox|待处理)$/.test(text)) {
    return { intent: 'list_inbox', label: 'List Inbox', args: {} };
  }

  if (/^(triage inbox|inbox triage|sort inbox|prioritize inbox)$/i.test(text)
    || /^(整理收件箱|整理inbox|收件箱整理|inbox整理|待办整理|整理待办)$/.test(text)) {
    return { intent: 'triage_inbox', label: 'Triage Inbox', args: {} };
  }

  if (/^(process next inbox|do next inbox|run next inbox|process inbox next|handle next inbox)$/i.test(text)
    || /^(处理下一个待办|处理下一个inbox|处理下一项待办|处理下一项inbox|开始处理待办|处理收件箱下一项)$/.test(text)) {
    return { intent: 'process_next_inbox', label: 'Process next Inbox', args: {} };
  }

  if (/(clipboard|剪贴板).*(inbox|capture|save|later|保存|捕获|稍后|待办)/i.test(text)
    || /(保存|捕获).*(clipboard|剪贴板)/i.test(text)) {
    return { intent: 'capture_clipboard', label: 'Capture clipboard', args: {} };
  }

  const captureMatch =
    text.match(/^(?:inbox|capture|save|add(?: to)? inbox|save for later)[:：]\s*(.+)$/i)
    || text.match(/^(?:保存到?inbox|保存到?收件箱|添加到?inbox|添加到?收件箱|稍后处理|记到?待办)[:：]?\s*(.+)$/i);
  if (captureMatch?.[1]?.trim()) {
    const body = captureMatch[1].trim();
    return { intent: 'capture_text', label: 'Capture text', args: { body } };
  }

  const openUrlMatch =
    text.match(/^(?:open|打开)\s+(https?:\/\/\S+)$/i)
    || text.match(/^(?:open url|打开网址)[:：]?\s*(https?:\/\/\S+)$/i);
  if (openUrlMatch?.[1]) {
    return { intent: 'open_url', label: 'Open URL', args: { url: openUrlMatch[1] } };
  }

  const searchMatch =
    text.match(/^(?:search web|search google|google|web search|look up online)[:：]?\s+(.+)$/i)
    || text.match(/^(?:搜索网页|网上搜|谷歌|google一下|查网页)[:：]?\s*(.+)$/i);
  if (searchMatch?.[1]?.trim()) {
    return { intent: 'web_search', label: 'Web search', args: { query: searchMatch[1].trim() } };
  }

  const localAppWorkflow = safeLocalAppWorkflowPlan(text);
  if (localAppWorkflow) {
    return {
      intent: 'app_workflow',
      label: 'App workflow',
      requiresLocalExecution: true,
      args: {
        instruction: text,
        useModel: false,
        maxNodes: 160,
        maxDepth: 8,
        plan: {
          source: localAppWorkflow.source,
          title: localAppWorkflow.title,
          confidence: localAppWorkflow.confidence,
          stepCount: localAppWorkflow.steps.length,
          steps: localAppWorkflow.steps.map((step) => ({
            type: step.type,
            label: step.label,
            app: step.app,
            instruction: step.instruction,
            text: step.text,
            keys: step.keys,
            ms: step.ms,
          })),
        },
      },
    };
  }

  const cliMatch =
    text.match(/^(?:run command|run cli|shell command|cli)[:：]\s*([\s\S]+)$/i)
    || text.match(/^(?:运行命令|执行命令|跑命令|运行cli|执行cli)[:：]\s*([\s\S]+)$/i);
  if (cliMatch?.[1]?.trim()) {
    return {
      intent: 'cli_command',
      label: 'Run CLI command',
      requiresLocalExecution: true,
      args: {
        command: cliMatch[1].trim(),
      },
    };
  }

  const appAliases = {
    chrome: 'Google Chrome',
    googlechrome: 'Google Chrome',
    safari: 'Safari',
    finder: 'Finder',
    notes: 'Notes',
    note: 'Notes',
    terminal: 'Terminal',
    iterm: 'iTerm',
    cursor: 'Cursor',
    claude: 'Claude',
    spotify: 'Spotify',
    obsidian: 'Obsidian',
    textedit: 'TextEdit',
    text: 'TextEdit',
    mail: 'Mail',
    calendar: 'Calendar',
    reminders: 'Reminders',
    messages: 'Messages',
    preview: 'Preview',
    music: 'Music',
    访达: 'Finder',
    备忘录: 'Notes',
    终端: 'Terminal',
    日历: 'Calendar',
    提醒事项: 'Reminders',
    邮件: 'Mail',
    信息: 'Messages',
    预览: 'Preview',
    音乐: 'Music',
    文本编辑: 'TextEdit',
  };
  const appMatch =
    text.match(/^(?:open app|open application|launch|打开应用|打开软件)[:：]?\s+(.+)$/i)
    || text.match(/^(?:open|打开)\s+([A-Za-z][A-Za-z0-9 ._-]{1,40}|[\u4e00-\u9fff]{2,8})$/i);
  if (appMatch?.[1]?.trim()) {
    const requested = appMatch[1].trim();
    const key = requested.toLowerCase().replace(/\s+/g, '');
    const app = appAliases[key] || appAliases[requested] || requested;
    if (!/[;&|`$<>]/.test(app)) {
      return { intent: 'open_app', label: 'Open app', args: { app } };
    }
  }

  return null;
}

function localCommandDecisionPayload(command, execute) {
  const localExecutionIntents = new Set(['app_workflow', 'browser_control', 'cli_command', 'open_app', 'open_url', 'web_search']);
  return {
    lane: 'quick',
    mode: 'quick',
    label: command.label,
    confidence: 0.98,
    reason: `matched local command: ${command.intent}`,
    execute: Boolean(execute),
    requiresOpenAiKey: Boolean(command.requiresOpenAiKey),
    requiresLocalExecution: Boolean(command.requiresLocalExecution || localExecutionIntents.has(command.intent)),
    localCommand: command.intent,
    features: {
      chars: 0,
      words: 0,
      lines: 1,
      localCommand: command.intent,
      hasScreen: false,
    },
  };
}

function formatBriefingForLocalCommand(briefing) {
  const actions = (briefing.nextActions || [])
    .slice(0, 4)
    .map((action, index) => `${index + 1}. ${action.label}: ${action.summary}`)
    .join('\n');
  return [
    briefing.summary,
    actions ? `下一步:\n${actions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatInboxForLocalCommand(items, counts) {
  if (!items.length) return `Inbox 为空。共 ${counts.total} 条，open ${counts.open} 条。`;
  const lines = items.map((item, index) => `${index + 1}. ${item.title} · priority ${item.priority} · ${item.source}`);
  return [`Inbox: ${counts.open} open / ${counts.total} total`, ...lines].join('\n');
}

function screenAgeLabel(screenSnapshot) {
  if (!screenSnapshot?.updatedAt) return '无屏幕帧';
  const seconds = Math.max(0, Math.round((Date.now() - Number(screenSnapshot.updatedAt)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

function formatScreenCaptureForLocalCommand(screenSnapshot) {
  if (!screenSnapshot) return '未能捕获当前屏幕。';
  const privacy = screenSnapshot.privacy?.label || screenSnapshot.privacy?.mode || 'unknown';
  return [
    `屏幕已刷新: ${screenSnapshot.width}x${screenSnapshot.height}`,
    `隐私模式: ${privacy}`,
    `显示器: ${screenSnapshot.displayName || screenSnapshot.displayId || 'primary'}`,
  ].join('\n');
}

function formatObservationForLocalCommand(observation) {
  const mac = observation?.mac || {};
  const frontmost = mac.frontmost || {};
  const browser = mac.browser || {};
  const screenSnapshot = observation?.screen || mac.screen || null;
  const accessibility = observation?.accessibility || {};
  const queue = mac.queue || {};
  const lines = [
    `当前 App: ${frontmost.app || accessibility.app || '未知'}`,
    frontmost.windowTitle || accessibility.windowTitle
      ? `窗口: ${frontmost.windowTitle || accessibility.windowTitle}`
      : '',
    screenSnapshot
      ? `屏幕: ${screenSnapshot.width}x${screenSnapshot.height} · ${screenAgeLabel(screenSnapshot)} · ${screenSnapshot.privacy?.label || screenSnapshot.privacy?.mode || 'privacy'}`
      : '屏幕: 无可用帧',
    accessibility?.available
      ? `UI: ${accessibility.nodeCount || 0} nodes${accessibility.truncated ? ' · truncated' : ''}`
      : accessibility?.error
        ? `UI: ${accessibility.error}`
        : '',
    browser?.available
      ? `浏览器: ${compactRecordText(browser.title || browser.url || browser.app, 140)}`
      : '',
    mac.clipboard?.hasText
      ? `剪贴板: ${mac.clipboard.length || 0} chars · ${compactRecordText(mac.clipboard.preview || '', 100)}`
      : '剪贴板: empty',
    `任务: running ${queue.running || 0}, queued ${queue.queued || 0}; approvals ${(mac.pendingApprovals || []).length}`,
    observation?.vision?.output ? `视觉: ${compactRecordText(observation.vision.output, 220)}` : '',
    observation?.errors?.length ? `错误: ${observation.errors.join('; ')}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function runLocalCommand(command, options = {}) {
  appendAudit('local_command.requested', { intent: command.intent, label: command.label });
  try {
    if (command.intent === 'status') {
      const briefing = workflowBriefing({ workflowLimit: 4, jobLimit: 4 });
      return {
        ok: true,
        localCommand: command,
        output: formatBriefingForLocalCommand(briefing),
        data: { briefing },
      };
    }

    if (command.intent === 'work_progress') {
      const progress = workProgressCheckIn({ source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: progress.output,
        data: { progress },
      };
    }

    if (command.intent === 'work_next') {
      const result = await workNextAction({ execute: true, source: 'local_command' });
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { result },
      };
    }

    if (command.intent === 'capture_screen') {
      const screenFrame = await captureResidentScreen({ source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: formatScreenCaptureForLocalCommand(screenFrame),
        data: { screen: screenFrame },
      };
    }

    if (command.intent === 'observe_now' || command.intent === 'describe_screen') {
      const observation = await observeNow({
        ...(command.args || {}),
        source: 'local_command',
        maxNodes: command.args?.maxNodes || 100,
        maxDepth: command.args?.maxDepth || 6,
      });
      return {
        ok: observation.ok,
        localCommand: command,
        output: formatObservationForLocalCommand(observation),
        data: { observation },
      };
    }

    if (command.intent === 'browser_control') {
      const result = await executeBrowserControl(command.args || {});
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { result },
      };
    }

    if (command.intent === 'setup_guide') {
      const guide = setupGuideSnapshot();
      return {
        ok: true,
        localCommand: command,
        output: guide.output,
        data: { guide },
      };
    }

    if (command.intent === 'setup_next') {
      const result = await runNextSetupAction({ source: 'local_command' });
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { result },
      };
    }

    if (command.intent === 'list_inbox') {
      const counts = inboxCounts();
      const items = inboxSnapshot(8, 'open');
      return {
        ok: true,
        localCommand: command,
        output: formatInboxForLocalCommand(items, counts),
        data: { counts, items },
      };
    }

    if (command.intent === 'triage_inbox') {
      const triage = triageInbox({ source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: triage.output,
        data: { triage },
      };
    }

    if (command.intent === 'process_next_inbox') {
      const result = await processNextInbox({ source: 'local_command' });
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { result },
      };
    }

    if (command.intent === 'session_status') {
      const active = activeSessionSnapshot();
      const counts = sessionCounts();
      const output = active
        ? `当前会话: ${active.title}\n目标: ${active.goal}\n事件: ${active.events.length}`
        : `当前没有 active session。历史 session 共 ${counts.total} 个。`;
      return {
        ok: true,
        localCommand: command,
        output,
        data: { active, counts, recent: sessionSnapshot(5) },
      };
    }

    if (command.intent === 'session_check_in') {
      const checkIn = sessionCheckIn({ source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: checkIn.output,
        data: { checkIn },
      };
    }

    if (command.intent === 'start_session') {
      const session = startWorkSession({ goal: command.args.goal, source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: `已开始工作会话: ${session.title}`,
        data: { session, counts: sessionCounts() },
      };
    }

    if (command.intent === 'resume_session') {
      const result = resumeWorkSession({ source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: `已继续上次工作会话: ${result.session.title}\n${result.checkIn.output}`,
        data: { result },
      };
    }

    if (command.intent === 'session_note') {
      const result = addWorkSessionEvent('', { text: command.args.text, type: 'note', source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: `已记录到会话: ${result.event.text}`,
        data: { session: result.session, event: result.event },
      };
    }

    if (command.intent === 'end_session') {
      const session = endWorkSession('', { source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: `已结束工作会话:\n${session.summary}`,
        data: { session, counts: sessionCounts() },
      };
    }

    if (command.intent === 'capture_clipboard') {
      const item = captureClipboardToInbox('local_command');
      return {
        ok: true,
        localCommand: command,
        output: `已把剪贴板保存到 Inbox: ${item.title}`,
        data: { item, counts: inboxCounts() },
      };
    }

    if (command.intent === 'capture_text') {
      const item = createInboxItem({ body: command.args.body, source: 'local_command' });
      return {
        ok: true,
        localCommand: command,
        output: `已保存到 Inbox: ${item.title}`,
        data: { item, counts: inboxCounts() },
      };
    }

    if (command.intent === 'open_url') {
      const output = await executeMacAction({ action: 'open_url', value: command.args.url });
      return { ok: true, localCommand: command, output, data: { url: command.args.url } };
    }

    if (command.intent === 'web_search') {
      const url = `https://www.google.com/search?q=${encodeURIComponent(command.args.query)}`;
      const output = await executeMacAction({ action: 'open_url', value: url });
      return {
        ok: true,
        localCommand: command,
        output: `已打开网页搜索: ${command.args.query}\n${output}`,
        data: { query: command.args.query, url },
      };
    }

    if (command.intent === 'open_app') {
      const output = await executeMacAction({ action: 'open_app', value: command.args.app });
      return { ok: true, localCommand: command, output, data: { app: command.args.app } };
    }

    if (command.intent === 'app_workflow') {
      const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
      const result = await planAndMaybeRunAppWorkflow({
        instruction: command.args.instruction,
        execute,
        useModel: false,
        maxNodes: command.args.maxNodes || 160,
        maxDepth: command.args.maxDepth || 8,
        source: 'local_command',
      });
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { result },
      };
    }

    if (command.intent === 'cli_command') {
      const result = queueCliCommand({
        command: command.args.command,
        source: 'local_command',
        title: command.args.command,
      });
      return {
        ok: result.ok,
        localCommand: command,
        output: result.output,
        data: { job: result.job },
      };
    }

    return { ok: false, localCommand: command, output: `Unsupported local command: ${command.intent}` };
  } catch (error) {
    if (error instanceof ActionApprovalRequired) {
      return {
        ok: false,
        localCommand: command,
        approval: error.approval,
        output: `需要审批后才能执行: ${error.approval.summary}`,
      };
    }
    return {
      ok: false,
      localCommand: command,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

function routeTaskDecision(message, options = {}) {
  const task = String(message || '').trim();
  if (!task) throw new Error('Missing task.');
  const lower = task.toLowerCase();
  const forcedLane = ['quick', 'background', 'codex', 'claude'].includes(String(options.mode || options.lane || '').trim())
    ? String(options.mode || options.lane).trim()
    : '';
  const wordCount = task.split(/\s+/).filter(Boolean).length;
  const lineCount = task.split(/\n+/).filter((line) => line.trim()).length;
  const reasons = [];
  let lane = 'quick';
  let confidence = 0.68;

  const explicitClaude = /\bclaude\b|claude code|用\s*claude/i.test(task);
  const explicitCodex = /\bcodex\b|用\s*codex/i.test(task);
  const codeSignal = /repo|codebase|代码|仓库|bug|test|lint|build|typescript|react|electron|api|endpoint|实现|修复|重构|commit|diff|pr\b|pull request/i.test(task);
  const codeActionSignal = /修复|实现|重构|改|调试|跑测试|测试|debug|fix|implement|refactor|patch|build|lint|test|commit/i.test(task);
  const longWorkSignal = /分析|计划|调研|比较|整理|总结|写一份|生成|设计|方案|报告|复盘|research|analy[sz]e|compare|summari[sz]e|draft|plan|report/i.test(task);
  const computerWorkSignal = /文件|目录|folder|file|browser|网页|页面|screen|屏幕|app|窗口|剪贴板|clipboard/i.test(task);
  const simpleQuestionSignal = /^(what|who|when|where|why|how|is|are|can|do|does|did)\b|[?？]$|^(什么|谁|哪里|什么时候|为什么|怎么|可以吗)/i.test(task);

  if (forcedLane) {
    lane = forcedLane;
    confidence = 0.99;
    reasons.push(`user selected ${forcedLane} lane`);
  } else if (explicitClaude) {
    lane = 'claude';
    confidence = 0.96;
    reasons.push('user explicitly requested Claude');
  } else if (explicitCodex) {
    lane = 'codex';
    confidence = 0.96;
    reasons.push('user explicitly requested Codex');
  } else if (codeSignal && (codeActionSignal || longWorkSignal || wordCount > 8 || task.length > 80)) {
    lane = 'codex';
    confidence = 0.84;
    reasons.push('coding or repo work benefits from a code agent');
  } else if (task.length > 260 || wordCount > 45 || lineCount > 2 || longWorkSignal || computerWorkSignal) {
    lane = 'background';
    confidence = computerWorkSignal || longWorkSignal ? 0.78 : 0.72;
    reasons.push('multi-step or context-heavy task should run outside the fast lane');
  } else if (simpleQuestionSignal || task.length < 160) {
    lane = 'quick';
    confidence = 0.76;
    reasons.push('short lightweight interaction');
  }

  const mode = lane === 'quick' ? 'quick' : lane;
  return {
    lane,
    mode,
    label: lane === 'quick' ? 'Quick' : lane === 'background' ? 'Deep' : lane === 'codex' ? 'Codex' : 'Claude',
    confidence,
    reason: reasons.join('; ') || 'default fast lane',
    execute: Boolean(options.execute),
    requiresOpenAiKey: lane === 'quick' || lane === 'background',
    requiresLocalExecution: lane === 'codex' || lane === 'claude',
    features: {
      chars: task.length,
      words: wordCount,
      lines: lineCount,
      explicitCodex,
      explicitClaude,
      forcedLane,
      codeSignal,
      codeActionSignal,
      longWorkSignal,
      computerWorkSignal,
      simpleQuestionSignal,
      hasScreen: Boolean(options.includeScreen && latestScreen),
    },
  };
}

async function answerQuickLane(options = {}) {
  const task = String(options.message || options.task || '').trim();
  if (!task) throw new Error('Missing message');
  return callOpenAIResponsesWithFallback({
    model: models.fast,
    instructions:
      'You are the fast lane inside JAVIS. Answer simple questions quickly in Chinese. If the task is complex, recommend sending it to the background lane.',
    input: String(options.input || task),
    imageDataUrl: options.includeScreen ? latestScreen?.imageDataUrl : undefined,
    maxOutputTokens: Math.max(80, Math.min(900, Number(options.maxOutputTokens || 500))),
  }, {
    source: options.source || 'quick_lane',
    timeoutMs: options.timeoutMs || 60000,
  });
}

function quickLaneOutputOk(output) {
  const text = String(output || '').trim();
  return Boolean(text) && !text.startsWith('OpenAI API key is not configured.');
}

async function routeTask(options = {}) {
  const task = String(options.message || options.task || '').trim();
  const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
  const routingContext = {
    task,
    source: String(options.source || 'router').slice(0, 80),
    owner: options.owner || '',
    parallelGroup: options.parallelGroup || options.group || '',
    scope: options.scope || '',
  };
  const localCommand = localCommandDecision(task);
  if (localCommand) {
    const decision = localCommandDecisionPayload(localCommand, execute);
    appendAudit('task_route.local_command', {
      intent: localCommand.intent,
      execute,
      chars: task.length,
    });
    if (!execute) {
      if (localCommand.intent === 'app_workflow') {
        const result = await runLocalCommand(localCommand, { execute: false });
        return finalizeRouteResult({
          ok: Boolean(result.ok),
          executed: false,
          queued: false,
          decision,
          localCommand: result.localCommand,
          approval: result.approval,
          memory: { matches: [], count: 0 },
          output: result.output,
          data: result.data,
        }, { ...routingContext, decision, localCommand });
      }
      return finalizeRouteResult({
        ok: true,
        executed: false,
        queued: false,
        decision,
        localCommand,
        memory: { matches: [], count: 0 },
        output: `Local: ${localCommand.label}`,
      }, { ...routingContext, decision, localCommand });
    }
    const result = await runLocalCommand(localCommand, { execute: true });
    appendAudit('local_command.completed', {
      intent: localCommand.intent,
      ok: result.ok,
      outputLength: result.output ? String(result.output).length : 0,
    });
    return finalizeRouteResult({
      ok: Boolean(result.ok),
      executed: true,
      queued: false,
      decision,
      localCommand: result.localCommand,
      approval: result.approval,
      memory: { matches: [], count: 0 },
      output: result.output,
      data: result.data,
    }, { ...routingContext, decision, localCommand });
  }
  const memoryContext = memoryContextForTask(task, {
    useMemory: options.useMemory !== false,
    memoryLimit: options.memoryLimit,
  });
  const decision = routeTaskDecision(task, {
    execute,
    includeScreen: Boolean(options.includeScreen),
    mode: options.mode || options.lane,
  });

  appendAudit('task_route.decided', {
    lane: decision.lane,
    confidence: decision.confidence,
    reason: decision.reason,
    execute,
    chars: decision.features.chars,
    memoryMatches: memoryContext.matches.length,
  });

  if (!execute) {
    return finalizeRouteResult({
      ok: true,
      executed: false,
      queued: false,
      decision,
      memory: {
        matches: memoryContext.matches,
        count: memoryContext.matches.length,
      },
      output: `Route: ${decision.label} · ${decision.reason}`,
    }, { ...routingContext, decision, memoryMatches: memoryContext.matches.length });
  }

  if (decision.lane === 'quick') {
    try {
      const output = await answerQuickLane({
        message: task,
        input: [memoryContext.prompt, 'Task:', task].filter(Boolean).join('\n\n'),
        includeScreen: Boolean(options.includeScreen),
        source: routingContext.source === 'router' ? 'task_route_quick' : routingContext.source,
      });
      return finalizeRouteResult({
        ok: quickLaneOutputOk(output),
        executed: true,
        queued: false,
        decision,
        memory: {
          matches: memoryContext.matches,
          count: memoryContext.matches.length,
        },
        output,
      }, { ...routingContext, decision, memoryMatches: memoryContext.matches.length });
    } catch (error) {
      return finalizeRouteResult({
        ok: false,
        executed: true,
        queued: false,
        decision,
        memory: {
          matches: memoryContext.matches,
          count: memoryContext.matches.length,
        },
        output: error instanceof Error ? error.message : String(error),
      }, { ...routingContext, decision, memoryMatches: memoryContext.matches.length });
    }
  }

  const jobTask = [memoryContext.prompt, 'Task:', task].filter(Boolean).join('\n\n');
  const job = createJob(jobTask, decision.lane === 'background' ? 'background' : decision.lane, 'router', { title: task });
  return finalizeRouteResult({
    ok: true,
    executed: true,
    queued: true,
    decision,
    memory: {
      matches: memoryContext.matches,
      count: memoryContext.matches.length,
    },
    job,
    output: `Routed to ${decision.label}: ${job.title}`,
  }, { ...routingContext, decision, memoryMatches: memoryContext.matches.length });
}

function normalizeParallelTaskItem(raw = {}, index = 0, defaults = {}) {
  const command = String(raw.command || raw.cli || '').trim();
  const task = String(raw.message || raw.task || raw.title || command || '').trim();
  const requestedMode = String(raw.mode || raw.lane || defaults.mode || defaults.lane || '').trim();
  const mode = command || requestedMode === 'cli'
    ? 'cli'
    : ['quick', 'background', 'codex', 'claude'].includes(requestedMode)
      ? requestedMode
      : '';
  const scope = String(raw.scope || defaults.scope || '').trim()
    || `parallel item ${index + 1}: ${compactRecordText(task, 110)}`;
  return {
    task,
    command,
    mode,
    owner: String(raw.owner || defaults.owner || (mode === 'cli' ? 'local' : mode ? ownerForRoutingLane(mode) : '')).trim(),
    scope,
    title: String(raw.title || task).trim(),
    includeScreen: raw.includeScreen ?? defaults.includeScreen,
    useMemory: raw.useMemory ?? defaults.useMemory,
    memoryLimit: raw.memoryLimit ?? defaults.memoryLimit,
    timeoutMs: raw.timeoutMs ?? defaults.timeoutMs,
  };
}

function parallelRouteCounts(results = []) {
  return results.reduce(
    (counts, item) => {
      counts.total += 1;
      if (item.ok) counts.ok += 1;
      else counts.failed += 1;
      if (item.queued) counts.queued += 1;
      const lane = item.routing?.lane || item.decision?.lane || 'unknown';
      counts.byLane[lane] = (counts.byLane[lane] || 0) + 1;
      const status = item.routing?.status || item.status || 'unknown';
      counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;
      return counts;
    },
    { total: 0, ok: 0, failed: 0, queued: 0, byLane: {}, byStatus: {} },
  );
}

function previewParallelCliTask(item, context = {}) {
  const decision = {
    lane: 'local',
    mode: 'cli',
    label: 'CLI',
    confidence: 1,
    reason: 'parallel group includes explicit CLI command',
    execute: false,
    requiresOpenAiKey: false,
    requiresLocalExecution: true,
    localCommand: 'cli_command',
  };
  const record = createRoutingRecord({
    task: item.title || redactCommandForLog(item.command),
    decision,
    source: context.source,
    execute: false,
    status: 'preview',
    owner: item.owner || 'local',
    scope: item.scope,
    parallelGroup: context.parallelGroup,
    resultSummary: `Preview CLI command: ${redactCommandForLog(item.command)}`,
  });
  return {
    ok: true,
    executed: false,
    queued: false,
    decision,
    routing: record,
    routeRecord: record,
    output: `CLI preview: ${redactCommandForLog(item.command)}`,
  };
}

function queueParallelCliTask(item, context = {}) {
  const result = queueCliCommand({
    command: item.command,
    title: item.title || redactCommandForLog(item.command),
    timeoutMs: item.timeoutMs,
    source: context.source,
  });
  const decision = {
    lane: 'local',
    mode: 'cli',
    label: 'CLI',
    confidence: 1,
    reason: 'parallel group includes explicit CLI command',
    execute: true,
    requiresOpenAiKey: false,
    requiresLocalExecution: true,
    localCommand: 'cli_command',
  };
  const routing = createRoutingRecord({
    task: item.title || redactCommandForLog(item.command),
    decision,
    source: context.source,
    execute: true,
    status: result.job?.status || 'queued',
    jobId: result.job?.id || '',
    owner: item.owner || 'local',
    scope: item.scope,
    parallelGroup: context.parallelGroup,
    resultSummary: result.output,
  });
  return {
    ...result,
    ok: true,
    executed: true,
    queued: true,
    decision,
    routing,
    routeRecord: routing,
  };
}

async function routeParallelTasks(options = {}) {
  const rawTasks = Array.isArray(options.tasks)
    ? options.tasks
    : Array.isArray(options.items)
      ? options.items
      : [];
  const tasks = rawTasks
    .slice(0, MAX_PARALLEL_TASKS)
    .map((item, index) => normalizeParallelTaskItem(item, index, options))
    .filter((item) => item.task || item.command);
  if (!tasks.length) throw new Error('No parallel tasks were provided.');
  const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
  const parallelGroup = String(options.parallelGroup || options.group || `parallel:${crypto.randomUUID()}`).slice(0, 120);
  const source = String(options.source || 'parallel_router').slice(0, 80);
  const startedAt = Date.now();
  const results = [];

  for (const [index, item] of tasks.entries()) {
    try {
      const result = item.command || item.mode === 'cli'
        ? execute
          ? queueParallelCliTask(item, { parallelGroup, source })
          : previewParallelCliTask(item, { parallelGroup, source })
        : await routeTask({
          message: item.task,
          execute,
          includeScreen: Boolean(item.includeScreen),
          useMemory: item.useMemory,
          memoryLimit: item.memoryLimit,
          mode: item.mode,
          owner: item.owner,
          scope: item.scope,
          parallelGroup,
          source,
        });
      results.push({
        index,
        task: item.task,
        command: item.command ? redactCommandForLog(item.command) : '',
        ok: result.ok !== false,
        queued: Boolean(result.queued || result.job),
        output: result.output || '',
        decision: result.decision,
        job: result.job,
        routing: result.routing || result.routeRecord,
      });
    } catch (error) {
      results.push({
        index,
        task: item.task,
        command: item.command ? redactCommandForLog(item.command) : '',
        ok: false,
        queued: false,
        output: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const counts = parallelRouteCounts(results);
  const output = [
    `Parallel group ${parallelGroup}: ${counts.ok}/${counts.total} routed, ${counts.queued} queued.`,
    results.map((item) => `${item.index + 1}. ${item.routing?.lane || item.decision?.lane || 'failed'}/${item.routing?.status || ''} · ${item.routing?.owner || ''} · ${compactRecordText(item.task || item.command, 100)} · ${item.routing?.resultLink || item.output}`).join('\n'),
  ].filter(Boolean).join('\n');

  appendAudit('task_parallel.routed', {
    parallelGroup,
    execute,
    total: counts.total,
    ok: counts.ok,
    queued: counts.queued,
    source,
  });

  return {
    ok: counts.failed === 0,
    executed: execute,
    parallelGroup,
    maxTasks: MAX_PARALLEL_TASKS,
    elapsedMs: Date.now() - startedAt,
    counts,
    results,
    routingLedger: results.map((item) => item.routing && routingLedgerEntry(item.routing)).filter(Boolean),
    output,
  };
}

function formatFileEntries(entries = []) {
  return entries
    .slice(0, 80)
    .map((entry) => `${entry.type}\t${entry.size}\t${entry.modifiedAt}\t${entry.name}`)
    .join('\n');
}

function formatFileSearchResults(results = []) {
  return results
    .slice(0, 80)
    .map((entry) => `${entry.match}\t${entry.size}\t${entry.modifiedAt}\t${entry.path}`)
    .join('\n');
}

const ORGANIZE_EXTENSIONS = {
  Images: ['.avif', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.psd', '.svg', '.tiff', '.webp'],
  Documents: ['.csv', '.doc', '.docx', '.key', '.md', '.numbers', '.pages', '.pdf', '.ppt', '.pptx', '.rtf', '.txt', '.xls', '.xlsx'],
  Archives: ['.7z', '.bz2', '.dmg', '.gz', '.pkg', '.rar', '.tar', '.tgz', '.zip'],
  Audio: ['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.wav'],
  Video: ['.avi', '.m4v', '.mov', '.mp4', '.webm'],
  Code: ['.c', '.cc', '.cpp', '.css', '.go', '.html', '.java', '.js', '.json', '.jsx', '.py', '.rb', '.rs', '.sh', '.ts', '.tsx', '.xml', '.yaml', '.yml'],
  Data: ['.db', '.jsonl', '.parquet', '.sqlite', '.tsv'],
};

function organizeCategoryForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(ORGANIZE_EXTENSIONS)) {
    if (extensions.includes(extension)) return category;
  }
  return 'Other';
}

function previewPlannedFileStep(step) {
  try {
    const plan = buildLocalActionPlan(step);
    const evaluation = evaluateMacActionPlan(plan, { preview: true });
    return { ok: true, action: step.action, plan, evaluation };
  } catch (error) {
    return {
      ok: false,
      action: step.action,
      args: step,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatFilePlanSteps(steps = []) {
  return steps
    .map((step, index) => {
      if (!step.ok) return `${index + 1}. ${step.action}: blocked · ${step.error}`;
      const reason = step.evaluation?.reason ? ` · ${step.evaluation.reason}` : '';
      return `${index + 1}. ${step.plan.summary}${reason}`;
    })
    .join('\n');
}

function planFileOrganization(options = {}) {
  const targetPath = String(options.path || '.');
  const maxEntries = Math.max(1, Math.min(500, Number(options.maxEntries || 120)));
  const maxMoves = Math.max(1, Math.min(200, Number(options.maxMoves || 40)));
  const rawContext = executeFileAction({ action: 'list_directory', path: targetPath, maxEntries });
  return Promise.resolve(rawContext).then((raw) => {
    const directory = JSON.parse(raw);
    const directoryPath = directory.path;
    const entries = (directory.entries || [])
      .filter((entry) => entry.type === 'file')
      .filter((entry) => !String(entry.name || '').startsWith('.'))
      .slice(0, maxMoves);
    const neededDirectories = new Map();
    const moveSteps = [];

    for (const entry of entries) {
      const category = organizeCategoryForFile(entry.name);
      const destinationDirectory = path.join(directoryPath, category);
      const destinationPath = path.join(destinationDirectory, entry.name);
      if (entry.path === destinationPath) continue;
      neededDirectories.set(destinationDirectory, {
        action: 'create_directory',
        path: destinationDirectory,
      });
      moveSteps.push({
        action: 'move_file',
        sourcePath: entry.path,
        destinationPath,
      });
    }

    const rawSteps = [...neededDirectories.values(), ...moveSteps];
    const steps = rawSteps.map(previewPlannedFileStep);
    const blocked = steps.filter((step) => !step.ok || step.evaluation?.blocked).length;
    const approvals = steps.filter((step) => step.ok && step.evaluation?.needsApproval).length;
    const summary = steps.length
      ? `${steps.length} planned file operation(s): ${approvals} need approval, ${blocked} blocked by current policy/setup.`
      : 'No file moves are needed for this folder.';

    appendAudit('file_plan.created', {
      intent: 'organize_by_type',
      path: directoryPath,
      entries: entries.length,
      steps: steps.length,
      blocked,
      approvals,
    });

    return {
      ok: blocked === 0,
      intent: 'organize_by_type',
      path: directoryPath,
      title: `organize · ${path.basename(directoryPath) || directoryPath}`.slice(0, 180),
      summary,
      counts: {
        entries: entries.length,
        steps: steps.length,
        approvals,
        blocked,
      },
      steps,
      output: formatFilePlanSteps(steps) || summary,
    };
  });
}

function filePlanExecutableSteps(plan) {
  return (plan.steps || [])
    .filter((step) => step?.ok && step?.plan?.args && ['create_directory', 'copy_file', 'move_file'].includes(step.action))
    .map((step) => step.plan.args);
}

function formatFilePlanApplyResults(results = []) {
  return results
    .map((result, index) => {
      const detail = result.output || result.error || result.approval?.summary || '';
      return `${index + 1}. ${result.status}: ${result.summary}${detail ? ` · ${detail}` : ''}`;
    })
    .join('\n');
}

async function applyFilePlan(options = {}) {
  const requestedWorkflowId = String(options.workflowId || '').trim();
  const parentWorkflow = requestedWorkflowId ? workflows.get(requestedWorkflowId) || null : null;
  if (requestedWorkflowId && !parentWorkflow) throw new Error('Workflow not found.');

  const pathForPlan = String(options.path || parentWorkflow?.target?.path || '.');
  const plan = await planFileOrganization({
    ...options,
    path: pathForPlan,
  });
  const steps = filePlanExecutableSteps(plan);
  const confirmed = options.confirm === true || String(options.confirm || '').toLowerCase() === 'true';

  if (!confirmed) {
    return {
      ok: false,
      confirmed: false,
      parentWorkflow,
      plan,
      output: 'Review the file plan first, then call apply with confirm:true. No file actions were requested.',
    };
  }

  appendAudit('file_plan.apply_requested', {
    path: plan.path,
    parentWorkflowId: parentWorkflow?.id || '',
    steps: steps.length,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
  });

  const results = [];
  for (const step of steps) {
    const preview = previewPlannedFileStep(step);
    const summary = preview.ok ? preview.plan.summary : `${step.action} ${step.path || step.sourcePath || ''}`.trim();
    try {
      const output = await executeFileAction(step);
      results.push({ status: 'executed', action: step.action, summary, output });
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        results.push({
          status: 'approval_required',
          action: step.action,
          summary,
          approval: error.approval,
        });
        continue;
      }
      results.push({
        status: 'blocked',
        action: step.action,
        summary,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const counts = results.reduce(
    (memo, result) => {
      memo.total += 1;
      memo[result.status] = (memo[result.status] || 0) + 1;
      return memo;
    },
    { total: 0, executed: 0, approval_required: 0, blocked: 0 },
  );
  const output = formatFilePlanApplyResults(results) || 'No file actions were requested.';
  const status = counts.blocked ? 'blocked' : counts.approval_required ? 'blocked' : 'done';
  const workflow = createWorkflowRecord({
    kind: 'file',
    source: 'file_plan_apply',
    status,
    title: `apply · ${path.basename(plan.path) || plan.path}`.slice(0, 180),
    intent: 'apply_plan',
    mode: 'local',
    request: `Apply file organization plan for ${plan.path}`,
    result: output,
    parentWorkflowId: parentWorkflow?.id || '',
    target: {
      app: 'Files',
      title: path.basename(plan.path) || plan.path,
      path: plan.path,
      type: 'file_plan_apply',
      resultCount: counts.total,
      returnedLength: output.length,
    },
  });

  appendAudit('file_plan.apply_completed', {
    path: plan.path,
    workflowId: workflow.id,
    parentWorkflowId: parentWorkflow?.id || '',
    counts,
  });

  return {
    ok: counts.blocked === 0,
    confirmed: true,
    parentWorkflow,
    workflow,
    plan,
    results,
    counts,
    output,
  };
}

async function collectFileWorkflowContext(options, intent) {
  const targetPath = String(options.path || '.');
  const maxEntries = Math.max(1, Math.min(500, Number(options.maxEntries || 80)));
  const maxResults = Math.max(1, Math.min(200, Number(options.maxResults || 80)));
  const query = String(options.query || '').trim();

  if (intent === 'search') {
    if (!query) throw new Error('Missing search query.');
    const raw = await executeFileAction({ action: 'search_files', path: targetPath, query, maxResults });
    const parsed = JSON.parse(raw);
    return {
      action: 'search_files',
      path: parsed.path,
      type: 'directory',
      query,
      text: formatFileSearchResults(parsed.results),
      result: parsed,
      target: {
        app: 'Files',
        title: path.basename(parsed.path) || parsed.path,
        path: parsed.path,
        type: 'search',
        resultCount: parsed.results.length,
        returnedLength: raw.length,
      },
    };
  }

  const allowedRoots = Array.from(
    new Set([
      ...(actionPolicy.allow?.list_directory?.allowedRoots || []),
      ...(actionPolicy.allow?.read_file?.allowedRoots || []),
    ]),
  );
  const { resolvedTarget } = assertAllowedFilePath(targetPath, allowedRoots);
  const stats = fs.statSync(resolvedTarget);
  if (stats.isDirectory()) {
    const raw = await executeFileAction({ action: 'list_directory', path: targetPath, maxEntries });
    const parsed = JSON.parse(raw);
    return {
      action: 'list_directory',
      path: parsed.path,
      type: 'directory',
      query: '',
      text: formatFileEntries(parsed.entries),
      result: parsed,
      target: {
        app: 'Files',
        title: path.basename(parsed.path) || parsed.path,
        path: parsed.path,
        type: 'directory',
        resultCount: parsed.entries.length,
        returnedLength: raw.length,
      },
    };
  }

  const maxBytes = Math.max(1, Math.min(1200000, Number(options.maxBytes || 400000)));
  const text = await executeFileAction({ action: 'read_file', path: targetPath });
  const trimmed = trimText(text, maxBytes);
  return {
    action: 'read_file',
    path: resolvedTarget,
    type: 'file',
    query: '',
    text: trimmed,
    result: {
      path: resolvedTarget,
      text: trimmed,
      truncated: trimmed.length < text.length,
    },
    target: {
      app: 'Files',
      title: path.basename(resolvedTarget) || resolvedTarget,
      path: resolvedTarget,
      type: 'file',
      textLength: text.length,
      returnedLength: trimmed.length,
    },
  };
}

function fileWorkflowPrompt(context, intent, instruction) {
  const taskMap = {
    list: '根据目录列表给出简洁说明。',
    search: '根据搜索结果说明命中内容和下一步。',
    summarize: '总结这个文件或目录上下文，给出关键内容和下一步。',
    ask: '回答用户关于这个文件或目录的问题；如果上下文不足，说明缺口。',
  };
  return [
    `File workflow: ${intent} · ${context.path}`,
    '',
    `User request: ${instruction || taskMap[intent]}`,
    '',
    `Path: ${context.path}`,
    `Type: ${context.type}`,
    context.query ? `Query: ${context.query}` : '',
    '',
    'Context:',
    context.text || '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function runFileWorkflow(options = {}) {
  const intent = normalizeFileWorkflowIntent(options.intent);
  const mode = normalizeWorkflowMode(options.mode, intent === 'list' || intent === 'search' ? 'quick' : 'background');
  const instruction = String(options.instruction || '').trim();

  if (intent === 'organize') {
    const plan = await planFileOrganization(options);
    const request = instruction || 'Plan a safe folder organization by file type.';
    const workflow = createWorkflowRecord({
      kind: 'file',
      source: 'file_workflow',
      status: plan.ok ? 'done' : 'blocked',
      title: plan.title,
      intent,
      mode: 'quick',
      request,
      target: {
        app: 'Files',
        title: path.basename(plan.path) || plan.path,
        path: plan.path,
        type: 'file_plan',
        resultCount: plan.counts.steps,
        returnedLength: plan.output.length,
      },
      result: plan.output,
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode: 'quick',
      source: options.source || 'file_workflow',
      scope: options.scope || `file:${intent}`,
      parallelGroup: options.parallelGroup || options.group || 'file:quick',
      resultSummary: plan.output || plan.summary,
    });
    return {
      ok: plan.ok,
      queued: false,
      mode: 'quick',
      intent,
      workflow,
      routing,
      target: workflow.target,
      plan,
      output: plan.output || plan.summary,
    };
  }

  const context = await collectFileWorkflowContext(options, intent);
  const request = instruction || {
    list: 'List file context.',
    search: `Search files for ${context.query || 'query'}.`,
    summarize: 'Summarize file context.',
    ask: 'Answer a question about file context.',
  }[intent];
  const title = `${intent} · ${context.target.title || context.path}`.slice(0, 180);
  const prompt = fileWorkflowPrompt(context, intent, instruction);

  appendAudit('file_workflow.requested', {
    intent,
    mode,
    action: context.action,
    path: context.path,
    type: context.type,
    resultCount: context.target.resultCount || 0,
  });

  if (mode !== 'quick') {
    const workflow = createWorkflowRecord({
      kind: 'file',
      source: 'file_workflow',
      status: 'queued',
      title,
      intent,
      mode,
      request,
      target: context.target,
    });
    const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'file_workflow', { workflowId: workflow.id });
    setWorkflow(workflow.id, { jobId: job.id });
    const finalWorkflow = workflows.get(workflow.id);
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      job,
      mode,
      source: options.source || 'file_workflow',
      scope: options.scope || `file:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `file:${mode}`,
    });
    return {
      ok: true,
      queued: true,
      mode,
      intent,
      workflow: finalWorkflow,
      job,
      routing,
      target: context.target,
      output: `Queued ${mode} file workflow for ${context.path}.`,
    };
  }

  if (intent === 'list' || intent === 'search') {
    const output = context.text || '[no results]';
    const workflow = createWorkflowRecord({
      kind: 'file',
      source: 'file_workflow',
      status: 'done',
      title,
      intent,
      mode,
      request,
      target: context.target,
      result: output,
    });
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow,
      mode,
      source: options.source || 'file_workflow',
      scope: options.scope || `file:${intent}`,
      parallelGroup: options.parallelGroup || options.group || `file:${mode}`,
      resultSummary: output,
    });
    return {
      ok: true,
      queued: false,
      mode,
      intent,
      workflow,
      routing,
      target: context.target,
      data: context.result,
      output,
    };
  }

  const workflow = createWorkflowRecord({
    kind: 'file',
    source: 'file_workflow',
    status: 'running',
    title,
    intent,
    mode,
    request,
    target: context.target,
  });
  const output = await callOpenAIResponsesWithFallback({
    model: models.fast,
    instructions:
      'You are the file workflow lane inside JAVIS. Use only the provided file or directory context. Answer in concise Chinese with practical next steps.',
    input: prompt,
    maxOutputTokens: 900,
  }, {
    source: 'file_workflow',
    timeoutMs: 90000,
  });
  const finalWorkflow = setWorkflow(workflow.id, {
    status: OPENAI_API_KEY ? 'done' : 'blocked',
    result: output,
    completedAt: Date.now(),
  });
  const routing = createRoutingRecordForWorkflow({
    task: request,
    workflow: finalWorkflow,
    mode,
    source: options.source || 'file_workflow',
    scope: options.scope || `file:${intent}`,
    parallelGroup: options.parallelGroup || options.group || `file:${mode}`,
    resultSummary: output,
  });
  return {
    ok: Boolean(OPENAI_API_KEY),
    queued: false,
    mode,
    intent,
    workflow: finalWorkflow,
    routing,
    target: context.target,
    output,
  };
}

async function macContextSnapshot(options = {}) {
  const frontmost = await frontmostAppSnapshot();
  const browser = await browserContextSnapshot({ frontmost });
  const accessibilityTrusted =
    typeof systemPreferences?.isTrustedAccessibilityClient === 'function'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : null;
  return {
    platform: process.platform,
    timestamp: new Date().toISOString(),
    frontmost,
    browser,
    permissions: {
      accessibilityTrusted,
    },
    clipboard: clipboardSnapshot(Boolean(options.includeClipboardText)),
    screen: latestScreenSnapshot(),
    queue: queueCounts(),
    activeJobs: Array.from(activeJobRuns.keys()),
    pendingApprovals: pendingApprovalSnapshot(20).map((approval) => ({
      id: approval.id,
      action: approval.action,
      riskLevel: approval.riskLevel,
      summary: approval.summary,
    })),
  };
}

function ambientEventKey(event) {
  return [
    event.frontmost?.app || '',
    event.frontmost?.windowTitle || '',
    event.browser?.app || '',
    event.browser?.title || '',
    event.browser?.url || '',
  ].join('\n');
}

function recordAmbientEvent(rawEvent) {
  const event = normalizeAmbientEvent(rawEvent);
  if (!event) return null;
  const previous = ambientEvents[0] || null;
  const unchanged = previous && ambientEventKey(previous) === ambientEventKey(event);
  const stale = !previous || Date.now() - Number(previous.createdAt || 0) > 60000;
  if (unchanged && !stale) return previous;
  ambientEvents.unshift(event);
  ambientEvents.splice(MAX_PERSISTED_AMBIENT);
  persistAmbient();
  if (AMBIENT_LEARNING_ENABLED) {
    distillAmbientLearning({ source: `${event.source || 'ambient'}:sample` });
  }
  appendAudit('ambient.sample', {
    app: event.frontmost.app,
    windowTitle: compactRecordText(event.frontmost.windowTitle, 120),
    browserApp: event.browser.app,
    browserTitle: compactRecordText(event.browser.title, 120),
    hasScreen: Boolean(event.screen.width && event.screen.height),
  });
  return event;
}

async function sampleAmbientContext(source = 'ambient') {
  if (ambientSampling) return null;
  ambientSampling = true;
  try {
    let screenFrame = latestScreenSnapshot();
    if (AMBIENT_CAPTURE_SCREEN) {
      screenFrame = await captureResidentScreen({ source }).catch((error) => {
        appendAudit('ambient.screen_failed', { message: error instanceof Error ? error.message : String(error) });
        return latestScreenSnapshot();
      });
    }
    const context = await macContextSnapshot({ includeClipboardText: false });
    return recordAmbientEvent({
      source,
      frontmost: context.frontmost,
      browser: context.browser,
      screen: screenFrame,
      createdAt: Date.now(),
    });
  } catch (error) {
    appendAudit('ambient.sample_failed', { message: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    ambientSampling = false;
  }
}

function ambientStateSnapshot(limit = 8) {
  return {
    enabled: AMBIENT_OBSERVE_ENABLED,
    captureScreen: AMBIENT_CAPTURE_SCREEN,
    intervalMs: AMBIENT_INTERVAL_MS,
    learningEnabled: AMBIENT_LEARNING_ENABLED,
    count: ambientEvents.length,
    recent: ambientSnapshot(limit),
  };
}

function presenceAgeMs(timestamp) {
  const value = Number(timestamp || 0);
  return value ? Math.max(0, Date.now() - value) : null;
}

function presenceRecentObservation(event = null) {
  if (!event) {
    return {
      available: false,
      ageMs: null,
      app: '',
      windowTitle: '',
      browser: {
        available: false,
        app: '',
        title: '',
        url: '',
        host: '',
      },
      screen: {
        available: false,
        width: 0,
        height: 0,
        privacyMode: '',
        source: '',
        ageMs: null,
      },
    };
  }
  return {
    available: true,
    ageMs: presenceAgeMs(event.createdAt),
    app: event.frontmost?.app || '',
    windowTitle: event.frontmost?.windowTitle || '',
    browser: {
      available: Boolean(event.browser?.available),
      app: event.browser?.app || '',
      title: event.browser?.title || '',
      url: event.browser?.url || '',
      host: browserHostFromAmbientEvent(event),
    },
    screen: {
      available: Boolean(event.screen?.width && event.screen?.height),
      width: Number(event.screen?.width || 0),
      height: Number(event.screen?.height || 0),
      privacyMode: event.screen?.privacyMode || '',
      source: event.screen?.source || '',
      ageMs: presenceAgeMs(event.screen?.updatedAt),
    },
  };
}

function presenceModeFromState({ readiness, pendingApprovals, activeJobs, wake, conversation }) {
  if (readiness?.overall === 'blocked') return 'setup_blocked';
  if (conversation?.status === 'connecting') return 'connecting';
  if (conversation?.status === 'live') return 'listening';
  if (conversation?.status === 'error' && Number(conversation.ageMs || 0) < 60000) return 'voice_error';
  if (pendingApprovals.length) return 'needs_attention';
  if (wake?.pending) return 'waking';
  if (activeJobs.length) return 'working';
  if (AMBIENT_OBSERVE_ENABLED) return 'watching';
  return 'standby';
}

function presenceStateSnapshot(options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit || 5)));
  const readiness = options.readiness || readinessSnapshot();
  const wake = wakeStatusSnapshot();
  const ambient = ambientStateSnapshot(limit);
  const learning = learningStateSnapshot();
  const conversation = conversationStateSnapshot();
  const pendingApprovals = pendingApprovalSnapshot(10);
  const activeJobs = jobSnapshot().filter((job) => job.status === 'queued' || job.status === 'running');
  const activeRoutes = activeRoutingSnapshot(6).map(routingLedgerEntry).filter(Boolean);
  const activeSession = activeSessionSnapshot();
  const latestAmbient = ambient.recent[0] || null;
  const latestScreen = latestScreenSnapshot();
  const mode = presenceModeFromState({ readiness, pendingApprovals, activeJobs, wake, conversation });
  const observing = presenceRecentObservation(latestAmbient);
  const screenAge = latestScreenAgeMs();
  const screen = latestScreen
    ? {
        available: true,
        width: latestScreen.width,
        height: latestScreen.height,
        source: latestScreen.source || '',
        privacyMode: latestScreen.privacy?.mode || '',
        ageMs: Number.isFinite(screenAge) ? screenAge : null,
        updatedAt: latestScreen.updatedAt,
      }
    : {
        available: false,
        width: 0,
        height: 0,
        source: '',
        privacyMode: screenPrivacySnapshot().mode,
        ageMs: null,
        updatedAt: 0,
      };
  let nextIntervention = 'No intervention queued. Standing by until the user speaks or asks for help.';
  if (conversation.status === 'live') {
    nextIntervention = 'Voice conversation is live. Listening for the current user request.';
  } else if (conversation.status === 'connecting') {
    nextIntervention = 'Voice conversation is connecting.';
  } else if (conversation.status === 'error') {
    nextIntervention = `Last voice session error: ${conversation.error || 'unknown error'}`;
  } else if (pendingApprovals[0]) {
    nextIntervention = `Waiting for approval: ${compactRecordText(pendingApprovals[0].summary, 120)}`;
  } else if (readiness.primaryIssue) {
    nextIntervention = readiness.primaryIssue.next || readiness.primaryIssue.summary;
  } else if (activeJobs[0]) {
    nextIntervention = `Background work running: ${compactRecordText(activeJobs[0].title, 120)}`;
  } else if (activeRoutes[0]) {
    nextIntervention = `Routed work needs attention: ${activeRoutes[0].owner} ${activeRoutes[0].lane} ${compactRecordText(activeRoutes[0].taskTitle, 100)}`;
  } else if (wake.pending) {
    nextIntervention = 'Wake trigger is pending; voice may start from the resident pet.';
  }
  const summaryParts = [
    mode === 'watching' ? 'Standing by and passively observing local context.' : '',
    mode === 'standby' ? 'Standing by; passive ambient observation is off.' : '',
    mode === 'connecting' ? 'Voice conversation is connecting.' : '',
    mode === 'listening' ? `Voice conversation is live in ${conversation.micMode} mic mode.` : '',
    mode === 'voice_error' ? `Last voice session failed: ${conversation.error || 'unknown error'}.` : '',
    mode === 'waking' ? 'Wake trigger received.' : '',
    mode === 'working' ? `${activeJobs.length} background job(s) queued or running.` : '',
    activeRoutes.length ? `${activeRoutes.length} routed task(s) active or blocked.` : '',
    mode === 'needs_attention' ? `${pendingApprovals.length} approval(s) need attention.` : '',
    mode === 'setup_blocked' ? `Setup blocked: ${readiness.summary}` : '',
    observing.available
      ? `Latest context: ${[observing.app, observing.browser.host || observing.browser.title || observing.windowTitle].filter(Boolean).join(' · ')}.`
      : '',
    learning.enabled && learning.profile.sourceEventCount ? learning.profile.summary : '',
  ].filter(Boolean);

  return {
    ok: readiness.overall !== 'blocked',
    generatedAt: new Date().toISOString(),
    mode,
    label: {
      standby: 'Standby',
      watching: 'Watching',
      waking: 'Wake pending',
      connecting: 'Connecting',
      listening: 'Listening',
      voice_error: 'Voice error',
      working: 'Working',
      needs_attention: 'Needs attention',
      setup_blocked: 'Setup blocked',
    }[mode] || mode,
    summary: summaryParts.join(' '),
    intervention: {
      passiveByDefault: true,
      requiresUserIntent: true,
      canActWhenInvited: LOCAL_EXEC_ENABLED,
      trustedLocalMode: TRUSTED_LOCAL_MODE,
      maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
      requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
      next: nextIntervention,
    },
    conversation,
    wake,
    observing: {
      ambient: {
        enabled: ambient.enabled,
        captureScreen: ambient.captureScreen,
        intervalMs: ambient.intervalMs,
        count: ambient.count,
      },
      latest: observing,
      recent: ambient.recent.slice(0, limit).map((event) => presenceRecentObservation(event)),
      screen,
    },
    learning: {
      enabled: learning.enabled,
      includeInPrompts: learning.includeInPrompts,
      sourceEventCount: learning.profile.sourceEventCount,
      summary: learning.profile.summary,
      signals: learning.profile.signals,
      recentContexts: learning.profile.recentContexts,
    },
    work: {
      activeJobs: activeJobs.map((job) => ({
        id: job.id,
        mode: job.mode,
        status: job.status,
        title: job.title,
        updatedAt: job.updatedAt,
      })).slice(0, 6),
      activeRoutes,
      pendingApprovals: pendingApprovals.map((approval) => ({
        id: approval.id,
        action: approval.action,
        riskLevel: approval.riskLevel,
        summary: approval.summary,
        createdAt: approval.createdAt,
      })),
      activeSession,
      queue: queueCounts(),
      workflows: workflowCounts(),
      autopilot: autopilotStateSnapshot(),
    },
    readiness: {
      overall: readiness.overall,
      label: readiness.label,
      counts: readiness.counts,
      primaryIssue: readiness.primaryIssue,
    },
  };
}

function formatRealtimeContextAction(action, index) {
  return `${index + 1}. ${action.label}: ${compactRecordText(action.summary, 180)}`;
}

async function realtimePreflightContextSnapshot(options = {}) {
  const source = String(options.source || 'api').slice(0, 80);
  const presence = presenceStateSnapshot({ limit: 3 });
  const briefing = workflowBriefing({ workflowLimit: 3, jobLimit: 3 });
  const mac = await macContextSnapshot({ includeClipboardText: false }).catch((error) => ({
    frontmost: { available: false, app: '', windowTitle: '', error: error instanceof Error ? error.message : String(error) },
    browser: { available: false, supported: false, app: '', title: '', url: '', source: '', error: '' },
    permissions: { accessibilityTrusted: null },
    clipboard: { hasText: false, length: 0, preview: '', truncated: false },
    activeJobs: [],
    pendingApprovals: [],
  }));
  const screenFrame = latestScreenSnapshot();
  const latest = presence.observing?.latest || {};
  const nextActions = (briefing.nextActions || []).slice(0, 3);
  const activeJobs = presence.work?.activeJobs || [];
  const activeRoutes = presence.work?.activeRoutes || [];
  const pendingApprovals = presence.work?.pendingApprovals || [];
  const learningSummary = presence.learning?.sourceEventCount ? presence.learning.summary : '';
  const currentApp = mac.frontmost?.available
    ? [mac.frontmost.app, mac.frontmost.windowTitle].filter(Boolean).join(' · ')
    : [latest.app, latest.windowTitle].filter(Boolean).join(' · ');
  const currentBrowser = mac.browser?.available
    ? [mac.browser.app, mac.browser.title || mac.browser.url].filter(Boolean).join(' · ')
    : [latest.browser?.app, latest.browser?.title || latest.browser?.host].filter(Boolean).join(' · ');
  const lines = REALTIME_PREFLIGHT_CONTEXT_ENABLED
    ? [
        'Silent JAVIS preflight context for this voice session. Do not answer this message by itself.',
        `Presence: ${presence.label} (${presence.mode}). ${compactRecordText(presence.summary, 420)}`,
        `Conversation: ${presence.conversation.status}; mic ${presence.conversation.micMode}; screen context ${presence.conversation.screenLive ? 'on' : 'off'}.`,
        currentApp ? `Current app/window: ${compactRecordText(currentApp, 220)}` : '',
        currentBrowser ? `Current browser: ${compactRecordText(currentBrowser, 260)}` : '',
        screenFrame ? `Latest resident screen frame: ${screenFrame.width}x${screenFrame.height}, privacy ${screenFrame.privacy?.mode || 'unknown'}, age ${Math.round(latestScreenAgeMs() / 1000)}s.` : 'No resident screen frame is cached yet.',
        learningSummary ? `Local inferred profile: ${compactRecordText(learningSummary, 360)}` : '',
        activeJobs.length ? `Background work: ${activeJobs.map((job) => `${job.mode}/${job.status} ${compactRecordText(job.title, 80)}`).join('; ')}` : 'Background work: none active.',
        activeRoutes.length ? `Routed work: ${activeRoutes.map((route) => `${route.lane}/${route.status} ${route.owner} ${compactRecordText(route.taskTitle, 80)} next=${compactRecordText(route.nextAction || 'check progress', 80)}`).join('; ')}` : 'Routed work: none active.',
        pendingApprovals.length ? `Approvals waiting: ${pendingApprovals.map((approval) => compactRecordText(approval.summary, 120)).join('; ')}` : 'Approvals waiting: none.',
        presence.work?.autopilot?.enabled ? `Autopilot: ${presence.work.autopilot.running ? 'running' : 'idle'}, executed ${presence.work.autopilot.executedCount || 0}, last ${compactRecordText(presence.work.autopilot.lastResult || 'none', 180)}.` : 'Autopilot: disabled.',
        nextActions.length ? `Likely next actions:\n${nextActions.map(formatRealtimeContextAction).join('\n')}` : '',
        `Guardrails: passive by default; act only after user intent. Local execution ${LOCAL_EXEC_ENABLED ? 'enabled' : 'disabled'}; auto risk level ${actionPolicy.maxAutoRiskLevel}; approval required at level ${actionPolicy.requireApprovalAtRiskLevel}.`,
      ].filter(Boolean)
    : [];
  const prompt = lines.join('\n');
  appendAudit('realtime.preflight_context', {
    source,
    enabled: REALTIME_PREFLIGHT_CONTEXT_ENABLED,
    presenceMode: presence.mode,
    promptLength: prompt.length,
    hasScreen: Boolean(screenFrame),
    nextActions: nextActions.length,
  });
  return {
    enabled: REALTIME_PREFLIGHT_CONTEXT_ENABLED,
    generatedAt: new Date().toISOString(),
    prompt,
    presence: {
      mode: presence.mode,
      label: presence.label,
      summary: presence.summary,
      conversation: presence.conversation,
      intervention: presence.intervention,
    },
    mac,
    screen: screenFrame,
    briefing: {
      summary: briefing.summary,
      nextActions,
      routingLedger: briefing.routingLedger || [],
      counts: briefing.counts,
    },
  };
}

function startAmbientMonitor() {
  if (!AMBIENT_OBSERVE_ENABLED || ambientTimer) return;
  void sampleAmbientContext('ambient_startup');
  ambientTimer = setInterval(() => {
    void sampleAmbientContext('ambient_interval');
  }, AMBIENT_INTERVAL_MS);
  appendAudit('ambient.started', {
    intervalMs: AMBIENT_INTERVAL_MS,
    captureScreen: AMBIENT_CAPTURE_SCREEN,
  });
}

function stopAmbientMonitor() {
  if (!ambientTimer) return;
  clearInterval(ambientTimer);
  ambientTimer = null;
  appendAudit('ambient.stopped');
}

function startLearningMonitor() {
  if (!AMBIENT_LEARNING_ENABLED || learningTimer) return;
  distillAmbientLearning({ source: 'learning_startup' });
  learningTimer = setInterval(() => {
    distillAmbientLearning({ source: 'learning_interval' });
  }, AMBIENT_LEARNING_INTERVAL_MS);
  appendAudit('learning.started', {
    intervalMs: AMBIENT_LEARNING_INTERVAL_MS,
    sourceEventLimit: MAX_LEARNING_SOURCE_EVENTS,
  });
}

function stopLearningMonitor() {
  if (!learningTimer) return;
  clearInterval(learningTimer);
  learningTimer = null;
  appendAudit('learning.stopped');
}

function autopilotStateSnapshot() {
  return {
    ...autopilotState,
    enabled: AUTOPILOT_ENABLED,
    intervalMs: AUTOPILOT_INTERVAL_MS,
    busy: autopilotBusy,
  };
}

function isAutopilotExecutableAction(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.source === 'recovery') {
    if (action.trustedAutoEligible && Number(action.recoveryAttempts || 0) < Number(action.maxRecoveryAttempts || MAX_RECOVERY_JOB_ATTEMPTS)) {
      return true;
    }
    return Boolean(action.autoEligible && Number(action.riskLevel || 0) <= 1);
  }
  if (action.source === 'workflows' && action.workflowAction === 'retry_app_workflow') {
    return Boolean(action.executable && LOCAL_EXEC_ENABLED && TRUSTED_LOCAL_MODE);
  }
  return false;
}

function firstAutopilotExecutableAction(actions = []) {
  return (actions || []).find((action) => isAutopilotExecutableAction(action)) || null;
}

async function autopilotTick(options = {}) {
  const source = String(options.source || 'api').slice(0, 80);
  const execute = options.execute !== false;
  if (autopilotBusy) {
    return { ok: true, executed: false, skipped: true, reason: 'autopilot_busy', autopilot: autopilotStateSnapshot() };
  }
  autopilotBusy = true;
  autopilotState = {
    ...autopilotState,
    running: true,
    tickCount: Number(autopilotState.tickCount || 0) + 1,
    lastTickAt: Date.now(),
    lastError: '',
  };
  try {
    const briefing = workflowBriefing({ workflowLimit: options.workflowLimit || 6, jobLimit: options.jobLimit || 6 });
    const firstAction = (briefing.nextActions || [])[0] || null;
    const action = firstAutopilotExecutableAction(briefing.nextActions);
    const conversation = conversationStateSnapshot();
    let reason = '';
    if (!AUTOPILOT_ENABLED) reason = 'autopilot_disabled';
    else if (!execute) reason = 'preview_only';
    else if (conversation.active) reason = 'conversation_active';
    else if (activeJobRuns.size) reason = 'active_job_running';
    else if (!action) reason = firstAction ? 'no_auto_executable_action' : 'no_action';

    if (reason) {
      autopilotState = {
        ...autopilotState,
        skippedCount: Number(autopilotState.skippedCount || 0) + 1,
        lastAction: action || firstAction,
        lastResult: reason,
      };
      appendAudit('autopilot.skipped', {
        source,
        reason,
        action: action?.id || firstAction?.id || '',
        actionSource: action?.source || firstAction?.source || '',
        nextActions: (briefing.nextActions || []).length,
      });
      return { ok: true, executed: false, skipped: true, reason, action: action || firstAction, selectedAction: action, briefing, autopilot: autopilotStateSnapshot() };
    }

    const result = await workNextAction({
      execute: true,
      actionId: action.id,
      autopilot: true,
      source: `autopilot:${source}`,
      workflowLimit: options.workflowLimit || 6,
      jobLimit: options.jobLimit || 6,
    });
    autopilotState = {
      ...autopilotState,
      executedCount: Number(autopilotState.executedCount || 0) + 1,
      lastExecutedAt: Date.now(),
      lastAction: action,
      lastResult: compactRecordText(result.output || '', 1000),
    };
    appendAudit('autopilot.executed', {
      source,
      action: action.id,
      actionSource: action.source,
      outputLength: result.output ? String(result.output).length : 0,
    });
    return { ok: true, executed: true, skipped: false, action, result, briefing, autopilot: autopilotStateSnapshot() };
  } catch (error) {
    autopilotState = {
      ...autopilotState,
      lastError: error instanceof Error ? error.message : String(error),
    };
    appendAudit('autopilot.failed', { source, error: autopilotState.lastError });
    return { ok: false, executed: false, skipped: false, error: autopilotState.lastError, autopilot: autopilotStateSnapshot() };
  } finally {
    autopilotBusy = false;
    autopilotState = {
      ...autopilotState,
      running: false,
    };
  }
}

function startAutopilotMonitor() {
  if (!AUTOPILOT_ENABLED || autopilotTimer) return;
  autopilotTimer = setInterval(() => {
    void autopilotTick({ source: 'interval' });
  }, AUTOPILOT_INTERVAL_MS);
  appendAudit('autopilot.started', {
    intervalMs: AUTOPILOT_INTERVAL_MS,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
    trustedLocalMode: TRUSTED_LOCAL_MODE,
  });
  void autopilotTick({ source: 'startup' });
}

function stopAutopilotMonitor() {
  if (!autopilotTimer) return;
  clearInterval(autopilotTimer);
  autopilotTimer = null;
  appendAudit('autopilot.stopped');
}

function wakeStatusSnapshot(options = {}) {
  const since = Number(options.since || 0);
  const ageMs = wakeState.lastTriggerAt ? Date.now() - wakeState.lastTriggerAt : Infinity;
  return {
    words: WAKE_WORDS,
    softWakeOnly: !WAKE_ENGINE_CMD,
    triggerTtlMs: WAKE_TRIGGER_TTL_MS,
    pending: Boolean(wakeState.lastTriggerAt && wakeState.lastTriggerAt > since && ageMs <= WAKE_TRIGGER_TTL_MS),
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    lastTriggerAt: wakeState.lastTriggerAt,
    lastSource: wakeState.lastSource,
    lastPhrase: wakeState.lastPhrase,
    triggerCount: wakeState.triggerCount,
    engine: {
      configured: Boolean(WAKE_ENGINE_CMD),
      command: WAKE_ENGINE_CMD ? redactCommandForLog(WAKE_ENGINE_CMD) : '',
      running: wakeState.engineRunning,
      pid: wakeState.enginePid,
      startedAt: wakeState.engineStartedAt,
      lastLine: wakeState.engineLastLine,
      lastError: wakeState.engineLastError,
    },
  };
}

function triggerWake(options = {}) {
  const phrase = String(options.phrase || options.word || '').trim().slice(0, 120);
  const source = String(options.source || 'api').trim().slice(0, 80) || 'api';
  wakeState = {
    ...wakeState,
    lastTriggerAt: Date.now(),
    lastSource: source,
    lastPhrase: phrase,
    triggerCount: wakeState.triggerCount + 1,
  };
  appendAudit('wake.triggered', {
    source,
    phrase,
    triggerCount: wakeState.triggerCount,
  });
  return wakeStatusSnapshot();
}

function normalizeConversationStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return ['idle', 'connecting', 'live', 'error'].includes(status) ? status : '';
}

function normalizeConversationMicMode(value) {
  return String(value || '').trim().toLowerCase() === 'push' ? 'push' : 'open';
}

function conversationStateSnapshot() {
  const now = Date.now();
  const activeStatus = conversationState.status === 'connecting' || conversationState.status === 'live';
  const stale = activeStatus && conversationState.updatedAt && now - conversationState.updatedAt > CONVERSATION_STALE_MS;
  const status = stale ? 'idle' : conversationState.status;
  const active = status === 'connecting' || status === 'live';
  return {
    ...conversationState,
    status,
    active,
    stale: Boolean(stale),
    staleAfterMs: CONVERSATION_STALE_MS,
    ageMs: conversationState.updatedAt ? now - conversationState.updatedAt : null,
    activeForMs: active && conversationState.startedAt ? now - conversationState.startedAt : null,
  };
}

function updateConversationState(options = {}) {
  const now = Date.now();
  const requestedStatus = normalizeConversationStatus(options.status);
  const next = { ...conversationState };
  const incomingSessionId = String(options.sessionId || '').slice(0, 120);
  let transitioned = false;
  const activeStatus = next.status === 'connecting' || next.status === 'live';
  const lifecycleUpdate = requestedStatus || options.heartbeat === true;
  if (activeStatus && lifecycleUpdate && requestedStatus !== 'connecting' && incomingSessionId && next.sessionId && incomingSessionId !== next.sessionId) {
    appendAudit('conversation.stale_update_ignored', {
      currentSessionId: next.sessionId,
      incomingSessionId,
      currentStatus: next.status,
      requestedStatus,
      heartbeat: options.heartbeat === true,
      source: String(options.source || '').slice(0, 80),
    });
    return conversationStateSnapshot();
  }

  if (requestedStatus && requestedStatus !== next.status) {
    transitioned = true;
    next.status = requestedStatus;
    next.transitionCount = Number(next.transitionCount || 0) + 1;
  }

  if (Object.prototype.hasOwnProperty.call(options, 'micMode')) {
    next.micMode = normalizeConversationMicMode(options.micMode);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'screenLive')) {
    next.screenLive = Boolean(options.screenLive);
  }
  if (Object.prototype.hasOwnProperty.call(options, 'source')) {
    next.source = String(options.source || '').slice(0, 80);
  }

  if (requestedStatus === 'connecting') {
    next.sessionId = String(options.sessionId || crypto.randomUUID()).slice(0, 120);
    next.startedAt = now;
    next.liveAt = 0;
    next.endedAt = 0;
    next.lastHeartbeatAt = 0;
    next.error = '';
  }
  if (requestedStatus === 'live') {
    next.sessionId = String(options.sessionId || next.sessionId || crypto.randomUUID()).slice(0, 120);
    next.startedAt = next.startedAt || now;
    next.liveAt = next.liveAt || now;
    next.endedAt = 0;
    next.error = '';
    next.lastHeartbeatAt = now;
  }
  if (requestedStatus === 'idle') {
    next.endedAt = now;
    next.error = '';
  }
  if (requestedStatus === 'error') {
    next.error = String(options.error || options.message || next.error || 'voice_session_error').slice(0, 500);
    next.endedAt = now;
  }
  if (options.heartbeat === true) {
    next.lastHeartbeatAt = now;
  }

  next.updatedAt = now;
  conversationState = next;
  appendAudit('conversation.state', {
    status: conversationState.status,
    sessionId: conversationState.sessionId,
    micMode: conversationState.micMode,
    screenLive: conversationState.screenLive,
    source: conversationState.source,
    transitioned,
    error: conversationState.error ? compactRecordText(conversationState.error, 120) : '',
  });
  return conversationStateSnapshot();
}

function lineMatchesWake(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/\bwake\b|\btrigger\b/i.test(text)) return true;
  const lower = text.toLowerCase();
  return WAKE_WORDS.some((word) => word && lower.includes(word.toLowerCase()));
}

function consumeWakeEngineOutput(chunk) {
  const text = chunk.toString();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    wakeState = {
      ...wakeState,
      engineLastLine: line.slice(0, 300),
    };
    if (lineMatchesWake(line)) {
      triggerWake({ source: 'wake_engine', phrase: line });
    }
  }
}

function startWakeEngine() {
  if (!WAKE_ENGINE_CMD || wakeEngineProcess) return wakeStatusSnapshot();
  wakeEngineProcess = spawn('/bin/zsh', ['-lc', WAKE_ENGINE_CMD], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wakeState = {
    ...wakeState,
    engineRunning: true,
    enginePid: wakeEngineProcess.pid || null,
    engineStartedAt: Date.now(),
    engineLastError: '',
  };
  appendAudit('wake_engine.started', {
    pid: wakeEngineProcess.pid || null,
    command: redactCommandForLog(WAKE_ENGINE_CMD),
  });
  wakeEngineProcess.stdout.on('data', consumeWakeEngineOutput);
  wakeEngineProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';
    if (line) {
      wakeState = {
        ...wakeState,
        engineLastError: line.slice(0, 300),
      };
    }
  });
  wakeEngineProcess.on('error', (error) => {
    wakeState = {
      ...wakeState,
      engineRunning: false,
      enginePid: null,
      engineLastError: error instanceof Error ? error.message : String(error),
    };
    appendAudit('wake_engine.error', { message: wakeState.engineLastError });
    wakeEngineProcess = null;
  });
  wakeEngineProcess.on('close', (code, signal) => {
    wakeState = {
      ...wakeState,
      engineRunning: false,
      enginePid: null,
      engineLastError: code === 0 ? '' : `Wake engine exited${code === null ? '' : ` with ${code}`}${signal ? ` (${signal})` : ''}`,
    };
    appendAudit('wake_engine.closed', { code, signal });
    wakeEngineProcess = null;
  });
  return wakeStatusSnapshot();
}

function stopWakeEngine() {
  if (!wakeEngineProcess) return wakeStatusSnapshot();
  try {
    wakeEngineProcess.kill('SIGTERM');
  } catch {
    // Process may already be gone.
  }
  wakeEngineProcess = null;
  wakeState = {
    ...wakeState,
    engineRunning: false,
    enginePid: null,
  };
  appendAudit('wake_engine.stopped');
  return wakeStatusSnapshot();
}

function compactObserveTree(tree) {
  if (!tree) return null;
  return {
    available: Boolean(tree.available),
    app: tree.app || '',
    windowTitle: tree.windowTitle || '',
    nodeCount: tree.nodeCount || 0,
    truncated: Boolean(tree.truncated),
    outline: tree.outline || '',
    error: tree.error || '',
    cached: Boolean(tree.cached),
    cacheAgeMs: Number(tree.cacheAgeMs || 0),
  };
}

async function observeNow(options = {}) {
  const includeClipboardText = Boolean(options.includeClipboardText);
  const screenMaxAgeMs = Math.max(1000, Math.min(60000, Number(options.screenMaxAgeMs ?? 12000)));
  const accessibilityMaxAgeMs = Math.max(0, Math.min(60000, Number(options.accessibilityMaxAgeMs ?? 6000)));
  const captureScreenMode = options.captureScreen;
  const captureScreen =
    captureScreenMode === true ||
    captureScreenMode === 'always' ||
    (captureScreenMode !== false && !hasFreshLatestScreen(screenMaxAgeMs));
  const includeAccessibility = options.includeAccessibility !== false;
  const describeScreen = Boolean(options.describeScreen || options.vision);
  const maxNodes = Math.max(10, Math.min(200, Number(options.maxNodes || 80)));
  const maxDepth = Math.max(1, Math.min(8, Number(options.maxDepth || 5)));
  const errors = [];

  const [macContext, treeResult, screenResult] = await Promise.all([
    macContextSnapshot({ includeClipboardText }),
    includeAccessibility
      ? cachedAccessibilityTreeSnapshot({ maxNodes, maxDepth, maxAgeMs: accessibilityMaxAgeMs, useCache: options.useCache }).catch((error) => {
          errors.push(`accessibility: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        })
      : Promise.resolve(null),
    captureScreen
      ? captureResidentScreen({ source: String(options.source || 'observe') }).catch((error) => {
          errors.push(`screen: ${error instanceof Error ? error.message : String(error)}`);
          return latestScreenSnapshot();
        })
      : Promise.resolve(latestScreenSnapshot()),
  ]);

  let screenDescription = '';
  if (describeScreen) {
    try {
      if (!latestScreen || !hasFreshLatestScreen(screenMaxAgeMs)) {
        await captureResidentScreen({ source: String(options.source || 'observe_vision') });
      }
      screenDescription = await callOpenAIResponses({
        model: models.vision,
        instructions:
          'You are JAVIS vision. Describe the current Mac screen in one concise Chinese sentence, then name one useful next action.',
        input: String(options.prompt || 'Describe the current screen for a voice assistant.'),
        imageDataUrl: latestScreen?.imageDataUrl,
        maxOutputTokens: 240,
      });
    } catch (error) {
      errors.push(`vision: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const observation = {
    ok: true,
    generatedAt: new Date().toISOString(),
    mac: macContext,
    screen: screenResult || latestScreenSnapshot(),
    accessibility: compactObserveTree(treeResult),
    vision: screenDescription ? { output: screenDescription } : null,
    errors,
  };

  appendAudit('observe.now', {
    captureScreen,
    includeAccessibility,
    describeScreen,
    hasScreen: Boolean(observation.screen),
    screenCacheAgeMs: Number.isFinite(latestScreenAgeMs()) ? latestScreenAgeMs() : null,
    accessibilityCached: Boolean(observation.accessibility?.cached),
    accessibilityCacheAgeMs: observation.accessibility?.cacheAgeMs || 0,
    accessibilityNodes: observation.accessibility?.nodeCount || 0,
    errors: errors.length,
    source: String(options.source || 'api').slice(0, 80),
  });

  return observation;
}

function jsonError(res, status, message, details) {
  res.status(status).json({ error: message, details });
}

function envFilePath() {
  return path.join(process.cwd(), '.env');
}

function envExampleFilePath() {
  return path.join(process.cwd(), '.env.example');
}

function prepareEnvFile() {
  const envFile = envFilePath();
  const envExampleFile = envExampleFilePath();
  let created = false;
  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(envExampleFile)) {
      fs.copyFileSync(envExampleFile, envFile);
    } else {
      fs.writeFileSync(
        envFile,
        [
          'OPENAI_API_KEY=',
          'JAVIS_API_PORT=3417',
          'JAVIS_ENABLE_LOCAL_EXEC=false',
          'JAVIS_TRUSTED_LOCAL_MODE=false',
          'JAVIS_ACTION_DRY_RUN=false',
          '',
        ].join('\n'),
        'utf8',
      );
    }
    try {
      fs.chmodSync(envFile, 0o600);
    } catch {
      // macOS may ignore chmod for some synced folders.
    }
    created = true;
  }
  return { envFile, created };
}

async function openPathInFinder(targetPath) {
  await execFileAsync('open', [targetPath]);
}

async function openSystemSettings(anchor) {
  const url = `x-apple.systempreferences:com.apple.preference.security?${anchor}`;
  await execFileAsync('open', [url]);
}

async function runSetupAction(action) {
  const normalized = String(action || '').trim();
  appendAudit('setup_action.requested', { action: normalized });

  if (normalized === 'prepare_env_file') {
    const result = prepareEnvFile();
    await openPathInFinder(result.envFile);
    const output = result.created
      ? `Created and opened ${result.envFile}. Add OPENAI_API_KEY, then restart JAVIS.`
      : `Opened ${result.envFile}. Add OPENAI_API_KEY if it is still blank, then restart JAVIS.`;
    appendAudit('setup_action.completed', { action: normalized, created: result.created, envFile: result.envFile });
    return { ok: true, action: normalized, output, path: result.envFile, created: result.created };
  }

  if (normalized === 'open_screen_settings') {
    await openSystemSettings('Privacy_ScreenCapture');
    const output = 'Opened Screen Recording settings. Enable JAVIS/Electron, then restart screen sharing if macOS asks.';
    appendAudit('setup_action.completed', { action: normalized });
    return { ok: true, action: normalized, output };
  }

  if (normalized === 'open_accessibility_settings') {
    await openSystemSettings('Privacy_Accessibility');
    const output = 'Opened Accessibility settings. Enable JAVIS/Electron before using typing, hotkeys, or richer app context.';
    appendAudit('setup_action.completed', { action: normalized });
    return { ok: true, action: normalized, output };
  }

  if (normalized === 'open_full_disk_access_settings') {
    await openSystemSettings('Privacy_AllFiles');
    const output = 'Opened Full Disk Access settings. Enable JAVIS/Electron if you want access to protected local folders.';
    appendAudit('setup_action.completed', { action: normalized });
    return { ok: true, action: normalized, output };
  }

  if (normalized === 'open_microphone_settings') {
    await openSystemSettings('Privacy_Microphone');
    const output = 'Opened Microphone settings. Enable microphone access before using voice.';
    appendAudit('setup_action.completed', { action: normalized });
    return { ok: true, action: normalized, output };
  }

  if (normalized === 'open_runtime_dir') {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    await openPathInFinder(DATA_DIR);
    const output = `Opened runtime directory: ${DATA_DIR}`;
    appendAudit('setup_action.completed', { action: normalized, dataDir: DATA_DIR });
    return { ok: true, action: normalized, output, path: DATA_DIR };
  }

  if (normalized === 'open_action_policy') {
    persistActionPolicy();
    await openPathInFinder(ACTION_POLICY_FILE);
    const output = `Opened action policy: ${ACTION_POLICY_FILE}`;
    appendAudit('setup_action.completed', { action: normalized, actionPolicyFile: ACTION_POLICY_FILE });
    return { ok: true, action: normalized, output, path: ACTION_POLICY_FILE };
  }

  if (normalized === 'install_resident_agent') {
    const status = await installResidentAgent();
    const output = `Installed login-start resident agent at ${status.plistPath}. It will start on next login; the current manual JAVIS process keeps running now.`;
    appendAudit('setup_action.completed', { action: normalized, plistPath: status.plistPath });
    return { ok: true, action: normalized, output, resident: status };
  }

  if (normalized === 'uninstall_resident_agent') {
    const status = await uninstallResidentAgent();
    const output = `Uninstalled login-start resident agent: ${LAUNCH_AGENT_LABEL}`;
    appendAudit('setup_action.completed', { action: normalized });
    return { ok: true, action: normalized, output, resident: status };
  }

  throw new Error(`Unknown setup action: ${normalized}`);
}

function setupActionForCheck(item) {
  const id = String(item?.id || '');
  if (['openai_key', 'env_file', 'env_example'].includes(id)) {
    return {
      action: 'prepare_env_file',
      label: 'Open .env',
      reason: 'The user must add or review local environment configuration.',
    };
  }
  if (id === 'screen_permission') {
    return {
      action: 'open_screen_settings',
      label: 'Open Screen settings',
      reason: 'macOS Screen Recording permission must be granted by the user.',
    };
  }
  if (id === 'accessibility_permission') {
    return {
      action: 'open_accessibility_settings',
      label: 'Open Accessibility settings',
      reason: 'macOS Accessibility permission must be granted by the user.',
    };
  }
  if (id === 'microphone_permission') {
    return {
      action: 'open_microphone_settings',
      label: 'Open Microphone settings',
      reason: 'macOS Microphone permission must be granted by the user.',
    };
  }
  if (id === 'local_execution') {
    return {
      action: 'prepare_env_file',
      label: 'Open .env',
      reason: 'Local execution is controlled by JAVIS_ENABLE_LOCAL_EXEC in .env.',
    };
  }
  if (id === 'launch_agent') {
    return {
      action: 'install_resident_agent',
      label: 'Install login agent',
      reason: 'The resident LaunchAgent can be installed locally.',
    };
  }
  if (id === 'action_policy_file' || id === 'action_policy') {
    return {
      action: 'open_action_policy',
      label: 'Open action policy',
      reason: 'The local action policy controls automation risk.',
    };
  }
  if (id === 'runtime_storage') {
    return {
      action: 'open_runtime_dir',
      label: 'Open runtime folder',
      reason: 'Runtime files live in the local support directory.',
    };
  }
  return null;
}

function setupGuideSnapshot() {
  const config = configCheckSnapshot();
  const issueItems = (config.items || []).filter((item) => item.status !== 'ready');
  const rank = { blocked: 0, warning: 1, ready: 2 };
  const steps = issueItems
    .map((item) => {
      const action = setupActionForCheck(item);
      return {
        id: item.id,
        label: item.label,
        status: item.status,
        summary: item.summary,
        next: item.next,
        action,
      };
    })
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  const nextStep = steps.find((step) => step.action) || null;
  const output = steps.length
    ? [
        `Setup 还有 ${steps.length} 项需要处理。`,
        nextStep ? `下一步: ${nextStep.label} -> ${nextStep.action.label}。${nextStep.next || nextStep.summary}` : '',
        steps.slice(0, 4).map((step, index) => `${index + 1}. [${step.status}] ${step.label}: ${step.next || step.summary}`).join('\n'),
      ].filter(Boolean).join('\n')
    : 'Setup 已经就绪。';
  return {
    ok: config.overall !== 'blocked',
    overall: config.overall,
    output,
    counts: config.counts,
    steps,
    nextStep,
    generatedAt: new Date().toISOString(),
  };
}

async function runNextSetupAction(options = {}) {
  const guide = setupGuideSnapshot();
  const step = guide.nextStep;
  if (!step?.action?.action) {
    return {
      ok: true,
      output: guide.steps.length ? guide.output : 'Setup 已经就绪，没有下一步 setup action。',
      guide,
      actionResult: null,
    };
  }
  const actionResult = await runSetupAction(step.action.action);
  const output = [
    `Setup 下一步: ${step.label}`,
    actionResult.output,
    step.next || step.summary,
  ].filter(Boolean).join('\n');
  appendAudit('setup_next.completed', {
    checkId: step.id,
    action: step.action.action,
    source: String(options.source || 'api').slice(0, 80),
  });
  return {
    ok: true,
    output,
    guide,
    step,
    actionResult,
  };
}

function extractOutputText(payload) {
  if (!payload) return '';
  if (typeof payload.output_text === 'string') return payload.output_text;
  const chunks = [];
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
      if (typeof content.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

async function callOpenAIResponses({ model, instructions, input, imageDataUrl, maxOutputTokens = 700, signal }) {
  if (!OPENAI_API_KEY) {
    return 'OpenAI API key is not configured. Add OPENAI_API_KEY to .env and restart JAVIS.';
  }

  const userContent = [{ type: 'input_text', text: input }];
  if (imageDataUrl) {
    userContent.push({ type: 'input_image', image_url: imageDataUrl });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': hashSafetyIdentifier(),
    },
    body: JSON.stringify({
      model,
      instructions,
      input: [{ role: 'user', content: userContent }],
      max_output_tokens: maxOutputTokens,
    }),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || response.statusText;
    throw new Error(message);
  }
  return extractOutputText(data) || JSON.stringify(data);
}

function openAiFallbackFailureKind(error) {
  const kind = classifyJobFailure(error, { mode: 'background' });
  return ['model_quota_or_api', 'model_failed', 'openai_key_missing'].includes(kind) ? kind : '';
}

async function callLocalTextWorkerFallback(args = {}, options = {}) {
  const mode = options.mode || preferredRecoveryWorkerMode();
  if (!mode) throw new Error('No local text fallback worker is available.');
  const baseCommand = codeAgentCommandForMode(mode);
  const plan = buildCodeAgentPlan(mode, baseCommand, args.input || '');
  const evaluation = evaluateCodeAgentPlan(plan, { timeoutMs: options.timeoutMs || 60000 });
  const prompt = [
    args.instructions || 'Answer the user clearly and concisely.',
    '',
    'Task:',
    args.input || '',
  ].join('\n');
  appendAudit('model.worker_fallback_started', {
    source: String(options.source || 'model_fallback').slice(0, 80),
    mode,
    command: redactCommandForLog(baseCommand),
    failureKind: options.failureKind || '',
    model: args.model || '',
  });
  const { stdout, stderr } = await execFileAsync('/bin/zsh', ['-lc', `${baseCommand} ${shellQuote(prompt)}`], {
    cwd: process.cwd(),
    env: process.env,
    timeout: evaluation.timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
  });
  const output = String(stdout || stderr || '').trim();
  if (!output) throw new Error(`${mode}_fallback_empty_output`);
  appendAudit('model.worker_fallback_completed', {
    source: String(options.source || 'model_fallback').slice(0, 80),
    mode,
    outputLength: output.length,
  });
  return output;
}

async function callOpenAIResponsesWithFallback(args = {}, options = {}) {
  try {
    return await callOpenAIResponses(args);
  } catch (error) {
    const failureKind = openAiFallbackFailureKind(error);
    if (!failureKind || options.fallback === false || args.imageDataUrl) throw error;
    return callLocalTextWorkerFallback(args, {
      ...options,
      failureKind,
      source: options.source || 'openai_fallback',
    });
  }
}

function jobSnapshot() {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 30);
}

function queueCounts() {
  return Array.from(jobs.values()).reduce(
    (counts, job) => {
      counts[job.status] += 1;
      counts.total += 1;
      return counts;
    },
    { total: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 },
  );
}

function workflowSnapshot(limit = 20) {
  return Array.from(workflows.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, limit)));
}

function workflowCounts() {
  return Array.from(workflows.values()).reduce(
    (counts, workflow) => {
      counts[workflow.status] = (counts[workflow.status] || 0) + 1;
      counts.total += 1;
      return counts;
    },
    { total: 0, queued: 0, running: 0, done: 0, failed: 0, cancelled: 0, blocked: 0 },
  );
}

function compactRecordText(value, maxLength = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function routeResultLink(record) {
  if (record.jobId) return `/api/jobs/${encodeURIComponent(record.jobId)}`;
  if (record.workflowId) return `/api/workflows/${encodeURIComponent(record.workflowId)}`;
  return `/api/tasks/routing/${encodeURIComponent(record.id)}`;
}

function approvalRequirementForRoute(decision = {}, result = {}) {
  if (result.approval) return `approval:${result.approval.action || 'local_action'}`;
  if (decision.requiresLocalExecution) return LOCAL_EXEC_ENABLED ? 'local_execution_enabled' : 'local_execution_required';
  if (decision.requiresOpenAiKey && !OPENAI_API_KEY) return 'openai_key_required';
  return 'none';
}

function routingStatusForResult(result = {}) {
  const job = result.job || result.data?.job || null;
  const workflow = result.workflow || result.data?.workflow || result.data?.result?.workflow || null;
  if (result.approval) return 'approval_required';
  if (job?.status) return normalizeRoutingStatus(job.status);
  if (workflow?.status) return normalizeRoutingStatus(workflow.status);
  if (!result.executed) return 'preview';
  if (result.queued) return 'queued';
  if (result.ok === false) return 'blocked';
  return 'done';
}

function routingScopeForDecision(decision = {}, options = {}) {
  const explicit = String(options.scope || '').trim();
  if (explicit) return explicit;
  if (decision.localCommand) return `local command: ${decision.localCommand}`;
  if (decision.lane === 'background') return 'durable background worker';
  if (decision.lane === 'codex') return 'codebase or repository work';
  if (decision.lane === 'claude') return 'Claude Code delegation';
  return 'realtime voice / fast answer';
}

function createRoutingRecord(options = {}) {
  const decision = options.decision || {};
  const lane = normalizeRoutingLane(decision.localCommand ? 'local' : decision.lane);
  const id = crypto.randomUUID();
  const now = Date.now();
  const draft = {
    id,
    taskTitle: compactRecordText(options.task || options.title || 'Untitled routed task', 180),
    lane,
    label: decision.label || (lane === 'background' ? 'Deep' : lane === 'local' ? 'Local' : lane),
    owner: options.owner || ownerForRoutingLane(lane),
    scope: routingScopeForDecision(decision, options),
    parallelGroup: String(options.parallelGroup || options.group || lane).slice(0, 120),
    approvalRequirement: options.approvalRequirement || approvalRequirementForRoute(decision, options.result || {}),
    status: normalizeRoutingStatus(options.status || 'preview'),
    source: options.source || 'router',
    execute: Boolean(options.execute),
    confidence: Number(decision.confidence || 0),
    reason: decision.reason || '',
    jobId: options.jobId || '',
    workflowId: options.workflowId || '',
    localCommand: decision.localCommand || options.localCommand?.intent || '',
    resultLink: options.resultLink || '',
    resultSummary: options.resultSummary || '',
    attempts: normalizeJobAttempts(options.attempts),
    failureKind: options.failureKind || '',
    recoveryPlan: normalizeRecoveryPlan(options.recoveryPlan),
    memoryMatches: options.memoryMatches || 0,
    createdAt: now,
    updatedAt: now,
    completedAt: ['done', 'failed', 'cancelled', 'blocked'].includes(options.status) ? now : 0,
  };
  const record = normalizePersistedRoutingRecord(draft);
  record.resultLink = record.resultLink || routeResultLink(record);
  routingRecords.set(record.id, record);
  persistRouting();
  appendAudit('task_route.recorded', {
    id: record.id,
    lane: record.lane,
    owner: record.owner,
    status: record.status,
    jobId: record.jobId,
    workflowId: record.workflowId,
    source: record.source,
  });
  return record;
}

function setRoutingRecord(id, patch = {}) {
  const existing = routingRecords.get(String(id || ''));
  if (!existing) return null;
  const completedStatus = ['done', 'failed', 'cancelled', 'blocked'].includes(patch.status);
  const next = normalizePersistedRoutingRecord({
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    completedAt: completedStatus ? Date.now() : patch.completedAt === undefined ? existing.completedAt : patch.completedAt,
  });
  next.resultLink = next.resultLink || routeResultLink(next);
  routingRecords.set(next.id, next);
  persistRouting();
  if (patch.status && patch.status !== existing.status) {
    appendAudit('task_route.status', {
      id: next.id,
      lane: next.lane,
      owner: next.owner,
      status: next.status,
      jobId: next.jobId,
      workflowId: next.workflowId,
    });
  }
  return next;
}

function updateRoutingRecordsForJob(job) {
  if (!job?.id) return;
  for (const record of routingRecords.values()) {
    if (record.jobId !== job.id) continue;
    setRoutingRecord(record.id, {
      status: normalizeRoutingStatus(job.status),
      resultSummary: compactRecordText(job.result || job.log || record.resultSummary, 500),
      attempts: normalizeJobAttempts(job.attempts),
      failureKind: job.failureKind || '',
      recoveryPlan: normalizeRecoveryPlan(job.recoveryPlan),
      resultLink: routeResultLink(record),
    });
  }
}

function updateRoutingRecordsForWorkflow(workflow) {
  if (!workflow?.id) return;
  for (const record of routingRecords.values()) {
    if (record.workflowId !== workflow.id) continue;
    setRoutingRecord(record.id, {
      status: normalizeRoutingStatus(workflow.status),
      resultSummary: compactRecordText(workflow.result || record.resultSummary, 500),
      resultLink: routeResultLink(record),
    });
  }
}

function routingRecordsForJob(jobId) {
  const id = String(jobId || '');
  if (!id) return [];
  return routingSnapshot(200).filter((record) => record.jobId === id);
}

function routingRecordsForWorkflow(workflowId) {
  const id = String(workflowId || '');
  if (!id) return [];
  return routingSnapshot(200).filter((record) => record.workflowId === id);
}

function reconcileRoutingRecords() {
  for (const record of routingRecords.values()) {
    const job = record.jobId ? jobs.get(record.jobId) : null;
    const workflow = record.workflowId ? workflows.get(record.workflowId) : null;
    if (job) updateRoutingRecordsForJob(job);
    if (workflow) updateRoutingRecordsForWorkflow(workflow);
  }
}

function routingSnapshot(limit = 20, status = '') {
  const wantedStatus = String(status || '').trim();
  return Array.from(routingRecords.values())
    .filter((record) => !wantedStatus || record.status === wantedStatus)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, Number(limit || 20))));
}

function isRoutingAttentionStatus(status) {
  return ['queued', 'running', 'approval_required', 'blocked', 'failed'].includes(String(status || ''));
}

function activeRoutingSnapshot(limit = 20) {
  return Array.from(routingRecords.values())
    .filter((record) => isRoutingAttentionStatus(record.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(200, Number(limit || 20))));
}

function routingCounts() {
  return Array.from(routingRecords.values()).reduce(
    (counts, record) => {
      counts[record.status] = (counts[record.status] || 0) + 1;
      counts[record.lane] = (counts[record.lane] || 0) + 1;
      counts.total += 1;
      return counts;
    },
    {
      total: 0,
      preview: 0,
      queued: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      blocked: 0,
      approval_required: 0,
      quick: 0,
      background: 0,
      codex: 0,
      claude: 0,
      local: 0,
    },
  );
}

const ROUTING_LEDGER_REQUIRED_FIELDS = ['id', 'taskTitle', 'lane', 'owner', 'scope', 'parallelGroup', 'approvalRequirement', 'status', 'resultLink'];

function missingRoutingLedgerFields(record) {
  if (!record) return ROUTING_LEDGER_REQUIRED_FIELDS;
  return ROUTING_LEDGER_REQUIRED_FIELDS.filter((field) => !String(record[field] || '').trim());
}

function routingBlockerForRecord(record) {
  if (!record) return '';
  if (record.status === 'approval_required') return record.approvalRequirement || 'approval required';
  if (record.status === 'failed') return record.failureKind || record.recoveryPlan?.failureKind || compactRecordText(record.resultSummary, 160) || 'failed';
  if (record.status === 'blocked') return record.failureKind || record.recoveryPlan?.summary || compactRecordText(record.resultSummary, 160) || 'blocked';
  return '';
}

function routingNextActionForRecord(record) {
  if (!record) return '';
  if (record.status === 'queued') return `${record.owner} should start or stay queued in ${record.lane}.`;
  if (record.status === 'running') return `${record.owner} is running; check ${record.resultLink}.`;
  if (record.status === 'approval_required') return `Review approval before ${record.owner} can continue.`;
  if (record.recoveryPlan?.nextActions?.length) {
    const action = record.recoveryPlan.nextActions[0];
    return `${action.label}: ${compactRecordText(action.reason || action.recoveryType || '', 140)}`;
  }
  if (record.status === 'blocked' || record.status === 'failed') return `Inspect ${record.resultLink} and queue recovery if appropriate.`;
  return record.resultLink ? `Review ${record.resultLink}.` : '';
}

function routingLedgerEntry(record) {
  if (!record) return null;
  return {
    id: record.id,
    taskTitle: record.taskTitle,
    lane: record.lane,
    owner: record.owner,
    scope: record.scope,
    parallelGroup: record.parallelGroup,
    approvalRequirement: record.approvalRequirement,
    status: record.status,
    blocker: routingBlockerForRecord(record),
    nextAction: routingNextActionForRecord(record),
    resultLink: record.resultLink,
    resultSummary: record.resultSummary,
    jobId: record.jobId,
    workflowId: record.workflowId,
    updatedAt: record.updatedAt,
  };
}

function finalizeRouteResult(result, context = {}) {
  const job = result.job || result.data?.job || null;
  const workflow = result.workflow || result.data?.workflow || result.data?.result?.workflow || null;
  const status = routingStatusForResult(result);
  const record = createRoutingRecord({
    task: context.task,
    decision: result.decision || context.decision,
    source: context.source,
    owner: context.owner,
    execute: result.executed || result.decision?.execute,
    localCommand: result.localCommand || context.localCommand,
    memoryMatches: result.memory?.count || context.memoryMatches || 0,
    status,
    jobId: job?.id || '',
    workflowId: workflow?.id || '',
    resultSummary: result.output || '',
    parallelGroup: context.parallelGroup,
    scope: context.scope,
    result,
  });
  return {
    ...result,
    routing: record,
    routeRecord: record,
  };
}

function routingDecisionForWorkflow(mode, source = 'workflow') {
  const lane = normalizeRoutingLane(mode === 'quick' ? 'quick' : mode);
  return {
    lane,
    mode: lane,
    label: lane === 'quick' ? 'Quick' : lane === 'background' ? 'Deep' : lane === 'codex' ? 'Codex' : lane === 'claude' ? 'Claude' : 'Local',
    confidence: 1,
    reason: `${source} workflow selected ${lane} lane`,
    execute: true,
    requiresOpenAiKey: lane === 'quick' || lane === 'background',
    requiresLocalExecution: lane === 'codex' || lane === 'claude' || lane === 'local',
  };
}

function createRoutingRecordForWorkflow(options = {}) {
  const workflow = options.workflow || null;
  if (!workflow?.id) return null;
  const job = options.job || null;
  const mode = options.mode || workflow.mode || job?.mode || 'quick';
  const source = String(options.source || workflow.source || 'workflow').slice(0, 80);
  const decision = options.decision || routingDecisionForWorkflow(mode, source);
  return createRoutingRecord({
    task: options.task || workflow.request || workflow.title,
    decision,
    source,
    execute: true,
    status: job?.status || workflow.status,
    jobId: job?.id || workflow.jobId || '',
    workflowId: workflow.id,
    owner: options.owner || ownerForRoutingLane(decision.lane),
    scope: options.scope || `${workflow.kind || 'workflow'}:${workflow.intent || workflow.source || source}`,
    parallelGroup: options.parallelGroup || options.group || decision.lane,
    resultSummary: options.resultSummary || workflow.result || '',
  });
}

function recoveryActionPriority(job, action) {
  const riskLevel = Number(action?.riskLevel || 0);
  if (trustedRecoveryAutoEligible(job, action)) return 0;
  if (action?.autoEligible && riskLevel <= 1) return 1;
  if (job.failureKind === 'approval_required') return 1;
  if (riskLevel <= 1) return 2;
  return 3;
}

function recoveryChildJobs(jobId) {
  const parentId = String(jobId || '');
  if (!parentId) return [];
  return Array.from(jobs.values())
    .filter((job) => job.recoveryForJobId === parentId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function activeRecoveryChildJob(jobId) {
  return recoveryChildJobs(jobId).find((job) => job.status === 'queued' || job.status === 'running') || null;
}

function completedRecoveryChildJob(jobId) {
  return recoveryChildJobs(jobId).find((job) => job.status === 'done') || null;
}

function trustedRecoveryAutoEligible(job, action, childCount = null) {
  if (!job || !action) return false;
  if (job.recoveryForJobId) return false;
  const type = action.type || action.recoveryType || 'manual';
  if (!['retry', 'alternative_worker'].includes(type)) return false;
  if (!LOCAL_EXEC_ENABLED || !TRUSTED_LOCAL_MODE) return false;
  if (actionPolicy?.dryRun) return false;
  if (completedRecoveryChildJob(job.id)) return false;
  const attempts = childCount === null ? recoveryChildJobs(job.id).length : Number(childCount || 0);
  if (attempts >= MAX_RECOVERY_JOB_ATTEMPTS) return false;
  const riskLevel = Math.max(0, Math.min(4, Number(action.riskLevel || 0)));
  return riskLevel <= Math.max(0, Math.min(4, Number(actionPolicy?.maxAutoRiskLevel || 0)));
}

function reviewedRecoveryTypes(job) {
  const reviewed = new Set();
  const log = String(job?.log || '');
  for (const match of log.matchAll(/Recovery action reviewed via work_next: ([\w-]+)/g)) {
    reviewed.add(match[1]);
  }
  return reviewed;
}

function recoveryActionCandidates(recentJobs, limit = 4) {
  return recentJobs
    .filter((job) => (
      job.status === 'failed'
      && !job.recoveryForJobId
      && !completedRecoveryChildJob(job.id)
      && job.recoveryPlan?.nextActions?.length
    ))
    .flatMap((job) => {
      if (activeRecoveryChildJob(job.id)) return [];
      const reviewed = reviewedRecoveryTypes(job);
      const childCount = recoveryChildJobs(job.id).length;
      return job.recoveryPlan.nextActions
        .filter((action) => {
          const type = action.type || 'manual';
          if (['diagnose', 'policy', 'approval'].includes(type) && reviewed.has(type)) return false;
          if (job.recoveryForJobId && ['retry', 'alternative_worker'].includes(type)) return false;
          if (['retry', 'alternative_worker'].includes(type) && completedRecoveryChildJob(job.id)) return false;
          if (['retry', 'alternative_worker'].includes(type) && childCount >= MAX_RECOVERY_JOB_ATTEMPTS) return false;
          return true;
        })
        .slice(0, 2)
        .map((action, index) => ({
          id: `recovery:${job.id}:${action.type || index}`,
          priority: recoveryActionPriority(job, action),
          label: action.label || 'Recover failed job',
          summary: [
            `${job.mode}/${job.failureKind || job.recoveryPlan.failureKind || 'failed'}: ${compactRecordText(job.title, 110)}`,
            action.reason || job.recoveryPlan.summary || '',
          ].filter(Boolean).join(' · '),
          source: 'recovery',
          jobId: job.id,
          failureKind: job.failureKind || job.recoveryPlan.failureKind || '',
          recoveryType: action.type || 'manual',
          mode: action.mode || '',
          autoEligible: Boolean(action.autoEligible),
          trustedAutoEligible: trustedRecoveryAutoEligible(job, action, childCount),
          riskLevel: Math.max(0, Math.min(4, Number(action.riskLevel || 0))),
          command: action.command || '',
          recoveryAttempts: childCount,
          maxRecoveryAttempts: MAX_RECOVERY_JOB_ATTEMPTS,
        }));
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

function retryableBlockedWorkflowPlan(workflow) {
  if (!workflow || !['blocked', 'failed'].includes(workflow.status)) return null;
  if (workflow.kind !== 'app' || workflow.intent !== 'run_app_workflow') return null;
  const instruction = String(workflow.request || workflow.title || '').trim();
  if (!instruction) return null;
  const plan = safeLocalAppWorkflowPlan(instruction);
  if (!plan?.ok || !Array.isArray(plan.steps) || !plan.steps.length) return null;
  return {
    instruction,
    stepCount: plan.steps.length,
    source: plan.source,
    confidence: plan.confidence,
  };
}

function isInternalWorkflow(workflow) {
  if (!workflow) return false;
  const source = String(workflow.source || '').toLowerCase();
  if (/(test|smoke|verification|diagnostic|internal)/.test(source)) return true;
  const text = [
    workflow.title,
    workflow.request,
    workflow.result,
    workflow.target?.purpose,
  ].filter(Boolean).join('\n').toLowerCase();
  return /\b(smoke test|verification|diagnostic|internal test|approval continuation smoke)\b/.test(text)
    || /\.approval-continuation-/.test(text);
}

function isDeliverableWorkflow(workflow) {
  return Boolean(workflow?.result && workflow.status === 'done' && !isInternalWorkflow(workflow));
}

function workflowResolutionTime(workflow) {
  return Math.max(
    Number(workflow?.completedAt || 0),
    Number(workflow?.updatedAt || 0),
    Number(workflow?.createdAt || 0),
  );
}

function normalizeWorkflowResolutionText(value) {
  return String(value || '')
    .replace(/^(retry|continue)\s*[·:：-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function workflowResolutionKey(workflow) {
  if (!workflow) return '';
  const kind = String(workflow.kind || '').trim().toLowerCase();
  const intent = String(workflow.intent || '').trim().toLowerCase();
  if (!kind || !intent || intent === 'continue') return '';
  const request = normalizeWorkflowResolutionText(workflow.request || workflow.title);
  if (!request) return '';
  return `${kind}:${intent}:${request}`;
}

function isWorkflowResolvedByLaterDone(workflow, candidates = []) {
  if (!workflow || !['blocked', 'failed'].includes(workflow.status)) return false;
  const key = workflowResolutionKey(workflow);
  if (!key) return false;
  const blockedAt = workflowResolutionTime(workflow);
  return candidates.some((candidate) => (
    candidate?.id !== workflow.id
    && candidate?.status === 'done'
    && !isInternalWorkflow(candidate)
    && workflowResolutionKey(candidate) === key
    && workflowResolutionTime(candidate) > blockedAt
  ));
}

function workflowBriefing(options = {}) {
  const workflowLimit = Math.max(1, Math.min(20, Number(options.workflowLimit || 6)));
  const jobLimit = Math.max(1, Math.min(20, Number(options.jobLimit || 6)));
  const readiness = readinessSnapshot();
  const workflowContext = workflowSnapshot(Math.max(workflowLimit, 50));
  const recentWorkflows = workflowContext.slice(0, workflowLimit);
  const recentJobs = jobSnapshot().slice(0, jobLimit);
  const openInbox = inboxSnapshot(6, 'open');
  const activeSession = activeSessionSnapshot();
  const pendingApprovals = pendingApprovalSnapshot(10);
  const recentRoutes = routingSnapshot(6);
  const activeRoutes = activeRoutingSnapshot(12);
  const routingLedger = activeRoutes.map(routingLedgerEntry).filter(Boolean);
  const activeJobs = recentJobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const recoveryActions = recoveryActionCandidates(recentJobs);
  const recentBlockedWorkflows = recentWorkflows.filter((workflow) => workflow.status === 'blocked' || workflow.status === 'failed');
  const resolvedBlockedWorkflows = recentBlockedWorkflows.filter((workflow) => (
    isWorkflowResolvedByLaterDone(workflow, workflowContext)
  ));
  const blockedWorkflows = recentBlockedWorkflows.filter((workflow) => (
    !isWorkflowResolvedByLaterDone(workflow, workflowContext)
  ));
  const latestDoneWorkflow = workflowContext.find((workflow) => workflow.status === 'done') || null;
  const latestDeliverableWorkflow = workflowContext.find(isDeliverableWorkflow) || null;
  const latestDoneJob = recentJobs.find((job) => job.status === 'done') || null;
  const learning = learningStateSnapshot();
  const nextActions = [];

  if (readiness.primaryIssue) {
    nextActions.push({
      id: `readiness:${readiness.primaryIssue.id}`,
      priority: readiness.primaryIssue.status === 'blocked' ? 1 : 2,
      label: readiness.primaryIssue.label,
      summary: readiness.primaryIssue.next || readiness.primaryIssue.summary,
      source: 'readiness',
    });
  }

  if (pendingApprovals.length) {
    nextActions.push({
      id: 'approvals',
      priority: 1,
      label: 'Review approvals',
      summary: `${pendingApprovals.length} action approval(s) are waiting.`,
      source: 'approvals',
    });
  }

  if (activeSession) {
    nextActions.push({
      id: `session:${activeSession.id}`,
      priority: 2,
      label: 'Continue session',
      summary: `${activeSession.title}: ${activeSession.events.length} event(s) recorded.`,
      source: 'sessions',
      sessionId: activeSession.id,
    });
  }

  if (openInbox.length) {
    const first = openInbox[0];
    nextActions.push({
      id: `inbox:${first.id}`,
      priority: Math.min(3, first.priority),
      label: 'Review inbox',
      summary: `${openInbox.length} open inbox item(s). Next: ${first.title}`,
      source: 'inbox',
      inboxId: first.id,
    });
  }

  if (activeJobs.length) {
    nextActions.push({
      id: 'active_jobs',
      priority: 2,
      label: 'Check active work',
      summary: `${activeJobs.length} job(s) are queued or running.`,
      source: 'jobs',
    });
  }

  if (activeRoutes.length) {
    const first = routingLedger[0];
    nextActions.push({
      id: `route:${first.id}`,
      priority: 2,
      label: 'Check routed work',
      summary: `${routingLedger.length} routed task(s) active/blocked. ${first.owner} owns ${first.lane}: ${first.taskTitle}. Next: ${first.nextAction || 'check progress'}`,
      source: 'routing',
      routeId: first.id,
    });
  }

  for (const action of recoveryActions) {
    nextActions.push(action);
  }

  if (blockedWorkflows.length) {
    const first = blockedWorkflows[0];
    const retryPlan = retryableBlockedWorkflowPlan(first);
    nextActions.push({
      id: `workflow:${first.id}`,
      priority: retryPlan ? 0 : 2,
      label: retryPlan ? 'Retry blocked app workflow' : 'Resolve blocked workflow',
      summary: retryPlan
        ? `${first.title}: retry with ${retryPlan.stepCount} safe local step(s).`
        : `${first.title}: ${compactRecordText(first.result || first.request, 160)}`,
      source: 'workflows',
      workflowId: first.id,
      workflowAction: retryPlan ? 'retry_app_workflow' : 'inspect',
      executable: Boolean(retryPlan),
    });
  }

  if (latestDeliverableWorkflow?.result && !nextActions.some((action) => action.id === `copy:${latestDeliverableWorkflow.id}`)) {
    nextActions.push({
      id: `copy:${latestDeliverableWorkflow.id}`,
      priority: 3,
      label: 'Deliver latest result',
      summary: `Latest completed workflow can be copied or continued: ${latestDeliverableWorkflow.title}.`,
      source: 'workflows',
      workflowId: latestDeliverableWorkflow.id,
    });
  }

  if (!nextActions.length) {
    nextActions.push({
      id: 'new_task',
      priority: 4,
      label: 'Start next task',
      summary: 'No active blockers or queued work. Ready for the next request.',
      source: 'system',
    });
  }

  const summary = [
    readiness.overall === 'blocked' ? `Setup blocked: ${readiness.summary}` : readiness.overall === 'degraded' ? `Needs attention: ${readiness.summary}` : 'Resident is ready.',
    `${workflowCounts().total} workflow(s), ${queueCounts().total} job(s), ${memories.size} memory record(s).`,
    activeRoutes.length ? `${activeRoutes.length} routed task(s) active.` : '',
    learning.enabled && learning.profile.sourceEventCount ? `Learning: ${learning.profile.summary}` : '',
    activeSession ? `Active session: ${activeSession.title}.` : '',
    openInbox.length ? `${openInbox.length} open inbox item(s).` : '',
    nextActions[0]?.summary || '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    ok: readiness.overall !== 'blocked',
    generatedAt: new Date().toISOString(),
    summary,
    readiness: {
      overall: readiness.overall,
      label: readiness.label,
      counts: readiness.counts,
      primaryIssue: readiness.primaryIssue,
    },
    counts: {
      workflows: workflowCounts(),
      jobs: queueCounts(),
      pendingApprovals: pendingApprovals.length,
      memories: memories.size,
      learnedProfileEvents: learning.profile.sourceEventCount,
      inbox: inboxCounts(),
      sessions: sessionCounts(),
      routing: routingCounts(),
      activeJobs: activeJobs.length,
      activeRoutes: routingLedger.length,
      recoveryActions: recoveryActions.length,
      blockedWorkflows: blockedWorkflows.length,
      resolvedBlockedWorkflows: resolvedBlockedWorkflows.length,
    },
    nextActions: nextActions.sort((a, b) => a.priority - b.priority).slice(0, 6),
    routingLedger,
    recent: {
      workflows: recentWorkflows.map((workflow) => ({
        id: workflow.id,
        kind: workflow.kind,
        intent: workflow.intent,
        status: workflow.status,
        title: workflow.title,
        updatedAt: workflow.updatedAt,
        result: compactRecordText(workflow.result),
      })),
      jobs: recentJobs.map((job) => ({
        id: job.id,
        mode: job.mode,
        source: job.source,
        status: job.status,
        title: job.title,
        updatedAt: job.updatedAt,
        result: compactRecordText(job.result),
      })),
      memories: memorySnapshot(3),
      learnedProfile: learning.profile,
      inbox: openInbox.slice(0, 3),
      sessions: sessionSnapshot(3),
      routing: recentRoutes,
    },
    latestDone: {
      workflow: latestDoneWorkflow,
      deliverableWorkflow: latestDeliverableWorkflow,
      job: latestDoneJob,
    },
  };
}

function progressAgeLabel(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return 'unknown time';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatJobProgressLine(job) {
  const detail = compactRecordText(job.result || job.log || '', 150);
  const suffix = detail ? ` · ${detail}` : '';
  return `${job.mode}/${job.status} · ${compactRecordText(job.title, 90)} · ${progressAgeLabel(job.updatedAt)}${suffix}`;
}

function formatWorkflowProgressLine(workflow) {
  const detail = compactRecordText(workflow.result || workflow.request || '', 150);
  const suffix = detail ? ` · ${detail}` : '';
  return `${workflow.kind}/${workflow.status} · ${compactRecordText(workflow.title, 90)} · ${progressAgeLabel(workflow.updatedAt)}${suffix}`;
}

function formatRoutingProgressLine(record) {
  const entry = routingLedgerEntry(record);
  const blocker = entry.blocker ? ` · blocker: ${compactRecordText(entry.blocker, 100)}` : '';
  const next = entry.nextAction ? ` · next: ${compactRecordText(entry.nextAction, 120)}` : '';
  const detail = entry.resultSummary ? ` · ${compactRecordText(entry.resultSummary, 100)}` : '';
  return `${entry.lane}/${entry.status} · owner:${entry.owner} · group:${entry.parallelGroup} · ${compactRecordText(entry.taskTitle, 90)} · ${progressAgeLabel(entry.updatedAt)} · ${entry.resultLink}${blocker}${next}${detail}`;
}

function uniqueProgressRecords(list, keyForRecord) {
  const seen = new Set();
  return list.filter((item) => {
    const key = keyForRecord(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workProgressCheckIn(options = {}) {
  const jobLimit = Math.max(1, Math.min(12, Number(options.jobLimit || 5)));
  const workflowLimit = Math.max(1, Math.min(12, Number(options.workflowLimit || 5)));
  const recentJobs = jobSnapshot().slice(0, jobLimit);
  const recentWorkflows = workflowSnapshot(workflowLimit);
  const recentRoutes = routingSnapshot(Math.max(jobLimit, workflowLimit, 5));
  const activeRouteSnapshot = activeRoutingSnapshot(Math.max(jobLimit, workflowLimit, 5));
  const activeJobs = recentJobs.filter((job) => job.status === 'queued' || job.status === 'running');
  const activeWorkflows = uniqueProgressRecords(
    recentWorkflows.filter((workflow) => workflow.status === 'queued' || workflow.status === 'running'),
    (workflow) => `${workflow.status}:${workflow.title}:${workflow.jobId}`,
  );
  const blockedWorkflows = uniqueProgressRecords(
    recentWorkflows.filter((workflow) => workflow.status === 'blocked' || workflow.status === 'failed'),
    (workflow) => `${workflow.status}:${workflow.title}:${compactRecordText(workflow.result || workflow.request, 90)}`,
  );
  const activeRoutes = uniqueProgressRecords(
    activeRouteSnapshot,
    (record) => `${record.lane}:${record.owner}:${record.taskTitle}:${record.jobId}:${record.workflowId}`,
  );
  const routingLedger = activeRoutes.map(routingLedgerEntry).filter(Boolean);
  const latestDoneJob = recentJobs.find((job) => job.status === 'done') || null;
  const latestDoneWorkflow = recentWorkflows.find((workflow) => workflow.status === 'done') || null;
  const latestDoneRoute = recentRoutes.find((record) => record.status === 'done') || null;
  const briefing = workflowBriefing({ workflowLimit, jobLimit });
  const nextActions = (briefing.nextActions || []).slice(0, 3);

  const lines = [
    activeRoutes.length
      ? `分流中的工作:\n${activeRoutes.map((record, index) => `${index + 1}. ${formatRoutingProgressLine(record)}`).join('\n')}`
      : '',
    activeJobs.length
      ? `现在有 ${activeJobs.length} 个后台任务正在排队或运行。`
      : '当前没有正在运行的后台任务。',
    activeJobs.length ? `运行中:\n${activeJobs.map((job, index) => `${index + 1}. ${formatJobProgressLine(job)}`).join('\n')}` : '',
    activeWorkflows.length
      ? `活跃工作流:\n${activeWorkflows.map((workflow, index) => `${index + 1}. ${formatWorkflowProgressLine(workflow)}`).join('\n')}`
      : '',
    blockedWorkflows.length
      ? `需要处理:\n${blockedWorkflows.slice(0, 3).map((workflow, index) => `${index + 1}. ${formatWorkflowProgressLine(workflow)}`).join('\n')}`
      : '',
    !activeJobs.length && latestDoneJob ? `最近完成任务: ${formatJobProgressLine(latestDoneJob)}` : '',
    latestDoneWorkflow ? `最近完成工作流: ${formatWorkflowProgressLine(latestDoneWorkflow)}` : '',
    latestDoneRoute ? `最近完成分流任务: ${formatRoutingProgressLine(latestDoneRoute)}` : '',
    nextActions.length
      ? `下一步:\n${nextActions.map((action, index) => `${index + 1}. ${action.label}: ${compactRecordText(action.summary, 150)}`).join('\n')}`
      : '',
  ]
    .filter(Boolean);

  const output = lines.join('\n');
  appendAudit('work_progress.check_in', {
    activeJobs: activeJobs.length,
    activeWorkflows: activeWorkflows.length,
    blockedWorkflows: blockedWorkflows.length,
    activeRoutes: activeRoutes.length,
    recentJobs: recentJobs.length,
    recentWorkflows: recentWorkflows.length,
    recentRoutes: recentRoutes.length,
    source: String(options.source || 'api').slice(0, 80),
  });

  return {
    ok: true,
    output,
    counts: {
      jobs: queueCounts(),
      workflows: workflowCounts(),
      activeJobs: activeJobs.length,
      activeWorkflows: activeWorkflows.length,
      blockedWorkflows: blockedWorkflows.length,
      activeRoutes: activeRoutes.length,
      routing: routingCounts(),
    },
    routingLedger,
    activeRoutes,
    recentRoutes,
    activeJobs,
    recentJobs,
    activeWorkflows,
    blockedWorkflows,
    recentWorkflows,
    latestDone: {
      job: latestDoneJob,
      workflow: latestDoneWorkflow,
      route: latestDoneRoute,
    },
    nextActions,
  };
}

async function workNextAction(options = {}) {
  const execute = options.execute === true || String(options.execute || '').toLowerCase() === 'true';
  const briefing = workflowBriefing({
    workflowLimit: options.workflowLimit || 6,
    jobLimit: options.jobLimit || 6,
  });
  const requestedActionId = String(options.actionId || options.id || '').trim();
  const actions = briefing.nextActions || [];
  const action = requestedActionId ? actions.find((item) => item.id === requestedActionId) || null : actions[0] || null;
  if (requestedActionId && !action) {
    return {
      ok: false,
      executed: false,
      action: null,
      output: `没有找到指定的下一步: ${requestedActionId}`,
      briefing,
    };
  }
  if (!action) {
    return {
      ok: true,
      executed: false,
      action: null,
      output: '当前没有可执行的下一步。JAVIS 已经待命。',
      briefing,
    };
  }

  let result = null;
  let output = '';
  let executed = false;

  if (action.source === 'readiness') {
    if (execute) {
      result = await runNextSetupAction({ source: options.source || 'work_next' });
      executed = true;
      output = result.output;
    } else {
      result = setupGuideSnapshot();
      output = result.output;
    }
  } else if (action.source === 'inbox') {
    result = await processNextInbox({
      execute,
      includeScreen: Boolean(options.includeScreen),
      source: options.source || 'work_next',
      mode: options.mode || options.lane,
      useMemory: options.useMemory,
      memoryLimit: options.memoryLimit,
    });
    executed = execute;
    output = result.output;
  } else if (action.source === 'sessions') {
    result = sessionCheckIn({ source: options.source || 'work_next' });
    output = result.output;
  } else if (action.source === 'recovery') {
    const job = action.jobId ? jobs.get(action.jobId) || null : null;
    const diagnostics = job?.recoveryPlan?.diagnostics || recoveryDiagnosticsSnapshot();
    const recoverySummary = job?.recoveryPlan?.summary || action.summary || '';
    const safeToExecute = Boolean(action.autoEligible && action.riskLevel <= 1 && ['diagnose', 'policy', 'approval'].includes(action.recoveryType));
    const canQueueRecovery = Boolean(
      job
      && execute
      && ['retry', 'alternative_worker'].includes(action.recoveryType)
      && (action.trustedAutoEligible || !options.autopilot)
      && [
        'worker_failed',
        'command_failed',
        'timeout',
        'interrupted',
        'worker_command_missing',
        'model_failed',
        'model_quota_or_api',
        'openai_key_missing',
      ].includes(job.failureKind || job.recoveryPlan?.failureKind || action.failureKind),
    );
    if (canQueueRecovery) {
      result = queueRecoveryJob(job, action, { source: options.source || 'work_next' });
      executed = Boolean(result.queued);
      output = result.output;
    } else if (execute && safeToExecute && job) {
      appendJobLog(job.id, `Recovery action reviewed via work_next: ${action.recoveryType}.`);
      executed = true;
    }
    if (!result) result = { job, recovery: action, diagnostics };
    if (!output) output = job
      ? [
        `恢复任务: ${job.mode}/${job.failureKind || job.recoveryPlan?.failureKind || 'failed'} · ${compactRecordText(job.title, 120)}`,
        recoverySummary ? `原因: ${compactRecordText(recoverySummary, 220)}` : '',
        diagnostics?.summary ? `诊断: ${compactRecordText(diagnostics.summary, 220)}` : '',
        diagnostics?.runtime ? `权限: localExec=${diagnostics.runtime.localExecutionEnabled ? 'on' : 'off'}, trusted=${diagnostics.runtime.trustedLocalMode ? 'on' : 'off'}, autoLevel=${diagnostics.runtime.maxAutoRiskLevel}, approvalAt=${diagnostics.runtime.requireApprovalAtRiskLevel}` : '',
        diagnostics?.workers ? `Worker: Codex ${diagnostics.workers.codex?.available ? 'ready' : 'missing'}, Claude ${diagnostics.workers.claude?.available ? 'ready' : 'missing'}` : '',
        ['retry', 'alternative_worker'].includes(action.recoveryType)
          ? `可恢复: ${action.trustedAutoEligible ? '自动驾驶可排' : '手动执行会排'}一个缩小范围的 ${recoveryJobModeFor(job, action)} recovery job (${action.recoveryAttempts || 0}/${action.maxRecoveryAttempts || MAX_RECOVERY_JOB_ATTEMPTS}).`
          : '',
        safeToExecute
          ? '已完成低风险恢复检查；下一步可以按诊断继续修复。'
          : `这一步不是低风险自动动作，已保留为计划: ${action.label}.`,
      ].filter(Boolean).join('\n')
      : '没有找到对应的失败任务，可能已经被清理。';
  } else if (action.source === 'workflows' && action.workflowAction === 'retry_app_workflow') {
    const workflow = action.workflowId ? workflows.get(action.workflowId) || null : null;
    const retryPlan = retryableBlockedWorkflowPlan(workflow);
    if (!workflow || !retryPlan) {
      result = { workflow, retryPlan };
      output = workflow
        ? `这个 workflow 当前不能安全自动重试: ${workflow.title}`
        : '没有找到对应的 blocked workflow。';
    } else if (execute) {
      result = await planAndMaybeRunAppWorkflow({
        instruction: retryPlan.instruction,
        title: `retry · ${workflow.title}`,
        execute: true,
        useModel: false,
        maxNodes: options.maxNodes || 240,
        maxDepth: options.maxDepth || 9,
      });
      executed = true;
      if (result.ok && result.workflow?.id) {
        setWorkflow(workflow.id, {
          status: 'done',
          result: [
            `Recovered by retry workflow ${result.workflow.id}.`,
            result.output || '',
          ].filter(Boolean).join('\n'),
          completedAt: Date.now(),
        });
      } else {
        setWorkflow(workflow.id, {
          status: 'blocked',
          result: [
            workflow.result || '',
            `Retry attempted at ${new Date().toISOString()}: ${compactRecordText(result.output || 'retry did not complete', 1000)}`,
          ].filter(Boolean).join('\n\n'),
        });
      }
      output = [
        `已重试 blocked workflow: ${workflow.title}`,
        result.output || '',
      ].filter(Boolean).join('\n');
    } else {
      result = await planAppWorkflow({
        instruction: retryPlan.instruction,
        title: `retry · ${workflow.title}`,
        useModel: false,
        maxNodes: options.maxNodes || 240,
        maxDepth: options.maxDepth || 9,
      });
      output = [
        `可重试 workflow: ${workflow.title}`,
        result.output || '',
      ].filter(Boolean).join('\n');
    }
  } else if (action.source === 'workflows' && String(action.id || '').startsWith('copy:')) {
    const workflow = action.workflowId ? workflows.get(action.workflowId) || null : null;
    const format = options.format || 'markdown';
    if (!workflow) {
      result = { workflow: null };
      output = '没有找到要交付的 workflow。';
    } else if (execute) {
      result = await copyWorkflowResult({ workflowId: workflow.id, format });
      executed = Boolean(result.ok);
      output = result.ok
        ? `已复制 workflow 结果到剪贴板: ${workflow.title}\n${result.output}`
        : result.output;
    } else {
      const content = workflowClipboardText(workflow, format);
      result = {
        workflow,
        format,
        bytes: Buffer.byteLength(content, 'utf8'),
        preview: compactRecordText(content, 700),
      };
      output = content.trim()
        ? [
          `可交付 workflow: ${workflow.title}`,
          `格式: ${format}; ${result.bytes} bytes`,
          `预览: ${result.preview}`,
        ].join('\n')
        : `这个 workflow 还没有可交付结果: ${workflow.title}`;
    }
  } else if (action.source === 'jobs' || action.source === 'workflows') {
    result = workProgressCheckIn({
      source: options.source || 'work_next',
      jobLimit: options.jobLimit,
      workflowLimit: options.workflowLimit,
    });
    output = result.output;
  } else if (action.source === 'routing') {
    const record = action.routeId ? routingRecords.get(action.routeId) || null : activeRoutingSnapshot(1)[0] || routingSnapshot(1)[0] || null;
    const entry = routingLedgerEntry(record);
    result = { route: record, ledgerEntry: entry, activeLedger: activeRoutingSnapshot(5).map(routingLedgerEntry).filter(Boolean), counts: routingCounts() };
    output = record
      ? [
        `分流任务: ${formatRoutingProgressLine(record)}`,
        entry?.blocker ? `阻塞: ${entry.blocker}` : '',
        entry?.nextAction ? `下一步: ${entry.nextAction}` : '',
      ].filter(Boolean).join('\n')
      : '当前没有可查看的分流任务。';
  } else if (action.source === 'approvals') {
    const pending = pendingApprovalSnapshot(10);
    result = { pending };
    output = pending.length
      ? `有 ${pending.length} 个 approval 等待处理。\n${pending.slice(0, 3).map((approval, index) => `${index + 1}. level ${approval.riskLevel} · ${approval.summary}`).join('\n')}`
      : '当前没有 pending approval。';
  } else {
    output = action.summary || 'Ready for the next request.';
    result = { action };
  }

  appendAudit('work_next.selected', {
    source: action.source,
    id: action.id,
    execute,
    executed,
    outputLength: output.length,
    sourceRequest: String(options.source || 'api').slice(0, 80),
  });

  return {
    ok: true,
    executed,
    action,
    output,
    result,
    briefing,
  };
}

function trimText(value, maxLength = 24000) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `[trimmed]\n${text.slice(-maxLength)}`;
}

function createWorkflowRecord(value = {}) {
  const id = crypto.randomUUID();
  const workflow = normalizePersistedWorkflow({
    id,
    kind: value.kind || 'general',
    source: value.source || '',
    status: value.status || 'running',
    title: value.title || 'Untitled workflow',
    intent: value.intent || '',
    mode: value.mode || '',
    request: value.request || '',
    result: value.result || '',
    parentWorkflowId: value.parentWorkflowId || '',
    target: value.target || {},
    jobId: value.jobId || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: ['done', 'failed', 'cancelled', 'blocked'].includes(value.status) ? Date.now() : 0,
  });
  workflows.set(id, workflow);
  persistWorkflows();
  appendAudit('workflow.created', { id, kind: workflow.kind, source: workflow.source, status: workflow.status, title: workflow.title });
  recordActiveSessionEvent('workflow_created', `Workflow ${workflow.status}: ${compactRecordText(workflow.title, 120)}`, workflow.source || 'workflow', {
    kind: 'workflow',
    id: workflow.id,
    status: workflow.status,
  });
  return workflow;
}

function setWorkflow(id, patch) {
  const existing = workflows.get(id);
  if (!existing) return null;
  const next = normalizePersistedWorkflow({
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    result: patch.result === undefined ? existing.result : trimText(patch.result, 100000),
  });
  workflows.set(id, next);
  persistWorkflows();
  updateRoutingRecordsForWorkflow(next);
  if (patch.status) {
    appendAudit('workflow.status', {
      id,
      kind: next.kind,
      status: next.status,
      resultLength: next.result ? String(next.result).length : 0,
    });
    if (next.status !== existing.status) {
      recordActiveSessionEvent('workflow_status', `Workflow ${next.status}: ${compactRecordText(next.title, 120)}`, next.source || 'workflow', {
        kind: 'workflow',
        id: next.id,
        status: next.status,
      });
    }
  }
  return next;
}

function workflowStatusFromJob(status, result) {
  const text = String(result || '');
  if (status === 'done' && text.includes('OpenAI API key is not configured')) return 'blocked';
  return status;
}

function findWorkflowForContinuation(id) {
  const requestedId = String(id || '').trim();
  if (requestedId) return workflows.get(requestedId) || null;
  return workflowSnapshot(1)[0] || null;
}

function findWorkflowForAction(id) {
  const requestedId = String(id || '').trim();
  if (requestedId) return workflows.get(requestedId) || null;
  return workflowSnapshot(1)[0] || null;
}

function normalizeContinueWorkflowMode(value) {
  const mode = String(value || '').trim();
  if (['quick', 'background', 'codex', 'claude'].includes(mode)) return mode;
  return 'background';
}

function continuationWorkflowPrompt(parent, instruction) {
  return [
    `Continue JAVIS workflow: ${parent.title}`,
    '',
    `Follow-up request: ${instruction || 'Continue from this workflow and produce the next useful result.'}`,
    '',
    'Previous workflow:',
    `ID: ${parent.id}`,
    `Kind: ${parent.kind}`,
    `Intent: ${parent.intent}`,
    `Mode: ${parent.mode}`,
    `Status: ${parent.status}`,
    parent.target?.title ? `Target title: ${parent.target.title}` : '',
    parent.target?.url ? `Target URL: ${parent.target.url}` : '',
    '',
    'Previous request:',
    parent.request || '',
    '',
    'Previous result:',
    parent.result || '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function continueWorkflow(options = {}) {
  const parent = findWorkflowForContinuation(options.workflowId);
  if (!parent) {
    return {
      ok: false,
      output: 'No workflow history is available to continue.',
    };
  }

  const mode = normalizeContinueWorkflowMode(options.mode);
  const instruction = String(options.instruction || '').trim();
  const request = instruction || 'Continue from the previous workflow.';
  const title = `continue · ${parent.title}`.slice(0, 180);
  const prompt = continuationWorkflowPrompt(parent, instruction);
  const target = {
    ...(parent.target || {}),
    parentWorkflowId: parent.id,
  };

  appendAudit('workflow.continue_requested', { parentWorkflowId: parent.id, mode, title });

  if (mode !== 'quick') {
    const workflow = createWorkflowRecord({
      kind: parent.kind || 'general',
      source: 'workflow_continue',
      status: 'queued',
      title,
      intent: 'continue',
      mode,
      request,
      result: '',
      parentWorkflowId: parent.id,
      target,
    });
    const job = createJob(prompt, mode === 'background' ? 'background' : mode, 'workflow_continue', { workflowId: workflow.id });
    setWorkflow(workflow.id, { jobId: job.id });
    const finalWorkflow = workflows.get(workflow.id);
    const routing = createRoutingRecordForWorkflow({
      task: request,
      workflow: finalWorkflow,
      job,
      mode,
      source: options.source || 'workflow_continue',
      scope: options.scope || `workflow_continue:${parent.kind || 'general'}`,
      parallelGroup: options.parallelGroup || options.group || `continue:${mode}`,
    });
    return {
      ok: true,
      queued: true,
      mode,
      parentWorkflow: parent,
      workflow: finalWorkflow,
      job,
      routing,
      output: `Queued continuation workflow ${workflow.id}.`,
    };
  }

  const workflow = createWorkflowRecord({
    kind: parent.kind || 'general',
    source: 'workflow_continue',
    status: 'running',
    title,
    intent: 'continue',
    mode,
    request,
    parentWorkflowId: parent.id,
    target,
  });
  const output = await callOpenAIResponsesWithFallback({
    model: models.fast,
    instructions:
      'You are the continuation lane inside JAVIS. Continue prior local workflow context. Be concise, practical, and state the next concrete step.',
    input: prompt,
    maxOutputTokens: 900,
  }, {
    source: 'workflow_continue',
    timeoutMs: 90000,
  });
  const finalWorkflow = setWorkflow(workflow.id, {
    status: OPENAI_API_KEY ? 'done' : 'blocked',
    result: output,
    completedAt: Date.now(),
  });
  const routing = createRoutingRecordForWorkflow({
    task: request,
    workflow: finalWorkflow,
    mode,
    source: options.source || 'workflow_continue',
    scope: options.scope || `workflow_continue:${parent.kind || 'general'}`,
    parallelGroup: options.parallelGroup || options.group || `continue:${mode}`,
    resultSummary: output,
  });
  return {
    ok: Boolean(OPENAI_API_KEY),
    queued: false,
    mode,
    parentWorkflow: parent,
    workflow: finalWorkflow,
    routing,
    output,
  };
}

function workflowClipboardText(workflow, format = 'result') {
  const result = String(workflow.result || '').trim();
  if (format === 'markdown') {
    return [
      `# ${workflow.title}`,
      '',
      `- Status: ${workflow.status}`,
      workflow.target?.path ? `- Path: ${workflow.target.path}` : '',
      workflow.target?.url ? `- URL: ${workflow.target.url}` : '',
      '',
      result || workflow.request || '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }
  return result;
}

async function copyWorkflowResult(options = {}) {
  const workflow = findWorkflowForAction(options.workflowId);
  if (!workflow) {
    return { ok: false, output: 'No workflow history is available to copy.' };
  }
  const format = String(options.format || 'result') === 'markdown' ? 'markdown' : 'result';
  const content = workflowClipboardText(workflow, format);
  if (!content.trim()) {
    return { ok: false, workflow, output: 'This workflow has no result to copy yet.' };
  }
  const output = await executeMacAction({ action: 'write_clipboard', content });
  appendAudit('workflow.copy_result', {
    id: workflow.id,
    format,
    bytes: Buffer.byteLength(content, 'utf8'),
  });
  return {
    ok: true,
    workflow,
    bytes: Buffer.byteLength(content, 'utf8'),
    output,
  };
}

function originalTaskForJob(job) {
  return String(job?.task || job?.command || job?.title || job?.result || '').trim();
}

function recoveryJobModeFor(job, action = {}) {
  const explicitMode = String(action.mode || '').trim();
  if (['background', 'codex', 'claude', 'cli'].includes(explicitMode)) return explicitMode;
  if (action.recoveryType === 'alternative_worker' && (job.mode === 'codex' || job.mode === 'claude')) {
    return codeAgentAlternativeMode(job.mode);
  }
  if (action.recoveryType === 'alternative_worker' && job.mode === 'background') {
    return preferredRecoveryWorkerMode() || 'background';
  }
  if (job.mode === 'codex' || job.mode === 'claude') return job.mode;
  return 'background';
}

function recoveryLogTail(job) {
  const parts = [
    job?.result ? `Result:\n${job.result}` : '',
    job?.log ? `Log:\n${job.log}` : '',
  ].filter(Boolean).join('\n\n');
  return trimText(parts, 12000);
}

function buildRecoveryJobPrompt(job, action = {}, attemptNumber = 1) {
  const attempts = normalizeJobAttempts(job.attempts)
    .map((attempt, index) => `${index + 1}. ${attempt.tool || job.mode}: ${attempt.status}${attempt.summary ? ` - ${compactRecordText(attempt.summary, 500)}` : ''}`)
    .join('\n') || 'No recorded attempts.';
  const originalTask = originalTaskForJob(job) || job.title || 'Recover the failed JAVIS job.';
  const failureKind = action.failureKind || job.failureKind || job.recoveryPlan?.failureKind || 'failed';
  const diagnostics = job.recoveryPlan?.diagnostics?.summary || '';
  return [
    'You are a recovery worker inside JAVIS.',
    'Do not stop at "this failed". Diagnose the failure, narrow the scope, try a practical fix or produce the exact next executable step.',
    'Keep the recovery focused. Prefer small verifiable changes or commands over broad rewrites. If a permission or tool is missing, say exactly what is missing and what JAVIS already tried.',
    '',
    `Recovery attempt: ${attemptNumber}/${MAX_RECOVERY_JOB_ATTEMPTS}`,
    `Original job: ${job.id}`,
    `Original mode: ${job.mode}`,
    `Failure kind: ${failureKind}`,
    `Recovery action: ${action.recoveryType || 'retry'} - ${action.label || 'Retry with narrower scope'}`,
    diagnostics ? `Diagnostics: ${compactRecordText(diagnostics, 800)}` : '',
    '',
    'Original task:',
    originalTask,
    '',
    'Previous attempts:',
    attempts,
    '',
    'Failure evidence:',
    recoveryLogTail(job) || '[no log captured]',
  ].filter((line) => line !== '').join('\n');
}

function queueRecoveryJob(job, action = {}, options = {}) {
  const children = recoveryChildJobs(job.id);
  const activeChild = children.find((child) => child.status === 'queued' || child.status === 'running');
  if (activeChild) {
    return {
      ok: true,
      queued: false,
      job: activeChild,
      output: `Recovery job is already active: ${activeChild.id} (${activeChild.mode}/${activeChild.status}).`,
    };
  }
  if (children.length >= MAX_RECOVERY_JOB_ATTEMPTS) {
    return {
      ok: false,
      queued: false,
      job: null,
      output: `Recovery retry limit reached for ${job.id}: ${children.length}/${MAX_RECOVERY_JOB_ATTEMPTS}.`,
    };
  }
  const mode = recoveryJobModeFor(job, action);
  const prompt = buildRecoveryJobPrompt(job, action, children.length + 1);
  const recoveryJob = createJob(prompt, mode, options.source || 'recovery', {
    title: `recover · ${job.title}`,
    parentJobId: job.id,
    recoveryForJobId: job.id,
    task: prompt,
    timeoutMs: Math.max(180000, Math.min(3600000, Number(job.timeoutMs || 180000))),
  });
  appendJobLog(job.id, `Recovery job queued via work_next: ${recoveryJob.id} (${mode}).`);
  appendAudit('job.recovery_queued', {
    id: job.id,
    recoveryJobId: recoveryJob.id,
    mode,
    recoveryType: action.recoveryType || '',
    attempt: children.length + 1,
  });
  return {
    ok: true,
    queued: true,
    job: recoveryJob,
    output: `Queued recovery job ${recoveryJob.id} in ${mode} mode for ${job.title}.`,
  };
}

function createJob(task, mode, source, metadata = {}) {
  const id = crypto.randomUUID();
  const job = {
    id,
    title: String(metadata.title || task).slice(0, 80),
    mode,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: 0,
    completedAt: 0,
    pid: null,
    source: source || '',
    workflowId: String(metadata.workflowId || ''),
    parentJobId: String(metadata.parentJobId || ''),
    recoveryForJobId: String(metadata.recoveryForJobId || ''),
    task: String(metadata.task || task).slice(0, 24000),
    command: String(metadata.command || (mode === 'cli' ? task : '')).slice(0, 4000),
    timeoutMs: Math.max(1000, Math.min(3600000, Number(metadata.timeoutMs || 180000))),
    cancelRequested: false,
    log: `Queued${source ? ` from ${source}` : ''}.`,
    result: '',
    attempts: [],
    failureKind: '',
    recoveryPlan: null,
  };
  jobs.set(id, job);
  persistJobs();
  appendAudit('job.created', { id, mode, source, title: job.title });
  recordActiveSessionEvent('job_created', `Queued ${mode}: ${compactRecordText(job.title, 120)}`, source || 'job', {
    kind: 'job',
    id: job.id,
    status: job.status,
  });
  processJob(job, task);
  return job;
}

function setJob(id, patch) {
  const existing = jobs.get(id);
  if (!existing) return;
  const next = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    log: patch.log === undefined ? existing.log : trimText(patch.log),
    result: patch.result === undefined ? existing.result : trimText(patch.result, 100000),
    attempts: patch.attempts === undefined ? existing.attempts || [] : normalizeJobAttempts(patch.attempts),
    failureKind: patch.failureKind === undefined ? existing.failureKind || '' : String(patch.failureKind || '').slice(0, 80),
    recoveryPlan: patch.recoveryPlan === undefined ? existing.recoveryPlan || null : normalizeRecoveryPlan(patch.recoveryPlan),
  };
  jobs.set(id, next);
  persistJobs();
  updateRoutingRecordsForJob(next);
  if (patch.status) {
    appendAudit('job.status', {
      id,
      mode: next.mode,
      status: next.status,
      resultLength: next.result ? String(next.result).length : 0,
    });
  }
}

function appendJobLog(id, chunk) {
  const existing = jobs.get(id);
  if (!existing) return;
  const text = String(chunk || '').replace(/\r/g, '');
  if (!text.trim()) return;
  setJob(id, {
    log: trimText(`${existing.log || ''}\n${text}`.trim()),
  });
}

function finishJob(id, status, patch = {}) {
  setJob(id, {
    ...patch,
    status,
    completedAt: Date.now(),
    pid: null,
    cancelRequested: false,
  });
  const job = jobs.get(id);
  if (job?.workflowId) {
    setWorkflow(job.workflowId, {
      status: workflowStatusFromJob(status, job.result),
      result: job.result || patch.result || '',
      completedAt: Date.now(),
    });
  }
  if (status === 'done' && job?.recoveryForJobId) {
    const parent = jobs.get(job.recoveryForJobId);
    if (parent?.status === 'failed') {
      const recoveryResult = [
        parent.result || '',
        `Recovered by ${job.mode} job ${job.id}.`,
        job.result || patch.result || '',
      ].filter(Boolean).join('\n\n');
      setJob(parent.id, {
        status: 'done',
        completedAt: Date.now(),
        failureKind: '',
        result: recoveryResult,
        log: `${parent.log || ''}\nRecovered by ${job.id}.`,
      });
      if (parent.workflowId) {
        setWorkflow(parent.workflowId, {
          status: 'done',
          result: recoveryResult,
          completedAt: Date.now(),
        });
      }
      appendAudit('job.recovery_completed', {
        id: parent.id,
        recoveryJobId: job.id,
        mode: job.mode,
      });
    }
  }
  if (job) {
    recordActiveSessionEvent('job_status', `Job ${status}: ${compactRecordText(job.title, 120)}`, job.source || 'job', {
      kind: 'job',
      id: job.id,
      status,
    });
    const titles = {
      done: 'JAVIS task finished',
      failed: 'JAVIS task failed',
      cancelled: 'JAVIS task cancelled',
    };
    notifyResident(titles[status] || 'JAVIS task updated', `${job.title}: ${job.result || patch.result || status}`, {
      type: 'job',
      id: job.id,
      mode: job.mode,
      status,
      workflowId: job.workflowId || '',
    });
  }
}

function storageWriteCheck(dirPath) {
  const filePath = path.join(dirPath, `.javis-write-check-${process.pid}`);
  try {
    fs.writeFileSync(filePath, 'ok', 'utf8');
    fs.unlinkSync(filePath);
    return { ok: true, error: '' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function mediaAccessStatus(kind) {
  try {
    if (typeof systemPreferences?.getMediaAccessStatus !== 'function') return 'unknown';
    return systemPreferences.getMediaAccessStatus(kind);
  } catch {
    return 'unknown';
  }
}

function readinessItem(id, label, status, summary, next = '') {
  return { id, label, status, summary, next };
}

function readinessSnapshot() {
  const counts = queueCounts();
  const storageCheck = storageWriteCheck(DATA_DIR);
  const accessibilityTrusted =
    typeof systemPreferences?.isTrustedAccessibilityClient === 'function'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : null;
  const microphoneStatus = mediaAccessStatus('microphone');
  const screenStatus = mediaAccessStatus('screen');
  const pendingApprovals = pendingApprovalSnapshot(20);
  const writeFileRoots = actionPolicy.allow?.write_file?.allowedRoots || [];
  const writeFileLimited = writeFileRoots.length > 0 && !writeFileRoots.includes('*');
  const trustedLevel3Mode =
    TRUSTED_LOCAL_MODE &&
    LOCAL_EXEC_ENABLED &&
    actionPolicy.maxAutoRiskLevel >= 3 &&
    actionPolicy.requireApprovalAtRiskLevel >= 4;
  const trustedFileMode = trustedLevel3Mode && writeFileLimited;
  const guardedPolicyReady =
    actionPolicy.maxAutoRiskLevel <= 2 &&
    actionPolicy.requireApprovalAtRiskLevel <= 3 &&
    writeFileLimited;
  const fileRoots = Array.from(
    new Set(
      [
        ...(actionPolicy.allow?.list_directory?.allowedRoots || []),
        ...(actionPolicy.allow?.read_file?.allowedRoots || []),
        ...(actionPolicy.allow?.search_files?.allowedRoots || []),
        ...writeFileRoots,
        ...(actionPolicy.allow?.create_directory?.allowedRoots || []),
        ...(actionPolicy.allow?.copy_file?.allowedRoots || []),
      ...(actionPolicy.allow?.move_file?.allowedRoots || []),
    ].map(String),
    ),
  );
  const missingRoots = fileRoots
    .map((root) => resolvePath(root))
    .filter((root) => !fs.existsSync(root));
  const memoryStoreCheck = storageWriteCheck(DATA_DIR);

  const items = [
    readinessItem(
      'openai_key',
      'OpenAI key',
      OPENAI_API_KEY ? 'ready' : 'blocked',
      OPENAI_API_KEY ? 'Configured for realtime and model lanes.' : 'Missing OPENAI_API_KEY; voice/model lanes cannot connect.',
      OPENAI_API_KEY ? '' : 'Add OPENAI_API_KEY to .env and restart JAVIS.',
    ),
    readinessItem(
      'runtime_storage',
      'Runtime storage',
      storageCheck.ok ? 'ready' : 'blocked',
      storageCheck.ok ? `Writable runtime directory: ${DATA_DIR}` : `Runtime directory is not writable: ${storageCheck.error}`,
      storageCheck.ok ? '' : 'Fix directory permissions or set JAVIS_DATA_DIR.',
    ),
    readinessItem(
      'microphone_permission',
      'Microphone',
      microphoneStatus === 'granted' || microphoneStatus === 'unknown'
        ? 'ready'
        : microphoneStatus === 'denied' || microphoneStatus === 'restricted'
          ? 'blocked'
          : 'warning',
      `macOS microphone permission: ${microphoneStatus}.`,
      microphoneStatus === 'denied' || microphoneStatus === 'restricted'
        ? 'Allow microphone access in System Settings.'
        : microphoneStatus === 'not-determined'
          ? 'Start voice once and approve microphone access.'
        : '',
    ),
    readinessItem(
      'screen_permission',
      'Screen capture',
      latestScreen
        ? 'ready'
        : screenStatus === 'denied' || screenStatus === 'restricted'
          ? 'blocked'
          : 'warning',
      latestScreen
        ? `Latest screen frame received ${Math.round((Date.now() - latestScreen.updatedAt) / 1000)}s ago.`
        : `macOS screen permission: ${screenStatus}; no frame shared in this session.`,
      latestScreen
        ? ''
        : screenStatus === 'denied' || screenStatus === 'restricted'
          ? 'Allow screen recording for JAVIS/Electron in System Settings > Privacy & Security > Screen & System Audio Recording.'
          : 'Start screen sharing from voice/CUI controls and approve the macOS prompt.',
    ),
    readinessItem(
      'accessibility_permission',
      'Accessibility',
      accessibilityTrusted ? 'ready' : 'warning',
      accessibilityTrusted
        ? 'Accessibility permission is available for foreground app context and UI actions.'
        : 'Accessibility is not trusted; frontmost window, typing, and hotkeys may be limited.',
      accessibilityTrusted ? '' : 'Allow JAVIS/Electron in System Settings > Privacy & Security > Accessibility.',
    ),
    readinessItem(
      'local_execution',
      'Local execution',
      LOCAL_EXEC_ENABLED ? 'ready' : 'warning',
      LOCAL_EXEC_ENABLED
        ? 'Level 3 local execution is enabled for code agents and high-permission actions.'
        : 'Level 3 local execution is disabled; Codex/Claude delegation and typing/hotkeys stay preview-only or blocked.',
      LOCAL_EXEC_ENABLED ? '' : 'Set JAVIS_ENABLE_LOCAL_EXEC=true only when you want local workers/actions enabled.',
    ),
    readinessItem(
      'api_auth',
      'Local API auth',
      API_AUTH_ENABLED && Boolean(apiToken) ? 'ready' : TRUSTED_LOCAL_MODE ? 'warning' : 'ready',
      API_AUTH_ENABLED && Boolean(apiToken)
        ? 'Local API calls require the runtime token header.'
        : 'Local API token protection is disabled.',
      API_AUTH_ENABLED && Boolean(apiToken)
        ? ''
        : 'Leave JAVIS_API_AUTH enabled when trusted local mode is on.',
    ),
    readinessItem(
      'global_hotkey',
      'Global hotkey',
      toggleHotkeyRegistered ? 'ready' : 'warning',
      toggleHotkeyRegistered
        ? `Global pet park hotkey is registered: ${TOGGLE_HOTKEY}.`
        : `Global pet park hotkey is not registered: ${TOGGLE_HOTKEY}.`,
      toggleHotkeyRegistered ? '' : 'Choose a different JAVIS_TOGGLE_HOTKEY or free the shortcut in macOS.',
    ),
    readinessItem(
      'capture_hotkey',
      'Capture hotkey',
      !CAPTURE_HOTKEY || captureHotkeyRegistered ? 'ready' : 'warning',
      CAPTURE_HOTKEY
        ? captureHotkeyRegistered
          ? `Clipboard-to-Inbox hotkey is registered: ${CAPTURE_HOTKEY}.`
          : `Clipboard-to-Inbox hotkey is not registered: ${CAPTURE_HOTKEY}.`
        : 'Clipboard-to-Inbox hotkey is disabled.',
      !CAPTURE_HOTKEY || captureHotkeyRegistered ? '' : 'Choose a different JAVIS_CAPTURE_HOTKEY or free the shortcut in macOS.',
    ),
    readinessItem(
      'menu_bar',
      'Menu bar',
      menuBarAvailable() ? 'ready' : 'warning',
      menuBarAvailable()
        ? 'Menu bar status item is available for resident controls.'
        : 'Menu bar status item is not available.',
      menuBarAvailable() ? '' : 'Restart JAVIS and check macOS menu bar status item permissions.',
    ),
    readinessItem(
      'notifications',
      'Notifications',
      NOTIFICATIONS_ENABLED && notificationSupported() ? 'ready' : 'warning',
      !NOTIFICATIONS_ENABLED
        ? 'Resident notifications are disabled by JAVIS_NOTIFICATIONS=false.'
        : notificationSupported()
          ? 'Resident notifications are available for approvals and job completion.'
          : 'Resident notifications are not supported in this Electron session.',
      !NOTIFICATIONS_ENABLED
        ? 'Remove JAVIS_NOTIFICATIONS=false if you want system notifications.'
        : notificationSupported()
          ? ''
          : 'Check macOS notification settings for JAVIS/Electron.',
    ),
    readinessItem(
      'action_policy',
      'Action policy',
      guardedPolicyReady || trustedFileMode
        ? 'ready'
        : 'warning',
      trustedFileMode
        ? `Trusted local mode: auto Level ${actionPolicy.maxAutoRiskLevel}; approval at Level ${actionPolicy.requireApprovalAtRiskLevel}; write roots ${writeFileRoots.length}.`
        : `Auto risk <= ${actionPolicy.maxAutoRiskLevel}; approval at ${actionPolicy.requireApprovalAtRiskLevel}; write roots ${writeFileRoots.length}.`,
      guardedPolicyReady || trustedFileMode
        ? ''
        : TRUSTED_LOCAL_MODE
          ? 'Align local execution, Level 3 auto-run, Level 4 approval, and scoped write roots.'
          : 'Review /api/actions/policy before enabling more autonomy.',
    ),
    readinessItem(
      'file_roots',
      'File roots',
      missingRoots.length === 0 ? 'ready' : 'warning',
      missingRoots.length === 0
        ? `${fileRoots.length} allowed file roots are present.`
        : `${missingRoots.length} allowed file roots are missing.`,
      missingRoots.length === 0 ? '' : 'Update action-policy.json or recreate missing folders.',
    ),
    readinessItem(
      'memory_store',
      'Local memory',
      memoryStoreCheck.ok ? 'ready' : 'blocked',
      memoryStoreCheck.ok ? `${memories.size} local memory record(s) stored.` : `Memory store is not writable: ${memoryStoreCheck.error}`,
      memoryStoreCheck.ok ? '' : 'Fix runtime storage permissions before using memory.',
    ),
    readinessItem(
      'learning_profile',
      'Local learning',
      !AMBIENT_LEARNING_ENABLED || memoryStoreCheck.ok ? 'ready' : 'blocked',
      AMBIENT_LEARNING_ENABLED
        ? `Ambient learning is enabled with ${learningStateSnapshot().profile.sourceEventCount} distilled observation(s).`
        : 'Ambient learning is off.',
      AMBIENT_LEARNING_ENABLED && !memoryStoreCheck.ok ? 'Fix runtime storage permissions before using ambient learning.' : '',
    ),
    readinessItem(
      'clipboard_policy',
      'Clipboard',
      actionPolicy.allow?.read_clipboard?.enabled && actionPolicy.allow?.write_clipboard?.enabled
        ? 'ready'
        : 'warning',
      actionPolicy.allow?.read_clipboard?.enabled && actionPolicy.allow?.write_clipboard?.enabled
        ? 'Clipboard read/write actions are enabled through policy and audit.'
        : 'Some clipboard actions are disabled by policy.',
      '',
    ),
    readinessItem(
      'accessibility_tree_policy',
      'Accessibility tree',
      actionPolicy.allow?.read_accessibility_tree?.enabled ? 'ready' : 'warning',
      actionPolicy.allow?.read_accessibility_tree?.enabled
        ? `UI tree reader enabled up to ${actionPolicy.allow.read_accessibility_tree.maxNodes} nodes and depth ${actionPolicy.allow.read_accessibility_tree.maxDepth}.`
        : 'Accessibility UI tree reader is disabled by policy.',
      actionPolicy.allow?.read_accessibility_tree?.enabled ? '' : 'Enable allow.read_accessibility_tree in action-policy.json.',
    ),
    readinessItem(
      'browser_page_policy',
      'Browser page reader',
      actionPolicy.allow?.read_browser_page?.enabled ? 'ready' : 'warning',
      actionPolicy.allow?.read_browser_page?.enabled
        ? `Browser page reader enabled up to ${actionPolicy.allow.read_browser_page.maxChars} characters.`
        : 'Browser page reader is disabled by policy.',
      actionPolicy.allow?.read_browser_page?.enabled ? '' : 'Enable allow.read_browser_page in action-policy.json.',
    ),
    readinessItem(
      'browser_control_policy',
      'Browser control',
      actionPolicy.allow?.browser_control?.enabled ? 'ready' : 'warning',
      actionPolicy.allow?.browser_control?.enabled
        ? `Browser control enabled for ${(actionPolicy.allow.browser_control.allowedActions || []).length} action(s).`
        : 'Browser control is disabled by policy.',
      actionPolicy.allow?.browser_control?.enabled ? '' : 'Enable allow.browser_control in action-policy.json.',
    ),
    readinessItem(
      'cli_command_policy',
      'CLI tools',
      actionPolicy.allow?.cli_command?.enabled && LOCAL_EXEC_ENABLED ? 'ready' : 'warning',
      actionPolicy.allow?.cli_command?.enabled
        ? LOCAL_EXEC_ENABLED
          ? `CLI tool runner enabled for ${(actionPolicy.allow.cli_command.allowedCommands || []).join(', ')}.`
          : 'CLI tool runner is enabled by policy but local execution is disabled.'
        : 'CLI tool runner is disabled by policy.',
      actionPolicy.allow?.cli_command?.enabled
        ? LOCAL_EXEC_ENABLED ? '' : 'Set JAVIS_ENABLE_LOCAL_EXEC=true to let JAVIS launch CLI tools.'
        : 'Enable allow.cli_command in action-policy.json.',
    ),
    readinessItem(
      'approvals',
      'Approvals',
      pendingApprovals.length ? 'warning' : 'ready',
      pendingApprovals.length ? `${pendingApprovals.length} local action approval(s) pending.` : 'No pending approvals.',
      pendingApprovals.length ? 'Review approvals in the terminal CUI or /api/approvals.' : '',
    ),
    readinessItem(
      'queue',
      'Task queue',
      counts.running || counts.queued ? 'warning' : 'ready',
      counts.running || counts.queued
        ? `${counts.running} running and ${counts.queued} queued task(s).`
        : 'No active background tasks.',
      counts.running || counts.queued ? 'Inspect /api/jobs or the terminal CUI.' : '',
    ),
  ];

  const blocked = items.filter((item) => item.status === 'blocked').length;
  const warnings = items.filter((item) => item.status === 'warning').length;
  const overall = blocked ? 'blocked' : warnings ? 'degraded' : 'ready';
  const primaryIssue = items.find((item) => item.status === 'blocked') || items.find((item) => item.status === 'warning') || null;

  return {
    overall,
    label: overall === 'ready' ? 'Ready' : overall === 'blocked' ? 'Setup blocked' : 'Needs attention',
    summary: primaryIssue ? primaryIssue.summary : 'All readiness checks passed.',
    counts: {
      ready: items.filter((item) => item.status === 'ready').length,
      warning: warnings,
      blocked,
      total: items.length,
    },
    primaryIssue,
    items,
    generatedAt: new Date().toISOString(),
  };
}

function checkItem(id, label, status, summary, next = '') {
  return { id, label, status, summary, next };
}

function configCheckSnapshot() {
  const readiness = readinessSnapshot();
  const envFile = path.join(process.cwd(), '.env');
  const envExampleFile = path.join(process.cwd(), '.env.example');
  const launchAgentInstalled = fs.existsSync(LAUNCH_AGENT_FILE);
  const codexCommand = process.env.JAVIS_CODEX_CMD || 'codex exec';
  const claudeCommand = process.env.JAVIS_CLAUDE_CMD || 'claude -p';
  const workerItems = [
    checkItem(
      'codex_command',
      'Codex worker',
      commandExists(codexCommand) ? 'ready' : 'warning',
      commandExists(codexCommand) ? `Command available: ${codexCommand}` : `Command not found on PATH: ${codexCommand}`,
      commandExists(codexCommand) ? '' : 'Install Codex CLI or set JAVIS_CODEX_CMD.',
    ),
    checkItem(
      'claude_command',
      'Claude worker',
      commandExists(claudeCommand) ? 'ready' : 'warning',
      commandExists(claudeCommand) ? `Command available: ${claudeCommand}` : `Command not found on PATH: ${claudeCommand}`,
      commandExists(claudeCommand) ? '' : 'Install Claude Code or set JAVIS_CLAUDE_CMD.',
    ),
  ];
  const localItems = [
    checkItem(
      'env_file',
      '.env file',
      fs.existsSync(envFile) ? 'ready' : 'blocked',
      fs.existsSync(envFile) ? '.env exists in the project root.' : '.env is missing in the project root.',
      fs.existsSync(envFile) ? '' : 'Copy .env.example to .env and add OPENAI_API_KEY.',
    ),
    checkItem(
      'env_example',
      '.env example',
      fs.existsSync(envExampleFile) ? 'ready' : 'warning',
      fs.existsSync(envExampleFile) ? '.env.example is available for setup.' : '.env.example is missing.',
      fs.existsSync(envExampleFile) ? '' : 'Add .env.example so setup can be repeated safely.',
    ),
    checkItem(
      'launch_agent',
      'Login start',
      launchAgentInstalled ? 'ready' : 'warning',
      launchAgentInstalled ? `LaunchAgent installed: ${LAUNCH_AGENT_FILE}` : 'LaunchAgent is not installed yet.',
      launchAgentInstalled ? '' : 'Run npm run resident:install when you want JAVIS to start at login.',
    ),
    checkItem(
      'action_policy_file',
      'Action policy file',
      fs.existsSync(ACTION_POLICY_FILE) ? 'ready' : 'blocked',
      fs.existsSync(ACTION_POLICY_FILE) ? `Policy file: ${ACTION_POLICY_FILE}` : 'Action policy file is missing.',
      fs.existsSync(ACTION_POLICY_FILE) ? '' : 'Restart JAVIS so the default policy can be created.',
    ),
  ];
  const items = [...readiness.items, ...localItems, ...workerItems];
  const blocked = items.filter((item) => item.status === 'blocked').length;
  const warnings = items.filter((item) => item.status === 'warning').length;
  const primaryIssue = items.find((item) => item.status === 'blocked') || items.find((item) => item.status === 'warning') || null;

  return {
    overall: blocked ? 'blocked' : warnings ? 'degraded' : 'ready',
    summary: primaryIssue ? primaryIssue.summary : 'Configuration is ready for resident use.',
    generatedAt: new Date().toISOString(),
    counts: {
      ready: items.filter((item) => item.status === 'ready').length,
      warning: warnings,
      blocked,
      total: items.length,
    },
    primaryIssue,
    items,
    files: {
      envFile,
      envExampleFile,
      dataDir: DATA_DIR,
      actionPolicyFile: ACTION_POLICY_FILE,
      approvalsFile: APPROVALS_FILE,
      memoriesFile: MEMORIES_FILE,
      inboxFile: INBOX_FILE,
      sessionsFile: SESSIONS_FILE,
      screenPrivacyFile: SCREEN_PRIVACY_FILE,
      ambientFile: AMBIENT_FILE,
      learningFile: LEARNING_FILE,
      jobsFile: JOBS_FILE,
      workflowsFile: WORKFLOWS_FILE,
      auditFile: AUDIT_FILE,
      launchAgentFile: LAUNCH_AGENT_FILE,
    },
    runtime: {
      apiBase: API_BASE,
      apiAuth: apiAuthSnapshot(),
      localExecutionEnabled: LOCAL_EXEC_ENABLED,
      trustedLocalMode: TRUSTED_LOCAL_MODE,
      dryRun: actionPolicy.dryRun,
      maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
      requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
      launchAgentInstalled,
      window: windowStateSnapshot(),
      menuBar: menuBarSnapshot(),
      notifications: notificationSnapshot(),
      screenPrivacy: screenPrivacySnapshot(),
      ambient: ambientStateSnapshot(5),
      learning: learningStateSnapshot(),
      autopilot: autopilotStateSnapshot(),
      wake: wakeStatusSnapshot(),
      speech: speechStateSnapshot(),
    },
    models,
    workers: {
      codex: {
        command: codexCommand,
        available: commandExists(codexCommand),
      },
      claude: {
        command: claudeCommand,
        available: commandExists(claudeCommand),
      },
    },
  };
}

function healthSnapshot() {
  const counts = queueCounts();
  const readiness = readinessSnapshot();
  return {
    ok: true,
    status: readiness.overall === 'blocked' ? 'needs_configuration' : readiness.overall,
    version: packageInfo.version,
    pid: process.pid,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
    api: {
      baseUrl: API_BASE,
      port: API_PORT,
      auth: apiAuthSnapshot(),
      hasOpenAiKey: Boolean(OPENAI_API_KEY),
      localExecutionEnabled: LOCAL_EXEC_ENABLED,
      trustedLocalMode: TRUSTED_LOCAL_MODE,
    },
    models,
    storage: {
      dataDir: DATA_DIR,
      jobsFile: JOBS_FILE,
      workflowsFile: WORKFLOWS_FILE,
      routingFile: ROUTING_FILE,
      auditFile: AUDIT_FILE,
      actionPolicyFile: ACTION_POLICY_FILE,
      approvalsFile: APPROVALS_FILE,
      memoriesFile: MEMORIES_FILE,
      inboxFile: INBOX_FILE,
      sessionsFile: SESSIONS_FILE,
      screenPrivacyFile: SCREEN_PRIVACY_FILE,
      ambientFile: AMBIENT_FILE,
      learningFile: LEARNING_FILE,
      persistedJobs: jobs.size,
      persistedWorkflows: workflows.size,
      persistedRoutingRecords: routingRecords.size,
      persistedApprovals: approvals.size,
      persistedMemories: memories.size,
      persistedInboxItems: inboxItems.size,
      persistedSessions: workSessions.size,
      persistedAmbientEvents: ambientEvents.length,
      persistedLearningEvents: learningStateSnapshot().profile.sourceEventCount,
      maxPersistedJobs: MAX_PERSISTED_JOBS,
      maxPersistedWorkflows: MAX_PERSISTED_WORKFLOWS,
      maxPersistedRouting: MAX_PERSISTED_ROUTING,
      maxPersistedMemories: MAX_PERSISTED_MEMORIES,
      maxPersistedInboxItems: MAX_PERSISTED_INBOX,
      maxPersistedSessions: MAX_PERSISTED_SESSIONS,
      maxPersistedAmbientEvents: MAX_PERSISTED_AMBIENT,
      maxLearningSourceEvents: MAX_LEARNING_SOURCE_EVENTS,
    },
    actionPolicy: {
      dryRun: actionPolicy.dryRun,
      maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
      requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
      allow: actionPolicy.allow,
    },
    window: windowStateSnapshot(),
    menuBar: menuBarSnapshot(),
    notifications: notificationSnapshot(),
    screenPrivacy: screenPrivacySnapshot(),
    ambient: ambientStateSnapshot(5),
    learning: learningStateSnapshot(),
    wake: wakeStatusSnapshot(),
    speech: speechStateSnapshot(),
    approvals: {
      pending: pendingApprovalSnapshot(20),
      total: approvals.size,
    },
    queue: counts,
    workflows: workflowCounts(),
    routing: routingCounts(),
    activeJobs: Array.from(activeJobRuns.keys()),
    readiness: {
      overall: readiness.overall,
      counts: readiness.counts,
      primaryIssue: readiness.primaryIssue,
    },
    screen: latestScreenSnapshot(),
  };
}

function doctorCheck(id, label, status, summary, evidence = {}, next = '') {
  return { id, label, status, summary, evidence, next };
}

function doctorCounts(checks) {
  return {
    ready: checks.filter((check) => check.status === 'ready').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    blocked: checks.filter((check) => check.status === 'blocked').length,
    total: checks.length,
  };
}

function doctorOverall(checks) {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked';
  if (checks.some((check) => check.status === 'warning')) return 'degraded';
  return 'ready';
}

function findReadinessItem(readiness, id) {
  return readiness.items.find((item) => item.id === id) || null;
}

function previewDoctorAction(args) {
  try {
    const plan = buildLocalActionPlan(args);
    const evaluation = evaluateMacActionPlan(plan, { preview: true });
    return {
      ok: true,
      plan: {
        action: plan.action,
        riskLevel: plan.riskLevel,
        summary: plan.summary,
        target: plan.target,
      },
      evaluation,
      error: '',
    };
  } catch (error) {
    return {
      ok: false,
      plan: null,
      evaluation: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function realtimeBrowserWorkflowToolSnapshot() {
  try {
    const config = createRealtimeSessionConfig();
    const tool = (config.tools || []).find((item) => item.name === 'run_browser_workflow') || null;
    const properties = tool?.parameters?.properties || {};
    const intents = Array.isArray(properties.intent?.enum) ? properties.intent.enum : [];
    const requiredIntents = ['review_result', 'research'];
    const requiredParams = ['url', 'urls', 'maxPages', 'resultIndex', 'openWaitMs'];
    const missingIntents = requiredIntents.filter((intent) => !intents.includes(intent));
    const missingParams = requiredParams.filter((param) => !Object.prototype.hasOwnProperty.call(properties, param));
    return {
      ok: Boolean(tool) && missingIntents.length === 0 && missingParams.length === 0,
      exists: Boolean(tool),
      intents,
      missingIntents,
      missingParams,
      description: tool?.description || '',
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      intents: [],
      missingIntents: ['review_result', 'research'],
      missingParams: ['url', 'urls', 'maxPages', 'resultIndex', 'openWaitMs'],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function doctorReportSnapshot() {
  const health = healthSnapshot();
  const readiness = readinessSnapshot();
  const config = configCheckSnapshot();
  const resident = await residentStatusSnapshot();
  const readFilePreview = previewDoctorAction({ action: 'list_directory', path: '.', maxEntries: 1 });
  const fileMutationPreview = previewDoctorAction({ action: 'create_directory', path: '.javis-doctor-preview' });
  const clipboardPreview = previewDoctorAction({ action: 'read_clipboard' });
  const routerPreview = {
    quick: routeTaskDecision('现在几点了？'),
    background: routeTaskDecision('帮我分析这个项目的下一步计划并给出执行清单'),
    codex: routeTaskDecision('修复这个 React bug 并跑测试'),
  };
  const localCommandPreview = await routeTask({ message: '状态', execute: true });
  const parallelPreview = await routeParallelTasks({
    execute: false,
    source: 'doctor',
    parallelGroup: 'doctor:parallel-preview',
    tasks: [
      { task: 'Read-only inspect current resident status.', mode: 'background', scope: 'doctor:status-inspection', owner: 'background' },
      { command: 'echo doctor-parallel-preview', title: 'doctor parallel cli preview', scope: 'doctor:cli-preview', owner: 'local' },
    ],
  });
  const browserJavaScriptPreview = await browserJavaScriptStatusSnapshot();
  const realtimeBrowserToolPreview = realtimeBrowserWorkflowToolSnapshot();
  const briefingPreview = workflowBriefing({ workflowLimit: 3, jobLimit: 3 });
  const workNextPreview = await workNextAction({ execute: false, source: 'doctor' });
  const setupGuidePreview = setupGuideSnapshot();
  const axPressPreview = previewDoctorAction({
    action: 'ax_press',
    nodeId: '1',
    expectedRole: 'AXButton',
    expectedLabel: 'Doctor',
    maxNodes: 100,
    maxDepth: 6,
  });
  const workflowCountsSnapshot = workflowCounts();
  const queueCountsSnapshot = queueCounts();
  const inboxCountsSnapshot = inboxCounts();
  const sessionCountsSnapshot = sessionCounts();
  const readinessById = (id) => findReadinessItem(readiness, id);
  const checks = [];

  checks.push(doctorCheck(
    'server_health',
    'Resident API',
    'ready',
    `API is responding on ${API_BASE}.`,
    { pid: process.pid, uptimeSeconds: health.uptimeSeconds, version: packageInfo.version },
  ));

  for (const id of [
    'openai_key',
    'runtime_storage',
    'microphone_permission',
    'screen_permission',
    'accessibility_permission',
    'local_execution',
    'api_auth',
    'global_hotkey',
    'capture_hotkey',
    'menu_bar',
    'notifications',
    'action_policy',
    'memory_store',
    'clipboard_policy',
    'accessibility_tree_policy',
    'browser_page_policy',
    'browser_control_policy',
    'cli_command_policy',
  ]) {
    const item = readinessById(id);
    if (item) checks.push(doctorCheck(id, item.label, item.status, item.summary, {}, item.next));
  }

  checks.push(doctorCheck(
    'browser_javascript_events',
    'Browser DOM bridge',
    browserJavaScriptPreview.available && browserJavaScriptPreview.supported
      ? browserJavaScriptPreview.enabled ? 'ready' : 'warning'
      : 'ready',
    browserJavaScriptPreview.available && browserJavaScriptPreview.supported
      ? browserJavaScriptPreview.enabled
        ? `Browser DOM JavaScript bridge is enabled for ${browserJavaScriptPreview.app}.`
        : `Browser DOM JavaScript bridge is disabled for ${browserJavaScriptPreview.app}: ${browserJavaScriptPreview.error}.`
      : 'No supported frontmost browser page is available; DOM bridge check skipped.',
    browserJavaScriptPreview,
    browserJavaScriptPreview.available && browserJavaScriptPreview.supported && !browserJavaScriptPreview.enabled
      ? 'Enable Chrome 显示 > 开发者 > 允许 Apple 事件中的 JavaScript, or restart Chrome with local remote debugging on JAVIS_CHROME_DEBUG_PORT.'
      : '',
  ));

  checks.push(doctorCheck(
    'realtime_browser_workflow_tool',
    'Realtime browser workflow tool',
    realtimeBrowserToolPreview.ok ? 'ready' : 'warning',
    realtimeBrowserToolPreview.ok
      ? `Realtime tool exposes browser intents: ${realtimeBrowserToolPreview.intents.join(', ')}.`
      : `Realtime browser workflow tool is missing ${[
        ...realtimeBrowserToolPreview.missingIntents.map((item) => `intent:${item}`),
        ...realtimeBrowserToolPreview.missingParams.map((item) => `param:${item}`),
      ].join(', ') || 'tool definition'}.`,
    realtimeBrowserToolPreview,
    realtimeBrowserToolPreview.ok ? '' : 'Update createRealtimeSessionConfig().tools for run_browser_workflow.',
  ));

  checks.push(doctorCheck(
    'resident_launch_agent',
    'LaunchAgent',
    resident.installed && resident.matchesProject ? (resident.loaded || resident.pid ? 'ready' : 'warning') : 'warning',
    resident.installed
      ? resident.loaded || resident.pid
        ? `LaunchAgent loaded${resident.pid ? ` with pid ${resident.pid}` : ''}.`
        : 'LaunchAgent is installed but not currently loaded.'
      : 'LaunchAgent is not installed.',
    {
      installed: resident.installed,
      loaded: resident.loaded,
      pid: resident.pid,
      matchesProject: resident.matchesProject,
      plistPath: resident.plistPath,
    },
    resident.installed ? '' : 'Run npm run resident:install.',
  ));

  checks.push(doctorCheck(
    'codex_worker',
    'Codex worker',
    config.workers.codex.available ? 'ready' : 'warning',
    config.workers.codex.available ? `Codex command available: ${config.workers.codex.command}` : `Codex command unavailable: ${config.workers.codex.command}`,
    config.workers.codex,
    config.workers.codex.available ? '' : 'Install Codex CLI or set JAVIS_CODEX_CMD.',
  ));

  checks.push(doctorCheck(
    'claude_worker',
    'Claude worker',
    config.workers.claude.available ? 'ready' : 'warning',
    config.workers.claude.available ? `Claude command available: ${config.workers.claude.command}` : `Claude command unavailable: ${config.workers.claude.command}`,
    config.workers.claude,
    config.workers.claude.available ? '' : 'Install Claude Code or set JAVIS_CLAUDE_CMD.',
  ));

  checks.push(doctorCheck(
    'file_action_preview',
    'File action preview',
    readFilePreview.ok ? 'ready' : 'blocked',
    readFilePreview.ok ? 'Read-only file action preview succeeds.' : `File action preview failed: ${readFilePreview.error}`,
    readFilePreview,
  ));

  const fileMutationGuardReady =
    fileMutationPreview.ok &&
    (
      fileMutationPreview.evaluation?.blocked === true ||
      fileMutationPreview.evaluation?.needsApproval === true ||
      actionPolicy.dryRun === true
    );
  const fileMutationTrustedReady =
    TRUSTED_LOCAL_MODE &&
    LOCAL_EXEC_ENABLED &&
    actionPolicy.maxAutoRiskLevel >= 3 &&
    actionPolicy.requireApprovalAtRiskLevel >= 4 &&
    fileMutationPreview.ok &&
    !fileMutationPreview.evaluation?.blocked &&
    !fileMutationPreview.evaluation?.needsApproval;
  checks.push(doctorCheck(
    'file_mutation_guard',
    'File mutation guard',
    fileMutationGuardReady || fileMutationTrustedReady ? 'ready' : fileMutationPreview.ok ? 'warning' : 'blocked',
    fileMutationGuardReady
      ? `File mutations are guarded by ${fileMutationPreview.evaluation?.reason || (actionPolicy.dryRun ? 'dry_run' : 'approval')}.`
      : fileMutationTrustedReady
        ? 'Trusted local mode accepts Level 3 file mutations under the configured allowed roots and audit log.'
      : fileMutationPreview.ok
        ? 'File mutation preview is not guarded by approval, dry-run, or local-execution blocking.'
        : `File mutation preview failed: ${fileMutationPreview.error}`,
    fileMutationPreview,
    fileMutationGuardReady || fileMutationTrustedReady ? '' : 'Review action-policy.json before enabling file organization actions.',
  ));

  checks.push(doctorCheck(
    'clipboard_action_preview',
    'Clipboard action preview',
    clipboardPreview.ok ? 'ready' : 'warning',
    clipboardPreview.ok ? 'Clipboard read preview succeeds.' : `Clipboard preview failed: ${clipboardPreview.error}`,
    clipboardPreview,
  ));

  const routerReady =
    routerPreview.quick.lane === 'quick' &&
    routerPreview.background.lane === 'background' &&
    routerPreview.codex.lane === 'codex';
  checks.push(doctorCheck(
    'task_router',
    'Task router',
    routerReady ? 'ready' : 'warning',
    routerReady
      ? 'Local task router maps quick, deep, and code tasks to separate lanes.'
      : 'Task router did not classify one or more doctor samples as expected.',
    routerPreview,
    routerReady ? '' : 'Review routeTaskDecision heuristics.',
  ));

  const routingLedgerPreview = localCommandPreview.routing || localCommandPreview.routeRecord || null;
  const routingLedgerMissing = missingRoutingLedgerFields(routingLedgerPreview);
  const routingLedgerReady = Boolean(
    routingLedgerPreview &&
    routingRecords.has(routingLedgerPreview.id) &&
    routingLedgerMissing.length === 0,
  );
  checks.push(doctorCheck(
    'routing_ledger',
    'Task routing ledger',
    routingLedgerReady ? 'ready' : 'warning',
    routingLedgerReady
      ? `Routing ledger records lane, owner, scope, parallel group, approval requirement, status, and result link.`
      : `Routing ledger record is missing: ${routingLedgerMissing.join(', ') || 'record not persisted'}.`,
    {
      record: routingLedgerPreview,
      missing: routingLedgerMissing,
    },
    routingLedgerReady ? '' : 'Review createRoutingRecord() and finalizeRouteResult().',
  ));

  const parallelReady =
    parallelPreview.ok &&
    parallelPreview.parallelGroup === 'doctor:parallel-preview' &&
    parallelPreview.results.length === 2 &&
    parallelPreview.routingLedger.every((entry) => entry.parallelGroup === 'doctor:parallel-preview' && entry.scope && entry.owner && entry.resultLink);
  checks.push(doctorCheck(
    'parallel_task_router',
    'Parallel task router',
    parallelReady ? 'ready' : 'warning',
    parallelReady
      ? `Parallel router grouped ${parallelPreview.results.length} task(s) with scoped owners and result links.`
      : 'Parallel router did not produce complete grouped routing records.',
    {
      parallelGroup: parallelPreview.parallelGroup,
      counts: parallelPreview.counts,
      routingLedger: parallelPreview.routingLedger,
    },
    parallelReady ? '' : 'Review routeParallelTasks().',
  ));

  const localCommandReady =
    localCommandPreview.ok &&
    localCommandPreview.localCommand?.intent === 'status' &&
    Boolean(localCommandPreview.output);
  checks.push(doctorCheck(
    'local_command_router',
    'Local command router',
    localCommandReady ? 'ready' : 'warning',
    localCommandReady
      ? 'No-model local commands can answer resident status.'
      : 'No-model local command route did not return resident status.',
    localCommandPreview,
    localCommandReady ? '' : 'Review localCommandDecision() and runLocalCommand().',
  ));

  const briefingReady = Boolean(briefingPreview.summary && Array.isArray(briefingPreview.nextActions) && briefingPreview.nextActions.length);
  checks.push(doctorCheck(
    'work_briefing',
    'Work briefing',
    briefingReady ? 'ready' : 'warning',
    briefingReady
      ? `Briefing generated ${briefingPreview.nextActions.length} next action(s).`
      : 'Work briefing did not produce next actions.',
    {
      summary: briefingPreview.summary,
      counts: briefingPreview.counts,
      nextActions: briefingPreview.nextActions,
    },
    briefingReady ? '' : 'Review workflowBriefing().',
  ));

  const workNextReady = Boolean(workNextPreview.action && workNextPreview.output);
  checks.push(doctorCheck(
    'work_next',
    'Work next',
    workNextReady ? 'ready' : 'warning',
    workNextReady
      ? `Work next selected ${workNextPreview.action.label}.`
      : 'Work next did not select a usable next action.',
    {
      action: workNextPreview.action,
      executed: workNextPreview.executed,
      output: compactRecordText(workNextPreview.output, 240),
    },
    workNextReady ? '' : 'Review workNextAction().',
  ));

  const setupGuideReady = Boolean(setupGuidePreview.output && Array.isArray(setupGuidePreview.steps));
  checks.push(doctorCheck(
    'setup_guide',
    'Setup guide',
    setupGuideReady ? 'ready' : 'warning',
    setupGuideReady
      ? `Setup guide tracks ${setupGuidePreview.steps.length} issue(s).`
      : 'Setup guide did not produce a usable setup plan.',
    {
      counts: setupGuidePreview.counts,
      nextStep: setupGuidePreview.nextStep,
    },
    setupGuideReady ? '' : 'Review setupGuideSnapshot().',
  ));

  checks.push(doctorCheck(
    'inbox_state',
    'Inbox',
    'ready',
    `${inboxCountsSnapshot.open} open inbox item(s), ${inboxCountsSnapshot.total} total.`,
    {
      counts: inboxCountsSnapshot,
      file: INBOX_FILE,
      open: inboxSnapshot(5, 'open'),
    },
  ));

  checks.push(doctorCheck(
    'session_state',
    'Work sessions',
    'ready',
    `${sessionCountsSnapshot.active} active session(s), ${sessionCountsSnapshot.total} total.`,
    {
      counts: sessionCountsSnapshot,
      file: SESSIONS_FILE,
      active: activeSessionSnapshot(),
      recent: sessionSnapshot(3),
    },
  ));

  const axGuardReady =
    axPressPreview.ok &&
    (
      axPressPreview.evaluation?.blocked === true ||
      axPressPreview.evaluation?.needsApproval === true ||
      actionPolicy.dryRun === true
    );
  const axTrustedReady =
    TRUSTED_LOCAL_MODE &&
    LOCAL_EXEC_ENABLED &&
    actionPolicy.maxAutoRiskLevel >= 3 &&
    actionPolicy.requireApprovalAtRiskLevel >= 4 &&
    axPressPreview.ok &&
    !axPressPreview.evaluation?.blocked &&
    !axPressPreview.evaluation?.needsApproval;
  checks.push(doctorCheck(
    'ax_action_guard',
    'AX action guard',
    axGuardReady || axTrustedReady ? 'ready' : axPressPreview.ok ? 'warning' : 'blocked',
    axGuardReady
      ? `AX press is guarded by ${axPressPreview.evaluation?.reason || (actionPolicy.dryRun ? 'dry_run' : 'approval')}.`
      : axTrustedReady
        ? 'Trusted local mode accepts Level 3 Accessibility actions through policy checks and audit logging.'
      : axPressPreview.ok
        ? 'AX press preview is not guarded by approval, dry-run, or local-execution blocking.'
        : `AX press preview failed: ${axPressPreview.error}`,
    axPressPreview,
    axGuardReady || axTrustedReady ? '' : 'Review action-policy.json before enabling UI automation.',
  ));

  checks.push(doctorCheck(
    'workflow_store',
    'Workflow store',
    'ready',
    `${workflowCountsSnapshot.total} persisted workflow(s).`,
    { counts: workflowCountsSnapshot, file: WORKFLOWS_FILE },
  ));

  checks.push(doctorCheck(
    'queue_state',
    'Task queue',
    queueCountsSnapshot.running || queueCountsSnapshot.queued ? 'warning' : 'ready',
    queueCountsSnapshot.running || queueCountsSnapshot.queued
      ? `${queueCountsSnapshot.running} running and ${queueCountsSnapshot.queued} queued job(s).`
      : 'No active queued/running jobs.',
    { counts: queueCountsSnapshot, activeJobs: Array.from(activeJobRuns.keys()) },
  ));

  const pendingApprovals = pendingApprovalSnapshot(20);
  checks.push(doctorCheck(
    'approvals_state',
    'Approval queue',
    pendingApprovals.length ? 'warning' : 'ready',
    pendingApprovals.length ? `${pendingApprovals.length} pending approval(s).` : 'No pending approvals.',
    { pending: pendingApprovals },
  ));

  const overall = doctorOverall(checks);
  return {
    ok: overall !== 'blocked',
    overall,
    label: overall === 'ready' ? 'Ready' : overall === 'blocked' ? 'Blocked' : 'Needs attention',
    summary: checks.find((check) => check.status === 'blocked')?.summary
      || checks.find((check) => check.status === 'warning')?.summary
      || 'All doctor checks passed.',
    counts: doctorCounts(checks),
    checks,
    generatedAt: new Date().toISOString(),
    health: {
      pid: health.pid,
      status: health.status,
      uptimeSeconds: health.uptimeSeconds,
      api: health.api,
      storage: health.storage,
    },
    readiness: {
      overall: readiness.overall,
      counts: readiness.counts,
      primaryIssue: readiness.primaryIssue,
    },
    resident,
    previews: {
      readFile: readFilePreview,
      fileMutation: fileMutationPreview,
      clipboard: clipboardPreview,
      router: routerPreview,
      briefing: {
        summary: briefingPreview.summary,
        counts: briefingPreview.counts,
        nextActions: briefingPreview.nextActions,
      },
      workNext: {
        action: workNextPreview.action,
        executed: workNextPreview.executed,
      },
      setupGuide: {
        counts: setupGuidePreview.counts,
        nextStep: setupGuidePreview.nextStep,
      },
      axPress: axPressPreview,
    },
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function redactCommandForLog(command) {
  return String(command || '')
    .replace(/(api[-_ ]?key|token|secret|password)=("[^"]*"|'[^']*'|[^\s]+)/gi, '$1=[redacted]')
    .slice(0, 500);
}

function shellCommandName(command) {
  let text = String(command || '').trim();
  if (!text) return '';
  text = text.replace(/^env\s+/i, '').trim();
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
    const match = text.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s*/);
    if (!match) break;
    text = text.slice(match[0].length).trim();
  }
  const match = text.match(/^("([^"]+)"|'([^']+)'|[^\s;&|()<>]+)/);
  const token = String(match?.[2] || match?.[3] || match?.[1] || '').trim();
  return path.basename(token);
}

function cliCommandPolicySnapshot(command, timeoutMs) {
  const config = actionPolicy.allow?.cli_command || {};
  const rawCommand = String(command || '').trim();
  const commandName = shellCommandName(rawCommand);
  const maxCommandLength = Number(config.maxCommandLength || DEFAULT_ACTION_POLICY.allow.cli_command.maxCommandLength);
  const maxTimeoutMs = Number(config.maxTimeoutMs || DEFAULT_ACTION_POLICY.allow.cli_command.maxTimeoutMs);
  const requestedTimeoutMs = Number(timeoutMs || 180000);
  const normalizedTimeoutMs = Math.max(1000, Math.min(maxTimeoutMs, requestedTimeoutMs));
  return {
    enabled: config.enabled !== false,
    command: rawCommand,
    commandName,
    commandLength: rawCommand.length,
    maxCommandLength,
    timeoutMs: normalizedTimeoutMs,
    maxTimeoutMs,
    allowedCommands: Array.isArray(config.allowedCommands) ? config.allowedCommands : [],
  };
}

function evaluateCliCommand(command, options = {}) {
  const snapshot = cliCommandPolicySnapshot(command, options.timeoutMs);
  if (!snapshot.enabled) throw new Error('CLI command execution is disabled by policy.');
  if (!LOCAL_EXEC_ENABLED) {
    throw new Error('CLI commands require JAVIS_ENABLE_LOCAL_EXEC=true.');
  }
  if (!snapshot.command) throw new Error('Missing CLI command.');
  if (!snapshot.commandName) throw new Error('Could not identify the CLI command name.');
  if (snapshot.commandLength > snapshot.maxCommandLength) {
    throw new Error(`CLI command exceeds maxCommandLength policy (${snapshot.commandLength} > ${snapshot.maxCommandLength}).`);
  }
  if (!valueMatchesAllowlist(snapshot.commandName, snapshot.allowedCommands)) {
    throw new Error(`CLI command ${snapshot.commandName} is not allowed by policy.`);
  }
  return snapshot;
}

function queueCliCommand(options = {}) {
  const command = String(options.command || '').trim();
  const evaluation = evaluateCliCommand(command, { timeoutMs: options.timeoutMs });
  const job = createJob(command, 'cli', String(options.source || 'api'), {
    title: String(options.title || command).slice(0, 120),
    command,
    timeoutMs: evaluation.timeoutMs,
  });
  appendAudit('cli_command.queued', {
    id: job.id,
    commandName: evaluation.commandName,
    source: String(options.source || 'api').slice(0, 80),
    timeoutMs: evaluation.timeoutMs,
  });
  return {
    ok: true,
    job,
    output: `Queued CLI job ${job.id}: ${job.title}`,
  };
}

function stopSpeechProcess(reason = 'stop') {
  if (!speechProcess) return false;
  try {
    speechProcess.kill('SIGTERM');
  } catch {
    // The speech process may have already exited.
  }
  appendAudit('speech.stop', { reason });
  speechProcess = null;
  return true;
}

function speechStateSnapshot() {
  return {
    available: process.platform === 'darwin',
    enabled: LOCAL_EXEC_ENABLED,
    speaking: Boolean(speechProcess?.pid),
    pid: speechProcess?.pid || null,
  };
}

function speechSay(options = {}) {
  const text = compactRecordText(options.text || options.output || options.message || '', 1200);
  if (!text) throw new Error('Missing speech text.');
  if (!LOCAL_EXEC_ENABLED) throw new Error('Local speech requires JAVIS_ENABLE_LOCAL_EXEC=true.');
  if (process.platform !== 'darwin') throw new Error('Local speech requires macOS /usr/bin/say.');
  stopSpeechProcess('replace');
  const args = ['-r', String(Math.max(120, Math.min(260, Number(options.rate || 190))))];
  const voice = String(options.voice || process.env.JAVIS_LOCAL_TTS_VOICE || '').trim();
  if (voice) args.push('-v', voice.slice(0, 80));
  args.push(text);
  const child = spawn('/usr/bin/say', args, {
    stdio: 'ignore',
    detached: false,
  });
  speechProcess = child;
  appendAudit('speech.say', {
    pid: child.pid || null,
    commandName: 'say',
    textLength: text.length,
    voice,
    rate: args[1],
    source: String(options.source || 'api').slice(0, 80),
  });
  child.on('close', (code, signal) => {
    if (speechProcess === child) speechProcess = null;
    appendAudit('speech.done', { pid: child.pid || null, code, signal });
  });
  child.on('error', (error) => {
    if (speechProcess === child) speechProcess = null;
    appendAudit('speech.failed', { error: error instanceof Error ? error.message : String(error) });
  });
  return {
    ok: true,
    speaking: true,
    pid: child.pid || null,
    text,
  };
}

function stopJobRun(run, signal = 'SIGTERM') {
  if (!run?.child?.pid) return;
  try {
    process.kill(-run.child.pid, signal);
  } catch {
    try {
      run.child.kill(signal);
    } catch {
      // The process may already be gone.
    }
  }
}

function runShellJob(job, command, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/zsh', ['-lc', command], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    const run = { child, cancelled: false };
    activeJobRuns.set(job.id, run);
    setJob(job.id, { pid: child.pid || null });
    appendAudit('job.process_start', { id: job.id, mode: job.mode, pid: child.pid || null });

    const timer = setTimeout(() => {
      run.cancelled = true;
      appendJobLog(job.id, `Timed out after ${Math.round(timeoutMs / 1000)}s; stopping worker.`);
      stopJobRun(run, 'SIGTERM');
    }, timeoutMs);
    run.timer = timer;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendJobLog(job.id, text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendJobLog(job.id, text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      activeJobRuns.delete(job.id);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      activeJobRuns.delete(job.id);
      appendAudit('job.process_close', { id: job.id, mode: job.mode, code, signal, cancelled: run.cancelled });
      if (run.cancelled) {
        reject(new JobCancelled(signal === 'SIGTERM' ? 'Job was cancelled.' : `Job stopped by ${signal || 'timeout'}.`));
        return;
      }
      if (code === 0) {
        resolve((stdout || stderr || 'Command finished.').trim());
      } else {
        reject(new Error((stderr || stdout || `Command exited with ${code}`).trim()));
      }
    });
  });
}

function addJobAttempt(job, attempt) {
  const existing = jobs.get(job.id) || job;
  const attempts = normalizeJobAttempts([
    ...(existing.attempts || []),
    {
      id: crypto.randomUUID(),
      startedAt: Date.now(),
      ...attempt,
    },
  ]);
  setJob(job.id, { attempts });
  return attempts[attempts.length - 1] || null;
}

function classifyJobFailure(error, job = {}) {
  const text = String(error?.failureKind || error?.message || error || '').toLowerCase();
  if (error instanceof ActionApprovalRequired || /approval/.test(text)) return 'approval_required';
  if (/local execution|javis_enable_local_exec|level 3 local actions are disabled/.test(text)) return 'local_execution_disabled';
  if (/not found on path|command not found|not available|enoent|could not identify/.test(text)) return 'worker_command_missing';
  if (/not allowed by policy|disabled by policy|allowlist/.test(text)) return 'policy_blocked';
  if (/interrupted by javis shutdown|not completed before the previous process exited|previous javis shutdown/.test(text)) return 'interrupted';
  if (/timed out|timeout|stopped by sigterm/.test(text) || error instanceof JobCancelled) return 'timeout';
  if (/quota|billing|rate limit|429|insufficient_quota|temporarily unavailable|service unavailable|bad gateway/.test(text)) return 'model_quota_or_api';
  if (/openai api key|missing openai|api key is not configured/.test(text)) return 'openai_key_missing';
  if (job.mode === 'cli') return 'command_failed';
  if (job.mode === 'codex' || job.mode === 'claude') return 'worker_failed';
  return 'model_failed';
}

function codeAgentCommandForMode(mode) {
  return mode === 'codex'
    ? process.env.JAVIS_CODEX_CMD || 'codex exec'
    : process.env.JAVIS_CLAUDE_CMD || 'claude -p';
}

function codeAgentAlternativeMode(mode) {
  return mode === 'codex' ? 'claude' : 'codex';
}

function preferredRecoveryWorkerMode() {
  const claudeCommand = codeAgentCommandForMode('claude');
  if (commandExists(claudeCommand)) return 'claude';
  const codexCommand = codeAgentCommandForMode('codex');
  if (commandExists(codexCommand)) return 'codex';
  return '';
}

function buildCodeAgentPlan(mode, command, task) {
  const commandName = shellCommandName(command);
  return {
    action: 'code_agent',
    riskLevel: 3,
    summary: `Run ${mode} code agent: ${commandName || mode}`,
    target: commandName || mode,
    args: {
      mode,
      command,
      taskPreview: compactRecordText(task, 500),
    },
  };
}

function evaluateCodeAgentPlan(plan, options = {}) {
  const config = actionPolicy.allow?.code_agent || {};
  const command = String(plan.args?.command || '');
  const commandName = shellCommandName(command);
  const maxTimeoutMs = Number(config.maxTimeoutMs || DEFAULT_ACTION_POLICY.allow.code_agent.maxTimeoutMs);
  if (config.enabled === false) throw new Error('Code agent execution is disabled by policy.');
  if (!LOCAL_EXEC_ENABLED) {
    if (options.preview) {
      return { dryRun: Boolean(actionPolicy.dryRun), needsApproval: true, blocked: true, reason: 'local_execution_disabled' };
    }
    throw new Error('Code agent execution requires JAVIS_ENABLE_LOCAL_EXEC=true.');
  }
  if (!commandName) throw new Error('Could not identify the code agent command name.');
  if (!valueMatchesAllowlist(commandName, config.allowedCommands || [])) {
    throw new Error(`Code agent command ${commandName} is not allowed by policy.`);
  }
  if (!commandExists(command)) throw new Error(`Code agent command not found on PATH: ${commandName}`);

  const needsApproval =
    !options.approved &&
    (plan.riskLevel >= actionPolicy.requireApprovalAtRiskLevel || plan.riskLevel > actionPolicy.maxAutoRiskLevel);
  if (needsApproval) {
    if (options.preview) {
      return { dryRun: Boolean(actionPolicy.dryRun), needsApproval: true, reason: `risk_level_${plan.riskLevel}_requires_approval` };
    }
    const approval = createActionApproval(plan, `risk_level_${plan.riskLevel}_requires_approval`);
    throw new ActionApprovalRequired(approval);
  }
  return {
    dryRun: Boolean(actionPolicy.dryRun),
    needsApproval: false,
    reason: '',
    timeoutMs: Math.max(1000, Math.min(maxTimeoutMs, Number(options.timeoutMs || 180000))),
  };
}

function buildRecoveryPlanForJob(job, error, options = {}) {
  const failureKind = classifyJobFailure(error, job);
  const attempts = normalizeJobAttempts(options.attempts || job.attempts || []);
  const attempted = attempts.map((attempt) => `${attempt.tool || job.mode}: ${attempt.status}${attempt.summary ? ` · ${attempt.summary}` : ''}`);
  const diagnostics = recoveryDiagnosticsSnapshot();
  const nextActions = [
    {
      type: 'diagnose',
      label: diagnostics ? 'Review attached diagnostics' : 'Run doctor/config check',
      riskLevel: 0,
      autoEligible: true,
      reason: diagnostics
        ? 'Use the attached setup, policy, worker command, and permission evidence before asking the user.'
        : 'Collect setup, policy, worker command, and permission evidence before asking the user.',
    },
  ];

  if (failureKind === 'local_execution_disabled') {
    nextActions.push({
      type: 'setup',
      label: 'Enable local execution in CUI',
      riskLevel: 0,
      autoEligible: false,
      reason: 'Codex, Claude, CLI, typing, and file mutation workers require JAVIS_ENABLE_LOCAL_EXEC=true.',
    });
  }
  if (failureKind === 'approval_required') {
    nextActions.push({
      type: 'approval',
      label: 'Wait for or surface pending approval',
      riskLevel: 0,
      autoEligible: true,
      reason: 'A Level 3/4 action is ready but policy requires confirmation.',
    });
  }
  if (
    ['worker_command_missing', 'worker_failed', 'timeout', 'interrupted'].includes(failureKind)
    && (job.mode === 'codex' || job.mode === 'claude')
  ) {
    const alternativeMode = codeAgentAlternativeMode(job.mode);
    const alternativeCommand = codeAgentCommandForMode(alternativeMode);
    nextActions.push({
      type: 'alternative_worker',
      label: `Try ${alternativeMode} if available`,
      riskLevel: 3,
      autoEligible: false,
      command: alternativeCommand,
      reason: `${job.mode} hit ${failureKind}; try ${alternativeMode} with the same narrowed recovery context before asking the user.`,
    });
  }
  if (
    job.mode === 'background'
    && ['model_failed', 'model_quota_or_api', 'openai_key_missing', 'timeout', 'interrupted'].includes(failureKind)
  ) {
    const alternativeMode = preferredRecoveryWorkerMode();
    if (alternativeMode) {
      const alternativeCommand = codeAgentCommandForMode(alternativeMode);
      nextActions.push({
        type: 'alternative_worker',
        label: `Try ${alternativeMode} worker`,
        mode: alternativeMode,
        riskLevel: 3,
        autoEligible: false,
        command: alternativeCommand,
        reason: `The model lane hit ${failureKind}; delegate the narrowed recovery context to ${alternativeMode} before asking the user.`,
      });
    }
  }
  if (failureKind === 'policy_blocked') {
    nextActions.push({
      type: 'policy',
      label: 'Inspect action policy',
      riskLevel: 0,
      autoEligible: true,
      reason: 'The requested command/action is blocked by local policy and should be surfaced with exact policy evidence.',
    });
  }
  if (['command_failed', 'worker_failed', 'timeout', 'interrupted'].includes(failureKind)) {
    nextActions.push({
      type: 'retry',
      label: 'Retry with narrower scope',
      riskLevel: job.mode === 'background' ? 1 : 3,
      autoEligible: false,
      reason: 'The first attempt failed; retry should use a smaller scoped task and preserve the failure log.',
    });
  }
  if (failureKind === 'openai_key_missing') {
    nextActions.push({
      type: 'setup',
      label: 'Open config CUI for API key setup',
      riskLevel: 0,
      autoEligible: false,
      reason: 'Model lanes need OPENAI_API_KEY configured before retrying.',
    });
  }

  return normalizeRecoveryPlan({
    failureKind,
    summary: `${job.mode} job could not complete automatically: ${compactRecordText(error instanceof Error ? error.message : String(error), 500)}`,
    attempted,
    nextActions,
    diagnostics,
    generatedAt: Date.now(),
  });
}

function recoveryDiagnosticsSnapshot() {
  try {
    const config = configCheckSnapshot();
    return {
      overall: config.overall,
      summary: config.summary,
      counts: config.counts,
      primaryIssue: config.primaryIssue,
      runtime: {
        localExecutionEnabled: config.runtime?.localExecutionEnabled,
        trustedLocalMode: config.runtime?.trustedLocalMode,
        dryRun: config.runtime?.dryRun,
        maxAutoRiskLevel: config.runtime?.maxAutoRiskLevel,
        requireApprovalAtRiskLevel: config.runtime?.requireApprovalAtRiskLevel,
      },
      workers: config.workers,
      policy: {
        codeAgentEnabled: actionPolicy.allow?.code_agent?.enabled !== false,
        codeAgentAllowedCommands: actionPolicy.allow?.code_agent?.allowedCommands || [],
      },
    };
  } catch (error) {
    appendAudit('job.recovery_diagnostics_failed', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function failJobWithRecovery(job, error, patch = {}) {
  const current = jobs.get(job.id) || job;
  const recoveryPlan = error instanceof JobRecoveryFailure && error.recoveryPlan
    ? normalizeRecoveryPlan(error.recoveryPlan)
    : buildRecoveryPlanForJob(current, error);
  const failureKind = error instanceof JobRecoveryFailure ? error.failureKind : recoveryPlan?.failureKind || classifyJobFailure(error, current);
  finishJob(job.id, 'failed', {
    ...patch,
    failureKind,
    recoveryPlan,
    result: [
      error instanceof Error ? error.message : String(error),
      recoveryPlan?.summary ? `Recovery: ${recoveryPlan.summary}` : '',
      recoveryPlan?.nextActions?.length
        ? `Next actions:\n${recoveryPlan.nextActions.map((action, index) => `${index + 1}. ${action.label}: ${action.reason}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n'),
    log: `${jobs.get(job.id)?.log || current.log || ''}\nFailed with recovery plan: ${failureKind}.`,
  });
  appendAudit('job.recovery_plan', {
    id: job.id,
    mode: job.mode,
    failureKind,
    nextActions: recoveryPlan?.nextActions?.length || 0,
  });
}

async function runDelegatedJob(job, task) {
  const modes = [job.mode, codeAgentAlternativeMode(job.mode)].filter((mode, index, list) => list.indexOf(mode) === index);
  const failures = [];
  for (const mode of modes) {
    const baseCommand = codeAgentCommandForMode(mode);
    const command = `${baseCommand} ${shellQuote(task)}`;
    const plan = buildCodeAgentPlan(mode, baseCommand, task);
    const startedAt = Date.now();
    try {
      const evaluation = evaluateCodeAgentPlan(plan, { timeoutMs: job.timeoutMs });
      appendJobLog(job.id, `Starting ${mode} worker: ${shellCommandName(baseCommand) || mode}.`);
      addJobAttempt(job, {
        tool: mode,
        command: baseCommand,
        status: 'running',
        summary: plan.summary,
        startedAt,
      });
      const result = await runShellJob(job, command, evaluation.timeoutMs);
      addJobAttempt(job, {
        tool: mode,
        command: baseCommand,
        status: 'done',
        summary: 'Worker completed.',
        startedAt,
        completedAt: Date.now(),
      });
      return result;
    } catch (error) {
      const failureKind = classifyJobFailure(error, { ...job, mode });
      failures.push(error);
      addJobAttempt(job, {
        tool: mode,
        command: baseCommand,
        status: failureKind,
        summary: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: Date.now(),
      });
      appendJobLog(job.id, `${mode} worker failed (${failureKind}): ${error instanceof Error ? error.message : String(error)}`);
      if (!['worker_command_missing', 'policy_blocked'].includes(failureKind)) break;
    }
  }
  const finalError = failures[failures.length - 1] || new Error(`${job.mode} worker failed before starting.`);
  throw new JobRecoveryFailure(finalError instanceof Error ? finalError.message : String(finalError), {
    failureKind: classifyJobFailure(finalError, job),
    recoveryPlan: buildRecoveryPlanForJob(jobs.get(job.id) || job, finalError),
  });
}

async function runCliJob(job, command) {
  const evaluation = evaluateCliCommand(command, { timeoutMs: job.timeoutMs });
  const startedAt = Date.now();
  addJobAttempt(job, {
    tool: 'cli',
    command,
    status: 'running',
    summary: `Starting CLI command: ${evaluation.commandName}`,
    startedAt,
  });
  appendJobLog(job.id, `Starting CLI command: ${evaluation.commandName}`);
  try {
    const result = await runShellJob(job, command, evaluation.timeoutMs);
    addJobAttempt(job, {
      tool: 'cli',
      command,
      status: 'done',
      summary: 'CLI command completed.',
      startedAt,
      completedAt: Date.now(),
    });
    return result;
  } catch (error) {
    addJobAttempt(job, {
      tool: 'cli',
      command,
      status: classifyJobFailure(error, { ...job, mode: 'cli' }),
      summary: error instanceof Error ? error.message : String(error),
      startedAt,
      completedAt: Date.now(),
    });
    throw error;
  }
}

async function runModelJob(job, task, signal) {
  const screenNote = latestScreen
    ? `A recent screen frame is available from ${new Date(latestScreen.updatedAt).toLocaleTimeString()}.`
    : 'No screen frame has been shared yet.';
  const startedAt = Date.now();
  addJobAttempt(job, {
    tool: 'background',
    command: models.background,
    status: 'running',
    summary: `Calling ${models.background}.`,
    startedAt,
  });
  appendJobLog(job.id, `Calling ${models.background}.`);
  try {
    const output = await callOpenAIResponses({
      model: models.background,
      instructions:
        'You are the slow lane inside JAVIS. Produce careful, actionable results for harder user tasks. Be concise, concrete, and state assumptions.',
      input: `${screenNote}\n\nTask:\n${task}`,
      imageDataUrl: latestScreen?.imageDataUrl,
      maxOutputTokens: 1400,
      signal,
    });
    addJobAttempt(job, {
      tool: 'background',
      command: models.background,
      status: 'done',
      summary: 'Background model completed.',
      startedAt,
      completedAt: Date.now(),
    });
    return output;
  } catch (error) {
    addJobAttempt(job, {
      tool: 'background',
      command: models.background,
      status: classifyJobFailure(error, { ...job, mode: 'background' }),
      summary: error instanceof Error ? error.message : String(error),
      startedAt,
      completedAt: Date.now(),
    });
    throw error;
  }
}

async function processJob(job, task) {
  const abortController = new AbortController();
  activeJobRuns.set(job.id, { abortController, cancelled: false });
  setJob(job.id, { status: 'running', startedAt: Date.now(), log: `${job.log}\nStarted.` });
  try {
    const result =
      job.mode === 'codex' || job.mode === 'claude'
        ? await runDelegatedJob(job, task)
        : job.mode === 'cli'
          ? await runCliJob(job, task)
          : await runModelJob(job, task, abortController.signal);
    activeJobRuns.delete(job.id);
    finishJob(job.id, 'done', { result, log: `${jobs.get(job.id)?.log || ''}\nFinished.` });
  } catch (error) {
    activeJobRuns.delete(job.id);
    if (error instanceof JobCancelled || abortController.signal.aborted) {
      finishJob(job.id, 'cancelled', {
        result: error instanceof Error ? error.message : 'Job was cancelled.',
        log: `${jobs.get(job.id)?.log || ''}\nCancelled.`,
      });
      return;
    }
    failJobWithRecovery(job, error);
  }
}

function cancelJob(id, reason = 'Cancelled by user.') {
  const job = jobs.get(id);
  if (!job) return { ok: false, status: 404, error: 'Job not found' };
  if (!['queued', 'running'].includes(job.status)) {
    return { ok: false, status: 409, error: `Job is already ${job.status}` };
  }

  setJob(id, { cancelRequested: true, log: `${job.log || ''}\n${reason}` });
  const run = activeJobRuns.get(id);
  if (run?.child) {
    run.cancelled = true;
    stopJobRun(run, 'SIGTERM');
  }
  if (run?.abortController) {
    run.cancelled = true;
    run.abortController.abort();
  }
  if (!run) {
    finishJob(id, 'cancelled', { result: reason, log: `${jobs.get(id)?.log || ''}\nCancelled before start.` });
  }
  appendAudit('job.cancel_requested', { id, mode: job.mode, reason, hadRunner: Boolean(run) });
  return { ok: true, job: jobs.get(id) };
}

function normalizeHotkey(keys) {
  return String(keys || '')
    .split('+')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      if (item === 'command') return 'cmd';
      if (item === 'control') return 'ctrl';
      if (item === 'option') return 'alt';
      if (item === 'return') return 'enter';
      return item;
    })
    .join('+');
}

function appleScriptModifier(modifier) {
  const normalized = normalizeHotkey(modifier);
  if (normalized === 'cmd') return 'command';
  if (normalized === 'ctrl') return 'control';
  if (normalized === 'alt') return 'option';
  if (normalized === 'shift') return 'shift';
  return normalized;
}

function valueMatchesAllowlist(value, allowlist) {
  if (allowlist.includes('*')) return true;
  const normalizedValue = String(value || '').toLowerCase();
  return allowlist.some((item) => {
    const normalizedItem = String(item || '').toLowerCase();
    if (normalizedItem.startsWith('*.')) {
      const suffix = normalizedItem.slice(1);
      return normalizedValue.endsWith(suffix);
    }
    if (normalizedItem.startsWith('.')) {
      return normalizedValue.endsWith(normalizedItem);
    }
    return normalizedValue === normalizedItem;
  });
}

function expandUserPath(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Missing path.');
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function resolvePath(value) {
  const expanded = expandUserPath(value);
  return path.resolve(process.cwd(), expanded);
}

function realPathIfExists(value) {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function isPathInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function assertAllowedFilePath(targetPath, allowedRoots, options = {}) {
  const resolvedTarget = resolvePath(targetPath);
  const pathForCheck = options.forWrite ? path.dirname(resolvedTarget) : resolvedTarget;
  const realTarget = realPathIfExists(pathForCheck);
  const matchedRoot = allowedRoots
    .map((root) => realPathIfExists(resolvePath(root)))
    .find((root) => isPathInside(realTarget, root));
  if (!matchedRoot) {
    throw new Error(`Path is outside allowed roots: ${resolvedTarget}`);
  }
  return { resolvedTarget, matchedRoot };
}

function destinationPathForFile(destinationPath, sourcePath) {
  const resolvedDestination = resolvePath(destinationPath);
  if (fs.existsSync(resolvedDestination) && fs.statSync(resolvedDestination).isDirectory()) {
    return path.join(resolvedDestination, path.basename(sourcePath));
  }
  return resolvedDestination;
}

function assertAllowedFileDestination(destinationPath, sourcePath, allowedRoots) {
  const resolvedDestination = destinationPathForFile(destinationPath, sourcePath);
  const { matchedRoot } = assertAllowedFilePath(resolvedDestination, allowedRoots, { forWrite: true });
  return { resolvedTarget: resolvedDestination, matchedRoot };
}

function fileTypeFromStats(stats) {
  if (stats.isDirectory()) return 'directory';
  if (stats.isFile()) return 'file';
  if (stats.isSymbolicLink()) return 'symlink';
  return 'other';
}

function listDirectory(resolvedPath, maxEntries = 200) {
  const entries = fs.readdirSync(resolvedPath, { withFileTypes: true }).slice(0, maxEntries);
  return entries.map((entry) => {
    const fullPath = path.join(resolvedPath, entry.name);
    const stats = fs.statSync(fullPath);
    return {
      name: entry.name,
      path: fullPath,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  });
}

function readUtf8File(resolvedPath, maxBytes) {
  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) throw new Error('Path is not a file.');
  if (stats.size > maxBytes) throw new Error(`File exceeds maxBytes policy (${stats.size} > ${maxBytes}).`);
  return fs.readFileSync(resolvedPath, 'utf8');
}

function searchFiles(rootPath, query, maxResults) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) throw new Error('Missing search query.');
  const results = [];
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'Library', 'Caches']);

  function visit(currentPath) {
    if (results.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const nameMatch = entry.name.toLowerCase().includes(needle);
      let contentMatch = false;
      if (!nameMatch) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size <= 120000) {
            const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
            contentMatch = content.includes(needle);
          }
        } catch {
          contentMatch = false;
        }
      }
      if (nameMatch || contentMatch) {
        const stats = fs.statSync(fullPath);
        results.push({
          path: fullPath,
          name: entry.name,
          match: nameMatch ? 'name' : 'content',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }
    }
  }

  visit(rootPath);
  return results;
}

function buildMacActionPlan(args = {}) {
  const action = String(args.action || '');
  const value = String(args.value || '');

  if (action === 'open_url') {
    if (!/^https?:\/\//i.test(value)) throw new Error('Only http/https URLs are allowed.');
    const url = new URL(value);
    return {
      action,
      riskLevel: 2,
      summary: `Open URL ${url.href}`,
      target: url.hostname,
      args: { action, value: url.href },
    };
  }

  if (action === 'open_app') {
    if (!value || /[;&|`$<>]/.test(value)) throw new Error('Invalid app name.');
    return {
      action,
      riskLevel: 2,
      summary: `Open app ${value}`,
      target: value,
      args: { action, value },
    };
  }

  if (action === 'read_clipboard') {
    return {
      action,
      riskLevel: 1,
      summary: 'Read the current clipboard text',
      target: 'clipboard',
      args: { action },
    };
  }

  if (action === 'write_clipboard') {
    const content = String(args.content ?? value ?? '');
    if (!content) throw new Error('Missing clipboard content.');
    const maxBytes = actionPolicy.allow?.write_clipboard?.maxBytes || 20000;
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) throw new Error(`Clipboard content exceeds maxBytes policy (${bytes} > ${maxBytes}).`);
    return {
      action,
      riskLevel: 2,
      summary: `Write ${content.length} characters to the clipboard`,
      target: 'clipboard',
      args: { action, content },
      metadata: { bytes },
    };
  }

  if (action === 'clear_clipboard') {
    return {
      action,
      riskLevel: 2,
      summary: 'Clear the clipboard',
      target: 'clipboard',
      args: { action },
    };
  }

  if (action === 'type_text') {
    if (!value) throw new Error('Missing text to type.');
    if (value.length > 8000) throw new Error('Refusing to type more than 8000 characters in one action.');
    return {
      action,
      riskLevel: 3,
      summary: `Type ${value.length} characters into the active app`,
      target: 'active_app',
      args: { action, value },
    };
  }

  if (action === 'hotkey') {
    const keys = normalizeHotkey(args.keys || value);
    if (!keys) throw new Error('Missing hotkey.');
    return {
      action,
      riskLevel: 3,
      summary: `Press hotkey ${keys}`,
      target: keys,
      args: { action, keys },
    };
  }

  if (action === 'ax_press') {
    const nodeId = assertValidAccessibilityNodeId(args.nodeId || value);
    const expectedLabel = String(args.expectedLabel || '').trim();
    const expectedRole = String(args.expectedRole || '').trim();
    return {
      action,
      riskLevel: 3,
      summary: `Press accessibility node ${nodeId}${expectedLabel ? ` (${expectedLabel})` : ''}`,
      target: nodeId,
      args: { action, nodeId, expectedLabel, expectedRole },
      metadata: {
        expectedLabel,
        expectedRole,
        maxNodes: Number(args.maxNodes || actionPolicy.allow?.read_accessibility_tree?.maxNodes || 120),
        maxDepth: Number(args.maxDepth || actionPolicy.allow?.read_accessibility_tree?.maxDepth || 6),
      },
    };
  }

  if (action === 'ax_set_value') {
    const nodeId = assertValidAccessibilityNodeId(args.nodeId || value);
    const content = String(args.content ?? '');
    if (!content) throw new Error('Missing accessibility value content.');
    const maxBytes = actionPolicy.allow?.ax_set_value?.maxBytes || 20000;
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maxBytes) throw new Error(`Accessibility value content exceeds maxBytes policy (${bytes} > ${maxBytes}).`);
    const expectedLabel = String(args.expectedLabel || '').trim();
    const expectedRole = String(args.expectedRole || '').trim();
    return {
      action,
      riskLevel: 3,
      summary: `Set accessibility node ${nodeId}${expectedLabel ? ` (${expectedLabel})` : ''} value`,
      target: nodeId,
      args: { action, nodeId, content, expectedLabel, expectedRole },
      metadata: {
        bytes,
        expectedLabel,
        expectedRole,
        maxNodes: Number(args.maxNodes || actionPolicy.allow?.read_accessibility_tree?.maxNodes || 120),
        maxDepth: Number(args.maxDepth || actionPolicy.allow?.read_accessibility_tree?.maxDepth || 6),
      },
    };
  }

  throw new Error(`Unsupported action: ${action}`);
}

function buildFileActionPlan(args = {}) {
  const action = String(args.action || '');
  const fileConfig = actionPolicy.allow?.[action] || {};

  if (action === 'list_directory') {
    const { resolvedTarget, matchedRoot } = assertAllowedFilePath(args.path || '.', fileConfig.allowedRoots || []);
    const stats = fs.statSync(resolvedTarget);
    if (!stats.isDirectory()) throw new Error('Path is not a directory.');
    return {
      action,
      riskLevel: 1,
      summary: `List directory ${resolvedTarget}`,
      target: resolvedTarget,
      args: { action, path: resolvedTarget, maxEntries: Math.max(1, Math.min(500, Number(args.maxEntries || 200))) },
      metadata: { matchedRoot, type: fileTypeFromStats(stats) },
    };
  }

  if (action === 'read_file') {
    const { resolvedTarget, matchedRoot } = assertAllowedFilePath(args.path, fileConfig.allowedRoots || []);
    const stats = fs.statSync(resolvedTarget);
    if (!stats.isFile()) throw new Error('Path is not a file.');
    return {
      action,
      riskLevel: 1,
      summary: `Read file ${resolvedTarget}`,
      target: resolvedTarget,
      args: { action, path: resolvedTarget },
      metadata: { matchedRoot, size: stats.size, maxBytes: fileConfig.maxBytes || 400000 },
    };
  }

  if (action === 'search_files') {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('Missing search query.');
    const { resolvedTarget, matchedRoot } = assertAllowedFilePath(args.path || '.', fileConfig.allowedRoots || []);
    const stats = fs.statSync(resolvedTarget);
    if (!stats.isDirectory()) throw new Error('Search path is not a directory.');
    return {
      action,
      riskLevel: 1,
      summary: `Search for "${query}" in ${resolvedTarget}`,
      target: resolvedTarget,
      args: {
        action,
        path: resolvedTarget,
        query,
        maxResults: Math.max(1, Math.min(fileConfig.maxResults || 80, Number(args.maxResults || fileConfig.maxResults || 80))),
      },
      metadata: { matchedRoot },
    };
  }

  if (action === 'write_file') {
    const content = String(args.content ?? '');
    if (Buffer.byteLength(content, 'utf8') > (fileConfig.maxBytes || 400000)) {
      throw new Error(`Content exceeds maxBytes policy (${Buffer.byteLength(content, 'utf8')} > ${fileConfig.maxBytes || 400000}).`);
    }
    const { resolvedTarget, matchedRoot } = assertAllowedFilePath(args.path, fileConfig.allowedRoots || [], { forWrite: true });
    const exists = fs.existsSync(resolvedTarget);
    if (exists && !args.overwrite && !args.append) {
      throw new Error('File exists. Set overwrite or append explicitly.');
    }
    return {
      action,
      riskLevel: 3,
      summary: `${args.append ? 'Append to' : exists ? 'Overwrite' : 'Write'} file ${resolvedTarget}`,
      target: resolvedTarget,
      args: {
        action,
        path: resolvedTarget,
        content,
        overwrite: Boolean(args.overwrite),
        append: Boolean(args.append),
      },
      metadata: { matchedRoot, exists, bytes: Buffer.byteLength(content, 'utf8') },
    };
  }

  if (action === 'create_directory') {
    const { resolvedTarget, matchedRoot } = assertAllowedFilePath(args.path, fileConfig.allowedRoots || [], { forWrite: true });
    const exists = fs.existsSync(resolvedTarget);
    if (exists && !fs.statSync(resolvedTarget).isDirectory()) throw new Error('Path exists and is not a directory.');
    return {
      action,
      riskLevel: 3,
      summary: `${exists ? 'Ensure' : 'Create'} directory ${resolvedTarget}`,
      target: resolvedTarget,
      args: { action, path: resolvedTarget },
      metadata: { matchedRoot, exists },
    };
  }

  if (action === 'copy_file') {
    const sourcePath = String(args.sourcePath || args.from || args.path || '').trim();
    const destinationPath = String(args.destinationPath || args.to || '').trim();
    if (!sourcePath || !destinationPath) throw new Error('Missing sourcePath or destinationPath.');
    const source = assertAllowedFilePath(sourcePath, actionPolicy.allow?.read_file?.allowedRoots || []);
    const sourceStats = fs.statSync(source.resolvedTarget);
    if (!sourceStats.isFile()) throw new Error('Source path is not a file.');
    const maxBytes = fileConfig.maxBytes || 400000;
    if (sourceStats.size > maxBytes) throw new Error(`Source file exceeds maxBytes policy (${sourceStats.size} > ${maxBytes}).`);
    const destination = assertAllowedFileDestination(destinationPath, source.resolvedTarget, fileConfig.allowedRoots || []);
    const exists = fs.existsSync(destination.resolvedTarget);
    if (exists && !args.overwrite) throw new Error('Destination exists. Set overwrite explicitly.');
    return {
      action,
      riskLevel: 3,
      summary: `Copy file ${source.resolvedTarget} to ${destination.resolvedTarget}`,
      target: destination.resolvedTarget,
      args: {
        action,
        sourcePath: source.resolvedTarget,
        destinationPath: destination.resolvedTarget,
        overwrite: Boolean(args.overwrite),
      },
      metadata: {
        matchedRoot: destination.matchedRoot,
        sourceRoot: source.matchedRoot,
        exists,
        bytes: sourceStats.size,
      },
    };
  }

  if (action === 'move_file') {
    const sourcePath = String(args.sourcePath || args.from || args.path || '').trim();
    const destinationPath = String(args.destinationPath || args.to || '').trim();
    if (!sourcePath || !destinationPath) throw new Error('Missing sourcePath or destinationPath.');
    const source = assertAllowedFilePath(sourcePath, fileConfig.allowedRoots || []);
    const sourceStats = fs.statSync(source.resolvedTarget);
    if (!sourceStats.isFile()) throw new Error('Source path is not a file.');
    const destination = assertAllowedFileDestination(destinationPath, source.resolvedTarget, fileConfig.allowedRoots || []);
    if (source.resolvedTarget === destination.resolvedTarget) throw new Error('Source and destination are the same path.');
    const exists = fs.existsSync(destination.resolvedTarget);
    if (exists && !args.overwrite) throw new Error('Destination exists. Set overwrite explicitly.');
    return {
      action,
      riskLevel: 3,
      summary: `Move file ${source.resolvedTarget} to ${destination.resolvedTarget}`,
      target: destination.resolvedTarget,
      args: {
        action,
        sourcePath: source.resolvedTarget,
        destinationPath: destination.resolvedTarget,
        overwrite: Boolean(args.overwrite),
      },
      metadata: {
        matchedRoot: destination.matchedRoot,
        sourceRoot: source.matchedRoot,
        exists,
        bytes: sourceStats.size,
      },
    };
  }

  throw new Error(`Unsupported file action: ${action}`);
}

function buildLocalActionPlan(args = {}) {
  const action = String(args.action || '');
  if (FILE_ACTIONS.includes(action)) {
    return buildFileActionPlan(args);
  }
  return buildMacActionPlan(args);
}

function evaluateMacActionPlan(plan, options = {}) {
  const actionConfig = actionPolicy.allow?.[plan.action];
  if (!actionConfig?.enabled) {
    throw new Error(`Action ${plan.action} is disabled by policy.`);
  }

  if (plan.action === 'open_url') {
    if (!valueMatchesAllowlist(plan.target, actionConfig.allowedHosts || [])) {
      throw new Error(`URL host ${plan.target} is not allowed by policy.`);
    }
  }

  if (plan.action === 'open_app') {
    if (!valueMatchesAllowlist(plan.target, actionConfig.allowedApps || [])) {
      throw new Error(`App ${plan.target} is not allowed by policy.`);
    }
  }

  if (plan.action === 'hotkey') {
    if (!valueMatchesAllowlist(plan.target, actionConfig.allowedKeys || [])) {
      throw new Error(`Hotkey ${plan.target} is not allowed by policy.`);
    }
  }

  if (plan.action === 'ax_press' || plan.action === 'ax_set_value') {
    const expectedRole = plan.metadata?.expectedRole || plan.args?.expectedRole || '';
    if (expectedRole && !valueMatchesAllowlist(expectedRole, actionConfig.allowedRoles || [])) {
      throw new Error(`Accessibility role ${expectedRole} is not allowed by policy.`);
    }
  }

  if (plan.action === 'browser_control') {
    const browserAction = plan.metadata?.browserAction || plan.args?.browserAction || '';
    if (!valueMatchesAllowlist(browserAction, actionConfig.allowedActions || [])) {
      throw new Error(`Browser action ${browserAction} is not allowed by policy.`);
    }
  }

  if (plan.riskLevel >= 3 && !LOCAL_EXEC_ENABLED) {
    if (options.preview) {
      return {
        dryRun: Boolean(actionPolicy.dryRun),
        needsApproval: true,
        blocked: true,
        reason: 'local_execution_disabled',
      };
    }
    throw new Error('Level 3 local actions are disabled. Set JAVIS_ENABLE_LOCAL_EXEC=true and restart JAVIS first.');
  }

  const needsApproval =
    !options.approved &&
    (plan.riskLevel >= actionPolicy.requireApprovalAtRiskLevel || plan.riskLevel > actionPolicy.maxAutoRiskLevel);

  if (needsApproval) {
    if (options.preview) {
      return {
        dryRun: Boolean(actionPolicy.dryRun),
        needsApproval: true,
        reason: `risk_level_${plan.riskLevel}_requires_approval`,
      };
    }
    const approval = createActionApproval(
      plan,
      `risk_level_${plan.riskLevel}_requires_approval`,
      options.approvalContext,
    );
    throw new ActionApprovalRequired(approval);
  }

  return { dryRun: Boolean(actionPolicy.dryRun), needsApproval: false, reason: '' };
}

async function runMacActionPlan(plan, evaluation) {
  if (evaluation.dryRun) {
    appendAudit('mac_action.dry_run', { action: plan.action, riskLevel: plan.riskLevel, summary: plan.summary });
    return `[dry-run] ${plan.summary}`;
  }

  if (plan.action === 'open_url') {
    await execFileAsync('open', [plan.args.value]);
    return `Opened ${plan.args.value}`;
  }

  if (plan.action === 'open_app') {
    await execFileAsync('open', ['-a', plan.args.value]);
    return `Opened ${plan.args.value}`;
  }

  if (plan.action === 'read_clipboard') {
    const text = clipboard.readText() || '';
    const maxBytes = actionPolicy.allow?.read_clipboard?.maxBytes || 20000;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw new Error(`Clipboard text exceeds maxBytes policy (${bytes} > ${maxBytes}).`);
    return text || '[clipboard empty]';
  }

  if (plan.action === 'write_clipboard') {
    clipboard.writeText(plan.args.content);
    return `Wrote ${plan.args.content.length} characters to the clipboard.`;
  }

  if (plan.action === 'clear_clipboard') {
    clipboard.clear();
    return 'Cleared the clipboard.';
  }

  if (plan.action === 'type_text') {
    await execFileAsync('osascript', [
      '-e',
      `tell application "System Events" to keystroke ${JSON.stringify(plan.args.value)}`,
    ]);
    return 'Typed text into the active app.';
  }

  if (plan.action === 'hotkey') {
    const keys = plan.args.keys.split('+').filter(Boolean);
    const key = keys.pop();
    if (!key) throw new Error('Missing hotkey.');
    const modifiers = keys.length
      ? ` using {${keys.map((item) => `${appleScriptModifier(item)} down`).join(', ')}}`
      : '';
    await execFileAsync('osascript', ['-e', `tell application "System Events" to keystroke "${key}"${modifiers}`]);
    return `Pressed ${plan.args.keys}`;
  }

  if (plan.action === 'ax_press' || plan.action === 'ax_set_value') {
    return runAccessibilityNodeAction(plan);
  }

  throw new Error(`Unsupported action: ${plan.action}`);
}

async function runFileActionPlan(plan, evaluation) {
  if (plan.action === 'list_directory') {
    return JSON.stringify({
      path: plan.args.path,
      entries: listDirectory(plan.args.path, plan.args.maxEntries),
    });
  }

  if (plan.action === 'read_file') {
    return readUtf8File(plan.args.path, plan.metadata.maxBytes);
  }

  if (plan.action === 'search_files') {
    return JSON.stringify({
      path: plan.args.path,
      query: plan.args.query,
      results: searchFiles(plan.args.path, plan.args.query, plan.args.maxResults),
    });
  }

  if (plan.action === 'write_file') {
    if (evaluation.dryRun) {
      appendAudit('file_action.dry_run', {
        action: plan.action,
        riskLevel: plan.riskLevel,
        summary: plan.summary,
        bytes: plan.metadata.bytes,
      });
      return `[dry-run] ${plan.summary} (${plan.metadata.bytes} bytes)`;
    }
    fs.mkdirSync(path.dirname(plan.args.path), { recursive: true });
    if (plan.args.append) {
      fs.appendFileSync(plan.args.path, plan.args.content, 'utf8');
    } else {
      fs.writeFileSync(plan.args.path, plan.args.content, 'utf8');
    }
    return `${plan.summary} (${plan.metadata.bytes} bytes)`;
  }

  if (plan.action === 'create_directory') {
    if (evaluation.dryRun) {
      appendAudit('file_action.dry_run', {
        action: plan.action,
        riskLevel: plan.riskLevel,
        summary: plan.summary,
      });
      return `[dry-run] ${plan.summary}`;
    }
    fs.mkdirSync(plan.args.path, { recursive: true });
    return plan.summary;
  }

  if (plan.action === 'copy_file') {
    if (evaluation.dryRun) {
      appendAudit('file_action.dry_run', {
        action: plan.action,
        riskLevel: plan.riskLevel,
        summary: plan.summary,
        bytes: plan.metadata.bytes,
      });
      return `[dry-run] ${plan.summary} (${plan.metadata.bytes} bytes)`;
    }
    fs.mkdirSync(path.dirname(plan.args.destinationPath), { recursive: true });
    fs.copyFileSync(
      plan.args.sourcePath,
      plan.args.destinationPath,
      plan.args.overwrite ? 0 : fs.constants.COPYFILE_EXCL,
    );
    return `${plan.summary} (${plan.metadata.bytes} bytes)`;
  }

  if (plan.action === 'move_file') {
    if (evaluation.dryRun) {
      appendAudit('file_action.dry_run', {
        action: plan.action,
        riskLevel: plan.riskLevel,
        summary: plan.summary,
        bytes: plan.metadata.bytes,
      });
      return `[dry-run] ${plan.summary} (${plan.metadata.bytes} bytes)`;
    }
    fs.mkdirSync(path.dirname(plan.args.destinationPath), { recursive: true });
    if (fs.existsSync(plan.args.destinationPath) && !plan.args.overwrite) {
      throw new Error('Destination exists. Set overwrite explicitly.');
    }
    fs.renameSync(plan.args.sourcePath, plan.args.destinationPath);
    return `${plan.summary} (${plan.metadata.bytes} bytes)`;
  }

  throw new Error(`Unsupported file action: ${plan.action}`);
}

async function executeMacAction(args = {}, options = {}) {
  const plan = buildMacActionPlan(args);
  appendAudit('mac_action.requested', {
    action: plan.action,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
    approved: Boolean(options.approved),
  });
  const evaluation = evaluateMacActionPlan(plan, options);
  const output = await runMacActionPlan(plan, evaluation);
  appendAudit('mac_action.completed', { action: plan.action, riskLevel: plan.riskLevel, dryRun: evaluation.dryRun });
  return output;
}

async function executeFileAction(args = {}, options = {}) {
  const plan = buildFileActionPlan(args);
  appendAudit('file_action.requested', {
    action: plan.action,
    riskLevel: plan.riskLevel,
    summary: plan.summary,
    localExecutionEnabled: LOCAL_EXEC_ENABLED,
    approved: Boolean(options.approved),
  });
  const evaluation = evaluateMacActionPlan(plan, options);
  const output = await runFileActionPlan(plan, evaluation);
  appendAudit('file_action.completed', {
    action: plan.action,
    riskLevel: plan.riskLevel,
    dryRun: evaluation.dryRun,
    outputLength: typeof output === 'string' ? output.length : 0,
  });
  return output;
}

async function executeLocalAction(args = {}, options = {}) {
  const action = String(args.action || '');
  if (FILE_ACTIONS.includes(action)) {
    return executeFileAction(args, options);
  }
  return executeMacAction(args, options);
}

async function executeApprovedAction(approval) {
  if (approval.action === 'browser_control') {
    if (approval.args?.domAction) {
      const result = await executeBrowserDomAction({ ...approval.args, execute: true }, { approved: true });
      return result.output;
    }
    const result = await executeBrowserControl(approval.args, { approved: true });
    return result.output;
  }
  return executeLocalAction(approval.args, { approved: true });
}

async function continueAppWorkflowAfterApproval(approval, approvedOutput) {
  const continuation = normalizeApprovalContinuation(approval.continuation);
  if (!continuation || continuation.type !== 'app_workflow') return null;
  const workflow = continuation.workflowId ? workflows.get(continuation.workflowId) || null : null;
  const steps = normalizeAppWorkflowSteps(continuation.remainingSteps || []);
  const results = [
    {
      index: continuation.stepIndex,
      status: 'executed',
      type: 'approved_action',
      label: 'Approved action',
      summary: approval.summary,
      output: approvedOutput,
    },
  ];
  const stepContext = {
    workflowId: continuation.workflowId,
    title: continuation.title,
    instruction: continuation.instruction,
    steps,
    source: 'approval_continuation',
  };

  for (const step of steps) {
    try {
      const result = await runAppWorkflowStep(step, true, stepContext);
      results.push({ index: step.index, ...result });
      if (['blocked', 'approval_required'].includes(result.status)) break;
    } catch (error) {
      results.push({
        index: step.index,
        status: 'blocked',
        type: step.type,
        label: step.label,
        summary: step.label,
        output: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  const blocked = results.some((result) => ['blocked', 'approval_required'].includes(result.status));
  const status = blocked ? 'blocked' : 'done';
  const continuationOutput = formatAppWorkflowResults(results);
  const output = [
    workflow?.result ? `${workflow.result}` : '',
    `Approval ${approval.id} executed; continuing workflow.`,
    continuationOutput,
  ].filter(Boolean).join('\n');
  const finalWorkflow = workflow
    ? setWorkflow(workflow.id, {
        status,
        result: output,
        completedAt: Date.now(),
        target: {
          ...(workflow.target || {}),
          continuationApprovalId: approval.id,
          continuationSteps: steps.length,
          continuedAt: Date.now(),
        },
      })
    : null;
  appendAudit('approval.workflow_continued', {
    approvalId: approval.id,
    workflowId: continuation.workflowId,
    status,
    steps: steps.length,
  });
  return {
    ok: status === 'done',
    workflow: finalWorkflow,
    results,
    output,
  };
}

async function executeApproval(approval) {
  if (approval.status !== 'pending') {
    throw new Error(`Approval ${approval.id} is already ${approval.status}.`);
  }
  setApproval(approval.id, { status: 'approved' });
  try {
    const result = await executeApprovedAction(approval);
    const continuation = await continueAppWorkflowAfterApproval(approval, result);
    const output = continuation?.output
      ? [result, continuation.output].filter(Boolean).join('\n')
      : result;
    setApproval(approval.id, { status: 'executed', result: output });
    return { ok: true, output, approval: approvals.get(approval.id), continuation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setApproval(approval.id, { status: 'failed', result: message });
    throw error;
  }
}

async function executeTool(name, args) {
  appendAudit('tool.requested', { name });
  if (name === 'observe_now') {
    const observation = await observeNow({ ...(args || {}), source: 'voice' });
    return { ok: observation.ok, output: JSON.stringify(observation) };
  }

  if (name === 'get_mac_context') {
    const context = await macContextSnapshot({ includeClipboardText: Boolean(args?.includeClipboardText) });
    return { ok: true, output: JSON.stringify(context) };
  }

  if (name === 'get_browser_context') {
    const context = await browserContextSnapshot({ app: args?.app });
    return { ok: true, output: JSON.stringify(context) };
  }

  if (name === 'control_browser') {
    try {
      const result = await executeBrowserControl(args || {});
      return { ok: result.ok, output: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        };
      }
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'get_config_check') {
    return { ok: true, output: JSON.stringify(configCheckSnapshot()) };
  }

  if (name === 'get_setup_guide') {
    return { ok: true, output: JSON.stringify(setupGuideSnapshot()) };
  }

  if (name === 'run_setup_next') {
    const result = await runNextSetupAction({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'read_accessibility_tree') {
    const tree = await accessibilityTreeSnapshot(args || {});
    return { ok: tree.available, output: JSON.stringify(tree) };
  }

  if (name === 'plan_ui_action') {
    const plan = await accessibilityActionPlan(args || {});
    return { ok: plan.ok, output: JSON.stringify(plan) };
  }

  if (name === 'control_current_app') {
    const result = await controlCurrentApp({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'plan_app_workflow') {
    const result = await planAndMaybeRunAppWorkflow({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'run_app_workflow') {
    const result = await runAppWorkflow({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'get_recent_workflows') {
    const limit = Math.max(1, Math.min(20, Number(args?.limit || 8)));
    const workflowItems = workflowSnapshot(limit);
    return {
      ok: true,
      output: JSON.stringify({
        workflows: workflowItems,
        routes: Object.fromEntries(workflowItems.map((workflow) => [workflow.id, routingRecordsForWorkflow(workflow.id)])),
        counts: workflowCounts(),
      }),
    };
  }

  if (name === 'get_work_briefing') {
    const briefing = workflowBriefing(args || {});
    return { ok: briefing.ok, output: JSON.stringify(briefing) };
  }

  if (name === 'get_work_progress') {
    const progress = workProgressCheckIn({ ...(args || {}), source: 'voice' });
    return { ok: true, output: JSON.stringify(progress) };
  }

  if (name === 'get_work_next') {
    const result = await workNextAction({ ...(args || {}), execute: false, source: 'voice' });
    return { ok: true, output: JSON.stringify(result) };
  }

  if (name === 'run_work_next') {
    const result = await workNextAction({ ...(args || {}), execute: true, source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'get_work_session') {
    return {
      ok: true,
      output: JSON.stringify({
        counts: sessionCounts(),
        active: activeSessionSnapshot(),
        recent: sessionSnapshot(Math.max(1, Math.min(20, Number(args?.limit || 5)))),
      }),
    };
  }

  if (name === 'get_session_check_in') {
    const checkIn = sessionCheckIn({ ...(args || {}), source: 'voice' });
    return { ok: true, output: JSON.stringify(checkIn) };
  }

  if (name === 'start_work_session') {
    try {
      const session = startWorkSession({
        goal: args?.goal || args?.title,
        title: args?.title,
        tags: args?.tags,
        source: 'voice',
        replace: Boolean(args?.replace),
      });
      return { ok: true, output: JSON.stringify({ session, counts: sessionCounts() }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'resume_work_session') {
    try {
      const result = resumeWorkSession({
        id: args?.id || args?.sessionId,
        goal: args?.goal,
        title: args?.title,
        replace: Boolean(args?.replace),
        source: 'voice',
      });
      return { ok: true, output: JSON.stringify(result) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'add_work_session_event') {
    try {
      const result = addWorkSessionEvent(args?.id || args?.sessionId || '', {
        text: args?.text || args?.body,
        type: args?.type || 'note',
        source: 'voice',
      });
      return { ok: true, output: JSON.stringify(result) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'end_work_session') {
    try {
      const session = endWorkSession(args?.id || args?.sessionId || '', {
        note: args?.note,
        status: args?.status,
        source: 'voice',
      });
      return { ok: true, output: JSON.stringify({ session, counts: sessionCounts() }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'remember_memory') {
    try {
      const memory = rememberMemory({ ...(args || {}), source: 'voice' });
      return { ok: true, output: JSON.stringify({ memory }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'search_memory') {
    const result = searchMemories(args || {});
    return { ok: true, output: JSON.stringify(result) };
  }

  if (name === 'get_learning_profile') {
    return { ok: true, output: JSON.stringify(learningStateSnapshot()) };
  }

  if (name === 'get_presence_state') {
    return { ok: true, output: JSON.stringify(presenceStateSnapshot({ limit: args?.limit || 5 })) };
  }

  if (name === 'distill_learning_profile') {
    return { ok: true, output: JSON.stringify(distillAmbientLearning({ source: 'voice', force: true })) };
  }

  if (name === 'get_inbox') {
    const status = String(args?.status || 'open');
    const limit = Math.max(1, Math.min(20, Number(args?.limit || 5)));
    return {
      ok: true,
      output: JSON.stringify({
        counts: inboxCounts(),
        items: inboxSnapshot(limit, status),
      }),
    };
  }

  if (name === 'triage_inbox') {
    const triage = triageInbox({ ...(args || {}), source: 'voice' });
    return { ok: true, output: JSON.stringify(triage) };
  }

  if (name === 'process_next_inbox') {
    const result = await processNextInbox({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'capture_inbox_item') {
    try {
      const item = args?.fromClipboard
        ? captureClipboardToInbox('voice')
        : createInboxItem({
            title: args?.title,
            body: args?.body || args?.text,
            priority: args?.priority,
            tags: args?.tags,
            source: 'voice',
          });
      return { ok: true, output: JSON.stringify({ item, counts: inboxCounts() }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'route_inbox_item') {
    const result = await routeInboxItem({
      id: args?.id || args?.inboxId,
      instruction: args?.instruction,
      execute: args?.execute !== false,
      includeScreen: Boolean(args?.includeScreen),
      mode: args?.mode || args?.lane,
      useMemory: args?.useMemory,
      memoryLimit: args?.memoryLimit,
    });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'continue_workflow') {
    const result = await continueWorkflow({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'copy_workflow_result') {
    try {
      const result = await copyWorkflowResult(args || {});
      return { ok: result.ok, output: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        };
      }
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'read_browser_page') {
    const page = await browserPageSnapshot({ app: args?.app, maxChars: args?.maxChars });
    return { ok: page.available, output: JSON.stringify(page) };
  }

  if (name === 'read_browser_dom') {
    const dom = await browserDomSnapshot({ app: args?.app, limit: args?.limit });
    return { ok: dom.available, output: JSON.stringify(dom) };
  }

  if (name === 'control_browser_dom') {
    try {
      const result = await executeBrowserDomAction({ ...(args || {}), source: 'voice' });
      return { ok: result.ok, output: JSON.stringify(result) };
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        };
      }
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'run_browser_workflow') {
    const result = await runBrowserWorkflow({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'run_file_workflow') {
    const result = await runFileWorkflow({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'plan_file_organization') {
    const result = await planFileOrganization(args || {});
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'apply_file_plan') {
    const result = await applyFilePlan(args || {});
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'route_task') {
    const result = await routeTask({ ...(args || {}), source: 'voice' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'route_parallel_tasks') {
    const result = await routeParallelTasks({ ...(args || {}), source: 'voice_parallel' });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'capture_screen') {
    try {
      const screenFrame = await captureResidentScreen({ ...(args || {}), source: 'voice' });
      return { ok: true, output: JSON.stringify({ screen: screenFrame }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'describe_screen') {
    if (!latestScreen || args?.capture === true) {
      await captureResidentScreen({ source: 'voice_describe' });
    }
    const output = await callOpenAIResponses({
      model: models.vision,
      instructions:
        'You are JAVIS vision. Describe the visible Mac screen only. Mention the active app, likely user intent, and one useful next action.',
      input: args?.prompt || 'What is on my screen right now?',
      imageDataUrl: latestScreen.imageDataUrl,
      maxOutputTokens: 420,
    });
    return { ok: true, output };
  }

  if (name === 'delegate_task') {
    const task = String(args?.task || '').trim();
    if (!task) return { ok: false, output: 'No task was provided.' };
    const mode = ['codex', 'claude', 'background'].includes(args?.mode) ? args.mode : 'background';
    const result = await routeTask({
      message: task,
      execute: true,
      mode,
      source: 'voice_delegate',
      owner: args?.owner || ownerForRoutingLane(mode),
      scope: args?.scope || 'voice delegated task',
      parallelGroup: args?.parallelGroup || args?.group || mode,
    });
    return { ok: result.ok, output: JSON.stringify(result) };
  }

  if (name === 'run_cli_tool') {
    try {
      const result = queueCliCommand({
        command: args?.command,
        title: args?.title,
        timeoutMs: args?.timeoutMs,
        source: 'voice',
      });
      const decision = {
        lane: 'local',
        mode: 'cli',
        label: 'CLI',
        confidence: 1,
        reason: 'voice requested explicit CLI tool',
        execute: true,
        requiresOpenAiKey: false,
        requiresLocalExecution: true,
        localCommand: 'cli_command',
      };
      const routing = createRoutingRecord({
        task: args?.title || redactCommandForLog(args?.command),
        decision,
        source: 'voice_cli',
        execute: true,
        status: result.job?.status || 'queued',
        jobId: result.job?.id || '',
        owner: args?.owner || 'local',
        scope: args?.scope || 'explicit CLI command',
        parallelGroup: args?.parallelGroup || args?.group || 'cli',
        resultSummary: result.output,
      });
      return { ok: true, output: JSON.stringify({ ...result, routing }) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'run_mac_action') {
    try {
      const output = await executeMacAction(args);
      return { ok: true, output };
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        };
      }
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  if (name === 'run_file_action') {
    try {
      const output = await executeFileAction(args);
      return { ok: true, output };
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        return {
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        };
      }
      throw error;
    }
  }

  return { ok: false, output: `Unknown tool: ${name}` };
}

function createRealtimeSessionConfig(options = {}) {
  const micMode = options.micMode === 'open' ? 'open' : 'push';
  return {
    type: 'realtime',
    model: models.realtime,
    instructions: [
      'You are JAVIS, a fast Mac copilot.',
      'Keep spoken replies short and natural.',
      `Wake words: ${WAKE_WORDS.join(', ')}.`,
      'Default to standby behavior: when the user has not addressed you with a wake word and has not given an explicit follow-up command, stay silent and do not call tools.',
      'After a wake word, answer normally for that turn and carry short follow-up context while the user is clearly continuing the same task.',
      'Use observe_now first when you need a fast combined snapshot of screen, current app, accessibility tree, clipboard summary, jobs, and approvals.',
      'Use describe_screen before claiming what the user is seeing.',
      'Use capture_screen when the user asks what is currently on the Mac screen and no recent screen frame is available.',
      'Use get_mac_context before acting on the current app, active window, clipboard, or local runtime state.',
      'Use get_browser_context before summarizing, comparing, or acting on a webpage open in the browser.',
      'Use control_browser when the user explicitly asks for browser navigation such as back, forward, reload, new tab, close tab, focus address bar, open a URL, or search.',
      'Use read_browser_dom before choosing a clickable or fillable element inside the current webpage.',
      'Use control_browser_dom only when the user explicitly asks to click, fill, or select an element inside the current webpage. Do not use it for submits, purchases, sends, logins, deletes, or account changes without confirmation.',
      'Use get_config_check when setup, permission, resident mode, or local worker readiness is unclear.',
      'Use get_setup_guide when the user asks what setup remains. Use run_setup_next only when the user asks to fix, open, or do the next setup step.',
      'Use read_accessibility_tree before planning control of a visible Mac app through its UI structure.',
      'Use plan_ui_action when the user asks you to click, choose, fill, edit, or control the current app; this is a dry-run plan, not execution.',
      'Use control_current_app when the user explicitly asks you to click, choose, press, toggle, or fill something in the current Mac app. It plans the target and executes through the guarded local action policy.',
      'Use plan_app_workflow when the user gives a natural multi-step computer operation and you need JAVIS to observe the current Mac state, create steps, and optionally execute them.',
      'Use run_app_workflow when the user explicitly asks for a small multi-step local computer operation, such as open an app, wait, press a UI target, type text, use a hotkey, or run a file action. Preview with execute:false when the target is ambiguous.',
      'Use get_work_briefing when the user asks for current status, what happened recently, blockers, or what to do next.',
      'Use get_work_next when the user asks what single step should happen next. Use run_work_next only when the user explicitly asks to do, run, or execute the next work step.',
      'Use get_work_session when the user asks about the current work session.',
      'Use start_work_session when the user asks to start focusing on a task or begin a work session.',
      'Use add_work_session_event when the user asks to note, log, or remember something only inside the current session.',
      'Use end_work_session when the user asks to finish or stop the current work session.',
      'Use get_recent_workflows when the user asks what you just did, wants to continue prior work, or references the last task.',
      'Use remember_memory only when the user explicitly asks you to remember a preference, durable fact, or project note.',
      'Use search_memory when the user asks what you remember or when a task may depend on prior remembered local preferences.',
      'Use get_learning_profile when the user asks what you have learned from passive local observation, recent app/browser focus, or inferred work patterns.',
      'Treat the learning profile as local inferred context, not as user-confirmed memory or a reason to act without being asked.',
      'Use get_inbox when the user asks what is waiting, what they captured, or which Inbox items are open.',
      'Use capture_inbox_item when the user asks to save, remember for later, capture the clipboard, or add a follow-up without making it durable memory.',
      'Use process_next_inbox only when the user explicitly asks to process, do, run, or start the next Inbox item.',
      'Use route_inbox_item when the user explicitly asks to do, process, run, or send an Inbox item into the task lanes.',
      'Use continue_workflow when the user says to continue, resume, or do the next step from a previous workflow.',
      'Use copy_workflow_result when the user asks to copy a prior workflow result, draft, summary, or next step to the clipboard.',
      'Use read_browser_page when the user asks to summarize or use the content, headings, or links of the current webpage.',
      'Use read_browser_dom when the user asks what controls are visible on the current webpage or when a browser DOM target is needed.',
      'Use control_browser_dom for guarded webpage element click/fill/select actions after the target is clear.',
      'Use run_browser_workflow for webpage summarization, action extraction, drafting, page-specific questions, web search, search-result review, or multi-page research. Use intent:research when the user asks you to look something up, inspect multiple sources, or synthesize web evidence; use background/Codex/Claude mode for longer work.',
      'Use run_file_workflow for local file or folder listing, search, summarization, file-specific questions, or safe folder organization planning.',
      'Use plan_file_organization when the user asks to organize a local folder; it creates a preview plan and never moves files by itself.',
      'Use apply_file_plan only after the user explicitly confirms a specific file organization plan; it still goes through policy, approval, and local-execution gates.',
      'Use route_task when the user asks for something that might be quick or might need background/Codex/Claude work; it keeps the voice lane responsive.',
      'Only request full clipboard text when the user asks about clipboard content or it is clearly needed for the task.',
      'Use delegate_task for code, research, long planning, or multi-step work.',
      'Use run_cli_tool only when the user explicitly asks to run a local CLI command or a named command-line tool; it queues the command in the background.',
      'Use run_file_action for local file reading, listing, searching, writing, creating folders, copying files, or moving/renaming files.',
      'Use run_mac_action for small reversible Mac actions, or guarded Accessibility actions after plan_ui_action has identified a target. Level 3 actions may require approval or local execution enablement.',
      'Silent screen context updates may arrive as user messages with images; treat the newest one as current visual context and do not answer them by themselves.',
      'For purchases, logins, deletes, sends, or irreversible actions, ask for confirmation first.',
      'Speak Chinese by default unless the user switches language.',
    ].join(' '),
    audio: {
      input: {
        turn_detection: micMode === 'push' ? null : { type: 'server_vad' },
      },
      output: {
        voice: models.realtimeVoice,
      },
    },
    tools: [
      {
        type: 'function',
        name: 'observe_now',
        description: 'Get a combined current Mac observation: frontmost app/window, browser context, clipboard summary, latest/captured screen metadata, optional concise vision description, Accessibility tree outline, jobs, and approvals.',
        parameters: {
          type: 'object',
          properties: {
            captureScreen: { type: 'boolean' },
            includeAccessibility: { type: 'boolean' },
            describeScreen: { type: 'boolean' },
            includeClipboardText: { type: 'boolean' },
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
            prompt: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_mac_context',
        description: 'Get current Mac context: frontmost app/window, clipboard summary, screen state, active jobs, and pending approvals.',
        parameters: {
          type: 'object',
          properties: {
            includeClipboardText: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_browser_context',
        description: 'Get the current browser tab app, title, and URL for supported Mac browsers.',
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'control_browser',
        description: 'Execute a guarded browser navigation action in the current or specified supported Mac browser: back, forward, reload, new tab, close tab, focus address bar, open URL, or search.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['back', 'forward', 'reload', 'new_tab', 'close_tab', 'focus_address', 'open_url', 'search'],
            },
            browserAction: {
              type: 'string',
              enum: ['back', 'forward', 'reload', 'new_tab', 'close_tab', 'focus_address', 'open_url', 'search'],
            },
            app: { type: 'string' },
            url: { type: 'string' },
            query: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'read_browser_dom',
        description: 'Read visible clickable and fillable DOM controls from the current supported browser page. Returns element labels, selectors, tags, and bounding boxes.',
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'control_browser_dom',
        description: 'Execute one guarded DOM action inside the current supported browser page: click an element, fill an input/textarea/contenteditable, or select an option.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['click', 'fill', 'select'] },
            domAction: { type: 'string', enum: ['click', 'fill', 'select'] },
            app: { type: 'string' },
            selector: { type: 'string' },
            query: { type: 'string' },
            label: { type: 'string' },
            text: { type: 'string' },
            value: { type: 'string' },
            content: { type: 'string' },
            execute: { type: 'boolean' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_config_check',
        description: 'Check JAVIS setup, permissions, resident mode, policy, and local worker readiness.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_setup_guide',
        description: 'Get a concise setup guide with the current blockers and next local setup action. Read-only.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_setup_next',
        description: 'Open the next local setup target, such as .env or macOS permission settings. Use only after the user asks to fix or open the next setup step.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'read_accessibility_tree',
        description: 'Read the frontmost macOS app accessibility UI tree. This is read-only and limited by policy.',
        parameters: {
          type: 'object',
          properties: {
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'plan_ui_action',
        description: 'Create a dry-run UI control plan from the current frontmost app accessibility tree. Does not click, type, or execute.',
        parameters: {
          type: 'object',
          properties: {
            instruction: { type: 'string' },
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'control_current_app',
        description: 'Plan and optionally execute one UI action in the current frontmost Mac app using the accessibility tree and guarded action policy.',
        parameters: {
          type: 'object',
          properties: {
            instruction: { type: 'string' },
            action: { type: 'string', enum: ['press', 'set_value'] },
            content: { type: 'string' },
            value: { type: 'string' },
            execute: { type: 'boolean' },
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
          },
          required: ['instruction'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'plan_app_workflow',
        description: 'Observe current Mac context and Accessibility tree, then plan and optionally execute a short local app workflow from a natural-language instruction.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            instruction: { type: 'string' },
            goal: { type: 'string' },
            execute: { type: 'boolean' },
            useModel: { type: 'boolean' },
            continueOnError: { type: 'boolean' },
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
          },
          required: ['instruction'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_app_workflow',
        description: 'Preview or execute a short multi-step local Mac workflow. Each step uses the normal action policy and audit log.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            instruction: { type: 'string' },
            execute: { type: 'boolean' },
            continueOnError: { type: 'boolean' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['open_app', 'open_url', 'wait', 'control_current_app', 'browser_dom', 'hotkey', 'type_text', 'mac_action', 'file_action'],
                  },
                  label: { type: 'string' },
                  app: { type: 'string' },
                  url: { type: 'string' },
                  ms: { type: 'number' },
                  instruction: { type: 'string' },
                  action: { type: 'string' },
                  domAction: { type: 'string', enum: ['click', 'fill', 'select'] },
                  controlAction: { type: 'string', enum: ['press', 'set_value'] },
                  content: { type: 'string' },
                  value: { type: 'string' },
                  keys: { type: 'string' },
                  text: { type: 'string' },
                  selector: { type: 'string' },
                  path: { type: 'string' },
                  sourcePath: { type: 'string' },
                  destinationPath: { type: 'string' },
                  query: { type: 'string' },
                  overwrite: { type: 'boolean' },
                  append: { type: 'boolean' },
                  maxNodes: { type: 'number' },
                  maxDepth: { type: 'number' },
                  args: { type: 'object', additionalProperties: true },
                },
                required: ['type'],
                additionalProperties: false,
              },
            },
          },
          required: ['steps', 'execute'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_recent_workflows',
        description: 'Get recent JAVIS workflow history with status, target, result, and linked job ids.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_work_briefing',
        description: 'Get a local briefing of setup state, active jobs, recent workflows, blockers, memories, and suggested next actions.',
        parameters: {
          type: 'object',
          properties: {
            workflowLimit: { type: 'number' },
            jobLimit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_work_progress',
        description: 'Get a concise spoken progress update for background jobs and workflows: active work, recent completions, blockers, and next actions. Does not call a model.',
        parameters: {
          type: 'object',
          properties: {
            jobLimit: { type: 'number' },
            workflowLimit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_work_next',
        description: 'Preview the single next safe work step selected from setup blockers, approvals, active sessions, Inbox, jobs, and workflows. Does not execute.',
        parameters: {
          type: 'object',
          properties: {
            jobLimit: { type: 'number' },
            workflowLimit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_work_next',
        description: 'Execute exactly one safe next work step selected from the local workbench. Does not approve pending approvals or batch-run tasks.',
        parameters: {
          type: 'object',
          properties: {
            includeScreen: { type: 'boolean' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            useMemory: { type: 'boolean' },
            memoryLimit: { type: 'number' },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_work_session',
        description: 'Get current and recent local work sessions.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_session_check_in',
        description: 'Get a concise spoken check-in for the current local work session: recent progress, evidence, and next actions. Does not call a model.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'start_work_session',
        description: 'Start a local work session with a concrete goal. Keeps session notes local.',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
            title: { type: 'string' },
            replace: { type: 'boolean' },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['goal'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'resume_work_session',
        description: 'Resume a completed local work session by creating a new active session with the prior summary as context.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sessionId: { type: 'string' },
            goal: { type: 'string' },
            title: { type: 'string' },
            replace: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'add_work_session_event',
        description: 'Add a note, decision, blocker, or result to the current local work session.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sessionId: { type: 'string' },
            type: { type: 'string' },
            text: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'end_work_session',
        description: 'End the current local work session and produce a deterministic summary.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sessionId: { type: 'string' },
            note: { type: 'string' },
            status: { type: 'string', enum: ['done', 'cancelled'] },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'remember_memory',
        description: 'Store a user-approved local memory. Use only when the user explicitly asks to remember something durable.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            kind: { type: 'string', enum: ['fact', 'preference', 'project', 'task', 'note'] },
            scope: { type: 'string' },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['text'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'search_memory',
        description: 'Search local user-approved memories by keyword, kind, or scope.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            kind: { type: 'string', enum: ['fact', 'preference', 'project', 'task', 'note'] },
            scope: { type: 'string' },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_learning_profile',
        description: 'Get the local inferred learning profile distilled from passive ambient app/window/browser metadata. This is not explicit user-approved memory.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_presence_state',
        description: 'Get the resident standby/watch/work state: what JAVIS is passively observing, whether it is waiting for wake, what local learning has inferred, and whether any approvals or background work need attention. Read-only.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'distill_learning_profile',
        description: 'Refresh the local inferred learning profile from recent ambient observations. Does not call a model or execute computer actions.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_inbox',
        description: 'List local Inbox captures and counts. Defaults to open items.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'done', 'cancelled'] },
            limit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'triage_inbox',
        description: 'Read-only local triage for open Inbox items. Sorts by priority and age, suggests quick/background/Codex/Claude lanes, and does not execute anything.',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            instruction: { type: 'string' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'process_next_inbox',
        description: 'Process the highest-priority open Inbox item by sending it through the quick/background/Codex/Claude router. Use only after the user explicitly asks to do the next Inbox item.',
        parameters: {
          type: 'object',
          properties: {
            instruction: { type: 'string' },
            execute: { type: 'boolean' },
            includeScreen: { type: 'boolean' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            useMemory: { type: 'boolean' },
            memoryLimit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'capture_inbox_item',
        description: 'Capture a local follow-up item into Inbox, optionally from the current clipboard. This is not durable memory.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            text: { type: 'string' },
            fromClipboard: { type: 'boolean' },
            priority: { type: 'number' },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'route_inbox_item',
        description: 'Send an Inbox item into the quick/background/Codex/Claude task lanes. Use only after the user explicitly asks to process it.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            inboxId: { type: 'string' },
            instruction: { type: 'string' },
            execute: { type: 'boolean' },
            includeScreen: { type: 'boolean' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            useMemory: { type: 'boolean' },
            memoryLimit: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'continue_workflow',
        description: 'Continue a prior workflow by id, or the most recent workflow if no id is provided. Can answer quickly or queue background/Codex/Claude work.',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            instruction: { type: 'string' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'copy_workflow_result',
        description: 'Copy a workflow result to the local clipboard through action policy. Uses the most recent workflow if no id is provided.',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            format: { type: 'string', enum: ['result', 'markdown'] },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'read_browser_page',
        description: 'Read title, URL, selected text, headings, visible body text, visible links, and candidate search-result links from the current supported browser tab.',
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string' },
            maxChars: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_browser_workflow',
        description: 'Run a practical workflow over the current browser page, search/compare result pages, open and review one selected result, or synthesize multiple result pages. Browser research uses guarded search/open_url plus read-only page snapshots; it does not click page controls or submit forms.',
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string' },
            intent: { type: 'string', enum: ['summarize', 'extract_actions', 'draft', 'ask', 'act', 'search', 'compare', 'review_result', 'research'] },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            query: { type: 'string' },
            queries: {
              type: 'array',
              items: { type: 'string' },
            },
            url: { type: 'string' },
            urls: {
              type: 'array',
              items: { type: 'string' },
            },
            instruction: { type: 'string' },
            maxChars: { type: 'number' },
            maxSteps: { type: 'number' },
            maxPages: { type: 'number' },
            limit: { type: 'number' },
            resultCount: { type: 'number' },
            resultIndex: { type: 'number' },
            index: { type: 'number' },
            host: { type: 'string' },
            domain: { type: 'string' },
            urlContains: { type: 'string' },
            hrefContains: { type: 'string' },
            waitMs: { type: 'number' },
            openWaitMs: { type: 'number' },
            waitMsAfterOpen: { type: 'number' },
            execute: { type: 'boolean' },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_file_workflow',
        description: 'Run a practical workflow over an allowed local file or folder: list, search, summarize, answer a file-specific question, or plan safe folder organization.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            intent: { type: 'string', enum: ['list', 'search', 'summarize', 'ask', 'organize'] },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            query: { type: 'string' },
            instruction: { type: 'string' },
            maxEntries: { type: 'number' },
            maxResults: { type: 'number' },
            maxBytes: { type: 'number' },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'plan_file_organization',
        description: 'Create a policy-aware preview plan to organize a local folder by file type. Does not execute file moves.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            maxEntries: { type: 'number' },
            maxMoves: { type: 'number' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'apply_file_plan',
        description: 'Apply a previously reviewed file organization plan, or regenerate a plan for a path, after explicit user confirmation. Goes through policy, approval, and local-execution gates.',
        parameters: {
          type: 'object',
          properties: {
            workflowId: { type: 'string' },
            path: { type: 'string' },
            maxEntries: { type: 'number' },
            maxMoves: { type: 'number' },
            confirm: { type: 'boolean' },
          },
          required: ['confirm'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'route_task',
        description: 'Decide whether a user task belongs in quick, background, Codex, or Claude lane, and optionally execute or queue it.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            task: { type: 'string' },
            execute: { type: 'boolean' },
            includeScreen: { type: 'boolean' },
            useMemory: { type: 'boolean' },
            memoryLimit: { type: 'number' },
            lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
            owner: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'route_parallel_tasks',
        description: 'Route a small group of independent tasks under one parallelGroup, preserving owner, scope, lane, status, and result links. Use when the user asks to split work across agents or run independent tasks together.',
        parameters: {
          type: 'object',
          properties: {
            execute: { type: 'boolean' },
            parallelGroup: { type: 'string' },
            includeScreen: { type: 'boolean' },
            mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude'] },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string' },
                  message: { type: 'string' },
                  command: { type: 'string' },
                  title: { type: 'string' },
                  mode: { type: 'string', enum: ['quick', 'background', 'codex', 'claude', 'cli'] },
                  lane: { type: 'string', enum: ['quick', 'background', 'codex', 'claude', 'cli'] },
                  owner: { type: 'string' },
                  scope: { type: 'string' },
                  timeoutMs: { type: 'number' },
                },
                additionalProperties: false,
              },
            },
          },
          required: ['tasks'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'describe_screen',
        description: 'Describe the latest shared Mac screen frame.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'capture_screen',
        description: 'Capture the current primary Mac screen into JAVIS latest screen memory using the resident process and current screen privacy settings.',
        parameters: {
          type: 'object',
          properties: {
            displayId: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'delegate_task',
        description: 'Queue a slower background task for a stronger model, Codex, or Claude Code.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string' },
            mode: { type: 'string', enum: ['background', 'codex', 'claude'] },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
            owner: { type: 'string' },
          },
          required: ['task'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_cli_tool',
        description: 'Queue an explicit local CLI command in the background through the trusted local execution policy. Use for command-line tools like gh, git, npm, Codex CLI, Claude Code, or other installed tools.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            title: { type: 'string' },
            timeoutMs: { type: 'number' },
            scope: { type: 'string' },
            parallelGroup: { type: 'string' },
            owner: { type: 'string' },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_mac_action',
        description: 'Run a guarded Mac action. Accessibility actions require a node id from read_accessibility_tree or plan_ui_action and go through policy/approval.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['open_url', 'open_app', 'read_clipboard', 'write_clipboard', 'clear_clipboard', 'type_text', 'hotkey', 'ax_press', 'ax_set_value'] },
            value: { type: 'string' },
            content: { type: 'string' },
            keys: { type: 'string' },
            nodeId: { type: 'string' },
            expectedLabel: { type: 'string' },
            expectedRole: { type: 'string' },
            maxNodes: { type: 'number' },
            maxDepth: { type: 'number' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'run_file_action',
        description: 'Read, list, search, write, create folders, copy files, or move/rename files through the policy and approval system.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list_directory', 'read_file', 'search_files', 'write_file', 'create_directory', 'copy_file', 'move_file'],
            },
            path: { type: 'string' },
            sourcePath: { type: 'string' },
            destinationPath: { type: 'string' },
            query: { type: 'string' },
            content: { type: 'string' },
            overwrite: { type: 'boolean' },
            append: { type: 'boolean' },
            maxEntries: { type: 'number' },
            maxResults: { type: 'number' },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: 'auto',
  };
}

function startApiServer() {
  const api = express();
  api.use((req, res, next) => {
    const origin = req.get('origin') || '';
    if (isTrustedApiOrigin(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*');
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Headers', 'Content-Type, X-JAVIS-Token, X-JAVIS-API-Token, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.header('Access-Control-Max-Age', '600');
    } else {
      appendAudit('api.origin_rejected', { origin, path: req.path, method: req.method });
      if (req.method === 'OPTIONS') {
        res.sendStatus(403);
        return;
      }
      jsonError(res, 403, 'Untrusted API origin');
      return;
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  api.use((req, res, next) => {
    if (!API_AUTH_ENABLED || isPublicApiPath(req.path) || apiTokenMatches(requestApiToken(req))) {
      next();
      return;
    }
    appendAudit('api.auth_rejected', { path: req.path, method: req.method, hasOrigin: Boolean(req.get('origin')) });
    jsonError(res, 401, 'JAVIS API token required', 'Pass X-JAVIS-Token from the local runtime token file.');
  });
  api.use(express.json({ limit: '1mb' }));

  api.get('/api/health', (_req, res) => {
    res.json(healthSnapshot());
  });

  api.get('/api/readiness', (_req, res) => {
    res.json({ readiness: readinessSnapshot() });
  });

  api.get('/api/config/check', (_req, res) => {
    res.json({ config: configCheckSnapshot() });
  });

  api.post('/api/config/open-cui', (req, res) => {
    res.json(openConfigCui(req.body?.source || 'api'));
  });

  api.get('/api/doctor/report', async (_req, res) => {
    try {
      res.json({ doctor: await doctorReportSnapshot() });
    } catch (error) {
      jsonError(res, 500, 'Doctor report failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/resident/status', async (_req, res) => {
    try {
      res.json({ resident: await residentStatusSnapshot() });
    } catch (error) {
      jsonError(res, 500, 'Resident status failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/briefing', (req, res) => {
    try {
      res.json({
        briefing: workflowBriefing({
          workflowLimit: req.query.workflowLimit,
          jobLimit: req.query.jobLimit,
        }),
      });
    } catch (error) {
      jsonError(res, 500, 'Briefing failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/work/progress', (req, res) => {
    try {
      res.json({
        progress: workProgressCheckIn({
          jobLimit: req.query.jobLimit,
          workflowLimit: req.query.workflowLimit,
          source: 'api',
        }),
      });
    } catch (error) {
      jsonError(res, 500, 'Work progress failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/work/next', async (req, res) => {
    try {
      res.json({
        next: await workNextAction({
          ...(req.query || {}),
          execute: false,
          source: 'api',
        }),
      });
    } catch (error) {
      jsonError(res, 500, 'Work next failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/work/next', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      res.json({
        next: await workNextAction({
          ...(req.body || {}),
          execute: req.body?.execute !== false,
          source: req.body?.source || 'api',
        }),
      });
    } catch (error) {
      jsonError(res, 400, 'Work next failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/sessions', (req, res) => {
    try {
      const limit = Number(req.query.limit || 20);
      const status = String(req.query.status || '');
      res.json({
        sessions: {
          counts: sessionCounts(),
          active: activeSessionSnapshot(),
          items: sessionSnapshot(limit, status),
        },
        sessionsFile: SESSIONS_FILE,
      });
    } catch (error) {
      jsonError(res, 400, 'Session list failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/sessions/check-in', (req, res) => {
    try {
      res.json({ checkIn: sessionCheckIn({ ...(req.query || {}), source: 'api' }) });
    } catch (error) {
      jsonError(res, 400, 'Session check-in failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/check-in', express.json({ limit: '1mb' }), (req, res) => {
    try {
      res.json({ checkIn: sessionCheckIn({ ...(req.body || {}), source: req.body?.source || 'api' }) });
    } catch (error) {
      jsonError(res, 400, 'Session check-in failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/start', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const session = startWorkSession({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, session, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
    } catch (error) {
      jsonError(res, 400, 'Session start failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/resume', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const result = resumeWorkSession({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ...result, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
    } catch (error) {
      jsonError(res, 400, 'Session resume failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/:id/resume', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const result = resumeWorkSession({
        ...(req.body || {}),
        id: req.params.id,
        source: req.body?.source || 'api',
      });
      res.json({ ...result, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
    } catch (error) {
      jsonError(res, 400, 'Session resume failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/:id/events', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const result = addWorkSessionEvent(req.params.id, { ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, ...result, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
    } catch (error) {
      jsonError(res, 400, 'Session event failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/sessions/:id/end', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const session = endWorkSession(req.params.id, { ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, session, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
    } catch (error) {
      jsonError(res, 400, 'Session end failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.delete('/api/sessions/:id', (req, res) => {
    const session = removeWorkSession(req.params.id);
    if (!session) {
      jsonError(res, 404, 'Session not found');
      return;
    }
    res.json({ ok: true, removed: session, sessions: { counts: sessionCounts(), active: activeSessionSnapshot() } });
  });

  api.get('/api/jobs', (req, res) => {
    const limit = Number(req.query.limit || 50);
    const jobItems = Array.from(jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(1, Math.min(200, limit)));
    res.json({
      jobs: jobItems,
      routes: Object.fromEntries(jobItems.map((job) => [job.id, routingRecordsForJob(job.id)])),
      counts: queueCounts(),
    });
  });

  api.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(String(req.params.id || ''));
    if (!job) {
      jsonError(res, 404, 'Job not found');
      return;
    }
    res.json({ job, active: activeJobRuns.has(job.id), routes: routingRecordsForJob(job.id) });
  });

  api.post('/api/cli/run', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const result = queueCliCommand({
        ...(req.body || {}),
        source: req.body?.source || 'api',
      });
      const decision = {
        lane: 'local',
        mode: 'cli',
        label: 'CLI',
        confidence: 1,
        reason: 'API requested explicit CLI command',
        execute: true,
        requiresOpenAiKey: false,
        requiresLocalExecution: true,
        localCommand: 'cli_command',
      };
      const routing = createRoutingRecord({
        task: req.body?.title || redactCommandForLog(req.body?.command),
        decision,
        source: req.body?.source || 'api_cli',
        execute: true,
        status: result.job?.status || 'queued',
        jobId: result.job?.id || '',
        owner: req.body?.owner || 'local',
        scope: req.body?.scope || 'explicit CLI command',
        parallelGroup: req.body?.parallelGroup || req.body?.group || 'cli',
        resultSummary: result.output,
      });
      res.json({ ...result, routing });
    } catch (error) {
      jsonError(res, 400, 'CLI command failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/workflows', (req, res) => {
    const limit = Number(req.query.limit || 50);
    const workflowItems = workflowSnapshot(limit);
    res.json({
      workflows: workflowItems,
      routes: Object.fromEntries(workflowItems.map((workflow) => [workflow.id, routingRecordsForWorkflow(workflow.id)])),
      counts: workflowCounts(),
      workflowsFile: WORKFLOWS_FILE,
    });
  });

  api.post('/api/workflows/continue', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await continueWorkflow(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 500, 'Workflow continuation failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/workflows/:id/continue', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await continueWorkflow({
        ...(req.body || {}),
        workflowId: req.params.id,
      });
      res.json(result);
    } catch (error) {
      jsonError(res, 500, 'Workflow continuation failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/workflows/copy-result', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await copyWorkflowResult(req.body || {});
      res.json(result);
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 500, 'Workflow result copy failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/workflows/:id/copy-result', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await copyWorkflowResult({
        ...(req.body || {}),
        workflowId: req.params.id,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 500, 'Workflow result copy failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/workflows/:id', (req, res) => {
    const workflow = workflows.get(String(req.params.id || ''));
    if (!workflow) {
      jsonError(res, 404, 'Workflow not found');
      return;
    }
    const job = workflow.jobId ? jobs.get(workflow.jobId) || null : null;
    res.json({ workflow, job, routes: routingRecordsForWorkflow(workflow.id) });
  });

  api.get('/api/memory', (req, res) => {
    try {
      const query = String(req.query.query || '');
      if (query || req.query.kind || req.query.scope) {
        res.json({ memory: searchMemories({
          query,
          kind: req.query.kind,
          scope: req.query.scope,
          limit: req.query.limit,
        }), memoriesFile: MEMORIES_FILE });
        return;
      }
      res.json({
        memory: {
          total: memories.size,
          results: memorySnapshot(Number(req.query.limit || 50)),
        },
        memoriesFile: MEMORIES_FILE,
      });
    } catch (error) {
      jsonError(res, 400, 'Memory search failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/memory', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const memory = rememberMemory({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, memory, memoriesFile: MEMORIES_FILE });
    } catch (error) {
      jsonError(res, 400, 'Memory create failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.delete('/api/memory/:id', (req, res) => {
    const memory = removeMemory(req.params.id);
    if (!memory) {
      jsonError(res, 404, 'Memory not found');
      return;
    }
    res.json({ ok: true, removed: memory });
  });

  api.get('/api/inbox', (req, res) => {
    const limit = Number(req.query.limit || 50);
    const status = String(req.query.status || '');
    res.json({
      inbox: {
        counts: inboxCounts(),
        items: inboxSnapshot(limit, status),
      },
      inboxFile: INBOX_FILE,
    });
  });

  api.post('/api/inbox', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const item = createInboxItem({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, item, inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') } });
    } catch (error) {
      jsonError(res, 400, 'Inbox create failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/inbox/capture-clipboard', express.json({ limit: '1mb' }), (req, res) => {
    try {
      const item = captureClipboardToInbox(req.body?.source || 'api');
      res.json({ ok: true, item, inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') }, window: windowStateSnapshot() });
    } catch (error) {
      jsonError(res, 400, 'Inbox clipboard capture failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/inbox/triage', (req, res) => {
    try {
      res.json({ triage: triageInbox({ ...(req.query || {}), source: 'api' }) });
    } catch (error) {
      jsonError(res, 400, 'Inbox triage failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/inbox/triage', express.json({ limit: '1mb' }), (req, res) => {
    try {
      res.json({ triage: triageInbox({ ...(req.body || {}), source: req.body?.source || 'api' }) });
    } catch (error) {
      jsonError(res, 400, 'Inbox triage failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/inbox/process-next', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await processNextInbox({
        ...(req.body || {}),
        source: req.body?.source || 'api',
      });
      res.status(result.status && !result.ok ? result.status : 200).json(result);
    } catch (error) {
      jsonError(res, 400, 'Inbox process-next failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/inbox/:id/complete', express.json({ limit: '1mb' }), (req, res) => {
    const patch = {
      status: 'done',
      completedAt: Date.now(),
    };
    if (req.body?.body !== undefined) patch.body = req.body.body;
    if (req.body?.title !== undefined) patch.title = req.body.title;
    const item = setInboxItem(req.params.id, patch);
    if (!item) {
      jsonError(res, 404, 'Inbox item not found');
      return;
    }
    res.json({ ok: true, item, inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') } });
  });

  api.post('/api/inbox/:id/route', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await routeInboxItem({
        ...(req.body || {}),
        id: req.params.id,
        execute: req.body?.execute !== false,
      });
      if (!result.ok && result.status && result.status >= 400) {
        res.status(result.status).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'Inbox route failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.delete('/api/inbox/:id', (req, res) => {
    const item = removeInboxItem(req.params.id);
    if (!item) {
      jsonError(res, 404, 'Inbox item not found');
      return;
    }
    res.json({ ok: true, removed: item, inbox: { counts: inboxCounts(), open: inboxSnapshot(5, 'open') } });
  });

  api.post('/api/jobs/:id/cancel', (req, res) => {
    const result = cancelJob(String(req.params.id || ''), String(req.body?.reason || 'Cancelled from JAVIS.'));
    if (!result.ok) {
      jsonError(res, result.status || 400, result.error || 'Cancel failed');
      return;
    }
    res.json(result);
  });

  api.delete('/api/jobs/:id', (req, res) => {
    const id = String(req.params.id || '');
    const existing = jobs.get(id);
    if (!existing) {
      jsonError(res, 404, 'Job not found');
      return;
    }
    if (existing.status === 'running') {
      jsonError(res, 409, 'Running jobs cannot be removed yet');
      return;
    }
    jobs.delete(id);
    persistJobs();
    appendAudit('job.removed', { id, mode: existing.mode, status: existing.status, title: existing.title });
    res.json({ ok: true, removed: id });
  });

  api.get('/api/audit/recent', (req, res) => {
    const limit = Number(req.query.limit || 80);
    res.json({ events: readRecentAudit(limit) });
  });

  api.get('/api/status', (_req, res) => {
    const readiness = readinessSnapshot();
    const presence = presenceStateSnapshot({ readiness, limit: 5 });
    const conversation = presence.conversation || conversationStateSnapshot();
    res.json({
      api: {
        baseUrl: API_BASE,
        auth: apiAuthSnapshot(),
        hasOpenAiKey: Boolean(OPENAI_API_KEY),
        localExecutionEnabled: LOCAL_EXEC_ENABLED,
        trustedLocalMode: TRUSTED_LOCAL_MODE,
      },
      runtime: {
        version: packageInfo.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        dataDir: DATA_DIR,
      },
      actionPolicy: {
        dryRun: actionPolicy.dryRun,
        maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
        requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
      },
      screenPrivacy: screenPrivacySnapshot(),
      presence,
      conversation,
      ambient: ambientStateSnapshot(5),
      learning: learningStateSnapshot(),
      wake: wakeStatusSnapshot(),
      speech: speechStateSnapshot(),
      window: windowStateSnapshot(),
      menuBar: menuBarSnapshot(),
      notifications: notificationSnapshot(),
      approvals: pendingApprovalSnapshot(20),
      models,
      readiness: {
        overall: readiness.overall,
        label: readiness.label,
        summary: readiness.summary,
        counts: readiness.counts,
        primaryIssue: readiness.primaryIssue,
      },
      activeJobs: Array.from(activeJobRuns.keys()),
      workflows: workflowSnapshot(8),
      workflowCounts: workflowCounts(),
      routing: {
        counts: routingCounts(),
        active: activeRoutingSnapshot(8),
        ledger: activeRoutingSnapshot(8).map(routingLedgerEntry).filter(Boolean),
        recent: routingSnapshot(8),
      },
      memory: {
        total: memories.size,
        recent: memorySnapshot(3),
      },
      learnedProfile: learningStateSnapshot().profile,
      inbox: {
        counts: inboxCounts(),
        open: inboxSnapshot(5, 'open'),
      },
      sessions: {
        counts: sessionCounts(),
        active: activeSessionSnapshot(),
        recent: sessionSnapshot(5),
      },
      screen: latestScreenSnapshot(),
      queue: jobSnapshot(),
    });
  });

  api.get('/api/presence', (req, res) => {
    res.json({ presence: presenceStateSnapshot({ limit: req.query.limit }) });
  });

  api.get('/api/conversation/state', (_req, res) => {
    res.json({ conversation: conversationStateSnapshot() });
  });

  api.post('/api/conversation/state', express.json({ limit: '64kb' }), (req, res) => {
    res.json({ ok: true, conversation: updateConversationState(req.body || {}), presence: presenceStateSnapshot({ limit: 5 }) });
  });

  api.get('/api/realtime/context', async (req, res) => {
    try {
      const context = await realtimePreflightContextSnapshot({ source: req.query.source || 'api' });
      res.json({ context });
    } catch (error) {
      jsonError(res, 500, 'Realtime context failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/mac/context', async (req, res) => {
    try {
      const context = await macContextSnapshot({
        includeClipboardText: req.query.includeClipboardText === 'true',
      });
      res.json({ context });
    } catch (error) {
      jsonError(res, 500, 'Mac context failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/ambient', (req, res) => {
    res.json({ ambient: ambientStateSnapshot(req.query.limit || 20), ambientFile: AMBIENT_FILE });
  });

  api.post('/api/ambient/sample', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const event = await sampleAmbientContext(req.body?.source || 'api');
      res.json({ ok: true, event, ambient: ambientStateSnapshot(20), ambientFile: AMBIENT_FILE });
    } catch (error) {
      jsonError(res, 500, 'Ambient sample failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/autopilot', (_req, res) => {
    res.json({ autopilot: autopilotStateSnapshot() });
  });

  api.post('/api/autopilot/tick', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const result = await autopilotTick({
        ...(req.body || {}),
        source: req.body?.source || 'api',
        execute: req.body?.execute !== false,
      });
      res.json({ tick: result, autopilot: autopilotStateSnapshot() });
    } catch (error) {
      jsonError(res, 500, 'Autopilot tick failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/learning', (_req, res) => {
    res.json({ learning: learningStateSnapshot() });
  });

  api.post('/api/learning/distill', express.json({ limit: '64kb' }), (req, res) => {
    res.json({ ok: true, learning: distillAmbientLearning({ source: req.body?.source || 'api', force: true }) });
  });

  api.post('/api/learning/remember', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const result = rememberLearningProfile({ source: req.body?.source || 'api', force: req.body?.force !== false });
      res.json({ ...result, memoriesFile: MEMORIES_FILE });
    } catch (error) {
      jsonError(res, 400, 'Learning memory upsert failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/wake/status', (req, res) => {
    res.json({ wake: wakeStatusSnapshot({ since: req.query.since }) });
  });

  api.post('/api/wake/trigger', express.json({ limit: '64kb' }), (req, res) => {
    res.json({ ok: true, wake: triggerWake({ ...(req.body || {}), source: req.body?.source || 'api' }) });
  });

  api.post('/api/wake/engine/restart', express.json({ limit: '64kb' }), (_req, res) => {
    stopWakeEngine();
    res.json({ ok: true, wake: startWakeEngine() });
  });

  api.get('/api/speech/state', (_req, res) => {
    res.json({ speech: speechStateSnapshot() });
  });

  api.post('/api/speech/say', express.json({ limit: '64kb' }), (req, res) => {
    try {
      const result = speechSay({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ...result, speech: speechStateSnapshot() });
    } catch (error) {
      jsonError(res, 400, 'Speech failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/speech/stop', express.json({ limit: '64kb' }), (req, res) => {
    const stopped = stopSpeechProcess(String(req.body?.reason || req.body?.source || 'api'));
    res.json({ ok: true, stopped, speech: speechStateSnapshot() });
  });

  api.post('/api/observe', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const observation = await observeNow({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json(observation);
    } catch (error) {
      jsonError(res, 500, 'Observation failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/accessibility/tree', async (req, res) => {
    try {
      const tree = await accessibilityTreeSnapshot({
        maxNodes: req.query.maxNodes,
        maxDepth: req.query.maxDepth,
      });
      res.json({ tree });
    } catch (error) {
      jsonError(res, 500, 'Accessibility tree read failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/accessibility/plan', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const plan = await accessibilityActionPlan(req.body || {});
      res.json(plan);
    } catch (error) {
      jsonError(res, 500, 'Accessibility plan failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/accessibility/control', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await controlCurrentApp(req.body || {});
      res.status(result.approval ? 202 : 200).json(result);
    } catch (error) {
      jsonError(res, 400, 'Accessibility control failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/app/workflow', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await runAppWorkflow(req.body || {});
      res.status(result.ok ? 200 : 202).json(result);
    } catch (error) {
      jsonError(res, 400, 'App workflow failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/app/plan', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await planAndMaybeRunAppWorkflow(req.body || {});
      res.status(result.ok ? 200 : 202).json(result);
    } catch (error) {
      jsonError(res, 400, 'App workflow plan failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/browser/context', async (req, res) => {
    try {
      const context = await browserContextSnapshot({
        app: req.query.app,
      });
      res.json({ context });
    } catch (error) {
      jsonError(res, 500, 'Browser context failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/browser/page', async (req, res) => {
    try {
      const page = await browserPageSnapshot({
        app: req.query.app,
        maxChars: req.query.maxChars,
      });
      res.json({ page });
    } catch (error) {
      jsonError(res, 500, 'Browser page read failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/browser/javascript', async (req, res) => {
    try {
      const javascript = await browserJavaScriptStatusSnapshot({ app: req.query.app });
      res.json({ javascript });
    } catch (error) {
      jsonError(res, 500, 'Browser JavaScript status failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/browser/dom', async (req, res) => {
    try {
      const dom = await browserDomSnapshot({
        app: req.query.app,
        limit: req.query.limit,
      });
      res.json({ dom });
    } catch (error) {
      jsonError(res, 500, 'Browser DOM read failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/browser/control', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await executeBrowserControl(req.body || {});
      res.json(result);
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 400, 'Browser control failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/browser/dom-action', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await executeBrowserDomAction({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.status(result.approval ? 202 : 200).json(result);
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 400, 'Browser DOM action failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/browser/workflow', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const result = await runBrowserWorkflow(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 500, 'Browser workflow failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/realtime/session', express.text({ type: ['application/sdp', 'text/plain'], limit: '4mb' }), async (req, res) => {
    if (!OPENAI_API_KEY) {
      jsonError(res, 400, 'Missing OPENAI_API_KEY');
      return;
    }

    const fd = new FormData();
    fd.set('sdp', req.body);
    fd.set('session', JSON.stringify(createRealtimeSessionConfig({ micMode: req.query.micMode })));

    try {
      const response = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Safety-Identifier': hashSafetyIdentifier(),
        },
        body: fd,
      });
      const sdp = await response.text();
      if (!response.ok) {
        res.status(response.status).send(sdp);
        return;
      }
      res.type('application/sdp').send(sdp);
    } catch (error) {
      jsonError(res, 500, 'Failed to create realtime session', String(error));
    }
  });

  api.use(express.json({ limit: '18mb' }));

  api.get('/api/setup/guide', (_req, res) => {
    try {
      res.json({ guide: setupGuideSnapshot() });
    } catch (error) {
      jsonError(res, 500, 'Setup guide failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/setup/next', async (req, res) => {
    try {
      const result = await runNextSetupAction({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'Setup next failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/setup/actions', async (req, res) => {
    try {
      const result = await runSetupAction(req.body?.action);
      res.json({ ...result, config: configCheckSnapshot() });
    } catch (error) {
      jsonError(res, 400, 'Setup action failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/actions/policy', (_req, res) => {
    res.json({ policy: actionPolicy, policyFile: ACTION_POLICY_FILE });
  });

  api.put('/api/actions/policy', (req, res) => {
    const raw = req.body && typeof req.body === 'object' ? req.body : {};
    actionPolicy = normalizeActionPolicy({
      ...actionPolicy,
      ...raw,
      allow: {
        ...actionPolicy.allow,
        ...(raw.allow || {}),
      },
    });
    persistActionPolicy();
    appendAudit('action_policy.updated', {
      dryRun: actionPolicy.dryRun,
      maxAutoRiskLevel: actionPolicy.maxAutoRiskLevel,
      requireApprovalAtRiskLevel: actionPolicy.requireApprovalAtRiskLevel,
    });
    res.json({ policy: actionPolicy, policyFile: ACTION_POLICY_FILE });
  });

  api.post('/api/actions/preview', (req, res) => {
    try {
      const plan = buildLocalActionPlan(req.body || {});
      const evaluation = evaluateMacActionPlan(plan, { preview: true });
      res.json({ ok: true, plan, evaluation, policy: actionPolicy });
    } catch (error) {
      res.json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        policy: actionPolicy,
      });
    }
  });

  api.post('/api/actions/execute', async (req, res) => {
    try {
      const output = await executeLocalAction(req.body || {});
      res.json({ ok: true, output });
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 400, 'Action failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/files/execute', async (req, res) => {
    try {
      const output = await executeFileAction(req.body || {});
      res.json({ ok: true, output });
    } catch (error) {
      if (error instanceof ActionApprovalRequired) {
        res.status(202).json({
          ok: false,
          approval: error.approval,
          output: `Approval required before I can ${error.approval.summary}.`,
        });
        return;
      }
      jsonError(res, 400, 'File action failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/files/plan', async (req, res) => {
    try {
      const result = await planFileOrganization(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'File plan failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/files/plan/apply', async (req, res) => {
    try {
      const result = await applyFilePlan(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'File plan apply failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/workflows/:id/apply-file-plan', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await applyFilePlan({
        ...(req.body || {}),
        workflowId: req.params.id,
      });
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'File plan apply failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/files/workflow', async (req, res) => {
    try {
      const result = await runFileWorkflow(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'File workflow failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/approvals', (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json({
      approvals: approvalSnapshot(Math.max(1, Math.min(200, limit))),
      pending: pendingApprovalSnapshot(50),
      counts: Array.from(approvals.values()).reduce(
        (counts, approval) => {
          counts[approval.status] = (counts[approval.status] || 0) + 1;
          counts.total += 1;
          return counts;
        },
        { total: 0 },
      ),
    });
  });

  api.post('/api/approvals/:id/approve', async (req, res) => {
    const approval = approvals.get(String(req.params.id || ''));
    if (!approval) {
      jsonError(res, 404, 'Approval not found');
      return;
    }
    try {
      const result = await executeApproval(approval);
      res.json(result);
    } catch (error) {
      jsonError(res, 409, 'Approval execution failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/approvals/:id/reject', (req, res) => {
    const approval = approvals.get(String(req.params.id || ''));
    if (!approval) {
      jsonError(res, 404, 'Approval not found');
      return;
    }
    if (approval.status !== 'pending') {
      jsonError(res, 409, `Approval is already ${approval.status}`);
      return;
    }
    const next = setApproval(approval.id, { status: 'rejected', result: String(req.body?.reason || 'Rejected by user.') });
    res.json({ ok: true, approval: next });
  });

  api.delete('/api/approvals/:id', (req, res) => {
    const approval = approvals.get(String(req.params.id || ''));
    if (!approval) {
      jsonError(res, 404, 'Approval not found');
      return;
    }
    if (approval.status === 'pending') {
      jsonError(res, 409, 'Pending approvals must be approved or rejected before removal');
      return;
    }
    approvals.delete(approval.id);
    persistApprovals();
    appendAudit('approval.removed', {
      id: approval.id,
      action: approval.action,
      riskLevel: approval.riskLevel,
      status: approval.status,
    });
    res.json({ ok: true, removed: approval.id });
  });

  api.get('/api/screen/privacy', (_req, res) => {
    res.json({ privacy: screenPrivacySnapshot(), privacyFile: SCREEN_PRIVACY_FILE });
  });

  api.put('/api/screen/privacy', (req, res) => {
    try {
      const privacy = updateScreenPrivacy({ ...(req.body || {}), source: req.body?.source || 'api' });
      res.json({ ok: true, privacy, privacyFile: SCREEN_PRIVACY_FILE });
    } catch (error) {
      jsonError(res, 400, 'Screen privacy update failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/screen/frame', (req, res) => {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    if (!imageDataUrl.startsWith('data:image/')) {
      jsonError(res, 400, 'Invalid screen frame');
      return;
    }
    latestScreen = {
      imageDataUrl,
      width: Number(req.body?.width || 0),
      height: Number(req.body?.height || 0),
      privacy: normalizeScreenPrivacy(req.body?.privacy || screenPrivacy),
      source: 'renderer',
      updatedAt: Date.now(),
    };
    res.json({
      ok: true,
      screen: latestScreenSnapshot(),
    });
  });

  api.post('/api/screen/capture-now', async (req, res) => {
    try {
      const screenFrame = await captureResidentScreen({
        ...(req.body || {}),
        source: req.body?.source || 'api',
        includeImage: req.body?.includeImage === true,
      });
      res.json({ ok: true, screen: screenFrame });
    } catch (error) {
      jsonError(res, 500, 'Screen capture failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.delete('/api/screen/frame', (req, res) => {
    clearLatestScreen(req.body?.source || 'api');
    res.json({ ok: true, screen: null });
  });

  api.post('/api/screen/describe', async (req, res) => {
    try {
      if (!latestScreen || req.body?.capture === true) {
        await captureResidentScreen({ source: 'describe' });
      }
      const output = await callOpenAIResponses({
        model: models.vision,
        instructions:
          'You are JAVIS vision. Describe the screen in concise Chinese, then suggest the most useful next action.',
        input: String(req.body?.prompt || 'Describe the current screen.'),
        imageDataUrl: latestScreen.imageDataUrl,
        maxOutputTokens: 520,
      });
      res.json({ output, screen: latestScreenSnapshot() });
    } catch (error) {
      jsonError(res, 500, 'Screen analysis failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/chat/quick', async (req, res) => {
    const message = String(req.body?.message || '').trim();
    const includeScreen = Boolean(req.body?.includeScreen);
    const memoryContext = message
      ? memoryContextForTask(message, {
        useMemory: req.body?.useMemory !== false,
        memoryLimit: req.body?.memoryLimit,
      })
      : { matches: [], prompt: '' };
    const decision = message
      ? routeTaskDecision(message, { execute: true, includeScreen, mode: 'quick' })
      : null;
    const routingContext = {
      task: message,
      decision,
      source: String(req.body?.source || 'chat_quick').slice(0, 80),
      owner: req.body?.owner || 'realtime',
      parallelGroup: req.body?.parallelGroup || req.body?.group || 'quick',
      scope: req.body?.scope || 'realtime voice / fast answer',
      memoryMatches: memoryContext.matches.length,
    };
    try {
      if (!message) {
        jsonError(res, 400, 'Missing message');
        return;
      }
      const output = await answerQuickLane({
        message,
        input: [memoryContext.prompt, 'Task:', message].filter(Boolean).join('\n\n'),
        includeScreen,
        source: routingContext.source,
      });
      const result = finalizeRouteResult({
        ok: quickLaneOutputOk(output),
        executed: true,
        queued: false,
        decision,
        memory: {
          matches: memoryContext.matches,
          count: memoryContext.matches.length,
        },
        output,
      }, routingContext);
      res.json(result);
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      if (decision) {
        const result = finalizeRouteResult({
          ok: false,
          executed: true,
          queued: false,
          decision,
          memory: {
            matches: memoryContext.matches,
            count: memoryContext.matches.length,
          },
          output,
        }, routingContext);
        res.status(500).json({ ...result, error: 'Quick answer failed', details: output });
        return;
      }
      jsonError(res, 500, 'Quick answer failed', output);
    }
  });

  api.post('/api/tasks/route', async (req, res) => {
    try {
      const result = await routeTask(req.body || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'Task route failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.post('/api/tasks/parallel', express.json({ limit: '1mb' }), async (req, res) => {
    try {
      const result = await routeParallelTasks({ ...(req.body || {}), source: req.body?.source || 'api_parallel' });
      res.json(result);
    } catch (error) {
      jsonError(res, 400, 'Parallel task routing failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/tasks/routing', (req, res) => {
    const limit = Number(req.query.limit || 50);
    res.json({
      records: routingSnapshot(limit, req.query.status || ''),
      counts: routingCounts(),
      routingFile: ROUTING_FILE,
    });
  });

  api.get('/api/tasks/routing/:id', (req, res) => {
    const record = routingRecords.get(String(req.params.id || ''));
    if (!record) {
      jsonError(res, 404, 'Routing record not found');
      return;
    }
    res.json({ record });
  });

  api.post('/api/tasks', (req, res) => {
    const task = String(req.body?.task || '').trim();
    const requestedMode = String(req.body?.mode || 'background');
    const mode = ['background', 'codex', 'claude'].includes(requestedMode) ? requestedMode : 'background';
    if (!task) {
      jsonError(res, 400, 'Missing task');
      return;
    }
    const memoryContext = memoryContextForTask(task, {
      useMemory: req.body?.useMemory !== false,
      memoryLimit: req.body?.memoryLimit,
    });
    const jobTask = [memoryContext.prompt, 'Task:', task].filter(Boolean).join('\n\n');
    const job = createJob(jobTask, mode, 'api', { title: task });
    const decision = {
      lane: mode,
      mode,
      label: mode === 'background' ? 'Deep' : mode === 'codex' ? 'Codex' : 'Claude',
      confidence: 1,
      reason: 'user selected task mode',
      execute: true,
      requiresOpenAiKey: mode === 'background',
      requiresLocalExecution: mode === 'codex' || mode === 'claude',
    };
    const routing = createRoutingRecord({
      task,
      decision,
      source: 'api',
      execute: true,
      status: job.status,
      jobId: job.id,
      owner: req.body?.owner || ownerForRoutingLane(mode),
      memoryMatches: memoryContext.matches.length,
      resultSummary: job.log,
      parallelGroup: req.body?.parallelGroup || req.body?.group || mode,
      scope: req.body?.scope || '',
    });
    res.json({
      job,
      routing,
      memory: {
        matches: memoryContext.matches,
        count: memoryContext.matches.length,
      },
    });
  });

  api.post('/api/tools/execute', async (req, res) => {
    try {
      const result = await executeTool(String(req.body?.name || ''), req.body?.arguments || {});
      res.json(result);
    } catch (error) {
      jsonError(res, 500, 'Tool execution failed', error instanceof Error ? error.message : String(error));
    }
  });

  api.get('/api/window/state', (_req, res) => {
    res.json({ window: windowStateSnapshot() });
  });

  api.get('/api/menubar/state', (_req, res) => {
    res.json({ menuBar: menuBarSnapshot() });
  });

  api.get('/api/notifications/state', (_req, res) => {
    res.json({ notifications: notificationSnapshot() });
  });

  api.post('/api/notifications/test', (req, res) => {
    const delivered = notifyResident(
      'JAVIS test notification',
      req.body?.body || 'Resident notifications are working.',
      { type: 'test', source: 'api' },
    );
    res.json({ ok: delivered, notifications: notificationSnapshot() });
  });

  api.post('/api/window/mode', express.json({ limit: '64kb' }), (req, res) => {
    const mode = 'pet';
    const windowState = applyWindowMode(mode, {
      source: 'api',
      focus: req.body?.focus === true,
      corner: req.body?.corner,
      display: req.body?.display,
      park: req.body?.park !== false,
    });
    res.json({ ok: true, window: windowState });
  });

  api.post('/api/window/park', express.json({ limit: '64kb' }), (req, res) => {
    const windowState = parkWindow('api', { corner: req.body?.corner, display: req.body?.display });
    res.json({ ok: true, window: windowState });
  });

  api.post('/api/window/move', express.json({ limit: '64kb' }), (req, res) => {
    const windowState = moveWindow('api', { x: req.body?.x, y: req.body?.y });
    res.json({ ok: true, window: windowState });
  });

  return new Promise((resolve, reject) => {
    apiServer = api
      .listen(API_PORT, '127.0.0.1', () => {
        appendAudit('server.listen', { apiBase: API_BASE });
        resolve();
      })
      .on('error', reject);
  });
}

function rendererUrlWithApiToken(rendererUrl) {
  if (!API_AUTH_ENABLED || !apiToken) return rendererUrl;
  try {
    const url = new URL(rendererUrl);
    url.searchParams.set('javisApiToken', apiToken);
    return url.toString();
  } catch {
    return rendererUrl;
  }
}

function rendererLoadFileOptions() {
  return API_AUTH_ENABLED && apiToken
    ? { query: { javisApiToken: apiToken } }
    : undefined;
}

function createWindow() {
  const initialWindowMode = windowModes[currentWindowMode];
  mainWindow = new BrowserWindow({
    width: initialWindowMode.width,
    height: initialWindowMode.height,
    minWidth: initialWindowMode.width,
    minHeight: initialWindowMode.height,
    maxWidth: initialWindowMode.width,
    maxHeight: initialWindowMode.height,
    title: 'JAVIS',
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  parkWindow('startup', { menu: false });
  scheduleWindowSizeEnforcement('startup_enforce');

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendAudit('renderer.load_failed', {
      errorCode,
      errorDescription,
      url: validatedURL,
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    appendAudit('renderer.process_gone', details || {});
  });
  mainWindow.webContents.on('did-finish-load', () => {
    scheduleWindowSizeEnforcement('renderer_ready');
  });
  mainWindow.on('ready-to-show', () => {
    scheduleWindowSizeEnforcement('ready_to_show');
  });

  const rendererUrl = process.env.JAVIS_RENDERER_URL;
  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrlWithApiToken(rendererUrl));
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex, rendererLoadFileOptions());
  } else {
    mainWindow.loadURL(rendererUrlWithApiToken('http://127.0.0.1:5173'));
  }
}

function handleStartupError(error) {
  const message = `${new Date().toISOString()} ${error?.stack || error}\n`;
  fs.appendFileSync(path.join(process.cwd(), 'javis-error.log'), message);
  if (mainWindow) {
    mainWindow.webContents.send?.('startup-error', String(error?.message || error));
  } else {
    app.quit();
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      });
    },
    { useSystemPicker: false },
  );

  try {
    await startApiServer();
    createWindow();
    registerGlobalHotkeys();
    createMenuBarTray();
    startAmbientMonitor();
    startLearningMonitor();
    startAutopilotMonitor();
    startWakeEngine();
  } catch (error) {
    handleStartupError(error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appendAudit('process.before_quit', { pid: process.pid, queue: queueCounts() });
  globalShortcut.unregisterAll();
  stopAmbientMonitor();
  stopLearningMonitor();
  stopAutopilotMonitor();
  stopWakeEngine();
  stopSpeechProcess('quit');
  if (menuBarAvailable()) {
    menuBarTray.destroy();
    menuBarTray = null;
  }
  for (const [id, run] of activeJobRuns.entries()) {
    const job = jobs.get(id);
    if (job && ['queued', 'running'].includes(job.status)) {
      setJob(id, {
        status: 'failed',
        completedAt: Date.now(),
        pid: null,
        cancelRequested: false,
        log: `${job.log || ''}\nInterrupted by JAVIS shutdown.`,
        result: 'Interrupted by JAVIS shutdown.',
      });
    }
    run.cancelled = true;
    run.abortController?.abort();
    stopJobRun(run, 'SIGTERM');
  }
  activeJobRuns.clear();
  if (apiServer) apiServer.close();
});

process.on('uncaughtException', (error) => {
  appendAudit('process.uncaught_exception', { message: error.message || String(error) });
  fs.appendFileSync(path.join(process.cwd(), 'javis-error.log'), `${new Date().toISOString()} ${error.stack || error}\n`);
});
