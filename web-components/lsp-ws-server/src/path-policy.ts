import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

/**
 * Allowed filesystem roots for `filePath` query param (comma- or semicolon-separated).
 * If unset or empty, server rejects WebSocket upgrades that include `filePath`.
 */
export function parseAllowedRootsFromEnv(): string[] {
  const raw = process.env.LSP_ALLOWED_ROOTS?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => normalize(resolve(r)));
}

/**
 * Roots used to validate `filePath`. Uses `LSP_ALLOWED_ROOTS` when set; otherwise falls back to
 * `process.cwd()` so local demos work without env (not for production).
 */
export function resolveAllowedRootsForFilePath(log: { warn(m: string): void }): string[] {
  const fromEnv = parseAllowedRootsFromEnv();
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  const cwd = normalize(resolve(process.cwd()));
  log.warn(
    `[lsp-ws-server] LSP_ALLOWED_ROOTS unset; allowing filePath only under process.cwd() (${cwd}). Set LSP_ALLOWED_ROOTS for stricter access.`,
  );
  return [cwd];
}

/**
 * `filePath` may be absolute or relative to cwd; result is absolute and normalized.
 */
export function resolveHostFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error('empty filePath');
  }
  return normalize(isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed));
}

export function isPathUnderAllowedRoots(resolvedPath: string, roots: string[]): boolean {
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

/**
 * Directory used as LSP workspace root: nearest parent of `filePath` containing `tsconfig.json`,
 * else `dirname(filePath)`.
 */
export function resolveWorkspaceRootForFile(filePath: string): string {
  const absFile = normalize(filePath);
  let dir = absFile;
  try {
    const st = statSync(absFile);
    dir = st.isDirectory() ? absFile : normalize(join(absFile, '..'));
  } catch {
    dir = normalize(join(absFile, '..'));
  }

  let current = dir;
  for (;;) {
    if (existsSync(join(current, 'tsconfig.json'))) {
      return current;
    }
    const parent = normalize(join(current, '..'));
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return dir;
}
