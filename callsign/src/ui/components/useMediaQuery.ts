// 화면 폭에 따라 구성을 바꿀 때 쓰는 훅.
import { useSyncExternalStore } from 'react';

/** 넓은 화면(왼쪽 내비게이션 + 2단 구성)이 시작되는 폭 */
export const WIDE_QUERY = '(min-width: 1024px)';

/** 미디어 쿼리가 지금 맞는지. 바뀌면 다시 그린다 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** 1024px 이상인지: 왼쪽 내비게이션과 2단 구성을 쓰는 폭 */
export function useWide(): boolean {
  return useMediaQuery(WIDE_QUERY);
}
