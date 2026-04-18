import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildTerminalWebSocketUrl } from '../src/terminal/build-terminal-ws-url.js';

test('buildTerminalWebSocketUrl omits invalid work-dir protocol', () => {
  const href = buildTerminalWebSocketUrl({
    baseWsUrl: 'ws://127.0.0.1:8082/terminal',
    workDirUrl: 'http://bad/',
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('workDir'), null);
});

test('buildTerminalWebSocketUrl merges token and workDir', () => {
  const fileHref = pathToFileURL(join(tmpdir(), 'wc-cmd-test')).href;
  assert.ok(
    fileHref.toLowerCase().startsWith('file:'),
    `expected file: href, got ${JSON.stringify(fileHref)}`,
  );
  const href = buildTerminalWebSocketUrl({
    baseWsUrl: 'ws://127.0.0.1:8082/terminal',
    token: 'abc',
    workDirUrl: fileHref,
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('token'), 'abc');
  assert.equal(decodeURIComponent(u.searchParams.get('workDir') ?? ''), fileHref);
});

test('buildTerminalWebSocketUrl preserves existing base query and merges params', () => {
  const fileHref = pathToFileURL(join(tmpdir(), 'wc-merge')).href;
  const href = buildTerminalWebSocketUrl({
    baseWsUrl: 'ws://127.0.0.1:8082/terminal?foo=1&bar=two',
    token: 't',
    workDirUrl: fileHref,
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('foo'), '1');
  assert.equal(u.searchParams.get('bar'), 'two');
  assert.equal(u.searchParams.get('token'), 't');
  assert.equal(decodeURIComponent(u.searchParams.get('workDir') ?? ''), fileHref);
});

test('buildTerminalWebSocketUrl uses custom auth and workDir query param names', () => {
  const fileHref = pathToFileURL(join(tmpdir(), 'wc-custom')).href;
  const href = buildTerminalWebSocketUrl({
    baseWsUrl: 'ws://127.0.0.1:8082/terminal',
    token: 'secret',
    authQueryParam: 'auth',
    workDirUrl: fileHref,
    workDirQueryParam: 'cwd',
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('token'), null);
  assert.equal(u.searchParams.get('auth'), 'secret');
  assert.equal(u.searchParams.get('workDir'), null);
  assert.equal(decodeURIComponent(u.searchParams.get('cwd') ?? ''), fileHref);
});

test('buildTerminalWebSocketUrl does not add token param when token is empty string', () => {
  const href = buildTerminalWebSocketUrl({
    baseWsUrl: 'ws://127.0.0.1:8082/terminal',
    token: '',
    workDirUrl: pathToFileURL(join(tmpdir(), 'wc-empty-token')).href,
  });
  const u = new URL(href);
  assert.equal(u.searchParams.get('token'), null);
  assert.ok(u.searchParams.get('workDir'));
});
