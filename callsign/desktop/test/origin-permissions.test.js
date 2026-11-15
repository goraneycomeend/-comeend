'use strict';
// 출처 판단과 권한 결정.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { isAllowedDownloadUrl } = require('../src/lib/downloads');
const { APP_ENTRY_URL, APP_ORIGIN, externalHttpsUrl, isAllowedRequestUrl, isAppBlobUrl, isAppUrl, parseAppUrl } = require('../src/lib/origin');
const { allowPermissionCheck, allowPermissionRequest } = require('../src/lib/permissions');

const APP = 'app://callsign/index.html';

/** 앱 출처가 아닌 주소들 */
const FOREIGN = [
  'https://example.com/',
  'http://localhost:4309/',
  'http://127.0.0.1/',
  'file:///C:/Users/me/index.html',
  'app://other/index.html',
  'app://callsign.evil.example/index.html',
  'app://callsign@evil.example/index.html',
  'app://evil.example@callsign/index.html',
  'app://user:pw@callsign/index.html',
  'app://callsign:8080/index.html',
  'apps://callsign/index.html',
  'app:callsign/index.html',
  'app:/callsign/index.html',
  'blob:app://callsign/1234',
  'data:text/html,hi',
  'javascript:alert(1)',
  'about:blank',
  'devtools://devtools/bundled/inspector.html',
  'null',
  '',
  // 호스트 대소문자가 다른 표기. Chromium 은 언제나 소문자로 주므로 다른 표기는 받지 않는다
  'app://CALLSIGN/index.html',
  `app://callsign/${'a'.repeat(5000)}`,
];

describe('앱 출처', () => {
  test('고정된 주소', () => {
    assert.equal(APP_ORIGIN, 'app://callsign');
    assert.equal(APP_ENTRY_URL, 'app://callsign/index.html');
  });
  test('앱 주소를 알아본다', () => {
    for (const url of [APP, 'app://callsign', 'app://callsign/', 'app://callsign/models/manifest.json?x=1#studio', 'APP://callsign/index.html']) {
      assert.equal(isAppUrl(url), true, url);
    }
    assert.equal(parseAppUrl('app://callsign/models/a%20b.bin?x#y').pathname, '/models/a%20b.bin');
  });
  test('다른 주소는 앱 출처가 아니다', () => {
    for (const url of FOREIGN) assert.equal(isAppUrl(url), false, JSON.stringify(url));
    for (const notString of [undefined, null, 1, {}, ['app://callsign/']]) assert.equal(isAppUrl(notString), false);
  });
  test('앱이 만든 blob 주소', () => {
    assert.equal(isAppBlobUrl('blob:app://callsign/3f1c2a44-9d0e-4c57-b2a1-000000000000'), true);
    for (const url of ['blob:https://example.com/1', 'blob:null/1', 'blob:app://other/1', 'blob:', 'app://callsign/x', 'blob:blob:app://callsign/1']) {
      assert.equal(isAppBlobUrl(url), false, url);
    }
  });
  test('바깥 브라우저로 넘기는 것은 https 뿐이고, 정규화한 주소를 넘긴다', () => {
    assert.equal(externalHttpsUrl('https://huggingface.co/Supertone/supertonic-3'), 'https://huggingface.co/Supertone/supertonic-3');
    assert.equal(externalHttpsUrl('HTTPS://Example.COM'), 'https://example.com/');
    assert.equal(externalHttpsUrl('https://example.com/a b"c'), 'https://example.com/a%20b%22c', '공백·따옴표는 인코딩된다');
    assert.equal(externalHttpsUrl(' https://example.com/\n'), 'https://example.com/');
    for (const url of [
      'http://example.com/',
      'file:///C:/Windows/System32/calc.exe',
      'file://server/share/x.exe',
      'app://callsign/index.html',
      'ms-settings:privacy-microphone',
      'mailto:a@example.com',
      'javascript:alert(1)',
      'data:text/html,x',
      'blob:https://example.com/1',
      'https://user:pw@example.com/',
      'https://',
      '//example.com/',
      'example.com',
      '',
      `https://example.com/${'a'.repeat(3000)}`,
    ]) {
      assert.equal(externalHttpsUrl(url), null, url);
    }
    for (const notString of [undefined, null, 1, {}]) assert.equal(externalHttpsUrl(notString), null);
  });
  test('세션이 내보내는 요청: 앱 파일·blob·data·개발자 도구만', () => {
    for (const url of [APP, 'app://callsign/models/x.bin', 'blob:app://callsign/1', 'data:image/svg+xml,%3Csvg/%3E', 'devtools://devtools/bundled/devtools_app.html']) {
      assert.equal(isAllowedRequestUrl(url), true, url);
    }
    for (const url of [
      'https://example.com/',
      'http://127.0.0.1:9/',
      'ws://example.com/',
      'wss://example.com/',
      'ftp://example.com/',
      'file:///etc/passwd',
      'app://other/index.html',
      'blob:https://example.com/1',
      'chrome://settings/',
      '',
      undefined,
    ]) {
      assert.equal(isAllowedRequestUrl(url), false, String(url));
    }
  });
  test('저장은 앱이 만든 blob 과 앱 파일만', () => {
    assert.equal(isAllowedDownloadUrl('blob:app://callsign/1'), true);
    assert.equal(isAllowedDownloadUrl('app://callsign/clips/karang/sample.mp3'), true);
    for (const url of ['https://example.com/a.exe', 'blob:https://example.com/1', 'file:///etc/passwd', 'data:text/plain,x', '']) {
      assert.equal(isAllowedDownloadUrl(url), false, url);
    }
  });
});

describe('권한 요청 (setPermissionRequestHandler)', () => {
  const ask = (permission, extra = {}) => allowPermissionRequest({ permission, requestingUrl: APP, isMainFrame: true, ...extra });

  test('마이크는 소리만 요청할 때 허용', () => {
    assert.equal(ask('media', { mediaTypes: ['audio'] }), true);
  });
  test('카메라가 섞이면 거절', () => {
    assert.equal(ask('media', { mediaTypes: ['video'] }), false);
    assert.equal(ask('media', { mediaTypes: ['audio', 'video'] }), false);
    assert.equal(ask('media', { mediaTypes: ['video', 'audio'] }), false);
  });
  test('종류를 알 수 없는 media 요청은 거절', () => {
    assert.equal(ask('media', { mediaTypes: [] }), false);
    assert.equal(ask('media', {}), false);
    assert.equal(ask('media', { mediaTypes: 'audio' }), false);
    assert.equal(ask('media', { mediaTypes: ['unknown'] }), false);
  });
  test('클립보드와 출력 장치 선택은 허용', () => {
    for (const permission of ['clipboard-sanitized-write', 'clipboard-read', 'speaker-selection']) {
      assert.equal(ask(permission), true, permission);
    }
  });
  test('그 밖의 권한은 전부 거절', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'display-capture',
      'mediaKeySystem',
      'pointerLock',
      'keyboardLock',
      'fullscreen',
      'openExternal',
      'window-management',
      'idle-detection',
      'storage-access',
      'top-level-storage-access',
      'fileSystem',
      'hid',
      'serial',
      'usb',
      'deprecated-sync-clipboard-read',
      'unknown',
      'camera',
      '',
      'constructor',
      'toString',
    ]) {
      assert.equal(ask(permission), false, permission);
    }
  });
  test('앱 출처가 아니면 무엇이든 거절', () => {
    for (const requestingUrl of [...FOREIGN, undefined, null]) {
      assert.equal(allowPermissionRequest({ permission: 'media', requestingUrl, isMainFrame: true, mediaTypes: ['audio'] }), false, String(requestingUrl));
      assert.equal(allowPermissionRequest({ permission: 'clipboard-read', requestingUrl, isMainFrame: true }), false, String(requestingUrl));
    }
  });
  test('하위 프레임의 요청은 거절', () => {
    assert.equal(ask('media', { mediaTypes: ['audio'], isMainFrame: false }), false);
    assert.equal(ask('clipboard-read', { isMainFrame: false }), false);
  });
  test('인자가 이상해도 던지지 않고 거절', () => {
    assert.equal(allowPermissionRequest(undefined), false);
    assert.equal(allowPermissionRequest({}), false);
  });
});

describe('권한 확인 (setPermissionCheckHandler)', () => {
  const check = (permission, mediaType, requestingOrigin = 'app://callsign/') => allowPermissionCheck({ permission, requestingOrigin, mediaType });

  test('소리 장치는 허용, 카메라는 거절', () => {
    assert.equal(check('media', 'audio'), true);
    assert.equal(check('media', 'video'), false);
    assert.equal(check('media', 'unknown'), false);
    assert.equal(check('media', undefined), false);
  });
  test('클립보드와 출력 장치 선택은 허용', () => {
    for (const permission of ['clipboard-sanitized-write', 'clipboard-read', 'speaker-selection']) {
      assert.equal(check(permission), true, permission);
    }
  });
  test('그 밖은 거절', () => {
    for (const permission of ['geolocation', 'notifications', 'midi', 'midiSysex', 'hid', 'serial', 'usb', 'fullscreen', 'display-capture', 'openExternal']) {
      assert.equal(check(permission), false, permission);
    }
  });
  test('출처 표기가 조금 달라도 앱이면 통과, 아니면 거절', () => {
    assert.equal(check('media', 'audio', 'app://callsign'), true);
    for (const requestingOrigin of [...FOREIGN, undefined, null]) {
      assert.equal(allowPermissionCheck({ permission: 'media', requestingOrigin, mediaType: 'audio' }), false, String(requestingOrigin));
      assert.equal(allowPermissionCheck({ permission: 'clipboard-read', requestingOrigin }), false, String(requestingOrigin));
    }
    assert.equal(allowPermissionCheck(undefined), false);
  });
});
