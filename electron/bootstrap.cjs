const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalReadFileSync = fs.readFileSync.bind(fs);
const retryableReadErrnos = new Set([-11]);
const retryableReadCodes = new Set(['EAGAIN', 'EWOULDBLOCK', 'Unknown system error -11']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableReadError(error) {
  return retryableReadErrnos.has(Number(error?.errno)) || retryableReadCodes.has(String(error?.code || ''));
}

fs.readFileSync = function readFileSyncWithTransientRetry(...args) {
  let latestError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return originalReadFileSync(...args);
    } catch (error) {
      latestError = error;
      if (!isRetryableReadError(error)) throw error;
      sleepSync(25 * (attempt + 1));
    }
  }
  if (args[0] !== null && args[0] !== undefined && typeof args[0] !== 'number') {
    const buffer = readFileBufferInChunksSync(args[0]);
    const options = args[1];
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? buffer.toString(encoding) : buffer;
  }
  throw latestError;
};

function retrySync(fn) {
  let latestError = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      latestError = error;
      if (!isRetryableReadError(error)) throw error;
      sleepSync(Math.min(250, 10 * (attempt + 1)));
    }
  }
  throw latestError;
}

function readFileBufferInChunksSync(filePath) {
  const stat = retrySync(() => fs.statSync(filePath));
  const fd = retrySync(() => fs.openSync(filePath, 'r'));
  const buffer = Buffer.allocUnsafe(stat.size);
  let offset = 0;
  try {
    while (offset < stat.size) {
      const bytesRead = retrySync(() => fs.readSync(fd, buffer, offset, Math.min(4 * 1024, stat.size - offset), offset));
      if (bytesRead <= 0) {
        throw new Error(`Short read while loading ${filePath}: ${offset}/${stat.size}`);
      }
      offset += bytesRead;
    }
  } finally {
    retrySync(() => fs.closeSync(fd));
  }
  return buffer.subarray(0, offset);
}

function loadMainProcess() {
  const bundledFilename = path.join(__dirname, 'main.bundle.cjs');
  const filename = fs.existsSync(bundledFilename) ? bundledFilename : path.join(__dirname, 'main.cjs');
  const mod = new Module(filename, module.parent || module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = mod;
  mod._compile(readFileBufferInChunksSync(filename).toString('utf8'), filename);
}

loadMainProcess();
