import { createServer } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { createHandlers } from './handlers.js';
import {
  JSON_RPC_ERRORS,
  createErrorResponse,
  dispatchJsonRpc,
  parseJsonRpcMessage,
  type JsonRpcResponse,
} from './jsonrpc.js';

export interface FileViewWsServerOptions {
  port: number;
  host?: string;
  pathname?: string;
  logger?: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

export interface FileViewWsServer {
  listen(): Promise<void>;
  close(): Promise<void>;
}

function sendJson(ws: WebSocket, payload: JsonRpcResponse): void {
  ws.send(JSON.stringify(payload));
}

function normalizeRawMessage(data: RawData): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return data.toString('utf8');
}

export function createFileViewWsServer(options: FileViewWsServerOptions): FileViewWsServer {
  const pathname = options.pathname ?? '/rpc';
  const log = options.logger ?? {
    info: (message: string) => console.log(`[file-view-ws-server] ${message}`),
    warn: (message: string) => console.warn(`[file-view-ws-server] ${message}`),
    error: (message: string) => console.error(`[file-view-ws-server] ${message}`),
  };

  const handlers = createHandlers();
  const httpServer = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('file-view-ws-server ok\n');
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.on('message', async (data: RawData) => {
      const raw = normalizeRawMessage(data);
      const parsed = parseJsonRpcMessage(raw);

      if (parsed.error) {
        sendJson(ws, parsed.error);
        return;
      }

      const request = parsed.request;
      if (!request) {
        sendJson(
          ws,
          createErrorResponse(
            null,
            JSON_RPC_ERRORS.invalidRequest.code,
            JSON_RPC_ERRORS.invalidRequest.message,
          ),
        );
        return;
      }

      const response = await dispatchJsonRpc(request, handlers);
      if (!response) {
        return;
      }

      sendJson(ws, response);
    });
  });

  httpServer.on('upgrade', (request, socket, head) => {
    const host = request.headers.host ?? '127.0.0.1';
    let url: URL;
    try {
      url = new URL(request.url ?? '/', `http://${host}`);
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== pathname) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  return {
    listen() {
      return new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(options.port, options.host ?? '0.0.0.0', () => {
          httpServer.off('error', reject);
          log.info(
            `Listening on http://${options.host ?? '0.0.0.0'}:${options.port} - WebSocket JSON-RPC at ws://...${pathname}`,
          );
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        wss.close((wsError) => {
          if (wsError) {
            reject(wsError);
            return;
          }
          httpServer.close((httpError) => {
            if (httpError) {
              reject(httpError);
              return;
            }
            resolve();
          });
        });
      });
    },
  };
}
