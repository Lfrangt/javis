const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const label = 'com.haoge.javis';
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const uid = process.getuid?.();

function run(command, args) {
  try {
    execFileSync(command, args, { stdio: 'pipe' });
  } catch {
    // It is fine if the agent was not loaded.
  }
}

if (uid !== undefined) {
  run('launchctl', ['bootout', `gui/${uid}`, plistPath]);
  run('launchctl', ['disable', `gui/${uid}/${label}`]);
  run('launchctl', ['unload', '-w', plistPath]);
}

if (fs.existsSync(plistPath)) {
  fs.unlinkSync(plistPath);
}

console.log(`Uninstalled ${label}`);
