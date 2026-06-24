import * as monaco from '@codingame/monaco-vscode-editor-api';
import type { EditorApp } from 'monaco-languageclient/editorApp';
import type { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';

export interface MonacoLspBridgeOptions {
  /** Host custom element (for bubbling integration events). */
  hostElement: HTMLElement;
  editorApp: EditorApp;
  languageClientWrapper: LanguageClientWrapper;
}

/**
 * Monaco ↔ LSP integration layer for the Web Component.
 *
 * **Already handled by monaco-languageclient + monaco-vscode-api (no extra code needed):**
 * - `textDocument/didOpen`, `didChange` (incremental sync), `didClose` via VS Code workspace
 *   text models backing `EditorApp`.
 * - `textDocument/publishDiagnostics` → Monaco markers / problems UI.
 * - `textDocument/completion` (+ resolve) when the user invokes suggest (e.g. Ctrl+Space) or
 *   `quickSuggestions` fires; the client sends the **current cursor position** in the request.
 *
 * This module adds **explicit host-level hooks** so integrators can observe the same pipeline:
 * - `editor-text-changed` — model content edits (Monaco side).
 * - `editor-cursor-position` — caret moves (editor UI); LSP still uses on-demand position params.
 * - `lsp-diagnostics` — marker updates after the language client applies diagnostics.
 */
export function connectMonacoLspBridge(options: MonacoLspBridgeOptions): monaco.IDisposable {
  const editor = options.editorApp.getEditor();
  if (!editor) {
    return { dispose: () => {} };
  }

  const disposables: monaco.IDisposable[] = [];

  disposables.push(
    editor.onDidChangeModelContent((e) => {
      options.hostElement.dispatchEvent(
        new CustomEvent('editor-text-changed', {
          bubbles: true,
          composed: true,
          detail: {
            changeCount: e.changes.length,
            versionId: e.versionId,
          },
        }),
      );
    }),
  );

  disposables.push(
    editor.onDidChangeCursorPosition((e) => {
      options.hostElement.dispatchEvent(
        new CustomEvent('editor-cursor-position', {
          bubbles: true,
          composed: true,
          detail: {
            lineNumber: e.position.lineNumber,
            column: e.position.column,
            reason: e.reason,
          },
        }),
      );
    }),
  );

  disposables.push(
    monaco.editor.onDidChangeMarkers((resources) => {
      const model = editor.getModel();
      if (!model) {
        return;
      }
      const uri = model.uri;
      const hit = resources.some((r) => r.toString() === uri.toString());
      if (!hit) {
        return;
      }
      const markers = monaco.editor.getModelMarkers({ resource: uri });
      options.hostElement.dispatchEvent(
        new CustomEvent('lsp-diagnostics', {
          bubbles: true,
          composed: true,
          detail: {
            uri: uri.toString(),
            markers,
          },
        }),
      );
    }),
  );

  return {
    dispose: () => {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
