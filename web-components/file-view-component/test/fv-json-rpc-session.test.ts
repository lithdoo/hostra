import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FvJsonRpcError, FvJsonRpcSession } from '../src/rpc/fv-json-rpc-session.js';
import { FakeWebSocket } from './fake-web-socket.js';
import { flushMicrotasks } from './flush-microtasks.js';

const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  FakeWebSocket.latest = undefined;
});

afterEach(() => {
  vi.stubGlobal('WebSocket', OriginalWebSocket);
});

describe('FvJsonRpcSession', () => {
  it('emits connecting then open', async () => {
    const statuses: string[] = [];
    const session = new FvJsonRpcSession({
      url: 'ws://test/rpc',
      onConnectionChange: (d) => {
        statuses.push(d.status);
      },
    });
    await session.open();
    await flushMicrotasks();
    expect(statuses).toEqual(['connecting', 'open']);
    session.close();
    await flushMicrotasks();
    expect(statuses.at(-1)).toBe('closed');
  });

  it('resolves callGetState with IFVState', async () => {
    const session = new FvJsonRpcSession({ url: 'ws://test/rpc' });
    await session.open();
    await flushMicrotasks();
    const state = await session.callGetState();
    expect(state.fileList).toEqual([]);
    expect(state.targetDir).toBeUndefined();
    session.close();
  });

  it('resolves callChangeTargetDir', async () => {
    const session = new FvJsonRpcSession({ url: 'ws://test/rpc' });
    await session.open();
    await flushMicrotasks();
    const state = await session.callChangeTargetDir('file:///D:/data');
    expect(state.targetDir?.fileUrl).toBe('file:///D:/data');
    session.close();
  });

  it('rejects with FvJsonRpcError on JSON-RPC error', async () => {
    const session = new FvJsonRpcSession({ url: 'ws://test/rpc' });
    await session.open();
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    ws.responder = () => ({ error: { code: -32001, message: 'Target missing' } });
    await expect(session.callGetState()).rejects.toSatisfy((err: unknown) => {
      return (
        err instanceof FvJsonRpcError && err.code === -32001 && err.message === 'Target missing'
      );
    });
    session.close();
  });

  it('invokes onFileChange for fv.onFileChange notification', async () => {
    const seen: Array<{ type: string; fileUrl: string }> = [];
    const session = new FvJsonRpcSession({
      url: 'ws://test/rpc',
      handlers: {
        onFileChange: (type, file) => {
          seen.push({ type, fileUrl: file.fileUrl });
        },
      },
    });
    await session.open();
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    const file = {
      kind: 'file' as const,
      name: 'a.txt',
      fileUrl: 'file:///D:/data/a.txt',
      hidden: false,
    };
    ws.notify('fv.onFileChange', { type: 'add', file });
    await flushMicrotasks();
    expect(seen).toEqual([{ type: 'add', fileUrl: 'file:///D:/data/a.txt' }]);
    session.close();
  });

  it('invokes onTargetDirChange for fv.onTargetDirChange notification', async () => {
    let seen: { fileList: unknown[] } | undefined;
    const session = new FvJsonRpcSession({
      url: 'ws://test/rpc',
      handlers: {
        onTargetDirChange: (state) => {
          seen = { fileList: state.fileList };
        },
      },
    });
    await session.open();
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    const state = {
      fileList: [
        {
          kind: 'file' as const,
          name: 'x.txt',
          fileUrl: 'file:///D:/x.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory' as const,
        name: 'root',
        fileUrl: 'file:///D:/',
        hidden: false,
      },
    };
    ws.notify('fv.onTargetDirChange', { state });
    await flushMicrotasks();
    expect(seen?.fileList).toHaveLength(1);
    session.close();
  });

  it('rejects pending requests when socket closes', async () => {
    const session = new FvJsonRpcSession({ url: 'ws://test/rpc' });
    await session.open();
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    ws.responder = () => new Promise(() => {}); // never respond
    const pending = session.callGetState();
    session.close();
    await flushMicrotasks();
    await expect(pending).rejects.toThrow('Connection closed');
  });
});
