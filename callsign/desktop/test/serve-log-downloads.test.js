'use strict';
// 파일 서빙(응답 계획 + 스트리밍), 기록 파일, 저장 파일 이름.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const { extensionOf, sanitizeFileName, saveDialogFilters } = require('../src/lib/downloads');
const { CONTENT_SECURITY_POLICY } = require('../src/lib/headers');
const { createLogger } = require('../src/lib/logfile');
const { CHUNK_BYTES, fileBody, planResponse, toResponse } = require('../src/lib/serve');

let base;
let root;
const BIG_SIZE = CHUNK_BYTES * 3 + 12345;
let bigHash;

before(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'callsign-serve-')));
  root = path.join(base, 'web');
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ort'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>콜사인</title>');
  fs.writeFileSync(path.join(root, 'ort', 'a.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  fs.writeFileSync(path.join(root, 'empty.txt'), '');
  const big = crypto.randomBytes(BIG_SIZE);
  bigHash = crypto.createHash('sha256').update(big).digest('hex');
  fs.writeFileSync(path.join(root, 'models', 'big.bin'), big);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
});
after(() => fs.rmSync(base, { recursive: true, force: true }));

const get = (pathname, extra = {}) => planResponse(root, { method: 'GET', pathname, ...extra });

async function readAll(stream) {
  const chunks = [];
  let maxChunk = 0;
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
    maxChunk = Math.max(maxChunk, chunk.byteLength);
  }
  return { data: Buffer.concat(chunks), count: chunks.length, maxChunk };
}

function assertSecurityHeaders(headers) {
  assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
  assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
}

describe('planResponse', () => {
  test('문서: 200, 타입, 길이, 보안 헤더', async () => {
    const plan = await get('/');
    assert.equal(plan.status, 200);
    assert.equal(plan.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(plan.headers['Content-Length'], String(fs.statSync(path.join(root, 'index.html')).size));
    assert.equal(plan.headers['Accept-Ranges'], 'bytes');
    assertSecurityHeaders(plan.headers);
    assert.deepEqual(plan.file, { path: path.join(root, 'index.html'), start: 0, end: plan.headers['Content-Length'] - 1 });
  });
  test('wasm 은 application/wasm', async () => {
    const plan = await get('/ort/a.wasm');
    assert.equal(plan.headers['Content-Type'], 'application/wasm');
    assertSecurityHeaders(plan.headers);
  });
  test('HEAD 도 같은 헤더와 길이', async () => {
    const plan = await planResponse(root, { method: 'HEAD', pathname: '/models/big.bin' });
    assert.equal(plan.status, 200);
    assert.equal(plan.headers['Content-Length'], String(BIG_SIZE));
    assertSecurityHeaders(plan.headers);
    const response = toResponse(plan, 'HEAD');
    assert.equal(response.body, null);
    assert.equal(response.headers.get('content-length'), String(BIG_SIZE));
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  });
  test('GET·HEAD 말고는 405', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT', 'get ', '']) {
      const plan = await planResponse(root, { method, pathname: '/index.html' });
      assert.equal(plan.status, 405, method);
      assert.equal(plan.headers.Allow, 'GET, HEAD');
      assertSecurityHeaders(plan.headers);
      assert.equal(plan.file, undefined);
    }
    assert.equal((await planResponse(root, { method: 'get', pathname: '/index.html' })).status, 200, '메서드는 대소문자 무관');
  });
  test('없는 파일 404, 폴더 밖 400 — 오류 응답에도 보안 헤더', async () => {
    const missing = await get('/nope.js');
    assert.equal(missing.status, 404);
    assertSecurityHeaders(missing.headers);
    for (const attack of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/C:/Windows/win.ini', '//server/share/x', '/index.html%00', '']) {
      const plan = await get(attack);
      assert.equal(plan.status, 400, attack);
      assert.equal(plan.file, undefined);
      assertSecurityHeaders(plan.headers);
    }
  });
  test('Range: 206 과 Content-Range', async () => {
    const plan = await get('/models/big.bin', { range: 'bytes=100-199' });
    assert.equal(plan.status, 206);
    assert.equal(plan.headers['Content-Range'], `bytes 100-199/${BIG_SIZE}`);
    assert.equal(plan.headers['Content-Length'], '100');
    assert.deepEqual(plan.file, { path: path.join(root, 'models', 'big.bin'), start: 100, end: 199 });
    const tail = await get('/models/big.bin', { range: 'bytes=-10' });
    assert.equal(tail.headers['Content-Range'], `bytes ${BIG_SIZE - 10}-${BIG_SIZE - 1}/${BIG_SIZE}`);
    const open = await get('/models/big.bin', { range: 'bytes=0-' });
    assert.equal(open.status, 206);
    assert.equal(open.headers['Content-Length'], String(BIG_SIZE));
  });
  test('Range 가 파일 밖이면 416', async () => {
    const plan = await get('/models/big.bin', { range: `bytes=${BIG_SIZE}-` });
    assert.equal(plan.status, 416);
    assert.equal(plan.headers['Content-Range'], `bytes */${BIG_SIZE}`);
    assert.equal(plan.file, undefined);
    assertSecurityHeaders(plan.headers);
  });
  test('잘못된 Range 는 무시하고 전체(200)', async () => {
    const plan = await get('/models/big.bin', { range: 'bytes=5-1' });
    assert.equal(plan.status, 200);
    assert.equal(plan.headers['Content-Range'], undefined);
  });
  test('빈 파일', async () => {
    const plan = await get('/empty.txt');
    assert.equal(plan.status, 200);
    assert.equal(plan.headers['Content-Length'], '0');
    const response = toResponse(plan, 'GET');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});

describe('fileBody / toResponse', () => {
  test('큰 파일을 조각내어 그대로 흘려보낸다', async () => {
    const { data, count, maxChunk } = await readAll(fileBody(path.join(root, 'models', 'big.bin'), 0, BIG_SIZE - 1));
    assert.equal(data.length, BIG_SIZE);
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), bigHash);
    assert.equal(count, 4, '1MiB 단위로 나뉜다');
    assert.ok(maxChunk <= CHUNK_BYTES);
  });
  test('구간만 읽는다', async () => {
    const whole = fs.readFileSync(path.join(root, 'models', 'big.bin'));
    const start = CHUNK_BYTES - 7;
    const end = CHUNK_BYTES * 2 + 5;
    const { data } = await readAll(fileBody(path.join(root, 'models', 'big.bin'), start, end));
    assert.equal(Buffer.compare(data, whole.subarray(start, end + 1)), 0);
  });
  test('받는 쪽이 끊으면 파일을 닫는다', async () => {
    const stream = fileBody(path.join(root, 'models', 'big.bin'), 0, BIG_SIZE - 1);
    const reader = stream.getReader();
    const first = await reader.read();
    assert.equal(first.done, false);
    await reader.cancel();
    // 닫혔으면 지울 수 있다(Windows 에서는 열려 있는 파일을 지우지 못한다)
    const copy = path.join(root, 'models', 'copy.bin');
    fs.copyFileSync(path.join(root, 'models', 'big.bin'), copy);
    const s2 = fileBody(copy, 0, BIG_SIZE - 1);
    const r2 = s2.getReader();
    await r2.read();
    await r2.cancel();
    fs.rmSync(copy);
    assert.equal(fs.existsSync(copy), false);
  });
  test('읽는 도중 파일이 줄어들면 오류로 끝난다(멈춰 있지 않는다)', async () => {
    const file = path.join(root, 'shrinks.bin');
    fs.writeFileSync(file, Buffer.alloc(100));
    await assert.rejects(readAll(fileBody(file, 0, 999)), /file ended early/);
    await assert.rejects(readAll(fileBody(path.join(root, 'gone.bin'), 0, 10)), /ENOENT/);
  });
  test('toResponse: GET 은 내용, 오류는 짧은 글', async () => {
    const ok = toResponse(await get('/models/big.bin', { range: 'bytes=0-9' }), 'GET');
    assert.equal(ok.status, 206);
    assert.equal((await ok.arrayBuffer()).byteLength, 10);
    const notFound = toResponse(await get('/nope'), 'GET');
    assert.equal(notFound.status, 404);
    assert.equal(await notFound.text(), 'Not Found');
    assert.equal(notFound.headers.get('x-content-type-options'), 'nosniff');
  });
});

describe('기록 파일', () => {
  const clock = () => new Date('2026-01-02T03:04:05.678Z');

  test('한 줄씩 덧붙인다', () => {
    const dir = path.join(base, 'logs-a');
    const log = createLogger(dir, { now: clock });
    log.info('start v0.1.0');
    log.warn('navigation blocked: https://example.com');
    log.error('renderer gone', new Error('boom'));
    const lines = fs.readFileSync(log.file, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '2026-01-02T03:04:05.678Z INFO start v0.1.0');
    assert.match(lines[1], / WARN navigation blocked/);
    assert.match(lines[2], / ERROR renderer gone: Error: boom \| /, '스택은 한 줄로 접는다');
  });
  test('크기를 넘으면 번호를 붙여 넘기고, 오래된 것은 지운다', () => {
    const dir = path.join(base, 'logs-b');
    const log = createLogger(dir, { now: clock, maxBytes: 300, keep: 2 });
    for (let i = 0; i < 40; i++) log.info(`line ${String(i).padStart(3, '0')} ${'x'.repeat(40)}`);
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ['main.1.log', 'main.2.log', 'main.log']);
    for (const f of files) assert.ok(fs.statSync(path.join(dir, f)).size <= 300, f);
    assert.match(fs.readFileSync(path.join(dir, 'main.log'), 'utf8'), /line 039/);
    const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    assert.ok(total <= 900);
  });
  test('이어 쓰기: 다시 열어도 앞 내용이 남는다', () => {
    const dir = path.join(base, 'logs-c');
    createLogger(dir, { now: clock }).info('first run');
    createLogger(dir, { now: clock }).info('second run');
    assert.match(fs.readFileSync(path.join(dir, 'main.log'), 'utf8'), /first run\n.*second run\n$/);
  });
  test('긴 줄은 자르고, 쓸 수 없는 폴더에서도 던지지 않는다', () => {
    const dir = path.join(base, 'logs-d');
    const log = createLogger(dir, { now: clock });
    log.info('y'.repeat(10_000));
    assert.ok(fs.statSync(log.file).size < 2100);
    const blocked = path.join(base, 'not-a-dir');
    fs.writeFileSync(blocked, 'file');
    const broken = createLogger(path.join(blocked, 'logs'), { now: clock });
    assert.doesNotThrow(() => broken.error('x', new Error('y')));
  });
});

describe('저장 파일 이름', () => {
  test('평범한 이름은 그대로', () => {
    assert.equal(sanitizeFileName('콜사인_카랑_목표-지점-확보.wav'), '콜사인_카랑_목표-지점-확보.wav');
    assert.equal(sanitizeFileName('voice.mp3'), 'voice.mp3');
  });
  test('경로와 금지 문자를 걷어낸다', () => {
    assert.equal(sanitizeFileName('../../evil.mp3'), 'evil.mp3');
    assert.equal(sanitizeFileName('..\\..\\Windows\\evil.wav'), 'evil.wav');
    assert.equal(sanitizeFileName('C:\\Users\\me\\a.wav'), 'a.wav');
    assert.equal(sanitizeFileName('a<b>c:d"e|f?g*h.wav'), 'a b c d e f g h.wav');
    assert.equal(sanitizeFileName('a\u0000b\nc.mp3'), 'a b c.mp3');
    assert.equal(sanitizeFileName('.hidden.wav'), 'hidden.wav');
    assert.equal(sanitizeFileName('name.wav. . .'), 'name.wav');
  });
  test('쓸 이름이 남지 않으면 기본 이름', () => {
    for (const bad of ['', '...', '///', 'con.wav', 'NUL.mp3', undefined, null, 42]) {
      assert.match(sanitizeFileName(bad), /^콜사인-음성(\.(wav|mp3))?$/, String(bad));
    }
    assert.equal(sanitizeFileName('.wav'), 'wav');
  });
  test('길이를 줄이고 확장자를 지킨다', () => {
    const name = sanitizeFileName(`${'가'.repeat(400)}.mp3`);
    assert.equal(name.endsWith('.mp3'), true);
    assert.ok(name.length <= 124);
    assert.equal(sanitizeFileName('a.exe;.mp3'), 'a.exe;.mp3');
    assert.equal(sanitizeFileName('a.mp3 .exe'), 'a.mp3.exe');
  });
  test('확장자와 저장 창 파일 종류', () => {
    assert.equal(extensionOf('a.MP3'), 'mp3');
    assert.equal(extensionOf('noext'), '');
    assert.deepEqual(saveDialogFilters('a.wav'), [
      { name: 'WAV 소리 파일', extensions: ['wav'] },
      { name: '모든 파일', extensions: ['*'] },
    ]);
    assert.deepEqual(saveDialogFilters('a.zip')[0], { name: 'ZIP 파일', extensions: ['zip'] });
    assert.deepEqual(saveDialogFilters('noext'), [{ name: '모든 파일', extensions: ['*'] }]);
  });
});
