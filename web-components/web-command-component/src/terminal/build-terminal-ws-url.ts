export interface BuildTerminalWebSocketUrlOptions {
  /** Base URL including `ws:` / `wss:` scheme (may already contain query). */
  baseWsUrl: string;
  token?: string;
  /** Query param name for token (default `token`). */
  authQueryParam?: string;
  /** Full `file:` URL string from `work-dir-url` attribute. */
  workDirUrl?: string;
  /** Query param name for work directory (default `workDir`). */
  workDirQueryParam?: string;
}

/**
 * Builds the WebSocket URL for `@web-editor/command-ws-server`, merging optional
 * `token` and `workDir` (percent-encoded once) into the query string.
 */
export function buildTerminalWebSocketUrl(
  options: BuildTerminalWebSocketUrlOptions,
): string {
  const {
    baseWsUrl,
    token,
    workDirUrl,
    authQueryParam = 'token',
    workDirQueryParam = 'workDir',
  } = options;

  let u: URL;
  try {
    u = new URL(baseWsUrl);
  } catch {
    throw new Error(`Invalid base WebSocket URL: ${baseWsUrl}`);
  }

  if (token !== undefined && token !== '') {
    u.searchParams.set(authQueryParam, token);
  }

  if (workDirUrl !== undefined && workDirUrl.trim() !== '') {
    const trimmed = workDirUrl.trim();
    if (!trimmed.toLowerCase().startsWith('file:')) {
      console.warn(
        '[web-command-component] work-dir-url is not a file: URL; omitting workDir query',
      );
    } else {
      try {
        // Validate parseable `file:` URL before sending to the server.
        new URL(trimmed);
        u.searchParams.set(workDirQueryParam, trimmed);
      } catch {
        console.warn(
          '[web-command-component] invalid work-dir-url; omitting workDir query',
        );
      }
    }
  }

  return u.href;
}
