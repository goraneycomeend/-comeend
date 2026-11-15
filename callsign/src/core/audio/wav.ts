// WAV 읽고 쓰기. 쓰기는 16비트 PCM 모노.
import type { PcmAudio } from '../types.ts';

/** 16비트 PCM WAV 파일의 바이트 */
export function encodeWavBytes(a: PcmAudio): Uint8Array<ArrayBuffer> {
  const n = a.samples.length;
  const sampleRate = Math.round(a.sampleRate);
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt 청크 크기
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 모노
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // 초당 바이트
  v.setUint16(32, 2, true); // 블록 정렬
  v.setUint16(34, 16, true); // 비트 수
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, floatToInt16(a.samples[i]), true);
  return bytes;
}

export function encodeWav(a: PcmAudio): Blob {
  return new Blob([encodeWavBytes(a)], { type: 'audio/wav' });
}

/** -1..1 → 16비트 정수. 범위를 넘으면 끝값으로, 숫자가 아니면 0 */
export function floatToInt16(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const s = x < -1 ? -1 : x > 1 ? 1 : x;
  return Math.round(s < 0 ? s * 32768 : s * 32767);
}

/**
 * WAV → 모노 PCM. 8/16/24/32비트 정수와 32비트 실수를 읽고, 채널이 여러 개면 평균한다.
 * 형식이 다르면 한국어 메시지로 오류를 던진다.
 */
export function decodeWav(data: ArrayBuffer | Uint8Array): PcmAudio {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (offset: number): string => String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV 파일이 아니에요.');

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataStart = -1;
  let dataSize = 0;
  let pos = 12;
  while (pos + 8 <= u8.length) {
    const id = tag(pos);
    const size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE 이면 실제 형식은 하위 형식 필드에 있다
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
    } else if (id === 'data') {
      dataStart = body;
      dataSize = Math.min(size, u8.length - body);
      break;
    }
    pos = body + size + (size & 1);
  }
  if (dataStart < 0 || channels < 1 || sampleRate < 1) throw new Error('WAV 파일의 구조를 읽지 못했어요.');
  const isFloat = format === 3 && bits === 32;
  const isInt = format === 1 && (bits === 8 || bits === 16 || bits === 24 || bits === 32);
  if (!isFloat && !isInt) throw new Error(`지원하지 않는 WAV 형식이에요 (형식 ${format}, ${bits}비트).`);

  const bytesPer = bits / 8;
  const frames = Math.floor(dataSize / (bytesPer * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const at = dataStart + (i * channels + c) * bytesPer;
      if (isFloat) sum += v.getFloat32(at, true);
      else if (bits === 16) sum += v.getInt16(at, true) / 32768;
      else if (bits === 8) sum += (u8[at] - 128) / 128;
      else if (bits === 24) sum += ((v.getInt8(at + 2) << 16) | (u8[at + 1] << 8) | u8[at]) / 8388608;
      else sum += v.getInt32(at, true) / 2147483648;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate };
}
