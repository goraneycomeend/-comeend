#!/usr/bin/env node
// 기본 요원의 대사를 전부 미리 합성해 public/clips/ 에 mp3 로 담는다.
//
//   node scripts/render-clips.mjs            바뀐 대사만 다시 만든다(키와 테이크가 같으면 건너뛴다)
//   node scripts/render-clips.mjs --force    전부 다시 만든다
//   node scripts/render-clips.mjs --check    만들지 않고, 명단과 클립이 맞는지만 본다(어긋나면 종료 코드 1)
//   node scripts/render-clips.mjs --only karang          한 요원만
//   node scripts/render-clips.mjs --only karang/sample   대사 하나만
//   --threads N   합성에 쓸 스레드 수(기본 2)
//
// 하는 일: 대사 → 음성 합성(Node, onnxruntime-node) → 마무리(앞뒤 무음 정리·음량 맞춤) → mp3(모노 96kbps)
//          → public/clips/<요원 id>/<대사 id>.mp3 와 public/clips/clips.json
// 클립은 효과를 입히기 전의 원음이다. 요원 효과와 무전 효과는 앱이 재생할 때 입힌다.
//
// 앱과 똑같은 TypeScript 코어(src/core)를 쓴다. Vite 로 그 모듈을 읽어 오므로 따로 빌드할 필요가 없다.
// 먼저 `npm run setup` 으로 모델 파일(public/models)을 받아 두어야 한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS_DIR = path.join(APP, 'public', 'models');
const CLIPS_DIR = path.join(APP, 'public', 'clips');
const INDEX_PATH = path.join(CLIPS_DIR, 'clips.json');

const MP3_KBPS = 96;
/** 이 범위를 벗어난 결과는 잘못 만들어진 것으로 본다 */
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 15;
/** 글자당 길이(초)가 이 범위 밖이면 말이 뭉개졌거나 늘어진 것이다 */
const MIN_SEC_PER_CHAR = 0.08;
const MAX_SEC_PER_CHAR = 0.45;

/** 잘못 쓴 옵션처럼, 설명만 보여 주면 되는 오류 */
class UsageError extends Error {}

const USAGE = '사용법: node scripts/render-clips.mjs [--force] [--check] [--only <요원 id>[/<대사 id>]] [--threads N]';

function parseArgs(argv) {
  const args = { force: false, check: false, only: null, threads: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--check') args.check = true;
    else if (a === '--only') args.only = argv[++i] ?? null;
    else if (a === '--threads') args.threads = Math.max(1, Number.parseInt(argv[++i] ?? '2', 10) || 2);
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new UsageError(`모르는 옵션이에요: ${a}`);
  }
  return args;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function fileSize(file) {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return -1;
  }
}

/** 말소리가 되는 글자 수(표현 태그·띄어쓰기·문장부호 제외) */
function spokenChars(text) {
  return [...text.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]/gu, '')].length;
}

/** 앱의 TypeScript 코어를 Vite 로 읽어 온다 */
async function loadCore() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: APP,
    appType: 'custom',
    logLevel: 'error',
    // 개발 서버가 쓰는 캐시와 섞이지 않게 따로 둔다
    cacheDir: path.join(APP, 'node_modules', '.cache', 'callsign-render-clips'),
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  const load = (p) => server.ssrLoadModule(p);
  const [agents, clips, tts, audio] = await Promise.all([
    load('/src/core/agents/index.ts'),
    load('/src/core/clips.ts'),
    load('/src/core/tts/index.ts'),
    load('/src/core/audio/index.ts'),
  ]);
  return { agents, clips, tts, audio, close: () => server.close() };
}

/** 모델 파일을 모아 합성기를 만든다 */
async function createSynth(tts, manifest, threads) {
  const ort = await import('onnxruntime-node');
  const files = await tts.assembleModelFiles(manifest, (p) => fs.readFile(path.join(MODELS_DIR, p)));
  const assets = await tts.buildTtsAssets(ort, files, { sessionOptions: { intraOpNumThreads: threads } });
  return { synth: tts.createSynthesizer(ort, assets), release: () => tts.releaseTtsAssets(assets) };
}

function hasBadSample(samples) {
  for (let i = 0; i < samples.length; i++) if (!Number.isFinite(samples[i])) return true;
  return false;
}

/** 색인을 명단 순서로 정리해 쓴다(차이를 읽기 쉽게) */
async function writeIndex(model, entries, order) {
  const clips = {};
  for (const id of order) if (entries.has(id)) clips[id] = entries.get(id);
  await fs.mkdir(CLIPS_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify({ model, clips }, null, 2) + '\n');
}

/** 색인에 없는 mp3 와 빈 폴더를 지운다 */
async function pruneFiles(keep) {
  const removed = [];
  let dirs;
  try {
    dirs = await fs.readdir(CLIPS_DIR, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(CLIPS_DIR, dir.name);
    for (const name of await fs.readdir(full)) {
      const rel = `${dir.name}/${name}`;
      if (name.endsWith('.mp3') && !keep.has(rel)) {
        await fs.rm(path.join(full, name));
        removed.push(rel);
      }
    }
    if ((await fs.readdir(full)).length === 0) await fs.rmdir(full);
  }
  return removed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  const manifest = await readJson(path.join(MODELS_DIR, 'manifest.json'));
  if (!manifest && !args.check) {
    console.error('모델 파일이 없어요. 먼저 `npm run setup` 을 실행해 주세요. (public/models/manifest.json)');
    return 1;
  }

  const core = await loadCore();
  let engine = null;
  try {
    const { agents, clips, tts, audio } = core;

    const rosterProblems = agents.validateRoster(agents.ROSTER);
    if (rosterProblems.length > 0) {
      console.error('요원 명단에 문제가 있어 멈춥니다:');
      for (const p of rosterProblems) console.error('  - ' + p);
      return 1;
    }

    // 만들 것들
    const jobs = [];
    for (const agent of agents.ROSTER) {
      for (const line of agent.lines) {
        const id = clips.clipId(agent.id, line.id);
        jobs.push({
          id,
          agent,
          line,
          key: clips.clipKey(agent.voice, line),
          take: agents.lineTake(agent.id, line.id),
          file: `${agent.id}/${line.id}.mp3`,
        });
      }
    }
    const order = jobs.map((j) => j.id);
    const wanted = (job) => !args.only || job.agent.id === args.only || job.id === args.only;
    if (args.only && !jobs.some(wanted)) {
      console.error(`--only ${args.only}: 그런 요원이나 대사가 없어요.`);
      return 1;
    }

    const existing = clips.parseClipIndex(await readJson(INDEX_PATH));
    const model = manifest?.id ?? existing.model;
    const entries = new Map();
    const stale = [];
    for (const job of jobs) {
      const entry = existing.clips[job.id];
      const fresh =
        !!entry &&
        existing.model === model &&
        entry.key === job.key &&
        (entry.take ?? 0) === job.take &&
        entry.file === job.file &&
        entry.bytes > 0 &&
        (await fileSize(path.join(CLIPS_DIR, job.file))) === entry.bytes;
      if (entry) entries.set(job.id, entry);
      if (!fresh || (args.force && wanted(job))) stale.push(job);
    }
    const jobIds = new Set(order);
    const orphans = Object.keys(existing.clips).filter((id) => !jobIds.has(id));

    if (args.check) {
      if (stale.length === 0 && orphans.length === 0) {
        console.log(`클립 ${jobs.length}개가 명단과 맞습니다.`);
        return 0;
      }
      for (const job of stale) console.log(`다시 만들어야 함: ${job.id}`);
      for (const id of orphans) console.log(`명단에 없는 클립: ${id}`);
      console.log(`어긋난 클립 ${stale.length + orphans.length}개. \`node scripts/render-clips.mjs\` 로 맞춰 주세요.`);
      return 1;
    }

    const todo = stale.filter(wanted);
    const failed = [];
    if (todo.length > 0) {
      console.log(`대사 ${jobs.length}개 가운데 ${todo.length}개를 만듭니다. (모델 ${model}, 스텝 ${clips.CLIP_STEPS}, 스레드 ${args.threads})`);
      engine = await createSynth(tts, manifest, args.threads);
      const startedAt = Date.now();
      let lastAgent = null;
      for (const job of todo) {
        try {
          const raw = await engine.synth.synthesize(clips.clipRequest(job.agent.voice, job.line, job.take));
          const pcm = audio.finishSpeech(raw);
          const durationSec = pcm.samples.length / pcm.sampleRate;
          const perChar = durationSec / Math.max(1, spokenChars(job.line.text));
          if (hasBadSample(pcm.samples)) throw new Error('숫자가 아닌 값이 섞였어요');
          if (durationSec < MIN_SECONDS || durationSec > MAX_SECONDS) throw new Error(`길이가 이상해요(${durationSec.toFixed(2)}초)`);
          if (perChar < MIN_SEC_PER_CHAR || perChar > MAX_SEC_PER_CHAR) throw new Error(`말 빠르기가 이상해요(글자당 ${perChar.toFixed(3)}초)`);
          if (audio.rms(pcm) < 0.01) throw new Error('소리가 거의 없어요');

          const mp3 = await audio.encodeMp3Bytes(pcm, MP3_KBPS);
          const target = path.join(CLIPS_DIR, job.file);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, mp3);
          entries.set(job.id, {
            key: job.key,
            file: job.file,
            durationSec: Math.round(durationSec * 1000) / 1000,
            bytes: mp3.length,
            take: job.take,
          });
          console.log(`  ${job.id.padEnd(28)} ${durationSec.toFixed(2)}초  ${String(mp3.length).padStart(6)}B  테이크 ${job.take}`);
        } catch (err) {
          failed.push(job.id);
          entries.delete(job.id);
          console.error(`  ${job.id}: 실패 — ${err instanceof Error ? err.message : String(err)}`);
        }
        // 요원 하나가 끝날 때마다 색인을 써 둔다(도중에 멈춰도 만든 것은 남는다)
        if (lastAgent !== null && lastAgent !== job.agent.id) await writeIndex(model, entries, [...order, ...orphans]);
        lastAgent = job.agent.id;
      }
      console.log(`합성 ${todo.length - failed.length}개 완료, ${((Date.now() - startedAt) / 1000).toFixed(1)}초`);
    }

    // 명단에서 빠진 대사의 클립은 지운다(일부만 만드는 중에는 건드리지 않는다)
    let removed = [];
    if (!args.only) {
      for (const id of orphans) entries.delete(id);
      await writeIndex(model, entries, order);
      removed = await pruneFiles(new Set([...entries.values()].map((e) => e.file)));
    } else {
      await writeIndex(model, entries, [...order, ...orphans]);
    }

    let totalBytes = 0;
    let totalSec = 0;
    for (const e of entries.values()) {
      totalBytes += e.bytes;
      totalSec += e.durationSec;
    }
    console.log(
      `클립 ${entries.size}개, ${totalBytes.toLocaleString('en-US')}바이트, ${totalSec.toFixed(1)}초 ` +
        `(새로 만든 것 ${todo.length - failed.length}, 그대로 둔 것 ${jobs.length - todo.length}, 지운 것 ${removed.length})`,
    );
    if (failed.length > 0) {
      console.error(`실패한 대사 ${failed.length}개: ${failed.join(', ')}`);
      return 1;
    }
    return 0;
  } finally {
    if (engine) await engine.release().catch(() => {});
    await core.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (err instanceof UsageError) console.error(`${err.message}\n${USAGE}`);
    else console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exitCode = 1;
  },
);
