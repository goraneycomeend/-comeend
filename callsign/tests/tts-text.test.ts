import { describe, expect, it } from 'vitest';

import {
  PAUSE_SEC,
  chunkText,
  cleanText,
  maxChunkLength,
  pauseAfter,
  planChunks,
  preprocessText,
  tokenize,
} from '../src/core/tts/index.ts';

/** 모델은 한글을 자모로 풀어서 받는다 */
const nfkd = (s: string): string => s.normalize('NFKD');

describe('preprocessText', () => {
  it('언어 태그로 감싸고, 문장부호 없이 끝나면 마침표를 붙인다', () => {
    expect(preprocessText('목표 지점 확보', 'ko')).toBe(`<ko>${nfkd('목표 지점 확보')}.</ko>`);
    expect(preprocessText('Target secured', 'en')).toBe('<en>Target secured.</en>');
  });

  it('운율을 좌우하는 문장부호는 그대로 둔다', () => {
    expect(preprocessText('지금 어디야?', 'ko')).toBe(`<ko>${nfkd('지금 어디야')}?</ko>`);
    expect(preprocessText('가자!', 'ko')).toBe(`<ko>${nfkd('가자')}!</ko>`);
    expect(preprocessText('좋았어~', 'ko')).toBe(`<ko>${nfkd('좋았어')}~.</ko>`);
    // 말줄임표는 모델이 아는 마침표 셋으로 풀린다
    expect(preprocessText('글쎄… 모르겠는데', 'ko')).toBe(`<ko>${nfkd('글쎄')}... ${nfkd('모르겠는데')}.</ko>`);
    expect(preprocessText('잠깐, 기다려.', 'ko')).toBe(`<ko>${nfkd('잠깐')}, ${nfkd('기다려')}.</ko>`);
  });

  it('한글 음절을 자모로 푼다(모델 색인에는 완성형 음절이 없다)', () => {
    const out = preprocessText('가', 'ko');
    expect(out).toBe('<ko>가.</ko>');
    expect(out).not.toMatch(/[가-힣]/);
  });

  it('영어 전용 치환은 영어에서만 한다', () => {
    expect(preprocessText('me@base, e.g., here', 'en')).toBe('<en>me at base, for example, here.</en>');
    const ko = preprocessText('주소는 me@base 야', 'ko');
    expect(ko).not.toContain(' at ');
    expect(ko).toContain(nfkd('골뱅이'));
    // 끼워 넣은 말도 자모로 풀려 있어야 한다(완성형 음절은 모델이 모른다)
    expect(ko).not.toMatch(/[\uAC00-\uD7A3]/);
    expect(preprocessText('メールは me@base です', 'ja')).toContain(nfkd('アット'));
    // 한국어 문장 속 'e.g.,' 를 영어 구절로 바꾸지 않는다
    expect(preprocessText('예를 들면 e.g., 이런 것', 'ko')).not.toContain('for example');
  });

  it('표현 태그 셋은 남기고, 그 밖의 <...> 는 지운다', () => {
    const out = preprocessText('<b>진짜</b>? <laugh> 그건 <whisper>좀</whisper> <SIGH> 웃기다 <breath>', 'ko');
    expect(out).toContain('<laugh>');
    expect(out).toContain('<sigh>');
    expect(out).toContain('<breath>');
    expect(out).not.toMatch(/<\/?b>|whisper/);
    // 남은 꺾쇠는 언어 태그와 표현 태그뿐
    expect(out.match(/<[^>]*>/g)).toEqual(['<ko>', '<laugh>', '<sigh>', '<breath>', '</ko>']);
  });

  it('사용자가 넣은 언어 태그나 홑 꺾쇠가 모델 입력의 태그 구조를 깨지 못한다', () => {
    const out = preprocessText('</ko><en>hello 3 < 5 > 2', 'ko');
    expect(out.startsWith('<ko>')).toBe(true);
    expect(out.endsWith('</ko>')).toBe(true);
    expect(out.slice(4, -5)).not.toMatch(/[<>]/);
    // 자리표시자 문자를 직접 넣어도 태그가 생기지 않는다
    expect(preprocessText('안녕', 'ko')).toBe(`<ko>${nfkd('안녕')}.</ko>`);
  });

  it('표현 태그 앞뒤는 한 칸씩 띄운다', () => {
    expect(cleanText('아 진짜?<laugh>웃기다', 'ko')).toBe(`${nfkd('아 진짜')}? <laugh> ${nfkd('웃기다')}`);
    expect(cleanText('<sigh>또야.', 'ko')).toBe(`<sigh> ${nfkd('또야')}.`);
  });

  it('낱자만 이어 쓴 웃음·울음은 표현 태그로 바꾸고, 소리 낼 수 없는 낱자는 버린다', () => {
    expect(cleanText('아 웃겨 ㅋㅋㅋㅋ', 'ko')).toBe(`${nfkd('아 웃겨')} <laugh>`);
    expect(cleanText('ㅎㅎ 그래', 'ko')).toBe(`<laugh> ${nfkd('그래')}`);
    expect(cleanText('힘들다 ㅠㅠ', 'ko')).toBe(`${nfkd('힘들다')} <sigh>`);
    expect(cleanText('ㅇㅋ 알았어', 'ko')).toBe(nfkd('알았어'));
  });

  it('이모지와 장식 기호를 지우고, 기호를 참조 구현과 같이 바꾼다', () => {
    expect(cleanText('좋아 😀👍 가자 ♥', 'ko')).toBe(nfkd('좋아 가자'));
    expect(cleanText('A–B—C_D [E] F|G #H', 'en')).toBe('A-B-C D E F G H');
    // 작은따옴표 앞 띄어쓰기를 붙이는 것까지 참조 구현 그대로다(모델이 그렇게 배웠다)
    expect(cleanText('“quote” ‘single’', 'en')).toBe('"quote"\'single\'');
  });

  it('띄어쓰기와 지나친 문장부호 반복을 정리한다', () => {
    expect(cleanText('안녕   ,   반가워  !', 'ko')).toBe(`${nfkd('안녕')}, ${nfkd('반가워')}!`);
    expect(cleanText('뭐라고???? 진짜!!!!!', 'ko')).toBe(`${nfkd('뭐라고')}?? ${nfkd('진짜')}!!`);
    expect(cleanText('음.......... 글쎄', 'ko')).toBe(`${nfkd('음')}... ${nfkd('글쎄')}`);
    expect(cleanText('줄\n바꿈\t탭', 'ko')).toBe(nfkd('줄 바꿈 탭'));
  });

  it('읽을 글자가 없으면 빈 문자열을 돌려준다', () => {
    expect(preprocessText('', 'ko')).toBe('');
    expect(preprocessText('   \n ', 'ko')).toBe('');
    expect(preprocessText('😀😀', 'ko')).toBe('');
    expect(preprocessText('...!?', 'ko')).toBe('');
    // 표현 태그만 있어도 소리는 난다
    expect(preprocessText('<laugh>', 'ko')).toBe('<ko><laugh>.</ko>');
  });

  it('글자 색인을 주면 모델이 모르는 글자를 미리 빼고 띄어쓰기를 정리한다', () => {
    const indexer = new Int32Array(65536).fill(-1);
    for (const ch of ' .,!?<>/abcdefghijklmnopqrstuvwxyzOK') indexer[ch.codePointAt(0) as number] = 1;
    for (let cp = 0x1100; cp <= 0x11c2; cp++) indexer[cp] = 2;
    expect(preprocessText('확보 完了 OK', 'ko', indexer)).toBe(`<ko>${nfkd('확보')} OK.</ko>`);
    expect(preprocessText('확보 完了.', 'ko', indexer)).toBe(`<ko>${nfkd('확보')}.</ko>`);
    // 낱말 사이에 낀 모르는 글자는 띄어쓰기가 된다(앞뒤 낱말이 붙지 않는다)
    expect(preprocessText('ab※cd', 'en', indexer)).toBe('<en>ab cd.</en>');
    // 모르는 결합 부호는 낱말을 가르지 않고 사라진다
    expect(preprocessText('cafe\u0301 ok', 'en', indexer)).toBe('<en>cafe ok.</en>');
    // 표현 태그는 색인과 상관없이 남는다
    expect(preprocessText('확보 <laugh>', 'ko', indexer)).toBe(`<ko>${nfkd('확보')} <laugh>.</ko>`);
    // 아는 글자가 하나도 없으면 빈 문자열
    expect(preprocessText('完了', 'ko', indexer)).toBe('');
  });

  it('모르는 언어 코드는 거절한다', () => {
    // @ts-expect-error 계약에 없는 언어 코드
    expect(() => preprocessText('hello', 'xx')).toThrow(/언어/);
  });
});

describe('tokenize', () => {
  const indexer = new Int32Array(65536).fill(-1);
  'abc<>/ .'.split('').forEach((ch, i) => {
    indexer[ch.codePointAt(0) as number] = i + 10;
  });
  indexer[0x1100] = 560;
  indexer[0x1161] = 580;

  it('코드포인트를 색인으로 바꾼다', () => {
    expect(tokenize('abc', indexer)).toEqual([10, 11, 12]);
    expect(tokenize('가', indexer)).toEqual([560, 580]);
  });

  it('모델이 모르는 글자(-1)와 색인 범위 밖 글자는 넣지 않는다', () => {
    const ids = tokenize('a가zb😀c\u{2F800}', indexer);
    expect(ids).toEqual([10, 11, 12]);
    expect(ids.every((id) => id >= 0)).toBe(true);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(tokenize('', indexer)).toEqual([]);
  });
});

describe('chunkText', () => {
  const sentence = '지금부터 십 분 안에 저 건물 옥상까지 올라간다.'; // 27자
  const many = Array.from({ length: 12 }, () => sentence).join(' ');

  it('짧은 글은 한 조각 그대로', () => {
    expect(chunkText('  목표 지점 확보. 다음 지시를 기다린다.  ', 'ko')).toEqual(['목표 지점 확보. 다음 지시를 기다린다.']);
    expect(chunkText('', 'ko')).toEqual([]);
    expect(chunkText('😀', 'ko')).toEqual([]);
  });

  it('한국어·일본어는 120자, 그 밖은 300자 한도', () => {
    expect(maxChunkLength('ko')).toBe(120);
    expect(maxChunkLength('ja')).toBe(120);
    expect(maxChunkLength('en')).toBe(300);
    expect(maxChunkLength('de')).toBe(300);
  });

  it('문장 단위로 묶되 한도를 넘기지 않고, 내용을 빠뜨리지 않는다', () => {
    const chunks = chunkText(many, 'ko');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120);
      // 문장 중간에서 끊기지 않는다
      expect(c.endsWith('.')).toBe(true);
      expect(c.startsWith('지금부터')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(many);
    // 한도 안에서 최대한 묶는다(27자 문장 4개 + 띄어쓰기 3 = 111자. 하나 더 넣으면 139자)
    expect(sentence.length).toBe(27);
    expect(chunks[0].length).toBe(111);
  });

  it('영어는 300자까지 묶고 약어 뒤에서 끊지 않는다', () => {
    const en = Array.from({ length: 12 }, (_, i) => `Dr. Kim reached checkpoint ${i + 1} at 5 p.m. sharp.`).join(' ');
    const chunks = chunkText(en, 'en');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(300);
      expect(c.endsWith('Dr.')).toBe(false);
      expect(c.endsWith('sharp.')).toBe(true);
    }
    expect(chunks.join(' ')).toBe(en);
  });

  it('한 문장이 한도를 넘으면 쉼표에서 먼저 끊는다', () => {
    const clause = '왼쪽 계단은 내가 먼저 확인하고 신호를 줄 테니까'; // 26자
    const long = `${Array.from({ length: 8 }, () => clause).join(', ')}.`;
    const chunks = chunkText(long, 'ko');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    for (const c of chunks.slice(0, -1)) expect(c.endsWith(',')).toBe(true);
    expect(chunks.join(' ')).toBe(long);
  });

  it('쉼표도 없으면 띄어쓰기에서 끊고 낱말을 가르지 않는다', () => {
    const words = Array.from({ length: 80 }, (_, i) => `낱말${i}`);
    const long = words.join(' ');
    const chunks = chunkText(long, 'ko');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(120);
    expect(chunks.join(' ').split(' ')).toEqual(words);
  });

  it('숫자 속 쉼표나 원래 띄어쓰기를 바꾸지 않는다', () => {
    const long = `${'가'.repeat(100)} 1,000발 남았다, ${'나'.repeat(100)} 2,500미터 앞.`;
    const chunks = chunkText(long, 'ko');
    expect(chunks.join(' ')).toBe(long);
    expect(chunks.join(' ')).toContain('1,000발');
  });

  it('띄어쓰기가 전혀 없는 긴 글은 글자 수로 끊되 표현 태그를 가르지 않는다', () => {
    const long = `${'가'.repeat(117)}<laugh>${'나'.repeat(150)}`;
    const chunks = chunkText(long, 'ko');
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120);
      // 꺾쇠가 짝이 맞는다
      expect((c.match(/</g) ?? []).length).toBe((c.match(/>/g) ?? []).length);
    }
    expect(chunks.join('')).toBe(long);
  });

  it('문단이 바뀌면 조각도 바뀐다', () => {
    expect(chunkText('첫 문단이다.\n\n둘째 문단이다.', 'ko')).toEqual(['첫 문단이다.', '둘째 문단이다.']);
  });

  it('줄바꿈 하나는 문장 경계로 보고, 문장부호 없이 끝난 줄에 마침표를 붙인다', () => {
    expect(chunkText('하나\n둘\n셋', 'ko')).toEqual(['하나. 둘. 셋']);
    expect(chunkText('정말?\n그래!', 'ko')).toEqual(['정말? 그래!']);
  });

  it('일본어는 띄어쓰기 없이도 문장 끝(。！？)에서 나눈다', () => {
    const s = 'これは長い文章のテストです。';
    const ja = Array.from({ length: 12 }, () => s).join('');
    const chunks = chunkText(ja, 'ja');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120);
      expect(c.endsWith('。')).toBe(true);
    }
    expect(chunks.join('')).toBe(ja);
  });

  it('조합형으로 들어온 한글도 완성형 기준으로 길이를 센다', () => {
    const text = '목표 지점 확보. 다음 지시를 기다린다.';
    expect(chunkText(text.normalize('NFD'), 'ko')).toEqual([text]);
  });
});

describe('조각 사이 쉼', () => {
  it('끝 문장부호에 따라 0.18~0.35초', () => {
    expect(pauseAfter('알았어,')).toBe(PAUSE_SEC.clause);
    expect(pauseAfter('문장부호 없이 끊긴 자리')).toBe(PAUSE_SEC.clause);
    expect(pauseAfter('이렇게 하자:')).toBe(PAUSE_SEC.colon);
    expect(pauseAfter('끝났다.')).toBe(PAUSE_SEC.sentence);
    expect(pauseAfter('終わった。')).toBe(PAUSE_SEC.sentence);
    expect(pauseAfter('진짜?')).toBe(PAUSE_SEC.emphatic);
    expect(pauseAfter('가자!')).toBe(PAUSE_SEC.emphatic);
    expect(pauseAfter('本当？')).toBe(PAUSE_SEC.emphatic);
    expect(pauseAfter('글쎄…')).toBe(PAUSE_SEC.long);
    expect(pauseAfter('글쎄...')).toBe(PAUSE_SEC.long);
    // 닫는 따옴표나 표현 태그는 건너뛰고 본다
    expect(pauseAfter('"가자!"')).toBe(PAUSE_SEC.emphatic);
    expect(pauseAfter('끝났다. <sigh>')).toBe(PAUSE_SEC.sentence);
    for (const v of Object.values(PAUSE_SEC)) {
      expect(v).toBeGreaterThanOrEqual(0.18);
      expect(v).toBeLessThanOrEqual(0.35);
    }
  });

  it('문단 끝은 길게 쉬고, 마지막 조각 뒤에는 쉼이 없다', () => {
    const plan = planChunks('첫 문단이다.\n\n둘째 문단인가?\n\n셋째.', 'ko');
    expect(plan.map((c) => c.text)).toEqual(['첫 문단이다.', '둘째 문단인가?', '셋째.']);
    expect(plan.map((c) => c.pauseSec)).toEqual([PAUSE_SEC.long, PAUSE_SEC.long, 0]);
  });

  it('한 문단 안에서 나뉜 조각은 끝 문장부호를 따른다', () => {
    const q = `${'가'.repeat(100)}?`;
    const s = `${'나'.repeat(100)}.`;
    const plan = planChunks(`${q} ${s} ${q}`, 'ko');
    expect(plan.map((c) => c.pauseSec)).toEqual([PAUSE_SEC.emphatic, PAUSE_SEC.sentence, 0]);
  });

  it('읽을 것이 없는 조각은 계획에서 빠진다', () => {
    const plan = planChunks('안녕.\n\n😀😀\n\n잘 가.', 'ko');
    expect(plan.map((c) => c.text)).toEqual(['안녕.', '잘 가.']);
  });
});
