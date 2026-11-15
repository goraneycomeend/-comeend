import { describe, expect, it } from 'vitest';
import { BASE_VOICE_IDS, LANGS } from '../src/core/types';

describe('계약 상수', () => {
  it('기본 보이스는 10개이고 앞 5개가 여성 음역, 뒤 5개가 남성 음역이다', () => {
    expect(BASE_VOICE_IDS).toHaveLength(10);
    expect(new Set(BASE_VOICE_IDS).size).toBe(10);
    expect(BASE_VOICE_IDS.slice(0, 5).every((id) => id.startsWith('F'))).toBe(true);
    expect(BASE_VOICE_IDS.slice(5).every((id) => id.startsWith('M'))).toBe(true);
  });

  it('언어 코드는 겹치지 않고 한국어·영어·일본어가 들어 있다', () => {
    expect(new Set(LANGS).size).toBe(LANGS.length);
    expect(LANGS).toEqual(expect.arrayContaining(['ko', 'en', 'ja']));
  });
});
