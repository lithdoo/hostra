import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  resolveAllowedRootsForWorkDirQuery,
  resolveWorkDirQueryParam,
} from './terminal-path-policy.js';
import {
  attachTerminalSession,
  type SessionLogger,
} from './terminal-session.js';

export type { SessionLogger } from './terminal-session.js';

export interface CommandWsServerOptions {
  port: number;
  host?: string;
  /** WebSocket upgrade path (default `/terminal`) */
  pathname?: string;
  /**
   * When the upgrade URL has no `workDir` query, PTY `cwd` is
   * `defaultSessionCwd ?? cwd ?? os.homedir()`.
   * @deprecated Prefer `defaultSessionCwd`. `cwd` is kept as a legacy alias.
   */
  cwd?: string;
  /**
   * When the upgrade URL has no `workDir` query, use this directory as PTY `cwd`
   * before falling back to {@link cwd} or `os.homedir()`.
   */
  defaultSessionCwd?: string;
  /** Executable to spawn (default: platform shell) */
  shell?: string;
  shellArgs?: string[];
  defaultCols?: number;
  defaultRows?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
  /** If set, the upgrade URL must include this query param value */
  upgradeToken?: string;
  authQueryParam?: string;
  logger?: SessionLogger;
}

export interface CommandWsServer {
  readonly httpServer: ReturnType<typeof createServer>;
  readonly wss: WebSocketServer;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function isHealthUrl(rawUrl: string | undefined): boolean {
  if (rawUrl === '/' || rawUrl === '/health') {
    return true;
  }
  try {
    const u = new URL(rawUrl ?? '/', 'http://localhost');
    return u.pathname === '/' || u.pathname === '/health';
  } catch {
    return false;
  }
}

/**
 * HTTP server with WebSocket terminal sessions (node-pty) at `pathname` (default `/terminal`).
 *
 * Client URL example:
 * `ws://127.0.0.1:8082/terminal`
 *
 * Optional per-session working directory (must be a `file:` URL, percent-encoded):
 * `ws://127.0.0.1:8082/terminal?workDir=file%3A%2F%2F%2F...`
 */
export function createCommandWsServer(
  options: CommandWsServerOptions,
): CommandWsServer {
  const pathname = options.pathname ?? '/terminal';
  const sessionFallbackCwd =
    options.defaultSessionCwd ?? options.cwd ?? homedir();
  const defaultCols = options.defaultCols ?? 80;
  const defaultRows = options.defaultRows ?? 24;
  const authQueryParam = options.authQueryParam ?? 'token';
  const log = options.logger ?? {
    info: (m: string) => console.log(`[command-ws-server] ${m}`),
    warn: (m: string) => console.warn(`[command-ws-server] ${m}`),
    error: (m: string) => console.error(`[command-ws-server] ${m}`),
  };

  let activeConnections = 0;

  const httpServer = createServer((req, res) => {
    if (isHealthUrl(req.url)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('command-ws-server ok\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.method !== 'GET') {
      socket.destroy();
      return;
    }
    const upgradeHdr = request.headers.upgrade;
    if (!upgradeHdr || upgradeHdr.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }

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

    if (options.upgradeToken !== undefined) {
      const tok = url.searchParams.get(authQueryParam);
      if (tok !== options.upgradeToken) {
        log.warn('Rejected upgrade: invalid or missing token');
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    const rawWorkDir = url.searchParams.get('workDir');
    let sessionCwd: string;
    if (rawWorkDir === null || rawWorkDir.trim() === '') {
      sessionCwd = sessionFallbackCwd;
    } else {
      const roots = resolveAllowedRootsForWorkDirQuery(log);
      const resolved = resolveWorkDirQueryParam(rawWorkDir, roots);
      if (!resolved.ok) {
        log.warn(`Rejected upgrade: invalid workDir (${resolved.reason})`);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      sessionCwd = resolved.resolvedPath;
    }

    const max = options.maxConnections;
    if (max !== undefined && max > 0 && activeConnections >= max) {
      log.warn('Rejected upgrade: max connections reached');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      activeConnections++;
      attachTerminalSession(
        ws,
        {
          cwd: sessionCwd,
          shell: options.shell,
          shellArgs: options.shellArgs,
          cols: defaultCols,
          rows: defaultRows,
          idleTimeoutMs: options.idleTimeoutMs,
        },
        log,
        () => {
          activeConnections--;
        },
      );
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
          const host = options.host ?? '0.0.0.0';
          log.info(
            `Listening on http://${host}:${options.port} — WebSocket PTY at ws://…${pathname}`,
          );
          resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) {
          client.terminate();
        }
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
