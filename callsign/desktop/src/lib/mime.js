'use strict';
// 파일 확장자 → Content-Type. 앱이 실제로 싣는 종류만 적는다. 모르는 확장자는 내용 추측 없이 바이너리로 보낸다.

const MIME_BY_EXT = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  // 스트리밍 컴파일(WebAssembly.instantiateStreaming)은 정확히 이 타입이어야 한다
  '.wasm': 'application/wasm',
  // 모델 조각
  '.bin': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
});

const DEFAULT_MIME = 'application/octet-stream';

/**
 * @param {string} filePath 경로 또는 파일 이름
 * @returns {string}
 */
function mimeFor(filePath) {
  const name = String(filePath);
  const dot = name.lastIndexOf('.');
  if (dot < 0) return DEFAULT_MIME;
  const ext = name.slice(dot).toLowerCase();
  return Object.hasOwn(MIME_BY_EXT, ext) ? MIME_BY_EXT[ext] : DEFAULT_MIME;
}

module.exports = { mimeFor, MIME_BY_EXT, DEFAULT_MIME };
