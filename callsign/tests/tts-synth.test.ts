// 합성 파이프라인을 가짜 런타임으로 확인한다(가중치 없이 돈다).
// 진짜 모델로 돌리는 확인은 tts-integration.test.ts 에 있다.

import { describe, expect, it } from 'vitest';

import {
  PAUSE_SEC,
  TtsInputError,
  createRng,
  createSynthesizer,
  fillGaussian,
  findAudibleRange,
  isAbortError,
  joinChunks,
  parseVoiceBank,
} from '../src/core/tts/index.ts';
import type { OrtLike, OrtSessionLike, OrtTensorLike, TtsAssets } from '../src/core/tts/index.ts';
import type { TtsProgress, TtsRequest } from '../src/core/types.ts';

const SR = 44100;
const HOP = 3072;
const CHANNELS = 144;

// ── 가짜 런타임 ───────────────────────────────────────────────────────────

class FakeTensor implements OrtTensorLike {
  readonly type: string;
  readonly data: Float32Array | BigInt64Array;
  readonly dims: readonly number[];
  constructor(type: string, data: Float32Array | BigInt64Array, dims: readonly number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
const fakeOrt: OrtLike = { Tensor: FakeTensor };

interface Call {
  session: string;
  feeds: Record<string, FakeTensor>;
}

function makeVoices(): ReturnType<typeof parseVoiceBank> {
  const ttlLen = 10 * 50 * 256;
  const dpLen = 10 * 8 * 16;
  const buf = new ArrayBuffer(48 + 4 * (ttlLen + dpLen));
  const view = new DataView(buf);
  [10, 50, 256, 10, 8, 16].forEach((v, i) => view.setBigInt64(i * 8, BigInt(v), true));
  const ttl = new Float32Array(buf, 48, ttlLen);
  for (let i = 0; i < 10; i++) ttl.fill(i + 1, i * 50 * 256, (i + 1) * 50 * 256);
  return parseVoiceBank(buf);
}

/**
 * 가짜 모델 넷. 길이 예측은 토큰 하나에 `secPerToken` 초, 보코더는 잠재 벡터 첫 채널 값을 그대로 늘여 놓는다.
 * `delayMs` 를 주면 스텝마다 그만큼 기다린다(취소·줄 세우기 확인용).
 */
function makeAssets(options: { secPerToken?: number; delayMs?: number; duration?: number } = {}): {
  assets: TtsAssets;
  calls: Call[];
  running: { now: number; max: number };
} {
  const calls: Call[] = [];
  const running = { now: 0, max: 0 };
  const secPerToken = options.secPerToken ?? 0.05;
  const session = (
    name: string,
    run: (feeds: Record<string, FakeTensor>) => Record<string, FakeTensor>,
  ): OrtSessionLike => ({
    async run(feeds) {
      running.now++;
      running.max = Math.max(running.max, running.now);
      calls.push({ session: name, feeds: feeds as Record<string, FakeTensor> });
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      running.now--;
      return run(feeds as Record<string, FakeTensor>);
    },
  });

  // 색인: 띄어쓰기·문장부호·꺾쇠·영문·숫자·한글 자모만 안다. 나머지는 -1
  const indexer = new Int32Array(65536).fill(-1);
  let next = 1;
  for (const ch of ' .,!?~<>/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    indexer[ch.codePointAt(0) as number] = next++;
  }
  for (let cp = 0x1100; cp <= 0x1112; cp++) indexer[cp] = next++;
  for (let cp = 0x1161; cp <= 0x1175; cp++) indexer[cp] = next++;
  for (let cp = 0x11a8; cp <= 0x11c2; cp++) indexer[cp] = next++;

  const assets: TtsAssets = {
    config: { sampleRate: SR, latentHop: HOP, latentChannels: CHANNELS },
    indexer,
    voices: makeVoices(),
    sessions: {
      durationPredictor: session('dp', (feeds) => ({
        duration: new FakeTensor('float32', Float32Array.of(options.duration ?? secPerToken * feeds.text_ids.dims[1]), [1]),
      })),
      textEncoder: session('te', (feeds) => {
        const t = feeds.text_ids.dims[1];
        return { text_emb: new FakeTensor('float32', new Float32Array(256 * t).fill(0.5), [1, 256, t]) };
      }),
      vectorEstimator: session('ve', (feeds) => {
        const input = feeds.noisy_latent.data as Float32Array;
        // 스텝마다 절반으로 줄인다(잡음 → 0 으로 다가가는 흉내)
        return { denoised_latent: new FakeTensor('float32', input.map((v) => v * 0.5), feeds.noisy_latent.dims) };
      }),
      vocoder: session('voc', (feeds) => {
        const latent = feeds.latent.data as Float32Array;
        const length = feeds.latent.dims[2];
        const wav = new Float32Array(HOP * length);
        for (let t = 0; t < length; t++) wav.fill(Math.max(-1, Math.min(1, latent[t])), t * HOP, (t + 1) * HOP);
        return { wav_tts: new FakeTensor('float32', wav, [1, HOP * length]) };
      }),
    },
  };
  return { assets, calls, running };
}

const req = (over: Partial<TtsRequest> = {}): TtsRequest => ({
  text: '목표 지점 확보.',
  lang: 'ko',
  blend: { F1: 1 },
  speed: 1,
  steps: 8,
  seed: 7,
  ...over,
});

// ── 난수 ──────────────────────────────────────────────────────────────────

describe('시드 난수', () => {
  it('같은 시드면 같은 수열, 다른 시드나 다른 흐름이면 다른 수열', () => {
    const take = (rng: () => number): number[] => Array.from({ length: 8 }, () => rng());
    expect(take(createRng(42))).toEqual(take(createRng(42)));
    expect(take(createRng(42))).not.toEqual(take(createRng(43)));
    expect(take(createRng(42, 0))).not.toEqual(take(createRng(42, 1)));
    // 32비트를 넘는 시드도 구별한다
    expect(take(createRng(1))).not.toEqual(take(createRng(1 + 2 ** 32)));
    for (const v of take(createRng(5))) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('fillGaussian 은 평균 0, 표준편차 1 에 가까운 값을 채운다', () => {
    const x = new Float32Array(200_001);
    fillGaussian(x, createRng(123));
    let sum = 0;
    let sq = 0;
    let max = 0;
    for (const v of x) {
      expect(Number.isFinite(v)).toBe(true);
      sum += v;
      sq += v * v;
      max = Math.max(max, Math.abs(v));
    }
    const mean = sum / x.length;
    const std = Math.sqrt(sq / x.length - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(std).toBeGreaterThan(0.99);
    expect(std).toBeLessThan(1.01);
    // 꼬리가 잘려 있지 않다(참조 구현은 ±4.29 에서 잘린다)
    expect(max).toBeGreaterThan(3.5);
    // 3시그마 밖 비율 ≈ 0.27%
    const outside = x.reduce((n, v) => n + (Math.abs(v) > 3 ? 1 : 0), 0) / x.length;
    expect(outside).toBeGreaterThan(0.0018);
    expect(outside).toBeLessThan(0.0036);

    const again = new Float32Array(200_001);
    fillGaussian(again, createRng(123));
    expect(again).toEqual(x);
  });
});

// ── 이어 붙이기 ───────────────────────────────────────────────────────────

/** 모델 출력 흉내: 무음 lead초 + 사인파 tone초 + 무음 trail초 */
function fakeUtterance(lead: number, tone: number, trail: number): Float32Array {
  const x = new Float32Array(Math.round((lead + tone + trail) * SR));
  const from = Math.round(lead * SR);
  const to = from + Math.round(tone * SR);
  for (let i = from; i < to; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * 220 * (i - from)) / SR);
  return x;
}

/** 소리가 나는 구간들의 [시작, 끝) 초 */
function audibleSpans(x: Float32Array): Array<[number, number]> {
  const frame = Math.round(0.005 * SR);
  const spans: Array<[number, number]> = [];
  let open = -1;
  for (let from = 0; from < x.length; from += frame) {
    let peak = 0;
    for (let i = from; i < Math.min(x.length, from + frame); i++) peak = Math.max(peak, Math.abs(x[i]));
    const loud = peak > 0.01;
    if (loud && open < 0) open = from;
    if (!loud && open >= 0) {
      spans.push([open / SR, from / SR]);
      open = -1;
    }
  }
  if (open >= 0) spans.push([open / SR, x.length / SR]);
  return spans;
}

describe('joinChunks', () => {
  it('조각이 하나면 손대지 않고 그대로 돌려준다', () => {
    const one = fakeUtterance(0.5, 0.3, 0.5);
    expect(joinChunks([one], [0], SR)).toBe(one);
    expect(joinChunks([], [], SR).length).toBe(0);
  });

  it('소리가 나는 구간을 찾는다', () => {
    const range = findAudibleRange(fakeUtterance(0.5, 0.3, 0.4), SR);
    expect(range).not.toBeNull();
    expect((range?.start ?? 0) / SR).toBeCloseTo(0.5, 1);
    expect((range?.end ?? 0) / SR).toBeCloseTo(0.8, 1);
    expect(findAudibleRange(new Float32Array(SR), SR)).toBeNull();
    // 아주 여린 소리(-50dBFS)도 소리로 본다. 숨소리를 자르지 않기 위해서다
    const soft = new Float32Array(SR);
    for (let i = 22050; i < 30000; i++) soft[i] = 0.003 * Math.sin(i / 10);
    expect(findAudibleRange(soft, SR)).not.toBeNull();
  });

  it('모델이 붙인 앞뒤 무음을 이음매에서 걷어 내고, 정한 쉼만큼만 띄운다', () => {
    // 모델은 조각마다 앞뒤로 0.5초쯤 무음을 붙인다. 그대로 이으면 쉼이 1초를 넘는다
    const parts = [fakeUtterance(0.5, 0.4, 0.6), fakeUtterance(0.45, 0.3, 0.55), fakeUtterance(0.5, 0.2, 0.5)];
    const pauses = [PAUSE_SEC.sentence, PAUSE_SEC.clause, 0];
    const out = joinChunks(parts, pauses, SR);
    const spans = audibleSpans(out);
    expect(spans.length).toBe(3);
    expect(spans[1][0] - spans[0][1]).toBeCloseTo(PAUSE_SEC.sentence, 1);
    expect(spans[2][0] - spans[1][1]).toBeCloseTo(PAUSE_SEC.clause, 1);
    // 맨 앞과 맨 뒤의 무음은 그대로 둔다(그건 후처리가 정리한다)
    expect(spans[0][0]).toBeCloseTo(0.5, 1);
    expect(out.length / SR - spans[2][1]).toBeCloseTo(0.5, 1);
    // 소리 길이는 줄지 않는다
    expect(spans[0][1] - spans[0][0]).toBeCloseTo(0.4, 1);
    expect(spans[1][1] - spans[1][0]).toBeCloseTo(0.3, 1);
    // 원본 조각은 바뀌지 않는다
    expect(parts[1][Math.round(0.45 * SR) + 50]).not.toBe(0);
  });

  it('전부 무음인 조각이 끼어도 깨지지 않는다', () => {
    const out = joinChunks([fakeUtterance(0.2, 0.2, 0.2), new Float32Array(1000), fakeUtterance(0.2, 0.2, 0.2)], [0.2, 0.2, 0], SR);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(audibleSpans(out).length).toBe(2);
  });
});

// ── 합성기 ────────────────────────────────────────────────────────────────

describe('createSynthesizer', () => {
  it('모델 넷을 순서대로 부르고 입력 모양을 맞춘다', async () => {
    const { assets, calls } = makeAssets();
    const synth = createSynthesizer(fakeOrt, assets);
    expect(synth.sampleRate).toBe(SR);
    const audio = await synth.synthesize(req({ steps: 6 }));

    expect(calls.map((c) => c.session)).toEqual(['dp', 'te', 've', 've', 've', 've', 've', 've', 'voc']);
    const [dp, te, ...rest] = calls;
    const tokens = dp.feeds.text_ids.dims[1];
    expect(dp.feeds.text_ids.type).toBe('int64');
    expect(dp.feeds.text_ids.dims).toEqual([1, tokens]);
    expect(dp.feeds.text_mask.dims).toEqual([1, 1, tokens]);
    expect((dp.feeds.text_mask.data as Float32Array).every((v) => v === 1)).toBe(true);
    expect(dp.feeds.style_dp.dims).toEqual([1, 8, 16]);
    expect(te.feeds.style_ttl.dims).toEqual([1, 50, 256]);

    // 길이: 토큰당 0.05초 → 잠재 길이는 올림
    const seconds = 0.05 * tokens;
    const wavLength = Math.floor(seconds * SR);
    const latentLength = Math.ceil(wavLength / HOP);
    const steps = rest.filter((c) => c.session === 've');
    steps.forEach((c, i) => {
      expect(c.feeds.noisy_latent.dims).toEqual([1, CHANNELS, latentLength]);
      expect(c.feeds.latent_mask.dims).toEqual([1, 1, latentLength]);
      expect(Array.from(c.feeds.current_step.data as Float32Array)).toEqual([i]);
      expect(Array.from(c.feeds.total_step.data as Float32Array)).toEqual([6]);
      expect(c.feeds.text_emb.dims).toEqual([1, 256, tokens]);
    });
    // 앞 스텝의 출력이 다음 스텝의 입력으로 그대로 간다
    const first = steps[0].feeds.noisy_latent.data as Float32Array;
    const second = steps[1].feeds.noisy_latent.data as Float32Array;
    expect(second[0]).toBeCloseTo(first[0] * 0.5, 6);
    expect(calls[calls.length - 1].feeds.latent.dims).toEqual([1, CHANNELS, latentLength]);

    // 보코더 출력에서 예측한 길이만큼만 쓴다
    expect(audio.sampleRate).toBe(SR);
    expect(audio.samples.length).toBe(wavLength);
    expect(audio.samples.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('모델이 모르는 글자(-1)는 넣지 않는다', async () => {
    const { assets, calls } = makeAssets();
    const synth = createSynthesizer(fakeOrt, assets);
    // 한자·특수기호는 가짜 색인에 없다
    await synth.synthesize(req({ text: '확보 完了 ★ OK' }));
    const ids = Array.from(calls[0].feeds.text_ids.data as BigInt64Array);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id >= 0n)).toBe(true);
    // 아는 글자만으로 만든 문장과 토큰이 같다(빠진 자리에 겹친 띄어쓰기가 남지 않는다)
    const { assets: a2, calls: c2 } = makeAssets();
    await createSynthesizer(fakeOrt, a2).synthesize(req({ text: '확보 OK' }));
    expect(Array.from(c2[0].feeds.text_ids.data as BigInt64Array)).toEqual(ids);
  });

  it('같은 시드면 같은 음성, 다른 시드면 다른 음성, 시드가 없으면 매번 다르다', async () => {
    const synth = createSynthesizer(fakeOrt, makeAssets().assets);
    const a = await synth.synthesize(req({ seed: 11 }));
    const b = await synth.synthesize(req({ seed: 11 }));
    const c = await synth.synthesize(req({ seed: 12 }));
    expect(b.samples).toEqual(a.samples);
    expect(c.samples).not.toEqual(a.samples);

    const noSeed = req();
    delete noSeed.seed;
    const d = await synth.synthesize(noSeed);
    const e = await synth.synthesize(noSeed);
    expect(e.samples).not.toEqual(d.samples);
  });

  it('잡음은 표준정규분포에서 뽑는다', async () => {
    const { assets, calls } = makeAssets({ duration: 20 });
    await createSynthesizer(fakeOrt, assets).synthesize(req());
    const noise = calls.find((c) => c.session === 've')?.feeds.noisy_latent.data as Float32Array;
    expect(noise.length).toBeGreaterThan(40_000);
    const mean = noise.reduce((s, v) => s + v, 0) / noise.length;
    const std = Math.sqrt(noise.reduce((s, v) => s + (v - mean) ** 2, 0) / noise.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(std).toBeGreaterThan(0.97);
    expect(std).toBeLessThan(1.03);
  });

  it('빠르기는 길이를 나누고, 범위(0.8~1.4)를 벗어난 값은 범위 끝으로 맞춘다', async () => {
    const length = async (speed: number): Promise<number> => {
      const { assets } = makeAssets({ duration: 4 });
      return (await createSynthesizer(fakeOrt, assets).synthesize(req({ speed }))).samples.length;
    };
    expect(await length(1)).toBe(4 * SR);
    expect(await length(1.25)).toBe(Math.floor((4 / 1.25) * SR));
    expect(await length(0.8)).toBe(Math.floor((4 / 0.8) * SR));
    expect(await length(3)).toBe(Math.floor((4 / 1.4) * SR));
    expect(await length(0.1)).toBe(Math.floor((4 / 0.8) * SR));
    expect(await length(Number.NaN)).toBe(4 * SR);
  });

  it('스텝 수는 4~16 정수로 맞춘다', async () => {
    const stepsUsed = async (steps: number): Promise<number> => {
      const { assets, calls } = makeAssets();
      await createSynthesizer(fakeOrt, assets).synthesize(req({ steps }));
      return calls.filter((c) => c.session === 've').length;
    };
    expect(await stepsUsed(5)).toBe(5);
    expect(await stepsUsed(1)).toBe(4);
    expect(await stepsUsed(99)).toBe(16);
    expect(await stepsUsed(7.6)).toBe(8);
  });

  it('진행률: 조각이 시작될 때 0, 스텝이 끝날 때마다 1씩', async () => {
    const synth = createSynthesizer(fakeOrt, makeAssets().assets);
    const seen: TtsProgress[] = [];
    await synth.synthesize(req({ steps: 4 }), { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([0, 1, 2, 3, 4].map((step) => ({ chunkIndex: 0, chunkCount: 1, step, steps: 4 })));
  });

  it('긴 글은 조각으로 나눠 합성하고 쉼을 두고 잇는다', async () => {
    const sentence = '지금부터 십 분 안에 저 건물 옥상까지 올라간다.';
    const text = Array.from({ length: 9 }, () => sentence).join(' ');
    const { assets, calls } = makeAssets({ duration: 1 });
    const seen: TtsProgress[] = [];
    const audio = await createSynthesizer(fakeOrt, assets).synthesize(req({ text, steps: 4 }), {
      onProgress: (p) => seen.push(p),
    });
    const chunkCount = calls.filter((c) => c.session === 'dp').length;
    expect(chunkCount).toBe(3);
    expect(new Set(seen.map((p) => p.chunkCount))).toEqual(new Set([3]));
    expect(seen.filter((p) => p.step === 0).map((p) => p.chunkIndex)).toEqual([0, 1, 2]);
    expect(seen[seen.length - 1]).toEqual({ chunkIndex: 2, chunkCount: 3, step: 4, steps: 4 });
    // 조각마다 다른 잡음을 쓴다
    const noises = calls.filter((c) => c.session === 've' && (c.feeds.current_step.data as Float32Array)[0] === 0);
    expect(noises[0].feeds.noisy_latent.data).not.toEqual(noises[1].feeds.noisy_latent.data);
    // 가짜 모델은 무음을 붙이지 않으니, 전체 길이는 조각 셋 + 쉼 둘에 가깝다
    const expected = 3 + 2 * PAUSE_SEC.sentence;
    expect(audio.samples.length / SR).toBeGreaterThan(expected - 0.2);
    expect(audio.samples.length / SR).toBeLessThanOrEqual(expected + 0.01);
  });

  it('읽을 글이 없으면 한국어 메시지로 거절하고 모델을 부르지 않는다', async () => {
    const { assets, calls } = makeAssets();
    const synth = createSynthesizer(fakeOrt, assets);
    await expect(synth.synthesize(req({ text: '   ' }))).rejects.toThrow(TtsInputError);
    await expect(synth.synthesize(req({ text: '😀😀' }))).rejects.toThrow(/읽을 수 있는 글자/);
    // 모델이 아는 글자가 하나도 없는 글(가짜 색인에는 한자가 없다)
    await expect(synth.synthesize(req({ text: '完了' }))).rejects.toThrow(TtsInputError);
    await expect(synth.synthesize(req({ text: 'a'.repeat(5001) }))).rejects.toThrow(/너무 길어요/);
    // @ts-expect-error 계약에 없는 언어 코드
    await expect(synth.synthesize(req({ lang: 'xx' }))).rejects.toThrow(/언어/);
    await expect(synth.synthesize(req({ blend: {} }))).rejects.toThrow(/보이스/);
    expect(calls.length).toBe(0);
  });

  it('길이 예측이 이상하면(0, 음수, NaN, 너무 김) 멈춘다', async () => {
    for (const duration of [0, -1, Number.NaN, 500]) {
      const { assets, calls } = makeAssets({ duration });
      await expect(createSynthesizer(fakeOrt, assets).synthesize(req())).rejects.toThrow(/길이/);
      expect(calls.some((c) => c.session === 've')).toBe(false);
    }
  });

  it('스텝 사이에 취소하면 AbortError 로 끝나고 남은 스텝을 돌리지 않는다', async () => {
    const { assets, calls } = makeAssets({ delayMs: 5 });
    const synth = createSynthesizer(fakeOrt, assets);
    const controller = new AbortController();
    const promise = synth.synthesize(req({ steps: 16 }), {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.step === 3) controller.abort();
      },
    });
    const err = await promise.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(calls.filter((c) => c.session === 've').length).toBe(3);
    expect(calls.some((c) => c.session === 'voc')).toBe(false);

    // 이미 취소된 신호로 부르면 아무것도 돌리지 않는다
    const before = calls.length;
    const err2 = await synth.synthesize(req(), { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbortError(err2)).toBe(true);
    expect(calls.length).toBe(before);

    // 취소 뒤에도 다음 요청은 정상 처리된다
    const ok = await synth.synthesize(req({ steps: 4 }));
    expect(ok.samples.length).toBeGreaterThan(0);
  });

  it('동시에 불러도 한 번에 하나씩, 부른 순서대로 처리한다', async () => {
    const { assets, calls, running } = makeAssets({ delayMs: 2 });
    const synth = createSynthesizer(fakeOrt, assets);
    const order: string[] = [];
    const results = await Promise.all(
      ['하나.', '둘.', '셋.'].map((text, i) =>
        synth.synthesize(req({ text, steps: 4, seed: i })).then((audio) => {
          order.push(text);
          return audio;
        }),
      ),
    );
    expect(results.length).toBe(3);
    expect(order).toEqual(['하나.', '둘.', '셋.']);
    expect(running.max).toBe(1);
    // 요청 하나의 호출이 끝난 뒤에야 다음 요청이 시작된다
    const names = calls.map((c) => c.session).join(' ');
    expect(names).toBe(Array.from({ length: 3 }, () => 'dp te ve ve ve ve voc').join(' '));
  });

  it('앞 요청이 실패해도 뒤 요청은 처리된다', async () => {
    const synth = createSynthesizer(fakeOrt, makeAssets().assets);
    const bad = synth.synthesize(req({ text: '' }));
    const good = synth.synthesize(req());
    await expect(bad).rejects.toThrow(TtsInputError);
    expect((await good).samples.length).toBeGreaterThan(0);
  });
});
