// 모델에 들어 있는 기본 보이스 10개의 특징.
// 랩에서 "어떤 목소리를 섞을지" 고를 때 보여 주는 이름표와 설명이다.
//
// 숫자는 실제로 합성해서 잰 값이다(한국어 문장 3개 × 테이크 2개, 기본 빠르기, 스텝 8).
// 이름표는 그 숫자(높이, 억양 폭, 말 빠르기, 음색의 밝기)를 말로 옮긴 것이다.
import type { BaseVoiceId } from '../types.ts';

export interface BaseVoiceInfo {
  id: BaseVoiceId;
  /** 음역. high = 높은(여성) 음역, low = 낮은(남성) 음역. 서로 다른 음역을 섞으면 음높이가 한쪽으로 튄다 */
  register: 'high' | 'low';
  /** 짧은 이름표 */
  label: string;
  /** 한 줄 설명 */
  description: string;
  /** 기본 주파수 중앙값(Hz) */
  f0Hz: number;
  /** 억양이 오르내리는 폭(반음). 클수록 말에 굴곡이 많다 */
  intonationSt: number;
  /** 쉼을 뺀 말 빠르기(초당 글자 수) */
  charsPerSec: number;
}

export const BASE_VOICES: Record<BaseVoiceId, BaseVoiceInfo> = {
  F1: {
    id: 'F1', register: 'high', label: '포근하고 차분함',
    description: '중간 높이에 음색이 둥글어요. 서두르지 않고 편안하게 말해요.',
    f0Hz: 192, intonationSt: 8.5, charsPerSec: 5.8,
  },
  F2: {
    id: 'F2', register: 'high', label: '높고 생기 있음',
    description: '가장 높고 억양이 커요. 밝게 통통 튀는 목소리.',
    f0Hz: 224, intonationSt: 11.3, charsPerSec: 6.4,
  },
  F3: {
    id: 'F3', register: 'high', label: '낮고 느긋함',
    description: '낮은 편이고 말이 가장 느려요. 다정하게 들려요.',
    f0Hz: 177, intonationSt: 9.6, charsPerSec: 5.3,
  },
  F4: {
    id: 'F4', register: 'high', label: '또렷하고 빠름',
    description: '억양이 고르고 발음이 또박또박해요. 음색이 밝아요.',
    f0Hz: 196, intonationSt: 6.4, charsPerSec: 6.4,
  },
  F5: {
    id: 'F5', register: 'high', label: '낮고 담담함',
    description: '이 음역에서 가장 낮아요. 힘을 빼고 담담하게 말해요.',
    f0Hz: 172, intonationSt: 7.7, charsPerSec: 6.0,
  },
  M1: {
    id: 'M1', register: 'low', label: '높고 경쾌함',
    description: '낮은 음역 가운데 가장 높고 억양이 커요. 젊고 밝은 목소리.',
    f0Hz: 148, intonationSt: 12.1, charsPerSec: 5.8,
  },
  M2: {
    id: 'M2', register: 'low', label: '낮고 굵음',
    description: '굵고 낮아요. 억양이 잔잔해서 듬직하게 들려요.',
    f0Hz: 97, intonationSt: 7.8, charsPerSec: 6.5,
  },
  M3: {
    id: 'M3', register: 'low', label: '빠르고 선명함',
    description: '말이 가장 빠르고 발음이 선명해요. 기운찬 목소리.',
    f0Hz: 104, intonationSt: 7.3, charsPerSec: 7.7,
  },
  M4: {
    id: 'M4', register: 'low', label: '부드러운 중음',
    description: '중간 높이에 음색이 부드러워요. 차분하게 설명하는 느낌.',
    f0Hz: 123, intonationSt: 10.2, charsPerSec: 6.4,
  },
  M5: {
    id: 'M5', register: 'low', label: '가장 낮고 묵직함',
    description: '가장 낮은 목소리. 느긋하고 묵직해요.',
    f0Hz: 90, intonationSt: 8.9, charsPerSec: 6.2,
  },
};
