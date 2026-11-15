'use strict';
// 세션과 화면의 잠금장치: 권한, 바깥 주소로의 이동, 새 창, 네트워크 요청.

const { shell } = require('electron');

const { externalHttpsUrl, isAllowedRequestUrl, isAppUrl } = require('../lib/origin');
const { allowPermissionCheck, allowPermissionRequest } = require('../lib/permissions');

/** 기록에는 주소 전체가 아니라 형식과 호스트만 남긴다 */
function describeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '(주소 아님)';
  }
}

/**
 * @param {Electron.Session} ses
 * @param {{ info: (m: string) => void, warn: (m: string) => void }} log
 */
function lockDownSession(ses, log) {
  // 권한 요청: 마이크(소리만)·클립보드·출력 장치 선택만, 앱 화면에만
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed = allowPermissionRequest({
      permission,
      requestingUrl: details?.requestingUrl || contents?.getURL(),
      isMainFrame: details?.isMainFrame,
      mediaTypes: details?.mediaTypes,
    });
    if (!allowed) log.info(`permission request denied: ${permission}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    allowPermissionCheck({ permission, requestingOrigin, mediaType: details?.mediaType }),
  );
  // USB·시리얼·HID 장치는 쓰지 않는다
  ses.setDevicePermissionHandler(() => false);

  // 앱 파일과 메모리 안 데이터 말고는 어떤 요청도 내보내지 않는다(콘텐츠 보안 정책에 더한 두 번째 방어선)
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequestUrl(details.url);
    if (!allowed) log.warn(`request blocked: ${describeUrl(details.url)}`);
    callback({ cancel: !allowed });
  });
}

/**
 * 화면(webContents) 하나를 잠근다. 앱이 만드는 모든 webContents 에 적용한다.
 * @param {Electron.WebContents} contents
 * @param {{ warn: (m: string) => void }} log
 */
function hardenWebContents(contents, log) {
  const blockOutside = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    log.warn(`navigation blocked: ${describeUrl(url)}`);
  };
  // 앱 주소 밖으로는 이동하지 않는다(리디렉션, 하위 프레임 포함)
  contents.on('will-navigate', (event, url) => blockOutside(event, url));
  contents.on('will-redirect', (event, url) => blockOutside(event, url));
  contents.on('will-frame-navigate', (event) => blockOutside(event, event.url));

  // 새 창은 만들지 않는다. https 링크만 기본 브라우저로 넘긴다
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalHttpsUrl(url);
    if (external) {
      shell.openExternal(external).catch(() => log.warn('openExternal failed'));
    } else {
      log.warn(`window.open blocked: ${describeUrl(url)}`);
    }
    return { action: 'deny' };
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
  // 블루투스 장치 선택 창은 띄우지 않고 바로 취소한다(듣는 쪽이 없으면 첫 장치가 자동으로 골라진다)
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault();
    callback('');
  });
}

module.exports = { lockDownSession, hardenWebContents };
