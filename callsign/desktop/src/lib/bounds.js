'use strict';
// 창 크기·위치 기억. 저장해 둔 값이 지금 연결된 모니터에서 보이는 자리인지 확인하고, 아니면 기본값으로 돌린다.

/** 화면 설계 기준(1440×900)에 맞춘 기본 크기 */
const DEFAULT_SIZE = Object.freeze({ width: 1440, height: 900 });
/** 폰 폭 레이아웃까지 줄일 수 있다 */
const MIN_SIZE = Object.freeze({ width: 380, height: 600 });
/** 저장된 창이 모니터와 이만큼은 겹쳐야 "보인다"고 친다 */
const MIN_VISIBLE = Object.freeze({ width: 200, height: 120 });
const ZOOM_RANGE = Object.freeze({ min: -3, max: 3 });

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** @param {unknown} r @returns {r is Rect} */
function isRect(r) {
  return (
    typeof r === 'object' &&
    r !== null &&
    ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k]) && Math.abs(r[k]) < 1e6) &&
    r.width > 0 &&
    r.height > 0
  );
}

function overlap(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** 작업 영역 가운데에 놓은 기본 크기의 창 */
function defaultBounds(workArea) {
  const width = Math.min(DEFAULT_SIZE.width, workArea.width);
  const height = Math.min(DEFAULT_SIZE.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/**
 * 창을 띄울 자리를 정한다.
 * @param {unknown} saved 지난번에 저장한 자리(없거나 깨졌을 수 있다)
 * @param {Rect[]} workAreas 지금 연결된 모니터들의 작업 영역. 첫 번째가 주 모니터
 * @returns {Rect}
 */
function fitWindowBounds(saved, workAreas) {
  const areas = Array.isArray(workAreas) ? workAreas.filter(isRect) : [];
  // 모니터 정보를 못 얻었으면 위치는 운영체제에 맡길 수 없으니 흔한 화면 크기를 가정한다
  const primary = areas[0] ?? { x: 0, y: 0, width: 1280, height: 720 };
  if (!isRect(saved)) return defaultBounds(primary);

  // 가장 많이 겹치는 모니터를 고른다
  let best = null;
  let bestArea = 0;
  for (const area of areas) {
    const o = overlap(saved, area);
    if (o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height && o.width * o.height > bestArea) {
      best = area;
      bestArea = o.width * o.height;
    }
  }
  // 그 모니터가 지금은 없다(뽑았거나 해상도가 바뀌었다) → 주 모니터 가운데로
  if (!best) return defaultBounds(primary);

  const width = Math.round(clamp(saved.width, Math.min(MIN_SIZE.width, best.width), best.width));
  const height = Math.round(clamp(saved.height, Math.min(MIN_SIZE.height, best.height), best.height));
  return {
    x: Math.round(clamp(saved.x, best.x, best.x + best.width - width)),
    y: Math.round(clamp(saved.y, best.y, best.y + best.height - height)),
    width,
    height,
  };
}

/**
 * 저장 파일 내용을 읽는다. 무엇이 들어 있든 던지지 않는다.
 * @param {string | null | undefined} text
 * @returns {{ bounds: Rect | null, maximized: boolean, zoomLevel: number }}
 */
function parseWindowState(text) {
  const fallback = { bounds: null, maximized: false, zoomLevel: 0 };
  if (typeof text !== 'string' || text.length === 0 || text.length > 4096) return fallback;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (typeof data !== 'object' || data === null) return fallback;
  return {
    bounds: isRect(data.bounds)
      ? { x: data.bounds.x, y: data.bounds.y, width: data.bounds.width, height: data.bounds.height }
      : null,
    maximized: data.maximized === true,
    zoomLevel: clampZoom(data.zoomLevel),
  };
}

/** 확대 단계를 허용 범위로. 숫자가 아니면 0(100%) */
function clampZoom(level) {
  return Number.isFinite(level) ? clamp(level, ZOOM_RANGE.min, ZOOM_RANGE.max) : 0;
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, ZOOM_RANGE, isRect, defaultBounds, fitWindowBounds, parseWindowState, clampZoom };
