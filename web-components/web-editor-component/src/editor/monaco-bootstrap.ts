import './standalone-language-contributions.js';

import { LogLevel } from '@codingame/monaco-vscode-api';
import type { ILogger } from '@codingame/monaco-vscode-log-service-override';
import { type MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import { WebEditorMonacoVscodeApiWrapper } from './monaco-vscode-api-wrapper-subclass.js';
import { defineDefaultWorkerLoaders, useWorkerFactory } from 'monaco-languageclient/workerFactory';
import { registerVirtualWorkspaceOverlay } from './virtual-workspace.js';

let apiSingleton: WebEditorMonacoVscodeApiWrapper | null = null;
let startPromise: Promise<WebEditorMonacoVscodeApiWrapper> | null = null;

/**
 * Classic worker setup from TypeFox examples: TextMate worker is incompatible with classic mode.
 */
export function configureClassicWorkerFactory(logger?: ILogger): void {
  const workerLoaders = defineDefaultWorkerLoaders();
  workerLoaders.TextMateWorker = undefined;
  workerLoaders.extensionHostWorkerMain = undefined;
  useWorkerFactory({
    workerLoaders,
    logger,
  });
}

function buildClassicApiConfig(): MonacoVscodeApiConfig {
  return {
    $type: 'classic',
    viewsConfig: {
      $type: 'EditorService',
    },
    serviceOverrides: {},
    logLevel: LogLevel.Off,
    userConfiguration: {
      json: JSON.stringify({
        'editor.experimental.asyncTokenization': true,
        'editor.quickSuggestions': { other: true, comments: false, strings: true },
        'editor.wordBasedSuggestions': 'off',
      }),
    },
    monacoWorkerFactory: configureClassicWorkerFactory,
    /**
     * Must load `@codingame/monaco-vscode-extensions-service-override`: the workbench still spins up an
     * extension host and MainThread* customers (e.g. webviews). Skipping it leaves stub services and
     * throws `Error: unsupported` / `mainPart.getContainer is not a function`.
     * Keep `enableExtHostWorker: false` so we use the local extension host, not a separate worker
     * (`extensionHostWorkerMain` is already unset in `configureClassicWorkerFactory`).
     */
    advanced: {
      loadExtensionServices: true,
      loadThemes: false,
      enableExtHostWorker: false,
    },
  };
}

/**
 * monaco-vscode-api initializes only once per page. All `<code-editor>` instances share this wrapper.
 */
export function ensureMonacoVscodeApi(): Promise<WebEditorMonacoVscodeApiWrapper> {
  if (startPromise) {
    return startPromise;
  }
  startPromise = (async () => {
    await registerVirtualWorkspaceOverlay();
    ensureWorkbenchLayoutHost();
    apiSingleton = new WebEditorMonacoVscodeApiWrapper(buildClassicApiConfig());
    await apiSingleton.start({
      caller: '@web-editor/component',
      performServiceConsistencyChecks: false,
    });
    if (!apiSingleton) {
      throw new Error('MonacoVscodeApiWrapper missing after start');
    }
    return apiSingleton;
  })();
  return startPromise;
}

const WORKBENCH_HOST_ID = 'monaco-vscode-workbench-host';

/** Off-screen host so `initialize()` receives a real DOM node (see `WebEditorMonacoVscodeApiWrapper`). */
function ensureWorkbenchLayoutHost(): void {
  if (document.getElementById(WORKBENCH_HOST_ID)) {
    return;
  }
  const el = document.createElement('div');
  el.id = WORKBENCH_HOST_ID;
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);pointer-events:none';
  document.body.appendChild(el);
}
