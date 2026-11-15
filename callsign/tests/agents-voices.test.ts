// 요원 목소리를 진짜 가중치(public/models)로 합성해 본다: 대표 대사가 제대로 나오는지, 음역이 맞는지,
// 저장소의 클립이 지금 명단으로 다시 만든 것과 같은 길이인지.
// 가중치가 없으면 건너뛴다(`npm run setup` 으로 받는다).

import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ort from 'onnxruntime-node';
import { beforeAll, describe, expect, it } from 'vitest';

import { ROSTER, getSampleLine, lineTake } from '../src/core/agents/index.ts';
import { activeRms, estimateF0, finishSpeech, peak } from '../src/core/audio/index.ts';
import { clipId, clipRequest, findClip, parseClipIndex } from '../src/core/clips.ts';
import type { ClipIndex } from '../src/core/clips.ts';
import { assembleModelFiles, buildTtsAssets, createSynthesizer, releaseTtsAssets } from '../src/core/tts/index.ts';
import type { Synthesizer, TtsAssets } from '../src/core/tts/index.ts';
import { BASE_VOICE_IDS } from '../src/core/types.ts';
import type { AgentDef, PcmAudio } from '../src/core/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.resolve(here, '../public/models');
const CLIPS_DIR = path.resolve(here, '../public/clips');
const hasWeights = existsSync(path.join(MODEL_DIR, 'manifest.json'));

/** 높은 음역(F) 보이스가 주성분인지 */
function isHighRegister(agent: AgentDef): boolean {
  let best = '';
  let bestW = -1;
  for (const id of BASE_VOICE_IDS) {
    const w = agent.voice.blend[id] ?? 0;
    if (w > bestW) {
      best = id;
      bestW = w;
    }
  }
  return best.startsWith('F');
}

describe.skipIf(!hasWeights)('요원 목소리 합성 (실제 가중치)', () => {
  let assets: TtsAssets;
  let synth: Synthesizer;
  let index: ClipIndex;
  /** 요원 id → 대표 대사를 클립과 똑같은 요청으로 합성해 마무리한 음성 */
  const voices = new Map<string, PcmAudio>();

  beforeAll(async () => {
    const manifest: unknown = JSON.parse(await fs.readFile(path.join(MODEL_DIR, 'manifest.json'), 'utf8'));
    const files = await assembleModelFiles(manifest, (p) => fs.readFile(path.join(MODEL_DIR, p)));
    // 클립을 만들 때와 같은 스레드 수
    assets = await buildTtsAssets(ort, files, { sessionOptions: { intraOpNumThreads: 2 } });
    synth = createSynthesizer(ort, assets);
    index = parseClipIndex(JSON.parse(await fs.readFile(path.join(CLIPS_DIR, 'clips.json'), 'utf8')));
    for (const agent of ROSTER) {
      const line = getSampleLine(agent);
      if (!line) throw new Error(`${agent.id}: 대표 대사가 없어요`);
      const raw = await synth.synthesize(clipRequest(agent.voice, line, lineTake(agent.id, line.id)));
      voices.set(agent.id, finishSpeech(raw));
    }
    await releaseTtsAssets(assets);
  }, 180_000);

  it('대표 대사가 요원마다 정상적으로 나온다: 길이, 음량, 숫자가 아닌 값 없음', () => {
    for (const agent of ROSTER) {
      const pcm = voices.get(agent.id) as PcmAudio;
      const line = getSampleLine(agent);
      const chars = [...(line?.text ?? '').replace(/<[^>]*>/g, '').replace(/[^가-힣]/g, '')].length;
      const seconds = pcm.samples.length / pcm.sampleRate;
      expect(pcm.sampleRate, agent.id).toBe(44100);
      expect(pcm.samples.every((v) => Number.isFinite(v)), agent.id).toBe(true);
      expect(seconds, agent.id).toBeGreaterThan(1.2);
      expect(seconds, agent.id).toBeLessThan(7);
      // 글자당 길이: 말이 뭉개지거나 늘어지지 않았다
      expect(seconds / chars, agent.id).toBeGreaterThan(0.11);
      expect(seconds / chars, agent.id).toBeLessThan(0.36);
      // 마무리 뒤 음량은 -18dBFS 근처, 피크는 -1dBFS 아래
      const levelDb = 20 * Math.log10(activeRms(pcm));
      expect(levelDb, agent.id).toBeGreaterThan(-20);
      expect(levelDb, agent.id).toBeLessThan(-16);
      expect(peak(pcm), agent.id).toBeLessThanOrEqual(0.8913);
    }
  });

  it('기본 주파수가 요원의 음역 안에 있다', () => {
    for (const agent of ROSTER) {
      const f0 = estimateF0(voices.get(agent.id) as PcmAudio);
      // 대사 하나로 잰 값이다. 느낌표가 있는 대사는 높게, 한숨 섞인 대사는 낮게 나온다
      if (isHighRegister(agent)) {
        expect(f0, agent.id).toBeGreaterThan(145);
        expect(f0, agent.id).toBeLessThan(340);
      } else {
        expect(f0, agent.id).toBeGreaterThan(70);
        expect(f0, agent.id).toBeLessThan(190);
      }
    }
  });

  it('같은 음역 안에서도 목소리 높이가 넓게 퍼져 있다', () => {
    const spanSt = (group: AgentDef[]): number => {
      const f0s = group.map((a) => estimateF0(voices.get(a.id) as PcmAudio));
      return 12 * Math.log2(Math.max(...f0s) / Math.min(...f0s));
    };
    const high = ROSTER.filter(isHighRegister);
    const low = ROSTER.filter((a) => !isHighRegister(a));
    expect(high).toHaveLength(5);
    expect(low).toHaveLength(5);
    // 가장 높은 요원과 가장 낮은 요원 사이가 반음 4개(높은 음역), 6개(낮은 음역)보다 넓다
    expect(spanSt(high)).toBeGreaterThan(4);
    expect(spanSt(low)).toBeGreaterThan(6);
    // 한 음역에서 가장 높은 요원은 그 음역에서 가장 높은 기본 보이스를 쓰는 요원이다
    const top = (group: AgentDef[]): AgentDef =>
      group.reduce((x, y) => (estimateF0(voices.get(x.id) as PcmAudio) > estimateF0(voices.get(y.id) as PcmAudio) ? x : y));
    expect(top(high).voice.blend.F2 ?? 0).toBeGreaterThan(0.5);
    expect(top(low).voice.blend.M1 ?? 0).toBeGreaterThan(0.5);
  });

  it('저장소의 클립은 지금 명단으로 다시 만든 것과 길이가 같다', () => {
    for (const agent of ROSTER) {
      const line = getSampleLine(agent);
      if (!line) continue;
      const entry = findClip(index, agent, line);
      expect(entry, clipId(agent.id, line.id)).not.toBeNull();
      const pcm = voices.get(agent.id) as PcmAudio;
      // 같은 시드라도 기기(연산 장치)에 따라 끝자리가 달라질 수 있어 조금 여유를 둔다
      expect(Math.abs(pcm.samples.length / pcm.sampleRate - (entry?.durationSec ?? 0)), agent.id).toBeLessThan(0.15);
    }
  });
});
