// 앱 뼈대 검증: 탭 이동, 요원 선택, 대표 대사 재생(클립), 요원 전환 시트, 단축키, 가로 넘침.
//
// 먼저 빌드해 둘 것:
//   npx vite build --outDir <폴더> --emptyOutDir
//   E2E_PORT=4304 E2E_DIST=<폴더> npx playwright test e2e/shell.spec.ts --trace off
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROSTER, SAMPLE_LINE_ID } from '../src/core/agents/index.ts';
import { clipKey } from '../src/core/clips.ts';
import type { AgentDef, AgentLine } from '../src/core/types.ts';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 800 };
const DESKTOP = { width: 1440, height: 900 };

const FIRST = ROSTER[0];
const SECOND = ROSTER[1];
const FOURTH = ROSTER[3];

function sampleLine(agent: AgentDef): AgentLine {
  const line = agent.lines.find((l) => l.id === SAMPLE_LINE_ID) ?? agent.lines[0];
  if (!line) throw new Error(`${agent.id} 에 대사가 없다`);
  return line;
}

/** 클립이 아직 없을 때 대신 내려 줄 짧은 소리(16비트 모노 WAV). 사람 목소리 높이의 배음 몇 개 */
function toneWav(sec = 0.7, hz = 180, sampleRate = 44100): Buffer {
  const n = Math.round(sec * sampleRate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, t / 0.02, (sec - t) / 0.02);
    const v = (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * hz * 2 * t) + 0.25 * Math.sin(2 * Math.PI * hz * 3 * t)) / 1.75;
    buf.writeInt16LE(Math.round(v * 0.5 * fade * 32767), 44 + i * 2);
  }
  return buf;
}

/**
 * 이 요원의 대표 대사 클립이 빌드에 들어 있으면 그대로 쓰고('real'),
 * 아직 없으면 같은 키의 가짜 클립을 내려 준다('fixture'). 어느 쪽이든 앱은 "색인 → 키 대조 → 파일 → 재생"을 그대로 탄다.
 */
async function ensureSampleClip(page: Page, agent: AgentDef): Promise<'real' | 'fixture'> {
  const line = sampleLine(agent);
  const id = `${agent.id}/${line.id}`;
  const key = clipKey(agent.voice, line);
  const res = await page.request.get('clips/clips.json');
  if (res.ok()) {
    const json = (await res.json().catch(() => null)) as { clips?: Record<string, { key?: string }> } | null;
    if (json?.clips?.[id]?.key === key) return 'real';
  }
  const wav = toneWav();
  await page.route('**/clips/clips.json', (route) =>
    route.fulfill({
      json: { model: 'fixture', clips: { [id]: { key, file: `${id}.mp3`, durationSec: 0.7, bytes: wav.length } } },
    }),
  );
  await page.route(`**/clips/${id}.mp3`, (route) => route.fulfill({ body: wav, contentType: 'audio/wav' }));
  return 'fixture';
}

/**
 * 실제로 스피커 쪽으로 소리가 시작됐는지 세어 보려고 재생 시작을 가로챈다.
 * 효과를 입히는 오프라인 렌더(OfflineAudioContext)는 세지 않는다.
 */
async function watchAudioStarts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __audioStarts: number[] };
    w.__audioStarts = [];
    const original = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: [number?, number?, number?]) {
      if (!(this.context instanceof OfflineAudioContext)) w.__audioStarts.push(this.buffer?.duration ?? 0);
      return original.apply(this, args);
    };
  });
}

const audioStarts = (page: Page): Promise<number[]> =>
  page.evaluate(() => (window as unknown as { __audioStarts: number[] }).__audioStarts);

/** 화면 어디에도 가로 넘침이 없는지 */
async function expectNoSideScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => {
    const main = document.querySelector('.shell__main');
    return {
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  expect(widths.doc).toBeLessThanOrEqual(widths.win);
  expect(widths.main).toBeLessThanOrEqual(0);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('폰 폭 (390×844)', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('아래 탭 다섯 개와 정보 버튼으로 화면을 오간다', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    const tabs = page.getByRole('navigation', { name: '화면 이동' });
    await expect(tabs.getByRole('link')).toHaveCount(5);
    await expect(tabs.getByRole('link', { name: '요원' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('list', { name: '요원 명단' }).getByRole('button')).toHaveCount(ROSTER.length);

    for (const [name, hash] of [
      ['대사', '#lines'],
      ['스튜디오', '#studio'],
      ['체인저', '#changer'],
      ['랩', '#lab'],
      ['요원', '#agents'],
    ] as const) {
      await tabs.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      await expect(tabs.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.shell')).toHaveAttribute('data-route', hash.slice(1));
      await expectNoSideScroll(page);
    }

    await page.getByRole('button', { name: '정보' }).click();
    await expect(page).toHaveURL(/#about$/);
    await expect(page.getByRole('heading', { level: 1, name: '정보' })).toBeVisible();
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0);

    // 뒤로 가기도 화면 전환이다
    await page.goBack();
    await expect(page.locator('.shell')).toHaveAttribute('data-route', 'agents');
    expect(errors).toEqual([]);
  });

  test('카드를 누르면 요원이 바뀌고, 새로 고쳐도 남아 있다', async ({ page }) => {
    await page.goto('./');
    const chip = page.getByRole('button', { name: /^요원 바꾸기/ });
    await expect(chip).toContainText(FIRST.callsign);

    await page.locator(`.agent-card[data-agent="${FOURTH.id}"]`).click();
    const sheet = page.getByRole('dialog', { name: FOURTH.callsign });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(FOURTH.tagline);
    await expect(page.locator('#root')).toHaveAttribute('inert', '');

    // 화면 강조색이 그 요원 색으로 바뀐다
    const accent = await page.evaluate(() => document.documentElement.style.getPropertyValue('--agent'));
    expect(accent.toLowerCase()).toBe(FOURTH.color.toLowerCase());

    await sheet.getByRole('button', { name: '닫기' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
    await expect(chip).toContainText(FOURTH.callsign);
    await expect(page.locator(`.agent-card[data-agent="${FOURTH.id}"]`)).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(page.getByRole('button', { name: /^요원 바꾸기/ })).toContainText(FOURTH.callsign);
  });

  test('상세 시트에서 대표 대사를 클립으로 듣는다 (엔진 없이)', async ({ page }, testInfo) => {
    const errors = collectErrors(page);
    const modelRequests: string[] = [];
    page.on('request', (req) => {
      if (/\/(models|ort)\//.test(req.url())) modelRequests.push(req.url());
    });
    await watchAudioStarts(page);
    const source = await ensureSampleClip(page, SECOND);
    testInfo.annotations.push({ type: '클립', description: source === 'real' ? '빌드에 든 실제 클립' : '테스트용 가짜 클립' });

    await page.goto('./');
    await page.locator(`.agent-card[data-agent="${SECOND.id}"]`).click();
    const sheet = page.getByRole('dialog', { name: SECOND.callsign });
    const clipResponse = page.waitForResponse((r) => r.url().includes(`/clips/${SECOND.id}/`));
    await sheet.getByRole('button', { name: `${SECOND.callsign} 대표 대사 듣기` }).click();
    expect((await clipResponse).ok()).toBe(true);

    const button = sheet.locator('.play-btn');
    await expect(button).toHaveAttribute('data-phase', 'playing');
    await expect(button).toHaveAccessibleName(`${SECOND.callsign} 대표 대사 멈추기`);
    // 끝까지 틀고 나면 스스로 돌아온다
    await expect(button).toHaveAttribute('data-phase', 'idle', { timeout: 20_000 });

    const starts = await audioStarts(page);
    expect(starts).toHaveLength(1);
    expect(starts[0]).toBeGreaterThan(0.3);
    expect(modelRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('위 줄의 요원 전환 시트: 고르면 닫히고, Esc 로도 닫힌다', async ({ page }) => {
    await page.goto('./#about');
    const chip = page.getByRole('button', { name: /^요원 바꾸기/ });
    await chip.click();
    const sheet = page.getByRole('dialog', { name: '요원 바꾸기' });
    await expect(sheet.getByRole('button')).toHaveCount(ROSTER.length + 1);
    await sheet.locator(`.agent-row[data-agent="${SECOND.id}"]`).click();
    await expect(sheet).toBeHidden();
    await expect(chip).toContainText(SECOND.callsign);
    // 요원을 바꿔도 보던 화면은 그대로
    await expect(page.locator('.shell')).toHaveAttribute('data-route', 'about');

    await chip.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('정보 화면에 고지와 수칙이 있다', async ({ page }) => {
    await page.goto('./#about');
    const main = page.getByRole('main');
    await expect(main).toContainText('특정 게임이나 작품, 실제 인물과는 관계가 없어요');
    await expect(main).toContainText('기기 밖으로 나가지 않아요');
    await expect(main).toContainText('실제로 있는 사람인 척하거나, 누군가를 속이는 데 쓰지 말아 주세요');
    await expect(main).toContainText('실시간 음향 효과 (AI 아님)');
    for (const name of ['Supertonic 3', 'OpenRAIL-M', 'ONNX Runtime Web', 'Signalsmith Stretch']) {
      await expect(main).toContainText(name);
    }
    await expect(page.getByRole('table', { name: '키보드 단축키' }).getByRole('row')).toHaveCount(5);
    await expectNoSideScroll(page);
  });
});

for (const size of [LAPTOP, DESKTOP]) {
  test.describe(`PC 폭 (${size.width}×${size.height})`, () => {
    test.use({ viewport: size });

    test('왼쪽 내비게이션과 숫자 키로 화면을 오간다', async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto('./');
      const nav = page.getByRole('navigation', { name: '화면 이동' });
      await expect(nav.getByRole('link')).toHaveCount(6);
      // 넓은 화면에는 아래 탭이 없다
      await expect(page.locator('.tabbar')).toHaveCount(0);

      await nav.getByRole('link', { name: '스튜디오' }).click();
      await expect(page).toHaveURL(/#studio$/);
      await expect(nav.getByRole('link', { name: '스튜디오' })).toHaveAttribute('aria-current', 'page');

      for (const [key, route] of [
        ['2', 'lines'],
        ['4', 'changer'],
        ['5', 'lab'],
        ['3', 'studio'],
        ['1', 'agents'],
      ] as const) {
        await page.keyboard.press(key);
        await expect(page.locator('.shell')).toHaveAttribute('data-route', route);
        await expectNoSideScroll(page);
      }

      await nav.getByRole('link', { name: '정보' }).click();
      await expect(page.getByRole('heading', { level: 1, name: '정보' })).toBeVisible();
      await expectNoSideScroll(page);
      expect(errors).toEqual([]);
    });

    test('카드를 누르면 오른쪽 상세와 왼쪽 패널이 함께 바뀐다', async ({ page }) => {
      await page.goto('./');
      const detail = page.locator('.split__side .detail');
      await expect(detail.getByRole('heading', { level: 2 })).toHaveText(FIRST.callsign);

      await page.locator(`.agent-card[data-agent="${FOURTH.id}"]`).click();
      await expect(detail.getByRole('heading', { level: 2 })).toHaveText(FOURTH.callsign);
      await expect(page.getByRole('region', { name: '지금 요원' })).toContainText(FOURTH.callsign);
      // 넓은 화면에서는 시트가 뜨지 않는다
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // "이 요원으로 말하기"가 창 안에 보인다(스크롤 없이 누를 수 있다)
      await expect(detail.getByRole('button', { name: '이 요원으로 말하기' })).toBeInViewport();
      await detail.getByRole('button', { name: '이 요원으로 말하기' }).click();
      await expect(page.locator('.shell')).toHaveAttribute('data-route', 'studio');
    });

    test('대표 대사를 클립으로 듣고, Space 로 다시 틀고 멈춘다', async ({ page }, testInfo) => {
      const errors = collectErrors(page);
      await watchAudioStarts(page);
      const source = await ensureSampleClip(page, FIRST);
      testInfo.annotations.push({ type: '클립', description: source === 'real' ? '빌드에 든 실제 클립' : '테스트용 가짜 클립' });

      await page.goto('./');
      const button = page.locator('.split__side .detail .play-btn');
      await button.click();
      await expect(button).toHaveAttribute('data-phase', 'playing');
      // 왼쪽 패널의 재생 버튼도 같은 상태를 보여 준다
      await expect(page.locator('.now-agent .play-btn')).toHaveAttribute('data-phase', 'playing');
      await expect(button).toHaveAttribute('data-phase', 'idle', { timeout: 20_000 });

      // 버튼에서 포커스를 뗀 뒤 Space: 마지막으로 튼 소리를 다시 튼다
      await page.getByRole('heading', { level: 1 }).click();
      await page.keyboard.press('Space');
      await expect(button).toHaveAttribute('data-phase', 'playing');
      await page.keyboard.press('Space');
      await expect(button).toHaveAttribute('data-phase', 'idle');

      expect(await audioStarts(page)).toHaveLength(2);
      expect(errors).toEqual([]);
    });

    test('요원 바꾸기 창이 가운데 뜨고 Esc 로 닫힌다', async ({ page }) => {
      await page.goto('./');
      const opener = page.getByRole('button', { name: '요원 바꾸기' });
      await opener.click();
      const sheet = page.getByRole('dialog', { name: '요원 바꾸기' });
      await expect(sheet).toBeVisible();
      // 창이 열려 있는 동안 숫자 키는 화면을 바꾸지 않는다
      await page.keyboard.press('3');
      await expect(page.locator('.shell')).toHaveAttribute('data-route', 'agents');
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(opener).toBeFocused();
    });
  });
}
