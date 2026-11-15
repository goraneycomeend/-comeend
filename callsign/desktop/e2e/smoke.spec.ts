// 콜사인 PC 앱 점검(스모크). 실제 앱 창을 띄워 셸이 약속한 것을 확인한다.
//
// 세 가지 방식으로 돈다. 방식은 환경 변수로 고른다.
//   (기본)                      개발 실행: electron . — 웹앱은 CALLSIGN_WEB_DIR 또는 ../dist
//   CALLSIGN_APP_EXE=<경로>     포장된 폴더의 실행 파일(release/win-unpacked/Callsign.exe 등)이나 설치된 실행 파일
//
// 그 밖의 환경 변수
//   CALLSIGN_SMOKE_REQUIRE_STUDIO=1   스튜디오 화면이 없으면 건너뛰지 않고 실패한다(화면이 들어온 뒤에 켠다)
//   CALLSIGN_SMOKE_EXPECT_MODEL=<id>  실린 모델의 id 가 이것이어야 한다(설치 파일 점검에서는 supertonic-3-fp32)
//
// 실행할 때마다 임시 사용자 데이터 폴더를 따로 쓴다. 사용자의 실제 데이터(%APPDATA%\Callsign)는 건드리지 않는다.
// CI 의 Windows 에는 스피커도 마이크도 없다. 그래서 실제 재생 진행이나 실제 마이크에 기대는 확인은 넣지 않았다.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';

const DESKTOP_DIR = path.resolve(__dirname, '..');
const APP_EXE = process.env.CALLSIGN_APP_EXE ? path.resolve(process.env.CALLSIGN_APP_EXE) : null;
const WEB_DIR = path.resolve(process.env.CALLSIGN_WEB_DIR ?? path.join(DESKTOP_DIR, '..', 'dist'));
/** 스튜디오 화면이 없을 때 엔진 점검을 실패로 볼지. 화면이 들어오면 CI 에서 1 로 켠다 */
const REQUIRE_STUDIO = process.env.CALLSIGN_SMOKE_REQUIRE_STUDIO === '1';
const EXPECT_MODEL = process.env.CALLSIGN_SMOKE_EXPECT_MODEL ?? '';
const EXPECTED_VERSION: string = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8')).version;

const APP_ORIGIN = 'app://callsign';
const ROUTES = ['agents', 'lines', 'studio', 'changer', 'lab', 'about'];
const SENTENCE = '목표 지점 확보. 다음 지시를 기다린다.';

interface Session {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  /** 콘솔 오류, 페이지 예외, 실패한 요청, 4xx·5xx 응답 */
  problems: string[];
  /** 주 프로세스 기록 파일 내용 */
  logText(): string;
  /** 페이지가 알린 콘텐츠 보안 정책 위반 */
  cspViolations(): Promise<string[]>;
}

const sessions: Session[] = [];
const tempDirs: string[] = [];

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `callsign-smoke-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/** 앱을 띄울 실행 파일과 인자 */
function launchTarget(userDataDir: string, extraArgs: string[] = []): { executablePath: string; args: string[] } {
  const args = [`--user-data-dir=${userDataDir}`, ...extraArgs];
  if (APP_EXE) return { executablePath: APP_EXE, args };
  // 개발 실행: desktop/node_modules 의 Electron 으로 이 폴더(package.json 의 main)를 연다
  const electronBinary = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as string;
  return { executablePath: electronBinary, args: [DESKTOP_DIR, ...args] };
}

function launchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value;
  if (!APP_EXE) env.CALLSIGN_WEB_DIR = WEB_DIR;
  // 리눅스의 C 로캘에서는 Chromium 이 한글 파일 이름을 'download' 로 바꿔 저장한다. Windows 와 같게 UTF-8 로 맞춘다
  if (process.platform === 'linux' && !/utf-?8/i.test(env.LC_ALL || env.LANG || '')) {
    env.LANG = 'C.UTF-8';
    delete env.LC_ALL;
  }
  return { ...env, ...extra };
}

async function launch(userDataDir: string, options: { env?: Record<string, string>; args?: string[] } = {}): Promise<Session> {
  const app = await electron.launch({ ...launchTarget(userDataDir, options.args), env: launchEnv(options.env), timeout: 90_000 });
  const page = await app.firstWindow();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? '';
    // 화면이 스스로 취소한 요청은 실패가 아니다
    if (reason !== 'net::ERR_ABORTED') problems.push(`request failed: ${request.method()} ${request.url()} ${reason}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.addInitScript(() => {
    const store = window as unknown as { __cspViolations?: string[] };
    store.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__cspViolations?.push(`${event.violatedDirective} ← ${event.blockedURI}`);
    });
  });
  // 창은 우리가 붙기 전에 이미 떠 있다. 듣는 귀를 단 상태로 처음부터 다시 불러와, 불러오는 동안의 문제를 빠짐없이 잡는다
  await page.reload();
  await page.waitForLoadState('load');
  const session: Session = {
    app,
    page,
    userDataDir,
    problems,
    logText: () => {
      try {
        return fs.readFileSync(path.join(userDataDir, 'logs', 'main.log'), 'utf8');
      } catch {
        return '';
      }
    },
    cspViolations: () => page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? ['(위반 수집기가 없음)']),
  };
  sessions.push(session);
  return session;
}

/** 건너뛴 사실을 놓치지 않게 여러 곳에 크게 남긴다: 테스트 주석, 표준 출력, (GitHub Actions 라면) 경고와 실행 요약 */
function skipLoudly(testInfo: TestInfo, reason: string): never {
  testInfo.annotations.push({ type: '건너뜀', description: reason });
  const bar = '!'.repeat(96);
  console.warn(`\n${bar}\n!! 건너뜀(SKIPPED): ${testInfo.title}\n!! ${reason}\n${bar}\n`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::warning title=콜사인 PC 앱 점검 건너뜀::${testInfo.title} — ${reason}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n> **건너뜀** · ${testInfo.title}\n> ${reason}\n`);
    }
  }
  test.skip(true, reason);
  throw new Error('unreachable');
}

test.afterEach(async ({}, testInfo) => {
  const failed = testInfo.status !== testInfo.expectedStatus;
  for (const [index, session] of sessions.entries()) {
    if (failed) {
      // 실패했으면 화면과 기록을 남긴다(CI 가 test-results 폴더를 올린다)
      await session.page.screenshot({ path: testInfo.outputPath(`window-${index}.png`) }).catch(() => {});
      const log = session.logText();
      if (log) await testInfo.attach(`main-${index}.log`, { body: log, contentType: 'text/plain' });
      if (session.problems.length) {
        await testInfo.attach(`problems-${index}.txt`, { body: session.problems.join('\n'), contentType: 'text/plain' });
      }
    }
    await session.app.close().catch(() => {});
  }
  sessions.length = 0;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test.beforeAll(() => {
  if (APP_EXE) {
    if (!fs.existsSync(APP_EXE)) throw new Error(`CALLSIGN_APP_EXE 가 가리키는 실행 파일이 없어요: ${APP_EXE}`);
    console.log(`점검 대상: 실행 파일 ${APP_EXE}`);
  } else {
    if (!fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
      throw new Error(`웹앱 빌드가 없어요: ${WEB_DIR} — callsign 폴더에서 npm run setup && npm run build 를 먼저 실행하세요.`);
    }
    console.log(`점검 대상: 개발 실행(electron .), 웹앱 ${WEB_DIR}`);
  }
});

test('셸: 창이 뜨고, 격리가 켜지고, 파일을 바르게 내주고, 바깥으로 나가는 길이 막혀 있다', async ({}, testInfo) => {
  const session = await launch(tempDir('shell'));
  const { app, page } = session;

  // ── 창과 화면 ─────────────────────────────────────────────
  await expect(page.locator('#root')).toContainText('콜사인');
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false))
    .toBe(true);
  const windowInfo = await app.evaluate(({ app: electronApp, BrowserWindow, Menu }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      count: windows.length,
      title: windows[0]?.getTitle(),
      version: electronApp.getVersion(),
      packaged: electronApp.isPackaged,
      hasMenu: Menu.getApplicationMenu() !== null,
      userData: electronApp.getPath('userData'),
    };
  });
  expect(windowInfo.count).toBe(1);
  expect(windowInfo.title).toBe('콜사인');
  expect(windowInfo.version).toBe(EXPECTED_VERSION);
  expect(windowInfo.packaged).toBe(APP_EXE !== null);
  expect(windowInfo.hasMenu, '기본 메뉴는 없어야 한다').toBe(false);
  expect(fs.realpathSync(windowInfo.userData), '점검은 임시 데이터 폴더만 쓴다').toBe(fs.realpathSync(session.userDataDir));
  expect(page.url().startsWith(`${APP_ORIGIN}/index.html`)).toBe(true);

  // ── 화면에 넘겨주는 값 ────────────────────────────────────
  const bridge = await page.evaluate(() => {
    const before = (window as unknown as { callsignDesktop?: { version: string; platform: string } }).callsignDesktop;
    try {
      (window as unknown as { callsignDesktop: unknown }).callsignDesktop = { version: 'tampered' };
    } catch {
      // 엄격 모드에서는 던진다. 어느 쪽이든 값이 바뀌지 않으면 된다
    }
    const after = (window as unknown as { callsignDesktop?: { version: string; platform: string } }).callsignDesktop;
    const globals = window as unknown as Record<string, unknown>;
    return {
      value: after ? { version: after.version, platform: after.platform } : null,
      keys: after ? Object.keys(after).sort() : [],
      frozen: after ? Object.isFrozen(after) : false,
      replaced: before !== after,
      nodeLeaked: ['require', 'process', 'module', 'Buffer'].filter((name) => typeof globals[name] !== 'undefined'),
    };
  });
  expect(bridge.value).toEqual({ version: EXPECTED_VERSION, platform: process.platform });
  expect(bridge.keys).toEqual(['platform', 'version']);
  expect(bridge.frozen).toBe(true);
  expect(bridge.replaced).toBe(false);
  expect(bridge.nodeLeaked, '화면에 Node 기능이 새어 나오면 안 된다').toEqual([]);

  // ── 교차 출처 격리: 화면과 Worker ─────────────────────────
  const isolation = await page.evaluate(async () => {
    const shared = new SharedArrayBuffer(8);
    const view = new Int32Array(shared);
    view[0] = 1;
    const source = `onmessage = (e) => { Atomics.add(new Int32Array(e.data), 0, 41); postMessage(self.crossOriginIsolated === true); };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try {
      const workerIsolated = await new Promise<boolean>((resolve, reject) => {
        worker.onmessage = (event) => resolve(event.data === true);
        worker.onerror = (event) => reject(new Error(event.message));
        setTimeout(() => reject(new Error('Worker 가 응답하지 않아요')), 10_000);
        worker.postMessage(shared);
      });
      return { page: crossOriginIsolated, worker: workerIsolated, sharedValue: Atomics.load(view, 0), secure: isSecureContext };
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
  expect(isolation).toEqual({ page: true, worker: true, sharedValue: 42, secure: true });

  // ── 모든 화면을 돌아본다 ──────────────────────────────────
  for (const route of ROUTES) {
    await page.evaluate((hash) => {
      location.hash = `#${hash}`;
    }, route);
    await page.waitForTimeout(400);
    await expect(page.locator('#root')).not.toBeEmpty();
  }
  await page.evaluate(() => {
    location.hash = '#agents';
  });
  await page.waitForTimeout(300);

  // ── 파일 서빙: 모델 조각 전부, wasm 런타임 ─────────────────
  const serving = await page.evaluate(async () => {
    const pick = (response: Response) => ({
      status: response.status,
      type: response.headers.get('content-type'),
      length: Number(response.headers.get('content-length')),
      coop: response.headers.get('cross-origin-opener-policy'),
      coep: response.headers.get('cross-origin-embedder-policy'),
      corp: response.headers.get('cross-origin-resource-policy'),
      nosniff: response.headers.get('x-content-type-options'),
      csp: response.headers.get('content-security-policy'),
    });
    const head = async (url: string) => pick(await fetch(url, { method: 'HEAD' }));
    const manifestResponse = await fetch('models/manifest.json');
    const manifest = (await manifestResponse.json()) as {
      id: string;
      totalBytes: number;
      files: Record<string, { size: number; parts: { path: string; size: number }[] }>;
    };
    const wrong: string[] = [];
    let parts = 0;
    let bytes = 0;
    for (const file of Object.values(manifest.files)) {
      for (const part of file.parts) {
        parts += 1;
        bytes += part.size;
        const got = await head(`models/${part.path}`);
        const ok =
          got.status === 200 &&
          got.length === part.size &&
          got.type === 'application/octet-stream' &&
          got.coep === 'require-corp' &&
          got.corp === 'same-origin';
        if (!ok) wrong.push(`${part.path}: ${JSON.stringify(got)} (기대 크기 ${part.size})`);
      }
    }
    let wasmCompiled = '';
    try {
      await WebAssembly.compileStreaming(fetch('ort/ort-wasm-simd-threaded.wasm'));
      wasmCompiled = 'ok';
    } catch (error) {
      wasmCompiled = String(error);
    }
    const ranged = await fetch('ort/ort-wasm-simd-threaded.wasm', { headers: { Range: 'bytes=0-3' } });
    return {
      manifest: { ...pick(manifestResponse), id: manifest.id, totalBytes: manifest.totalBytes },
      parts,
      bytes,
      wrong,
      document: await head('index.html'),
      wasm: await head('ort/ort-wasm-simd-threaded.wasm'),
      mjs: await head('ort/ort-wasm-simd-threaded.mjs'),
      wasmCompiled,
      range: { status: ranged.status, contentRange: ranged.headers.get('content-range'), magic: [...new Uint8Array(await ranged.arrayBuffer())] },
    };
  });
  console.log(`모델 ${serving.manifest.id}: 조각 ${serving.parts}개, ${serving.bytes.toLocaleString('en-US')} 바이트 — HEAD 전부 확인`);
  expect(serving.manifest.status).toBe(200);
  expect(serving.manifest.type).toBe('application/json; charset=utf-8');
  expect(serving.manifest.id).not.toBe('');
  if (EXPECT_MODEL) expect(serving.manifest.id, '실린 모델').toBe(EXPECT_MODEL);
  expect(serving.parts).toBeGreaterThan(0);
  expect(serving.bytes).toBe(serving.manifest.totalBytes);
  expect(serving.wrong, '모델 조각의 HEAD 응답').toEqual([]);
  const isolationHeaders = { coop: 'same-origin', coep: 'require-corp', corp: 'same-origin', nosniff: 'nosniff' };
  expect(serving.wasm).toMatchObject({ status: 200, type: 'application/wasm', ...isolationHeaders });
  expect(serving.wasm.length).toBeGreaterThan(1_000_000);
  expect(serving.wasmCompiled, 'wasm 스트리밍 컴파일').toBe('ok');
  expect(serving.mjs).toMatchObject({ status: 200, type: 'text/javascript; charset=utf-8', ...isolationHeaders });
  expect(serving.document).toMatchObject({ status: 200, type: 'text/html; charset=utf-8', ...isolationHeaders });
  for (const response of [serving.document, serving.wasm, serving.mjs, serving.manifest]) {
    expect(response.csp).toContain("default-src 'none'");
    expect(response.csp).not.toMatch(/https?:|\*/);
  }
  expect(serving.range).toEqual({ status: 206, contentRange: `bytes 0-3/${serving.wasm.length}`, magic: [0x00, 0x61, 0x73, 0x6d] });

  // ── 여기까지 오류가 하나도 없어야 한다 ─────────────────────
  expect(session.problems, '콘솔 오류·실패한 요청').toEqual([]);
  expect(await session.cspViolations(), '콘텐츠 보안 정책 위반').toEqual([]);

  // ── 막혀 있어야 하는 것들 (아래부터는 콘솔에 차단 오류가 찍히는 것이 정상) ──
  const blocked = await page.evaluate(async () => {
    const outcome = (request: Promise<Response>) =>
      request.then(
        (response) => `status ${response.status}`,
        () => 'rejected',
      );
    const query = async (name: string) => {
      try {
        return (await navigator.permissions.query({ name: name as PermissionName })).state;
      } catch {
        return 'unsupported';
      }
    };
    return {
      post: await outcome(fetch('index.html', { method: 'POST', body: 'x' })),
      missing: await outcome(fetch('no-such-file.txt')),
      folder: await outcome(fetch('models/')),
      backslash: await outcome(fetch('models/..%5c..%5cindex.html')),
      encodedSlash: await outcome(fetch('models/..%2f..%2findex.html')),
      driveLetter: await outcome(fetch('./C:%5cWindows%5cwin.ini')),
      remote: await outcome(fetch('https://example.invalid/')),
      otherHost: await outcome(fetch('app://other/index.html')),
      fileUrl: await outcome(fetch('file:///etc/hosts')),
      // https 가 아니므로 기본 브라우저로 넘기지도 않는다(점검 중에 브라우저가 뜨면 안 된다)
      popup: window.open('http://example.invalid/') === null ? 'blocked' : 'opened',
      geolocation: await new Promise<string>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve('allowed'),
          (error) => resolve(`error ${error.code}`),
          { timeout: 5_000 },
        );
      }),
      notification: await Notification.requestPermission(),
      query: { camera: await query('camera'), geolocation: await query('geolocation'), notifications: await query('notifications') },
    };
  });
  expect(blocked).toEqual({
    post: 'status 405',
    missing: 'status 404',
    folder: 'status 400',
    backslash: 'status 400',
    encodedSlash: 'status 400',
    driveLetter: 'status 400',
    remote: 'rejected',
    otherHost: 'rejected',
    fileUrl: 'rejected',
    popup: 'blocked',
    geolocation: 'error 1',
    notification: 'denied',
    query: { camera: 'denied', geolocation: 'denied', notifications: 'denied' },
  });

  // 세션 단계의 차단: 정책(CSP)을 거치지 않는 주 프로세스의 요청도 나가지 못한다
  const mainFetch = await app.evaluate(({ net }) =>
    net.fetch('https://example.invalid/').then(
      (response: { status: number }) => `status ${response.status}`,
      (error: Error) => error.message,
    ),
  );
  expect(mainFetch).toContain('ERR_BLOCKED_BY_CLIENT');

  // 바깥 주소로 이동
  await page.evaluate(() => {
    location.href = 'https://example.invalid/';
  });
  await page.waitForTimeout(700);
  // (막힌 이동 뒤에는 Playwright 의 locator 가 "이동이 끝나기"를 기다리며 멈춘다. 그래서 화면 안에서 직접 확인한다)
  const afterNavigation = await page.evaluate(() => ({
    href: location.href,
    appStillThere: (document.querySelector('#root')?.textContent ?? '').includes('콜사인'),
  }));
  expect(afterNavigation.href.startsWith(`${APP_ORIGIN}/`), `이동이 막혀야 한다: ${afterNavigation.href}`).toBe(true);
  expect(afterNavigation.appStillThere, '화면이 그대로 남아 있어야 한다').toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  // 주 프로세스가 직접 막았다는 기록
  const log = session.logText();
  expect(log).toContain(`start v${EXPECTED_VERSION}`);
  expect(log).toContain('navigation blocked: https://example.invalid');
  expect(log).toContain('window.open blocked: http://example.invalid');
  expect(log).toContain('request blocked: https://example.invalid');
  expect(log).toContain('permission request denied: geolocation');
  expect(log).toContain('permission request denied: notifications');
  await testInfo.attach('main.log', { body: log, contentType: 'text/plain' });
});

test('권한: 마이크(소리)만 허용하고 카메라·화면 캡처는 거절한다. 출력 장치를 고를 수 있다', async ({}, testInfo) => {
  // CI 에는 마이크도 카메라도 없다. Chromium 의 가짜 장치를 켜야 요청이 권한 판단까지 간다(장치가 없으면 그 전에 NotFoundError)
  const session = await launch(tempDir('permissions'), { args: ['--use-fake-device-for-media-stream'] });
  const { page } = session;

  const result = await page.evaluate(async () => {
    const capture = (constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints).then(
        (stream) => {
          const kinds = stream.getTracks().map((track) => track.kind);
          for (const track of stream.getTracks()) track.stop();
          return `ok ${kinds.join('+')}`;
        },
        (error: Error) => error.name,
      );
    const query = async (name: string) => {
      try {
        return (await navigator.permissions.query({ name: name as PermissionName })).state;
      } catch {
        return 'unsupported';
      }
    };
    const audio = await capture({ audio: true });
    const video = await capture({ video: true });
    const both = await capture({ audio: true, video: true });
    const display = await Promise.race([
      navigator.mediaDevices.getDisplayMedia({ video: true }).then(
        () => 'ok',
        (error: Error) => error.name,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('no answer'), 5_000)),
    ]);

    // "소리 낼 곳" 고르기: 목록을 받고, 기본 장치가 아닌 곳으로 바꿔 본다
    const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
    const target = outputs.find((device) => device.deviceId !== '' && device.deviceId !== 'default' && device.deviceId !== 'communications');
    const context = new AudioContext();
    // 첫 클릭 없이도 소리가 나야 한다: 만들자마자(늦어도 2초 안에) running
    for (let i = 0; i < 20 && context.state !== 'running'; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    const contextState = context.state;
    const sinkCapable = typeof (context as unknown as { setSinkId?: unknown }).setSinkId === 'function';
    let sink = 'no extra output device';
    if (target && sinkCapable) {
      sink = await (context as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(target.deviceId).then(
        () => 'ok',
        (error: Error) => error.name,
      );
    }
    await context.close();

    return {
      audio,
      video,
      both,
      display,
      outputLabels: outputs.map((device) => device.label),
      sinkCapable,
      sink,
      contextState,
      query: { microphone: await query('microphone'), camera: await query('camera'), clipboardRead: await query('clipboard-read'), clipboardWrite: await query('clipboard-write') },
    };
  });
  console.log(`출력 장치: ${JSON.stringify(result.outputLabels)} · setSinkId: ${result.sink} · AudioContext: ${result.contextState}`);

  expect(result.audio, '마이크(소리만)').toBe('ok audio');
  expect(result.video, '카메라').toBe('NotAllowedError');
  expect(result.both, '마이크+카메라').toBe('NotAllowedError');
  expect(result.display, '화면 캡처').toBe('NotAllowedError');
  expect(result.query).toEqual({ microphone: 'granted', camera: 'denied', clipboardRead: 'granted', clipboardWrite: 'granted' });
  expect(result.sinkCapable, 'AudioContext.setSinkId').toBe(true);
  expect(result.outputLabels.length, '출력 장치 목록').toBeGreaterThan(0);
  expect(result.outputLabels.every((label) => label !== ''), '출력 장치 이름이 보여야 한다').toBe(true);
  expect(['ok', 'no extra output device']).toContain(result.sink);
  if (result.sink !== 'ok') testInfo.annotations.push({ type: '참고', description: '기본 장치 말고 다른 출력 장치가 없어 setSinkId 는 확인하지 못함' });
  expect(result.contextState, '첫 클릭 없이도 AudioContext 가 돌아야 한다').toBe('running');

  const log = session.logText();
  expect(log).toContain('permission request denied: media');
  expect(log).toContain('permission request denied: display-capture');
  expect(session.problems).toEqual([]);
});

test('유지: 앱을 껐다 켜도 저장한 값(localStorage)이 남는다', async () => {
  const userDataDir = tempDir('persist');
  const token = `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const first = await launch(userDataDir);
  const origin = await first.page.evaluate((value) => {
    localStorage.setItem('callsign:smoke-persist', value);
    return location.origin;
  }, token);
  expect(origin).toBe(APP_ORIGIN);
  await first.app.close();
  sessions.splice(sessions.indexOf(first), 1);

  const second = await launch(userDataDir);
  const restored = await second.page.evaluate(() => ({
    value: localStorage.getItem('callsign:smoke-persist'),
    origin: location.origin,
  }));
  expect(restored).toEqual({ value: token, origin: APP_ORIGIN });

  // 창 자리도 기억한다
  expect(fs.existsSync(path.join(userDataDir, 'window-state.json'))).toBe(true);
});

test('한 번만 실행: 이미 떠 있으면 두 번째 실행은 바로 끝나고 창은 하나뿐이다', async () => {
  const userDataDir = tempDir('single');
  const session = await launch(userDataDir);

  const target = launchTarget(userDataDir);
  // 리눅스 컨테이너의 root 에서는 이 옵션 없이는 뜨지 않는다(Playwright 는 스스로 붙인다)
  const args = process.platform === 'linux' ? ['--no-sandbox', ...target.args] : target.args;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(target.executablePath, args, { env: launchEnv(), stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('두 번째 실행이 30초 안에 끝나지 않았어요(창을 또 띄운 것 같아요)'));
    }, 30_000);
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(exitCode).toBe(0);
  await expect.poll(() => session.logText()).toContain('second launch');
  expect(await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
});

test('저장: <a download> 로 내려받은 파일이 지정한 폴더에 한글 이름 그대로 저장된다', async () => {
  const saveDir = tempDir('save');
  const session = await launch(tempDir('download'), { env: { CALLSIGN_E2E_SAVE_DIR: saveDir } });
  const fileName = '콜사인_점검_목표-지점-확보.wav';
  const bytes = [0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];

  await session.page.evaluate(
    ({ name, data }) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'audio/wav' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    { name: fileName, data: bytes },
  );

  // 저장 폴더에는 그 이름, 그 크기의 파일 하나만 생겨야 한다
  const listing = () =>
    fs
      .readdirSync(saveDir)
      .map((name) => `${name} (${fs.statSync(path.join(saveDir, name)).size} bytes)`)
      .join(', ');
  await expect.poll(listing).toBe(`${fileName} (${bytes.length} bytes)`);
  expect([...fs.readFileSync(path.join(saveDir, fileName))]).toEqual(bytes);
  await expect.poll(() => session.logText()).toContain(`save completed: wav, ${bytes.length} bytes`);
  // 기록에 파일 이름(사용자가 쓴 글이 들어갈 수 있다)은 남기지 않는다
  expect(session.logText()).not.toContain('목표');
  expect(session.problems).toEqual([]);
});

test('엔진: 스튜디오 화면에서 AI 음성 엔진을 불러와 한국어 문장을 합성한다', async ({}, testInfo) => {
  test.setTimeout(480_000);
  const session = await launch(tempDir('engine'));
  const { page } = session;

  await page.evaluate(() => {
    location.hash = '#studio';
  });
  const textBox = page.getByTestId('studio-text');
  const studioReady = await textBox.waitFor({ state: 'visible', timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!studioReady) {
    const reason = '이 빌드에는 스튜디오 화면(data-testid="studio-text")이 없어서 엔진 점검을 하지 못했습니다.';
    if (REQUIRE_STUDIO) throw new Error(`${reason} CALLSIGN_SMOKE_REQUIRE_STUDIO=1 이므로 실패로 처리합니다.`);
    skipLoudly(testInfo, `${reason} 화면이 들어오면 CALLSIGN_SMOKE_REQUIRE_STUDIO=1 로 돌려 건너뛰지 못하게 하세요.`);
  }

  // 엔진 불러오기(이미 준비돼 있으면 그대로)
  const engineStatus = () => page.evaluate(() => document.documentElement.dataset.engineStatus ?? '');
  if ((await engineStatus()) !== 'ready') {
    const loadButton = page.getByTestId('engine-load').first();
    if (await loadButton.isVisible()) await loadButton.click();
  }
  await page.waitForFunction(() => ['ready', 'failed'].includes(document.documentElement.dataset.engineStatus ?? ''), null, { timeout: 180_000 });
  expect(await engineStatus(), '엔진 상태').toBe('ready');

  // 한국어 문장을 말하게 한다
  await textBox.fill(SENTENCE);
  await page.getByTestId('studio-speak').click();
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid="studio-result"]')?.getAttribute('data-duration-sec') ?? 0) > 1,
    null,
    { timeout: 240_000 },
  );

  const report = await page.evaluate(async () => {
    const data = document.documentElement.dataset;
    const manifest = (await (await fetch('models/manifest.json')).json()) as { id: string };
    return {
      threads: Number(data.engineThreads),
      model: data.engineModel ?? '',
      loadMs: Number(data.engineLoadMs),
      isolated: data.isolated ?? '',
      desktop: data.desktop ?? '',
      rtf: Number(data.lastRtf),
      steps: Number(data.lastSteps),
      durationSec: Number(document.querySelector('[data-testid="studio-result"]')?.getAttribute('data-duration-sec')),
      cores: navigator.hardwareConcurrency,
      manifestId: manifest.id,
    };
  });
  const summary =
    `엔진 ${report.model} · 스레드 ${report.threads}(논리 코어 ${report.cores}) · 불러오기 ${report.loadMs} ms · ` +
    `음성 ${report.durationSec} 초 · RTF ${report.rtf} (스텝 ${report.steps})`;
  console.log(summary);
  testInfo.annotations.push({ type: '엔진', description: summary });
  await testInfo.attach('engine.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n- ${summary}\n`);

  expect(report.isolated, 'data-isolated').toBe('true');
  expect(report.desktop, 'data-desktop').toBe('true');
  expect(report.model, 'data-engine-model 은 실린 모델의 id').toBe(report.manifestId);
  if (EXPECT_MODEL) expect(report.model).toBe(EXPECT_MODEL);
  expect(report.durationSec).toBeGreaterThan(1);
  expect(report.durationSec).toBeLessThan(20);
  expect(report.loadMs).toBeGreaterThan(0);
  expect(report.rtf).toBeGreaterThan(0);
  // 논리 코어가 4개 이상인 PC 에서는 여러 스레드로 돌아야 한다(교차 출처 격리가 실제로 먹혔다는 증거)
  if (report.cores >= 4) expect(report.threads, 'data-engine-threads').toBeGreaterThan(1);
  else expect(report.threads).toBeGreaterThanOrEqual(1);

  expect(session.problems, '콘솔 오류·실패한 요청').toEqual([]);
  expect(await session.cspViolations(), '콘텐츠 보안 정책 위반').toEqual([]);
});
