const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractElectronArchive,
  normalizeExecutablePermissions,
  resolveElectronVersion
} = require('../scripts/download-electron');

function createTempDir(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostra-electron-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  return tempDir;
}

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

test('extracts archives while preserving their original permissions', (t) => {
  const targetDir = createTempDir(t);
  const calls = [];
  const zip = {
    extractAllTo(...args) {
      calls.push(args);
    }
  };

  extractElectronArchive(zip, targetDir, 'win32');
  assert.deepEqual(calls, [[targetDir, true, true]]);
});

test('normalizes every required Linux executable bit', {
  skip: process.platform === 'win32'
}, (t) => {
  const targetDir = createTempDir(t);
  const initialModes = {
    electron: 0o644,
    'chrome-sandbox': 0o4755,
    chrome_crashpad_handler: 0o600
  };
  for (const [fileName, mode] of Object.entries(initialModes)) {
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, 'fixture');
    fs.chmodSync(filePath, mode);
  }

  normalizeExecutablePermissions(targetDir, 'linux');
  assert.deepEqual(
    Object.keys(initialModes).map((fileName) => [
      fileName,
      fs.statSync(path.join(targetDir, fileName)).mode & 0o7777
    ]),
    [
      ['electron', 0o755],
      ['chrome-sandbox', 0o4755],
      ['chrome_crashpad_handler', 0o711]
    ]
  );
});

test('does not rewrite executable permissions on Windows', (t) => {
  const targetDir = createTempDir(t);
  const electronPath = path.join(targetDir, 'electron');
  fs.writeFileSync(electronPath, 'fixture');
  const originalMode = fs.statSync(electronPath).mode;

  normalizeExecutablePermissions(targetDir, 'win32');
  assert.equal(fs.statSync(electronPath).mode, originalMode);
});
