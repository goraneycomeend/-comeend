import { defineConfig, devices } from '@playwright/test';

// 빌드 결과물을 `vite preview` 로 띄워 놓고 검증한다. 먼저 빌드해 둘 것.
//
//   E2E_PORT      서버 포트 (기본 4307)
//   E2E_DIST      띄울 빌드 폴더 (기본 dist)
//   E2E_BASE_URL  이미 떠 있는 서버를 쓸 때. 주면 서버를 따로 띄우지 않는다
//
// 예) npx vite build --outDir /tmp/dist-tts
//     E2E_PORT=4301 E2E_DIST=/tmp/dist-tts npx playwright test e2e/tts.spec.ts --trace off

const port = Number(process.env.E2E_PORT ?? 4307);
const dist = process.env.E2E_DIST ?? 'dist';
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}/`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  // 모델 로드와 음성 합성은 무겁다. 4코어 머신에서 서로 방해하지 않게 한 번에 하나씩.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    locale: 'ko-KR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort --outDir ${JSON.stringify(dist)}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
