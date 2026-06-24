import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'WebCommandComponent',
      formats: ['es'],
      fileName: 'web-command-component',
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
