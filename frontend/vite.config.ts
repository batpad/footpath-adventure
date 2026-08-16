import { defineConfig } from 'vite';

export default defineConfig({
  // Vite's dep pre-bundling breaks maplibre's worker module in dev (sources
  // silently never load); excluding it makes dev match production.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    proxy: {
      // 127.0.0.1, not localhost: another local service squats on [::1]:8000.
      '/api': 'http://127.0.0.1:8000',
      '/media': 'http://127.0.0.1:8000',
    },
  },
});
