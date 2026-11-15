'use strict';
// 문제가 생겼을 때 보낼 수 있는 짧은 기록 파일. 시작·오류·화면 멈춤만 적는다.
// 사용자가 입력한 글, 만든 소리, 저장한 파일 이름은 적지 않는다(호출하는 쪽이 넘기지 않는다).
//
//   <폴더>/main.log     지금 쓰는 파일
//   <폴더>/main.1.log   바로 앞의 파일 … main.<keep>.log 까지 남기고 더 오래된 것은 지운다

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_KEEP = 2;
const MAX_LINE_CHARS = 2000;

/**
 * @param {string} dir 기록 폴더(없으면 만든다)
 * @param {{ maxBytes?: number, keep?: number, now?: () => Date, name?: string }} [options]
 */
function createLogger(dir, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = options.keep ?? DEFAULT_KEEP;
  const now = options.now ?? (() => new Date());
  const name = options.name ?? 'main';
  const file = path.join(dir, `${name}.log`);
  const numbered = (n) => path.join(dir, `${name}.${n}.log`);
  let size = -1;

  function rotate() {
    try {
      fs.rmSync(numbered(keep), { force: true });
      for (let n = keep - 1; n >= 1; n--) {
        if (fs.existsSync(numbered(n))) fs.renameSync(numbered(n), numbered(n + 1));
      }
      if (keep >= 1) fs.renameSync(file, numbered(1));
      else fs.rmSync(file, { force: true });
    } catch {
      // 옮기지 못하면 지금 파일을 비우고 계속 쓴다
      try {
        fs.writeFileSync(file, '');
      } catch {
        // 기록은 포기한다. 앱은 계속 돈다
      }
    }
    size = 0;
  }

  function write(level, message) {
    try {
      if (size < 0) {
        fs.mkdirSync(dir, { recursive: true });
        size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      }
      const text = String(message).replace(/\s*[\r\n]+\s*/g, ' | ').slice(0, MAX_LINE_CHARS);
      const line = `${now().toISOString()} ${level} ${text}\n`;
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) rotate();
      fs.appendFileSync(file, line);
      size += bytes;
    } catch {
      // 기록 실패가 앱을 멈추게 하지 않는다
    }
  }

  return {
    file,
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    /**
     * @param {string} message
     * @param {unknown} [err] 있으면 오류 내용(스택)을 덧붙인다
     */
    error: (message, err) => {
      const detail = err instanceof Error ? (err.stack ?? err.message) : err === undefined ? '' : String(err);
      write('ERROR', detail ? `${message}: ${detail}` : message);
    },
  };
}

module.exports = { createLogger };
