import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@sciemd/core': resolve(extensionRoot, '..', 'packages/core/src/index.ts'),
      '@sciemd/core/': `${resolve(extensionRoot, '..', 'packages/core/src')}/`,
    },
  },
  build: {
    outDir: 'dist/webview',
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      input: 'src/webview/main.tsx',
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
