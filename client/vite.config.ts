import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // Increase chunk size warning to 1 MB — the panel has heavy deps (xterm, leaflet, recharts).
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split large vendor libraries into separate cache-friendly chunks.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-terminal': ['@xterm/xterm', '@xterm/addon-fit'],
          'vendor-capacitor': ['@capacitor/core', '@capacitor/app'],
          'vendor-ui': ['lucide-react'],
        },
      },
    },
    // Target modern Android WebView (Chromium 90+).
    target: ['chrome90', 'es2020'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
});
