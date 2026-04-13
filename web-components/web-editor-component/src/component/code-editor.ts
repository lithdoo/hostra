import { EditorApp } from 'monaco-languageclient/editorApp';
import type { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { createEditorAppConfig } from '../editor/editor-app-factory.js';
import { ensureMonacoVscodeApi } from '../editor/monaco-bootstrap.js';
import {
  createLanguageClientConfig,
  disposeLanguageClient,
  startLanguageClient,
} from '../lsp/language-client.js';
import { buildLspWebSocketUrl } from '../lsp/lsp-connection-url.js';
import { connectMonacoLspBridge } from '../lsp/monaco-lsp-adapter.js';
import { parseEditorLanguage, virtualDocumentFileUrl } from '../languages/registry.js';

/**
 * `<code-editor>` — Monaco (classic) + optional LSP over WebSocket via monaco-languageclient.
 *
 * Attributes:
 * - `lsp-url` — Base WebSocket URL (e.g. `ws://127.0.0.1:8080/lsp`). A `language` query param is
 *   appended automatically for `@web-editor/lsp-ws-server`. Empty = no language client.
 * - `language` — `typescript` | `json` | `markdown` | `toml` (aliases: `ts`, `md`).
 * - `value` — initial document text (large payloads should use the `value` property instead).
 * - `file-path` — optional host path for LSP resolution (e.g. `D:\\repo\\src\\app.ts`). Requires the
 *   server to set `LSP_ALLOWED_ROOTS`. Does not read or write disk from the component; content is still
 *   only what you set in `value`.
 *
 * The `value` property, when assigned from JavaScript, takes precedence over the `value` attribute.
 *
 * Layout: does not inject document-level CSS. Set host size in your page (e.g. `display: block; height: 100%`);
 * the inner mount uses minimal inline sizing to fill the host.
 */
export class CodeEditorElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['lsp-url', 'language', 'value', 'file-path'];
  }

  readonly #instanceId: string;
  readonly #mount: HTMLDivElement;
  #abort: AbortController | null = null;
  #editorApp: EditorApp | undefined;
  #languageClient: LanguageClientWrapper | undefined;
  #lspBridge: { dispose: () => void } | undefined;
  #resizeObserver: ResizeObserver | undefined;
  /** When set, overrides the `value` attribute for document content. */
  #valueFromProperty: string | undefined;
  #bootPromise: Promise<void> | null = null;

  constructor() {
    super();
    this.#instanceId =
      globalThis.crypto && 'randomUUID' in globalThis.crypto
        ? globalThis.crypto.randomUUID()
        : `ce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    this.#mount = document.createElement('div');
    this.#mount.className = 'code-editor-mount';
    this.#mount.style.boxSizing = 'border-box';
    this.#mount.style.width = '100%';
    this.#mount.style.height = '100%';
    this.#mount.style.minHeight = '0';
  }

  get value(): string {
    if (this.#valueFromProperty !== undefined) {
      return this.#valueFromProperty;
    }
    return this.getAttribute('value') ?? '';
  }

  set value(text: string) {
    this.#valueFromProperty = text;
    const app = this.#editorApp;
    if (app?.isStarted()) {
      app.updateCode({ modified: text });
    }
  }

  /** Host filesystem path for LSP project binding; empty = temp workspace session on the server. */
  get filePath(): string {
    return (this.getAttribute('file-path') ?? '').trim();
  }

  set filePath(path: string) {
    const t = path.trim();
    if (t) {
      this.setAttribute('file-path', t);
    } else {
      this.removeAttribute('file-path');
    }
  }

  connectedCallback(): void {
    if (!this.contains(this.#mount)) {
      this.appendChild(this.#mount);
    }
    this.#bootPromise = this.#boot();
  }

  disconnectedCallback(): void {
    this.#abort?.abort();
    this.#abort = null;
    void this.#disposeEditorSession();
    this.#bootPromise = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return;
    }
    if (!this.isConnected) {
      return;
    }
    if (name === 'value') {
      if (this.#valueFromProperty === undefined) {
        this.#syncValueIntoModel(newValue ?? '');
      }
      return;
    }
    if (name === 'language' || name === 'lsp-url' || name === 'file-path') {
      this.#abort?.abort();
      this.#bootPromise = this.#boot();
    }
  }

  /**
   * Await the current bootstrap/dispose cycle (useful for tests).
   */
  whenReady(): Promise<void> {
    return this.#bootPromise ?? Promise.resolve();
  }

  #getEffectiveText(): string {
    if (this.#valueFromProperty !== undefined) {
      return this.#valueFromProperty;
    }
    return this.getAttribute('value') ?? '';
  }

  #syncValueIntoModel(text: string): void {
    const app = this.#editorApp;
    if (!app?.isStarted()) {
      return;
    }
    app.updateCode({ modified: text });
  }

  async #boot(): Promise<void> {
    this.#abort?.abort();
    const ac = new AbortController();
    this.#abort = ac;
    const { signal } = ac;

    await this.#disposeEditorSession();
    if (signal.aborted) {
      return;
    }

    const languageKey = this.getAttribute('language');
    const language = parseEditorLanguage(languageKey ?? 'typescript');
    if (!language) {
      console.warn(
        `[code-editor] Unsupported language ${JSON.stringify(languageKey)}. Use typescript, json, markdown, or toml.`,
      );
      return;
    }

    const lspUrl = (this.getAttribute('lsp-url') ?? '').trim();
    const text = this.#getEffectiveText();

    try {
      await ensureMonacoVscodeApi();
    } catch (e) {
      console.error('[code-editor] Failed to start monaco-vscode-api', e);
      return;
    }
    if (signal.aborted) {
      return;
    }

    const editorApp = new EditorApp(createEditorAppConfig(language, this.#instanceId, text));
    try {
      await editorApp.start(this.#mount);
    } catch (e) {
      console.error('[code-editor] Failed to start EditorApp', e);
      await editorApp.dispose();
      return;
    }
    if (signal.aborted) {
      await editorApp.dispose();
      return;
    }

    this.#editorApp = editorApp;
    this.#attachResizeObserver();

    if (lspUrl.length > 0) {
      let wsUrl: string;
      try {
        const fp = this.filePath;
        wsUrl = buildLspWebSocketUrl(
          lspUrl,
          language,
          fp
            ? { filePath: fp, documentUri: virtualDocumentFileUrl(language, this.#instanceId) }
            : undefined,
        );
      } catch (e) {
        console.error('[code-editor] Bad lsp-url', e);
        return;
      }
      const lcConfig = createLanguageClientConfig(language, wsUrl);
      try {
        const lcw = await startLanguageClient(lcConfig);
        if (signal.aborted) {
          await disposeLanguageClient(lcw);
          await editorApp.dispose();
          this.#editorApp = undefined;
          return;
        }
        this.#languageClient = lcw;
        this.#lspBridge = connectMonacoLspBridge({
          hostElement: this,
          editorApp,
          languageClientWrapper: lcw,
        });
      } catch (e) {
        console.error('[code-editor] Language client failed to start', e);
      }
    }
  }

  async #disposeEditorSession(): Promise<void> {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;

    await disposeLanguageClient(this.#languageClient);
    this.#languageClient = undefined;

    this.#lspBridge?.dispose();
    this.#lspBridge = undefined;

    if (this.#editorApp) {
      const app = this.#editorApp;
      this.#editorApp = undefined;
      await app.dispose();
    }
  }

  #attachResizeObserver(): void {
    this.#resizeObserver?.disconnect();
    const app = this.#editorApp;
    if (!app) {
      return;
    }
    this.#resizeObserver = new ResizeObserver(() => {
      if (!this.#editorApp?.isStarted()) {
        return;
      }
      const { width, height } = this.#mount.getBoundingClientRect();
      this.#editorApp.updateLayout({ width, height });
    });
    this.#resizeObserver.observe(this.#mount);
    queueMicrotask(() => {
      const { width, height } = this.#mount.getBoundingClientRect();
      if (width > 0 && height > 0) {
        app.updateLayout({ width, height });
      }
    });
  }
}
