import type { FVDirectory, FVFile, IFVState } from '../types/fv-models.js';

export function iconGlyph(kind: 'file' | 'directory'): string {
  return kind === 'directory' ? '\u{1F4C1}' : '\u{1F4C4}';
}

export function labelForItem(item: FVFile | FVDirectory): string {
  return item.name;
}

/** Best-effort parent `file://` URL for a directory URL (trailing slash optional). */
export function parentFileUrl(dirFileUrl: string): string | undefined {
  if (!dirFileUrl.startsWith('file://')) {
    return undefined;
  }
  const trimmed = dirFileUrl.replace(/\/$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 'file://'.length - 1) {
    return undefined;
  }
  const parent = trimmed.slice(0, idx);
  return parent.length > 'file:'.length ? parent : undefined;
}

export function barTitle(state: IFVState | undefined): string {
  if (!state?.targetDir) {
    return 'No directory';
  }
  return state.targetDir.name;
}

export function barSubtitle(state: IFVState | undefined): string {
  return state?.targetDir?.fileUrl ?? '';
}
