import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { createFileViewWsServer } from '../src/server.js';

interface RpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface HttpResponse {
  statusCode: number;
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
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

function postJson(port: number, path: string, body: unknown): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitForOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('open', onOpen);
      ws.off('error', onError);
      reject(new Error('Timed out waiting for websocket open'));
    }, timeoutMs);

    const onOpen = () => {
      clearTimeout(timeout);
      ws.off('error', onError);
      resolve();
    };

    const onError = (error: Error) => {
      clearTimeout(timeout);
      ws.off('open', onOpen);
      reject(error);
    };

    ws.once('open', onOpen);
    ws.once('error', onError);
  });
}

function waitForMessage(
  ws: WebSocket,
  predicate: (message: RpcMessage) => boolean,
  timeoutMs = 4000,
): Promise<RpcMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error('Timed out waiting for message'));
    }, timeoutMs);

    const onMessage = (data: WebSocket.RawData) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      const parsed = JSON.parse(raw) as RpcMessage;
      if (!predicate(parsed)) {
        return;
      }
      clearTimeout(timeout);
      ws.off('message', onMessage);
      resolve(parsed);
    };

    ws.on('message', onMessage);
  });
}

test('server binds fv rpc methods and pushes notifications', async () => {
  const port = await getFreePort();
  const root = await mkdtemp(join(tmpdir(), 'fv-server-'));
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const server = createFileViewWsServer({ port, host: '127.0.0.1', logger });
  await server.listen();

  const ws = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
  try {
    await waitForOpen(ws);
    await writeFile(join(root, 'new.txt'), 'hello');

    const changeRespPromise = waitForMessage(ws, (message) => message.id === 1, 8000);
    const fileChangePromise = waitForMessage(
      ws,
      (message) =>
        message.method === 'fv.onFileChange' &&
        typeof message.params === 'object' &&
        message.params !== null,
      8000,
    );
    const targetDirChangePromise = waitForMessage(
      ws,
      (message) => message.method === 'fv.onTargetDirChange',
      8000,
    );

    ws.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'fv.changeTargetDir',
        params: { targetDirFileUrl: pathToFileURL(root).toString() },
      }),
    );

    const changeResp = await changeRespPromise;
    assert.equal(changeResp.error, undefined);
    assert.ok(changeResp.result);

    const fileChange = await fileChangePromise;
    assert.equal(fileChange.method, 'fv.onFileChange');
    const fileChangeType = (fileChange.params as Record<string, unknown>).type;
    assert.equal(fileChangeType, 'add');

    const targetDirChange = await targetDirChangePromise;
    assert.equal(targetDirChange.method, 'fv.onTargetDirChange');

    const stateRespPromise = waitForMessage(ws, (message) => message.id === 2);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'fv.getState', params: {} }));
    const stateResp = await stateRespPromise;
    assert.equal(stateResp.error, undefined);
    assert.ok(stateResp.result);

    const updatePromise = waitForMessage(
      ws,
      (message) =>
        message.method === 'fv.onFileChange' &&
        typeof message.params === 'object' &&
        message.params !== null &&
        (message.params as Record<string, unknown>).type === 'update' &&
        typeof (message.params as Record<string, unknown>).file === 'object' &&
        (message.params as { file: { name?: string } }).file?.name === 'new.txt',
      8000,
    );
    await writeFile(join(root, 'new.txt.meta.toml'), ['[info]', 'title = "v1"'].join('\n'));
    await updatePromise;

    const stateRespPromise2 = waitForMessage(ws, (message) => message.id === 3, 8000);
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'fv.getState', params: {} }));
    const stateResp2 = await stateRespPromise2;
    assert.equal(stateResp2.error, undefined);
    assert.ok(stateResp2.result && typeof stateResp2.result === 'object');
    const fileList = (stateResp2.result as { fileList?: Array<Record<string, unknown>> }).fileList ?? [];
    const file = fileList.find((item) => item.name === 'new.txt');
    assert.ok(file);
    const metadata = file.metadata as { info?: { title?: string } } | undefined;
    assert.equal(metadata?.info?.title, 'v1');
  } finally {
    ws.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('POST /file/blob returns binary stream', async () => {
  const port = await getFreePort();
  const root = await mkdtemp(join(tmpdir(), 'fv-http-blob-'));
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const server = createFileViewWsServer({ port, host: '127.0.0.1', logger });
  await server.listen();

  try {
    const filePath = join(root, 'blob.bin');
    const content = Buffer.from('blob-content-123', 'utf8');
    await writeFile(filePath, content);
    const fileUrl = pathToFileURL(filePath).toString();

    const resp = await postJson(port, '/file/blob', { fileUrl });
    assert.equal(resp.statusCode, 200);
    assert.equal(resp.headers['content-type'], 'application/octet-stream');
    assert.equal(resp.body.toString('utf8'), 'blob-content-123');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('POST /file/blob returns expected errors', async () => {
  const port = await getFreePort();
  const root = await mkdtemp(join(tmpdir(), 'fv-http-blob-err-'));
  const logger = { info: () => {}, warn: () => {}, error: () => {} };
  const server = createFileViewWsServer({ port, host: '127.0.0.1', logger });
  await server.listen();

  try {
    const invalidProtocol = await postJson(port, '/file/blob', { fileUrl: 'http://example.com/a.txt' });
    assert.equal(invalidProtocol.statusCode, 422);

    const missingFile = await postJson(port, '/file/blob', { fileUrl: pathToFileURL(join(root, 'missing.txt')).toString() });
    assert.equal(missingFile.statusCode, 404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
