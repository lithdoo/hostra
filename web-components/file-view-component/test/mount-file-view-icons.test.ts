import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileViewElement } from '../src/component/file-view.js';
import type { IFVState } from '../src/types/fv-models.js';
import { mountFileViewIcons } from '../src/ui/mount-file-view-icons.js';
import { flushMicrotasks } from './flush-microtasks.js';

function setsEqualString(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const x of a) {
    if (!b.has(x)) {
      return false;
    }
  }
  return true;
}

function createStubFileView(initial?: IFVState): {
  fileView: FileViewElement;
  setTargetDir: ReturnType<typeof vi.fn>;
} {
  let current: IFVState | undefined = initial;
  let selected = new Set<string>();
  const bus = new EventTarget();

  const snapshotOrdered = (): string[] => {
    if (!current) {
      return [];
    }
    return current.fileList.map((e) => e.fileUrl).filter((url) => selected.has(url));
  };

  const setTargetDir = vi.fn(async (url: string) => {
    current = {
      fileList: [],
      targetDir: {
        kind: 'directory',
        name: url.split('/').pop() ?? 'dir',
        fileUrl: url,
        hidden: false,
      },
    };
    return current;
  });

  const setSelectedFileUrls = (urls: readonly string[]) => {
    const allowed = current ? new Set(current.fileList.map((e) => e.fileUrl)) : new Set<string>();
    const next = new Set<string>();
    for (const raw of urls) {
      const u = raw.trim();
      if (u.length > 0 && allowed.has(u)) {
        next.add(u);
      }
    }
    if (setsEqualString(selected, next)) {
      return;
    }
    selected = next;
    bus.dispatchEvent(
      new CustomEvent('fv-selection-changed', {
        bubbles: true,
        composed: true,
        detail: { fileUrls: snapshotOrdered() },
      }),
    );
  };

  bus.addEventListener('fv-state-changed', (ev) => {
    current = (ev as CustomEvent<{ state: IFVState }>).detail.state;
    const allowed = new Set(current.fileList.map((e) => e.fileUrl));
    const pruned = new Set<string>();
    for (const url of selected) {
      if (allowed.has(url)) {
        pruned.add(url);
      }
    }
    if (!setsEqualString(selected, pruned)) {
      selected = pruned;
      bus.dispatchEvent(
        new CustomEvent('fv-selection-changed', {
          bubbles: true,
          composed: true,
          detail: { fileUrls: snapshotOrdered() },
        }),
      );
    }
  });

  Object.defineProperty(bus, 'currentState', {
    configurable: true,
    enumerable: true,
    get(): IFVState | undefined {
      return current;
    },
  });
  Object.defineProperty(bus, 'selectedFileUrls', {
    configurable: true,
    enumerable: true,
    get(): readonly string[] {
      return snapshotOrdered();
    },
  });
  Object.defineProperty(bus, 'setSelectedFileUrls', {
    configurable: true,
    enumerable: true,
    value: setSelectedFileUrls,
    writable: true,
  });
  Object.defineProperty(bus, 'setTargetDir', {
    configurable: true,
    enumerable: true,
    value: setTargetDir,
    writable: true,
  });

  return { fileView: bus as unknown as FileViewElement, setTargetDir };
}

describe('mountFileViewIcons', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders grid from fv-state-changed and clears on dispose', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    const handle = mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    expect(root.querySelector('.fv-icons__bar-title')?.textContent).toBe('data');
    expect(root.querySelectorAll('.fv-icons__cell').length).toBe(1);
    handle.dispose();
    expect(root.childNodes.length).toBe(0);
  });

  it('opens a directory on double-click or Enter, not on single click', async () => {
    const { fileView: fv, setTargetDir } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'directory',
          name: 'sub',
          fileUrl: 'file:///D:/data/sub',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tile = root.querySelector('[role="option"]') as HTMLElement | null;
    expect(tile).toBeTruthy();
    tile!.click();
    await flushMicrotasks();
    expect(setTargetDir).not.toHaveBeenCalled();

    tile!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await flushMicrotasks();
    expect(setTargetDir).toHaveBeenCalledWith('file:///D:/data/sub');

    setTargetDir.mockClear();
    tile!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flushMicrotasks();
    expect(setTargetDir).toHaveBeenCalledWith('file:///D:/data/sub');
  });

  it('selects a file tile on click and reflects setSelectedFileUrls from host', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tile = root.querySelector('.fv-icons__cell') as HTMLElement | null;
    expect(tile).toBeTruthy();
    expect(tile!.classList.contains('fv-icons__cell--selected')).toBe(false);
    tile!.click();
    await flushMicrotasks();
    const tileAfterSelect = root.querySelector('.fv-icons__cell') as HTMLElement | null;
    expect(tileAfterSelect?.classList.contains('fv-icons__cell--selected')).toBe(true);
    expect(tileAfterSelect?.getAttribute('aria-selected')).toBe('true');

    fv.setSelectedFileUrls([]);
    await flushMicrotasks();
    const tileAfterClear = root.querySelector('.fv-icons__cell') as HTMLElement | null;
    expect(tileAfterClear?.classList.contains('fv-icons__cell--selected')).toBe(false);
  });

  it('supports ctrl+click multi-select', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
        {
          kind: 'file',
          name: 'b.txt',
          fileUrl: 'file:///D:/data/b.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tiles = root.querySelectorAll('.fv-icons__cell');
    expect(tiles.length).toBe(2);
    (tiles[0] as HTMLElement).click();
    await flushMicrotasks();
    const afterFirst = root.querySelectorAll('.fv-icons__cell');
    expect(afterFirst[0].classList.contains('fv-icons__cell--selected')).toBe(true);
    expect(afterFirst[1].classList.contains('fv-icons__cell--selected')).toBe(false);

    (afterFirst[1] as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    await flushMicrotasks();
    const afterMulti = root.querySelectorAll('.fv-icons__cell');
    expect(afterMulti[0].classList.contains('fv-icons__cell--selected')).toBe(true);
    expect(afterMulti[1].classList.contains('fv-icons__cell--selected')).toBe(true);
  });

  it('contextmenu on an already-selected cell does not change selection', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
        {
          kind: 'file',
          name: 'b.txt',
          fileUrl: 'file:///D:/data/b.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tiles = root.querySelectorAll('.fv-icons__cell');
    (tiles[0] as HTMLElement).click();
    await flushMicrotasks();
    (root.querySelectorAll('.fv-icons__cell')[1] as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    await flushMicrotasks();
    expect(fv.selectedFileUrls.length).toBe(2);

    (root.querySelectorAll('.fv-icons__cell')[0] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await flushMicrotasks();
    expect(fv.selectedFileUrls.length).toBe(2);
    expect(new Set(fv.selectedFileUrls)).toEqual(
      new Set(['file:///D:/data/a.txt', 'file:///D:/data/b.txt']),
    );
  });

  it('contextmenu on an unselected cell replaces selection without modifier', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
        {
          kind: 'file',
          name: 'b.txt',
          fileUrl: 'file:///D:/data/b.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tiles = root.querySelectorAll('.fv-icons__cell');
    (tiles[0] as HTMLElement).click();
    await flushMicrotasks();
    expect(fv.selectedFileUrls).toEqual(['file:///D:/data/a.txt']);

    (root.querySelectorAll('.fv-icons__cell')[1] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    await flushMicrotasks();
    expect(fv.selectedFileUrls).toEqual(['file:///D:/data/b.txt']);
  });

  it('contextmenu on an unselected cell with ctrl adds without clearing', async () => {
    const { fileView: fv } = createStubFileView();
    const root = document.createElement('div');
    document.body.append(root);
    mountFileViewIcons({ root, fileView: fv });
    const state: IFVState = {
      fileList: [
        {
          kind: 'file',
          name: 'a.txt',
          fileUrl: 'file:///D:/data/a.txt',
          hidden: false,
        },
        {
          kind: 'file',
          name: 'b.txt',
          fileUrl: 'file:///D:/data/b.txt',
          hidden: false,
        },
      ],
      targetDir: {
        kind: 'directory',
        name: 'data',
        fileUrl: 'file:///D:/data',
        hidden: false,
      },
    };
    fv.dispatchEvent(
      new CustomEvent('fv-state-changed', { bubbles: true, composed: true, detail: { state } }),
    );
    await flushMicrotasks();
    const tiles = root.querySelectorAll('.fv-icons__cell');
    (tiles[0] as HTMLElement).click();
    await flushMicrotasks();
    expect(fv.selectedFileUrls).toEqual(['file:///D:/data/a.txt']);

    (root.querySelectorAll('.fv-icons__cell')[1] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey: true }),
    );
    await flushMicrotasks();
    expect(fv.selectedFileUrls.length).toBe(2);
    expect(new Set(fv.selectedFileUrls)).toEqual(
      new Set(['file:///D:/data/a.txt', 'file:///D:/data/b.txt']),
    );
  });
});
