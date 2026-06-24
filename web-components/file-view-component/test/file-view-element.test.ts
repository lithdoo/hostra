import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewElement } from '../src/component/file-view.js';
import { FakeWebSocket } from './fake-web-socket.js';
import { flushMicrotasks } from './flush-microtasks.js';

const OriginalWebSocket = globalThis.WebSocket;
const TAG = 'file-view-test';

beforeEach(() => {
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  FakeWebSocket.latest = undefined;
  if (!customElements.get(TAG)) {
    customElements.define(TAG, FileViewElement);
  }
});

afterEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal('WebSocket', OriginalWebSocket);
});

describe('FileViewElement', () => {
  it('emits closed when url is missing', async () => {
    const el = document.createElement(TAG) as FileViewElement;
    const statuses: string[] = [];
    el.addEventListener('fv-connection-change', (e) => {
      statuses.push((e as CustomEvent).detail.status);
    });
    document.body.appendChild(el);
    await flushMicrotasks();
    expect(statuses).toContain('closed');
    el.remove();
  });

  it('connects and syncs state via fv.getState when target is empty', async () => {
    const el = document.createElement(TAG) as FileViewElement;
    el.setAttribute('url', 'ws://127.0.0.1:8081/rpc');
    const states: unknown[] = [];
    el.addEventListener('fv-state-changed', (e) => {
      states.push((e as CustomEvent).detail.state);
    });
    document.body.appendChild(el);
    await flushMicrotasks();
    expect(el.currentState).toBeDefined();
    expect(el.currentState?.fileList).toEqual([]);
    expect(states.length).toBeGreaterThanOrEqual(1);
    el.remove();
  });

  it('calls fv.changeTargetDir when target attribute is set', async () => {
    const el = document.createElement(TAG) as FileViewElement;
    el.setAttribute('url', 'ws://127.0.0.1:8081/rpc');
    el.setAttribute('target', 'file:///D:/proj');
    document.body.appendChild(el);
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    const methods = ws.sent.map((raw) => JSON.parse(raw) as { method: string }).map((m) => m.method);
    expect(methods).toContain('fv.changeTargetDir');
    expect(el.currentState?.targetDir?.fileUrl).toBe('file:///D:/proj');
    el.remove();
  });

  it('getRemoteState throws when not connected', async () => {
    const el = document.createElement(TAG) as FileViewElement;
    await expect(el.getRemoteState()).rejects.toThrow('Not connected');
  });

  it('applies fv.onFileChange notification to currentState', async () => {
    const el = document.createElement(TAG) as FileViewElement;
    el.setAttribute('url', 'ws://test/rpc');
    document.body.appendChild(el);
    await flushMicrotasks();
    const ws = FakeWebSocket.latest!;
    const file = {
      kind: 'file' as const,
      name: 'b.txt',
      fileUrl: 'file:///D:/data/b.txt',
      hidden: false,
    };
    ws.notify('fv.onFileChange', { type: 'add', file });
    await flushMicrotasks();
    expect(el.currentState?.fileList.some((f) => f.fileUrl === file.fileUrl)).toBe(true);
    el.remove();
  });
});
