import { createRequire } from 'node:module';
import path from 'node:path';
import type { SpawnOptions } from 'node:child_process';

const require = createRequire(import.meta.url);

export interface LanguageSpawnSpec {
  /** Log label */
  name: string;
  command: string;
  args: string[];
  spawnOptions?: SpawnOptions;
}

/**
 * Resolve how to spawn a language server for the given `language` query value.
 * Uses the same identifiers as the web editor: typescript, json, markdown, toml.
 */
export function resolveLanguageSpawn(language: string): LanguageSpawnSpec | undefined {
  const n = language.trim().toLowerCase();

  if (n === 'typescript' || n === 'ts') {
    const entry = require.resolve('typescript-language-server/lib/cli.mjs');
    return {
      name: 'typescript-language-server',
      command: process.execPath,
      args: [entry, '--stdio'],
    };
  }

  if (n === 'json' || n === 'jsonc') {
    const root = path.dirname(require.resolve('vscode-langservers-extracted/package.json'));
    const main = path.join(root, 'lib/json-language-server/node/jsonServerMain.js');
    return {
      name: 'vscode-json-language-server',
      command: process.execPath,
      args: [main, '--stdio'],
    };
  }

  if (n === 'markdown' || n === 'md') {
    const root = path.dirname(require.resolve('vscode-langservers-extracted/package.json'));
    const main = path.join(root, 'lib/markdown-language-server/node/main.js');
    return {
      name: 'vscode-markdown-language-server',
      command: process.execPath,
      args: [main, '--stdio'],
    };
  }

  if (n === 'toml') {
    const root = path.dirname(require.resolve('@taplo/cli/package.json'));
    const cli = path.join(root, 'dist/cli.js');
    return {
      name: 'taplo-lsp',
      command: process.execPath,
      args: [cli, 'lsp', 'stdio'],
    };
  }

  return undefined;
}
