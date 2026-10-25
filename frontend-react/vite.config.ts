import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy all /api/* and /metrics requests to the Flask backend during
      // development. This avoids CORS entirely — the browser sees a single
      // origin (localhost:5173) and Flask receives the cookie + CSRF header
      // unchanged.
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/metrics': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    // Split vendor chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // 'react-vendor' omitted: React 19 ships its JSX runtime inside
          // react-dom and does not produce a meaningful separate chunk —
          // the previous entry generated an empty 51-byte stub file.
          'router': ['react-router-dom'],
          'query': ['@tanstack/react-query'],
        },
      },
    },
  },
});
