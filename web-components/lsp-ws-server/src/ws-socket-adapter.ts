import { WebSocket } from 'ws';
import type { IWebSocket } from 'vscode-ws-jsonrpc/socket';

/**
 * Adapts the `ws` library socket to the interface expected by
 * `createWebSocketConnection` from `vscode-ws-jsonrpc/server`.
 */
export function wsToIWebSocket(ws: WebSocket): IWebSocket {
  return {
    send: (content: string): void => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(content);
      }
    },
    onMessage: (cb: (data: string | ArrayBuffer) => void): void => {
      ws.on('message', (data) => {
        if (typeof data === 'string') {
          cb(data);
        } else if (Buffer.isBuffer(data)) {
          cb(data.toString('utf8'));
        } else if (data instanceof ArrayBuffer) {
          cb(data);
        } else if (Array.isArray(data)) {
          cb(Buffer.concat(data).toString('utf8'));
        }
      });
    },
    onError: (cb: (reason: unknown) => void): void => {
      ws.on('error', cb);
    },
    onClose: (cb: (code: number, reason: string) => void): void => {
      ws.on('close', (code, reason) => {
        cb(code, reason.toString('utf8'));
      });
    },
    dispose: (): void => {
      ws.close();
    },
  };
}
