import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  // Set base to './' for GitHub Pages — works with any repo name
  base: './',
  plugins: [
    react(),
    nodePolyfills({
      // GramJS needs these Node built-ins polyfilled in the browser
      include: ['buffer', 'crypto', 'stream', 'util', 'events', 'path', 'os'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        // GramJS imports net/fs for its Node TCP path — safe to ignore in browser builds
        if (warning.message?.includes('externalized for browser compatibility')) return;
        warn(warning);
      },
      output: {
        manualChunks: {
          telegram: ['telegram'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['telegram'],
    esbuildOptions: {
      target: 'es2020',
    },
  },
  define: {
    // GramJS checks these globals
    'global': 'globalThis',
  },
});
