import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로로 빌드한다. 하위 경로, https://localhost(앱 웹뷰), 아티팩트 어디에 올려도 열려야 한다.
  base: './',
  plugins: [react()],
  resolve: {
    // onnxruntime-web 이 wasm 을 번들에 끌어들이지 않고, 실행할 때 public/ort/ 에서 읽는 빌드를 고르게 한다.
    // (이 조건이 없으면 Vite 가 같은 wasm 을 dist/assets 에 한 벌 더 넣는다)
    conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'],
  },
  optimizeDeps: {
    // 개발 서버의 사전 번들링이 런타임 파일 경로 계산을 건드리지 않게 원본 그대로 쓴다.
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
  // 포트가 이미 쓰이고 있으면 옆 포트로 넘어가지 말고 실패한다(여럿이 포트를 나눠 쓴다).
  // COOP/COEP 헤더는 일부러 넣지 않는다. 실제 배포 환경처럼 단일 스레드 wasm 기준으로 검증한다.
  server: { strictPort: true },
  preview: { strictPort: true },
});
