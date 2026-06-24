import { CodeEditorElement } from './component/code-editor.js';

const DEFAULT_TAG = 'code-editor';

/**
 * Registers the custom element. Safe to call multiple times.
 */
export function defineCodeEditorElement(tagName: string = DEFAULT_TAG): void {
  const ctor = CodeEditorElement;
  if (customElements.get(tagName) === undefined) {
    customElements.define(tagName, ctor);
  }
}

export { CodeEditorElement };
export type { EditorLanguage } from './languages/registry.js';
export {
  parseEditorLanguage,
  getLanguageRegistration,
  virtualDocumentFileUrl,
} from './languages/registry.js';
export { buildLspWebSocketUrl, type BuildLspWebSocketUrlOptions } from './lsp/lsp-connection-url.js';
export { connectMonacoLspBridge, type MonacoLspBridgeOptions } from './lsp/monaco-lsp-adapter.js';
export { createLanguageClientConfig, startLanguageClient, disposeLanguageClient } from './lsp/language-client.js';

// Side-effect: auto-register default tag when bundle is loaded directly.
defineCodeEditorElement(DEFAULT_TAG);
