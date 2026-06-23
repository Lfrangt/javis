const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const label = 'com.haoge.javis';
const watchdogLabel = 'com.haoge.javis.watchdog';
const repoRoot = path.resolve(__dirname, '..');
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const watchdogPlistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${watchdogLabel}.plist`);
const stopScript = path.join(repoRoot, 'scripts', 'stop-resident-processes.cjs');
const uid = process.getuid?.();

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'pipe' });
  } catch {
    // It is fine if the agent was not loaded.
  }
}

if (uid !== undefined) {
  run('launchctl', ['bootout', `gui/${uid}`, watchdogPlistPath]);
  run('launchctl', ['disable', `gui/${uid}/${watchdogLabel}`]);
  run('launchctl', ['unload', '-w', watchdogPlistPath]);
  run('launchctl', ['bootout', `gui/${uid}`, plistPath]);
  run('launchctl', ['disable', `gui/${uid}/${label}`]);
  run('launchctl', ['unload', '-w', plistPath]);
}

run(process.execPath, [stopScript]);

if (fs.existsSync(plistPath)) {
  fs.unlinkSync(plistPath);
}
if (fs.existsSync(watchdogPlistPath)) {
  fs.unlinkSync(watchdogPlistPath);
}

console.log(`Uninstalled ${label}`);
console.log(`Uninstalled ${watchdogLabel}`);
