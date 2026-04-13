import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServerProcess, createWebSocketConnection } from 'vscode-ws-jsonrpc/server';
import type { Message } from 'vscode-jsonrpc';
import type { WebSocket } from 'ws';
import { asymmetricForward } from './asymmetric-forward.js';
import {
  createClientToServerMessageMap,
  createProjectBoundMessageMaps,
  createServerToClientMessageMap,
  type ProjectFileBridgeParams,
} from './lsp-uri-bridge.js';
import { resolveLanguageSpawn } from './language-spawn.js';
import {
  isPathUnderAllowedRoots,
  resolveAllowedRootsForFilePath,
  resolveHostFilePath,
  resolveWorkspaceRootForFile,
} from './path-policy.js';
import { writeSessionTsconfig } from './session-tsconfig.js';
import { wsToIWebSocket } from './ws-socket-adapter.js';

export interface SessionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const defaultLogger: SessionLogger = {
  info: (m) => console.log(`[lsp-ws-server] ${m}`),
  warn: (m) => console.warn(`[lsp-ws-server] ${m}`),
  error: (m) => console.error(`[lsp-ws-server] ${m}`),
};

export interface LspSessionOptions {
  /**
   * Host path of the document for LSP resolution (tsconfig, node_modules). Does not cause reads/writes
   * beyond what the language server does internally.
   */
  filePath?: string;
  /**
   * Virtual URI of the open document (must match the browser Monaco model), e.g. `file:///workspace/main-….ts`.
   * Required when `filePath` is set.
   */
  documentUri?: string;
}

/**
 * One WebSocket client ↔ one language server child process.
 * Uses `vscode-ws-jsonrpc`:
 * - `createWebSocketConnection` wraps the socket with JSON-RPC message reader/writer
 * - `createServerProcess` spawns the LS and uses stdio `StreamMessageReader` / `StreamMessageWriter`
 * - `forward` wires both directions and disposes the peer when one side closes
 */
export function startLspSession(
  ws: WebSocket,
  language: string,
  log: SessionLogger = defaultLogger,
  options: LspSessionOptions = {},
): void {
  const sessionId = randomUUID().slice(0, 8);
  const spec = resolveLanguageSpawn(language);

  if (!spec) {
    log.warn(`[${sessionId}] Unsupported language: ${language}`);
    ws.close(4000, `Unsupported language: ${language}`);
    return;
  }

  const filePathOpt = options.filePath?.trim();
  let tempSessionRoot: string | undefined;
  let projectBridge: ProjectFileBridgeParams | undefined;
  let projectResolvedPath: string | undefined;

  if (filePathOpt) {
    const roots = resolveAllowedRootsForFilePath(log);
    let resolvedPath: string;
    try {
      resolvedPath = resolveHostFilePath(filePathOpt);
    } catch (e) {
      log.warn(`[${sessionId}] Invalid filePath: ${String(e)}`);
      ws.close(4000, 'Invalid filePath');
      return;
    }
    if (!isPathUnderAllowedRoots(resolvedPath, roots)) {
      log.warn(`[${sessionId}] Rejected filePath outside LSP_ALLOWED_ROOTS: ${resolvedPath}`);
      ws.close(4003, 'filePath not allowed');
      return;
    }
    const documentUri = options.documentUri?.trim();
    if (!documentUri) {
      log.warn(`[${sessionId}] Rejected: documentUri is required when filePath is set`);
      ws.close(4000, 'documentUri required with filePath');
      return;
    }
    const workspaceRootFs = resolveWorkspaceRootForFile(resolvedPath);
    projectResolvedPath = resolvedPath;
    projectBridge = {
      workspaceRootFs,
      boundVirtualUri: documentUri,
      boundServerUri: pathToFileURL(resolvedPath).href,
    };
  }

  const iSocket = wsToIWebSocket(ws);
  const clientConnection = createWebSocketConnection(iSocket);
  const serverConnection = createServerProcess(spec.name, spec.command, spec.args, {
    ...spec.spawnOptions,
    env: { ...process.env, ...spec.spawnOptions?.env },
  });

  if (!serverConnection) {
    log.error(`[${sessionId}] Failed to open stdio for ${spec.name}`);
    ws.close(1011, 'Language server stdio unavailable');
    return;
  }

  let toServer: (m: Message) => Message;
  let toClient: (m: Message) => Message;

  if (projectBridge) {
    log.info(
      `[${sessionId}] Project file session: file=${projectResolvedPath} workspaceRoot=${projectBridge.workspaceRootFs} virtual=${projectBridge.boundVirtualUri}`,
    );
    const maps = createProjectBoundMessageMaps(projectBridge);
    toServer = maps.toServer;
    toClient = maps.toClient;
  } else {
    tempSessionRoot = mkdtempSync(join(tmpdir(), `lsp-ws-${sessionId}-`));
    if (language.trim().toLowerCase() === 'typescript' || language.trim().toLowerCase() === 'ts') {
      writeSessionTsconfig(tempSessionRoot);
    }
    log.info(`[${sessionId}] Session workspace (host): ${tempSessionRoot}`);
    toServer = createClientToServerMessageMap(tempSessionRoot);
    toClient = createServerToClientMessageMap(tempSessionRoot);
  }

  asymmetricForward(clientConnection, serverConnection, toServer, toClient);

  ws.on('close', () => {
    log.info(`[${sessionId}] WebSocket closed`);
    if (tempSessionRoot) {
      try {
        rmSync(tempSessionRoot, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
}
