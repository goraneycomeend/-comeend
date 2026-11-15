'use strict';
// 저장(내려받기)에 쓰는 순수 함수: 파일 이름 다듬기, 저장 창의 파일 종류 목록.

const { isAppBlobUrl, isAppUrl } = require('./origin');

const FALLBACK_STEM = '콜사인-음성';
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

const TYPE_LABEL = Object.freeze({
  mp3: 'MP3 소리 파일',
  wav: 'WAV 소리 파일',
  json: 'JSON 파일',
  txt: '텍스트 파일',
});

/**
 * 화면이 제안한 파일 이름을 폴더 구분자·금지 문자 없는 이름 하나로 다듬는다.
 * @param {unknown} suggested
 * @returns {string}
 */
function sanitizeFileName(suggested) {
  let name = typeof suggested === 'string' ? suggested : '';
  // 경로가 섞여 있으면 마지막 조각만 쓴다
  name = name.split(/[/\\]/).pop() ?? '';
  name = name.replace(FORBIDDEN_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  // 앞의 점(숨김 파일)과 끝의 점·공백(Windows 가 떼어 버린다)을 없앤다
  name = name.replace(/^\.+/, '').replace(/[. ]+$/, '');
  const dot = name.lastIndexOf('.');
  let stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8) : '';
  stem = stem.trim().slice(0, 120).trim();
  if (stem === '' || WINDOWS_DEVICE_NAME.test(stem)) stem = FALLBACK_STEM;
  return ext ? `${stem}.${ext}` : stem;
}

/** 파일 이름의 확장자(소문자, 점 없이). 없으면 빈 문자열 */
function extensionOf(fileName) {
  const dot = String(fileName).lastIndexOf('.');
  return dot > 0 ? String(fileName).slice(dot + 1).toLowerCase() : '';
}

/**
 * 저장 창의 "파일 형식" 목록.
 * @param {string} fileName
 * @returns {{ name: string, extensions: string[] }[]}
 */
function saveDialogFilters(fileName) {
  const ext = extensionOf(fileName);
  const filters = [];
  if (ext) filters.push({ name: TYPE_LABEL[ext] ?? `${ext.toUpperCase()} 파일`, extensions: [ext] });
  filters.push({ name: '모든 파일', extensions: ['*'] });
  return filters;
}

/**
 * 저장을 허용할 주소인지. 앱이 만든 blob 과 앱 자신의 파일만.
 * @param {unknown} url
 */
function isAllowedDownloadUrl(url) {
  return isAppBlobUrl(url) || isAppUrl(url);
}

module.exports = { sanitizeFileName, extensionOf, saveDialogFilters, isAllowedDownloadUrl, FALLBACK_STEM };
