import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: resolve(extensionRoot, 'node_modules/react'),
      'react-dom': resolve(extensionRoot, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(extensionRoot, 'node_modules/react/jsx-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        test: {
          name: 'extension-host',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'webview-mirror',
          environment: 'jsdom',
          globals: true,
          include: [
            'src/scie-md/**/*.test.ts',
            'src/scie-md/**/*.test.tsx',
            'src/webview/**/*.test.ts',
            'src/webview/**/*.test.tsx',
          ],
        },
      },
    ],
  },
});
