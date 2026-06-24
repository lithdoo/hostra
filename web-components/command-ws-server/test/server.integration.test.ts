import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { createCommandWsServer } from '../src/server.js';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve free port'));
        return;
      }
      const port = address.port;
      s.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function getWithQuery(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET /health with query returns 200', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const code = await getWithQuery(port, '/health?x=1');
    assert.equal(code, 200);
  } finally {
    await server.close();
  }
});

test('WebSocket /terminal receives PTY output', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    const firstMessage = await new Promise<Buffer | string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for PTY output')), 15_000);
      ws.once('message', (data) => {
        clearTimeout(t);
        resolve(data as Buffer | string);
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    const len = typeof firstMessage === 'string' ? firstMessage.length : firstMessage.length;
    assert.ok(len > 0, 'expected non-empty PTY output');
    ws.close();
    await new Promise<void>((r) => {
      ws.once('close', () => r());
    });
  } finally {
    await server.close();
  }
});

test('upgrade rejected when upgradeToken mismatch', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({
    port,
    host: '127.0.0.1',
    upgradeToken: 'secret',
  });
  await server.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('expected error event')), 5000);
      ws.once('open', () => {
        clearTimeout(t);
        reject(new Error('should not open without token'));
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });
    ws.close();
  } finally {
    await server.close();
  }
});

test('upgrade succeeds with matching token', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({
    port,
    host: '127.0.0.1',
    upgradeToken: 'secret',
  });
  await server.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal?token=secret`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 15_000);
      ws.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    ws.close();
    await new Promise<void>((r) => {
      ws.once('close', () => r());
    });
  } finally {
    await server.close();
  }
});

test('maxConnections returns 503 on second socket', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({
    port,
    host: '127.0.0.1',
    maxConnections: 1,
  });
  await server.listen();
  try {
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws1 open timeout')), 15_000);
      ws1.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws1.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws2 expected error')), 8000);
      ws2.once('open', () => {
        clearTimeout(t);
        reject(new Error('ws2 should not open'));
      });
      ws2.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });

    ws1.close();
    ws2.close();
  } finally {
    await server.close();
  }
});

test('WebSocket upgrade with valid workDir query succeeds', async () => {
  const outer = resolve(mkdtempSync(join(tmpdir(), 'cwss-int-')));
  const dir = resolve(join(outer, 'work'));
  const prevRoots = process.env.COMMAND_WS_ALLOWED_ROOTS;
  process.env.COMMAND_WS_ALLOWED_ROOTS = outer;
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    mkdirSync(dir, { recursive: true });
    const href = pathToFileURL(dir).href;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?workDir=${encodeURIComponent(href)}`,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 15_000);
      ws.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    ws.close();
    await new Promise<void>((r) => {
      ws.once('close', () => r());
    });
  } finally {
    await server.close();
    if (prevRoots === undefined) {
      delete process.env.COMMAND_WS_ALLOWED_ROOTS;
    } else {
      process.env.COMMAND_WS_ALLOWED_ROOTS = prevRoots;
    }
    await delay(500);
    rmSync(outer, { recursive: true, force: true });
  }
});

test('WebSocket upgrade with workDir outside allowed roots fails', async () => {
  const allowed = resolve(mkdtempSync(join(tmpdir(), 'cwss-allow-')));
  const outside = resolve(mkdtempSync(join(tmpdir(), 'cwss-out-')));
  const prevRoots = process.env.COMMAND_WS_ALLOWED_ROOTS;
  process.env.COMMAND_WS_ALLOWED_ROOTS = allowed;
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const href = pathToFileURL(outside).href;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?workDir=${encodeURIComponent(href)}`,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('expected error')), 8000);
      ws.once('open', () => {
        clearTimeout(t);
        reject(new Error('should not open'));
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });
    ws.close();
  } finally {
    await server.close();
    if (prevRoots === undefined) {
      delete process.env.COMMAND_WS_ALLOWED_ROOTS;
    } else {
      process.env.COMMAND_WS_ALLOWED_ROOTS = prevRoots;
    }
    rmSync(allowed, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('WebSocket upgrade with workDir missing directory fails', async () => {
  const outer = resolve(mkdtempSync(join(tmpdir(), 'cwss-miss-')));
  const prevRoots = process.env.COMMAND_WS_ALLOWED_ROOTS;
  process.env.COMMAND_WS_ALLOWED_ROOTS = outer;
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const missing = resolve(join(outer, 'does-not-exist'));
    const href = pathToFileURL(missing).href;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?workDir=${encodeURIComponent(href)}`,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('expected error')), 8000);
      ws.once('open', () => {
        clearTimeout(t);
        reject(new Error('should not open'));
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });
    ws.close();
  } finally {
    await server.close();
    if (prevRoots === undefined) {
      delete process.env.COMMAND_WS_ALLOWED_ROOTS;
    } else {
      process.env.COMMAND_WS_ALLOWED_ROOTS = prevRoots;
    }
    await delay(200);
    rmSync(outer, { recursive: true, force: true });
  }
});

test('WebSocket upgrade with workDir pointing to file fails', async () => {
  const outer = resolve(mkdtempSync(join(tmpdir(), 'cwss-file-')));
  const prevRoots = process.env.COMMAND_WS_ALLOWED_ROOTS;
  process.env.COMMAND_WS_ALLOWED_ROOTS = outer;
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    mkdirSync(outer, { recursive: true });
    const filePath = join(outer, 'not-a-dir.txt');
    writeFileSync(filePath, 'x');
    const href = pathToFileURL(filePath).href;
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/terminal?workDir=${encodeURIComponent(href)}`,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('expected error')), 8000);
      ws.once('open', () => {
        clearTimeout(t);
        reject(new Error('should not open'));
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });
    ws.close();
  } finally {
    await server.close();
    if (prevRoots === undefined) {
      delete process.env.COMMAND_WS_ALLOWED_ROOTS;
    } else {
      process.env.COMMAND_WS_ALLOWED_ROOTS = prevRoots;
    }
    await delay(200);
    rmSync(outer, { recursive: true, force: true });
  }
});

test('WebSocket upgrade with malformed workDir percent-encoding fails', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal?workDir=%`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('expected error')), 8000);
      ws.once('open', () => {
        clearTimeout(t);
        reject(new Error('should not open'));
      });
      ws.once('error', () => {
        clearTimeout(t);
        resolve();
      });
    });
    ws.close();
  } finally {
    await server.close();
  }
});

test('WebSocket session accepts client resize text frame without closing', async () => {
  const port = await getFreePort();
  const server = createCommandWsServer({ port, host: '127.0.0.1' });
  await server.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('open timeout')), 15_000);
      ws.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      ws.once('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 30 }));
    await delay(300);
    assert.equal(ws.readyState, WebSocket.OPEN);
    ws.close();
    await new Promise<void>((r) => {
      ws.once('close', () => r());
    });
  } finally {
    await server.close();
  }
});
