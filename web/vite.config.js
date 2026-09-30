import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时 /api 代理到后端；生产构建由 Express 托管 dist/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
