// MP3 인코딩(모노). 순수 JS 인코더라 브라우저와 Node 양쪽에서 같은 코드로 돈다.
import type { PcmAudio } from '../types.ts';
import { resample } from './resample.ts';
import { floatToInt16 } from './wav.ts';

/** MP3 가 담을 수 있는 샘플레이트 */
const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/** MPEG 프레임 하나의 샘플 수(MPEG-1 Layer III) */
const FRAME_SAMPLES = 1152;

/**
 * MP3 파일의 바이트. 기본 96kbps.
 * 샘플레이트가 MP3 규격에 없으면(예: 96kHz 로 녹음한 마이크) 가까운 규격 값으로 바꿔서 담는다.
 */
export async function encodeMp3Bytes(a: PcmAudio, kbps = 96): Promise<Uint8Array<ArrayBuffer>> {
  let src = a;
  const rate = Math.round(a.sampleRate);
  if (!MP3_RATES.includes(rate)) {
    const target = rate > 46000 ? 48000 : rate > 38000 ? 44100 : MP3_RATES.find((r) => r >= rate) ?? 48000;
    src = resample(a, target);
  }
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, Math.round(src.sampleRate), kbps);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const push = (part: Uint8Array): void => {
    if (part.length > 0) {
      // 인코더가 내부 버퍼를 다시 쓸 수 있어서 복사해 둔다
      const copy = new Uint8Array(part);
      chunks.push(copy);
      total += copy.length;
    }
  };

  const block = FRAME_SAMPLES * 16;
  const pcm = new Int16Array(block);
  for (let at = 0; at < src.samples.length; at += block) {
    const n = Math.min(block, src.samples.length - at);
    for (let i = 0; i < n; i++) pcm[i] = floatToInt16(src.samples[at + i]);
    push(encoder.encodeBuffer(n === block ? pcm : pcm.subarray(0, n)));
  }
  push(encoder.flush());

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function encodeMp3(a: PcmAudio, kbps = 96): Promise<Blob> {
  return new Blob([await encodeMp3Bytes(a, kbps)], { type: 'audio/mpeg' });
}
