'use strict';
// 콜사인 PC 앱의 주 프로세스.
//
// 하는 일은 적다: 웹앱 폴더를 app://callsign/ 로 내주고, 잠금장치를 건 창 하나를 띄운다.
// 화면 쪽에 넘기는 것은 window.callsignDesktop = { version, platform } 하나뿐이다(preload.js).
// 판단 로직(경로·헤더·권한·창 자리)은 lib/ 의 순수 함수에 있고 `npm test` 로 시험한다.

const fs = require('node:fs');
const path = require('node:path');

const { Menu, app, dialog, session } = require('electron');

const { createLogger } = require('./lib/logfile');
const { registerAppScheme, serveWebFolder } = require('./shell/appProtocol');
const { handleDownloads } = require('./shell/downloads');
const { createMainWindow, WINDOW_TITLE } = require('./shell/mainWindow');
const { hardenWebContents, lockDownSession } = require('./shell/security');

/** 설치 프로그램이 만드는 바로 가기와 같은 값이어야 작업 표시줄에서 한 앱으로 묶인다(electron-builder.yml 의 appId) */
const APP_ID = 'app.callsign.desktop';

// 개발 실행(electron .)은 설치된 앱과 데이터 폴더를 따로 쓴다. 시험이 --user-data-dir 을 주면 그쪽이 우선이다
if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Callsign-dev'));
}

// 화면 프로세스는 전부 샌드박스 안에서 돈다.
// enableSandbox() 는 명령줄의 --no-sandbox 를 지워 버려서, 그 옵션 없이는 뜨지 못하는 환경(리눅스 컨테이너의 root 로
// 돌리는 자동 점검)에서는 부르지 않는다. 그때도 창 설정의 sandbox: true 는 그대로 적용된다.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
registerAppScheme();
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const log = createLogger(path.join(app.getPath('userData'), 'logs'));
/** @type {Electron.BrowserWindow | null} */
let mainWindow = null;

/** 치명적인 문제를 알리고 끝낸다 */
function fail(message, detail, err) {
  log.error(message, err);
  dialog.showErrorBox(`${WINDOW_TITLE}을 시작할 수 없어요`, detail);
  app.exit(1);
}

/**
 * 웹앱 폴더. 설치본은 resources/web 만 쓴다. 개발 실행은 CALLSIGN_WEB_DIR 또는 ../dist.
 * @returns {string} 실제 경로. index.html 이 없으면 던진다
 */
function resolveWebRoot() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(process.env.CALLSIGN_WEB_DIR || path.join(__dirname, '..', '..', 'dist'));
  const real = fs.realpathSync(dir);
  if (!fs.statSync(path.join(real, 'index.html')).isFile()) throw new Error('index.html is not a file');
  return real;
}

function focusMainWindow() {
  log.info('second launch: focusing the existing window');
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function start() {
  let webRoot;
  try {
    webRoot = resolveWebRoot();
  } catch (err) {
    fail(
      'web folder missing',
      '앱 화면 파일을 찾지 못했어요. 설치가 덜 됐거나 파일이 지워진 것 같아요.\n콜사인을 다시 설치해 주세요.',
      err,
    );
    return;
  }

  // 기본 메뉴(와 거기 딸린 단축키·외부 링크)를 없앤다. 남겨 둘 단축키는 창이 직접 처리한다(lib/shortcuts.js)
  Menu.setApplicationMenu(null);

  const ses = session.defaultSession;
  serveWebFolder(ses, webRoot, log);
  lockDownSession(ses, log);
  handleDownloads(ses, {
    downloadsDir: app.getPath('downloads'),
    // 자동 점검 전용: 저장 창 없이 이 폴더에 저장한다
    autoSaveDir: process.env.CALLSIGN_E2E_SAVE_DIR ? path.resolve(process.env.CALLSIGN_E2E_SAVE_DIR) : null,
    log,
  });

  mainWindow = createMainWindow({
    version: app.getVersion(),
    preload: path.join(__dirname, 'preload.js'),
    stateFile: path.join(app.getPath('userData'), 'window-state.json'),
    log,
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

process.on('uncaughtException', (err) => {
  fail('uncaught exception', '예기치 않은 문제로 앱을 끝냅니다. 다시 실행해 주세요.', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', reason);
});

// 이미 떠 있으면 새로 띄우지 않고 그 창을 앞으로 가져온다
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', focusMainWindow);
  // 어떤 화면이 만들어지든 같은 잠금장치를 건다
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, log));
  app.on('window-all-closed', () => app.quit());
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') log.error(`${details.type} process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  app
    .whenReady()
    .then(() => {
      log.info(
        `start v${app.getVersion()} electron=${process.versions.electron} chrome=${process.versions.chrome} ` +
          `${process.platform}-${process.arch} packaged=${app.isPackaged}`,
      );
      start();
    })
    .catch((err) => fail('startup failed', '앱을 시작하지 못했어요. 다시 실행해 주세요.', err));
}
