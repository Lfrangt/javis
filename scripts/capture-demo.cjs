#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const mode = 'pet';
const outputArg = process.argv.find((arg) => arg.endsWith('.png'));
const outputFile = outputArg
  ? path.resolve(outputArg)
  : path.join(process.cwd(), 'artifacts', 'javis-demo-pet.png');

const windowSizes = {
  pet: { width: 196, height: 56 },
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const size = windowSizes[mode];
  const distIndex = path.join(process.cwd(), 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('Missing dist/index.html. Run npm run build first.');
  }

  await app.whenReady();
  const window = new BrowserWindow({
    ...size,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(distIndex);
  await wait(800);

  const image = await window.capturePage();
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, image.toPNG());
  console.log(outputFile);
  app.quit();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
