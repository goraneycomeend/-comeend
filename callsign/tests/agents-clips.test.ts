// 클립 키·색인, 그리고 저장소에 담긴 클립이 명단과 맞는지.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROSTER, lineTake } from '../src/core/agents/index.ts';
import { NEUTRAL_FX } from '../src/core/audio/index.ts';
import {
  CLIP_STEPS,
  clipId,
  clipKey,
  clipRequest,
  clipSeed,
  clipUrl,
  emptyClipIndex,
  findClip,
  loadClipIndex,
  parseClipIndex,
} from '../src/core/clips.ts';
import type { ClipIndex } from '../src/core/clips.ts';
import type { AgentLine, AgentVoice } from '../src/core/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const clipsDir = path.resolve(here, '../public/clips');
const modelsDir = path.resolve(here, '../public/models');

const voice: AgentVoice = { blend: { F1: 0.7, F3: 0.3 }, speed: 1.05, fx: { ...NEUTRAL_FX } };
const line: AgentLine = { id: 'sample', category: 'greeting', text: '준비됐어. 신호만 줘.', lang: 'ko' };

describe('clipKey', () => {
  it('16진수 16자이고, 같은 입력이면 언제나 같다', () => {
    const key = clipKey(voice, line);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(clipKey({ ...voice, blend: { ...voice.blend } }, { ...line })).toBe(key);
    // 다른 실행·다른 기기에서도 같아야 하므로 값을 못 박아 둔다
    expect(clipKey({ blend: { F1: 1 }, speed: 1, fx: { ...NEUTRAL_FX } }, { ...line, text: '가자.' })).toBe(
      '8717f0ec8870e525',
    );
  });

  it('효과, 대사 id, 분류는 키에 들어가지 않는다(클립은 효과 전의 원음)', () => {
    const key = clipKey(voice, line);
    expect(clipKey({ ...voice, fx: { ...NEUTRAL_FX, radio: 1, pitch: 3, room: 0.2 } }, line)).toBe(key);
    expect(clipKey(voice, { ...line, id: 'other-1', category: 'victory' })).toBe(key);
  });

  it('글, 언어, 혼합, 빠르기가 바뀌면 키도 바뀐다', () => {
    const key = clipKey(voice, line);
    expect(clipKey(voice, { ...line, text: '준비됐어. 신호만 줘!' })).not.toBe(key);
    expect(clipKey(voice, { ...line, lang: 'ja' })).not.toBe(key);
    expect(clipKey({ ...voice, speed: 1.06 }, line)).not.toBe(key);
    expect(clipKey({ ...voice, blend: { F1: 0.6, F3: 0.4 } }, line)).not.toBe(key);
    expect(clipKey({ ...voice, blend: { F1: 0.7, F4: 0.3 } }, line)).not.toBe(key);
  });

  it('비율만 같으면 적는 방식이 달라도 같은 키', () => {
    const key = clipKey(voice, line);
    expect(clipKey({ ...voice, blend: { F3: 3, F1: 7 } }, line)).toBe(key);
    expect(clipKey({ ...voice, blend: { F1: 0.7, F3: 0.3, M2: 0 } }, line)).toBe(key);
    // 조합형으로 적은 글도 같은 글이다
    expect(clipKey(voice, { ...line, text: line.text.normalize('NFD') })).toBe(key);
  });

  it('쓸 수 없는 혼합이어도 오류를 던지지 않는다', () => {
    expect(clipKey({ ...voice, blend: {} }, line)).toMatch(/^[0-9a-f]{16}$/);
    expect(clipKey({ ...voice, blend: {} }, line)).not.toBe(clipKey(voice, line));
  });
});

describe('clipSeed · clipRequest', () => {
  it('시드는 키와 테이크로 정해지는 32비트 정수', () => {
    const key = clipKey(voice, line);
    const seed = clipSeed(key);
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
    expect(clipSeed(key, 0)).toBe(seed);
    expect(clipSeed(key, 1)).not.toBe(seed);
    expect(clipSeed(key, 2)).not.toBe(clipSeed(key, 1));
    expect(clipSeed(clipKey(voice, { ...line, text: '다른 말이야.' }))).not.toBe(seed);
  });

  it('합성 요청은 요원 목소리와 대사를 그대로 담는다', () => {
    const req = clipRequest(voice, line, 2);
    expect(req).toEqual({
      text: line.text,
      lang: 'ko',
      blend: voice.blend,
      speed: 1.05,
      steps: CLIP_STEPS,
      seed: clipSeed(clipKey(voice, line), 2),
    });
    expect(clipRequest(voice, line).seed).toBe(clipSeed(clipKey(voice, line), 0));
  });
});

describe('클립 색인', () => {
  const index: ClipIndex = {
    model: 'm',
    clips: {
      'a1/sample': { key: clipKey(voice, line), file: 'a1/sample.mp3', durationSec: 1.5, bytes: 1000, take: 1 },
    },
  };

  it('parseClipIndex 는 어긋난 항목을 버린다', () => {
    const parsed = parseClipIndex({
      model: 'm',
      clips: {
        ok: { key: 'k', file: 'a/b.mp3', durationSec: 1.2, bytes: 10, take: 2 },
        noTake: { key: 'k', file: 'a/c.mp3', durationSec: 1, bytes: 5 },
        noKey: { file: 'a/b.mp3' },
        noFile: { key: 'k' },
        escape: { key: 'k', file: '../secret.mp3' },
        absolute: { key: 'k', file: '/etc/passwd' },
        remote: { key: 'k', file: 'https://example.com/a.mp3' },
        notObject: 3,
      },
    });
    expect(Object.keys(parsed.clips).sort()).toEqual(['noTake', 'ok']);
    expect(parsed.clips.ok).toEqual({ key: 'k', file: 'a/b.mp3', durationSec: 1.2, bytes: 10, take: 2 });
    expect(parsed.clips.noTake.take).toBeUndefined();
    expect(parsed.model).toBe('m');
    for (const bad of [null, 3, 'x', [], { clips: 3 }]) expect(parseClipIndex(bad)).toEqual(emptyClipIndex());
  });

  it('loadClipIndex 는 폴더 주소에서 clips.json 을 받는다(끝의 / 는 없어도 된다)', async () => {
    const asked: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(JSON.stringify(index), { status: 200 });
    }) as typeof fetch;
    expect(await loadClipIndex('https://app.example/sub/clips/', { fetch: fakeFetch })).toEqual(index);
    expect(await loadClipIndex('https://app.example/sub/clips', { fetch: fakeFetch })).toEqual(index);
    expect(await loadClipIndex(new URL('https://app.example/sub/clips/clips.json'), { fetch: fakeFetch })).toEqual(index);
    expect(asked).toEqual(Array(3).fill('https://app.example/sub/clips/clips.json'));
  });

  it('색인이 없거나 깨져 있으면 빈 색인(오류를 던지지 않는다)', async () => {
    const notFound = (async () => new Response('없음', { status: 404 })) as typeof fetch;
    const broken = (async () => new Response('{ 깨진 json', { status: 200 })) as typeof fetch;
    const offline = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    for (const f of [notFound, broken, offline]) {
      expect(await loadClipIndex('https://app.example/clips/', { fetch: f })).toEqual(emptyClipIndex());
    }
    // 주소가 엉터리여도 마찬가지
    expect(await loadClipIndex('clips/', { fetch: notFound })).toEqual(emptyClipIndex());
  });

  it('clipUrl 은 폴더 주소에 파일 경로를 붙인다', () => {
    const entry = index.clips['a1/sample'];
    expect(clipUrl('https://app.example/sub/clips/', entry)).toBe('https://app.example/sub/clips/a1/sample.mp3');
    expect(clipUrl('https://app.example/sub/clips', entry)).toBe('https://app.example/sub/clips/a1/sample.mp3');
    expect(clipUrl('capacitor://localhost/clips/', './a1/sample.mp3')).toBe('capacitor://localhost/clips/a1/sample.mp3');
  });

  it('findClip 은 키가 맞을 때만 클립을 돌려준다', () => {
    const agent = { id: 'a1', voice };
    expect(findClip(index, agent, line)).toBe(index.clips['a1/sample']);
    // 효과만 바꾼 것은 같은 클립
    expect(findClip(index, { id: 'a1', voice: { ...voice, fx: { ...NEUTRAL_FX, radio: 1 } } }, line)).not.toBeNull();
    // 목소리나 글이 바뀌었으면 쓰지 않는다
    expect(findClip(index, { id: 'a1', voice: { ...voice, speed: 0.95 } }, line)).toBeNull();
    expect(findClip(index, agent, { ...line, text: '바꾼 대사야.' })).toBeNull();
    // 색인에 없는 요원·대사
    expect(findClip(index, { id: 'a2', voice }, line)).toBeNull();
    expect(findClip(index, agent, { ...line, id: 'ready-1' })).toBeNull();
    expect(findClip(emptyClipIndex(), agent, line)).toBeNull();
  });

  it('clipId 는 "<요원 id>/<대사 id>"', () => {
    expect(clipId('karang', 'sample')).toBe('karang/sample');
  });
});

describe('저장소에 담긴 클립(public/clips)', () => {
  const indexPath = path.join(clipsDir, 'clips.json');
  const index = parseClipIndex(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
  const jobs = ROSTER.flatMap((agent) => agent.lines.map((l) => ({ agent, line: l, id: clipId(agent.id, l.id) })));

  it('모든 대사에 클립이 있고, 그 밖의 클립은 없다', () => {
    expect(Object.keys(index.clips).sort()).toEqual(jobs.map((j) => j.id).sort());
    expect(jobs).toHaveLength(140);
  });

  it('클립의 키와 테이크가 지금 명단과 맞는다(어긋나면 scripts/render-clips.mjs 를 다시 돌린다)', () => {
    for (const { agent, line: l, id } of jobs) {
      const entry = index.clips[id];
      expect(entry.key, id).toBe(clipKey(agent.voice, l));
      expect(entry.take ?? 0, id).toBe(lineTake(agent.id, l.id));
      expect(entry.file, id).toBe(`${agent.id}/${l.id}.mp3`);
      expect(findClip(index, agent, l), id).toBe(entry);
    }
  });

  it('파일이 있고, 크기가 색인과 같고, mp3 프레임으로 시작한다', () => {
    let total = 0;
    for (const { id } of jobs) {
      const entry = index.clips[id];
      const bytes = fs.readFileSync(path.join(clipsDir, entry.file));
      expect(bytes.length, id).toBe(entry.bytes);
      // MPEG-1 Layer III 프레임 동기 비트
      expect(bytes[0], id).toBe(0xff);
      expect(bytes[1] & 0xe6, id).toBe(0xe2);
      total += bytes.length;
    }
    // 저장소에 넣기에 지나치게 크지 않다
    expect(total).toBeLessThan(8 * 1024 * 1024);
  });

  it('길이가 대사 길이에 맞는다(뭉개지거나 늘어진 클립이 없다)', () => {
    for (const { line: l, id } of jobs) {
      const entry = index.clips[id];
      const chars = [...l.text.replace(/<[^>]*>/g, '').replace(/[^가-힣]/g, '')].length;
      const perChar = entry.durationSec / chars;
      expect(entry.durationSec, id).toBeGreaterThan(0.8);
      expect(entry.durationSec, id).toBeLessThan(9);
      expect(perChar, id).toBeGreaterThan(0.1);
      expect(perChar, id).toBeLessThan(0.4);
      // 96kbps 모노: 초당 12,000바이트 안팎
      expect(entry.bytes / entry.durationSec, id).toBeGreaterThan(9000);
      expect(entry.bytes / entry.durationSec, id).toBeLessThan(15000);
    }
  });

  it.skipIf(!fs.existsSync(path.join(modelsDir, 'manifest.json')))('색인의 모델 id 가 받아 둔 모델과 같다', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(modelsDir, 'manifest.json'), 'utf8')) as { id: string };
    expect(index.model).toBe(manifest.id);
  });
});
