'use strict';
// Content-Type, 보안 헤더, Range 해석.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { CONTENT_SECURITY_POLICY, CSP_DIRECTIVES, ISOLATION_HEADERS, baseHeaders } = require('../src/lib/headers');
const { mimeFor } = require('../src/lib/mime');
const { parseRange } = require('../src/lib/range');

describe('mimeFor', () => {
  test('앱이 싣는 파일 종류', () => {
    const expected = {
      'index.html': 'text/html; charset=utf-8',
      'assets/index-CV8Bju66.css': 'text/css; charset=utf-8',
      'assets/index-C_U_CmQR.js': 'text/javascript; charset=utf-8',
      'ort/ort-wasm-simd-threaded.mjs': 'text/javascript; charset=utf-8',
      'ort/ort-wasm-simd-threaded.wasm': 'application/wasm',
      'models/manifest.json': 'application/json; charset=utf-8',
      'models/vector_estimator.onnx.07.bin': 'application/octet-stream',
      'clips/karang/sample.mp3': 'audio/mpeg',
      'a.wav': 'audio/wav',
      'assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2': 'font/woff2',
      'icon.svg': 'image/svg+xml',
      'icon.png': 'image/png',
      'licenses/SUPERTONIC-3-MODEL-LICENSE.txt': 'text/plain; charset=utf-8',
    };
    for (const [file, type] of Object.entries(expected)) assert.equal(mimeFor(file), type, file);
  });
  test('확장자는 대소문자를 가리지 않는다', () => {
    assert.equal(mimeFor('A.WASM'), 'application/wasm');
    assert.equal(mimeFor('C:\\web\\INDEX.HTML'), 'text/html; charset=utf-8');
  });
  test('모르는 확장자와 확장자 없는 파일은 바이너리', () => {
    for (const file of ['a.exe', 'a.unknown', 'noext', '.hidden', 'a.', 'constructor', 'a.__proto__', 'a.toString']) {
      assert.equal(mimeFor(file), 'application/octet-stream', file);
    }
  });
});

describe('보안 헤더', () => {
  test('교차 출처 격리와 nosniff 가 들어 있다', () => {
    const headers = baseHeaders();
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.equal(headers['Cross-Origin-Embedder-Policy'], 'require-corp');
    assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Content-Security-Policy'], CONTENT_SECURITY_POLICY);
    assert.deepEqual(Object.keys(ISOLATION_HEADERS).length, 4);
  });
  test('호출마다 새 객체를 준다(한쪽에서 고쳐도 다른 응답에 번지지 않는다)', () => {
    const a = baseHeaders();
    a['Content-Type'] = 'x';
    assert.equal(baseHeaders()['Content-Type'], undefined);
  });
  test('정책에 원격 주소가 없다', () => {
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /https?:|wss?:|\*/);
    for (const values of Object.values(CSP_DIRECTIVES)) {
      for (const value of values) {
        assert.match(value, /^('none'|'self'|'wasm-unsafe-eval'|'unsafe-inline'|blob:|data:)$/, value);
      }
    }
  });
  test('정책의 핵심 항목', () => {
    const csp = CONTENT_SECURITY_POLICY;
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' blob:(;|$)/);
    assert.doesNotMatch(csp, /'unsafe-eval'/);
    assert.doesNotMatch(csp.replace(/style-src[^;]*/, ''), /'unsafe-inline'/, "'unsafe-inline' 은 style-src 에만");
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /form-action 'none'/);
    assert.match(csp, /worker-src 'self' blob:/);
    assert.match(csp, /connect-src 'self' blob: data:/);
  });
});

describe('parseRange', () => {
  const SIZE = 1000;
  test('헤더가 없으면 전체', () => {
    for (const header of [undefined, null, '']) assert.equal(parseRange(header, SIZE), null);
  });
  test('앞에서부터 / 구간 / 끝에서부터', () => {
    assert.deepEqual(parseRange('bytes=0-', SIZE), { start: 0, end: 999 });
    assert.deepEqual(parseRange('bytes=100-', SIZE), { start: 100, end: 999 });
    assert.deepEqual(parseRange('bytes=100-199', SIZE), { start: 100, end: 199 });
    assert.deepEqual(parseRange('bytes=0-0', SIZE), { start: 0, end: 0 });
    assert.deepEqual(parseRange('bytes=-100', SIZE), { start: 900, end: 999 });
    assert.deepEqual(parseRange(' bytes=5-9 ', SIZE), { start: 5, end: 9 });
  });
  test('끝이 파일보다 길면 파일 끝까지로 줄인다', () => {
    assert.deepEqual(parseRange('bytes=900-5000', SIZE), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-5000', SIZE), { start: 0, end: 999 });
  });
  test('시작이 파일 밖이면 416', () => {
    assert.equal(parseRange('bytes=1000-', SIZE), 'unsatisfiable');
    assert.equal(parseRange('bytes=5000-6000', SIZE), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', SIZE), 'unsatisfiable');
    assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
    assert.equal(parseRange('bytes=-5', 0), 'unsatisfiable');
  });
  test('형식이 틀리거나 지원하지 않는 형태는 무시하고 전체를 보낸다', () => {
    for (const header of [
      'bytes=',
      'bytes=-',
      'bytes=abc-def',
      'bytes=10-5',
      'bytes=0-1,5-9',
      'items=0-5',
      'bytes 0-5',
      'bytes=1.5-9',
      'bytes=-1-5',
      'bytes=0x10-0x20',
      'bytes=99999999999999999999-',
      `bytes=0-${'9'.repeat(80)}`,
    ]) {
      assert.equal(parseRange(header, SIZE), null, header);
    }
    assert.equal(parseRange(['bytes=0-1'], SIZE), null);
    assert.equal(parseRange('bytes=0-1', Number.NaN), null);
    assert.equal(parseRange('bytes=0-1', -1), null);
  });
});
