/** Inclusive bounds for `resize` control messages (client → server). */
export const RESIZE_COLS_MIN = 2;
export const RESIZE_COLS_MAX = 512;
export const RESIZE_ROWS_MIN = 1;
export const RESIZE_ROWS_MAX = 256;

const MAX_CONTROL_JSON_BYTES = 256;

/**
 * Parses a UTF-8 text client control message. Returns clamped cols/rows for
 * `{ "type": "resize", "cols": number, "rows": number }`, or `null` if not a resize command.
 */
export function parseResizeControlMessage(input: string): {
  cols: number;
  rows: number;
} | null {
  const s = input.trim();
  if (s.length === 0 || s.length > MAX_CONTROL_JSON_BYTES) {
    return null;
  }
  if (!s.startsWith('{')) {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(s) as unknown;
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }
  const o = obj as Record<string, unknown>;
  if (o.type !== 'resize') {
    return null;
  }
  if (typeof o.cols !== 'number' || typeof o.rows !== 'number') {
    return null;
  }
  const cols = o.cols;
  const rows = o.rows;
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return null;
  }
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    return null;
  }
  const c = cols;
  const r = rows;
  if (c < RESIZE_COLS_MIN || r < RESIZE_ROWS_MIN) {
    return null;
  }
  return {
    cols: Math.min(RESIZE_COLS_MAX, Math.max(RESIZE_COLS_MIN, c)),
    rows: Math.min(RESIZE_ROWS_MAX, Math.max(RESIZE_ROWS_MIN, r)),
  };
}
