import {
  FvJsonRpcError,
  FvJsonRpcSession,
  type FvConnectionStatus,
} from '../rpc/fv-json-rpc-session.js';
import type { FVDirectory, FVFile, IFVState } from '../types/fv-models.js';

function cloneState(state: IFVState): IFVState {
  return structuredClone(state);
}

function parseAutoReconnectTimeoutMs(attr: string | null): number | undefined {
  if (attr === null || attr.trim() === '') {
    return undefined;
  }
  const n = Number(attr.trim());
  if (!Number.isFinite(n) || n < 0) {
    return undefined;
  }
  return n;
}

export interface FvSelectionChangedDetail {
  fileUrls: readonly string[];
}

function setsEqualString(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}

function applyFileListMutation(
  base: IFVState | undefined,
  type: 'add' | 'remove' | 'update',
  file: FVFile | FVDirectory,
): IFVState {
  const next: IFVState = base ? cloneState(base) : { fileList: [], targetDir: undefined };
  const list = next.fileList;
  const idx = list.findIndex((e) => e.fileUrl === file.fileUrl);

  if (type === 'remove') {
    next.fileList = list.filter((e) => e.fileUrl !== file.fileUrl);
    return next;
  }

  if (idx >= 0) {
    list[idx] = file;
  } else {
    list.push(file);
  }
  next.fileList = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

/**
 * `<file-view>` — JSON-RPC client for `@web-editor/file-view-ws-server` (no list/thumbnail UI).
 *
 * Attributes:
 * - `url` — WebSocket JSON-RPC endpoint (e.g. `ws://127.0.0.1:8081/rpc`).
 * - `target` — `targetDirFileUrl` passed to `fv.changeTargetDir` (typically `file:///...`). Empty / missing clears via `fv.clearTargetDir`.
 * - `auto-reconnect-timeout` — Milliseconds between reconnect attempts after an unexpected disconnect; empty / missing = no auto-reconnect.
 *
 * Selection (client-only, not RPC):
 * - `selectedFileUrls` — read snapshot ordered like `currentState.fileList`.
 * - `setSelectedFileUrls(urls)` — replace selection; only URLs present in `currentState.fileList` are kept.
 */
export class FileViewElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['url', 'target', 'auto-reconnect-timeout'];
  }

  #connectGeneration = 0;

  #session: FvJsonRpcSession | null = null;
  #lastState: IFVState | undefined;
  /** Selected `fileUrl` values; subset of `#lastState.fileList` when state is defined. */
  #selectedFileUrls = new Set<string>();
  #intentionalDisconnect = false;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
  }

  /** Last known snapshot from RPC / notifications; `undefined` until first successful sync. */
  get currentState(): IFVState | undefined {
    return this.#lastState ? cloneState(this.#lastState) : undefined;
  }

  /**
   * Selected entries as `fileUrl` strings, ordered like `currentState.fileList` (then subset).
   * Empty when there is no `currentState` yet.
   */
  get selectedFileUrls(): readonly string[] {
    return this.#snapshotSelectedOrdered();
  }

  /**
   * Replace the current selection. Unknown URLs (not in `currentState.fileList`) are ignored.
   * Clears selection with `[]`. Dispatches `fv-selection-changed` when the set changes.
   */
  public setSelectedFileUrls(urls: readonly string[]): void {
    const allowed = this.#lastState
      ? new Set(this.#lastState.fileList.map((e) => e.fileUrl))
      : new Set<string>();
    const next = new Set<string>();
    for (const raw of urls) {
      const u = raw.trim();
      if (u.length > 0 && allowed.has(u)) {
        next.add(u);
      }
    }
    if (setsEqualString(this.#selectedFileUrls, next)) {
      return;
    }
    this.#selectedFileUrls = next;
    this.#emitSelectionChanged();
  }

  connectedCallback(): void {
    void this.#runConnect();
  }

  disconnectedCallback(): void {
    this.#bumpConnectGeneration();
    this.#disconnectSession();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return;
    }
    if (name === 'url') {
      this.#bumpConnectGeneration();
      this.#disconnectSession();
      if (this.isConnected) {
        void this.#runConnect();
      }
      return;
    }
    if (name === 'target' && this.#session?.isOpen()) {
      void this.#applyTargetAttributeOnly();
      return;
    }
    if (name === 'auto-reconnect-timeout') {
      this.#clearReconnectTimer();
    }
  }

  /** Calls `fv.getState` and updates `currentState`. */
  public async getRemoteState(): Promise<IFVState> {
    const session = this.#session;
    if (!session?.isOpen()) {
      throw new Error('Not connected');
    }
    const state = await session.callGetState();
    this.#commitState(state);
    return this.currentState ?? state;
  }

  /** Calls `fv.changeTargetDir`. Does not mirror into the `target` attribute. */
  public async setTargetDir(targetDirFileUrl: string): Promise<IFVState> {
    const session = this.#session;
    if (!session?.isOpen()) {
      throw new Error('Not connected');
    }
    const state = await session.callChangeTargetDir(targetDirFileUrl);
    this.#commitState(state);
    return this.currentState ?? state;
  }

  /** Calls `fv.clearTargetDir`. */
  public async clearTargetDir(): Promise<IFVState> {
    const session = this.#session;
    if (!session?.isOpen()) {
      throw new Error('Not connected');
    }
    const state = await session.callClearTargetDir();
    this.#commitState(state);
    return this.currentState ?? state;
  }

  #bumpConnectGeneration(): void {
    this.#connectGeneration += 1;
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
  }

  #disconnectSession(): void {
    this.#clearReconnectTimer();
    const session = this.#session;
    if (session) {
      this.#intentionalDisconnect = true;
      this.#session = null;
      session.close();
      return;
    }
    this.#session = null;
  }

  #scheduleReconnect(delayMs: number): void {
    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (!this.isConnected) {
        return;
      }
      const url = this.getAttribute('url')?.trim() ?? '';
      if (!url) {
        return;
      }
      if (parseAutoReconnectTimeoutMs(this.getAttribute('auto-reconnect-timeout')) === undefined) {
        return;
      }
      void this.#runConnect();
    }, delayMs);
  }

  #handleSessionClosedFromWs(): void {
    if (this.#intentionalDisconnect) {
      this.#intentionalDisconnect = false;
      return;
    }
    this.#bumpConnectGeneration();
    this.#session = null;
    const delayMs = parseAutoReconnectTimeoutMs(this.getAttribute('auto-reconnect-timeout'));
    if (!this.isConnected || delayMs === undefined) {
      return;
    }
    const url = this.getAttribute('url')?.trim() ?? '';
    if (!url) {
      return;
    }
    this.#scheduleReconnect(delayMs);
  }

  #emitConnection(status: FvConnectionStatus, error?: string): void {
    this.dispatchEvent(
      new CustomEvent('fv-connection-change', {
        bubbles: true,
        composed: true,
        detail: { status, error },
      }),
    );
  }

  #commitState(state: IFVState): void {
    this.#lastState = cloneState(state);
    this.dispatchEvent(
      new CustomEvent('fv-state-changed', {
        bubbles: true,
        composed: true,
        detail: { state: cloneState(this.#lastState) },
      }),
    );
    this.#pruneSelectionToFileList();
  }

  #snapshotSelectedOrdered(): string[] {
    const state = this.#lastState;
    if (!state) {
      return [];
    }
    const sel = this.#selectedFileUrls;
    return state.fileList.map((e) => e.fileUrl).filter((url) => sel.has(url));
  }

  #emitSelectionChanged(): void {
    this.dispatchEvent(
      new CustomEvent<FvSelectionChangedDetail>('fv-selection-changed', {
        bubbles: true,
        composed: true,
        detail: { fileUrls: this.#snapshotSelectedOrdered() },
      }),
    );
  }

  #pruneSelectionToFileList(): void {
    const state = this.#lastState;
    if (!state) {
      if (this.#selectedFileUrls.size === 0) {
        return;
      }
      this.#selectedFileUrls = new Set();
      this.#emitSelectionChanged();
      return;
    }
    const allowed = new Set(state.fileList.map((e) => e.fileUrl));
    const next = new Set<string>();
    for (const url of this.#selectedFileUrls) {
      if (allowed.has(url)) {
        next.add(url);
      }
    }
    if (setsEqualString(this.#selectedFileUrls, next)) {
      return;
    }
    this.#selectedFileUrls = next;
    this.#emitSelectionChanged();
  }

  #handleFileChangeNotification(type: 'add' | 'remove' | 'update', file: FVFile | FVDirectory): void {
    const merged = applyFileListMutation(this.#lastState, type, file);
    this.#lastState = merged;
    this.dispatchEvent(
      new CustomEvent('fv-file-change', {
        bubbles: true,
        composed: true,
        detail: { type, file },
      }),
    );
    this.dispatchEvent(
      new CustomEvent('fv-state-changed', {
        bubbles: true,
        composed: true,
        detail: { state: cloneState(this.#lastState) },
      }),
    );
    this.#pruneSelectionToFileList();
  }

  #handleTargetDirChangeNotification(state: IFVState): void {
    this.#commitState(state);
  }

  async #runConnect(): Promise<void> {
    const gen = this.#connectGeneration;
    const url = this.getAttribute('url')?.trim() ?? '';
    if (!url) {
      this.#emitConnection('closed');
      return;
    }

    const session = new FvJsonRpcSession({
      url,
      handlers: {
        onFileChange: (type, file) => {
          this.#handleFileChangeNotification(type, file);
        },
        onTargetDirChange: (state) => {
          this.#handleTargetDirChangeNotification(state);
        },
      },
      onConnectionChange: (detail) => {
        this.#emitConnection(detail.status, detail.error);
        if (detail.status === 'closed') {
          this.#handleSessionClosedFromWs();
        }
      },
    });

    try {
      await session.open();
      if (gen !== this.#connectGeneration) {
        session.close();
        return;
      }
      this.#session = session;
      await this.#syncTargetAfterOpen(session, gen);
    } catch {
      if (gen !== this.#connectGeneration) {
        return;
      }
      session.close();
    }
  }

  async #syncTargetAfterOpen(session: FvJsonRpcSession, expectedGen: number): Promise<void> {
    if (!session.isOpen() || expectedGen !== this.#connectGeneration) {
      return;
    }
    const target = this.getAttribute('target')?.trim() ?? '';
    try {
      const state = target
        ? await session.callChangeTargetDir(target)
        : await session.callGetState();
      if (expectedGen !== this.#connectGeneration) {
        return;
      }
      this.#commitState(state);
    } catch (error) {
      if (expectedGen !== this.#connectGeneration) {
        return;
      }
      const message =
        error instanceof FvJsonRpcError
          ? `${error.message} (${error.code})`
          : error instanceof Error
            ? error.message
            : String(error);
      this.#emitConnection('error', message);
    }
  }

  async #applyTargetAttributeOnly(): Promise<void> {
    const session = this.#session;
    const gen = this.#connectGeneration;
    if (!session?.isOpen()) {
      return;
    }
    const target = this.getAttribute('target')?.trim() ?? '';
    try {
      const state = target ? await session.callChangeTargetDir(target) : await session.callClearTargetDir();
      if (gen !== this.#connectGeneration) {
        return;
      }
      this.#commitState(state);
    } catch (error) {
      if (gen !== this.#connectGeneration) {
        return;
      }
      const message =
        error instanceof FvJsonRpcError
          ? `${error.message} (${error.code})`
          : error instanceof Error
            ? error.message
            : String(error);
      this.#emitConnection('error', message);
    }
  }
}
