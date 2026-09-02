const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn, execSync } = require('child_process');
const { createRpcServer, LOOPBACK_HOST } = require('./rpc-server');

const CDP_DISCOVERY_TIMEOUT_MS = 10_000;
const SHUTDOWN_GRACE_MS = 1_000;

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (error) { }
  try {
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
  } catch (error) { }
}

function parsePort(name, fallback, enabled) {
  if (!enabled) return fallback;
  const raw = process.env[name];
  if (!/^\d+$/.test(raw || '')) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535`);
  }
  return port;
}

const appName = process.env.HOSTRA_APP_NAME;
const subCmd = process.env.HOSTRA_SUBCMD;
const configDir = process.env.HOSTRA_CONFIG_DIR || process.cwd();
const rpcToken = process.env.HOSTRA_RPC_TOKEN || '';
const userDataDir = process.env.HOSTRA_USER_DATA_DIR || '';

const state = {
  sessionId: crypto.randomUUID(),
  seq: 0,
  shuttingDown: false,
  subprocess: null,
  windows: new Map()
};

let rpcServer = null;
let pendingSubprocess = null;
let shutdownTimer = null;
let shutdownFinishing = false;
let runtimeReady = false;
let startupFailed = false;

if (userDataDir) {
  app.setPath('userData', userDataDir);
}
if (appName) {
  app.setName(appName);
}

console.log('[Main] App name:', appName);
console.log('[Main] Requested RPC port:', process.env.HOSTRA_RPC_PORT ?? 9333);
console.log('[Main] Requested CDP port:', process.env.HOSTRA_CDP_PORT ?? 'disabled');
console.log('[Main] SubCmd:', subCmd);
console.log('[Main] Config dir:', configDir);
console.log('[Main] RPC token enabled:', Boolean(rpcToken));
console.log('[Main] UserData dir:', app.getPath('userData'));

function rpcError(message) {
  return { code: -32602, message };
}

function createRandomWindowId() {
  return `window_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitLifecycle(type, data, mutate = () => {}) {
  mutate();
  const params = {
    sessionId: state.sessionId,
    seq: ++state.seq,
    type,
    data
  };
  if (rpcServer) {
    rpcServer.notify('hostra.event', params);
  }
  return params;
}

function getHostState() {
  return {
    sessionId: state.sessionId,
    seq: state.seq,
    host: {
      state: state.shuttingDown ? 'shutting-down' : 'running',
      pid: process.pid
    },
    subprocess: state.subprocess ? { pid: state.subprocess.pid } : null,
    windows: Array.from(state.windows.values(), (info) => ({
      windowId: info.windowId,
      webContentsId: info.webContentsId
    }))
  };
}

function openWindow(args = {}) {
  if (state.shuttingDown) {
    throw rpcError('Host is shutting down');
  }

  const { id, title, width, height, loadUrl, devTool } = args;
  let windowId = typeof id === 'string' && id.trim() ? id.trim() : '';
  if (windowId && state.windows.has(windowId)) {
    throw rpcError(`Window id already exists: ${windowId}`);
  }
  if (!windowId) {
    do {
      windowId = createRandomWindowId();
    } while (state.windows.has(windowId));
  }

  let url = loadUrl;
  if (loadUrl && !/^https?:\/\//.test(loadUrl) && !loadUrl.startsWith('file://')) {
    url = pathToFileURL(path.resolve(configDir, loadUrl)).href;
  }

  const win = new BrowserWindow({
    width: width || 800,
    height: height || 600,
    title: title || 'Electron',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: devTool || false
    }
  });
  const webContentsId = win.webContents.id;
  const info = { win, option: args, windowId, webContentsId };

  win.once('closed', () => {
    if (!state.windows.has(windowId)) return;
    emitLifecycle('window.closed', { windowId, webContentsId }, () => {
      state.windows.delete(windowId);
    });
    maybeFinishShutdown();
  });

  emitLifecycle('window.created', { windowId, webContentsId }, () => {
    state.windows.set(windowId, info);
  });

  if (url) {
    win.loadURL(url).catch((error) => {
      console.error(`[Main] Failed to load URL for ${windowId}:`, error.message);
    });
  }
  return windowId;
}

function closeWindow(args = {}) {
  const info = state.windows.get(args.windowId);
  if (!info) {
    throw rpcError(`Window not found: ${args.windowId}`);
  }
  info.win.close();
  return true;
}

function getAllWindows() {
  return Array.from(state.windows.values(), (info) => ({
    windowId: info.windowId,
    title: info.option.title || 'Untitled',
    width: info.option.width || 800,
    height: info.option.height || 600,
    loadUrl: info.option.loadUrl || '',
    devTool: info.option.devTool || false,
    webContentsId: info.webContentsId
  }));
}

const methods = {
  getVersion: () => process.versions.electron,
  getPlatform: () => process.platform,
  getArch: () => process.arch,
  getAppPath: (args = {}) => app.getPath(args.name),
  openWindow,
  closeWindow,
  getAllWindows,
  getHostState
};

function splitCommand(command) {
  const parts = [];
  let current = '';
  let quote = '';
  for (const ch of (command || '').trim()) {
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function startSubprocess(command) {
  const parts = splitCommand(command);
  if (parts.length === 0) {
    console.error('[Main] Empty subprocess command.');
    requestShutdown('error');
    return;
  }

  console.log('[Main] Starting subprocess:', command);
  const child = spawn(parts[0], parts.slice(1), {
    stdio: 'inherit',
    cwd: configDir,
    env: { ...process.env, HOSTRA_CONFIG_DIR: configDir, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true
  });
  const record = { child, spawned: false, pid: null };
  pendingSubprocess = record;

  child.once('spawn', () => {
    record.spawned = true;
    record.pid = child.pid;
    pendingSubprocess = null;
    emitLifecycle('subprocess.started', { pid: child.pid }, () => {
      state.subprocess = record;
    });
    if (state.shuttingDown) {
      terminateSubprocess('SIGTERM');
    }
  });

  child.on('error', (error) => {
    if (!record.spawned) {
      pendingSubprocess = null;
      console.error(`[Main] Failed to spawn subprocess (${error.code || 'UNKNOWN'}): ${error.message || String(error)}`);
      emitLifecycle('subprocess.spawnFailed', {
        code: error.code || 'UNKNOWN',
        message: error.message || String(error)
      });
    } else {
      console.error('[Main] Subprocess error:', error.message);
    }
    requestShutdown('error');
  });

  child.once('exit', (exitCode, signal) => {
    if (!record.spawned) return;
    emitLifecycle('subprocess.exited', {
      pid: record.pid,
      exitCode,
      signal
    }, () => {
      if (state.subprocess === record) state.subprocess = null;
    });

    if (!state.shuttingDown) requestShutdown('subprocess-exited');
    else maybeFinishShutdown();
  });
}

function terminateSubprocess(signal) {
  if (!state.subprocess) return;
  try {
    state.subprocess.child.kill(signal);
  } catch (error) {
    console.error(`[Main] Failed to send ${signal} to subprocess:`, error.message);
  }
}

function requestShutdown(reason, extra = {}) {
  if (state.shuttingDown) return false;

  emitLifecycle('host.shuttingDown', { reason, ...extra }, () => {
    state.shuttingDown = true;
  });

  for (const info of state.windows.values()) {
    info.win.close();
  }
  terminateSubprocess('SIGTERM');

  shutdownTimer = setTimeout(() => {
    console.error('[Main] Shutdown grace period expired; forcing convergence.');
    for (const info of state.windows.values()) {
      if (!info.win.isDestroyed()) info.win.destroy();
    }
    terminateSubprocess('SIGKILL');
  }, SHUTDOWN_GRACE_MS);

  maybeFinishShutdown();
  return true;
}

function maybeFinishShutdown() {
  if (
    !state.shuttingDown ||
    shutdownFinishing ||
    state.windows.size !== 0 ||
    state.subprocess !== null ||
    pendingSubprocess !== null
  ) {
    return;
  }

  shutdownFinishing = true;
  setImmediate(() => {
    if (state.windows.size !== 0 || state.subprocess !== null || pendingSubprocess !== null) {
      shutdownFinishing = false;
      return;
    }
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }

    Promise.resolve(rpcServer ? rpcServer.close() : undefined)
      .catch((error) => console.error('[Main] Failed to close RPC server:', error.message))
      .finally(() => {
        rpcServer = null;
        app.quit();
      });
  });
}

function assertFixedCdpPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });
}

function readDevToolsPort(filePath) {
  return fs.promises.readFile(filePath, 'utf8').then((content) => {
    const port = Number.parseInt(content.split(/\r?\n/, 1)[0], 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid DevToolsActivePort: ${content.trim()}`);
    }
    return port;
  });
}

function verifyCdpEndpoint(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: LOOPBACK_HOST,
      port,
      path: '/json/version',
      timeout: 500
    }, (response) => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else reject(new Error(`CDP /json/version returned HTTP ${response.statusCode}`));
    });
    request.once('timeout', () => request.destroy(new Error('CDP request timed out')));
    request.once('error', reject);
  });
}

async function retryUntilDeadline(operation, deadline, description) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`${description} timed out after 10000ms: ${lastError?.message || 'not available'}`);
}

async function configureCdp(cdpEnabled, cdpPort) {
  if (!cdpEnabled) return null;

  if (cdpPort > 0) {
    await assertFixedCdpPortAvailable(cdpPort);
  }

  const activePortPath = path.join(app.getPath('userData'), 'DevToolsActivePort');
  if (cdpPort === 0) {
    fs.rmSync(activePortPath, { force: true });
  }

  app.commandLine.appendSwitch('remote-debugging-address', LOOPBACK_HOST);
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  return activePortPath;
}

async function resolveCdpEndpoint(cdpEnabled, cdpPort, activePortPath) {
  if (!cdpEnabled) return null;
  const deadline = Date.now() + CDP_DISCOVERY_TIMEOUT_MS;
  const actualPort = cdpPort === 0
    ? await retryUntilDeadline(() => readDevToolsPort(activePortPath), deadline, 'CDP port discovery')
    : cdpPort;

  await retryUntilDeadline(() => verifyCdpEndpoint(actualPort), deadline, 'CDP endpoint verification');
  return `http://${LOOPBACK_HOST}:${actualPort}`;
}

function emitReady(cdpEndpoint) {
  const event = {
    sessionId: state.sessionId,
    type: 'hostra.ready',
    data: {
      pid: process.pid,
      rpcEndpoint: rpcServer.endpoint,
      cdpEndpoint
    }
  };
  process.stdout.write(`[hostra:event] ${JSON.stringify(event)}\n`);
}

async function bootstrap() {
  const rpcPort = parsePort('HOSTRA_RPC_PORT', 9333, process.env.HOSTRA_RPC_PORT != null);
  const cdpEnabled = process.env.HOSTRA_CDP_PORT != null;
  const cdpPort = parsePort('HOSTRA_CDP_PORT', null, cdpEnabled);
  const activePortPath = await configureCdp(cdpEnabled, cdpPort);
  await app.whenReady();
  rpcServer = await createRpcServer({
    host: LOOPBACK_HOST,
    port: rpcPort,
    token: rpcToken,
    methods
  });

  const cdpEndpoint = await resolveCdpEndpoint(cdpEnabled, cdpPort, activePortPath);
  process.env.HOSTRA_RPC_PORT = String(rpcServer.port);
  if (cdpEndpoint) {
    process.env.HOSTRA_CDP_PORT = String(new URL(cdpEndpoint).port);
  }

  emitReady(cdpEndpoint);
  runtimeReady = true;
  if (subCmd) startSubprocess(subCmd);
}

async function failStartup(error) {
  if (startupFailed) return;
  startupFailed = true;
  console.error('[Main] Hostra startup failed:', error && error.stack ? error.stack : error);
  if (rpcServer) {
    try {
      await rpcServer.close();
    } catch (closeError) {
      console.error('[Main] Failed to close RPC after startup failure:', closeError.message);
    }
  }
  app.exit(1);
}

function handleShutdownSignal(signal) {
  if (runtimeReady) requestShutdown('signal', { signal });
  else app.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => handleShutdownSignal(signal));
}

if (process.platform !== 'win32') {
  const relaySignals = { SIGHUP: 'SIGINT', SIGUSR2: 'SIGTERM' };
  for (const [relaySignal, originalSignal] of Object.entries(relaySignals)) {
    process.on(relaySignal, () => handleShutdownSignal(originalSignal));
  }
}

app.on('window-all-closed', () => {
  if (runtimeReady && process.platform !== 'darwin') {
    requestShutdown('window-all-closed');
  }
});
ipcMain.handle('get-version', () => process.versions.electron);
ipcMain.handle('get-path', (event, name) => app.getPath(name));

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.error('[Main] Another Hostra instance is running.');
  app.exit(1);
} else {
  app.on('second-instance', () => console.log('[Main] Second instance detected'));
  bootstrap().catch(failStartup);
}
