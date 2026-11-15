'use strict';
// 앱 창 하나: 만들기, 크기·위치 기억, 창 단축키, 화면이 멈췄을 때의 복구.

const fs = require('node:fs');

const { BrowserWindow, dialog, screen } = require('electron');

const { MIN_SIZE, clampZoom, fitWindowBounds, parseWindowState } = require('../lib/bounds');
const { APP_ENTRY_URL } = require('../lib/origin');
const { shortcutAction } = require('../lib/shortcuts');

const WINDOW_TITLE = '콜사인';
/** 앱 바탕색(index.html 의 body 배경, 토큰 --graphite 의 밑색). 화면이 그려지기 전에 흰 창이 번쩍이지 않게 한다 */
const BACKGROUND_COLOR = '#0f1112';
const ZOOM_STEP = 0.5;
/** 화면이 끝내 그려지지 않아도 이 시간 뒤에는 창을 보인다(오류 안내를 볼 수 있어야 한다) */
const SHOW_FALLBACK_MS = 5000;
/** net::ERR_ABORTED. 이동을 취소했을 때 나는 것으로 오류가 아니다 */
const ERR_ABORTED = -3;

function readState(stateFile) {
  try {
    return parseWindowState(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return parseWindowState(null);
  }
}

function writeState(stateFile, state, log) {
  try {
    const tmp = `${stateFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateFile);
  } catch (err) {
    log.warn(`window state not saved: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * @param {{
 *   version: string,
 *   preload: string,
 *   stateFile: string,
 *   log: { info: (m: string) => void, warn: (m: string) => void, error: (m: string, err?: unknown) => void },
 * }} options
 * @returns {Electron.BrowserWindow}
 */
function createMainWindow({ version, preload, stateFile, log }) {
  const saved = readState(stateFile);
  const displays = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  // 주 모니터를 맨 앞에 둔다
  const workAreas = [...displays].sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId)).map((d) => d.workArea);
  const bounds = fitWindowBounds(saved.bounds, workAreas);

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: WINDOW_TITLE,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    webPreferences: {
      preload,
      additionalArguments: [`--callsign-version=${version}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      // 창이 다른 프로그램 뒤에 있어도 합성과 마이크 처리가 느려지지 않게 한다
      backgroundThrottling: false,
      // 첫 클릭 전에도 소리를 낼 수 있게 한다(대사 듣기, 합성 결과 자동 재생)
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // ── 보이기 ────────────────────────────────────────────────
  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    if (saved.maximized) win.maximize();
    win.show();
  };
  win.once('ready-to-show', reveal);
  const revealTimer = setTimeout(reveal, SHOW_FALLBACK_MS);
  win.once('closed', () => clearTimeout(revealTimer));

  // 창 제목은 언제나 앱 이름
  win.on('page-title-updated', (event) => event.preventDefault());

  // ── 크기·위치·확대 기억 ───────────────────────────────────
  const contents = win.webContents;
  let zoomLevel = saved.zoomLevel;
  const setZoom = (level) => {
    zoomLevel = clampZoom(level);
    contents.setZoomLevel(zoomLevel);
  };
  contents.once('did-finish-load', () => {
    if (zoomLevel !== 0) contents.setZoomLevel(zoomLevel);
  });
  // Ctrl + 마우스 휠
  contents.on('zoom-changed', (_event, direction) => setZoom(zoomLevel + (direction === 'in' ? ZOOM_STEP : -ZOOM_STEP)));

  win.on('close', () => {
    writeState(stateFile, { bounds: win.getNormalBounds(), maximized: win.isMaximized(), zoomLevel }, log);
  });

  // ── 창 단축키 ─────────────────────────────────────────────
  contents.on('before-input-event', (event, input) => {
    const action = shortcutAction(input);
    if (!action) return;
    event.preventDefault();
    if (action === 'toggle-fullscreen') win.setFullScreen(!win.isFullScreen());
    else if (action === 'reload') contents.reload();
    else if (action === 'toggle-devtools') contents.toggleDevTools();
    else if (action === 'zoom-in') setZoom(zoomLevel + ZOOM_STEP);
    else if (action === 'zoom-out') setZoom(zoomLevel - ZOOM_STEP);
    else if (action === 'zoom-reset') setZoom(0);
  });

  // ── 화면이 멈췄을 때 ──────────────────────────────────────
  let asking = false;
  /** 다시 불러올지 묻는다. 창이 이미 닫혔거나 묻는 중이면 아무것도 하지 않는다 */
  const offerReload = async (message, detail, keepLabel) => {
    if (asking || win.isDestroyed()) return;
    asking = true;
    try {
      reveal();
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: WINDOW_TITLE,
        message,
        detail,
        buttons: ['다시 불러오기', keepLabel],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (win.isDestroyed()) return;
      if (response === 0) contents.reload();
      else if (keepLabel === '닫기') win.close();
    } catch (err) {
      log.error('recovery dialog failed', err);
    } finally {
      asking = false;
    }
  };

  contents.on('render-process-gone', (_event, details) => {
    log.error(`renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
    if (details.reason === 'clean-exit') return;
    void offerReload(
      '화면이 예기치 않게 멈췄어요.',
      '다시 불러오면 처음 화면으로 돌아갑니다. 만든 요원과 설정은 그대로 남아 있어요.',
      '닫기',
    );
  });
  win.on('unresponsive', () => {
    log.warn('window unresponsive');
    void offerReload(
      '화면이 응답하지 않아요.',
      '긴 작업 중이라면 조금 기다리면 돌아올 수 있어요. 계속 멈춰 있으면 다시 불러오세요.',
      '기다리기',
    );
  });
  win.on('responsive', () => log.info('window responsive again'));
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    log.error(`page failed to load: ${errorCode} ${errorDescription}`);
    void offerReload('화면을 불러오지 못했어요.', `오류: ${errorDescription} (${errorCode})`, '닫기');
  });
  contents.on('preload-error', (_event, _preloadPath, error) => log.error('preload failed', error));

  log.info(`window created ${bounds.width}x${bounds.height}${saved.maximized ? ' (maximized)' : ''}`);
  void win.loadURL(APP_ENTRY_URL).catch(() => {
    // 실패는 did-fail-load 에서 다룬다
  });
  return win;
}

module.exports = { createMainWindow, WINDOW_TITLE };
