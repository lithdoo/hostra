/**
 * LSP over WebSocket: `LanguageClientWrapper` (monaco-languageclient) opens the socket and uses
 * `vscode-ws-jsonrpc` for JSON-RPC message framing compatible with VS Code language servers.
 *
 * ## Client initialization flow (what happens after `LanguageClientWrapper.start()`)
 *
 * 1. **Transport** — `new WebSocket(url)`; on `open`, `MonacoLanguageClient` receives
 *    `MessageTransports` (`WebSocketMessageReader` / `WebSocketMessageWriter`).
 * 2. **`initialize`** — `vscode-languageclient` sends `initialize` with capabilities
 *    (text sync, completion, hover, publishDiagnostics, etc.) and workspace folders.
 * 3. **`initialized`** — notification after successful `initialize` response.
 * 4. **Feature registration** — `BaseLanguageClient` registers VS Code providers that delegate to
 *    the language server (completion, hover, signature help, diagnostics, etc.).
 * 5. **Document sync** — When the Monaco-backed text model matches `documentSelector`, open/change/close
 *    notifications are emitted automatically (incremental sync where supported).
 * 6. **Completion / cursor** — There is no standing “cursor sync” notification in LSP. On suggest
 *    (e.g. Ctrl+Space or `quickSuggestions`), the client sends `textDocument/completion` with a
 *    `TextDocumentPositionParams` built from the **current** editor selection.
 */
import {
  CloseAction,
  ErrorAction,
  type LanguageClientOptions,
} from 'vscode-languageclient/browser.js';
import * as vscode from 'vscode';
import {
  LanguageClientWrapper,
  type LanguageClientConfig,
} from 'monaco-languageclient/lcwrapper';
import { getLanguageRegistration, type EditorLanguage } from '../languages/registry.js';

function defaultErrorHandling(): LanguageClientOptions['errorHandler'] {
  return {
    error: () => ({
      action: ErrorAction.Continue,
    }),
    closed: () => ({
      action: CloseAction.DoNotRestart,
    }),
  };
}

export function createLanguageClientConfig(
  language: EditorLanguage,
  webSocketUrl: string,
): LanguageClientConfig {
  const reg = getLanguageRegistration(language);
  const clientOptions: LanguageClientOptions = {
    documentSelector: [reg.monacoLanguageId],
    workspaceFolder: {
      index: 0,
      name: 'workspace',
      uri: vscode.Uri.file('/workspace'),
    },
    errorHandler: defaultErrorHandling(),
    markdown: {
      isTrusted: true,
    },
  };

  return {
    languageId: reg.monacoLanguageId,
    connection: {
      options: {
        $type: 'WebSocketUrl',
        url: webSocketUrl,
      },
    },
    clientOptions,
  };
}

export function startLanguageClient(config: LanguageClientConfig): Promise<LanguageClientWrapper> {
  const wrapper = new LanguageClientWrapper(config);
  return wrapper.start().then(() => wrapper);
}

export async function disposeLanguageClient(wrapper: LanguageClientWrapper | undefined): Promise<void> {
  if (!wrapper) {
    return;
  }
  await wrapper.dispose(true);
}
