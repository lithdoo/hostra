#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronBinDir = path.join(__dirname, '..', 'electron_bin');
const mainPath = path.join(__dirname, '..', 'main.js');

const electronExe = process.platform === 'win32' ? 'electron.exe' : 'electron';
const electronPath = path.join(electronBinDir, electronExe);

function parseDotEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    if (!key) continue;

    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = parseDotEnv(content);

  // Keep explicit shell env higher priority than .env file.
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function loadConfig() {
  loadDotEnvFile(path.join(process.cwd(), '.env'));

  const envPort = Number.parseInt(process.env.ELECHER_RPC_PORT || '', 10);
  const envConfigDir = process.env.ELECHER_CONFIG_DIR || process.cwd();
  return {
    appName: process.env.ELECHER_APP_NAME || null,
    port: Number.isFinite(envPort) ? envPort : 9333,
    cmd: process.env.ELECHER_SUBCMD || null,
    configDir: envConfigDir,
    rpcToken: process.env.ELECHER_RPC_TOKEN || null
  };
}

const config = loadConfig();

console.log('[hostra] Config:', config);

const env = { ...process.env };

if (config.appName) {
  env.ELECHER_APP_NAME = config.appName;
}

env.ELECHER_RPC_PORT = config.port.toString();

if (config.cmd) {
  env.ELECHER_SUBCMD = config.cmd;
}

env.ELECHER_CONFIG_DIR = config.configDir;
if (config.rpcToken) {
  env.ELECHER_RPC_TOKEN = config.rpcToken;
}

console.log('[hostra] Electron path:', electronPath);

const child = spawn(electronPath, [mainPath], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env
});

child.on('close', (code) => {
  process.exit(code);
});
