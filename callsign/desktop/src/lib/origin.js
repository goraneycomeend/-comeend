'use strict';
// 앱 문서의 주소. 실행할 때마다 같아야 한다(localStorage 에 사용자가 만든 요원과 설정이 이 출처로 저장된다).

const APP_SCHEME = 'app';
const APP_HOST = 'callsign';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/**
 * 주소가 앱 출처(app://callsign)의 것이면 URL 객체를, 아니면 null 을 돌려준다.
 * 사용자 정보(user@)나 포트가 붙은 변형은 같은 출처로 치지 않는다.
 * @param {unknown} value
 * @returns {URL | null}
 */
function parseAppUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:`) return null;
  if (url.hostname !== APP_HOST || url.port !== '' || url.username !== '' || url.password !== '') return null;
  return url;
}

/** @param {unknown} value */
function isAppUrl(value) {
  return parseAppUrl(value) !== null;
}

/**
 * 앱 출처에서 만든 blob 주소인지. 예) blob:app://callsign/2f6c…
 * @param {unknown} value
 */
function isAppBlobUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:') && isAppUrl(value.slice('blob:'.length));
}

/**
 * 바깥 브라우저로 넘겨도 되는 주소면 정규화한 주소를, 아니면 null 을 돌려준다.
 * https 만 허용한다(file:, 사용자 정의 스킴, http 는 넘기지 않는다). 넘길 때는 받은 문자열이 아니라
 * 여기서 돌려준 값(URL 해석기를 거쳐 공백·따옴표가 인코딩된 것)을 쓴다.
 * @param {unknown} value
 * @returns {string | null}
 */
function externalHttpsUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname === '' || url.username !== '' || url.password !== '') return null;
  return url.href;
}

/**
 * 세션이 내보내도 되는 요청인지(webRequest 단계의 마지막 방어선).
 * 앱 자신의 파일, 앱이 메모리에 만든 데이터(blob:, data:), 개발자 도구 화면만 통과시킨다.
 * http(s)·ws(s)·ftp 같은 네트워크 주소와 file: 은 전부 여기서 끊긴다.
 * @param {unknown} value
 */
function isAllowedRequestUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.startsWith('blob:')) return isAppBlobUrl(value);
  if (value.startsWith('data:') || value.startsWith('devtools://')) return true;
  return isAppUrl(value);
}

module.exports = {
  APP_SCHEME,
  APP_HOST,
  APP_ORIGIN,
  APP_ENTRY_URL,
  parseAppUrl,
  isAppUrl,
  isAppBlobUrl,
  externalHttpsUrl,
  isAllowedRequestUrl,
};
