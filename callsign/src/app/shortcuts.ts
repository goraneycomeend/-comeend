// 키보드 단축키.
//   Space        재생/정지 (입력란·버튼에 포커스가 없을 때)
//   1 ~ 5        탭 이동 (입력란 밖)
//   Esc          시트 닫기, 만들기 취소 — 가장 나중에 등록한 것부터
//   Ctrl+Enter   스튜디오에서 말하기 (스튜디오 화면이 직접 처리한다)
import { useEffect, useRef } from 'react';
import { TAB_ROUTES, navigate } from './hash.ts';
import { toggleLastPlayback } from './voiceService.ts';

/** 정보 화면의 단축키 표에 그대로 쓴다 */
export const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: '재생 / 정지 (글 쓰는 칸 밖에서)' },
  { keys: ['Ctrl', 'Enter'], label: '스튜디오에서 말하기' },
  { keys: ['1', '~', '5'], label: '요원 · 대사 · 스튜디오 · 체인저 · 랩으로 이동' },
  { keys: ['Esc'], label: '열린 창 닫기, 만들기 취소' },
];

type Handler = () => void;

const spaceStack: Handler[] = [];
const escapeStack: Handler[] = [];
/** 열려 있는 시트(모달) 수. 열려 있는 동안 탭 이동 단축키는 쉰다 */
let modalDepth = 0;

function push(stack: Handler[], handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 글을 입력하는 곳인지(이때는 글자 단축키를 가로채지 않는다) */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Space 가 이미 제 할 일이 있는 요소인지(버튼, 링크 등) */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isTypingTarget(target)) return true;
  return target.closest('button, a[href], summary, [role="button"], [role="slider"], [role="switch"], [role="tab"]') !== null;
}

function onKeyDown(e: KeyboardEvent): void {
  // 한글 조합 중에 들어오는 키는 건드리지 않는다
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;

  if (e.key === 'Escape') {
    const top = escapeStack[escapeStack.length - 1];
    if (top) {
      e.preventDefault();
      top();
    }
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;

  if (e.key >= '1' && e.key <= '5' && e.key.length === 1) {
    if (modalDepth > 0) return;
    const route = TAB_ROUTES[Number(e.key) - 1];
    if (route) {
      e.preventDefault();
      navigate(route);
    }
    return;
  }

  if (e.key === ' ' || e.code === 'Space') {
    if (e.repeat || isInteractiveTarget(e.target)) return;
    const top = spaceStack[spaceStack.length - 1];
    if (top) {
      e.preventDefault();
      top();
    } else if (toggleLastPlayback()) {
      e.preventDefault();
    }
  }
}

/** 전역 단축키를 켠다. 해제 함수를 돌려준다. App 이 한 번 부른다 */
export function installShortcuts(): () => void {
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

function useStacked(stack: Handler[], handler: Handler, enabled: boolean): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    return push(stack, () => latest.current());
  }, [stack, enabled]);
}

/**
 * 이 화면에서 Space 가 할 일을 정한다(예: 결과 재생/정지).
 * 등록한 화면이 없으면 "마지막으로 튼 소리 다시 틀기/멈추기"가 기본 동작이다.
 */
export function useSpaceAction(handler: () => void, enabled = true): void {
  useStacked(spaceStack, handler, enabled);
}

/** Esc 가 할 일을 정한다(예: 만들기 취소). 나중에 등록한 것이 먼저 받는다 */
export function useEscape(handler: () => void, enabled = true): void {
  useStacked(escapeStack, handler, enabled);
}

/** 시트가 열려 있는 동안 불러 둔다: 탭 이동 단축키를 쉬게 한다 */
export function useModalLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    modalDepth++;
    return () => {
      modalDepth--;
    };
  }, [open]);
}
