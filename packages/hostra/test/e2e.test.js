const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const packageRoot = path.resolve(__dirname, '..');
const cliPath = path.join(packageRoot, 'scripts', 'hostra.js');
const electronPath = path.join(packageRoot, 'electron_bin', process.platform === 'win32' ? 'electron.exe' : 'electron');
const fixturePath = path.join(__dirname, 'fixtures', 'cdp-marker.html');
const stubbornFixturePath = path.join(__dirname, 'fixtures', 'stubborn.html');
const subprocessFixturePath = path.join(__dirname, 'fixtures', 'subprocess.js');

function withTimeout(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after ${milliseconds}ms`)), milliseconds);
    })
  ]).finally(() => clearTimeout(timer));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForFile(filePath) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`File was not created: ${filePath}`);
}

function spawnHostra(overrides = {}, options = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostra-e2e-'));
  if (options.staleDevToolsPort) {
    fs.writeFileSync(path.join(userDataDir, 'DevToolsActivePort'), options.staleDevToolsPort);
  }
  const env = { ...process.env };
  for (const key of [
    'HOSTRA_APP_NAME',
    'HOSTRA_CDP_PORT',
    'HOSTRA_RPC_PORT',
    'HOSTRA_RPC_TOKEN',
    'HOSTRA_SUBCMD',
    'HOSTRA_USER_DATA_DIR'
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    HOSTRA_APP_NAME: `hostra-e2e-${path.basename(userDataDir)}`,
    HOSTRA_CONFIG_DIR: packageRoot,
    HOSTRA_USER_DATA_DIR: userDataDir,
    ...overrides
  });

  const child = spawn(process.execPath, [cliPath], {
    cwd: packageRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let readyValue = null;
  let stdoutBuffer = '';
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    stdout += text;
    stdoutBuffer += text;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('[hostra:event] ')) continue;
      const value = JSON.parse(line.slice('[hostra:event] '.length));
      if (value.type === 'hostra.ready' && !readyValue) {
        readyValue = value;
        resolveReady(value);
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.once('exit', (code, signal) => {
    if (!readyValue) rejectReady(new Error(`Hostra exited before ready (${code || signal})\n${stderr}\n${stdout}`));
  });

  async function cleanup() {
    if (child.exitCode === null && child.signalCode === null) {
      if (readyValue?.data?.pid) {
        try { process.kill(readyValue.data.pid); } catch (error) { }
      }
      try { child.kill(); } catch (error) { }
      await withTimeout(waitForExit(child), 5_000, 'Hostra cleanup').catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const readyWithDiagnostics = withTimeout(ready, 20_000, 'hostra.ready').catch((error) => {
    error.message += `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
    throw error;
  });

  return {
    child,
    ready: readyWithDiagnostics,
    cleanup,
    output: () => ({ stdout, stderr }),
    userDataDir
  };
}

function connectRpc(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    const notifications = [];
    const notificationWaiters = [];
    let nextId = 1;

    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(Object.assign(new Error(message.error.message), message.error));
        else waiter.resolve(message.result);
        return;
      }
      notifications.push(message);
      for (const waiter of [...notificationWaiters]) {
        if (waiter.predicate(message)) {
          notificationWaiters.splice(notificationWaiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    socket.once('error', reject);
    socket.once('open', () => resolve({
      socket,
      notifications,
      call(method, params = {}) {
        const id = nextId++;
        const response = new Promise((resolveCall, rejectCall) => {
          pending.set(id, { resolve: resolveCall, reject: rejectCall });
        });
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        return withTimeout(response, 5_000, `RPC ${method}`);
      },
      waitForNotification(predicate, description = 'RPC notification') {
        const existing = notifications.find(predicate);
        if (existing) return Promise.resolve(existing);
        return withTimeout(new Promise((resolveMessage) => {
          notificationWaiters.push({ predicate, resolve: resolveMessage });
        }), 5_000, description);
      }
    }));
  });
}

async function connectRpcEventually(endpoint) {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await connectRpc(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new Error(`RPC did not become available: ${lastError?.message || 'unknown error'}`);
}

async function waitForCdpTarget(cdpEndpoint, fileName = 'cdp-marker.html') {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const targets = await fetch(`${cdpEndpoint}/json/list`).then((response) => response.json());
    const target = targets.find((item) => item.type === 'page' && item.url.includes(fileName));
    if (target) return target;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('CDP fixture target was not discovered');
}

async function evaluateValue(target, expression, expectedValue) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await withTimeout(new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  }), 5_000, 'CDP WebSocket');

  try {
    const deadline = Date.now() + 10_000;
    let id = 0;
    while (Date.now() < deadline) {
      id += 1;
      const response = new Promise((resolve) => {
        const onMessage = (data) => {
          const message = JSON.parse(data.toString());
          if (message.id === id) {
            socket.off('message', onMessage);
            resolve(message);
          }
        };
        socket.on('message', onMessage);
      });
      socket.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      }));
      const message = await withTimeout(response, 2_000, 'CDP Runtime.evaluate');
      if (message.result?.result?.value === expectedValue) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('CDP marker was not available');
  } finally {
    socket.terminate();
  }
}

test('real Electron closes the RPC/CDP/window lifecycle loop', {
  skip: !fs.existsSync(electronPath),
  timeout: 40_000
}, async (t) => {
  const hostra = spawnHostra(
    { HOSTRA_RPC_PORT: '0', HOSTRA_CDP_PORT: '0' },
    { staleDevToolsPort: '9\n/devtools/browser/stale' }
  );
  t.after(hostra.cleanup);
  const ready = await hostra.ready;

  assert.equal(ready.type, 'hostra.ready');
  assert.equal(ready.data.rpcEndpoint.startsWith('ws://127.0.0.1:'), true);
  assert.equal(ready.data.cdpEndpoint.startsWith('http://127.0.0.1:'), true);
  assert.notEqual(new URL(ready.data.cdpEndpoint).port, '9');
  assert.equal(await fetch(`${ready.data.cdpEndpoint}/json/version`).then((response) => response.status), 200);

  const rpc = await connectRpc(ready.data.rpcEndpoint);
  const initial = await rpc.call('getHostState');
  assert.equal(initial.sessionId, ready.sessionId);
  assert.equal(initial.seq, 0);
  assert.deepEqual(initial.windows, []);
  assert.equal(await rpc.call('getVersion'), '44.1.1');

  const windowId = await rpc.call('openWindow', {
    id: 'fixture',
    loadUrl: fixturePath,
    title: 'Hostra fixture'
  });
  assert.equal(windowId, 'fixture');
  const created = await rpc.waitForNotification((message) => message.params?.type === 'window.created');
  assert.equal(created.params.data.windowId, 'fixture');

  const snapshot = await rpc.call('getHostState');
  assert.equal(snapshot.seq, created.params.seq);
  assert.equal(snapshot.windows[0].webContentsId, created.params.data.webContentsId);
  const legacyWindows = await rpc.call('getAllWindows');
  assert.equal(legacyWindows[0].title, 'Hostra fixture');
  assert.equal(legacyWindows[0].webContentsId, created.params.data.webContentsId);

  const target = await waitForCdpTarget(ready.data.cdpEndpoint);
  await evaluateValue(target, 'window.__HOSTRA_FIXTURE_MARKER__', 'hostra-cdp-ok');

  assert.equal(await rpc.call('closeWindow', { windowId: 'fixture' }), true);
  const closed = await rpc.waitForNotification((message) => message.params?.type === 'window.closed');
  const shuttingDown = await rpc.waitForNotification((message) => message.params?.type === 'host.shuttingDown');
  assert.equal(closed.params.data.webContentsId, created.params.data.webContentsId);
  assert.equal(shuttingDown.params.data.reason, 'window-all-closed');
  assert.deepEqual([created.params.seq, closed.params.seq, shuttingDown.params.seq], [1, 2, 3]);

  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'Hostra graceful exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
  assert.equal((hostra.output().stdout.match(/"type":"hostra.ready"/g) || []).length, 1);
});

test('an occupied fixed RPC port is a startup failure without ready', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => blocker.close());
  const port = blocker.address().port;
  const hostra = spawnHostra({ HOSTRA_RPC_PORT: String(port) });
  t.after(hostra.cleanup);

  await assert.rejects(hostra.ready, /exited before ready/);
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'startup failure exit');
  assert.notEqual(exit.code, 0);
  assert.equal(hostra.output().stdout.includes('"type":"hostra.ready"'), false);
  assert.match(hostra.output().stderr, /EADDRINUSE|startup failed/i);
});

test('CDP disabled reports null and does not prevent RPC compatibility', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const hostra = spawnHostra({ HOSTRA_RPC_PORT: '0' });
  t.after(hostra.cleanup);
  const ready = await hostra.ready;
  assert.equal(ready.data.cdpEndpoint, null);

  const rpc = await connectRpc(ready.data.rpcEndpoint);
  assert.equal(await rpc.call('openWindow', { id: 'compatibility' }), 'compatibility');
  assert.equal(await rpc.call('closeWindow', { windowId: 'compatibility' }), true);
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'CDP-disabled exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
});

test('an occupied fixed CDP port fails before RPC ready', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => blocker.close());
  const port = blocker.address().port;
  const childMarker = path.join(os.tmpdir(), `hostra-child-${process.pid}-${Date.now()}.json`);
  const hostra = spawnHostra({
    HOSTRA_RPC_PORT: '0',
    HOSTRA_CDP_PORT: String(port),
    HOSTRA_SUBCMD: `"${process.execPath}" "${subprocessFixturePath}" "${childMarker}" "${childMarker}.trigger"`
  });
  t.after(hostra.cleanup);

  await assert.rejects(hostra.ready, /exited before ready/);
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'CDP startup failure exit');
  assert.notEqual(exit.code, 0);
  assert.equal(fs.existsSync(childMarker), false);
  assert.match(hostra.output().stderr, /EADDRINUSE|startup failed/i);
});

test('a usable fixed CDP port is verified and reported exactly', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const cdpPort = await getFreePort();
  const hostra = spawnHostra({ HOSTRA_RPC_PORT: '0', HOSTRA_CDP_PORT: String(cdpPort) });
  t.after(hostra.cleanup);
  const ready = await hostra.ready;
  assert.equal(ready.data.cdpEndpoint, `http://127.0.0.1:${cdpPort}`);
  assert.equal(await fetch(`${ready.data.cdpEndpoint}/json/version`).then((response) => response.status), 200);

  const rpc = await connectRpc(ready.data.rpcEndpoint);
  await rpc.call('openWindow', { id: 'fixed-cdp' });
  await rpc.call('closeWindow', { windowId: 'fixed-cdp' });
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'fixed-CDP exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
});

test('subprocess env, ordered events, shutdown rejection, and force convergence work together', {
  skip: !fs.existsSync(electronPath),
  timeout: 40_000
}, async (t) => {
  const rpcPort = await getFreePort();
  const outputPath = path.join(os.tmpdir(), `hostra-subprocess-${process.pid}-${Date.now()}.json`);
  const triggerPath = `${outputPath}.trigger`;
  t.after(() => {
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(triggerPath, { force: true });
  });
  const hostra = spawnHostra({
    HOSTRA_RPC_PORT: String(rpcPort),
    HOSTRA_CDP_PORT: '0',
    HOSTRA_SUBCMD: `"${process.execPath}" "${subprocessFixturePath}" "${outputPath}" "${triggerPath}"`
  });
  t.after(hostra.cleanup);

  const rpcPromise = connectRpcEventually(`ws://127.0.0.1:${rpcPort}`).catch((error) => {
    error.message += `\n${JSON.stringify(hostra.output(), null, 2)}`;
    throw error;
  });
  const rpc = await rpcPromise;
  const ready = await hostra.ready;
  const childEnv = JSON.parse(await waitForFile(outputPath));
  assert.equal(childEnv.rpcPort, String(rpcPort));
  assert.equal(childEnv.cdpPort, new URL(ready.data.cdpEndpoint).port);
  const runningSnapshot = await rpc.call('getHostState');
  assert.equal(runningSnapshot.seq, 1);
  assert.ok(runningSnapshot.subprocess.pid > 0);

  await rpc.call('openWindow', { id: 'stubborn', loadUrl: stubbornFixturePath });
  await rpc.waitForNotification((message) => message.params?.type === 'window.created', 'window.created');
  const target = await waitForCdpTarget(ready.data.cdpEndpoint, 'stubborn.html');
  await evaluateValue(target, 'window.__HOSTRA_STUBBORN_MARKER__', 'ready');

  fs.writeFileSync(triggerPath, 'exit');
  const exited = await rpc.waitForNotification(
    (message) => message.params?.type === 'subprocess.exited',
    'subprocess.exited'
  );
  const shuttingDown = await rpc.waitForNotification(
    (message) => message.params?.type === 'host.shuttingDown',
    'host.shuttingDown(subprocess-exited)'
  );
  assert.equal(exited.params.data.pid, runningSnapshot.subprocess.pid);
  assert.equal(exited.params.data.exitCode, 0);
  assert.equal(shuttingDown.params.data.reason, 'subprocess-exited');

  await assert.rejects(
    rpc.call('openWindow', { id: 'too-late' }),
    (error) => error.code === -32602 && error.message === 'Host is shutting down'
  );
  const snapshot = await rpc.call('getHostState');
  assert.equal(snapshot.host.state, 'shutting-down');
  assert.equal(snapshot.subprocess, null);
  assert.equal(snapshot.windows[0].windowId, 'stubborn');

  const closed = await rpc.waitForNotification((message) => message.params?.type === 'window.closed', 'window.closed');
  assert.ok(closed.params.seq > shuttingDown.params.seq);
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'forced-convergence exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
  assert.match(hostra.output().stderr, /grace period expired/i);
});

test('spawn failure occurs after ready and converges through the error path', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const hostra = spawnHostra({
    HOSTRA_RPC_PORT: '0',
    HOSTRA_CDP_PORT: '0',
    HOSTRA_SUBCMD: `hostra-command-that-does-not-exist-${Date.now()}`
  });
  t.after(hostra.cleanup);
  await hostra.ready;

  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'spawn-failure exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
  assert.match(hostra.output().stderr, /Failed to spawn subprocess \(ENOENT\)/);
  assert.equal((hostra.output().stdout.match(/"type":"hostra.ready"/g) || []).length, 1);
});

test('invalid RPC port text reaches the Main validator unchanged', {
  skip: !fs.existsSync(electronPath),
  timeout: 30_000
}, async (t) => {
  const hostra = spawnHostra({ HOSTRA_RPC_PORT: '123abc' });
  t.after(hostra.cleanup);

  await assert.rejects(hostra.ready, /exited before ready/);
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'invalid-port exit');
  assert.notEqual(exit.code, 0);
  assert.match(hostra.output().stderr, /HOSTRA_RPC_PORT must be an integer/);
  assert.match(hostra.output().stdout, /rpcPort: '123abc'/);
});

test('reconnect recovers the same session and restart creates a new session', {
  skip: !fs.existsSync(electronPath),
  timeout: 45_000
}, async (t) => {
  const firstHost = spawnHostra({ HOSTRA_RPC_PORT: '0' });
  t.after(firstHost.cleanup);
  const firstReady = await firstHost.ready;
  const clientA = await connectRpc(firstReady.data.rpcEndpoint);
  await clientA.call('openWindow', { id: 'reconnect' });
  const created = await clientA.waitForNotification(
    (message) => message.params?.type === 'window.created',
    'window.created before reconnect'
  );
  const beforeDisconnect = await clientA.call('getHostState');
  assert.equal(beforeDisconnect.sessionId, firstReady.sessionId);
  assert.equal(beforeDisconnect.seq, created.params.seq);

  const clientAClosed = new Promise((resolve) => clientA.socket.once('close', resolve));
  clientA.socket.terminate();
  await withTimeout(clientAClosed, 5_000, 'client A disconnect');

  const clientB = await connectRpc(firstReady.data.rpcEndpoint);
  const recovered = await clientB.call('getHostState');
  assert.equal(recovered.sessionId, firstReady.sessionId);
  assert.equal(recovered.seq, beforeDisconnect.seq);
  assert.deepEqual(recovered.windows, beforeDisconnect.windows);

  await clientB.call('closeWindow', { windowId: 'reconnect' });
  const closed = await clientB.waitForNotification(
    (message) => message.params?.type === 'window.closed',
    'window.closed after reconnect'
  );
  assert.equal(closed.params.seq, recovered.seq + 1);
  const firstExit = await withTimeout(waitForExit(firstHost.child), 10_000, 'first session exit');
  assert.equal(firstExit.code, 0, firstHost.output().stderr);

  const secondHost = spawnHostra({ HOSTRA_RPC_PORT: '0' });
  t.after(secondHost.cleanup);
  const secondReady = await secondHost.ready;
  assert.notEqual(secondReady.sessionId, firstReady.sessionId);
  const secondClient = await connectRpc(secondReady.data.rpcEndpoint);
  const fresh = await secondClient.call('getHostState');
  assert.equal(fresh.sessionId, secondReady.sessionId);
  assert.equal(fresh.seq, 0);
  await secondClient.call('openWindow', { id: 'new-session' });
  await secondClient.call('closeWindow', { windowId: 'new-session' });
  const secondExit = await withTimeout(waitForExit(secondHost.child), 10_000, 'second session exit');
  assert.equal(secondExit.code, 0, secondHost.output().stderr);
});

test('CLI SIGTERM produces signal shutdown and converges before exit', {
  skip: !fs.existsSync(electronPath) || process.platform === 'win32',
  timeout: 40_000
}, async (t) => {
  const hostra = spawnHostra({ HOSTRA_RPC_PORT: '0', HOSTRA_CDP_PORT: '0' });
  t.after(hostra.cleanup);
  const ready = await hostra.ready;
  const rpc = await connectRpc(ready.data.rpcEndpoint);
  await rpc.call('openWindow', { id: 'signal-window', loadUrl: stubbornFixturePath });
  await rpc.waitForNotification(
    (message) => message.params?.type === 'window.created',
    'signal fixture creation'
  );
  const target = await waitForCdpTarget(ready.data.cdpEndpoint, 'stubborn.html');
  await evaluateValue(target, 'window.__HOSTRA_STUBBORN_MARKER__', 'ready');

  hostra.child.kill('SIGTERM');
  const shuttingDown = await rpc.waitForNotification(
    (message) => message.params?.type === 'host.shuttingDown',
    'signal shutdown'
  );
  assert.deepEqual(shuttingDown.params.data, { reason: 'signal', signal: 'SIGTERM' });
  const duringShutdown = await rpc.call('getHostState');
  assert.equal(duringShutdown.host.state, 'shutting-down');
  await rpc.waitForNotification(
    (message) => message.params?.type === 'window.closed',
    'signal shutdown window convergence'
  );
  const exit = await withTimeout(waitForExit(hostra.child), 10_000, 'signal shutdown exit');
  assert.equal(exit.code, 0, hostra.output().stderr);
});
