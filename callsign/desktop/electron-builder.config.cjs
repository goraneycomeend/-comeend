'use strict';
// 콜사인 PC 앱 포장 설정 (electron-builder).
//
//   npm run pack:dir    지금 운영체제용으로 풀어 놓은 폴더만 만든다(설치 파일 없이 빠르게 확인)
//   npm run dist:win    Windows 설치 파일 release/Callsign-Setup-<버전>.exe
//
// 웹앱은 미리 빌드되어 있어야 한다(`callsign/` 에서 npm run setup && npm run build → callsign/dist).
// 다른 폴더의 빌드를 실으려면 CALLSIGN_WEB_DIR 로 지정한다.

const fs = require('node:fs');
const path = require('node:path');

const webDir = path.resolve(__dirname, process.env.CALLSIGN_WEB_DIR || '../dist');
for (const needed of ['index.html', 'models/manifest.json', 'ort/ort-wasm-simd-threaded.wasm']) {
  if (!fs.existsSync(path.join(webDir, needed))) {
    throw new Error(
      `웹앱 빌드를 찾지 못했어요: ${path.join(webDir, needed)}\n` +
        '먼저 callsign 폴더에서 `npm run setup` 과 `npm run build` 를 실행하세요.',
    );
  }
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'app.callsign.desktop',
  productName: 'Callsign',
  copyright: '콜사인 — 요원·대사·목소리는 모두 오리지널입니다',
  directories: { output: 'release', buildResources: 'build' },

  // 앱 코드(주 프로세스)만 asar 로 묶는다. 이 목록에 없는 것은 들어가지 않는다
  asar: true,
  files: ['package.json', 'src/**/*.js'],
  // 웹앱(모델 약 400MB 포함)과 라이선스 전문은 asar 밖 resources/ 에 그대로 둔다
  extraResources: [
    { from: webDir, to: 'web' },
    { from: '../licenses', to: 'licenses' },
  ],
  // 실행 파일에 넣을 Chromium 화면 언어. 나머지 50여 개 언어 파일(약 40MB)은 뺀다
  electronLanguages: ['ko', 'en-US'],
  npmRebuild: false,
  publish: null,

  // 실행 파일 잠금: Node 로 둔갑시키는 환경 변수와 file:// 특권을 끄고, 앱 코드는 app.asar 에서만 읽는다.
  // --inspect 인자는 남겨 둔다(설치본 자동 점검이 이 인자로 앱에 붙는다).
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.png',
  },
  nsis: {
    // 누르면 바로 설치되고 끝나면 앱이 뜬다. 사용자 폴더에 설치하므로 관리자 권한을 묻지 않는다
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: '콜사인',
    uninstallDisplayName: '콜사인',
    // 지워도 만든 요원·설정(%APPDATA%\Callsign)은 남긴다
    deleteAppDataOnUninstall: false,
    artifactName: 'Callsign-Setup-${version}.${ext}',
    installerLanguages: ['ko_KR'],
    // 모델(실수 배열)은 거의 줄지 않는다. 압축하지 않고 담아 설치를 빠르게 한다 → README 의 "설치 파일 크기" 참고
    // compression 은 아래 최상위 값으로 정한다
  },

  // 리눅스는 배포 대상이 아니다. 포장된 구조를 리눅스에서 시험할 때만 쓴다(npm run pack:dir)
  linux: { target: 'dir', executableName: 'callsign', icon: 'build/icon.png' },
};
