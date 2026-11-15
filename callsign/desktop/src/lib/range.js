'use strict';
// Range 요청 헤더 해석. 소리 파일을 재생 위치로 건너뛸 때(seek) 브라우저가 보낸다.

/**
 * @param {string | null | undefined} header Range 헤더 값
 * @param {number} size 파일 크기(바이트)
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null}
 *   null = 범위 없이 전체를 보낸다(헤더가 없거나, 형식이 틀렸거나, 여러 구간이라 지원하지 않는 경우)
 *   'unsatisfiable' = 416 으로 답해야 한다
 *   { start, end } = 양 끝을 포함하는 바이트 구간(206)
 */
function parseRange(header, size) {
  if (typeof header !== 'string' || header.length === 0 || header.length > 64) return null;
  if (!Number.isSafeInteger(size) || size < 0) return null;
  // 한 구간만 지원한다. 숫자는 15자리까지(안전한 정수 범위)
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;

  if (first === '') {
    // 'bytes=-N' : 끝에서 N 바이트
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  if (last === '') return { start, end: size - 1 };
  const end = Number(last);
  // 끝이 시작보다 앞이면 잘못된 헤더다. 무시하고 전체를 보낸다
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

module.exports = { parseRange };
