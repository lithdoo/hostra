import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import {
  isPathUnderAllowedRoots,
  resolveAllowedRootsForWorkDirQuery,
  resolveWorkDirQueryParam,
} from '../src/terminal-path-policy.js';

test('isPathUnderAllowedRoots accepts child directory', () => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'cwsp-r-')));
  const child = resolve(join(root, 'nested'));
  mkdirSync(child, { recursive: true });
  assert.equal(isPathUnderAllowedRoots(child, [normalize(root)]), true);
  rmSync(root, { recursive: true, force: true });
});

test('isPathUnderAllowedRoots rejects parent escape', () => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'cwsp-r2-')));
  const outside = resolve(join(root, '..', 'outside-cwsp'));
  assert.equal(isPathUnderAllowedRoots(outside, [normalize(root)]), false);
  rmSync(root, { recursive: true, force: true });
});

test('resolveWorkDirQueryParam accepts valid file URL under root', () => {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'cwsp-wd-')));
  try {
    const href = pathToFileURL(dir).href;
    const r = resolveWorkDirQueryParam(encodeURIComponent(href), [normalize(dir)]);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolvedPath, normalize(dir));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveWorkDirQueryParam rejects non-file protocol', () => {
  const r = resolveWorkDirQueryParam(encodeURIComponent('http://x/'), [
    normalize(resolve(tmpdir())),
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'protocol');
  }
});

test('resolveWorkDirQueryParam rejects path outside roots', () => {
  const dir = resolve(mkdtempSync(join(tmpdir(), 'cwsp-out-')));
  const other = resolve(mkdtempSync(join(tmpdir(), 'cwsp-allow-')));
  try {
    const href = pathToFileURL(dir).href;
    const r = resolveWorkDirQueryParam(encodeURIComponent(href), [normalize(other)]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'outside');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('resolveAllowedRootsForWorkDirQuery warns once and defaults to cwd when env unset', () => {
  const prev = process.env.COMMAND_WS_ALLOWED_ROOTS;
  delete process.env.COMMAND_WS_ALLOWED_ROOTS;
  const warns: string[] = [];
  const log = {
    warn(m: string): void {
      warns.push(m);
    },
  };
  try {
    const roots = resolveAllowedRootsForWorkDirQuery(log);
    assert.equal(roots.length, 1);
    assert.equal(roots[0], normalize(resolve(process.cwd())));
    assert.equal(warns.length, 1);
    assert.ok(
      warns[0].includes('COMMAND_WS_ALLOWED_ROOTS unset'),
      `expected unset warning, got ${JSON.stringify(warns[0])}`,
    );
    assert.ok(warns[0].includes(roots[0]));
  } finally {
    if (prev === undefined) {
      delete process.env.COMMAND_WS_ALLOWED_ROOTS;
    } else {
      process.env.COMMAND_WS_ALLOWED_ROOTS = prev;
    }
  }
});

test('resolveWorkDirQueryParam rejects file URL when path is a regular file', () => {
  const root = resolve(mkdtempSync(join(tmpdir(), 'cwsp-notdir-')));
  try {
    mkdirSync(root, { recursive: true });
    const filePath = join(root, 'plain.txt');
    writeFileSync(filePath, '');
    const href = pathToFileURL(filePath).href;
    const r = resolveWorkDirQueryParam(href, [normalize(root)]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'notdir');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
