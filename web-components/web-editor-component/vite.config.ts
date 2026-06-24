import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    dedupe: ['vscode'],
    alias: {
      vscode: path.resolve(__dirname, 'node_modules/@codingame/monaco-vscode-extension-api'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'WebEditorComponent',
      formats: ['es'],
      fileName: 'web-editor-component',
    },
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
