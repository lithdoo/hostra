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
let isShuttingDown = false;

process.env.HOSTRA_RPC_PORT = process.env.HOSTRA_RPC_PORT || '9333';
const appName = process.env.HOSTRA_APP_NAME;
const rpcPort = parseInt(process.env.HOSTRA_RPC_PORT || '9333', 10);
const subCmd = process.env.HOSTRA_SUBCMD;
const configDir = process.env.HOSTRA_CONFIG_DIR || process.cwd();
const rpcToken = process.env.HOSTRA_RPC_TOKEN || '';
const userDataDir = process.env.HOSTRA_USER_DATA_DIR || '';

if (userDataDir) {
  try {
    app.setPath('userData', userDataDir);
  } catch (err) {
    console.error('[Main] Failed to set userData dir:', err);
  }
}

console.log('[Main] App name:', appName);
console.log('[Main] RPC port:', rpcPort);
console.log('[Main] SubCmd:', subCmd);
console.log('[Main] Config dir:', configDir);
console.log('[Main] RPC token enabled:', Boolean(rpcToken));
console.log('[Main] UserData dir:', app.getPath('userData'));

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
    HOSTRA_CONFIG_DIR: configDir,
    PYTHONIOENCODING: 'utf-8'
  };

  const trimmedCmd = (cmd || '').trim();
  if (!trimmedCmd) {
    console.error('[Main] Empty subprocess command.');
    return;
  }

  // Minimal parser with quoted string support, keeping cross-platform behavior
  // without relying on shell/cmd.exe availability.
  const parts = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < trimmedCmd.length; i += 1) {
    const ch = trimmedCmd[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) {
    parts.push(current);
  }

  if (parts.length === 0) {
    console.error('[Main] Invalid subprocess command:', cmd);
    return;
  }

  const executable = parts[0];
  const args = parts.slice(1);

  subprocess = spawn(executable, args, {
    stdio: 'inherit',
    cwd: configDir,
    env: env,
    windowsHide: true
  });

  subprocess.on('error', (err) => {
    console.error('[Main] Failed to start subprocess:', err);
    shutdownAndQuit();
  });

  subprocess.on('close', (code) => {
    console.log(`[Main] Subprocess exited with code ${code}, quitting...`);
    subprocess = null;
    if (!isShuttingDown) {
      shutdownAndQuit();
    }
  });
}

function cleanupSubprocess() {
  if (!subprocess || subprocess.killed) {
    return;
  }

  try {
    subprocess.kill('SIGTERM');
  } catch (err) {
    console.error('[Main] Failed to terminate subprocess gracefully:', err);
  }

  // Fallback force kill if process still alive.
  setTimeout(() => {
    if (subprocess && !subprocess.killed) {
      try {
        subprocess.kill('SIGKILL');
      } catch (err) {
        console.error('[Main] Failed to force kill subprocess:', err);
      }
    }
  }, 1000);
}

function shutdownAndQuit() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (rpcServer) {
    rpcServer.close();
    rpcServer = null;
  }
  cleanupSubprocess();
  app.quit();
}

process.on('SIGINT', () => {
  console.log('[Main] Received SIGINT, quitting...');
  shutdownAndQuit();
});

process.on('SIGTERM', () => {
  console.log('[Main] Received SIGTERM, quitting...');
  shutdownAndQuit();
});

app.whenReady().then(() => {
  rpcServer = createRpcServer(rpcPort, { token: rpcToken });

  if (subCmd) {
    startSubprocess(subCmd);
  }

  app.on('activate', () => {
  });
}).catch((err) => {
  console.error('[Main] app.whenReady failed:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  if (rpcServer) {
    rpcServer.close();
    rpcServer = null;
  }
  cleanupSubprocess();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isShuttingDown = true;
  cleanupSubprocess();
});

ipcMain.handle('get-version', () => {
  return process.versions.electron;
});

ipcMain.handle('get-path', (event, name) => {
  return app.getPath(name);
});
