const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createRpcServer } = require('./rpc-server');
const { spawn, execSync } = require('child_process');

if (process.platform === 'win32') {
  try {
    execSync('chcp 65001', { stdio: 'ignore' });
  } catch (e) { }
  try {
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
  } catch (e) { }
}

let rpcServer;
let subprocess;

process.env.ELECHER_RPC_PORT = process.env.ELECHER_RPC_PORT || '9333';
const appName = process.env.ELECHER_APP_NAME;
const rpcPort = parseInt(process.env.ELECHER_RPC_PORT || '9333', 10);
const subCmd = process.env.ELECHER_SUBCMD;
const configDir = process.env.ELECHER_CONFIG_DIR || process.cwd();
const rpcToken = process.env.ELECHER_RPC_TOKEN || '';

console.log('[Main] App name:', appName);
console.log('[Main] RPC port:', rpcPort);
console.log('[Main] SubCmd:', subCmd);
console.log('[Main] Config dir:', configDir);
console.log('[Main] RPC token enabled:', Boolean(rpcToken));

if (appName) {
  app.setName(appName);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Main] Another instance is running, quitting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[Main] Second instance detected');
  });
}

function startSubprocess(cmd) {
  console.log('[Main] Starting subprocess:', cmd);

  const env = {
    ...process.env,
    ELECHER_CONFIG_DIR: configDir,
    PYTHONIOENCODING: 'utf-8'
  };


  const [executable, ...args] = cmd.split(' ');

  subprocess = spawn(executable, args, {
    stdio: 'inherit',
    cwd: configDir,
    env: env,
  });

  subprocess.stdout.on('data', (data) => {
    process.stdout.write(data.toString('utf8'));
  });

  subprocess.stderr.on('data', (data) => {
    process.stderr.write(data.toString('utf8'));
  });

  subprocess.on('close', (code) => {
    console.log(`[Main] Subprocess exited with code ${code}, quitting...`);
    app.quit();
  });
}

process.on('SIGINT', () => {
  console.log('[Main] Received SIGINT, quitting...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Main] Received SIGTERM, quitting...');
  process.exit(0);
});

app.whenReady().then(() => {
  rpcServer = createRpcServer(rpcPort, { token: rpcToken });

  if (subCmd) {
    startSubprocess(subCmd);
  }

  app.on('activate', () => {
  });
});

app.on('window-all-closed', () => {
  if (rpcServer) {
    rpcServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('get-version', () => {
  return process.versions.electron;
});

ipcMain.handle('get-path', (event, name) => {
  return app.getPath(name);
});
