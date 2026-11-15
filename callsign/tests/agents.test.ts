// 요원 명단과 검사 함수.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BANNED_NAMES,
  CATEGORIES,
  CATEGORY_LABEL,
  LINE_TAKES,
  ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  ROSTER,
  ROSTER_LIMITS,
  SAMPLE_LINE_ID,
  findBannedName,
  getAgent,
  getSampleLine,
  hasExpressionTag,
  isAgentDef,
  lineTake,
  spokenLength,
  validateAgent,
  validateRoster,
} from '../src/core/agents/index.ts';
import { NEUTRAL_FX, isNaturalFx } from '../src/core/audio/index.ts';
import { assembleModelFiles, cleanText, parseIndexer, preprocessText, tokenize } from '../src/core/tts/index.ts';
import { BASE_VOICE_IDS } from '../src/core/types.ts';
import type { AgentDef, BaseVoiceId } from '../src/core/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, '../public/models');

/** 깊은 복사(검사 함수에 일부러 망가뜨린 요원을 넣어 보려고) */
function clone(agent: AgentDef): AgentDef {
  return JSON.parse(JSON.stringify(agent)) as AgentDef;
}

/** 혼합에서 비율이 가장 큰 기본 보이스 */
function dominantVoice(agent: AgentDef): BaseVoiceId {
  let best: BaseVoiceId = 'F1';
  let bestW = -1;
  for (const id of BASE_VOICE_IDS) {
    const w = agent.voice.blend[id] ?? 0;
    if (w > bestW) {
      best = id;
      bestW = w;
    }
  }
  return best;
}

describe('기본 요원 명단', () => {
  it('10명이고, 명단 전체 검사를 통과한다', () => {
    expect(ROSTER).toHaveLength(10);
    expect(validateRoster(ROSTER)).toEqual([]);
  });

  it('요원 하나하나가 검사를 통과한다(custom 이 아니면 엄격한 규칙)', () => {
    for (const agent of ROSTER) {
      expect(agent.custom).toBeUndefined();
      expect(validateAgent(agent), agent.id).toEqual([]);
      expect(isAgentDef(agent)).toBe(true);
    }
  });

  it('여성 음역 5명, 남성 음역 5명', () => {
    const high = ROSTER.filter((a) => dominantVoice(a).startsWith('F'));
    const low = ROSTER.filter((a) => dominantVoice(a).startsWith('M'));
    expect(high).toHaveLength(5);
    expect(low).toHaveLength(5);
  });

  it('높은 음역과 낮은 음역의 기본 보이스를 섞지 않는다(섞으면 음높이가 한쪽으로 튄다)', () => {
    for (const agent of ROSTER) {
      const registers = new Set(
        BASE_VOICE_IDS.filter((id) => (agent.voice.blend[id] ?? 0) > 0).map((id) => id[0]),
      );
      expect(registers.size, agent.id).toBe(1);
    }
  });

  it('역할 4종이 고르게 있다(각 2~3명)', () => {
    for (const role of ROLES) {
      const n = ROSTER.filter((a) => a.role === role).length;
      expect(n, role).toBeGreaterThanOrEqual(2);
      expect(n, role).toBeLessThanOrEqual(3);
    }
  });

  it('id·콜사인·영문 표기·대표색이 서로 겹치지 않는다', () => {
    for (const pick of [
      (a: AgentDef) => a.id,
      (a: AgentDef) => a.callsign,
      (a: AgentDef) => a.callsignEn,
      (a: AgentDef) => a.color.toLowerCase(),
    ]) {
      expect(new Set(ROSTER.map(pick)).size).toBe(ROSTER.length);
    }
  });

  it('목소리 설정이 서로 다르다(혼합과 빠르기)', () => {
    const signatures = ROSTER.map((a) => JSON.stringify([a.voice.blend, a.voice.speed]));
    expect(new Set(signatures).size).toBe(ROSTER.length);
    // 빠르기가 한 값에 몰려 있지 않다
    expect(new Set(ROSTER.map((a) => a.voice.speed)).size).toBeGreaterThanOrEqual(6);
  });

  it('효과는 사람 말처럼 들리는 범위 안이다', () => {
    for (const agent of ROSTER) {
      const { fx, speed } = agent.voice;
      expect(Object.keys(fx).sort(), agent.id).toEqual(Object.keys(NEUTRAL_FX).sort());
      expect(fx.robot, agent.id).toBe(0);
      expect(fx.radio, agent.id).toBe(0);
      expect(fx.doubler, agent.id).toBe(0);
      expect(Math.abs(fx.pitch), agent.id).toBeLessThanOrEqual(1.5);
      expect(Math.abs(fx.formant), agent.id).toBeLessThanOrEqual(1);
      expect(fx.echo, agent.id).toBeLessThanOrEqual(0.1);
      expect(fx.room, agent.id).toBeLessThanOrEqual(0.25);
      expect(isNaturalFx(fx), agent.id).toBe(true);
      // 높낮이를 옮겼다면 체구도 같은 쪽으로 옮긴다(높낮이만 옮기면 음질이 떨어진다)
      if (fx.pitch !== 0) expect(Math.sign(fx.formant), agent.id).toBe(Math.sign(fx.pitch));
      expect(speed, agent.id).toBeGreaterThanOrEqual(ROSTER_LIMITS.speedMin);
      expect(speed, agent.id).toBeLessThanOrEqual(ROSTER_LIMITS.speedMax);
    }
  });

  it('대표색이 피해야 하는 두 색이 아니다', () => {
    for (const agent of ROSTER) {
      expect(['#ff4655', '#0f1923']).not.toContain(agent.color.toLowerCase());
    }
  });

  it('getAgent 로 찾을 수 있고, 없는 id 는 undefined', () => {
    for (const agent of ROSTER) expect(getAgent(agent.id)).toBe(agent);
    expect(getAgent('nobody')).toBeUndefined();
  });

  it('역할·분류 이름표가 빠짐없이 있다', () => {
    for (const role of ROLES) {
      expect(ROLE_LABEL[role]).toMatch(/[가-힣]/);
      expect(ROLE_DESCRIPTION[role]).toMatch(/[가-힣]/);
    }
    for (const c of CATEGORIES) expect(CATEGORY_LABEL[c]).toMatch(/[가-힣]/);
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...CATEGORIES].sort());
  });
});

describe('기본 대사', () => {
  it('요원마다 14개, 분류마다 2개', () => {
    for (const agent of ROSTER) {
      expect(agent.lines, agent.id).toHaveLength(14);
      for (const c of CATEGORIES) {
        expect(agent.lines.filter((l) => l.category === c), `${agent.id} ${c}`).toHaveLength(2);
      }
    }
  });

  it('요원마다 대표 대사가 하나 있다', () => {
    for (const agent of ROSTER) {
      const samples = agent.lines.filter((l) => l.id === SAMPLE_LINE_ID);
      expect(samples, agent.id).toHaveLength(1);
      expect(getSampleLine(agent)).toBe(samples[0]);
    }
    expect(getSampleLine({ lines: [] })).toBeUndefined();
  });

  it('대사 id 는 요원 안에서 겹치지 않고 파일 이름으로 쓸 수 있다', () => {
    for (const agent of ROSTER) {
      const ids = agent.lines.map((l) => l.id);
      expect(new Set(ids).size, agent.id).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('전부 한국어이고 8~40자, 한글과 기본 문장부호로만 적혀 있다', () => {
    for (const agent of ROSTER) {
      for (const line of agent.lines) {
        const where = `${agent.id}/${line.id}`;
        expect(line.lang, where).toBe('ko');
        const n = spokenLength(line.text);
        expect(n, where).toBeGreaterThanOrEqual(8);
        expect(n, where).toBeLessThanOrEqual(40);
        expect(line.text.replace(/<(?:laugh|breath|sigh)>/g, ''), where).toMatch(/^[가-힣 .,!?…~]+$/);
        // 글이 아니라 말: 문장부호로 끝난다
        expect(line.text.trim(), where).toMatch(/[.!?…~]$/);
      }
    }
  });

  it('표현 태그는 요원당 3개 대사까지만', () => {
    for (const agent of ROSTER) {
      const tagged = agent.lines.filter((l) => hasExpressionTag(l.text));
      expect(tagged.length, agent.id).toBeLessThanOrEqual(3);
    }
  });

  it('같은 대사를 두 요원이 쓰지 않는다', () => {
    const texts = ROSTER.flatMap((a) => a.lines.map((l) => l.text));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('합성기 전처리를 거쳐도 읽을 글이 남는다', () => {
    for (const agent of ROSTER) {
      for (const line of agent.lines) {
        const prepared = preprocessText(line.text, line.lang);
        expect(prepared, `${agent.id}/${line.id}`).toMatch(/^<ko>.+<\/ko>$/);
      }
    }
  });

  it.skipIf(!fs.existsSync(path.join(modelsDir, 'manifest.json')))(
    '모델이 모르는 글자가 대사에 없다',
    async () => {
      const manifest = JSON.parse(fs.readFileSync(path.join(modelsDir, 'manifest.json'), 'utf8')) as {
        files: Record<string, unknown>;
      };
      // 글자 색인 파일만 모은다
      const only = { ...manifest, files: { 'unicode_indexer.bin': manifest.files['unicode_indexer.bin'] } };
      const files = await assembleModelFiles(only, async (p) => new Uint8Array(fs.readFileSync(path.join(modelsDir, p))));
      const indexer = parseIndexer(files['unicode_indexer.bin']);
      for (const agent of ROSTER) {
        for (const line of agent.lines) {
          const where = `${agent.id}/${line.id}`;
          // 모르는 글자를 걸러 내도 글이 그대로다
          expect(cleanText(line.text, 'ko', indexer), where).toBe(cleanText(line.text, 'ko'));
          const prepared = preprocessText(line.text, 'ko', indexer);
          expect(tokenize(prepared, indexer).length, where).toBe([...prepared].length);
        }
      }
    },
  );

  it('테이크 표는 실제로 있는 대사만 가리킨다', () => {
    const known = new Set(ROSTER.flatMap((a) => a.lines.map((l) => `${a.id}/${l.id}`)));
    for (const [id, take] of Object.entries(LINE_TAKES)) {
      expect(known.has(id), id).toBe(true);
      expect(Number.isInteger(take) && take >= 0, id).toBe(true);
    }
    expect(lineTake('nobody', 'nothing')).toBe(0);
    for (const id of known) {
      const [agentId, lineId] = id.split('/');
      expect(lineTake(agentId, lineId)).toBe(LINE_TAKES[id] ?? 0);
    }
  });
});

describe('독창성: 다른 게임 캐릭터 이름을 쓰지 않는다', () => {
  it('명단의 어떤 글에도 대조 목록의 이름이 없다', () => {
    for (const agent of ROSTER) {
      const texts = [
        agent.id,
        agent.callsign,
        agent.callsignEn,
        agent.tagline,
        agent.bio,
        ...agent.traits,
        ...agent.lines.map((l) => l.text),
      ];
      for (const t of texts) expect(findBannedName(t), `${agent.id}: ${t}`).toBeNull();
      // 콜사인은 낱말 일부로도 겹치지 않는다
      const squashed = (agent.callsign + agent.callsignEn + agent.id).toLowerCase();
      for (const name of BANNED_NAMES) {
        if (name.length >= 4 || /[가-힣]/.test(name)) expect(squashed.includes(name), `${agent.id} ~ ${name}`).toBe(false);
      }
    }
  });

  it('findBannedName 은 낱말 단위로 찾는다', () => {
    expect(findBannedName('JETT')).toBe('jett');
    expect(findBannedName('나는 제트야')).toBe('제트');
    expect(findBannedName('세이지는 어디 있어?')).toBe('세이지');
    expect(findBannedName('KAY/O')).toBe('kayo');
    expect(findBannedName('kay-o 출동')).toBe('kayo');
    expect(findBannedName('Night Omen')).toBe('omen');
    // 다른 낱말의 일부는 걸지 않는다
    expect(findBannedName('MESSAGE')).toBeNull();
    expect(findBannedName('네온사인 아래에서')).toBeNull();
    expect(findBannedName('okay, one more')).toBeNull();
    expect(findBannedName('카랑 들어갑니다')).toBeNull();
  });

  it('기본 요원에 그런 이름이 들어가면 검사에서 걸린다', () => {
    const a = clone(ROSTER[0]);
    a.callsign = '제트';
    expect(validateAgent(a).join('\n')).toContain('다른 게임 캐릭터 이름');
    const b = clone(ROSTER[0]);
    b.lines[0].text = '세이지, 어디야? 빨리 와 줘.';
    expect(validateAgent(b).join('\n')).toContain('다른 게임 캐릭터 이름');
  });
});

describe('validateAgent', () => {
  const base = ROSTER[0];

  it('모양이 엉망인 값을 넣어도 오류를 던지지 않고 문제점을 돌려준다', () => {
    for (const bad of [null, undefined, 3, 'agent', [], {}, { id: 'x' }, { voice: 3, lines: 'no' }]) {
      const problems = validateAgent(bad);
      expect(Array.isArray(problems)).toBe(true);
      expect(problems.length).toBeGreaterThan(0);
      expect(isAgentDef(bad)).toBe(false);
    }
  });

  it('id 규칙을 본다', () => {
    for (const id of ['Karang', 'ka rang', '-karang', 'karang-', '카랑', '']) {
      const a = clone(base);
      a.id = id;
      expect(validateAgent(a).join('\n'), id).toContain('id 는 소문자');
    }
  });

  it('대사 id 가 겹치면 걸린다', () => {
    const a = clone(base);
    a.lines[1].id = a.lines[2].id;
    expect(validateAgent(a).join('\n')).toContain('대사 id 가 겹쳐요');
  });

  it('기본 요원은 0장 규칙 3의 범위를 벗어나면 걸린다', () => {
    const cases: Array<[string, (a: AgentDef) => void]> = [
      ['기계음', (a) => (a.voice.fx.robot = 0.1)],
      ['무전기', (a) => (a.voice.fx.radio = 0.2)],
      ['높낮이', (a) => (a.voice.fx.pitch = 2)],
      ['높낮이', (a) => (a.voice.fx.pitch = -1.6)],
      ['체구', (a) => (a.voice.fx.formant = 1.25)],
      ['메아리', (a) => (a.voice.fx.echo = 0.15)],
      ['방 울림', (a) => (a.voice.fx.room = 0.3)],
      ['말 빠르기', (a) => (a.voice.speed = 0.9)],
      ['말 빠르기', (a) => (a.voice.speed = 1.2)],
    ];
    for (const [word, mutate] of cases) {
      const a = clone(base);
      mutate(a);
      const problems = validateAgent(a);
      expect(problems.join('\n'), word).toContain(word);
    }
  });

  it('기본 요원의 대사 규칙: 길이, 분류별 개수, 대표 대사, 태그, 글자', () => {
    const tooShort = clone(base);
    tooShort.lines[3].text = '가자!';
    expect(validateAgent(tooShort).join('\n')).toContain('길이는 8~40자');

    const tooLong = clone(base);
    tooLong.lines[3].text = '아주 길게 늘어지는 말은 무전에서 아무도 끝까지 듣지 않으니까 짧게 끊어서 말하는 편이 훨씬 낫다고 봐.';
    expect(validateAgent(tooLong).join('\n')).toContain('길이는 8~40자');

    const missing = clone(base);
    missing.lines.pop();
    expect(validateAgent(missing).join('\n')).toContain('대사는 2개여야 해요');

    const noSample = clone(base);
    noSample.lines[0].id = 'greeting-9';
    expect(validateAgent(noSample).join('\n')).toContain('대표 대사');

    const badTag = clone(base);
    badTag.lines[2].text = '준비 끝! <cough> 신호만 줘.';
    expect(validateAgent(badTag).join('\n')).toContain('표현 태그는');

    const latin = clone(base);
    latin.lines[2].text = '준비 끝! OK, 신호만 줘.';
    expect(validateAgent(latin).join('\n')).toContain('한글과 기본 문장부호');

    const digits = clone(base);
    digits.lines[2].text = '준비 끝! 3초 뒤에 간다.';
    expect(validateAgent(digits).join('\n')).toContain('한글과 기본 문장부호');

    const manyTags = clone(base);
    for (const l of manyTags.lines.slice(0, 5)) l.text = l.text.replace(/<[^>]+>/g, '') + ' <breath>';
    expect(validateAgent(manyTags).join('\n')).toContain('표현 태그를 쓴 대사는');
  });

  it('혼합 규칙: 모르는 보이스, 음수, 0개, 4개 이상', () => {
    const unknown = clone(base);
    (unknown.voice.blend as Record<string, number>).X9 = 1;
    expect(validateAgent(unknown).join('\n')).toContain('모르는 기본 보이스');

    const negative = clone(base);
    negative.voice.blend = { F1: -1, F2: 1 };
    expect(validateAgent(negative).join('\n')).toContain('0 이상의 숫자');

    const none = clone(base);
    none.voice.blend = { F1: 0 };
    expect(validateAgent(none).join('\n')).toContain('하나 이상');

    const four = clone(base);
    four.voice.blend = { F1: 1, F2: 1, F3: 1, F4: 1 };
    expect(validateAgent(four).join('\n')).toContain('3개까지');
  });

  it('사용자가 만든 요원은 효과를 세게 줘도 되고, 대사 수도 자유다', () => {
    const custom: AgentDef = {
      id: 'my-agent-1',
      callsign: '내 요원',
      callsignEn: 'MY AGENT',
      role: 'support',
      tagline: '',
      bio: '',
      traits: [],
      color: '#88CCAA',
      voice: {
        blend: { F1: 0.5, M2: 0.3, M5: 0.2 },
        speed: 1.3,
        fx: { ...NEUTRAL_FX, pitch: -7, formant: -3, robot: 0.8, radio: 1, echo: 0.6, room: 0.9, doubler: 0.5 },
      },
      lines: [{ id: 'sample', category: 'greeting', text: 'Hello there, 3 2 1 가자!', lang: 'en' }],
      custom: true,
    };
    expect(validateAgent(custom)).toEqual([]);
    expect(isAgentDef(custom)).toBe(true);
    // 대사가 없어도 된다
    expect(validateAgent({ ...custom, lines: [] })).toEqual([]);
    // 같은 요원을 기본 요원 규칙으로 보면 걸린다
    expect(validateAgent(custom, { strict: true }).length).toBeGreaterThan(5);
  });

  it('사용자가 만든 요원도 값의 범위는 지켜야 한다', () => {
    const custom = clone(base);
    custom.custom = true;
    expect(validateAgent(custom)).toEqual([]);

    const pitch = clone(custom);
    pitch.voice.fx.pitch = 20;
    expect(validateAgent(pitch).join('\n')).toContain('높낮이');

    const nan = clone(custom);
    (nan.voice.fx as unknown as Record<string, unknown>).warmth = 'much';
    expect(validateAgent(nan).join('\n')).toContain('온기');

    const missingFx = clone(custom);
    delete (missingFx.voice.fx as Partial<AgentDef['voice']['fx']>).gainDb;
    expect(validateAgent(missingFx).join('\n')).toContain('음량');

    const speed = clone(custom);
    speed.voice.speed = 2;
    expect(validateAgent(speed).join('\n')).toContain('말 빠르기');

    const color = clone(custom);
    color.color = 'red';
    expect(validateAgent(color).join('\n')).toContain('대표색');

    const role = clone(custom);
    (role as unknown as Record<string, unknown>).role = 'duelist';
    expect(validateAgent(role).join('\n')).toContain('역할');

    const longLine = clone(custom);
    longLine.lines[0].text = '가'.repeat(301);
    expect(validateAgent(longLine).join('\n')).toContain('너무 길어요');

    const lang = clone(custom);
    (lang.lines[0] as unknown as Record<string, unknown>).lang = 'xx';
    expect(validateAgent(lang).join('\n')).toContain('언어 코드');
  });
});

describe('validateRoster', () => {
  it('겹치는 id·콜사인·색·혼합을 찾는다', () => {
    const twin = clone(ROSTER[1]);
    twin.id = ROSTER[0].id;
    twin.callsign = ROSTER[0].callsign;
    twin.color = ROSTER[0].color.toUpperCase();
    twin.voice.blend = { ...ROSTER[0].voice.blend };
    const problems = validateRoster([ROSTER[0], twin, ...ROSTER.slice(2)]).join('\n');
    expect(problems).toContain('id이(가)');
    expect(problems).toContain('콜사인이(가)');
    expect(problems).toContain('대표색이(가)');
    expect(problems).toContain('보이스 혼합이(가)');
  });

  it('역할이 비면 알려 준다', () => {
    const problems = validateRoster(ROSTER.filter((a) => a.role !== 'anchor')).join('\n');
    expect(problems).toContain("'anchor'");
  });
});
