import { LayoutService } from '@codingame/monaco-vscode-layout-service-override';

/**
 * `monaco-vscode-workbench-service-override` registers `onLayout` and calls
 * `accessor.get(IWorkbenchLayoutService).startup()`. `IWorkbenchLayoutService` is the same
 * decorator as `ILayoutService`; the default {@link LayoutService} has no `startup`, which
 * yields `startup is not a function`. A no-op-ish `startup` that re-runs layout is enough for
 * the classic editor + views stack.
 */
export class LayoutServiceWithWorkbenchStartup extends LayoutService {
  startup(): void {
    this.layout();
  }
}
