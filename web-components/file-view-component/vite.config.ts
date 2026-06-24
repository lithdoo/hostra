import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    lib: {
      entry: {
        'file-view-component': path.resolve(__dirname, 'src/index.ts'),
        'file-view-component-icons': path.resolve(__dirname, 'src/ui/icons-entry.ts'),
      },
      formats: ['es'],
    },
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.[0]?.endsWith('.css')) {
            return 'file-view-component-icons.css';
          }
          return '[name][extname]';
        },
      },
    },
  },
});
