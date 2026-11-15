'use strict';
// 요청 주소의 경로를 웹 폴더 안의 파일 경로로 바꾼다. 폴더 밖으로 나가려는 요청은 전부 거절한다.
//
// 방어는 세 겹이다.
//   1) 경로 조각 검사  — '..', 역슬래시, 드라이브 문자, NUL, Windows 예약 이름 등은 조각 단계에서 거절
//   2) 합친 뒤 검사    — 합친 경로가 웹 폴더 아래인지 다시 확인
//   3) 실제 경로 검사  — 심볼릭 링크를 따라간 실제 위치가 웹 폴더 아래인지 확인 (locateFile)
// 1)·2)는 파일 시스템을 만지지 않는 순수 함수라 path.win32 를 넣어 Windows 규칙으로도 시험할 수 있다.

const fs = require('node:fs');
const nodePath = require('node:path');

/** 주소 경로 길이 상한. 앱 파일 경로는 이보다 훨씬 짧다 */
const MAX_PATH_LENGTH = 1024;

/** Windows 가 장치로 해석하는 이름(확장자가 붙어도 장치다). 예) NUL, con.txt, COM1 */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** 조각 안에 있으면 안 되는 글자: 제어 문자, 경로 구분자, 드라이브·대체 스트림 표시(:), Windows 금지 문자 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f/\\:*?"<>|]/;

/**
 * 디코딩된 경로 조각 하나가 평범한 파일·폴더 이름인지.
 * @param {string} segment
 */
function isSafeSegment(segment) {
  if (typeof segment !== 'string' || segment.length === 0 || segment.length > 255) return false;
  if (segment === '.' || segment === '..') return false;
  if (FORBIDDEN_CHARS.test(segment)) return false;
  // Windows 는 이름 끝의 점과 공백을 떼고 연다('index.html.' == 'index.html'). 다른 이름으로 같은 파일을 가리키지 못하게 한다
  if (/[. ]$/.test(segment)) return false;
  if (WINDOWS_DEVICE_NAME.test(segment)) return false;
  return true;
}

/**
 * 인코딩된 주소 경로('/models/manifest.json')를 조각 배열로 나눈다. 허용할 수 없으면 null.
 * '/' 만 index.html 로 본다. 폴더 주소('/clips/')나 빈 조각('//host/share')은 받지 않는다.
 * @param {string} rawPathname URL.pathname 그대로(퍼센트 인코딩된 상태)
 * @returns {string[] | null}
 */
function splitRequestPath(rawPathname) {
  if (typeof rawPathname !== 'string') return null;
  if (rawPathname.length === 0 || rawPathname.length > MAX_PATH_LENGTH) return null;
  if (rawPathname[0] !== '/') return null;
  if (rawPathname === '/') return ['index.html'];
  const segments = [];
  for (const raw of rawPathname.slice(1).split('/')) {
    let segment;
    try {
      // 한 번만 디코딩한다. '%252e' 는 '%2e' 라는 글자 그대로의 이름이 되고, 다시 풀지 않는다
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (!isSafeSegment(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

/**
 * 조각을 웹 폴더에 이어 붙이고, 결과가 폴더 안인지 다시 확인한다.
 * @param {string} root 웹 폴더의 절대 경로
 * @param {string[]} segments
 * @param {typeof nodePath} [pathImpl] 시험용. path.win32 / path.posix
 * @returns {string | null}
 */
function joinInside(root, segments, pathImpl = nodePath) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  if (!pathImpl.isAbsolute(root)) return null;
  const full = pathImpl.join(root, ...segments);
  return isInside(root, full, pathImpl) ? full : null;
}

/**
 * `target` 이 `root` 폴더 아래(폴더 자신은 제외)에 있는지.
 * @param {string} root
 * @param {string} target
 * @param {typeof nodePath} [pathImpl]
 */
function isInside(root, target, pathImpl = nodePath) {
  const rel = pathImpl.relative(root, target);
  if (rel === '' || pathImpl.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${pathImpl.sep}`);
}

/**
 * 인코딩된 주소 경로 → 웹 폴더 안의 경로. 파일 시스템은 보지 않는다.
 * @param {string} root
 * @param {string} rawPathname
 * @param {typeof nodePath} [pathImpl]
 * @returns {string | null}
 */
function resolveRequestPath(root, rawPathname, pathImpl = nodePath) {
  const segments = splitRequestPath(rawPathname);
  return segments ? joinInside(root, segments, pathImpl) : null;
}

/**
 * 요청 경로에 해당하는 실제 파일을 찾는다. 링크를 따라간 실제 위치가 웹 폴더 밖이면 거절한다.
 * @param {string} realRoot 웹 폴더의 실제 경로(fs.realpath 를 거친 것)
 * @param {string} rawPathname
 * @returns {Promise<{ ok: true, file: string, size: number, mtimeMs: number } | { ok: false, status: 400 | 404 }>}
 */
async function locateFile(realRoot, rawPathname) {
  const candidate = resolveRequestPath(realRoot, rawPathname);
  if (!candidate) return { ok: false, status: 400 };
  let real;
  let stat;
  try {
    real = await fs.promises.realpath(candidate);
    stat = await fs.promises.stat(real);
  } catch {
    return { ok: false, status: 404 };
  }
  if (!isInside(realRoot, real)) return { ok: false, status: 404 };
  if (!stat.isFile()) return { ok: false, status: 404 };
  return { ok: true, file: real, size: stat.size, mtimeMs: stat.mtimeMs };
}

module.exports = { isSafeSegment, splitRequestPath, joinInside, isInside, resolveRequestPath, locateFile };
