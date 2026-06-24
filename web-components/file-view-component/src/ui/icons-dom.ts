import type { FileViewElement } from '../component/file-view.js';
import type { FVDirectory, FVFile, IFVState } from '../types/fv-models.js';
import { barSubtitle, barTitle, iconGlyph, labelForItem } from './icons-model.js';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

export function createBar(
  state: IFVState | undefined,
  options: { showParent: boolean; onParent?: () => void },
): HTMLElement {
  const bar = el('div', 'fv-icons__bar');

  if (options.showParent && state?.targetDir && options.onParent) {
    const up = el('button', 'fv-icons__parent');
    up.type = 'button';
    up.textContent = 'Up';
    up.setAttribute('aria-label', 'Open parent directory');
    up.addEventListener('click', () => {
      options.onParent?.();
    });
    bar.append(up);
  }

  const text = el('div', 'fv-icons__bar-text');
  const title = el('div', 'fv-icons__bar-title');
  title.textContent = barTitle(state);
  const sub = el('div', 'fv-icons__bar-sub');
  sub.textContent = barSubtitle(state);
  text.append(title, sub);
  bar.append(text);
  return bar;
}

function attachCellSelection(
  cell: HTMLElement,
  item: FVFile | FVDirectory,
  fileView: FileViewElement,
): void {
  cell.addEventListener('click', (ev: MouseEvent) => {
    const additive = ev.ctrlKey || ev.metaKey;
    if (additive) {
      const next = new Set(fileView.selectedFileUrls);
      if (next.has(item.fileUrl)) {
        next.delete(item.fileUrl);
      } else {
        next.add(item.fileUrl);
      }
      fileView.setSelectedFileUrls([...next]);
    } else {
      fileView.setSelectedFileUrls([item.fileUrl]);
    }
  });

  cell.addEventListener('contextmenu', (ev: MouseEvent) => {
    const selected = new Set(fileView.selectedFileUrls);
    if (selected.has(item.fileUrl)) {
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      const next = new Set(fileView.selectedFileUrls);
      next.add(item.fileUrl);
      fileView.setSelectedFileUrls([...next]);
    } else {
      fileView.setSelectedFileUrls([item.fileUrl]);
    }
  });
}

export function createGrid(
  state: IFVState | undefined,
  fileView: FileViewElement,
  onOpenDirectory: (dir: FVDirectory) => void,
): HTMLElement {
  const grid = el('div', 'fv-icons__grid');
  grid.setAttribute('role', 'listbox');
  grid.setAttribute('aria-multiselectable', 'true');

  const selected = new Set(fileView.selectedFileUrls);
  const list = state?.fileList ?? [];
  for (const item of list) {
    const isDir = item.kind === 'directory';
    const isSelected = selected.has(item.fileUrl);
    const cell = el(
      'div',
      `fv-icons__cell${isDir ? ' fv-icons__cell--dir' : ''}${isSelected ? ' fv-icons__cell--selected' : ''}`,
    );
    const glyph = el('div', 'fv-icons__glyph');
    glyph.textContent = iconGlyph(item.kind);
    const name = el('div', 'fv-icons__name');
    name.textContent = labelForItem(item);
    cell.append(glyph, name);

    cell.setAttribute('role', 'option');
    cell.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    cell.tabIndex = 0;

    if (isDir) {
      const dir = item;
      cell.setAttribute('aria-label', `Folder ${dir.name}, double-click or press Enter to open`);
      const open = () => {
        onOpenDirectory(dir);
      };
      cell.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        open();
      });
      cell.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
    } else {
      cell.setAttribute('aria-label', `File ${item.name}`);
    }

    attachCellSelection(cell, item, fileView);
    grid.append(cell);
  }
  return grid;
}
