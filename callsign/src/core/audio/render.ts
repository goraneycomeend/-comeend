// 목소리에 효과를 입힌다. 오프라인(파일·합성 결과)과 실시간(마이크) 두 길.
import type { LiveVoiceChain, PcmAudio, VoiceFx } from '../types.ts';
import { estimateF0 } from './analysis.ts';
import { buildFxGraph, fxTailSec } from './fxGraph.ts';
import { clampFx, isNeutralFx } from './fxSchema.ts';
import { limitPeaks } from './limiter.ts';
import { type LivePitch, createLivePitch, needsPitch, shiftPitch } from './pitch.ts';

/** 렌더 결과의 피크 한계 (-1dBFS) */
const RENDER_CEILING = 0.891;

/**
 * 효과를 입힌 새 음성을 돌려준다(입력은 그대로).
 * - 전부 0 이면 아무 처리 없이 복사본을 돌려준다
 * - 피치·포먼트가 0 이면 그 처리는 거치지 않는다
 * - 울림·메아리가 있으면 꼬리만큼 길어진다
 * - 어떤 설정에서도 피크는 -1dBFS 를 넘지 않는다
 */
export async function renderVoice(input: PcmAudio, fx: VoiceFx): Promise<PcmAudio> {
  const f = clampFx(fx);
  const sampleRate = input.sampleRate;
  if (isNeutralFx(f) || input.samples.length === 0) {
    return { samples: input.samples.slice(), sampleRate };
  }

  // 1) 피치·포먼트 — 필요할 때만
  let voiced = input.samples;
  if (needsPitch(f)) {
    // 기본 주파수는 대략만 알면 되므로 긴 입력은 앞 8초만 본다
    const head = input.samples.subarray(0, Math.min(input.samples.length, Math.round(sampleRate * 8)));
    const baseHz = estimateF0({ samples: head, sampleRate });
    const shifted = await shiftPitch(input, f.pitch, f.formant, { baseHz });
    voiced = shifted.samples;
  }

  // 2) 나머지 효과 — 켜진 것이 있을 때만 Web Audio 그래프를 거친다
  const rest: VoiceFx = { ...f, pitch: 0, formant: 0 };
  if (isNeutralFx(rest)) {
    return { samples: limitPeaks(voiced, sampleRate, RENDER_CEILING), sampleRate };
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('이 환경에서는 음향 효과를 입힐 수 없어요. (OfflineAudioContext 없음)');
  }
  const inputLength = voiced.length;
  const tail = Math.ceil(fxTailSec(rest) * sampleRate);
  const ctx = new OfflineAudioContext(1, inputLength + tail, sampleRate);
  const graph = buildFxGraph(ctx, rest, { safety: 'none' });
  const buffer = ctx.createBuffer(1, inputLength, sampleRate);
  buffer.getChannelData(0).set(voiced);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(graph.input);
  graph.output.connect(ctx.destination);
  source.start(0);

  const rendered = await ctx.startRendering();
  graph.dispose();
  let out = limitPeaks(rendered.getChannelData(0), sampleRate, RENDER_CEILING);

  // 꼬리 중 들리지 않는 부분은 잘라 낸다. 입력보다 짧아지지는 않는다
  if (tail > 0) {
    let last = out.length - 1;
    while (last >= inputLength && Math.abs(out[last]) < 2e-4) last--;
    const keep = Math.min(out.length, Math.max(inputLength, last + 1 + Math.round(sampleRate * 0.02)));
    if (keep < out.length) out = out.slice(0, keep);
    // 꼬리가 뚝 끊기지 않게
    const fade = Math.min(out.length, Math.round(sampleRate * 0.004));
    for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  }

  return { samples: out, sampleRate };
}

/**
 * 실시간 효과 체인. input 에 소리를 연결하고 output 을 듣거나 녹음한다.
 * update() 로 값을 바꿀 수 있고, 피치·포먼트가 0 이 되면 그 노드는 경로에서 빠진다.
 */
export async function createLiveChain(ctx: AudioContext, fx: VoiceFx): Promise<LiveVoiceChain> {
  let current = clampFx(fx);
  const input = ctx.createGain();
  const graph = buildFxGraph(ctx, current, { safety: 'node' });
  let pitch: LivePitch | null = null;
  let pitchLoading: Promise<void> | null = null;
  let pitchInPath = false;
  let pitchUnavailable = false;
  let disposed = false;

  const givePitchUp = (err: unknown): void => {
    // 워크릿을 못 올린 환경. 높낮이 없이 나머지 효과만 건다(다시 시도하지 않는다)
    pitchUnavailable = true;
    console.warn('[callsign] 실시간 높낮이 처리를 쓸 수 없어 나머지 효과만 적용합니다.', err);
  };

  const route = (): void => {
    const want = needsPitch(current) && pitch !== null;
    try {
      input.disconnect();
    } catch {
      // 연결이 없었다
    }
    if (pitch) {
      try {
        pitch.output.disconnect();
      } catch {
        // 연결이 없었다
      }
    }
    if (want && pitch) {
      input.connect(pitch.input);
      pitch.output.connect(graph.input);
    } else {
      input.connect(graph.input);
    }
    pitchInPath = want;
  };

  const syncPitch = (): void => {
    if (disposed) return;
    const need = needsPitch(current);
    if (need && pitch) {
      pitch.set(current.pitch, current.formant);
      if (!pitchInPath) route();
    } else if (need && !pitchLoading && !pitchUnavailable) {
      pitchLoading = createLivePitch(ctx, current.pitch, current.formant)
        .then((p) => {
          pitchLoading = null;
          if (disposed) {
            p.release();
            return;
          }
          pitch = p;
          syncPitch();
        })
        .catch((err: unknown) => {
          pitchLoading = null;
          givePitchUp(err);
        });
    } else if (!need && pitchInPath) {
      route();
    }
  };

  input.connect(graph.input);
  if (needsPitch(current)) {
    // 처음부터 필요하면 준비될 때까지 기다린다
    try {
      pitch = await createLivePitch(ctx, current.pitch, current.formant);
      route();
    } catch (err) {
      givePitchUp(err);
    }
  }

  return {
    input,
    output: graph.output,
    get latencySec(): number {
      return graph.latencySec + (pitchInPath && pitch ? pitch.latencySec : 0);
    },
    update(next: VoiceFx): void {
      if (disposed) return;
      current = clampFx(next);
      graph.update(current);
      syncPitch();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        input.disconnect();
      } catch {
        // 연결이 없었다
      }
      if (pitch) pitch.release();
      pitch = null;
      graph.dispose();
    },
  };
}
