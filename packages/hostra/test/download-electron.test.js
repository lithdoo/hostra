const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractElectronArchive,
  normalizeExecutablePermissions,
  resolveElectronVersion
} = require('../scripts/download-electron');

test('uses the package-pinned Electron version by default', () => {
  assert.equal(resolveElectronVersion({}), '44.1.1');
});

test('allows an exact install-time Electron version override', () => {
  assert.equal(resolveElectronVersion({ HOSTRA_ELECTRON_VERSION: '45.0.0-beta.1' }), '45.0.0-beta.1');
});

test('rejects non-exact Electron version overrides', () => {
  assert.throws(
    () => resolveElectronVersion({ HOSTRA_ELECTRON_VERSION: 'latest' }),
    /exact version/
  );
});

test('extracts archives while preserving their original permissions', () => {
  const calls = [];
  const zip = {
    extractAllTo(...args) {
      calls.push(args);
    }
  };
  const fileSystem = { existsSync: () => false };

  extractElectronArchive(zip, '/electron', 'linux', fileSystem);
  assert.deepEqual(calls, [['/electron', true, true]]);
});

test('normalizes every required Linux executable bit', () => {
  const modes = new Map([
    ['electron', 0o100644],
    ['chrome-sandbox', 0o104755],
    ['chrome_crashpad_handler', 0o100600]
  ]);
  const chmodCalls = [];
  const fileSystem = {
    existsSync: () => true,
    statSync(filePath) {
      return { mode: modes.get(filePath.split(/[\\/]/).pop()) };
    },
    chmodSync(filePath, mode) {
      chmodCalls.push([filePath.split(/[\\/]/).pop(), mode]);
    }
  };

  normalizeExecutablePermissions('/electron', 'linux', fileSystem);
  assert.deepEqual(chmodCalls, [
    ['electron', 0o755],
    ['chrome-sandbox', 0o4755],
    ['chrome_crashpad_handler', 0o711]
  ]);
});

test('does not rewrite executable permissions on Windows', () => {
  let touched = false;
  normalizeExecutablePermissions('/electron', 'win32', {
    existsSync() {
      touched = true;
      return true;
    }
  });
  assert.equal(touched, false);
});
