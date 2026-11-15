// 테스트용 진입점(audioHarness.ts)을 앱과 같은 Vite 설정으로 묶어서 페이지에 올려 준다.
// 따로 서버를 띄우지 않고, 테스트 서버 주소 아래의 가상 경로(__dsp/)로 요청을 가로채 응답한다.
// 덕분에 어떤 빌드가 떠 있든(앱 dist 든 다른 담당의 dist 든) 같은 방식으로 돈다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../..');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

export type HarnessFiles = Map<string, string | Uint8Array>;

/** 실제 앱 빌드와 같은 설정(압축 포함)으로 묶는다. 결과는 메모리에만 둔다 */
export async function buildHarness(entry = 'audioHarness.ts'): Promise<HarnessFiles> {
  const result = await build({
    root: appRoot,
    configFile: path.join(appRoot, 'vite.config.ts'),
    logLevel: 'error',
    publicDir: false,
    build: {
      write: false,
      rollupOptions: {
        input: path.join(here, entry),
        output: { format: 'es', entryFileNames: 'harness.js', chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
  const files: HarnessFiles = new Map();
  for (const o of outputs) files.set(o.fileName, o.type === 'chunk' ? o.code : o.source);
  files.set(
    'index.html',
    '<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>음향 모듈 테스트</title></head>' +
      '<body><button id="tap">tap</button><script type="module" src="./harness.js"></script></body></html>',
  );
  return files;
}

/** __dsp/ 아래 요청을 묶은 결과와 e2e/fixtures 의 파일로 응답하게 하고, 테스트 페이지를 연다 */
export async function openHarness(page: Page, files: HarnessFiles): Promise<void> {
  await page.route('**/__dsp/**', async (route) => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split('/__dsp/')[1] ?? '');
    const type = TYPES[path.extname(name)] ?? 'application/octet-stream';
    const built = files.get(name);
    if (built !== undefined) {
      await route.fulfill({ contentType: type, body: typeof built === 'string' ? built : Buffer.from(built) });
      return;
    }
    if (name.startsWith('fixtures/')) {
      const file = path.join(here, path.basename(name));
      if (fs.existsSync(file)) {
        await route.fulfill({ contentType: type, body: fs.readFileSync(file) });
        return;
      }
    }
    await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  });
  await page.goto('./__dsp/index.html');
  await page.waitForFunction(() => typeof window.__dsp === 'object');
}

/** e2e/fixtures 안의 파일 절대 경로 */
export function fixturePath(name: string): string {
  return path.join(here, name);
}
