import { FileViewElement } from './component/file-view.js';

const DEFAULT_TAG = 'file-view';

/**
 * Registers the custom element. Safe to call multiple times.
 */
export function defineFileViewElement(tagName: string = DEFAULT_TAG): void {
  const ctor = FileViewElement;
  if (customElements.get(tagName) === undefined) {
    customElements.define(tagName, ctor);
  }
}

export { FileViewElement };
export type { FvSelectionChangedDetail } from './component/file-view.js';
export type { FVDirectory, FVFile, FVMeta, FVMetaInfo, FVMetaLink, IFVState } from './types/fv-models.js';
export {
  FvJsonRpcError,
  FvJsonRpcSession,
  type FvConnectionStatus,
  type FvJsonRpcNotificationHandlers,
  type FvJsonRpcSessionOptions,
} from './rpc/fv-json-rpc-session.js';

// Side-effect: auto-register default tag when bundle is loaded directly.
defineFileViewElement(DEFAULT_TAG);
