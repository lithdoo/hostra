import { statSync } from 'node:fs';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Allowed filesystem roots for the `workDir` WebSocket query (comma- or semicolon-separated).
 */
export function parseAllowedWorkDirRootsFromEnv(): string[] {
  const raw = process.env.COMMAND_WS_ALLOWED_ROOTS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => normalize(resolve(r)));
}

export function resolveAllowedRootsForWorkDirQuery(log: {
  warn(m: string): void;
}): string[] {
  const fromEnv = parseAllowedWorkDirRootsFromEnv();
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  const cwd = normalize(resolve(process.cwd()));
  log.warn(
    `[command-ws-server] COMMAND_WS_ALLOWED_ROOTS unset; allowing workDir only under process.cwd() (${cwd}). Set COMMAND_WS_ALLOWED_ROOTS for stricter access.`,
  );
  return [cwd];
}

export function isPathUnderAllowedRoots(
  resolvedPath: string,
  roots: string[],
): boolean {
  const abs = normalize(resolvedPath);
  for (const root of roots) {
    const r = normalize(root);
    const rel = relative(r, abs);
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      return true;
    }
  }
  return false;
}

export type WorkDirResolutionFailure =
  | 'decode'
  | 'url'
  | 'protocol'
  | 'fileURLToPath'
  | 'stat'
  | 'notdir'
  | 'outside';

export type ResolveWorkDirQueryResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; reason: WorkDirResolutionFailure };

/**
 * Resolve and validate the `workDir` query value (must be a percent-encoded `file:` URL).
 * Caller handles missing/empty param (session uses homedir / defaultSessionCwd).
 */
export function resolveWorkDirQueryParam(
  rawWorkDir: string,
  allowedRoots: string[],
): ResolveWorkDirQueryResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawWorkDir.trim());
  } catch {
    return { ok: false, reason: 'decode' };
  }

  let fileUrl: URL;
  try {
    fileUrl = new URL(decoded);
  } catch {
    return { ok: false, reason: 'url' };
  }

  if (fileUrl.protocol !== 'file:') {
    return { ok: false, reason: 'protocol' };
  }

  let fsPath: string;
  try {
    fsPath = normalize(fileURLToPath(fileUrl));
  } catch {
    return { ok: false, reason: 'fileURLToPath' };
  }

  let st;
  try {
    st = statSync(fsPath);
  } catch {
    return { ok: false, reason: 'stat' };
  }

  if (!st.isDirectory()) {
    return { ok: false, reason: 'notdir' };
  }

  if (!isPathUnderAllowedRoots(fsPath, allowedRoots)) {
    return { ok: false, reason: 'outside' };
  }

  return { ok: true, resolvedPath: fsPath };
}
