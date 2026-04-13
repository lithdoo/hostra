import { createServer, type IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { startLspSession, type SessionLogger } from './lsp-session.js';

export interface LspWsServerOptions {
  /** TCP port */
  port: number;
  /** Bind host */
  host?: string;
  /** Only paths matching this prefix are upgraded to WebSocket (default `/lsp`) */
  pathname?: string;
  /** Query parameter used for language id (default `language`) */
  languageQueryParam?: string;
  logger?: SessionLogger;
}

export interface LspWsServer {
  readonly httpServer: ReturnType<typeof createServer>;
  readonly wss: WebSocketServer;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function getLanguageFromRequest(
  req: IncomingMessage,
  paramName: string,
): string | undefined {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const raw = url.searchParams.get(paramName) ?? url.searchParams.get('lang');
  return raw ?? undefined;
}

/**
 * HTTP server with a WebSocket endpoint that bridges JSON-RPC to language server stdio.
 *
 * Client URL example:
 * `ws://127.0.0.1:8080/lsp?language=typescript`
 */
export function createLspWsServer(options: LspWsServerOptions): LspWsServer {
  const pathname = options.pathname ?? '/lsp';
  const languageQueryParam = options.languageQueryParam ?? 'language';
  const log = options.logger ?? {
    info: (m) => console.log(`[lsp-ws-server] ${m}`),
    warn: (m) => console.warn(`[lsp-ws-server] ${m}`),
    error: (m) => console.error(`[lsp-ws-server] ${m}`),
  };

  const httpServer = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('lsp-ws-server ok\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

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

    const language = getLanguageFromRequest(request, languageQueryParam);
    if (!language || language.trim() === '') {
      log.warn('Rejected upgrade: missing language query parameter');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const filePath = url.searchParams.get('filePath')?.trim() || undefined;
    const documentUri = url.searchParams.get('documentUri')?.trim() || undefined;

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      startLspSession(ws, language, log, { filePath, documentUri });
    });
  });

  return {
    httpServer,
    wss,
    listen() {
      return new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(options.port, options.host ?? '0.0.0.0', () => {
          httpServer.off('error', reject);
          log.info(
            `Listening on http://${options.host ?? '0.0.0.0'}:${options.port} — WebSocket LSP at ws://…${pathname}?${languageQueryParam}=…`,
          );
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          httpServer.close((e) => (e ? reject(e) : resolve()));
        });
      });
    },
  };
}
