import { initialize, LogLevel } from '@codingame/monaco-vscode-api';
import { SyncDescriptor } from '@codingame/monaco-vscode-api/vscode/vs/platform/instantiation/common/descriptors';
import { ILayoutService } from '@codingame/monaco-vscode-api/vscode/vs/platform/layout/browser/layoutService.service';
import type { ILogger } from '@codingame/monaco-vscode-log-service-override';
import { setUnexpectedErrorHandler } from '@codingame/monaco-vscode-api/monaco';
import getViewsServiceOverride from '@codingame/monaco-vscode-views-service-override';
import {
  MonacoVscodeApiWrapper,
  mergeServices,
  reportServiceLoading,
  useOpenEditorStub,
} from 'monaco-languageclient/vscodeApiWrapper';
import { LayoutServiceWithWorkbenchStartup } from './layout-service-with-startup.js';

/**
 * `MonacoVscodeApiWrapper.configureViewsServices()` merges `getEditorServiceOverride` for
 * `EditorService` mode, which registers `IEditorGroupsService` backed by `EmptyEditorGroupsService`
 * (`registerContextKeyProvider` → `unsupported`). That runs after any user `serviceOverrides` and
 * breaks webview / extension host (`WebviewWorkbenchService`). Re-apply the full views override
 * after so `MonacoEditorParts` (real `EditorParts`) wins.
 *
 * `initAllServices`: monaco-languageclient passes `undefined` as the workbench container for
 * `EditorService`, which overrides the default `document.body` in `initialize()`. Pass a real node
 * (hidden host) instead.
 */
export class WebEditorMonacoVscodeApiWrapper extends MonacoVscodeApiWrapper {
  protected override async configureViewsServices(): Promise<void> {
    await super.configureViewsServices();
    const cfg = this.getMonacoVscodeApiConfig();
    if (cfg.viewsConfig.$type !== 'EditorService') {
      return;
    }
    const overrides = cfg.serviceOverrides;
    if (overrides === undefined) {
      return;
    }
    mergeServices(overrides, {
      ...getViewsServiceOverride(cfg.viewsConfig.openEditorFunc ?? useOpenEditorStub),
    });
  }

  protected override async initAllServices(performServiceConsistencyChecks?: boolean): Promise<void> {
    const services = await this.supplyRequiredServices();
    const cfg = this.getMonacoVscodeApiConfig();
    mergeServices(services, cfg.serviceOverrides);
    if (cfg.advanced?.loadExtensionServices === undefined || cfg.advanced.loadExtensionServices === true) {
      const { default: getExtensionServiceOverride } = await import(
        '@codingame/monaco-vscode-extensions-service-override'
      );
      mergeServices(services, {
        ...getExtensionServiceOverride({
          enableWorkerExtensionHost: cfg.advanced?.enableExtHostWorker === true,
        }),
      });
    }
    const logger = (this as unknown as { logger: ILogger }).logger;
    reportServiceLoading(services, logger);
    if (performServiceConsistencyChecks ?? true) {
      this.checkServiceConsistency();
    }
    const layoutHost = document.getElementById('monaco-vscode-workbench-host') ?? document.body;
    const layoutContainer =
      cfg.viewsConfig.$type === 'ViewsService' || cfg.viewsConfig.$type === 'WorkbenchService'
        ? (cfg.viewsConfig.htmlContainer ?? document.body)
        : layoutHost;
    mergeServices(services, {
      [ILayoutService.toString()]: new SyncDescriptor(LayoutServiceWithWorkbenchStartup, [layoutContainer], true),
    });
    if (cfg.viewsConfig.$type === 'ViewsService' || cfg.viewsConfig.$type === 'WorkbenchService') {
      await initialize(services, cfg.viewsConfig.htmlContainer, cfg.workspaceConfig, cfg.envOptions);
    } else {
      await initialize(services, layoutHost, cfg.workspaceConfig, cfg.envOptions);
    }
    setUnexpectedErrorHandler((e) => {
      if (logger.getLevel() !== LogLevel.Off) {
        logger.error('Unexpected error', e);
      }
    });
  }
}
