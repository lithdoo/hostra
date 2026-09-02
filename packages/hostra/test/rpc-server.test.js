const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createRpcServer } = require('../rpc-server');

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket) {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

test('binds loopback, resolves an ephemeral port, and dispatches methods', async (t) => {
  const server = await createRpcServer({
    port: 0,
    methods: { echo: ({ value }) => value }
  });
  t.after(() => server.close());

  assert.equal(server.host, '127.0.0.1');
  assert.ok(server.port > 0);
  assert.equal(server.wss.address().address, '127.0.0.1');

  const socket = await openWebSocket(server.endpoint);
  t.after(() => socket.terminate());
  socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: { value: 'ok' } }));

  assert.deepEqual(await nextMessage(socket), { jsonrpc: '2.0', id: 1, result: 'ok' });
});

test('broadcasts JSON-RPC notifications', async (t) => {
  const server = await createRpcServer({ port: 0 });
  t.after(() => server.close());
  const socket = await openWebSocket(server.endpoint);
  t.after(() => socket.terminate());

  const received = nextMessage(socket);
  server.notify('hostra.event', { seq: 1 });
  assert.deepEqual(await received, {
    jsonrpc: '2.0',
    method: 'hostra.event',
    params: { seq: 1 }
  });
});

test('rejects an occupied fixed port', async (t) => {
  const first = await createRpcServer({ port: 0 });
  t.after(() => first.close());

  await assert.rejects(
    createRpcServer({ port: first.port }),
    (error) => error && error.code === 'EADDRINUSE'
  );
});

test('preserves query-token authentication', async (t) => {
  const server = await createRpcServer({
    port: 0,
    token: 'secret',
    methods: { ping: () => 'pong' }
  });
  t.after(() => server.close());

  const unauthorized = new WebSocket(server.endpoint);
  const closeCode = await new Promise((resolve, reject) => {
    unauthorized.once('close', resolve);
    unauthorized.once('error', reject);
  });
  assert.equal(closeCode, 1008);

  const authorized = await openWebSocket(`${server.endpoint}/?token=secret`);
  t.after(() => authorized.terminate());
  authorized.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  assert.deepEqual(await nextMessage(authorized), { jsonrpc: '2.0', id: 1, result: 'pong' });
});
