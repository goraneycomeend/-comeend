import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 Vite(5173) 가 /api 와 /ws 를 Python 서버(8765) 로 프록시한다.
// 빌드 결과(dist/) 는 Python 서버가 직접 서빙하므로 프록시가 필요 없다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
      '/ws': { target: 'ws://127.0.0.1:8765', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
