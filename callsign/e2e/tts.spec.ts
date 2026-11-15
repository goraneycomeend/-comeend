// AI 음성 엔진을 실제 브라우저에서 확인한다: Worker 로 모델을 받고, 한국어 문장을 합성하고, 속도와 메모리를 잰다.
//
// 화면(UI)이 어떻게 생겼는지와 무관하게 엔진만 본다. 그래서 이 파일이 작은 시험용 페이지를 직접 만든다:
//   1) src/engine/ttsClient.ts 를 앱과 같은 vite 설정으로 묶어 node_modules/.cache 에 두고
//   2) 그 파일들을 page.route 로 앱 주소 아래(./tts-harness.html)에 끼워 넣는다.
// 모델(./models/)과 wasm 런타임(./ort/)은 `vite preview` 가 내주는 빌드 결과물을 그대로 쓴다.
// 먼저 `npm run setup` 과 빌드가 되어 있어야 한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { build } from 'vite';

import type { ModelLoadProgress, TtsEngine, TtsEngineStatus, TtsRequest } from '../src/core/types.ts';
import type { TtsEngineConfig, TtsEngineInfo } from '../src/engine/ttsClient.ts';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_DIR = path.join(APP, 'node_modules', '.cache', 'callsign-tts-harness');
const HARNESS_OUT = path.join(HARNESS_DIR, 'out');

/** 약 3.5초짜리 한국어 문장(속도 측정 기준) */
const SENTENCE = '목표 지점 확보. 다음 지시를 기다린다.';

interface Harness {
  getTtsEngine(): TtsEngine;
  getTtsEngineInfo(): TtsEngineInfo | null;
  configureTtsEngine(config: TtsEngineConfig): void;
}

interface LoadReport {
  statuses: TtsEngineStatus[];
  progress: ModelLoadProgress[];
  info: TtsEngineInfo | null;
  wallMs: number;
  crossOriginIsolated: boolean;
}

interface SynthReport {
  samples: Float32Array;
  sampleRate: number;
  wallMs: number;
  progressCount: number;
  lastSynth: TtsEngineInfo['lastSynth'];
}

// ── 시험용 페이지 ─────────────────────────────────────────────────────────

test.beforeAll(async () => {
  const entry = path.join(HARNESS_DIR, 'src', 'entry.ts');
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(
    entry,
    [
      `import { configureTtsEngine, getTtsEngine, getTtsEngineInfo } from ${JSON.stringify(path.join(APP, 'src/engine/ttsClient.ts'))};`,
      `Object.assign(window, { __tts: { configureTtsEngine, getTtsEngine, getTtsEngineInfo } });`,
      '',
    ].join('\n'),
  );
  await build({
    root: APP,
    configFile: path.join(APP, 'vite.config.ts'),
    logLevel: 'error',
    // 모델 145MB 를 또 복사하지 않는다. 그건 preview 서버가 내준다
    publicDir: false,
    build: {
      outDir: HARNESS_OUT,
      emptyOutDir: true,
      assetsDir: 'tts-harness',
      rolldownOptions: { input: entry, output: { entryFileNames: 'tts-harness/entry.js' } },
    },
  });
});

type HarnessMode =
  /** 헤더 없음. 일반 웹 배포와 같은 단일 스레드 환경 */
  | 'plain'
  /** 시험용 페이지에 교차 출처 격리 헤더를 붙인다. 서버도 모든 응답에 같은 헤더를 보내야 스레드가 뜬다 */
  | 'isolated'
  /** 문서와 런타임 파일 요청까지만 헤더를 붙인다. 스레드용 Worker 스크립트는 서버 응답 그대로라, 서버가 헤더를 안 주면 막힌다 */
  | 'isolated-partial';

const ISOLATION_HEADERS = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

/** preview 서버가 스스로 교차 출처 격리 헤더를 보내는지(PC 앱 셸이 그렇게 띄운다) */
async function serverSendsIsolationHeaders(page: Page): Promise<boolean> {
  const res = await page.request.head('./ort/ort-wasm-simd-threaded.mjs');
  return /require-corp|credentialless/i.test(res.headers()['cross-origin-embedder-policy'] ?? '');
}

/** 시험용 페이지를 연다 */
async function openHarness(page: Page, mode: HarnessMode = 'plain'): Promise<void> {
  const headers: Record<string, string> = mode === 'plain' ? {} : ISOLATION_HEADERS;
  await page.route('**/tts-harness.html', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers,
      body: '<!doctype html><html lang="ko"><meta charset="utf-8"><title>tts harness</title><script type="module" src="./tts-harness/entry.js"></script></html>',
    }),
  );
  await page.route('**/tts-harness/**', async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    const file = path.join(HARNESS_OUT, 'tts-harness', name);
    try {
      await route.fulfill({ status: 200, contentType: 'text/javascript', headers, body: await fs.readFile(file) });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  if (mode === 'isolated-partial') {
    // page.route 는 엔진 Worker 의 요청까지만 잡는다. 그 Worker 가 다시 띄우는 스레드용 Worker 의 요청은 잡지 못한다
    await page.route('**/ort/**', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), ...ISOLATION_HEADERS } });
    });
  }
  await page.goto('./tts-harness.html');
  await page.waitForFunction(() => '__tts' in window);
}

async function loadEngine(page: Page): Promise<LoadReport> {
  return page.evaluate(async () => {
    const { getTtsEngine, getTtsEngineInfo } = (window as unknown as { __tts: Harness }).__tts;
    const engine = getTtsEngine();
    const statuses: TtsEngineStatus[] = [engine.status];
    const progress: ModelLoadProgress[] = [];
    const off = engine.subscribe((s) => statuses.push(s));
    const t0 = performance.now();
    await engine.load((p) => progress.push(p));
    const wallMs = performance.now() - t0;
    off();
    return { statuses, progress, info: getTtsEngineInfo(), wallMs, crossOriginIsolated: self.crossOriginIsolated };
  });
}

async function synthesize(page: Page, request: TtsRequest): Promise<SynthReport> {
  const raw = await page.evaluate(async (req) => {
    const { getTtsEngine, getTtsEngineInfo } = (window as unknown as { __tts: Harness }).__tts;
    let progressCount = 0;
    const t0 = performance.now();
    const audio = await getTtsEngine().synthesize(req, { onProgress: () => progressCount++ });
    const wallMs = performance.now() - t0;
    // Float32 원본 바이트를 base64 로 넘긴다(테스트 프로세스에서 분석·저장)
    const bytes = new Uint8Array(audio.samples.buffer, audio.samples.byteOffset, audio.samples.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      pcm: btoa(binary),
      sampleRate: audio.sampleRate,
      wallMs,
      progressCount,
      lastSynth: getTtsEngineInfo()?.lastSynth ?? null,
    };
  }, request);
  const buf = Buffer.from(raw.pcm, 'base64');
  const samples = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { samples, sampleRate: raw.sampleRate, wallMs: raw.wallMs, progressCount: raw.progressCount, lastSynth: raw.lastSynth };
}

// ── 소리 분석(테스트 전용) ────────────────────────────────────────────────

function signalStats(x: Float32Array): { rms: number; peak: number; nonFinite: number } {
  let sum = 0;
  let peak = 0;
  let nonFinite = 0;
  for (const v of x) {
    if (!Number.isFinite(v)) nonFinite++;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return { rms: Math.sqrt(sum / Math.max(1, x.length)), peak, nonFinite };
}

/** 유성음 구간의 기본 주파수 중앙값(Hz). 자기상관으로 대강 잰다 */
function medianF0(x: Float32Array, sampleRate: number): number {
  const size = 2048;
  const hop = 1024;
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 60);
  const found: number[] = [];
  for (let start = 0; start + size < x.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += x[start + i] * x[start + i];
    if (energy / size < 1e-4) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let cross = 0;
      let a = 0;
      let b = 0;
      for (let i = 0; i < size - maxLag; i += 2) {
        cross += x[start + i] * x[start + i + lag];
        a += x[start + i] ** 2;
        b += x[start + i + lag] ** 2;
      }
      const r = cross / Math.sqrt(a * b + 1e-12);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.6) found.push(sampleRate / bestLag);
  }
  found.sort((p, q) => p - q);
  return found.length > 0 ? found[Math.floor(found.length / 2)] : 0;
}

/** 렌더러 프로세스의 최대 상주 메모리(MB). 리눅스의 /proc 을 읽는다. 잴 수 없으면 null */
async function rendererPeakRssMb(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    await cdp.detach();
    let peak = 0;
    for (const proc of processInfo) {
      if (proc.type !== 'renderer') continue;
      const status = await fs.readFile(`/proc/${proc.id}/status`, 'utf8').catch(() => '');
      const match = /VmHWM:\s+(\d+)\s+kB/.exec(status);
      if (match) peak = Math.max(peak, Number(match[1]) / 1024);
    }
    return peak > 0 ? Math.round(peak) : null;
  } catch {
    return null;
  }
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const request = (over: Partial<TtsRequest> = {}): TtsRequest => ({
  text: SENTENCE,
  lang: 'ko',
  blend: { F1: 1 },
  speed: 1,
  steps: 8,
  seed: 20240,
  ...over,
});

// ── 테스트 ────────────────────────────────────────────────────────────────

test('불러오기 전에는 합성을 거절하고, 모델을 몰래 받지 않는다', async ({ page }) => {
  const modelRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/models/')) modelRequests.push(r.url());
  });
  await openHarness(page);
  const result = await page.evaluate(async (req) => {
    const engine = (window as unknown as { __tts: Harness }).__tts.getTtsEngine();
    try {
      await engine.synthesize(req);
      return { status: engine.status, name: 'no error', message: '' };
    } catch (err) {
      return { status: engine.status, name: (err as Error).name, message: (err as Error).message };
    }
  }, request());
  expect(result.name).toBe('TtsNotReadyError');
  expect(result.message).toMatch(/불러와/);
  expect(result.status).toBe('idle');
  expect(modelRequests).toEqual([]);
});

test('Worker 가 모델을 받는 동안 진행률이 오고, 한국어 문장을 합성한다', async ({ page }) => {
  const pageErrors: string[] = [];
  const requested: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('request', (r) => requested.push(r.url()));
  await openHarness(page);

  const manifest = (await (await page.request.get('./models/manifest.json')).json()) as { totalBytes: number };
  const loaded = await loadEngine(page);
  const requestsAfterLoad = requested.length;

  // 상태: idle → loading → ready
  expect(loaded.statuses).toEqual(['idle', 'loading', 'ready']);
  // 진행률: 여러 번 오고, 줄어들지 않고, 끝은 전체 크기
  expect(loaded.progress.length).toBeGreaterThan(10);
  const bytes = loaded.progress.map((p) => p.loadedBytes);
  expect(bytes.every((b, i) => i === 0 || b >= bytes[i - 1])).toBe(true);
  expect(loaded.progress.every((p) => p.totalBytes === manifest.totalBytes)).toBe(true);
  expect(bytes[bytes.length - 1]).toBe(manifest.totalBytes);
  expect(loaded.progress.some((p) => p.phase === 'download')).toBe(true);
  expect(loaded.progress[loaded.progress.length - 1].phase).toBe('init');
  // 헤더 없는 일반 웹 환경: 단일 스레드
  expect(loaded.crossOriginIsolated).toBe(false);
  expect(loaded.info?.threads).toBe(1);
  expect(loaded.info?.sampleRate).toBe(44100);

  const female = await synthesize(page, request({ blend: { F1: 1 } }));
  const again = await synthesize(page, request({ blend: { F1: 1 } }));
  const male = await synthesize(page, request({ blend: { M3: 1 } }));
  const tenor = await synthesize(page, request({ blend: { M1: 1 } }));
  const mixed = await synthesize(page, request({ blend: { F1: 1, M1: 1 } }));

  for (const clip of [female, male, tenor, mixed]) {
    const seconds = clip.samples.length / clip.sampleRate;
    const stats = signalStats(clip.samples);
    expect(clip.sampleRate).toBe(44100);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(6);
    expect(stats.nonFinite).toBe(0);
    expect(stats.rms).toBeGreaterThan(0.01);
    expect(stats.peak).toBeLessThanOrEqual(1);
    // 조각 시작(0) + 스텝 8번
    expect(clip.progressCount).toBe(9);
  }

  // 같은 시드 → 같은 음성
  expect(again.samples.length).toBe(female.samples.length);
  expect(Buffer.from(again.samples.buffer).equals(Buffer.from(female.samples.buffer))).toBe(true);

  // 여성 음역(F1)과 남성 음역(M3)은 뚜렷이 다르다
  const f0Female = medianF0(female.samples, female.sampleRate);
  const f0Male = medianF0(male.samples, male.sampleRate);
  const f0Tenor = medianF0(tenor.samples, tenor.sampleRate);
  const f0Mixed = medianF0(mixed.samples, mixed.sampleRate);
  console.log(
    `[tts] F0 중앙값: F1 ${f0Female.toFixed(0)}Hz, M3 ${f0Male.toFixed(0)}Hz, M1 ${f0Tenor.toFixed(0)}Hz, F1+M1 반반 ${f0Mixed.toFixed(0)}Hz`,
  );
  expect(f0Female).toBeGreaterThan(150);
  expect(f0Male).toBeLessThan(135);
  expect(f0Female / f0Male).toBeGreaterThan(1.4);
  // F1 과 M1 을 반반 섞으면 둘 사이의 높이가 된다
  expect(f0Mixed).toBeGreaterThan(f0Tenor);
  expect(f0Mixed).toBeLessThan(f0Female);

  expect(pageErrors).toEqual([]);

  // 기기 내 처리: 앱이 놓인 곳에서 모델과 런타임 파일을 받는 것 말고는 어디에도 요청하지 않는다
  const origin = new URL(page.url()).origin;
  const elsewhere = requested.filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith('blob:') && !url.startsWith('data:'));
  expect(elsewhere).toEqual([]);
  expect(requested.some((url) => url.includes('/models/manifest.json'))).toBe(true);
  // 합성하는 동안(로드가 끝난 뒤)에는 새 요청이 없다: 글과 음성은 Worker 밖으로 나가지 않는다
  expect(requested.length).toBe(requestsAfterLoad);
});

test('만드는 중에 취소할 수 있고, 취소한 뒤에도 엔진을 계속 쓸 수 있다', async ({ page }) => {
  await openHarness(page);
  await loadEngine(page);
  const result = await page.evaluate(async (req) => {
    const engine = (window as unknown as { __tts: Harness }).__tts.getTtsEngine();
    const controller = new AbortController();
    const t0 = performance.now();
    let abortedAt = 0;
    let outcome = 'finished';
    try {
      await engine.synthesize(
        { ...req, text: `${req.text} ${req.text} ${req.text}`, steps: 16 },
        {
          signal: controller.signal,
          onProgress: (p) => {
            // 두 번째 스텝이 끝나면 취소한다
            if (p.step === 2 && abortedAt === 0) {
              abortedAt = performance.now();
              controller.abort();
            }
          },
        },
      );
    } catch (err) {
      outcome = (err as Error).name;
    }
    const settledAfterAbortMs = performance.now() - abortedAt;
    // 취소 뒤 바로 다음 요청: Worker 가 멈춘 요청을 정리하고 이것을 처리해야 한다
    const next = await engine.synthesize({ ...req, steps: 5 });
    return {
      outcome,
      settledAfterAbortMs,
      totalMs: performance.now() - t0,
      nextSeconds: next.samples.length / next.sampleRate,
      status: engine.status,
    };
  }, request());
  expect(result.outcome).toBe('AbortError');
  // 화면 쪽은 기다리지 않고 바로 풀려난다
  expect(result.settledAfterAbortMs).toBeLessThan(200);
  expect(result.nextSeconds).toBeGreaterThan(2);
  expect(result.status).toBe('ready');
});

test('브라우저 단일 스레드 속도와 메모리를 잰다(스텝 8 과 5)', async ({ page, browser }, testInfo) => {
  await openHarness(page);
  const loaded = await loadEngine(page);
  const afterLoadMb = await rendererPeakRssMb(browser);

  // 첫 합성은 런타임이 메모리를 잡느라 조금 느리다. 따로 잰다
  const first = await synthesize(page, request({ steps: 8 }));
  const rtf8: number[] = [];
  const rtf5: number[] = [];
  for (let i = 0; i < 3; i++) {
    rtf8.push((await synthesize(page, request({ steps: 8, seed: 100 + i }))).lastSynth?.rtf ?? NaN);
    rtf5.push((await synthesize(page, request({ steps: 5, seed: 200 + i }))).lastSynth?.rtf ?? NaN);
  }
  // 긴 글(여러 조각)도 한 번
  const longText =
    '좋아, 다들 잘 들어. 지금부터 십 분 안에 저 건물 옥상까지 올라간다. 중간에 멈추지 말고, 무슨 일 있으면 바로 말해. ' +
    '왼쪽 계단은 내가 먼저 확인할게. 신호 주면 한 명씩 따라와. 서두르지 않아도 돼, 대신 소리는 내지 마. 준비됐지? 그럼 가자.';
  const long = await synthesize(page, request({ text: longText, steps: 8 }));
  const peakMb = await rendererPeakRssMb(browser);

  const metrics = {
    threads: loaded.info?.threads,
    crossOriginIsolated: loaded.crossOriginIsolated,
    loadMs: Math.round(loaded.info?.loadMs ?? NaN),
    loadWallMs: Math.round(loaded.wallMs),
    sentenceSeconds: Number((first.samples.length / first.sampleRate).toFixed(2)),
    rtfFirstRun8: Number((first.lastSynth?.rtf ?? NaN).toFixed(2)),
    rtf8: Number(median(rtf8).toFixed(2)),
    rtf5: Number(median(rtf5).toFixed(2)),
    rtf8All: rtf8.map((v) => Number(v.toFixed(2))),
    rtf5All: rtf5.map((v) => Number(v.toFixed(2))),
    longSeconds: Number((long.samples.length / long.sampleRate).toFixed(2)),
    rtfLong8: Number((long.lastSynth?.rtf ?? NaN).toFixed(2)),
    rendererPeakRssAfterLoadMb: afterLoadMb,
    rendererPeakRssMb: peakMb,
  };
  console.log(`[tts] 브라우저 측정: ${JSON.stringify(metrics)}`);
  await fs.writeFile(testInfo.outputPath('tts-browser-metrics.json'), JSON.stringify(metrics, null, 2));
  await testInfo.attach('tts-browser-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });

  // 느린 기계에서도 깨지지 않게 넉넉히 잡는다. 실제 수치는 위에 찍힌 값을 본다
  expect(metrics.rtf8).toBeGreaterThan(0);
  expect(metrics.rtf8).toBeLessThan(4);
  expect(metrics.rtf5).toBeLessThan(metrics.rtf8 * 1.05);
  expect(signalStats(long.samples).nonFinite).toBe(0);
});

test('문서만 격리되고 스레드용 Worker 가 막힌 환경에서도 멈추지 않고 불러온다', async ({ page }) => {
  // 문서에는 격리 헤더가 있는데 런타임 스크립트 응답에는 없는 서버를 흉내 낸다.
  // 런타임은 스레드를 기다리다 한도(여기서는 3초)에 걸리고, 엔진은 단일 스레드로 다시 불러와야 한다.
  await openHarness(page, 'isolated-partial');
  await page.evaluate(() => {
    (window as unknown as { __tts: Harness }).__tts.configureTtsEngine({ threadInitTimeoutMs: 3000 });
  });
  const loaded = await loadEngine(page);
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  const serverIsolated = await serverSendsIsolationHeaders(page);

  expect(loaded.crossOriginIsolated).toBe(true);
  expect(loaded.statuses).toEqual(['idle', 'loading', 'ready']);
  // 서버가 헤더를 주지 않으면 단일 스레드로 물러난다. 주면 스레드가 그대로 뜬다
  expect(loaded.info?.threads).toBe(serverIsolated ? Math.min(4, cores) : 1);

  const clip = await synthesize(page, request({ steps: 5 }));
  expect(clip.samples.length / clip.sampleRate).toBeGreaterThan(2);
  expect(signalStats(clip.samples).nonFinite).toBe(0);
});

test('교차 출처 격리 환경(PC 앱 셸)에서는 여러 스레드로 돈다', async ({ page }) => {
  // 스레드용 Worker 스크립트에도 헤더가 있어야 하므로, 서버가 직접 헤더를 보낼 때만 확인할 수 있다.
  // 예) preview.headers 에 COOP/COEP 를 넣은 vite 설정으로 서버를 띄우고 E2E_BASE_URL 로 가리킨다.
  test.skip(!(await serverSendsIsolationHeaders(page)), '서버가 교차 출처 격리 헤더를 보내지 않는다(일반 preview)');
  await openHarness(page, 'isolated');
  const loaded = await loadEngine(page);
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  test.skip(cores < 2, '코어가 하나뿐인 기계에서는 확인할 수 없다');

  expect(loaded.crossOriginIsolated).toBe(true);
  expect(loaded.info?.threads).toBe(Math.min(4, cores));

  const first = await synthesize(page, request());
  const seconds = first.samples.length / first.sampleRate;
  const stats = signalStats(first.samples);
  expect(seconds).toBeGreaterThan(2);
  expect(seconds).toBeLessThan(6);
  expect(stats.nonFinite).toBe(0);
  expect(stats.rms).toBeGreaterThan(0.01);

  const rtf8: number[] = [];
  const rtf5: number[] = [];
  for (let i = 0; i < 3; i++) {
    rtf8.push((await synthesize(page, request({ steps: 8, seed: 100 + i }))).lastSynth?.rtf ?? NaN);
    rtf5.push((await synthesize(page, request({ steps: 5, seed: 200 + i }))).lastSynth?.rtf ?? NaN);
  }
  console.log(
    `[tts] 여러 스레드(${loaded.info?.threads}): 불러오기 ${Math.round(loaded.info?.loadMs ?? NaN)}ms, ` +
      `RTF 스텝 8 ${median(rtf8).toFixed(2)} / 스텝 5 ${median(rtf5).toFixed(2)}`,
  );
});
