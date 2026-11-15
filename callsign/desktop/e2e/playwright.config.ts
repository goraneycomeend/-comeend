import { defineConfig } from '@playwright/test';

// 콜사인 PC 앱 점검(스모크). 실제 앱 창을 띄워서 본다.
//
//   npm run smoke                          개발 실행(electron . + CALLSIGN_WEB_DIR 또는 ../dist)
//   CALLSIGN_APP_EXE=<실행 파일> npm run smoke   포장된 폴더의 실행 파일이나 설치된 실행 파일
//
// 리눅스에서는 화면이 필요하다: xvfb-run -a npm run smoke
// @playwright/test 는 상위 폴더(callsign/node_modules)의 것을 쓴다. 브라우저는 내려받지 않는다(Electron 이 곧 브라우저다).

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: '../test-results',
  // 창 하나를 차례로 띄운다. 엔진 점검은 CPU 를 전부 쓴다
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { trace: 'off' },
});
