#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

const file = path.join(process.cwd(), 'docs', 'javis-status-board.html');
const opener = process.platform === 'darwin'
  ? 'open'
  : process.platform === 'win32'
    ? 'cmd'
    : 'xdg-open';
const args = process.platform === 'win32'
  ? ['/c', 'start', '', file]
  : [file];

const child = spawn(opener, args, {
  stdio: 'ignore',
  detached: true,
});

child.unref();
console.log(file);
