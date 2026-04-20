import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'crypto', 'stream', 'util', 'events', 'path', 'os'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    // Build directly into repo root so GitHub Pages serves it immediately
    outDir: '.',
    emptyOutDir: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.message?.includes('externalized for browser compatibility')) return;
        warn(warning);
      },
      output: {
        // All built assets go into /assets/
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        manualChunks: {
          telegram: ['telegram'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['telegram'],
    esbuildOptions: { target: 'es2020' },
  },
  define: {
    'global': 'globalThis',
  },
});
