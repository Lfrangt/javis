const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const envFile = path.join(repoRoot, '.env');
const label = 'com.haoge.javis';
const watchdogLabel = 'com.haoge.javis.watchdog';
const homeDir = process.env.HOME || os.homedir();
const launchAgentsDir = path.join(homeDir, 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const watchdogPlistPath = path.join(launchAgentsDir, `${watchdogLabel}.plist`);
const outLog = path.join(repoRoot, 'logs', 'resident.out.log');
const errLog = path.join(repoRoot, 'logs', 'resident.err.log');
const watchdogOutLog = path.join(repoRoot, 'logs', 'resident-watchdog.out.log');
const watchdogErrLog = path.join(repoRoot, 'logs', 'resident-watchdog.err.log');
const stopScript = path.join(repoRoot, 'scripts', 'stop-resident-processes.cjs');
const watchdogScript = path.join(repoRoot, 'scripts', 'resident-watchdog.cjs');
const residentLauncherScript = path.join(repoRoot, 'scripts', 'resident-launcher.cjs');
const rolldownExecutable = path.join(repoRoot, 'node_modules', '.bin', 'rolldown');
const electronMainSource = path.join(repoRoot, 'electron', 'main.cjs');
const electronMainBundle = path.join(repoRoot, 'electron', 'main.bundle.cjs');
const distIndexFile = path.join(repoRoot, 'dist', 'index.html');
const uid = process.getuid?.();
const launchAgentWorkingDirectory = homeDir;
const args = new Set(process.argv.slice(2));
const skipBuild = args.has('--skip-build') || ['1', 'true', 'yes'].includes(String(process.env.JAVIS_RESIDENT_INSTALL_SKIP_BUILD || '').toLowerCase());
const skipMainBundle = args.has('--skip-main-bundle') || ['1', 'true', 'yes'].includes(String(process.env.JAVIS_RESIDENT_INSTALL_SKIP_MAIN_BUNDLE || '').toLowerCase());
const buildTimeoutMs = Math.max(10000, Math.min(300000, Number(process.env.JAVIS_RESIDENT_INSTALL_BUILD_TIMEOUT_MS || 60000)));
const mainBundleTimeoutMs = Math.max(10000, Math.min(120000, Number(process.env.JAVIS_RESIDENT_MAIN_BUNDLE_TIMEOUT_MS || 45000)));
const openAiCredentialEnvKeys = [
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_ORGANIZATION',
  'OPENAI_PROJECT',
];
const openAiSafeDefaultEnv = {
  JAVIS_OPENAI_PARANOID_ZERO_SPEND: 'true',
  JAVIS_OPENAI_HARD_SPEND_LOCK: 'true',
  JAVIS_OPENAI_REQUIRE_SPEND_CONFIRMATION_PHRASE: 'true',
  JAVIS_OPENAI_SPEND_CONFIRMATION_PHRASE: 'SPEND OPENAI',
  JAVIS_OPENAI_CLOUD_MODE: 'off',
  JAVIS_OPENAI_DAILY_REQUEST_LIMIT: '0',
  JAVIS_OPENAI_UNATTENDED_DAILY_REQUEST_LIMIT: '0',
  JAVIS_OPENAI_ALLOW_AUTOPILOT: 'false',
  JAVIS_OPENAI_ALLOW_RENDERER_STARTUP_PROBE: 'false',
  JAVIS_OPENAI_EGRESS_GUARD: 'true',
  JAVIS_OPENAI_REQUIRE_SPEND_LEASE: 'true',
  JAVIS_OPENAI_CHILD_ENV_GUARD: 'true',
  JAVIS_OPENAI_RUNTIME_KEY_ISOLATION: 'true',
  JAVIS_OPENAI_MEMORY_KEY_VAULT: 'true',
};

function parseDotEnvValue(value) {
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readDotEnvFile(filePath) {
  const values = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!key) continue;
      values[key] = parseDotEnvValue(trimmed.slice(eq + 1));
    }
  } catch {
    // Keep the launch agent installable before the first local .env is created.
  }
  return values;
}

function openAiLaunchEnvFromDotEnv() {
  const dotEnv = readDotEnvFile(envFile);
  const env = { ...openAiSafeDefaultEnv };
  for (const [key, value] of Object.entries(dotEnv)) {
    if (!key.startsWith('JAVIS_OPENAI_')) continue;
    if (openAiCredentialEnvKeys.includes(key)) continue;
    env[key] = value;
  }
  return env;
}

const openAiLaunchEnv = openAiLaunchEnvFromDotEnv();

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function run(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      stdio: options.stdio || 'pipe',
      env: options.env || safeProcessEnv(),
      timeout: options.timeoutMs || undefined,
    });
    return true;
  } catch (error) {
    if (options.optional) return false;
    throw error;
  }
}

function buildRendererForResident() {
  const hasExistingBuild = fs.existsSync(distIndexFile);
  if (skipBuild && hasExistingBuild) {
    console.log('Skipping JAVIS renderer build; using existing dist/index.html.');
    return;
  }
  console.log('Building JAVIS renderer...');
  const ok = run('npm', ['run', 'resident:prepare'], {
    stdio: 'inherit',
    timeoutMs: buildTimeoutMs,
    optional: hasExistingBuild,
  });
  if (!ok && hasExistingBuild) {
    console.log(`Renderer build did not finish within ${Math.round(buildTimeoutMs / 1000)}s; continuing with existing dist/index.html so the resident can recover.`);
  }
}

function buildMainProcessBundleForResident() {
  const hasExistingBundle = fs.existsSync(electronMainBundle);
  if (skipMainBundle && hasExistingBundle) {
    console.log('Skipping JAVIS main-process bundle; using existing electron/main.bundle.cjs.');
    return;
  }
  if (!fs.existsSync(rolldownExecutable)) {
    if (hasExistingBundle) {
      console.log('Rolldown not found; using existing electron/main.bundle.cjs.');
      return;
    }
    throw new Error(`Rolldown executable not found: ${rolldownExecutable}`);
  }
  console.log('Bundling JAVIS main process...');
  const ok = run(rolldownExecutable, [
    electronMainSource,
    '--platform',
    'node',
    '--format',
    'cjs',
    '--external',
    'electron',
    '--file',
    electronMainBundle,
    '--no-treeshake',
    '--log-level',
    'warn',
  ], {
    stdio: 'inherit',
    timeoutMs: mainBundleTimeoutMs,
    optional: hasExistingBundle,
  });
  if (!ok && hasExistingBundle) {
    console.log(`Main-process bundle did not finish within ${Math.round(mainBundleTimeoutMs / 1000)}s; continuing with existing electron/main.bundle.cjs.`);
  }
}

function safeProcessEnv(extra = {}) {
  const env = {
    ...process.env,
    ...openAiLaunchEnv,
    ...extra,
  };
  for (const key of openAiCredentialEnvKeys) {
    delete env[key];
  }
  return env;
}

function plistEnvironmentXml(values) {
  return Object.entries(values)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n');
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'logs'), { recursive: true });

buildMainProcessBundleForResident();
buildRendererForResident();

const electronExecutable = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
if (!fs.existsSync(electronExecutable)) {
  throw new Error(`Electron executable not found: ${electronExecutable}`);
}
if (!fs.existsSync(residentLauncherScript)) {
  throw new Error(`Resident launcher script not found: ${residentLauncherScript}`);
}
if (!fs.existsSync(watchdogScript)) {
  throw new Error(`Resident watchdog script not found: ${watchdogScript}`);
}
const residentLaunchEnv = {
  PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  ...openAiLaunchEnv,
  JAVIS_ALLOW_TERMINAL_VOICE_LOOP: 'false',
  JAVIS_RESIDENT_LAUNCH_AGENT: 'true',
  JAVIS_REPO_ROOT: repoRoot,
  JAVIS_RESIDENT_STARTUP_HEALTH_TIMEOUT_MS: process.env.JAVIS_RESIDENT_STARTUP_HEALTH_TIMEOUT_MS || '60000',
  JAVIS_RESIDENT_STARTUP_ATTEMPTS: process.env.JAVIS_RESIDENT_STARTUP_ATTEMPTS || '3',
  JAVIS_RESIDENT_STARTUP_RETRY_DELAY_MS: process.env.JAVIS_RESIDENT_STARTUP_RETRY_DELAY_MS || '1500',
};
const watchdogLaunchEnv = {
  PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  ...openAiLaunchEnv,
  JAVIS_REPO_ROOT: repoRoot,
  JAVIS_WATCHDOG_MANAGED_BY_LAUNCHD: 'true',
};
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(residentLauncherScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(launchAgentWorkingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(outLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(errLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${plistEnvironmentXml(residentLaunchEnv)}
  </dict>
</dict>
</plist>
`;
const watchdogPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(watchdogLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(watchdogScript)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(repoRoot)}</string>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${xmlEscape(watchdogOutLog)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(watchdogErrLog)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${plistEnvironmentXml(watchdogLaunchEnv)}
  </dict>
</dict>
</plist>
`;

if (uid !== undefined) {
  run('launchctl', ['bootout', `gui/${uid}`, watchdogPlistPath], { optional: true });
  run('launchctl', ['bootout', `gui/${uid}`, plistPath], { optional: true });
}
run(process.execPath, [stopScript], { stdio: 'inherit', optional: true });
fs.writeFileSync(plistPath, plist, 'utf8');
fs.writeFileSync(watchdogPlistPath, watchdogPlist, 'utf8');
if (uid !== undefined) {
  const bootstrapped = run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { optional: true });
  if (!bootstrapped) {
    console.log('launchctl bootstrap failed; falling back to launchctl load -w.');
    run('launchctl', ['load', '-w', plistPath]);
  }
  run('launchctl', ['enable', `gui/${uid}/${label}`], { optional: true });
  run('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`], { optional: true });
  const watchdogBootstrapped = run('launchctl', ['bootstrap', `gui/${uid}`, watchdogPlistPath], { optional: true });
  if (!watchdogBootstrapped) {
    console.log('watchdog launchctl bootstrap failed; falling back to launchctl load -w.');
    run('launchctl', ['load', '-w', watchdogPlistPath]);
  }
  run('launchctl', ['enable', `gui/${uid}/${watchdogLabel}`], { optional: true });
}

console.log(`Installed ${label}`);
console.log(plistPath);
console.log(`Installed ${watchdogLabel}`);
console.log(watchdogPlistPath);
