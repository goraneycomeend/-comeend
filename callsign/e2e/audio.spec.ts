import { expect, test } from '@playwright/test';
import { type HarnessFiles, buildHarness, fixturePath, openHarness } from './fixtures/harnessServer.ts';

// 음향 모듈(src/core/audio, src/engine/{player,micChanger,audioContext})을 실제 브라우저에서 검증한다.
// 앱 화면은 거치지 않는다. 테스트용 진입점(e2e/fixtures/audioHarness.ts)을 앱과 같은 설정으로 묶어 올리고
// window.__dsp 로 모듈을 직접 부른다. 귀로 들을 수 없으니 전부 숫자(F0, 대역 레벨, 상관, 피크)로 확인한다.

test.use({
  launchOptions: {
    args: [
      '--autoplay-policy=no-user-gesture-required',
      // 가짜 마이크: 실제 합성 음성(낮은 목소리) 파일을 되풀이해서 들려준다
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${fixturePath('voice-m.wav')}`,
    ],
  },
  permissions: ['microphone'],
});

let files: HarnessFiles;

test.beforeAll(async () => {
  files = await buildHarness();
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await openHarness(page, files);
  expect(errors).toEqual([]);
});

test.describe('오프라인 렌더 (renderVoice)', () => {
  test('효과가 전부 0 이면 입력과 똑같다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, loadFixture } = window.__dsp;
      const voice = A.finishSpeech(await loadFixture('voice-f.wav'));
      const out = await A.renderVoice(voice, A.NEUTRAL_FX);
      const almost = await A.renderVoice(voice, { ...A.NEUTRAL_FX, room: 0.0004, pitch: 0.0005 });
      let maxDiff = 0;
      for (let i = 0; i < voice.samples.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out.samples[i] - voice.samples[i]));
      return {
        sameLength: out.samples.length === voice.samples.length,
        isCopy: out.samples !== voice.samples,
        corr: A.correlation(voice.samples, out.samples),
        maxDiff,
        corrAlmost: A.correlation(voice.samples, almost.samples),
      };
    });
    expect(r.sameLength).toBe(true);
    expect(r.isCopy).toBe(true);
    expect(r.corr).toBeGreaterThan(0.999);
    expect(r.maxDiff).toBe(0);
    expect(r.corrAlmost).toBeGreaterThan(0.999);
  });

  test('pitch +4 반음이면 F0 가 약 1.26배(±4%), 길이와 시작 시점은 그대로', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { audio: A, loadFixture, tone } = window.__dsp;
      const inputs = {
        high: A.finishSpeech(await loadFixture('voice-f.wav')),
        low: A.finishSpeech(await loadFixture('voice-m.wav')),
        saw: tone('saw', 150, 1.5, 0.3),
      };
      const envelope = (x: Float32Array): Float32Array => {
        const hop = 441;
        const e = new Float32Array(Math.floor(x.length / hop));
        for (let i = 0; i < e.length; i++) {
          let s = 0;
          for (let k = 0; k < hop; k++) s += x[i * hop + k] ** 2;
          e[i] = Math.sqrt(s / hop);
        }
        return e;
      };
      const out = [];
      for (const [name, input] of Object.entries(inputs)) {
        const f0 = A.estimateF0(input);
        for (const [pitch, formant] of [[4, 0], [-3, 0], [1.5, 1], [0, 2]]) {
          const y = await A.renderVoice(input, { ...A.NEUTRAL_FX, pitch, formant });
          const lag = A.bestLag(envelope(input.samples), envelope(y.samples), 20);
          let finite = true;
          for (const v of y.samples) if (!Number.isFinite(v)) finite = false;
          out.push({
            name,
            pitch,
            formant,
            ratio: A.estimateF0(y) / f0,
            lengthDiff: y.samples.length - input.samples.length,
            lagMs: lag.lag * 10,
            levelDb: 20 * Math.log10(A.activeRms(y) / A.activeRms(input)),
            peak: A.peak(y),
            finite,
          });
        }
      }
      return out;
    });
    for (const r of rows) {
      const expected = Math.pow(2, r.pitch / 12);
      expect(r.ratio, `${r.name} pitch ${r.pitch} formant ${r.formant}`).toBeGreaterThan(expected * 0.96);
      expect(r.ratio, `${r.name} pitch ${r.pitch} formant ${r.formant}`).toBeLessThan(expected * 1.04);
      expect(r.lengthDiff).toBe(0);
      // 시작 시점: 크기 변화가 있는 음성에서만 잴 수 있다(톱니파는 내내 같은 크기)
      if (r.name !== 'saw') expect(Math.abs(r.lagMs), r.name).toBeLessThanOrEqual(10);
      // 음량 보정: 옮긴 뒤에도 크기가 거의 같다
      expect(Math.abs(r.levelDb)).toBeLessThan(1.5);
      expect(r.peak).toBeLessThanOrEqual(0.8915);
      expect(r.finite).toBe(true);
    }
  });

  test('피치가 걸린 렌더를 150번 이어서 해도 멈추지 않는다', async ({ page }) => {
    // OfflineAudioContext + 워크릿 방식은 125번째쯤에서 멈췄다. 처리기를 직접 돌리는 지금 방식의 회귀 방지용
    const r = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const input = tone('saw', 140, 0.4, 0.3);
      const started = performance.now();
      let last = 0;
      for (let i = 0; i < 150; i++) {
        const y = await A.renderVoice(input, { ...A.NEUTRAL_FX, pitch: 1.5, room: i % 2 ? 0.2 : 0 });
        last = A.rms(y);
      }
      return { ms: performance.now() - started, last };
    });
    expect(r.last).toBeGreaterThan(0.05);
    expect(r.ms).toBeLessThan(60_000);
  });

  test('음색 효과(온기·또렷함·공기감)는 자기 대역만 움직인다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const input = tone('noise', 0, 2, 0.1);
      const bands = { low: [60, 200], mid: [500, 1500], presence: [2600, 3500], air: [10000, 16000] } as const;
      const delta = async (fx: Partial<typeof A.NEUTRAL_FX>): Promise<Record<string, number>> => {
        const y = await A.renderVoice(input, { ...A.NEUTRAL_FX, ...fx });
        const d: Record<string, number> = {};
        for (const [k, [lo, hi]] of Object.entries(bands)) d[k] = A.bandLevelDb(y, lo, hi) - A.bandLevelDb(input, lo, hi);
        return d;
      };
      return {
        warmUp: await delta({ warmth: 1 }),
        warmDown: await delta({ warmth: -1 }),
        presenceUp: await delta({ presence: 1 }),
        airUp: await delta({ air: 1 }),
        airDown: await delta({ air: -1 }),
        subtle: await delta({ warmth: 0.25, presence: 0.25, air: 0.25 }),
      };
    });
    expect(r.warmUp.low).toBeGreaterThan(3.5);
    expect(r.warmUp.low).toBeLessThan(5.5);
    expect(Math.abs(r.warmUp.presence)).toBeLessThan(0.5);
    expect(r.warmDown.low).toBeLessThan(-3.5);
    expect(r.presenceUp.presence).toBeGreaterThan(3.5);
    expect(r.presenceUp.presence).toBeLessThan(5.5);
    expect(Math.abs(r.presenceUp.low)).toBeLessThan(0.5);
    expect(r.airUp.air).toBeGreaterThan(4.5);
    expect(r.airUp.air).toBeLessThan(6.5);
    expect(Math.abs(r.airUp.mid)).toBeLessThan(0.5);
    expect(r.airDown.air).toBeLessThan(-4.5);
    // 0.25 는 '티 나지 않는' 범위: 어느 대역도 2dB 넘게 움직이지 않는다
    for (const v of Object.values(r.subtle)) expect(Math.abs(v)).toBeLessThan(2);
  });

  test('단단함(컴프레서)은 큰 소리와 작은 소리의 차이를 줄이고 전체 음량은 유지한다', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { audio: A, loadFixture } = window.__dsp;
      const out = [];
      for (const name of ['voice-f.wav', 'voice-m.wav']) {
        const voice = A.finishSpeech(await loadFixture(name));
        const crest = (a: typeof voice): number => 20 * Math.log10(A.peak(a) / A.activeRms(a));
        for (const punch of [0.25, 1]) {
          const y = await A.renderVoice(voice, { ...A.NEUTRAL_FX, punch });
          out.push({ name, punch, crestChange: crest(y) - crest(voice), levelDb: 20 * Math.log10(A.activeRms(y) / A.activeRms(voice)), peak: A.peak(y) });
        }
      }
      return out;
    });
    for (const r of rows) {
      expect(r.crestChange, `${r.name} punch ${r.punch}`).toBeLessThan(r.punch === 1 ? -2 : -1);
      expect(Math.abs(r.levelDb), `${r.name} punch ${r.punch}`).toBeLessThan(2);
      expect(r.peak).toBeLessThanOrEqual(0.8915);
    }
  });

  test('방 울림: 작은 값은 원음과 거의 같고, 큰 값은 꼬리가 길어진다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, loadFixture, tone } = window.__dsp;
      const voice = A.finishSpeech(await loadFixture('voice-f.wav'));
      const measure = async (room: number) => {
        const y = await A.renderVoice(voice, { ...A.NEUTRAL_FX, room });
        return {
          addedSec: (y.samples.length - voice.samples.length) / voice.sampleRate,
          corr: A.correlation(voice.samples, y.samples),
          levelDb: 20 * Math.log10(A.activeRms(y) / A.activeRms(voice)),
        };
      };
      // 짧은 소리 하나를 넣고 그 뒤에 남는 울림을 본다
      const burst = tone('noise', 0, 0.05, 0.5);
      const padded = { samples: new Float32Array(44100), sampleRate: 44100 };
      padded.samples.set(burst.samples, 0);
      const tailLevel = async (room: number, from: number, to: number): Promise<number> => {
        const y = await A.renderVoice(padded, { ...A.NEUTRAL_FX, room });
        return 20 * Math.log10(A.rms(y.samples.subarray(Math.round(from * 44100), Math.round(to * 44100))) + 1e-9);
      };
      return {
        small: await measure(0.25),
        tiny: await measure(0.1),
        big: await measure(1),
        dryAfterBurst: await tailLevel(0, 0.1, 0.2),
        smallEarly: await tailLevel(0.25, 0.06, 0.16),
        smallLate: await tailLevel(0.25, 0.4, 0.5),
        bigLate: await tailLevel(1, 0.4, 0.5),
      };
    });
    // 0.25 이하: '녹음실 건조함만 지우는' 수준
    expect(r.small.corr).toBeGreaterThan(0.98);
    expect(r.tiny.corr).toBeGreaterThan(0.99);
    expect(Math.abs(r.small.levelDb)).toBeLessThan(0.7);
    expect(r.small.addedSec).toBeLessThan(0.4);
    // 1.0: 뚜렷한 울림
    expect(r.big.corr).toBeLessThan(0.93);
    expect(r.big.addedSec).toBeGreaterThan(0.35);
    // 울림은 소리가 끝난 뒤에 남고(원음에는 없다), 작은 방은 0.4초면 사라진다
    expect(r.dryAfterBurst).toBeLessThan(-150);
    expect(r.smallEarly).toBeGreaterThan(-60);
    expect(r.smallLate).toBeLessThan(-75);
    expect(r.bigLate).toBeGreaterThan(r.smallLate + 20);
  });

  test('무전기: 300~3400Hz 밖을 깎고, 말이 없을 때 아주 약한 잡음이 깔린다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, loadFixture, tone } = window.__dsp;
      // 대역 모양은 고른 잡음으로 잰다
      const hiss = tone('noise', 0, 2, 0.1);
      const shaped = await A.renderVoice(hiss, { ...A.NEUTRAL_FX, radio: 1 });
      const half = await A.renderVoice(hiss, { ...A.NEUTRAL_FX, radio: 0.5 });
      const d = (y: typeof hiss, lo: number, hi: number): number => A.bandLevelDb(y, lo, hi) - A.bandLevelDb(hiss, lo, hi);
      const shape = {
        low: d(shaped, 40, 120) - d(shaped, 800, 2500),
        edgeLow: d(shaped, 280, 320) - d(shaped, 800, 2500),
        edgeHigh: d(shaped, 3300, 3500) - d(shaped, 800, 2500),
        high: d(shaped, 8000, 16000) - d(shaped, 800, 2500),
        halfLow: d(half, 40, 120) - d(half, 800, 2500),
        halfHigh: d(half, 8000, 16000) - d(half, 800, 2500),
      };
      // 음량과 피크는 실제 음성으로
      const rows = [];
      for (const name of ['voice-f.wav', 'voice-m.wav']) {
        const voice = A.finishSpeech(await loadFixture(name));
        const y = await A.renderVoice(voice, { ...A.NEUTRAL_FX, radio: 1 });
        rows.push({ name, high: A.bandLevelDb(y, 8000, 16000) - A.bandLevelDb(voice, 8000, 16000), levelDb: 20 * Math.log10(A.activeRms(y) / A.activeRms(voice)), peak: A.peak(y) });
      }
      const quiet = { samples: new Float32Array(44100), sampleRate: 44100 };
      const noiseFull = await A.renderVoice(quiet, { ...A.NEUTRAL_FX, radio: 1 });
      const noiseHalf = await A.renderVoice(quiet, { ...A.NEUTRAL_FX, radio: 0.5 });
      return { shape, rows, noiseFullDb: 20 * Math.log10(A.rms(noiseFull)), noiseHalfDb: 20 * Math.log10(A.rms(noiseHalf)) };
    });
    // 통과 대역 밖은 30dB 넘게 내려가고, 경계(300Hz, 3400Hz)는 살짝만 내려간다
    expect(r.shape.low).toBeLessThan(-30);
    expect(r.shape.high).toBeLessThan(-30);
    expect(r.shape.edgeLow).toBeGreaterThan(-9);
    expect(r.shape.edgeHigh).toBeGreaterThan(-9);
    // 절반이면 덜 깎는다
    expect(r.shape.halfLow).toBeGreaterThan(r.shape.low + 10);
    expect(r.shape.halfHigh).toBeGreaterThan(r.shape.high + 10);
    for (const row of r.rows) {
      expect(row.high, row.name).toBeLessThan(-25);
      // 대역을 깎아도 들리는 크기는 비슷하게 유지된다
      expect(Math.abs(row.levelDb), row.name).toBeLessThan(2);
      expect(row.peak).toBeLessThanOrEqual(0.8915);
    }
    expect(r.noiseFullDb).toBeGreaterThan(-58);
    expect(r.noiseFullDb).toBeLessThan(-44);
    expect(r.noiseHalfDb).toBeLessThan(r.noiseFullDb - 10);
  });

  test('메아리: 정해진 시간 뒤에 작아진 소리가 되돌아오고 길이가 늘어난다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const burst = tone('sine', 500, 0.15, 0.5);
      const y = await A.renderVoice(burst, { ...A.NEUTRAL_FX, echo: 0.6 });
      const sr = y.sampleRate;
      const level = (from: number, to: number): number =>
        20 * Math.log10(A.rms(y.samples.subarray(Math.round(from * sr), Math.round(to * sr))) + 1e-9);
      // echo 0.6 → 지연 0.28초
      const subtle = await A.renderVoice(burst, { ...A.NEUTRAL_FX, echo: 0.1 });
      const subtleFirst = 20 * Math.log10(A.rms(subtle.samples.subarray(Math.round(0.25 * sr), Math.round(0.38 * sr))) + 1e-9);
      return {
        addedSec: (y.samples.length - burst.samples.length) / sr,
        direct: level(0.02, 0.13),
        gap: level(0.18, 0.26),
        first: level(0.3, 0.41),
        second: level(0.58, 0.69),
        subtleFirst,
        peak: A.peak(y),
      };
    });
    expect(r.addedSec).toBeGreaterThan(0.8);
    expect(r.gap).toBeLessThan(r.direct - 40);
    expect(r.first).toBeGreaterThan(r.direct - 16);
    expect(r.first).toBeLessThan(r.direct - 6);
    expect(r.second).toBeLessThan(r.first - 4);
    expect(r.second).toBeGreaterThan(r.first - 14);
    // 0.1 은 거의 들리지 않는 수준(-25dB 아래)
    expect(r.subtleFirst).toBeLessThan(r.direct - 25);
    expect(r.peak).toBeLessThanOrEqual(0.8915);
  });

  test('겹침: 약 21ms 와 34ms 뒤에 같은 소리가 한 번씩 더 난다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A } = window.__dsp;
      const sr = 44100;
      const click = { samples: new Float32Array(sr / 2), sampleRate: sr };
      const at = Math.round(0.1 * sr);
      for (let i = 0; i < 40; i++) click.samples[at + i] = 0.5 * Math.sin((Math.PI * i) / 40);
      const y = await A.renderVoice(click, { ...A.NEUTRAL_FX, doubler: 0.8 });
      const energy = (fromMs: number, toMs: number): number => {
        let s = 0;
        for (let i = at + Math.round((fromMs / 1000) * sr); i < at + Math.round((toMs / 1000) * sr); i++) s += y.samples[i] ** 2;
        return s;
      };
      return { direct: energy(0, 2), quietBefore: energy(6, 16), first: energy(18, 25), second: energy(30, 39), after: energy(45, 80) };
    });
    expect(r.first).toBeGreaterThan(r.direct * 0.02);
    expect(r.second).toBeGreaterThan(r.direct * 0.02);
    expect(r.quietBefore).toBeLessThan(r.first * 0.05);
    expect(r.after).toBeLessThan(r.first * 0.05);
  });

  test('기계음: 원래 음은 사라지고 ±72Hz 옆에 두 음이 생긴다(링 변조)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const input = tone('sine', 440, 1.5, 0.3);
      const y = await A.renderVoice(input, { ...A.NEUTRAL_FX, robot: 1 });
      const half = await A.renderVoice(input, { ...A.NEUTRAL_FX, robot: 0.5 });
      const at = (a: typeof y, hz: number): number => A.bandLevelDb(a, hz - 8, hz + 8, 8192);
      return {
        inputCarrier: at(input, 440),
        carrier: at(y, 440),
        lower: at(y, 368),
        upper: at(y, 512),
        halfCarrier: at(half, 440),
        halfLower: at(half, 368),
      };
    });
    expect(r.carrier).toBeLessThan(r.inputCarrier - 30);
    expect(Math.abs(r.lower - (r.inputCarrier - 3))).toBeLessThan(1.5);
    expect(Math.abs(r.upper - (r.inputCarrier - 3))).toBeLessThan(1.5);
    // 절반이면 원래 음과 옆 음이 섞여 있다
    expect(r.halfCarrier).toBeGreaterThan(r.inputCarrier - 8);
    expect(r.halfLower).toBeGreaterThan(r.inputCarrier - 14);
  });

  test('음량: ±6dB 가 정확히 두 배·절반', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const input = tone('sine', 300, 0.5, 0.05);
      const up = await A.renderVoice(input, { ...A.NEUTRAL_FX, gainDb: 6 });
      const down = await A.renderVoice(input, { ...A.NEUTRAL_FX, gainDb: -6 });
      return { up: A.rms(up) / A.rms(input), down: A.rms(down) / A.rms(input), sameLength: up.samples.length === input.samples.length };
    });
    expect(r.up).toBeCloseTo(1.995, 2);
    expect(r.down).toBeCloseTo(0.501, 2);
    expect(r.sameLength).toBe(true);
  });

  test('어떤 설정에서도 피크는 1.0 을 넘지 않는다(안전 리미터)', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { audio: A, loadFixture, tone } = window.__dsp;
      const loud = tone('noise', 0, 1, 0.95);
      const voice = A.finishSpeech(await loadFixture('voice-m.wav'));
      const extremes = [
        { gainDb: 12 },
        { warmth: 1, presence: 1, air: 1, punch: 1, gainDb: 12 },
        { radio: 1, echo: 1, room: 1, robot: 0.5, doubler: 1, gainDb: 12 },
        { pitch: 12, formant: 6, punch: 1, gainDb: 12 },
        { pitch: -12, formant: -6, doubler: 1, echo: 1, gainDb: 12 },
      ];
      const out = [];
      for (const [label, input] of [['noise', loud], ['voice', voice]] as const) {
        for (const fx of extremes) {
          const y = await A.renderVoice(input, { ...A.NEUTRAL_FX, ...fx });
          let finite = true;
          for (const v of y.samples) if (!Number.isFinite(v)) finite = false;
          out.push({ label, fx: JSON.stringify(fx), peak: A.peak(y), finite, rms: A.rms(y) });
        }
      }
      return out;
    });
    for (const r of rows) {
      expect(r.finite, `${r.label} ${r.fx}`).toBe(true);
      expect(r.peak, `${r.label} ${r.fx}`).toBeLessThanOrEqual(0.8915);
      expect(r.rms, `${r.label} ${r.fx}`).toBeGreaterThan(0.01);
    }
  });

  test('실제 합성 음성 + 로스터 수준의 약한 효과: 클리핑·NaN 없이 원음에 가깝다', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { audio: A, loadFixture } = window.__dsp;
      const settings = {
        warm: { warmth: 0.2, presence: 0.15, air: 0.1, punch: 0.2, room: 0.15 },
        bright: { warmth: -0.2, presence: 0.25, air: 0.2, punch: 0.3, room: 0.25, echo: 0.05 },
        edge: { warmth: 0.5, presence: 0.5, air: 0.5, punch: 0.5, room: 0.25, echo: 0.1, gainDb: 1 },
        pitched: { pitch: 1.5, formant: 1, warmth: 0.2, punch: 0.2, room: 0.15 },
        lowered: { pitch: -1.5, formant: -1, presence: 0.2, room: 0.2 },
      };
      const out = [];
      for (const name of ['voice-f.wav', 'voice-m.wav']) {
        const voice = A.finishSpeech(await loadFixture(name));
        const f0 = A.estimateF0(voice);
        for (const [label, fx] of Object.entries(settings)) {
          const full = { ...A.NEUTRAL_FX, ...fx };
          const y = await A.renderVoice(voice, full);
          let finite = true;
          let stuck = 0;
          let longestStuck = 0;
          for (const v of y.samples) {
            if (!Number.isFinite(v)) finite = false;
            stuck = Math.abs(v) > 0.89 ? stuck + 1 : 0;
            longestStuck = Math.max(longestStuck, stuck);
          }
          out.push({
            name,
            label,
            natural: A.isNaturalFx(full),
            finite,
            longestStuck,
            peak: A.peak(y),
            levelDb: 20 * Math.log10(A.activeRms(y) / A.activeRms(voice)),
            addedSec: (y.samples.length - voice.samples.length) / voice.sampleRate,
            f0Ratio: A.estimateF0(y) / f0,
            pitch: full.pitch,
            // 컴프레서는 6ms 쯤 늦게 내보낸다. 그만큼 밀어서 비교한다
            corr: A.bestLag(voice.samples, y.samples, 400),
          });
        }
      }
      return out;
    });
    for (const r of rows) {
      const tag = `${r.name} ${r.label}`;
      expect(r.natural, tag).toBe(true);
      expect(r.finite, tag).toBe(true);
      expect(r.peak, tag).toBeLessThanOrEqual(0.8915);
      // 한계값에 붙은 샘플이 이어지지 않는다 = 잘린 파형이 아니다
      expect(r.longestStuck, tag).toBeLessThan(8);
      expect(Math.abs(r.levelDb), tag).toBeLessThan(3);
      expect(r.addedSec, tag).toBeGreaterThanOrEqual(0);
      expect(r.addedSec, tag).toBeLessThan(1.2);
      const expected = Math.pow(2, r.pitch / 12);
      expect(Math.abs(r.f0Ratio / expected - 1), tag).toBeLessThan(0.04);
      if (r.pitch === 0) {
        expect(r.corr.corr, tag).toBeGreaterThan(0.9);
        // 지연은 10ms 를 넘지 않는다
        expect(r.corr.lag, tag).toBeGreaterThanOrEqual(0);
        expect(r.corr.lag, tag).toBeLessThan(441);
      }
    }
  });
});

test.describe('실시간 체인', () => {
  test('같은 그래프 빌더가 리미터 노드까지 포함해 돈다: 작은 소리는 그대로, 큰 소리는 1.0 아래', async ({ page }) => {
    const rows = await page.evaluate(async () => {
      const { audio: A, tone } = window.__dsp;
      const through = async (amp: number, fx: Partial<typeof A.NEUTRAL_FX>) => {
        const x = tone('sine', 220, 1, amp);
        const ctx = new OfflineAudioContext(1, x.samples.length, 44100);
        const graph = A.buildFxGraph(ctx, { ...A.NEUTRAL_FX, ...fx }, { safety: 'node' });
        const buffer = ctx.createBuffer(1, x.samples.length, 44100);
        buffer.getChannelData(0).set(x.samples);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(graph.input);
        graph.output.connect(ctx.destination);
        src.start();
        const y = (await ctx.startRendering()).getChannelData(0);
        const settledIn = x.samples.subarray(22050);
        const settledOut = y.subarray(22050);
        return { amp, fx: JSON.stringify(fx), gainDb: 20 * Math.log10(A.rms(settledOut) / A.rms(settledIn)), peak: A.peak(y), latency: graph.latencySec, corr: A.correlation(x.samples, y) };
      };
      return [
        await through(0.3, {}), // 중립: 아무것도 거치지 않는다
        await through(0.05, { gainDb: 0.01 }), // 리미터만 거친다
        await through(0.6, { gainDb: 0.01 }),
        await through(1.0, { gainDb: 0.01 }),
        await through(1.0, { gainDb: 12 }),
        await through(1.0, { gainDb: 12, warmth: 1, punch: 1 }),
      ];
    });
    const [neutral, quiet, medium, hot, veryHot, extreme] = rows;
    expect(neutral.corr).toBeGreaterThan(0.99999);
    expect(Math.abs(neutral.gainDb)).toBeLessThan(0.001);
    expect(neutral.latency).toBe(0);
    // 문턱 아래 소리는 리미터를 지나도 크기가 같다
    expect(Math.abs(quiet.gainDb)).toBeLessThan(0.2);
    expect(Math.abs(medium.gainDb)).toBeLessThan(0.2);
    expect(quiet.latency).toBeGreaterThan(0);
    for (const r of [hot, veryHot, extreme]) expect(r.peak, r.fx).toBeLessThan(1.0);
    expect(veryHot.gainDb).toBeLessThan(0);
  });

  test('createLiveChain: 피치가 걸리고, 0 으로 돌리면 그 노드가 경로에서 빠진다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, resumeAudio, tone } = window.__dsp;
      const ctx = await resumeAudio();
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      // 150Hz 톱니파를 되풀이 재생해서 체인에 넣는다
      const wave = tone('saw', 150, 1, 0.3, ctx.sampleRate);
      const buffer = ctx.createBuffer(1, wave.samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(wave.samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const chain = await A.createLiveChain(ctx, { ...A.NEUTRAL_FX, pitch: 4 });
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 16384;
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(chain.input);
      chain.output.connect(analyser);
      analyser.connect(sink);
      sink.connect(ctx.destination);
      src.start();
      const scope = new Float32Array(analyser.fftSize);
      const read = (): { f0: number; rms: number; peak: number } => {
        analyser.getFloatTimeDomainData(scope);
        const a = { samples: scope.slice(), sampleRate: ctx.sampleRate };
        return { f0: A.estimateF0(a), rms: A.rms(a), peak: A.peak(a) };
      };

      await wait(900);
      const shifted = read();
      const latencyShifted = chain.latencySec;

      chain.update({ ...A.NEUTRAL_FX });
      await wait(600);
      const bypassed = read();
      const latencyBypassed = chain.latencySec;

      chain.update({ ...A.NEUTRAL_FX, pitch: -3, warmth: 0.5, gainDb: 12 });
      await wait(900);
      const again = read();
      const latencyAgain = chain.latencySec;

      chain.dispose();
      await wait(800); // 분석 창(16384 샘플)이 전부 새 소리로 바뀔 때까지
      const afterDispose = read();
      src.stop();
      return { state: ctx.state, sampleRate: ctx.sampleRate, shifted, bypassed, again, afterDispose, latencyShifted, latencyBypassed, latencyAgain };
    });
    expect(r.state).toBe('running');
    expect(r.shifted.f0 / 150).toBeGreaterThan(1.26 * 0.96);
    expect(r.shifted.f0 / 150).toBeLessThan(1.26 * 1.04);
    expect(r.shifted.rms).toBeGreaterThan(0.05);
    // 실시간 피치 처리의 지연: 0.05~0.2초
    expect(r.latencyShifted).toBeGreaterThan(0.05);
    expect(r.latencyShifted).toBeLessThan(0.2);
    // 전부 0 → 원음 그대로, 지연 없음
    expect(Math.abs(r.bypassed.f0 / 150 - 1)).toBeLessThan(0.01);
    expect(r.latencyBypassed).toBe(0);
    // 다시 켜면 바로 다시 걸리고, 음량을 한껏 올려도 1.0 을 넘지 않는다
    expect(Math.abs(r.again.f0 / 150 - Math.pow(2, -3 / 12))).toBeLessThan(0.04);
    expect(r.again.peak).toBeLessThan(1.0);
    expect(r.latencyAgain).toBeGreaterThan(0.05);
    // 정리하면 소리가 끊긴다
    expect(r.afterDispose.rms).toBeLessThan(1e-4);
  });
});

test.describe('MicChanger (가짜 마이크)', () => {
  test('마이크 → 효과 → 녹음: PCM 을 돌려주고, 피치 효과가 실제로 걸린다', async ({ page }) => {
    test.setTimeout(90_000);
    const r = await page.evaluate(async () => {
      const { audio: A, MicChanger, micSupported, loadFixture } = window.__dsp;
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const mic = new MicChanger();
      const states: string[] = [];
      mic.onState((s) => states.push(s));
      let maxLevel = 0;
      let levelCalls = 0;
      const offLevel = mic.onLevel((level) => {
        levelCalls++;
        maxLevel = Math.max(maxLevel, level);
      });

      const supported = micSupported();
      await mic.start(A.NEUTRAL_FX, { monitor: false });
      const stateAfterStart = mic.state;
      const latencyNeutral = mic.latencySec;

      // 되풀이되는 문장 하나(3.5초)를 통째로 담는다
      const record = async (ms: number) => {
        mic.startRecording();
        const during = mic.recording;
        await wait(ms);
        const pcm = await mic.stopRecording();
        let finite = true;
        for (const v of pcm.samples) if (!Number.isFinite(v)) finite = false;
        return { during, sec: pcm.samples.length / pcm.sampleRate, sampleRate: pcm.sampleRate, rms: A.rms(pcm), peak: A.peak(pcm), f0: A.estimateF0(pcm), finite };
      };
      const plain = await record(3700);

      mic.setFx({ ...A.NEUTRAL_FX, pitch: 5 });
      await wait(700);
      const latencyPitched = mic.latencySec;
      const pitched = await record(3700);

      mic.setMonitor(true);
      const monitoring = mic.monitoring;
      const empty = await mic.stopRecording(); // 녹음 중이 아닐 때
      mic.stop();
      const stateAfterStop = mic.state;
      offLevel();

      // 다시 켤 수 있다(피치 노드를 돌려쓴다)
      await mic.start({ ...A.NEUTRAL_FX, pitch: 5, room: 0.2 }, { monitor: false });
      const restarted = mic.state;
      const short = await record(600);
      mic.stop();

      const source = await loadFixture('voice-m.wav');
      return {
        supported, states, stateAfterStart, stateAfterStop, restarted, maxLevel, levelCalls, latencyNeutral, latencyPitched,
        plain, pitched, short, monitoring, emptyLength: empty.samples.length, sourceF0: A.estimateF0(source),
      };
    });

    expect(r.supported).toBe(true);
    expect(r.stateAfterStart).toBe('running');
    expect(r.states.slice(0, 2)).toEqual(['starting', 'running']);
    expect(r.levelCalls).toBeGreaterThan(20);
    expect(r.maxLevel).toBeGreaterThan(0.005);

    // 녹음 결과: 요청한 길이만큼의 PCM
    expect(r.plain.during).toBe(true);
    expect(r.plain.finite).toBe(true);
    expect(r.plain.sec).toBeGreaterThan(3.4);
    expect(r.plain.sec).toBeLessThan(6);
    expect(r.plain.sampleRate).toBeGreaterThanOrEqual(44100);
    expect(r.plain.rms).toBeGreaterThan(0.005);
    expect(r.plain.peak).toBeLessThanOrEqual(1);
    // 효과 없이 녹음하면 넣어 준 목소리의 음높이 그대로
    expect(Math.abs(r.plain.f0 / r.sourceF0 - 1)).toBeLessThan(0.06);

    // +5 반음 → 약 1.33배
    expect(r.pitched.finite).toBe(true);
    expect(r.pitched.rms).toBeGreaterThan(0.005);
    expect(r.pitched.f0 / r.plain.f0).toBeGreaterThan(1.335 * 0.93);
    expect(r.pitched.f0 / r.plain.f0).toBeLessThan(1.335 * 1.07);
    expect(r.latencyPitched).toBeGreaterThan(r.latencyNeutral + 0.05);
    expect(r.latencyPitched).toBeLessThan(0.5);

    expect(r.monitoring).toBe(true);
    expect(r.emptyLength).toBe(0);
    expect(r.stateAfterStop).toBe('idle');
    expect(r.restarted).toBe('running');
    expect(r.short.sec).toBeGreaterThan(0.4);
    expect(r.short.rms).toBeGreaterThan(0);
  });

  test('권한 거부와 장치 없음을 구분해서 한국어로 알려 준다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, MicChanger } = window.__dsp;
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      const attempt = async (name: string) => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('테스트', name));
        const mic = new MicChanger();
        try {
          await mic.start(A.NEUTRAL_FX);
          return { kind: 'none', message: '', state: mic.state, isMicError: false };
        } catch (err) {
          const e = err as { kind?: string; message?: string; name?: string };
          return { kind: e.kind ?? '', message: e.message ?? '', state: mic.state, isMicError: e.name === 'MicError' };
        }
      };
      const denied = await attempt('NotAllowedError');
      const missing = await attempt('NotFoundError');
      const busy = await attempt('NotReadableError');
      navigator.mediaDevices.getUserMedia = real;
      // 켜지 않은 상태에서 녹음을 시작하면 안내 문구가 나온다
      let notStarted = '';
      try {
        new MicChanger().startRecording();
      } catch (err) {
        notStarted = (err as Error).message;
      }
      return { denied, missing, busy, notStarted };
    });
    expect(r.denied.kind).toBe('denied');
    expect(r.denied.isMicError).toBe(true);
    expect(r.denied.message).toMatch(/허용/);
    expect(r.denied.state).toBe('idle');
    expect(r.missing.kind).toBe('no-device');
    expect(r.missing.message).toMatch(/찾지 못했어요/);
    expect(r.busy.kind).toBe('busy');
    expect(r.notStarted).toMatch(/마이크를 먼저/);
  });
});

test.describe('재생과 파일 형식', () => {
  test('play: 한 번에 하나만 재생하고, 끝나면 알려 준다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { play, stopAll, currentPlayback, resumeAudio, isAudioRunning, tone } = window.__dsp;
      await resumeAudio();
      const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
      const events: string[] = [];

      const short = play(tone('sine', 440, 1.0, 0.2), { onEnded: (reason) => events.push(`short:${reason}`) });
      const playingAtStart = short.playing;
      await wait(200);
      const midPosition = short.positionSec();
      const shortReason = await short.ended;
      const afterEnd = { playing: short.playing, position: short.positionSec(), duration: short.durationSec };

      const long = play(tone('sine', 330, 3, 0.2), { onEnded: (reason) => events.push(`long:${reason}`) });
      await wait(200);
      const isCurrent = currentPlayback() === long;
      const next = play(tone('sine', 220, 3, 0.2), { onEnded: (reason) => events.push(`next:${reason}`), offsetSec: 1 });
      const longReason = await long.ended;
      const longStoppedAt = long.positionSec();
      await wait(100);
      const nextPosition = next.positionSec();
      stopAll();
      const nextReason = await next.ended;
      next.stop(); // 두 번 멈춰도 한 번만 알린다
      await wait(50);
      return { running: isAudioRunning(), playingAtStart, midPosition, shortReason, afterEnd, isCurrent, longReason, longStoppedAt, nextPosition, nextReason, events, current: currentPlayback() === null };
    });
    expect(r.running).toBe(true);
    expect(r.playingAtStart).toBe(true);
    expect(r.midPosition).toBeGreaterThan(0.08);
    expect(r.midPosition).toBeLessThan(0.9);
    expect(r.shortReason).toBe('ended');
    expect(r.afterEnd.playing).toBe(false);
    expect(r.afterEnd.position).toBeCloseTo(1.0, 2);
    expect(r.afterEnd.duration).toBeCloseTo(1.0, 3);
    expect(r.isCurrent).toBe(true);
    expect(r.longReason).toBe('stopped');
    expect(r.longStoppedAt).toBeGreaterThan(0.1);
    expect(r.longStoppedAt).toBeLessThan(2);
    expect(r.nextPosition).toBeGreaterThan(1.0);
    expect(r.nextPosition).toBeLessThan(2.5);
    expect(r.nextReason).toBe('stopped');
    expect(r.events).toEqual(['short:ended', 'long:stopped', 'next:stopped']);
    expect(r.current).toBe(true);
  });

  test('WAV·MP3 로 저장한 것을 브라우저가 다시 읽을 수 있다', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const { audio: A, loadFixture } = window.__dsp;
      const voice = A.finishSpeech(await loadFixture('voice-f.wav'));
      const wavBlob = A.encodeWav(voice);
      const wav = await A.decodeAudio(wavBlob);
      const mp3Blob = await A.encodeMp3(voice);
      const mp3 = await A.decodeAudio(mp3Blob);
      const mp3Bytes = new Uint8Array(await mp3Blob.arrayBuffer());
      let bad = '';
      try {
        await A.decodeAudio(new Blob([new Uint8Array([1, 2, 3, 4, 5])]));
      } catch (err) {
        bad = (err as Error).message;
      }
      return {
        sec: voice.samples.length / voice.sampleRate,
        wav: { type: wavBlob.type, size: wavBlob.size, rate: wav.sampleRate, sec: wav.samples.length / wav.sampleRate, corr: A.correlation(voice.samples, wav.samples) },
        mp3: {
          type: mp3Blob.type,
          size: mp3Blob.size,
          sync: mp3Bytes[0] === 0xff && (mp3Bytes[1] & 0xe0) === 0xe0,
          rate: mp3.sampleRate,
          sec: mp3.samples.length / mp3.sampleRate,
          f0Ratio: A.estimateF0(mp3) / A.estimateF0(voice),
          levelDb: 20 * Math.log10(A.activeRms(mp3) / A.activeRms(voice)),
        },
        bad,
      };
    });
    expect(r.wav.type).toBe('audio/wav');
    expect(r.wav.rate).toBe(44100);
    expect(Math.abs(r.wav.sec - r.sec)).toBeLessThan(0.001);
    expect(r.wav.corr).toBeGreaterThan(0.9999);
    expect(r.mp3.type).toBe('audio/mpeg');
    expect(r.mp3.sync).toBe(true);
    // 96kbps → 초당 약 12KB
    expect(r.mp3.size / r.sec).toBeGreaterThan(11000);
    expect(r.mp3.size / r.sec).toBeLessThan(13500);
    expect(Math.abs(r.mp3.sec - r.sec)).toBeLessThan(0.1);
    expect(Math.abs(r.mp3.f0Ratio - 1)).toBeLessThan(0.02);
    expect(Math.abs(r.mp3.levelDb)).toBeLessThan(1);
    expect(r.bad).toMatch(/열 수 없어요/);
  });
});
