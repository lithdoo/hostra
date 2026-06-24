import {
  InMemoryFileSystemProvider,
  registerFileSystemOverlay,
} from '@codingame/monaco-vscode-files-service-override';
import * as vscode from 'vscode';

let registered = false;

/**
 * Registers an in-memory overlay for `file:///workspace` (and the default `.code-workspace` file)
 * so the browser never hits the real disk (fixes Windows `ENOENT: D:\\workspace`).
 * Must run before `MonacoVscodeApiWrapper.start()`.
 */
export async function registerVirtualWorkspaceOverlay(): Promise<void> {
  if (registered) {
    return;
  }
  registered = true;

  const provider = new InMemoryFileSystemProvider();
  const workspaceDir = vscode.Uri.file('/workspace');
  const workspaceFile = vscode.Uri.file('/workspace.code-workspace');

  try {
    await provider.mkdir(workspaceDir);
  } catch {
    // already exists
  }

  // Folder path is relative to the workspace file parent (`/`), i.e. `/workspace`.
  const wsJson = JSON.stringify(
    {
      folders: [{ path: 'workspace', name: 'workspace' }],
    },
    null,
    2,
  );
  await provider.writeFile(workspaceFile, new TextEncoder().encode(wsJson), {
    create: true,
    overwrite: true,
    unlock: false,
    atomic: false,
  });

  registerFileSystemOverlay(1, provider);
}
