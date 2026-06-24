import { AttachAddon } from 'xterm-addon-attach';
import { FitAddon } from 'xterm-addon-fit';
import { type IDisposable, Terminal } from 'xterm';
import xtermCss from 'xterm/css/xterm.css?raw';
import { buildTerminalWebSocketUrl } from '../terminal/build-terminal-ws-url.js';

const LAYOUT_CSS = `
:host {
  display: block;
  min-height: 200px;
  height: 100%;
  box-sizing: border-box;
}
#terminal-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
#terminal-mount {
  flex: 1;
  width: 100%;
  min-height: 0;
  box-sizing: border-box;
}
#connection-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
  box-sizing: border-box;
  background: rgba(11, 18, 32, 0.78);
  color: #e6edf3;
  font: 14px/1.45 system-ui, sans-serif;
  text-align: center;
  pointer-events: auto;
}
#connection-mask[data-visible="true"] {
  display: flex;
}
#mask-loading {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}
#mask-loading[data-active="true"] {
  display: flex;
}
#mask-disconnected {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  max-width: 22rem;
}
#mask-disconnected[data-active="true"] {
  display: flex;
}
#disconnect-text {
  margin: 0;
}
#reconnect-btn {
  cursor: pointer;
  padding: 0.5rem 1.1rem;
  border-radius: 6px;
  border: 1px solid rgba(230, 237, 243, 0.35);
  background: rgba(88, 166, 255, 0.2);
  color: #e6edf3;
  font: inherit;
}
#reconnect-btn:hover {
  background: rgba(88, 166, 255, 0.35);
}
#reconnect-btn:focus-visible {
  outline: 2px solid #58a6ff;
  outline-offset: 2px;
}
.mask-spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid rgba(230, 237, 243, 0.2);
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: cmd-term-spin 0.75s linear infinite;
}
@keyframes cmd-term-spin {
  to { transform: rotate(360deg); }
}
`;

type MaskMode = 'hidden' | 'loading' | 'disconnected';

/**
 * `<command-terminal>` — xterm.js over WebSocket to `@web-editor/command-ws-server`.
 *
 * Attributes:
 * - `ws-url` — WebSocket base URL (e.g. `ws://127.0.0.1:8082/terminal`). Empty = no connection.
 * - `token` — Optional; appended as `token` query param when set.
 * - `work-dir-url` — Optional `file:` URL; sent as `workDir` query on **connect / reconnect only**
 *   (changing this attribute alone does **not** reconnect; call `reconnect()` or change `ws-url`).
 * - `disconnect-message` — Optional; main text when connection fails or drops (default Chinese).
 * - `reconnect-label` — Optional; label for the reconnect button (default 重新连接).
 *
 * While connecting, a **loading** overlay blocks input. On failure or abnormal disconnect,
 * an overlay with a **reconnect** button is shown.
 *
 * After connect, the element sends **text** JSON control frames
 * `{ "type": "resize", "cols", "rows" }` on layout / xterm resize (throttled with
 * `requestAnimationFrame`), in addition to binary I/O from `xterm-addon-attach`.
 */
export class CommandTerminalElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['ws-url', 'token'];
  }

  #shadow: ShadowRoot | null = null;
  #mount: HTMLDivElement | null = null;
  #connectionMask: HTMLElement | null = null;
  #maskLoading: HTMLElement | null = null;
  #maskDisconnected: HTMLElement | null = null;
  #disconnectText: HTMLParagraphElement | null = null;
  #reconnectButton: HTMLButtonElement | null = null;

  #terminal: Terminal | null = null;
  #socket: WebSocket | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #resizeRafId = 0;
  #resizeListenerDisposable: IDisposable | null = null;
  #lastSentResize: { cols: number; rows: number } | null = null;

  #intentionalSocketClose = false;
  #sessionEverReady = false;
  #wsCloseHandler: (() => void) | null = null;

  connectedCallback(): void {
    this.#ensureShadow();
    void this.#reload().catch((err) => {
      this.dispatchEvent(
        new CustomEvent('command-terminal-error', {
          bubbles: true,
          composed: true,
          detail: { message: String(err) },
        }),
      );
    });
  }

  disconnectedCallback(): void {
    this.#dispose();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) {
      return;
    }
    if (!this.isConnected) {
      return;
    }
    if (name === 'ws-url' || name === 'token') {
      void this.#reload().catch((err) => {
        this.dispatchEvent(
          new CustomEvent('command-terminal-error', {
            bubbles: true,
            composed: true,
            detail: { message: String(err) },
          }),
        );
      });
    }
  }

  /** Closes the current session and opens a new WebSocket (picks up latest `work-dir-url`). */
  reconnect(): void {
    void this.#reload().catch((err) => {
      this.dispatchEvent(
        new CustomEvent('command-terminal-error', {
          bubbles: true,
          composed: true,
          detail: { message: String(err) },
        }),
      );
    });
  }

  #defaultDisconnectMessage(): string {
    return '连接已断开或失败，请检查网络或服务后重新连接。';
  }

  #defaultReconnectLabel(): string {
    return '重新连接';
  }

  #disconnectCopy(): string {
    return (
      this.getAttribute('disconnect-message')?.trim() ||
      this.#defaultDisconnectMessage()
    );
  }

  #reconnectCopy(): string {
    return (
      this.getAttribute('reconnect-label')?.trim() || this.#defaultReconnectLabel()
    );
  }

  #setMaskMode(mode: MaskMode, disconnectDetail?: string): void {
    const mask = this.#connectionMask;
    const loading = this.#maskLoading;
    const disc = this.#maskDisconnected;
    const textEl = this.#disconnectText;
    const btn = this.#reconnectButton;
    if (!mask || !loading || !disc || !textEl || !btn) {
      return;
    }

    if (mode === 'hidden') {
      mask.dataset.visible = 'false';
      loading.dataset.active = 'false';
      disc.dataset.active = 'false';
      mask.setAttribute('aria-hidden', 'true');
      return;
    }

    mask.dataset.visible = 'true';
    mask.setAttribute('aria-hidden', 'false');

    if (mode === 'loading') {
      loading.dataset.active = 'true';
      disc.dataset.active = 'false';
      return;
    }

    loading.dataset.active = 'false';
    disc.dataset.active = 'true';
    textEl.textContent =
      disconnectDetail?.trim() || this.#disconnectCopy();
    btn.textContent = this.#reconnectCopy();
    queueMicrotask(() => {
      try {
        btn.focus();
      } catch {
        /* ignore */
      }
    });
  }

  #ensureShadow(): void {
    if (this.#shadow !== null) {
      return;
    }
    const root = this.attachShadow({ mode: 'open' });
    this.#shadow = root;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${xtermCss}\n${LAYOUT_CSS}`);
    root.adoptedStyleSheets = [sheet];

    const wrap = document.createElement('div');
    wrap.id = 'terminal-wrap';

    const mount = document.createElement('div');
    mount.id = 'terminal-mount';

    const mask = document.createElement('div');
    mask.id = 'connection-mask';
    mask.dataset.visible = 'false';
    mask.setAttribute('aria-hidden', 'true');

    const loading = document.createElement('div');
    loading.id = 'mask-loading';
    loading.dataset.active = 'false';
    loading.setAttribute('aria-busy', 'false');
    const spinner = document.createElement('div');
    spinner.className = 'mask-spinner';
    const loadingHint = document.createElement('span');
    loadingHint.textContent = '正在连接…';
    loading.appendChild(spinner);
    loading.appendChild(loadingHint);

    const disc = document.createElement('div');
    disc.id = 'mask-disconnected';
    disc.dataset.active = 'false';
    disc.setAttribute('aria-live', 'polite');
    const p = document.createElement('p');
    p.id = 'disconnect-text';
    const btn = document.createElement('button');
    btn.id = 'reconnect-btn';
    btn.type = 'button';
    btn.addEventListener('click', () => {
      this.reconnect();
    });
    disc.appendChild(p);
    disc.appendChild(btn);

    mask.appendChild(loading);
    mask.appendChild(disc);
    wrap.appendChild(mount);
    wrap.appendChild(mask);
    root.appendChild(wrap);

    this.#mount = mount;
    this.#connectionMask = mask;
    this.#maskLoading = loading;
    this.#maskDisconnected = disc;
    this.#disconnectText = p;
    this.#reconnectButton = btn;
  }

  async #reload(): Promise<void> {
    this.#dispose();
    await this.#boot();
  }

  async #boot(): Promise<void> {
    const base = this.getAttribute('ws-url')?.trim() ?? '';
    if (base === '') {
      this.#setMaskMode('hidden');
      this.#sessionEverReady = false;
      return;
    }
    if (this.#mount === null) {
      return;
    }

    this.#intentionalSocketClose = false;
    this.#sessionEverReady = false;
    this.#setMaskMode('loading');
    if (this.#maskLoading) {
      this.#maskLoading.setAttribute('aria-busy', 'true');
    }

    const token = this.getAttribute('token')?.trim() || undefined;
    const workDirUrl = this.getAttribute('work-dir-url')?.trim() || undefined;
    const href = buildTerminalWebSocketUrl({
      baseWsUrl: base,
      token,
      workDirUrl,
    });

    const ws = new WebSocket(href);
    ws.binaryType = 'arraybuffer';
    this.#socket = ws;

    try {
      await new Promise<void>((resolve, reject) => {
        const ms = 15_000;
        const t = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket open timeout'));
        }, ms);
        ws.addEventListener(
          'open',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
        ws.addEventListener(
          'error',
          () => {
            clearTimeout(t);
            reject(new Error('WebSocket connection failed'));
          },
          { once: true },
        );
      });
    } catch (e) {
      if (this.#maskLoading) {
        this.#maskLoading.setAttribute('aria-busy', 'false');
      }
      const message = String((e as Error)?.message ?? e);
      this.#setMaskMode('disconnected', message);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      this.#socket = null;
      this.dispatchEvent(
        new CustomEvent('command-terminal-error', {
          bubbles: true,
          composed: true,
          detail: { message },
        }),
      );
      return;
    }

    if (this.#maskLoading) {
      this.#maskLoading.setAttribute('aria-busy', 'false');
    }

    const term = new Terminal({ convertEol: true });
    const fit = new FitAddon();
    const attach = new AttachAddon(ws);
    term.loadAddon(fit);
    term.loadAddon(attach);
    term.open(this.#mount);
    fit.fit();
    if (term.cols < 2 || term.rows < 1) {
      term.resize(80, 25);
    }

    this.#terminal = term;

    const flushResizeSend = () => {
      if (ws.readyState !== 1 || this.#terminal === null) {
        return;
      }
      let cols = this.#terminal.cols;
      let rows = this.#terminal.rows;
      if (!Number.isFinite(cols) || cols < 2) {
        cols = 80;
      }
      if (!Number.isFinite(rows) || rows < 1) {
        rows = 25;
      }
      const prev = this.#lastSentResize;
      if (prev !== null && prev.cols === cols && prev.rows === rows) {
        return;
      }
      try {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        this.#lastSentResize = { cols, rows };
      } catch {
        /* ignore */
      }
    };

    const scheduleResizeNotify = () => {
      if (this.#resizeRafId !== 0) {
        return;
      }
      this.#resizeRafId = requestAnimationFrame(() => {
        this.#resizeRafId = 0;
        flushResizeSend();
      });
    };

    flushResizeSend();

    // xterm normally exposes `onResize` as an IEvent callable; some DOM stubs omit it.
    if (typeof term.onResize === 'function') {
      this.#resizeListenerDisposable = term.onResize(() => {
        scheduleResizeNotify();
      });
    } else {
      this.#resizeListenerDisposable = null;
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      scheduleResizeNotify();
    });
    ro.observe(this.#mount);
    this.#resizeObserver = ro;

    this.#sessionEverReady = true;
    this.#setMaskMode('hidden');

    const onClose = () => {
      this.dispatchEvent(
        new CustomEvent('command-terminal-close', {
          bubbles: true,
          composed: true,
          detail: {},
        }),
      );
      if (!this.#intentionalSocketClose && this.#sessionEverReady) {
        this.#sessionEverReady = false;
        try {
          this.#terminal?.blur();
        } catch {
          /* ignore */
        }
        if (this.#maskLoading) {
          this.#maskLoading.setAttribute('aria-busy', 'false');
        }
        this.#setMaskMode('disconnected');
      }
    };
    this.#wsCloseHandler = onClose;
    ws.addEventListener('close', onClose);
  }

  #dispose(): void {
    this.#intentionalSocketClose = true;

    const ws = this.#socket;
    if (ws !== null && this.#wsCloseHandler !== null) {
      try {
        ws.removeEventListener('close', this.#wsCloseHandler);
      } catch {
        /* ignore */
      }
    }
    this.#wsCloseHandler = null;

    if (this.#resizeRafId !== 0) {
      cancelAnimationFrame(this.#resizeRafId);
      this.#resizeRafId = 0;
    }
    try {
      this.#resizeListenerDisposable?.dispose();
    } catch {
      /* ignore */
    }
    this.#resizeListenerDisposable = null;
    this.#lastSentResize = null;

    try {
      this.#resizeObserver?.disconnect();
    } catch {
      /* ignore */
    }
    this.#resizeObserver = null;

    try {
      this.#socket?.close();
    } catch {
      /* ignore */
    }
    this.#socket = null;

    try {
      this.#terminal?.dispose();
    } catch {
      /* ignore */
    }
    this.#terminal = null;

    this.#sessionEverReady = false;
    if (this.#maskLoading) {
      this.#maskLoading.setAttribute('aria-busy', 'false');
    }
  }
}
