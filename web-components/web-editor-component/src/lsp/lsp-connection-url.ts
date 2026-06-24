import type { EditorLanguage } from '../languages/registry.js';

export interface BuildLspWebSocketUrlOptions {
  /**
   * Host filesystem path for LSP project resolution (tsconfig, node_modules). Requires server
   * `LSP_ALLOWED_ROOTS` and `documentUri`.
   */
  filePath?: string;
  /** Virtual document URI, e.g. from `virtualDocumentFileUrl` — must match the Monaco model. */
  documentUri?: string;
}

/**
 * Builds the WebSocket URL expected by `@web-editor/lsp-ws-server`:
 * `ws://host:port/lsp?language=<typescript|json|markdown|toml>`.
 *
 * - Preserves path, host, and existing query keys.
 * - Sets / overwrites `language` so the server can spawn the correct LS.
 * - Optional `filePath` + `documentUri` for project-bound sessions (see `BuildLspWebSocketUrlOptions`).
 */
export function buildLspWebSocketUrl(
  baseUrl: string,
  editorLanguage: EditorLanguage,
  options?: BuildLspWebSocketUrlOptions,
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`[code-editor] Invalid lsp-url: ${JSON.stringify(baseUrl)}`);
  }
  url.searchParams.set('language', editorLanguage);
  const fp = options?.filePath?.trim();
  if (fp) {
    url.searchParams.set('filePath', fp);
    const doc = options?.documentUri?.trim();
    if (doc) {
      url.searchParams.set('documentUri', doc);
    }
  } else {
    url.searchParams.delete('filePath');
    url.searchParams.delete('documentUri');
  }
  return url.href;
}
