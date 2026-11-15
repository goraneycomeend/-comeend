'use strict';
// 모든 응답에 붙이는 보안 헤더.

/**
 * 교차 출처 격리. 이 셋이 문서와 Worker 스크립트, 그 밖의 모든 응답에 붙어 있어야
 * `crossOriginIsolated === true` 가 되고 AI 음성 엔진이 여러 스레드(SharedArrayBuffer)로 돈다.
 */
const ISOLATION_HEADERS = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
});

/**
 * 콘텐츠 보안 정책. 앱 자신의 파일 말고는 아무것도 읽지 못한다(원격 주소 없음).
 *
 *   script-src   'wasm-unsafe-eval' : onnxruntime 과 피치 처리기가 WebAssembly 를 컴파일한다
 *                blob:              : 피치 처리기를 blob 주소의 모듈·오디오 워크릿으로 올린다
 *   worker-src   blob:              : 런타임이 만드는 스레드 Worker
 *   style-src    'unsafe-inline'    : index.html 안의 작은 <style>(첫 화면 번쩍임 방지)
 *   img/media    blob: data:        : 만든 소리(blob)를 듣고, 파비콘(data:)을 그린다
 *   connect-src  blob: data:        : 만든 소리·불러온 파일을 다시 읽을 때. 둘 다 이 PC 안의 데이터다
 *
 * Worker 는 자기 스크립트 응답의 정책을 따르므로 문서뿐 아니라 모든 응답에 같은 정책을 붙인다.
 */
const CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'none'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'", 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'blob:', 'data:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
});

function buildCsp(directives = CSP_DIRECTIVES) {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

const CONTENT_SECURITY_POLICY = buildCsp();

/** 모든 응답의 공통 헤더(새 객체) */
function baseHeaders() {
  return {
    ...ISOLATION_HEADERS,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'Referrer-Policy': 'no-referrer',
  };
}

module.exports = { ISOLATION_HEADERS, CSP_DIRECTIVES, CONTENT_SECURITY_POLICY, buildCsp, baseHeaders };
