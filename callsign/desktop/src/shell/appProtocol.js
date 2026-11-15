'use strict';
// 앱 화면을 app://callsign/ 주소로 내준다.
//
// 왜 파일 주소(file://)나 로컬 서버가 아닌가
//   - 출처가 언제나 app://callsign 으로 같다 → localStorage(사용자가 만든 요원·설정)가 실행할 때마다 그대로 남는다.
//   - 응답마다 헤더를 붙일 수 있다 → 교차 출처 격리가 켜져 AI 음성 엔진이 여러 스레드로 돈다.
//   - 포트를 열지 않는다 → 이 PC 의 다른 프로그램이나 웹 페이지가 접근할 길이 없다.

const { protocol } = require('electron');

const { baseHeaders } = require('../lib/headers');
const { APP_SCHEME, parseAppUrl } = require('../lib/origin');
const { planResponse, toResponse } = require('../lib/serve');

/**
 * 스킴 등록. app 의 ready 이벤트보다 먼저 불러야 한다.
 *   standard        상대 주소·출처 계산이 http 처럼 동작한다
 *   secure          보안 컨텍스트(마이크, crypto.subtle, 교차 출처 격리)
 *   supportFetchAPI fetch() 로 모델·클립을 읽는다
 *   stream          소리 파일 재생 위치 이동(Range)과 큰 파일 스트리밍
 */
function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

/**
 * 웹 폴더를 app://callsign/ 로 내준다.
 * @param {Electron.Session} ses
 * @param {string} realRoot 웹 폴더의 실제 경로
 * @param {{ error: (message: string, err?: unknown) => void }} log
 */
function serveWebFolder(ses, realRoot, log) {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = parseAppUrl(request.url);
      const plan = await planResponse(realRoot, {
        method: request.method,
        // 다른 호스트(app://다른이름/)는 빈 경로로 넘겨 400 이 되게 한다
        pathname: url ? url.pathname : '',
        range: request.headers.get('range'),
      });
      return toResponse(plan, request.method);
    } catch (err) {
      log.error('request failed', err);
      return new Response('Internal Error', {
        status: 500,
        headers: { ...baseHeaders(), 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  });
}

module.exports = { registerAppScheme, serveWebFolder };
