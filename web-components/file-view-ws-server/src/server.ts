import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { createHandlers } from './handlers.js';
import { createFVWsConnection } from './connection.js';
import {
  JSON_RPC_ERRORS,
  createErrorResponse,
  dispatchJsonRpc,
  parseJsonRpcMessage,
  type JsonRpcRequest,
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

interface BlobRequestBody {
  fileUrl: string;
}

function sendJson(ws: WebSocket, payload: JsonRpcResponse): void {
  ws.send(JSON.stringify(payload));
}

function sendHttpJson(
  res: {
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(body?: string): void;
  },
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendNotification(ws: WebSocket, method: string, params: unknown): void {
  const notification: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params,
  };
  ws.send(JSON.stringify(notification));
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

async function readJsonBody(req: IncomingMessage, maxBytes = 20 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error('Body too large');
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw === '' ? {} : JSON.parse(raw);
}

function parseBlobRequestBody(body: unknown): BlobRequestBody {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Request body must be a JSON object');
  }
  const fileUrl = (body as Record<string, unknown>).fileUrl;
  if (typeof fileUrl !== 'string' || fileUrl.trim() === '') {
    throw new Error('fileUrl must be a non-empty string');
  }
  if (!fileUrl.startsWith('file://')) {
    throw new Error('fileUrl must start with file://');
  }
  return { fileUrl };
}

export function createFileViewWsServer(options: FileViewWsServerOptions): FileViewWsServer {
  const pathname = options.pathname ?? '/rpc';
  const log = options.logger ?? {
    info: (message: string) => console.log(`[file-view-ws-server] ${message}`),
    warn: (message: string) => console.warn(`[file-view-ws-server] ${message}`),
    error: (message: string) => console.error(`[file-view-ws-server] ${message}`),
  };

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/file/blob') {
      let filePath = '';
      let fileSize = 0;
      try {
        const body = await readJsonBody(req);
        const parsed = parseBlobRequestBody(body);
        filePath = fileURLToPath(parsed.fileUrl);
        const st = await stat(filePath);
        if (!st.isFile()) {
          sendHttpJson(res, 400, { error: 'Target is not a regular file' });
          return;
        }
        fileSize = st.size;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid request';
        if (message.includes('must start with file://')) {
          sendHttpJson(res, 422, { error: message });
          return;
        }
        if (message.includes('ENOENT')) {
          sendHttpJson(res, 404, { error: 'File not found' });
          return;
        }
        if (message === 'Body too large') {
          sendHttpJson(res, 413, { error: message });
          return;
        }
        sendHttpJson(res, 400, { error: message });
        return;
      }

      const stream = createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          sendHttpJson(res, 500, { error: 'Failed to read file' });
          return;
        }
        res.destroy();
      });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(fileSize),
      });
      stream.pipe(res);
      return;
    }

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
    const connection = createFVWsConnection({
      onFileChange: (type, file) => {
        sendNotification(ws, 'fv.onFileChange', { type, file });
      },
      onTargetDirChange: (state) => {
        sendNotification(ws, 'fv.onTargetDirChange', { state });
      },
    });
    const handlers = createHandlers(connection);

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

    ws.on('close', () => {
      void connection.clearTargetDir().catch((error) => {
        log.warn(`Failed to clear connection watcher on close: ${String(error)}`);
      });
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
