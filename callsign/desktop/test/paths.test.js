'use strict';
// 경로 해석: 웹 폴더 밖으로 나가려는 요청은 전부 거절되는지.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, test } = require('node:test');

const { isInside, isSafeSegment, joinInside, locateFile, resolveRequestPath, splitRequestPath } = require('../src/lib/paths');

const POSIX_ROOT = '/opt/callsign/web';
const WIN_ROOT = 'C:\\Program Files\\Callsign\\resources\\web';

/** 폴더 밖으로 나가려는 요청들. 어느 운영체제 규칙으로 봐도 거절되어야 한다 */
const ATTACKS = [
  // 점 조각
  '/../secret.txt',
  '/..',
  '/.',
  '/./index.html',
  '/models/../../secret.txt',
  '/models/..',
  // 인코딩된 점
  '/%2e%2e/secret.txt',
  '/%2E%2E/secret.txt',
  '/.%2e/secret.txt',
  '/%2e./secret.txt',
  '/models/%2e%2e/%2e%2e/secret.txt',
  // 인코딩된 구분자
  '/..%2fsecret.txt',
  '/..%2Fsecret.txt',
  '/models%2f..%2f..%2fsecret.txt',
  '/..%5csecret.txt',
  '/..%5C..%5Cwindows%5Cwin.ini',
  '/models%5c..%5c..%5csecret.txt',
  // 역슬래시 그대로
  '/..\\secret.txt',
  '/models\\..\\..\\secret.txt',
  '\\..\\secret.txt',
  // 절대 경로·드라이브 문자
  '//etc/passwd',
  '/C:/Windows/win.ini',
  '/c:/windows/win.ini',
  '/C:',
  '/C:%5cWindows%5cwin.ini',
  '/C%3A/Windows/win.ini',
  '/C%3a%5cWindows%5cwin.ini',
  'C:/Windows/win.ini',
  'C:\\Windows\\win.ini',
  // UNC·장치 경로
  '//server/share/file.txt',
  '/\\\\server\\share\\file.txt',
  '/%5c%5cserver%5cshare%5cfile.txt',
  '//?/C:/Windows/win.ini',
  '/%5c%5c%3f%5cC:%5cWindows%5cwin.ini',
  '//./pipe/name',
  // NUL 과 제어 문자
  '/index.html%00.png',
  '/index.html\0.png',
  '/%00',
  '/models/manifest.json%0a',
  '/a%09b',
  // Windows 장치 이름, 대체 데이터 스트림, 끝의 점·공백
  '/NUL',
  '/nul.txt',
  '/CON',
  '/models/COM1',
  '/LPT1.bin',
  '/index.html::$DATA',
  '/index.html:stream',
  '/index.html.',
  '/index.html%20',
  '/models./manifest.json',
  // 그 밖의 금지 문자
  '/a*b',
  '/a?b',
  '/a|b',
  '/<script>',
  '/"q"',
  // 형식 오류
  '',
  'index.html',
  '/%',
  '/%zz',
  '/%c0%ae%c0%ae/secret.txt',
  '/models/',
  '/models//manifest.json',
  `/${'a'.repeat(1100)}`,
  `/${'a'.repeat(300)}`,
];

describe('isSafeSegment', () => {
  test('평범한 파일 이름은 통과한다', () => {
    for (const ok of ['index.html', 'tts.worker-DlE11pCx.js', 'vector_estimator.onnx.07.bin', '.well-known', '..data', 'a b.txt', '콜사인.txt', '%2e%2e']) {
      assert.equal(isSafeSegment(ok), true, ok);
    }
  });
  test('위험한 이름은 거절한다', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'C:', 'nul', 'NUL.txt', 'com1', 'COM9.bin', 'a.', 'a ', 'a\0b', 'a\nb', 'a*', 'x'.repeat(256)]) {
      assert.equal(isSafeSegment(bad), false, JSON.stringify(bad));
    }
    assert.equal(isSafeSegment(undefined), false);
    assert.equal(isSafeSegment(42), false);
  });
});

describe('splitRequestPath', () => {
  test('/ 는 index.html', () => {
    assert.deepEqual(splitRequestPath('/'), ['index.html']);
  });
  test('평범한 경로를 조각으로 나눈다', () => {
    assert.deepEqual(splitRequestPath('/models/manifest.json'), ['models', 'manifest.json']);
    assert.deepEqual(splitRequestPath('/assets/index-C_U_CmQR.js'), ['assets', 'index-C_U_CmQR.js']);
    assert.deepEqual(splitRequestPath('/clips/%EC%B9%B4%EB%9E%91/a%20b.mp3'), ['clips', '카랑', 'a b.mp3']);
  });
  test('한 번만 디코딩한다(이중 인코딩은 글자 그대로의 이름이 된다)', () => {
    assert.deepEqual(splitRequestPath('/%252e%252e/secret.txt'), ['%2e%2e', 'secret.txt']);
  });
  test('공격 경로는 전부 null', () => {
    for (const attack of ATTACKS) assert.equal(splitRequestPath(attack), null, JSON.stringify(attack));
  });
  test('문자열이 아니면 null', () => {
    for (const bad of [undefined, null, 1, {}, ['/']]) assert.equal(splitRequestPath(bad), null);
  });
});

describe('resolveRequestPath', () => {
  for (const [label, root, impl] of [
    ['posix', POSIX_ROOT, path.posix],
    ['win32', WIN_ROOT, path.win32],
  ]) {
    test(`${label}: 평범한 경로는 웹 폴더 아래로 풀린다`, () => {
      assert.equal(resolveRequestPath(root, '/', impl), impl.join(root, 'index.html'));
      assert.equal(resolveRequestPath(root, '/models/manifest.json', impl), impl.join(root, 'models', 'manifest.json'));
      assert.equal(resolveRequestPath(root, '/ort/ort-wasm-simd-threaded.wasm', impl), impl.join(root, 'ort', 'ort-wasm-simd-threaded.wasm'));
    });
    test(`${label}: 공격 경로는 전부 거절된다`, () => {
      for (const attack of ATTACKS) assert.equal(resolveRequestPath(root, attack, impl), null, JSON.stringify(attack));
    });
    test(`${label}: 이중 인코딩된 점은 폴더 안의 이상한 이름일 뿐이다`, () => {
      const resolved = resolveRequestPath(root, '/%252e%252e/secret.txt', impl);
      assert.equal(resolved, impl.join(root, '%2e%2e', 'secret.txt'));
      assert.equal(isInside(root, resolved, impl), true);
    });
  }
});

describe('joinInside / isInside (조각 검사를 건너뛰어도 두 번째 방어선이 막는다)', () => {
  test('posix', () => {
    assert.equal(joinInside(POSIX_ROOT, ['..', 'secret.txt'], path.posix), null);
    assert.equal(joinInside(POSIX_ROOT, ['models', '..', '..', 'x'], path.posix), null);
    assert.equal(joinInside(POSIX_ROOT, ['..'], path.posix), null);
    assert.equal(joinInside(POSIX_ROOT, ['.'], path.posix), null, '폴더 자신은 파일이 아니다');
    assert.equal(joinInside(POSIX_ROOT, [], path.posix), null);
    assert.equal(joinInside('relative/root', ['index.html'], path.posix), null, '웹 폴더는 절대 경로여야 한다');
    assert.equal(joinInside(POSIX_ROOT, ['..web-evil'], path.posix), '/opt/callsign/web/..web-evil');
    assert.equal(isInside(POSIX_ROOT, '/opt/callsign/web-evil/index.html', path.posix), false, '이름이 비슷한 옆 폴더');
    assert.equal(isInside(POSIX_ROOT, '/opt/callsign/web', path.posix), false);
    assert.equal(isInside(POSIX_ROOT, '/opt/callsign/web/a/b', path.posix), true);
  });
  test('win32', () => {
    assert.equal(joinInside(WIN_ROOT, ['..', 'app.asar'], path.win32), null);
    assert.equal(joinInside(WIN_ROOT, ['..\\..\\secret'], path.win32), null);
    assert.equal(joinInside(WIN_ROOT, ['a/../../x'], path.win32), null);
    assert.equal(joinInside(WIN_ROOT, ['models', '..\\..\\..\\Windows\\win.ini'], path.win32), null);
    assert.equal(isInside(WIN_ROOT, 'D:\\other\\file.txt', path.win32), false, '다른 드라이브');
    assert.equal(isInside(WIN_ROOT, '\\\\server\\share\\file.txt', path.win32), false, 'UNC');
    assert.equal(isInside(WIN_ROOT, 'C:\\Program Files\\Callsign\\resources\\web-evil\\x', path.win32), false);
    assert.equal(isInside(WIN_ROOT, 'c:\\program files\\callsign\\RESOURCES\\WEB\\index.html', path.win32), true, '대소문자만 다른 같은 폴더');
    assert.equal(isInside(WIN_ROOT, WIN_ROOT, path.win32), false);
  });
});

describe('locateFile (실제 파일 시스템)', () => {
  let base;
  let root;
  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'callsign-paths-')));
    root = path.join(base, 'web');
    fs.mkdirSync(path.join(root, 'models'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>');
    fs.writeFileSync(path.join(root, 'models', 'manifest.json'), '{}');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'secret');
    fs.mkdirSync(path.join(base, 'outside'));
    fs.writeFileSync(path.join(base, 'outside', 'data.bin'), 'outside');
    try {
      fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'link-to-secret.txt'));
      fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'link-dir'), 'dir');
      fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'link-inside.html'));
    } catch {
      // 링크를 만들 권한이 없는 환경(일부 Windows). 링크 시험은 건너뛴다
    }
  });
  after(() => fs.rmSync(base, { recursive: true, force: true }));
  const hasLinks = () => fs.existsSync(path.join(root, 'link-inside.html'));

  test('있는 파일을 찾는다', async () => {
    const found = await locateFile(root, '/models/manifest.json');
    assert.equal(found.ok, true);
    assert.equal(found.file, path.join(root, 'models', 'manifest.json'));
    assert.equal(found.size, 2);
    assert.equal((await locateFile(root, '/')).file, path.join(root, 'index.html'));
  });
  test('없는 파일은 404, 폴더도 404', async () => {
    assert.deepEqual(await locateFile(root, '/nope.txt'), { ok: false, status: 404 });
    assert.deepEqual(await locateFile(root, '/models'), { ok: false, status: 404 });
  });
  test('폴더 밖을 가리키는 경로는 400', async () => {
    for (const attack of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt', '/models/../../secret.txt']) {
      assert.deepEqual(await locateFile(root, attack), { ok: false, status: 400 }, attack);
    }
  });
  test('폴더 밖으로 나가는 심볼릭 링크는 따라가지 않는다', async (t) => {
    if (!hasLinks()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
    assert.deepEqual(await locateFile(root, '/link-to-secret.txt'), { ok: false, status: 404 });
    assert.deepEqual(await locateFile(root, '/link-dir/data.bin'), { ok: false, status: 404 });
  });
  test('폴더 안을 가리키는 링크는 괜찮다', async (t) => {
    if (!hasLinks()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
    const found = await locateFile(root, '/link-inside.html');
    assert.equal(found.ok, true);
    assert.equal(found.file, path.join(root, 'index.html'));
  });
});
