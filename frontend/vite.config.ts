import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const geojsonPlugin: Plugin = {
  name: 'geojson-loader',
  transform(code, id) {
    if (id.endsWith('.geojson')) {
      return {
        code: `export default ${JSON.stringify(JSON.parse(code))};`,
        map: null,
      };
    }
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), geojsonPlugin],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-map': ['maplibre-gl', 'terra-draw', 'terra-draw-maplibre-gl-adapter'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
});
