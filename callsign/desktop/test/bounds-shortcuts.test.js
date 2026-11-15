'use strict';
// 창 자리 검증과 창 단축키.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');

const { DEFAULT_SIZE, MIN_SIZE, clampZoom, defaultBounds, fitWindowBounds, parseWindowState } = require('../src/lib/bounds');
const { shortcutAction } = require('../src/lib/shortcuts');

const FHD = { x: 0, y: 0, width: 1920, height: 1040 };
const LAPTOP = { x: 0, y: 0, width: 1366, height: 728 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };
const LEFT = { x: -1280, y: 100, width: 1280, height: 984 };

const inside = (rect, area) =>
  rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;

describe('fitWindowBounds', () => {
  test('저장된 값이 없으면 주 모니터 가운데에 기본 크기', () => {
    assert.deepEqual(fitWindowBounds(null, [FHD]), { x: 240, y: 70, width: 1440, height: 900 });
    assert.deepEqual(fitWindowBounds(undefined, [FHD, SECOND]), defaultBounds(FHD));
  });
  test('작은 화면에서는 기본 크기를 화면에 맞춘다', () => {
    assert.deepEqual(fitWindowBounds(null, [LAPTOP]), { x: 0, y: 0, width: 1366, height: 728 });
  });
  test('보이는 자리에 있던 창은 그대로 복원한다', () => {
    const saved = { x: 100, y: 50, width: 1200, height: 800 };
    assert.deepEqual(fitWindowBounds(saved, [FHD]), saved);
    const onSecond = { x: 2200, y: 200, width: 1500, height: 900 };
    assert.deepEqual(fitWindowBounds(onSecond, [FHD, SECOND]), onSecond);
    const onLeft = { x: -1200, y: 150, width: 1000, height: 700 };
    assert.deepEqual(fitWindowBounds(onLeft, [FHD, LEFT]), onLeft);
  });
  test('모니터를 뽑아서 창이 화면 밖이 되면 주 모니터 가운데로', () => {
    const onSecond = { x: 2200, y: 200, width: 1500, height: 900 };
    assert.deepEqual(fitWindowBounds(onSecond, [FHD]), defaultBounds(FHD));
    assert.deepEqual(fitWindowBounds({ x: -5000, y: -5000, width: 800, height: 600 }, [FHD]), defaultBounds(FHD));
    assert.deepEqual(fitWindowBounds({ x: 1900, y: 1030, width: 800, height: 600 }, [FHD]), defaultBounds(FHD), '모서리만 살짝 걸친 창');
  });
  test('일부만 걸친 창은 화면 안으로 끌어온다', () => {
    const fitted = fitWindowBounds({ x: 1500, y: 600, width: 1000, height: 800 }, [FHD]);
    assert.deepEqual(fitted, { x: 920, y: 240, width: 1000, height: 800 });
    assert.equal(inside(fitted, FHD), true);
  });
  test('해상도가 줄어 창이 화면보다 크면 화면 크기로 줄인다', () => {
    const fitted = fitWindowBounds({ x: 100, y: 50, width: 1800, height: 1000 }, [LAPTOP]);
    assert.equal(inside(fitted, LAPTOP), true);
    assert.deepEqual(fitted, { x: 0, y: 0, width: 1366, height: 728 });
  });
  test('최소 크기보다 작게 저장된 값은 최소 크기로 키운다', () => {
    const fitted = fitWindowBounds({ x: 100, y: 100, width: 250, height: 200 }, [FHD]);
    assert.equal(fitted.width, MIN_SIZE.width);
    assert.equal(fitted.height, MIN_SIZE.height);
  });
  test('깨진 값은 기본값으로', () => {
    for (const bad of [
      {},
      { x: 0, y: 0 },
      { x: 'a', y: 0, width: 100, height: 100 },
      { x: Number.NaN, y: 0, width: 800, height: 600 },
      { x: 0, y: 0, width: Infinity, height: 600 },
      { x: 0, y: 0, width: -800, height: 600 },
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 1e9, y: 0, width: 800, height: 600 },
      'string',
      42,
      [],
    ]) {
      assert.deepEqual(fitWindowBounds(bad, [FHD]), defaultBounds(FHD), JSON.stringify(bad));
    }
  });
  test('모니터 정보가 없어도 던지지 않는다', () => {
    for (const areas of [[], undefined, null, [{}], [{ x: 0, y: 0, width: 0, height: 0 }]]) {
      const fitted = fitWindowBounds({ x: 10, y: 10, width: 800, height: 600 }, areas);
      assert.ok(fitted.width > 0 && fitted.height > 0);
      assert.ok(fitted.width <= DEFAULT_SIZE.width && fitted.height <= DEFAULT_SIZE.height);
    }
  });
  test('결과는 언제나 정수', () => {
    const fitted = fitWindowBounds({ x: 10.4, y: 20.6, width: 1000.5, height: 700.2 }, [{ x: 0, y: 0, width: 1535.5, height: 863.3 }]);
    for (const v of Object.values(fitted)) assert.equal(Number.isInteger(v), true);
  });
});

describe('parseWindowState', () => {
  test('정상 값', () => {
    const text = JSON.stringify({ bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: true, zoomLevel: 1 });
    assert.deepEqual(parseWindowState(text), { bounds: { x: 1, y: 2, width: 800, height: 600 }, maximized: true, zoomLevel: 1 });
  });
  test('깨졌거나 없는 파일', () => {
    const fallback = { bounds: null, maximized: false, zoomLevel: 0 };
    for (const bad of [undefined, null, '', 'not json', '[]', 'null', '42', '{"bounds":"x"}', 'x'.repeat(5000)]) {
      assert.deepEqual(parseWindowState(bad), fallback, String(bad).slice(0, 20));
    }
  });
  test('일부만 맞는 값', () => {
    assert.deepEqual(parseWindowState('{"maximized":"yes","zoomLevel":"2","bounds":{"x":0,"y":0,"width":-1,"height":5}}'), {
      bounds: null,
      maximized: false,
      zoomLevel: 0,
    });
    assert.equal(parseWindowState('{"zoomLevel":99}').zoomLevel, 3);
    assert.equal(parseWindowState('{"zoomLevel":-99}').zoomLevel, -3);
  });
  test('clampZoom', () => {
    assert.equal(clampZoom(0.5), 0.5);
    assert.equal(clampZoom(10), 3);
    assert.equal(clampZoom(-10), -3);
    assert.equal(clampZoom(Number.NaN), 0);
    assert.equal(clampZoom('1'), 0);
  });
});

describe('shortcutAction', () => {
  const key = (key, code, mods = {}) => ({ type: 'keyDown', key, code, control: false, shift: false, alt: false, meta: false, ...mods });
  const ctrl = { control: true };

  test('남겨 둔 단축키', () => {
    assert.equal(shortcutAction(key('F11', 'F11')), 'toggle-fullscreen');
    assert.equal(shortcutAction(key('F12', 'F12')), 'toggle-devtools');
    assert.equal(shortcutAction(key('I', 'KeyI', { control: true, shift: true })), 'toggle-devtools');
    assert.equal(shortcutAction(key('r', 'KeyR', ctrl)), 'reload');
    assert.equal(shortcutAction(key('F5', 'F5')), 'reload');
    assert.equal(shortcutAction(key('=', 'Equal', ctrl)), 'zoom-in');
    assert.equal(shortcutAction(key('+', 'Equal', { control: true, shift: true })), 'zoom-in');
    assert.equal(shortcutAction(key('+', 'NumpadAdd', ctrl)), 'zoom-in');
    assert.equal(shortcutAction(key('-', 'Minus', ctrl)), 'zoom-out');
    assert.equal(shortcutAction(key('-', 'NumpadSubtract', ctrl)), 'zoom-out');
    assert.equal(shortcutAction(key('0', 'Digit0', ctrl)), 'zoom-reset');
    assert.equal(shortcutAction(key('0', 'Numpad0', ctrl)), 'zoom-reset');
  });
  test('한글 입력 중(key 가 Process)에도 자판 위치로 알아본다', () => {
    assert.equal(shortcutAction(key('Process', 'KeyR', ctrl)), 'reload');
    assert.equal(shortcutAction(key('Process', 'KeyI', { control: true, shift: true })), 'toggle-devtools');
  });
  test('앱 화면의 단축키와 평범한 입력은 건드리지 않는다', () => {
    for (const input of [
      key(' ', 'Space'),
      key('Enter', 'Enter', ctrl),
      key('1', 'Digit1'),
      key('5', 'Digit5'),
      key('0', 'Digit0'),
      key('Escape', 'Escape'),
      key('r', 'KeyR'),
      key('-', 'Minus'),
      key('=', 'Equal'),
      key('c', 'KeyC', ctrl),
      key('v', 'KeyV', ctrl),
      key('a', 'KeyA', ctrl),
      key('z', 'KeyZ', ctrl),
      key('i', 'KeyI', ctrl),
      key('R', 'KeyR', { control: true, shift: true }),
      key('F11', 'F11', { shift: true }),
      key('F12', 'F12', ctrl),
      key('F4', 'F4', { alt: true }),
      key('r', 'KeyR', { control: true, alt: true }),
      key('r', 'KeyR', { meta: true }),
    ]) {
      assert.equal(shortcutAction(input), null, JSON.stringify(input));
    }
  });
  test('키를 뗄 때는 반응하지 않는다', () => {
    assert.equal(shortcutAction({ ...key('F11', 'F11'), type: 'keyUp' }), null);
    assert.equal(shortcutAction(undefined), null);
    assert.equal(shortcutAction({}), null);
  });
});
