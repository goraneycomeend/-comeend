// 진짜 가중치(public/models)로 Node 에서 합성해 본다. onnxruntime-node 로 돌지만 파이프라인 코드는 브라우저와 같다.
// 가중치가 없으면 건너뛴다(`npm run setup` 으로 받는다).

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ort from 'onnxruntime-node';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  PAUSE_SEC,
  assembleModelFiles,
  buildTtsAssets,
  chunkText,
  createSynthesizer,
  findAudibleRange,
  isAbortError,
  preprocessText,
  tokenize,
} from '../src/core/tts/index.ts';
import type { Synthesizer, TtsAssets } from '../src/core/tts/index.ts';
import type { PcmAudio, TtsRequest } from '../src/core/types.ts';

const MODEL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models');
const hasWeights = existsSync(path.join(MODEL_DIR, 'manifest.json'));

const SENTENCE = '목표 지점 확보. 다음 지시를 기다린다.';

// ── 소리 분석(테스트 전용) ────────────────────────────────────────────────

function signalStats(a: PcmAudio): { seconds: number; rms: number; peak: number; nonFinite: number } {
  let sum = 0;
  let peak = 0;
  let nonFinite = 0;
  for (const v of a.samples) {
    if (!Number.isFinite(v)) nonFinite++;
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
  }
  return {
    seconds: a.samples.length / a.sampleRate,
    rms: Math.sqrt(sum / Math.max(1, a.samples.length)),
    peak,
    nonFinite,
  };
}

/** 유성음 구간의 기본 주파수 중앙값(Hz). 자기상관으로 대강 잰다 */
function medianF0(a: PcmAudio): number {
  const x = a.samples;
  const size = 2048;
  const hop = 1024;
  const minLag = Math.floor(a.sampleRate / 400);
  const maxLag = Math.floor(a.sampleRate / 60);
  const found: number[] = [];
  for (let start = 0; start + size < x.length; start += hop) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += x[start + i] * x[start + i];
    if (energy / size < 1e-4) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let cross = 0;
      let p = 0;
      let q = 0;
      for (let i = 0; i < size - maxLag; i += 2) {
        cross += x[start + i] * x[start + i + lag];
        p += x[start + i] ** 2;
        q += x[start + i + lag] ** 2;
      }
      const r = cross / Math.sqrt(p * q + 1e-12);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.6) found.push(a.sampleRate / bestLag);
  }
  found.sort((m, n) => m - n);
  return found.length > 0 ? found[Math.floor(found.length / 2)] : 0;
}

describe.skipIf(!hasWeights)('실제 가중치로 합성 (Node)', () => {
  let assets: TtsAssets;
  let synth: Synthesizer;
  const request = (over: Partial<TtsRequest> = {}): TtsRequest => ({
    text: SENTENCE,
    lang: 'ko',
    blend: { F1: 1 },
    speed: 1,
    steps: 8,
    seed: 20240,
    ...over,
  });

  beforeAll(async () => {
    const manifest: unknown = JSON.parse(await fs.readFile(path.join(MODEL_DIR, 'manifest.json'), 'utf8'));
    // 조각을 합치면서 크기와 SHA-256 을 확인한다
    const files = await assembleModelFiles(manifest, (p) => fs.readFile(path.join(MODEL_DIR, p)));
    expect(Object.keys(files).sort()).toEqual([
      'duration_predictor.onnx',
      'text_encoder.onnx',
      'tts.json',
      'unicode_indexer.bin',
      'vector_estimator.onnx',
      'vocoder.onnx',
      'voice.bin',
    ]);
    assets = await buildTtsAssets(ort, files, { sessionOptions: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    synth = createSynthesizer(ort, assets);
  });

  it('모델 설정과 보이스 묶음이 설계서에 적힌 값과 같다', () => {
    expect(assets.config).toEqual({ sampleRate: 44100, latentHop: 3072, latentChannels: 144 });
    expect(assets.indexer.length).toBe(65536);
    // 한글 음절은 색인에 없고(자모로 풀어서 넣는다), 자모는 있다
    expect(assets.indexer[0xac00]).toBe(-1);
    expect(assets.indexer[0x1100]).toBe(560);
    expect(assets.voices.count).toBe(10);
    expect(assets.voices.ttlShape).toEqual([50, 256]);
    expect(assets.voices.dpShape).toEqual([8, 16]);
  });

  it('전처리한 글은 전부 모델이 아는 토큰이 된다', () => {
    const prepared = preprocessText('3번 구역 확인! GPS 좌표는… <laugh> 몰라~', 'ko', assets.indexer);
    const ids = tokenize(prepared, assets.indexer);
    expect(ids.length).toBe([...prepared].length);
    expect(ids.every((id) => id >= 0)).toBe(true);
  });

  it('한국어 문장: 2~6초, NaN 없음, 충분한 음량, 같은 시드면 같은 음성', async () => {
    const a = await synth.synthesize(request());
    const b = await synth.synthesize(request());
    const c = await synth.synthesize(request({ seed: 20241 }));
    const stats = signalStats(a);
    expect(a.sampleRate).toBe(44100);
    expect(stats.seconds).toBeGreaterThan(2);
    expect(stats.seconds).toBeLessThan(6);
    expect(stats.nonFinite).toBe(0);
    expect(stats.rms).toBeGreaterThan(0.01);
    expect(stats.peak).toBeLessThanOrEqual(1);
    expect(b.samples).toEqual(a.samples);
    // 시드가 다르면 다른 테이크(길이는 같다. 길이 예측에는 난수가 안 쓰인다)
    expect(c.samples.length).toBe(a.samples.length);
    expect(c.samples).not.toEqual(a.samples);
  });

  it('F1 과 M3 의 높이가 뚜렷이 다르고, 섞으면 그 사이가 된다', async () => {
    const f1 = medianF0(await synth.synthesize(request({ blend: { F1: 1 } })));
    const m3 = medianF0(await synth.synthesize(request({ blend: { M3: 1 } })));
    const m1 = medianF0(await synth.synthesize(request({ blend: { M1: 1 } })));
    const f1m1 = medianF0(await synth.synthesize(request({ blend: { F1: 1, M1: 1 } })));
    const f1m3 = medianF0(await synth.synthesize(request({ blend: { F1: 3, M3: 1 } })));
    console.log(
      `[tts] F0 중앙값(Hz): F1 ${f1.toFixed(0)}, M3 ${m3.toFixed(0)}, M1 ${m1.toFixed(0)}, ` +
        `F1+M1 반반 ${f1m1.toFixed(0)}, F1 75%+M3 25% ${f1m3.toFixed(0)}`,
    );
    expect(f1).toBeGreaterThan(150);
    expect(m3).toBeLessThan(135);
    expect(f1 / m3).toBeGreaterThan(1.4);
    expect(f1m1).toBeGreaterThan(m1);
    expect(f1m1).toBeLessThan(f1);
    expect(f1m3).toBeGreaterThan(m3);
    expect(f1m3).toBeLessThan(f1);
  }, 60_000);

  it('숫자·영문·기호·표현 태그가 섞여도 길이가 그럴듯하다', async () => {
    const cases: Array<{ text: string; min: number; max: number }> = [
      { text: '3번 구역에 적 2명, 5분 뒤 진입한다.', min: 2.5, max: 6 },
      { text: '명중률 50%입니다. 남은 탄약은 120발.', min: 3, max: 7 },
      { text: '오케이, GPS 좌표 확인했어. ETA는 10분.', min: 3, max: 7 },
      { text: '아 진짜? <laugh> 그건 좀 웃기다.', min: 2, max: 5.5 },
      { text: '<sigh> 또 시작이네. 알았어, 내가 갈게.', min: 2.5, max: 6 },
      { text: '글쎄… 그건 좀 더 생각해 봐야겠는데.', min: 2.5, max: 6 },
      { text: '주소는 hq@base.kr, 암호는 #7 [임시]', min: 3, max: 9 },
      { text: '네.', min: 0.6, max: 2.5 },
      { text: '😀 좋아 ㅋㅋㅋ 完了 ★', min: 0.8, max: 4 },
    ];
    for (const { text, min, max } of cases) {
      const stats = signalStats(await synth.synthesize(request({ text })));
      expect(stats.seconds, text).toBeGreaterThan(min);
      expect(stats.seconds, text).toBeLessThan(max);
      expect(stats.nonFinite, text).toBe(0);
      expect(stats.rms, text).toBeGreaterThan(0.01);
    }
  }, 90_000);

  it('영어와 일본어도 합성된다', async () => {
    const en = signalStats(await synth.synthesize(request({ text: 'Target secured. Awaiting further orders.', lang: 'en' })));
    const ja = signalStats(await synth.synthesize(request({ text: '目標地点を確保。次の指示を待つ。', lang: 'ja' })));
    for (const stats of [en, ja]) {
      expect(stats.seconds).toBeGreaterThan(2);
      expect(stats.seconds).toBeLessThan(7);
      expect(stats.nonFinite).toBe(0);
      expect(stats.rms).toBeGreaterThan(0.01);
    }
  });

  it('빠르기를 올리면 짧아지고, 스텝 수는 길이를 바꾸지 않는다', async () => {
    const slow = await synth.synthesize(request({ speed: 0.85, steps: 5 }));
    const normal = await synth.synthesize(request({ speed: 1, steps: 5 }));
    const fast = await synth.synthesize(request({ speed: 1.3, steps: 5 }));
    const more = await synth.synthesize(request({ speed: 1, steps: 12 }));
    expect(slow.samples.length / normal.samples.length).toBeCloseTo(1 / 0.85, 2);
    expect(fast.samples.length / normal.samples.length).toBeCloseTo(1 / 1.3, 2);
    expect(more.samples.length).toBe(normal.samples.length);
    for (const a of [slow, fast, more]) {
      const stats = signalStats(a);
      expect(stats.nonFinite).toBe(0);
      expect(stats.rms).toBeGreaterThan(0.01);
    }
  }, 60_000);

  it('긴 글은 문장 단위 조각으로 합성하고, 이음매의 쉼이 정한 길이가 된다', async () => {
    const text =
      '좋아, 다들 잘 들어. 지금부터 십 분 안에 저 건물 옥상까지 올라간다. 중간에 멈추지 말고, 무슨 일 있으면 바로 말해. ' +
      '왼쪽 계단은 내가 먼저 확인할게. 신호 주면 한 명씩 따라와. 서두르지 않아도 돼, 대신 소리는 내지 마. 준비됐지? 그럼 가자.';
    const chunks = chunkText(text, 'ko');
    expect(chunks.length).toBe(2);
    const started: number[] = [];
    const joined = await synth.synthesize(request({ text, steps: 5 }), {
      onProgress: (p) => {
        expect(p.chunkCount).toBe(2);
        if (p.step === 0) started.push(p.chunkIndex);
      },
    });
    expect(started).toEqual([0, 1]);
    const stats = signalStats(joined);
    expect(stats.nonFinite).toBe(0);
    expect(stats.seconds).toBeGreaterThan(12);
    expect(stats.seconds).toBeLessThan(32);

    // 첫 조각만 따로 합성하면(같은 시드) 이어 붙인 결과의 앞부분과 같아야 한다: 이음매 밖은 모델 출력 그대로다
    const first = await synth.synthesize(request({ text: chunks[0], steps: 5 }));
    const second = await synth.synthesize(request({ text: chunks[1], steps: 5 }));
    const range = findAudibleRange(first.samples, first.sampleRate);
    expect(range).not.toBeNull();
    const speechEnd = range?.end ?? 0;
    expect(joined.samples.subarray(0, speechEnd - 441)).toEqual(first.samples.subarray(0, speechEnd - 441));

    // 모델은 조각마다 앞뒤에 무음을 0.2~0.8초씩 붙인다. 그대로 이으면 쉼이 1초 안팎이 된다
    const sr = first.sampleRate;
    const trailing = (first.samples.length - speechEnd) / sr;
    const leading = (findAudibleRange(second.samples, sr)?.start ?? 0) / sr;
    expect(trailing + leading).toBeGreaterThan(0.5);

    // 이어 붙인 결과에서 첫 조각의 소리가 끝난 뒤 다음 소리가 날 때까지의 간격
    const frame = Math.round(0.01 * sr);
    let quietFrames = 0;
    for (let from = speechEnd; from + frame <= joined.samples.length; from += frame) {
      let sum = 0;
      for (let i = from; i < from + frame; i++) sum += joined.samples[i] * joined.samples[i];
      if (Math.sqrt(sum / frame) >= 0.001) break;
      quietFrames++;
    }
    const gap = (quietFrames * frame) / sr;
    console.log(
      `[tts] 모델이 붙인 무음: 앞 조각 끝 ${trailing.toFixed(2)}초 + 뒤 조각 처음 ${leading.toFixed(2)}초 → 이은 뒤 쉼 ${gap.toFixed(2)}초`,
    );
    // 첫 조각은 마침표로 끝난다
    expect(gap).toBeGreaterThan(PAUSE_SEC.sentence - 0.05);
    expect(gap).toBeLessThan(PAUSE_SEC.sentence + 0.05);
    // 그대로 이은 것보다 전체 길이가 줄었다(뒤 조각은 이어 합성할 때 다른 잡음을 쓰므로 정확히 같지는 않다)
    const naive = first.samples.length + second.samples.length;
    expect((naive - joined.samples.length) / sr).toBeGreaterThan(0.25);
  }, 90_000);

  it('스텝 사이에 취소할 수 있다', async () => {
    const controller = new AbortController();
    const err = await synth
      .synthesize(request({ steps: 16 }), {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.step === 2) controller.abort();
        },
      })
      .catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    // 취소 뒤에도 계속 쓸 수 있다
    const ok = await synth.synthesize(request({ steps: 4 }));
    expect(signalStats(ok).rms).toBeGreaterThan(0.01);
  });
});
