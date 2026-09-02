const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveElectronVersion } = require('../scripts/download-electron');

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
