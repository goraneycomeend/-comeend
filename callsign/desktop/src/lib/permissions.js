'use strict';
// 권한 판단. 앱 출처(app://callsign)의 화면에만, 아래에 적은 것만 허용한다. 나머지는 전부 거절한다.
//
//   마이크(소리만)             보이스 체인저
//   clipboard-sanitized-write  요원 설정(JSON) 복사
//   clipboard-read             요원 설정 붙여넣기
//   speaker-selection          "소리 낼 곳" 고르기 (enumerateDevices + AudioContext.setSinkId)
//
// 카메라·화면 캡처·위치·알림·MIDI·USB·시리얼·HID·블루투스 등은 쓰지 않으므로 허용하지 않는다.

const { isAppUrl } = require('./origin');

const ALWAYS_ALLOWED = new Set(['clipboard-sanitized-write', 'clipboard-read', 'speaker-selection']);

/**
 * 권한 "요청"(setPermissionRequestHandler)에 답한다.
 * @param {{ permission: string, requestingUrl?: string, isMainFrame?: boolean, mediaTypes?: string[] }} request
 * @returns {boolean}
 */
function allowPermissionRequest(request) {
  if (!request || !isAppUrl(request.requestingUrl)) return false;
  // 앱에는 하위 프레임이 없다. 혹시 생겨도 권한은 주지 않는다
  if (request.isMainFrame === false) return false;
  if (request.permission === 'media') {
    const types = request.mediaTypes;
    // 소리만 요청한 경우에만. 'video' 가 하나라도 섞이면 거절한다
    return Array.isArray(types) && types.length > 0 && types.every((t) => t === 'audio');
  }
  return ALWAYS_ALLOWED.has(request.permission);
}

/**
 * 권한 "확인"(setPermissionCheckHandler)에 답한다. 장치 목록의 이름 표시, navigator.permissions.query 등이 여기로 온다.
 * @param {{ permission: string, requestingOrigin?: string, mediaType?: string }} check
 * @returns {boolean}
 */
function allowPermissionCheck(check) {
  if (!check || !isAppUrl(check.requestingOrigin)) return false;
  if (check.permission === 'media') return check.mediaType === 'audio';
  return ALWAYS_ALLOWED.has(check.permission);
}

module.exports = { allowPermissionRequest, allowPermissionCheck, ALWAYS_ALLOWED };
