// 브라우저 테스트용 진입점. 음향 모듈을 window.__dsp 로 내놓는다.
// 앱 화면과 무관하게 모듈만 검증하려고, 테스트가 이 파일을 앱과 같은 Vite 설정으로 묶어서 페이지에 올린다.
import * as audio from '../../src/core/audio/index.ts';
import { compressorAutoMakeupDb, makeRoomImpulse } from '../../src/core/audio/fxGraph.ts';
import { powerSpectrum } from '../../src/core/audio/analysis.ts';
import { createLivePitch, pitchMakeupDb } from '../../src/core/audio/pitch.ts';
import type { PcmAudio } from '../../src/core/types.ts';
import { getAudioContext, isAudioRunning, resumeAudio } from '../../src/engine/audioContext.ts';
import { MicChanger, MicError, micSupported, toMicError } from '../../src/engine/micChanger.ts';
import { currentPlayback, play, stopAll } from '../../src/engine/player.ts';

/** 테스트용 WAV 를 받아 PCM 으로 */
async function loadFixture(name: string): Promise<PcmAudio> {
  const res = await fetch(new URL(`fixtures/${name}`, document.baseURI));
  if (!res.ok) throw new Error(`fixture ${name}: ${res.status}`);
  return audio.decodeWav(await res.arrayBuffer());
}

/** 파형 만들기 */
function tone(kind: 'sine' | 'saw' | 'noise', hz: number, seconds: number, amp = 0.3, sampleRate = 44100): PcmAudio {
  const n = Math.round(seconds * sampleRate);
  const samples = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    if (kind === 'sine') {
      samples[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    } else if (kind === 'saw') {
      // 배음을 나이퀴스트 아래로만 더한 톱니파
      let v = 0;
      for (let h = 1; h * hz < sampleRate / 2 && h <= 40; h++) v += Math.sin((2 * Math.PI * hz * h * i) / sampleRate) / h;
      samples[i] = amp * 0.6 * v;
    } else {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = amp * ((seed / 4294967296) * 2 - 1);
    }
  }
  return { samples, sampleRate };
}

const harness = {
  audio,
  compressorAutoMakeupDb,
  makeRoomImpulse,
  powerSpectrum,
  createLivePitch,
  pitchMakeupDb,
  getAudioContext,
  isAudioRunning,
  resumeAudio,
  MicChanger,
  MicError,
  micSupported,
  toMicError,
  play,
  stopAll,
  currentPlayback,
  loadFixture,
  tone,
};

export type DspHarness = typeof harness;

declare global {
  interface Window {
    __dsp: DspHarness;
  }
}

window.__dsp = harness;
