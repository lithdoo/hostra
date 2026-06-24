import type { FVDirectory, FVFile, IFVState } from '../types/fv-models.js';

export type FvConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

export class FvJsonRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'FvJsonRpcError';
  }
}

export interface FvJsonRpcNotificationHandlers {
  onFileChange?(type: 'add' | 'remove' | 'update', file: FVFile | FVDirectory): void;
  onTargetDirChange?(state: IFVState): void;
}

export interface FvJsonRpcSessionOptions {
  url: string;
  handlers?: FvJsonRpcNotificationHandlers;
  onConnectionChange?(detail: { status: FvConnectionStatus; error?: string }): void;
}

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFileChangeType(value: unknown): value is 'add' | 'remove' | 'update' {
  return value === 'add' || value === 'remove' || value === 'update';
}

function isFvEntry(value: unknown): value is FVFile | FVDirectory {
  if (!isObject(value)) {
    return false;
  }
  const kind = value.kind;
  if (kind !== 'file' && kind !== 'directory') {
    return false;
  }
  return typeof value.name === 'string' && typeof value.fileUrl === 'string' && typeof value.hidden === 'boolean';
}

/**
 * Minimal JSON-RPC 2.0 client over a single WebSocket (one JSON object per message),
 * aligned with `file-view-ws-server` dispatch and notifications.
 */
export class FvJsonRpcSession {
  readonly #url: string;
  readonly #handlers: FvJsonRpcNotificationHandlers;
  readonly #onConnectionChange?: FvJsonRpcSessionOptions['onConnectionChange'];

  #ws: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<number, PendingEntry>();

  public constructor(options: FvJsonRpcSessionOptions) {
    this.#url = options.url;
    this.#handlers = options.handlers ?? {};
    this.#onConnectionChange = options.onConnectionChange;
  }

  public get url(): string {
    return this.#url;
  }

  public isOpen(): boolean {
    return this.#ws !== null && this.#ws.readyState === WebSocket.OPEN;
  }

  #emitConnection(status: FvConnectionStatus, error?: string): void {
    this.#onConnectionChange?.({ status, error });
  }

  #rejectAll(reason: Error): void {
    for (const [, entry] of this.#pending) {
      entry.reject(reason);
    }
    this.#pending.clear();
  }

  #handleRawMessage(raw: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isObject(payload) || payload.jsonrpc !== '2.0') {
      return;
    }

    if ('result' in payload || 'error' in payload) {
      const id = payload.id;
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        return;
      }
      const entry = this.#pending.get(id);
      if (!entry) {
        return;
      }
      this.#pending.delete(id);

      if ('error' in payload && isObject(payload.error)) {
        const err = payload.error as Record<string, unknown>;
        const code = typeof err.code === 'number' ? err.code : -32603;
        const message = typeof err.message === 'string' ? err.message : 'JSON-RPC error';
        entry.reject(new FvJsonRpcError(message, code, err.data));
        return;
      }

      entry.resolve(payload.result);
      return;
    }

    if (typeof payload.method === 'string' && !('result' in payload) && !('error' in payload)) {
      const method = payload.method;
      const params = 'params' in payload ? payload.params : undefined;
      if (method === 'fv.onFileChange' && isObject(params)) {
        const type = params.type;
        const file = params.file;
        if (isFileChangeType(type) && isFvEntry(file)) {
          this.#handlers.onFileChange?.(type, file);
        }
        return;
      }
      if (method === 'fv.onTargetDirChange' && isObject(params)) {
        const state = params.state;
        if (this.#isIFVState(state)) {
          this.#handlers.onTargetDirChange?.(state);
        }
      }
    }
  }

  #isIFVState(value: unknown): value is IFVState {
    if (!isObject(value)) {
      return false;
    }
    if (!Array.isArray(value.fileList)) {
      return false;
    }
    for (const item of value.fileList) {
      if (!isFvEntry(item)) {
        return false;
      }
    }
    if (value.targetDir !== undefined && !isFvEntry(value.targetDir)) {
      return false;
    }
    if (value.targetDir !== undefined && value.targetDir.kind !== 'directory') {
      return false;
    }
    return true;
  }

  /**
   * Opens the WebSocket. Resolves when `readyState === OPEN`.
   */
  public open(): Promise<void> {
    if (this.#ws !== null) {
      return Promise.reject(new Error('Session already has a socket'));
    }

    this.#emitConnection('connecting');

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.#url);

      const fail = (message: string) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#emitConnection('error', message);
        reject(new Error(message));
      };

      ws.onopen = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.#ws = ws;
        this.#emitConnection('open');
        resolve();
      };

      ws.onerror = () => {
        fail('WebSocket error');
        ws.close();
      };

      ws.onclose = () => {
        if (this.#ws === ws) {
          this.#ws = null;
        }
        this.#rejectAll(new Error('Connection closed'));
        this.#emitConnection('closed');
      };

      ws.onmessage = (event: MessageEvent<string | ArrayBuffer | Blob>) => {
        const data = event.data;
        const raw =
          typeof data === 'string'
            ? data
            : data instanceof ArrayBuffer
              ? new TextDecoder('utf-8').decode(data)
              : '';
        if (raw.length === 0) {
          return;
        }
        this.#handleRawMessage(raw);
      };
    });
  }

  public close(): void {
    const ws = this.#ws;
    if (!ws) {
      return;
    }
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
      return;
    }
    this.#ws = null;
    this.#rejectAll(new Error('Connection closed'));
    this.#emitConnection('closed');
  }

  #sendRequest(method: string, params: unknown): Promise<unknown> {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not open'));
    }

    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const message = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: params === undefined ? {} : params,
      });
      ws.send(message);
    });
  }

  public callChangeTargetDir(targetDirFileUrl: string): Promise<IFVState> {
    return this.#sendRequest('fv.changeTargetDir', { targetDirFileUrl }).then((result) =>
      this.#assertIFVState(result),
    );
  }

  public callClearTargetDir(): Promise<IFVState> {
    return this.#sendRequest('fv.clearTargetDir', {}).then((result) => this.#assertIFVState(result));
  }

  public callGetState(): Promise<IFVState> {
    return this.#sendRequest('fv.getState', {}).then((result) => this.#assertIFVState(result));
  }

  #assertIFVState(value: unknown): IFVState {
    if (!isObject(value)) {
      throw new Error('Invalid fv.getState result');
    }
    if (!Array.isArray(value.fileList)) {
      throw new Error('Invalid fv state: fileList');
    }
    const fileList: (FVFile | FVDirectory)[] = [];
    for (const item of value.fileList) {
      if (!isFvEntry(item)) {
        throw new Error('Invalid fv state: fileList entry');
      }
      fileList.push(item);
    }
    let targetDir: FVDirectory | undefined;
    if (value.targetDir !== undefined) {
      if (!isFvEntry(value.targetDir) || value.targetDir.kind !== 'directory') {
        throw new Error('Invalid fv state: targetDir');
      }
      targetDir = value.targetDir;
    }
    return { fileList, targetDir };
  }
}
