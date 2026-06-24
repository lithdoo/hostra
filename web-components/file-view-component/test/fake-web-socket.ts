/**
 * Minimal WebSocket stub for Vitest (one JSON-RPC frame per send).
 * Numeric `readyState` matches the browser WebSocket API.
 */
export type FakeRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

export type FakeResponder = (
  req: FakeRpcRequest,
) =>
  | unknown
  | {
      error: { code: number; message: string; data?: unknown };
    };

export class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  onopen: ((this: FakeWebSocket, ev: Event) => void) | null = null;
  onclose: ((this: FakeWebSocket, ev: CloseEvent) => void) | null = null;
  onerror: ((this: FakeWebSocket, ev: Event) => void) | null = null;
  onmessage: ((this: FakeWebSocket, ev: MessageEvent) => void) | null = null;

  readonly sent: string[] = [];

  /** Per-instance override; falls back to {@link FakeWebSocket.defaultResponder}. */
  responder: FakeResponder | undefined;

  static defaultResponder: FakeResponder = (req) => {
    if (req.method === 'fv.getState' || req.method === 'fv.clearTargetDir') {
      return { fileList: [], targetDir: undefined };
    }
    if (req.method === 'fv.changeTargetDir') {
      const params = req.params as { targetDirFileUrl?: string };
      const fileUrl = params.targetDirFileUrl ?? 'file:///unknown';
      const name = fileUrl.split('/').pop() ?? 'dir';
      const targetDir = {
        kind: 'directory' as const,
        name,
        fileUrl,
        hidden: false,
      };
      return { fileList: [], targetDir };
    }
    return { fileList: [], targetDir: undefined };
  };

  /** Most recently constructed instance (single-socket tests). */
  static latest: FakeWebSocket | undefined;

  public constructor(url: string | URL, _protocols?: string | string[]) {
    this.url = typeof url === 'string' ? url : url.toString();
    FakeWebSocket.latest = this;
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.CONNECTING) {
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') {
      throw new Error('FakeWebSocket only supports string sends in tests');
    }
    this.sent.push(data);
    const parsed = JSON.parse(data) as FakeRpcRequest;
    const handler = this.responder ?? FakeWebSocket.defaultResponder;
    const out = handler(parsed);
    queueMicrotask(() => {
      if (this.readyState !== FakeWebSocket.OPEN) {
        return;
      }
      if (out && typeof out === 'object' && 'error' in out) {
        this.onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              error: out.error,
            }),
          }),
        );
        return;
      }
      this.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: out,
          }),
        }),
      );
    });
  }

  public close(_code?: number, _reason?: string): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }

  /** Deliver a server JSON-RPC notification (no `id`). */
  public notify(method: string, params: unknown): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      return;
    }
    this.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ jsonrpc: '2.0', method, params }),
      }),
    );
  }
}
