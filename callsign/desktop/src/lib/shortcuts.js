'use strict';
// 메뉴 막대를 없앤 대신 남겨 두는 창 단축키.
//
//   F11                  전체 화면
//   Ctrl+R, F5           다시 불러오기
//   Ctrl+Shift+I, F12    개발자 도구(문제 확인용)
//   Ctrl + / - / 0       화면 확대 / 축소 / 원래대로
//
// 앱 화면의 단축키(Space, Ctrl+Enter, 1~5, Esc)와 겹치지 않는다.

/**
 * @typedef {'toggle-fullscreen' | 'reload' | 'toggle-devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset'} ShortcutAction
 */

/**
 * Electron 의 before-input-event 입력 → 동작. 해당 없으면 null.
 * 한글 입력 중에는 key 가 'Process' 로 오므로 글자 키는 자판 위치(code)로 본다.
 * @param {{ type?: string, key?: string, code?: string, control?: boolean, shift?: boolean, alt?: boolean, meta?: boolean }} input
 * @returns {ShortcutAction | null}
 */
function shortcutAction(input) {
  if (!input || input.type !== 'keyDown') return null;
  const ctrl = input.control === true;
  const shift = input.shift === true;
  if (input.alt === true || input.meta === true) return null;
  const { key, code } = input;

  if (!ctrl && !shift) {
    if (key === 'F11') return 'toggle-fullscreen';
    if (key === 'F12') return 'toggle-devtools';
    if (key === 'F5') return 'reload';
    return null;
  }
  if (!ctrl) return null;

  if (shift) return code === 'KeyI' ? 'toggle-devtools' : code === 'Equal' ? 'zoom-in' : null;
  if (code === 'KeyR') return 'reload';
  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') return 'zoom-in';
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-') return 'zoom-out';
  if (code === 'Digit0' || code === 'Numpad0' || key === '0') return 'zoom-reset';
  return null;
}

module.exports = { shortcutAction };
