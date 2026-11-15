'use strict';
// 화면의 "저장"(<a download>)을 처리한다. 저장 창을 띄워 사용자가 위치를 고르게 한다.

const path = require('node:path');

const { extensionOf, isAllowedDownloadUrl, sanitizeFileName, saveDialogFilters } = require('../lib/downloads');

/**
 * @param {Electron.Session} ses
 * @param {{
 *   downloadsDir: string,
 *   autoSaveDir?: string | null,
 *   log: { info: (m: string) => void, warn: (m: string) => void },
 * }} options
 *   downloadsDir  저장 창이 처음 열리는 폴더(사용자의 다운로드 폴더)
 *   autoSaveDir   자동 점검 전용. 주면 창을 띄우지 않고 이 폴더에 바로 저장한다
 */
function handleDownloads(ses, { downloadsDir, autoSaveDir, log }) {
  // 이번 실행에서 마지막으로 저장한 폴더. 여러 개를 이어서 저장할 때 같은 폴더가 다시 열린다
  let lastDir = null;

  ses.on('will-download', (event, item) => {
    if (!isAllowedDownloadUrl(item.getURL())) {
      event.preventDefault();
      log.warn('download blocked: not an app file');
      return;
    }
    const fileName = sanitizeFileName(item.getFilename());
    // 파일 이름에는 사용자가 쓴 문장이 들어갈 수 있다. 기록에는 종류만 남긴다
    const kind = extensionOf(fileName) || 'file';

    if (autoSaveDir) {
      item.setSavePath(path.join(autoSaveDir, fileName));
    } else {
      item.setSaveDialogOptions({
        title: '파일 저장',
        defaultPath: path.join(lastDir ?? downloadsDir, fileName),
        filters: saveDialogFilters(fileName),
      });
    }

    item.once('done', (_event, state) => {
      // state: completed | cancelled(저장 창에서 취소) | interrupted
      log.info(`save ${state}: ${kind}, ${item.getReceivedBytes()} bytes`);
      const savedTo = item.getSavePath();
      if (state === 'completed' && !autoSaveDir && savedTo) lastDir = path.dirname(savedTo);
    });
  });
}

module.exports = { handleDownloads };
