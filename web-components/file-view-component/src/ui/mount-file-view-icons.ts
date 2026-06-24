import type { FileViewElement } from '../component/file-view.js';
import type { FVDirectory, IFVState } from '../types/fv-models.js';
import { createBar, createGrid } from './icons-dom.js';
import { parentFileUrl } from './icons-model.js';

export interface MountFileViewIconsOptions {
  /** Container for the bar + grid (replaced on each render). */
  root: HTMLElement;
  /** Connected `<file-view>` with `setTargetDir` / `currentState`. */
  fileView: FileViewElement;
  /** When true, show an "Up" control if a parent `file://` URL can be derived. */
  showParentNav?: boolean;
}

export interface MountFileViewIconsHandle {
  /** Re-read `fileView.currentState` and redraw (e.g. before first event). */
  update(): void;
  dispose(): void;
}

function render(
  root: HTMLElement,
  state: IFVState | undefined,
  fileView: FileViewElement,
  showParentNav: boolean,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'fv-icons';

  const parentUrl =
    showParentNav && state?.targetDir ? parentFileUrl(state.targetDir.fileUrl) : undefined;
  const onParent =
    parentUrl !== undefined
      ? () => {
          void fileView.setTargetDir(parentUrl);
        }
      : undefined;

  const bar = createBar(state, {
    showParent: parentUrl !== undefined && onParent !== undefined,
    onParent,
  });
  const grid = createGrid(state, fileView, (dir: FVDirectory) => {
    void fileView.setTargetDir(dir.fileUrl);
  });
  wrap.append(bar, grid);
  root.replaceChildren(wrap);
}

export function mountFileViewIcons(options: MountFileViewIconsOptions): MountFileViewIconsHandle {
  const { root, fileView, showParentNav = false } = options;

  const onState = (ev: Event) => {
    const detail = (ev as CustomEvent<{ state: IFVState }>).detail;
    render(root, detail.state, fileView, showParentNav);
  };

  const onSelection = () => {
    render(root, fileView.currentState, fileView, showParentNav);
  };

  fileView.addEventListener('fv-state-changed', onState);
  fileView.addEventListener('fv-selection-changed', onSelection);
  render(root, fileView.currentState, fileView, showParentNav);

  return {
    update() {
      render(root, fileView.currentState, fileView, showParentNav);
    },
    dispose() {
      fileView.removeEventListener('fv-state-changed', onState);
      fileView.removeEventListener('fv-selection-changed', onSelection);
      root.replaceChildren();
    },
  };
}
