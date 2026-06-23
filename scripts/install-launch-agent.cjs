const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
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
const uid = process.getuid?.();
const launchAgentWorkingDirectory = homeDir;

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
    execFileSync(command, args, { stdio: options.stdio || 'pipe' });
    return true;
  } catch (error) {
    if (options.optional) return false;
    throw error;
  }
}

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'logs'), { recursive: true });

console.log('Building JAVIS renderer...');
run('npm', ['run', 'resident:prepare'], { stdio: 'inherit' });

const electronExecutable = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const electronAppTarget = repoRoot;
if (!fs.existsSync(electronExecutable)) {
  throw new Error(`Electron executable not found: ${electronExecutable}`);
}
if (!fs.existsSync(watchdogScript)) {
  throw new Error(`Resident watchdog script not found: ${watchdogScript}`);
}
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(electronExecutable)}</string>
    <string>${xmlEscape(electronAppTarget)}</string>
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
    <key>PATH</key>
    <string>${xmlEscape(process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}</string>
    <key>JAVIS_ALLOW_TERMINAL_VOICE_LOOP</key>
    <string>false</string>
    <key>JAVIS_RESIDENT_LAUNCH_AGENT</key>
    <string>true</string>
    <key>JAVIS_REPO_ROOT</key>
    <string>${xmlEscape(repoRoot)}</string>
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
    <key>PATH</key>
    <string>${xmlEscape(process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')}</string>
    <key>JAVIS_REPO_ROOT</key>
    <string>${xmlEscape(repoRoot)}</string>
    <key>JAVIS_WATCHDOG_MANAGED_BY_LAUNCHD</key>
    <string>true</string>
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
