import { defineConfig } from 'vitest/config';

// 단위 테스트는 Node 환경에서 돈다. 브라우저가 필요한 것은 e2e/ (Playwright)로.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // 실제 가중치로 합성하는 테스트가 있어 넉넉하게 잡는다
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
