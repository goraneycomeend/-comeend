#!/usr/bin/env node
// onnxruntime-web 의 wasm 런타임을 public/ort/ 로 복사한다.
//
// 브라우저에서 CPU(wasm)로만 돌리므로 필요한 것은 두 개뿐이다.
//   ort-wasm-simd-threaded.wasm   런타임 본체
//   ort-wasm-simd-threaded.mjs    wasm 을 불러오는 접착 코드
// WebGPU 용(.jsep / .asyncify / .jspi)은 쓰지 않고, 15MB 를 넘어서 싣지도 못한다.
// 앱은 실행할 때 ort.env.wasm.wasmPaths 를 이 폴더로 잡는다.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(APP_DIR, 'public', 'ort');

const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

/** 정적 호스팅의 파일당 용량 제한. 이보다 작아야 한다 */
const MAX_FILE_BYTES = 15_000_000;

const log = (msg) => console.log(`[ort] ${msg}`);
const num = (n) => n.toLocaleString('en-US');

function main() {
  const require = createRequire(import.meta.url);
  // 패키지가 package.json 을 exports 로 내놓지 않아서, 내놓은 wasm 경로로 dist 폴더를 찾는다
  const distDir = path.dirname(require.resolve(`onnxruntime-web/${FILES[0]}`));
  const { version } = JSON.parse(fs.readFileSync(path.join(distDir, '..', 'package.json'), 'utf8'));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // 예전에 복사해 둔 다른 파일이 남아 있으면 치운다
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!FILES.includes(name)) fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
  }

  log(`onnxruntime-web ${version} → ${path.relative(APP_DIR, OUT_DIR)}`);
  const tooBig = [];
  for (const name of FILES) {
    const from = path.join(distDir, name);
    const to = path.join(OUT_DIR, name);
    fs.copyFileSync(from, to);
    const size = fs.statSync(to).size;
    const ok = size < MAX_FILE_BYTES;
    if (!ok) tooBig.push(name);
    log(`${name.padEnd(30)} ${num(size).padStart(11)}B  ${ok ? '제한 안쪽' : '제한 초과!'}`);
  }

  if (tooBig.length) {
    throw new Error(
      `${tooBig.join(', ')} 가 ${num(MAX_FILE_BYTES)}바이트 이상입니다. 이대로는 올릴 수 없으니 onnxruntime-web 버전을 확인하세요.`,
    );
  }
  log(`완료: 파일 ${FILES.length}개, 모두 ${num(MAX_FILE_BYTES)}바이트 미만`);
}

try {
  main();
} catch (err) {
  console.error(`[ort] 오류: ${err.message}`);
  process.exitCode = 1;
}
