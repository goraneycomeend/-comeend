'use strict';
// 화면(웹앱)에 "PC 앱 안에서 돌고 있다"는 사실만 알려 준다. 그 밖의 권한은 아무것도 넘기지 않는다.
// 샌드박스 안에서 도는 스크립트라 CommonJS 로 쓰고, electron 의 contextBridge 말고는 아무것도 불러오지 않는다.
// 페이지 스크립트보다 먼저 실행되므로 앱 번들이 뜰 때는 window.callsignDesktop 이 이미 있다.

const { contextBridge } = require('electron');

const VERSION_ARG = '--callsign-version=';

/** 주 프로세스가 webPreferences.additionalArguments 로 넘겨 준 앱 버전 */
function readVersion() {
  const arg = process.argv.find((a) => typeof a === 'string' && a.startsWith(VERSION_ARG));
  const version = arg ? arg.slice(VERSION_ARG.length) : '';
  return /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : '0.0.0';
}

contextBridge.exposeInMainWorld(
  'callsignDesktop',
  Object.freeze({
    version: readVersion(),
    platform: String(process.platform),
  }),
);
