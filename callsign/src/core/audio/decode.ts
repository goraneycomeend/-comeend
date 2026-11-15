// 오디오 파일(mp3, wav, m4a, ogg …) → 모노 PCM. 브라우저의 디코더를 쓴다.
import type { PcmAudio } from '../types.ts';

/**
 * 파일 바이트를 풀어 모노 PCM 으로 만든다. 브라우저 전용.
 * @param sampleRate 결과 샘플레이트. 기본 44100 (합성 음성과 같은 값)
 */
export async function decodeAudio(data: ArrayBuffer | Blob, sampleRate = 44100): Promise<PcmAudio> {
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('이 환경에서는 오디오 파일을 열 수 없어요.');
  }
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
  // 디코딩만 쓰는 컨텍스트. 이 샘플레이트로 맞춰서 풀어 준다
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error('이 파일은 열 수 없어요. 소리 파일(mp3, wav, m4a 등)이 맞는지 확인해 주세요.');
  }
  const out = new Float32Array(decoded.length);
  const channels = decoded.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels;
  }
  return { samples: out, sampleRate: decoded.sampleRate };
}
