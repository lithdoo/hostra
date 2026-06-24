import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';

const TAG = 'command-terminal-test';

let origWebSocket: typeof WebSocket;

/** Counters for the WebSocket stub installed in `before()`. */
const wsStubProbe = {
  opens: 0,
  lastUrl: '',
  textSends: [] as string[],
  /** Latest stub instance (set in constructor). */
  lastInstance: null as StubWebSocketInstance | null,
};

type StubWebSocketInstance = EventTarget & {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(): void;
};

function installHappyDomGlobals(): Window {
  const win = new Window({ url: 'http://localhost/', width: 800, height: 600 });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  g.customElements = win.customElements;
  g.HTMLElement = win.HTMLElement;
  g.Element = win.Element;
  g.Node = win.Node;
  g.MutationObserver = win.MutationObserver;
  g.ResizeObserver = win.ResizeObserver;
  g.CSSStyleSheet = win.CSSStyleSheet;
  g.Event = win.Event;
  g.CustomEvent = win.CustomEvent;
  g.EventTarget = win.EventTarget;
  g.requestAnimationFrame = win.requestAnimationFrame.bind(win);
  g.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  win.document.body.style.width = '1024px';
  win.document.body.style.height = '768px';
  return win;
}

before(async () => {
  origWebSocket = globalThis.WebSocket;
  installHappyDomGlobals();

  const EventTargetCtor = globalThis.EventTarget;
  const EventCtor = globalThis.Event;

  class StubWebSocket extends EventTargetCtor {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    binaryType = '';
    readyState = StubWebSocket.CONNECTING;

    constructor(url: string | URL) {
      super();
      const href = typeof url === 'string' ? url : url.toString();
      wsStubProbe.opens += 1;
      wsStubProbe.lastUrl = href;
      wsStubProbe.lastInstance = this as unknown as StubWebSocketInstance;
      queueMicrotask(() => {
        this.readyState = StubWebSocket.OPEN;
        this.dispatchEvent(new EventCtor('open'));
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      if (typeof data === 'string') {
        wsStubProbe.textSends.push(data);
      }
    }

    close(): void {
      if (this.readyState === StubWebSocket.CLOSED) {
        return;
      }
      this.readyState = StubWebSocket.CLOSED;
      this.dispatchEvent(new EventCtor('close'));
    }
  }

  globalThis.WebSocket = StubWebSocket as unknown as typeof WebSocket;

  const mod = await import('../src/component/command-terminal.js');
  if (!customElements.get(TAG)) {
    customElements.define(TAG, mod.CommandTerminalElement);
  }
});

after(() => {
  globalThis.WebSocket = origWebSocket;
});

async function flush(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => setTimeout(r, 0));
}

test('sends resize control JSON over WebSocket after terminal boots', async () => {
  wsStubProbe.opens = 0;
  wsStubProbe.textSends.length = 0;

  const el = document.createElement(TAG) as HTMLElement & { reconnect(): void };
  el.style.display = 'block';
  el.style.width = '1200px';
  el.style.height = '800px';
  el.setAttribute('ws-url', 'ws://127.0.0.1:9999/terminal');
  document.body.appendChild(el);
  await flush();
  await flush();
  await new Promise<void>((r) => setTimeout(r, 50));

  const resizePayloads = wsStubProbe.textSends.filter((s) => {
    try {
      const o = JSON.parse(s) as { type?: string };
      return o.type === 'resize';
    } catch {
      return false;
    }
  });
  assert.ok(resizePayloads.length >= 1, 'expected at least one resize JSON');
  const msg = JSON.parse(resizePayloads[resizePayloads.length - 1]!) as {
    type?: string;
    cols?: number;
    rows?: number;
  };
  assert.equal(msg.type, 'resize');
  assert.equal(typeof msg.cols, 'number');
  assert.equal(typeof msg.rows, 'number');
  assert.ok(Number.isInteger(msg.cols) && msg.cols! > 0);
  assert.ok(Number.isInteger(msg.rows) && msg.rows! > 0);

  el.remove();
});

test('connection mask is hidden after successful boot', async () => {
  wsStubProbe.opens = 0;

  const el = document.createElement(TAG) as HTMLElement;
  el.style.display = 'block';
  el.style.width = '800px';
  el.style.height = '600px';
  el.setAttribute('ws-url', 'ws://127.0.0.1:9999/terminal');
  document.body.appendChild(el);
  await flush();
  await flush();
  await new Promise<void>((r) => setTimeout(r, 50));

  const mask = el.shadowRoot!.querySelector('#connection-mask') as HTMLElement;
  assert.equal(mask.dataset.visible, 'false');
  assert.equal(mask.getAttribute('aria-hidden'), 'true');

  el.remove();
});

test('abnormal WebSocket close shows reconnect mask; button reconnects', async () => {
  wsStubProbe.opens = 0;

  const el = document.createElement(TAG) as HTMLElement;
  el.style.display = 'block';
  el.style.width = '800px';
  el.style.height = '600px';
  el.setAttribute('ws-url', 'ws://127.0.0.1:9999/terminal');
  document.body.appendChild(el);
  await flush();
  await flush();
  await new Promise<void>((r) => setTimeout(r, 50));

  const ws = wsStubProbe.lastInstance;
  assert.ok(ws);
  const maskBefore = el.shadowRoot!.querySelector('#connection-mask') as HTMLElement;
  assert.equal(maskBefore.dataset.visible, 'false');

  ws.close();
  await flush();

  const mask = el.shadowRoot!.querySelector('#connection-mask') as HTMLElement;
  assert.equal(mask.dataset.visible, 'true');
  const disc = el.shadowRoot!.querySelector('#mask-disconnected') as HTMLElement;
  assert.equal(disc.dataset.active, 'true');
  const btn = el.shadowRoot!.querySelector('#reconnect-btn') as HTMLButtonElement;
  assert.ok(btn);

  const opensBefore = wsStubProbe.opens;
  btn.click();
  await flush();
  await flush();
  await new Promise<void>((r) => setTimeout(r, 50));

  assert.ok(wsStubProbe.opens > opensBefore);
  const maskAfter = el.shadowRoot!.querySelector('#connection-mask') as HTMLElement;
  assert.equal(maskAfter.dataset.visible, 'false');

  el.remove();
});

test('work-dir-url alone does not reconnect; reconnect() opens again with updated workDir', async () => {
  wsStubProbe.opens = 0;
  wsStubProbe.textSends.length = 0;
  const dirA = pathToFileURL(join(tmpdir(), 'wcc-term-a')).href;
  const dirB = pathToFileURL(join(tmpdir(), 'wcc-term-b')).href;

  const el = document.createElement(TAG) as HTMLElement & { reconnect(): void };
  el.setAttribute('ws-url', 'ws://127.0.0.1:9999/terminal');
  el.setAttribute('work-dir-url', dirA);
  document.body.appendChild(el);
  await flush();

  assert.equal(wsStubProbe.opens, 1);
  const u1 = new URL(wsStubProbe.lastUrl);
  assert.equal(u1.searchParams.get('workDir'), dirA);

  const afterFirst = wsStubProbe.opens;
  el.setAttribute('work-dir-url', dirB);
  await flush();
  assert.equal(
    wsStubProbe.opens,
    afterFirst,
    'changing work-dir-url only must not open a new WebSocket',
  );

  el.reconnect();
  await flush();
  assert.equal(wsStubProbe.opens, 2);
  const u2 = new URL(wsStubProbe.lastUrl);
  assert.equal(u2.searchParams.get('workDir'), dirB);

  el.remove();
});
