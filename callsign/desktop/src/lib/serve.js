'use strict';
// 웹 폴더의 파일을 내주는 부분. 요청 하나를 "무엇으로 답할지"(planResponse)와 "파일 내용 흘려보내기"(fileBody)로 나눈다.
// Electron 에 기대지 않으므로 Node 만으로 시험한다.

const fs = require('node:fs');

const { baseHeaders } = require('./headers');
const { mimeFor } = require('./mime');
const { locateFile } = require('./paths');
const { parseRange } = require('./range');

/** 한 번에 읽는 크기. 모델 조각(최대 12MiB)도 이 단위로 나눠 흘려보낸다 */
const CHUNK_BYTES = 1024 * 1024;

const ALLOWED_METHODS = new Set(['GET', 'HEAD']);

/**
 * @typedef {{ status: number, headers: Record<string, string>, text?: string,
 *             file?: { path: string, start: number, end: number } }} ResponsePlan
 */

function textPlan(status, text, extra = {}) {
  return {
    status,
    headers: {
      ...baseHeaders(),
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(text)),
      ...extra,
    },
    text,
  };
}

/**
 * 요청 하나에 어떻게 답할지 정한다.
 * @param {string} realRoot 웹 폴더의 실제 경로
 * @param {{ method: string, pathname: string, range?: string | null }} request pathname 은 인코딩된 그대로
 * @returns {Promise<ResponsePlan>}
 */
async function planResponse(realRoot, request) {
  const method = String(request.method).toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return textPlan(405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  const found = await locateFile(realRoot, request.pathname);
  if (!found.ok) return textPlan(found.status, found.status === 400 ? 'Bad Request' : 'Not Found');

  const headers = {
    ...baseHeaders(),
    'Content-Type': mimeFor(found.file),
    'Accept-Ranges': 'bytes',
    'Last-Modified': new Date(found.mtimeMs).toUTCString(),
  };

  const range = parseRange(request.range, found.size);
  if (range === 'unsatisfiable') {
    return textPlan(416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${found.size}` });
  }
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${found.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    return { status: 206, headers, file: { path: found.file, start: range.start, end: range.end } };
  }
  headers['Content-Length'] = String(found.size);
  return { status: 200, headers, file: { path: found.file, start: 0, end: found.size - 1 } };
}

/**
 * 파일의 [start, end] 구간을 조금씩 읽어 내보내는 스트림. 받는 쪽이 가져가는 만큼만 읽는다(통째로 메모리에 올리지 않는다).
 * 받는 쪽이 중간에 끊으면(재생 위치 이동, 창 닫기) 파일을 바로 닫는다.
 * @param {string} file
 * @param {number} start
 * @param {number} end 포함
 * @returns {ReadableStream<Uint8Array>}
 */
function fileBody(file, start, end) {
  /** @type {fs.promises.FileHandle | null} */
  let handle = null;
  let position = start;
  const close = async () => {
    const h = handle;
    handle = null;
    if (h) await h.close().catch(() => {});
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const want = Math.min(CHUNK_BYTES, end - position + 1);
        if (want <= 0) {
          await close();
          controller.close();
          return;
        }
        handle ??= await fs.promises.open(file, 'r');
        const buffer = Buffer.allocUnsafe(want);
        const { bytesRead } = await handle.read(buffer, 0, want, position);
        if (bytesRead === 0) throw new Error('file ended early');
        position += bytesRead;
        controller.enqueue(bytesRead === want ? buffer : buffer.subarray(0, bytesRead));
        if (position > end) {
          await close();
          controller.close();
        }
      } catch (err) {
        await close();
        controller.error(err);
      }
    },
    cancel: close,
  });
}

/**
 * 계획을 fetch 표준 Response 로 만든다(protocol.handle 이 받는 형태).
 * @param {ResponsePlan} plan
 * @param {string} method
 */
function toResponse(plan, method) {
  const head = String(method).toUpperCase() === 'HEAD';
  let body = null;
  if (!head) {
    if (plan.file && plan.file.end >= plan.file.start) body = fileBody(plan.file.path, plan.file.start, plan.file.end);
    else if (plan.text !== undefined) body = plan.text;
  }
  return new Response(body, { status: plan.status, headers: plan.headers });
}

module.exports = { planResponse, fileBody, toResponse, CHUNK_BYTES };
