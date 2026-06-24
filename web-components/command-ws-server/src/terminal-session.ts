import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import { parseResizeControlMessage } from './client-control-message.js';

export interface SessionLogger {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

export interface TerminalSessionSpawnOptions {
  cwd: string;
  shell?: string;
  shellArgs?: string[];
  cols: number;
  rows: number;
  env?: NodeJS.ProcessEnv;
  idleTimeoutMs?: number;
}

function defaultPlatformShell(): { shell: string; shellArgs: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', shellArgs: ['-NoLogo'] };
  }
  const shell = process.env.SHELL || '/bin/bash';
  return { shell, shellArgs: [] };
}

/**
 * Spawns a PTY and bridges binary/text WebSocket messages to it.
 * Calls `onReleased` exactly once when the session is fully torn down.
 */
export function attachTerminalSession(
  ws: WebSocket,
  opts: TerminalSessionSpawnOptions,
  log: SessionLogger,
  onReleased: () => void,
): void {
  const { cwd, cols, rows, env, idleTimeoutMs } = opts;
  const { shell, shellArgs } =
    opts.shell !== undefined
      ? { shell: opts.shell, shellArgs: opts.shellArgs ?? [] }
      : defaultPlatformShell();

  let released = false;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let lastActivity = Date.now();

  const touch = () => {
    lastActivity = Date.now();
  };

  const release = (reason: string) => {
    if (released) {
      return;
    }
    released = true;
    if (idleTimer !== undefined) {
      clearInterval(idleTimer);
      idleTimer = undefined;
    }
    try {
      dataDisposable.dispose();
    } catch {
      /* ignore */
    }
    try {
      exitDisposable.dispose();
    } catch {
      /* ignore */
    }
    ws.removeAllListeners('message');
    ws.removeAllListeners('close');
    ws.removeAllListeners('error');
    try {
      ptyProcess.kill();
    } catch {
      /* ignore */
    }
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    log.info(`Terminal session ended (${reason})`);
    onReleased();
  };

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: env ?? process.env,
    });
  } catch (e) {
    log.error(`PTY spawn failed: ${String(e)}`);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    onReleased();
    return;
  }

  log.info(`PTY spawned pid=${ptyProcess.pid} shell=${shell}`);

  if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
    const tick = Math.min(30_000, Math.max(1000, Math.floor(idleTimeoutMs / 2)));
    idleTimer = setInterval(() => {
      if (Date.now() - lastActivity > idleTimeoutMs) {
        release('idle_timeout');
      }
    }, tick);
  }

  const sendPtyToSocket = (chunk: string | Buffer) => {
    touch();
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    try {
      ws.send(buf, { binary: true });
    } catch (e) {
      log.warn(`WebSocket send failed: ${String(e)}`);
      release('ws_send_error');
    }
  };

  const dataDisposable = ptyProcess.onData(sendPtyToSocket);

  const exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
    log.info(`PTY exit code=${exitCode} signal=${signal ?? 'n/a'}`);
    release('pty_exit');
  });

  const lastPtyDims = { cols, rows };

  const tryApplyResizeFromClientMessage = (
    raw: unknown,
    isBinary: boolean,
  ): boolean => {
    if (isBinary === true) {
      return false;
    }
    let utf8: string | undefined;
    if (typeof raw === 'string') {
      utf8 = raw;
    } else if (Buffer.isBuffer(raw)) {
      utf8 = raw.toString('utf8');
    } else if (raw instanceof ArrayBuffer) {
      utf8 = Buffer.from(raw).toString('utf8');
    } else if (ArrayBuffer.isView(raw)) {
      utf8 = Buffer.from(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength,
      ).toString('utf8');
    }
    if (utf8 === undefined) {
      return false;
    }
    const parsed = parseResizeControlMessage(utf8);
    if (parsed === null) {
      return false;
    }
    if (
      parsed.cols === lastPtyDims.cols &&
      parsed.rows === lastPtyDims.rows
    ) {
      return true;
    }
    try {
      ptyProcess.resize(parsed.cols, parsed.rows);
      lastPtyDims.cols = parsed.cols;
      lastPtyDims.rows = parsed.rows;
    } catch (e) {
      log.warn(`PTY resize failed: ${String(e)}`);
    }
    return true;
  };

  ws.on('message', (data, isBinary) => {
    touch();
    try {
      if (Array.isArray(data)) {
        if (
          data.length === 1 &&
          tryApplyResizeFromClientMessage(data[0], isBinary)
        ) {
          return;
        }
        for (const part of data) {
          ptyProcess.write(Buffer.isBuffer(part) ? part : Buffer.from(part));
        }
        return;
      }
      if (tryApplyResizeFromClientMessage(data, isBinary)) {
        return;
      }
      if (Buffer.isBuffer(data)) {
        ptyProcess.write(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        ptyProcess.write(
          Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        );
        return;
      }
      if (isBinary && data instanceof ArrayBuffer) {
        ptyProcess.write(Buffer.from(data));
        return;
      }
      if (typeof data === 'string') {
        ptyProcess.write(data);
        return;
      }
    } catch (e) {
      log.warn(`PTY write failed: ${String(e)}`);
      release('pty_write_error');
    }
  });

  ws.on('close', () => release('ws_close'));
  ws.on('error', (err) => {
    log.warn(`WebSocket error: ${String(err)}`);
    release('ws_error');
  });
}
