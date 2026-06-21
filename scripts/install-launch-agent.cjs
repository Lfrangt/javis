const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const label = 'com.haoge.javis';
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const outLog = path.join(repoRoot, 'logs', 'resident.out.log');
const errLog = path.join(repoRoot, 'logs', 'resident.err.log');
const stopScript = path.join(repoRoot, 'scripts', 'stop-resident-processes.cjs');
const uid = process.getuid?.();
const launchAgentWorkingDirectory = os.homedir();

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

const command = `cd ${shQuote(repoRoot)} && npm run start:desktop`;
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
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
  </dict>
</dict>
</plist>
`;

if (uid !== undefined) {
  run('launchctl', ['bootout', `gui/${uid}`, plistPath], { optional: true });
}
run(process.execPath, [stopScript], { stdio: 'inherit', optional: true });
fs.writeFileSync(plistPath, plist, 'utf8');
if (uid !== undefined) {
  const bootstrapped = run('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { optional: true });
  if (!bootstrapped) {
    console.log('launchctl bootstrap failed; falling back to launchctl load -w.');
    run('launchctl', ['load', '-w', plistPath]);
  }
  run('launchctl', ['enable', `gui/${uid}/${label}`], { optional: true });
  run('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`], { optional: true });
}

console.log(`Installed ${label}`);
console.log(plistPath);
