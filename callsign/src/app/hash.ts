// 화면 전환. 주소의 해시 한 단어가 곧 화면이다: #agents #lines #studio #changer #lab #about
import { useSyncExternalStore } from 'react';

export const ROUTES = ['agents', 'lines', 'studio', 'changer', 'lab', 'about'] as const;
export type Route = (typeof ROUTES)[number];

/** 탭(숫자 단축키 1~5)으로 가는 화면. 순서가 곧 단축키 번호 */
export const TAB_ROUTES: readonly Route[] = ['agents', 'lines', 'studio', 'changer', 'lab'];

export const DEFAULT_ROUTE: Route = 'agents';

export const ROUTE_LABEL: Record<Route, string> = {
  agents: '요원',
  lines: '대사',
  studio: '스튜디오',
  changer: '체인저',
  lab: '랩',
  about: '정보',
};

/** '#lines', 'lines', '#/lines' 어느 꼴이든 화면 이름으로. 모르는 값은 기본 화면 */
export function parseHash(hash: string): Route {
  const word = hash.replace(/^#\/?/, '').split(/[/?&]/)[0]?.toLowerCase() ?? '';
  return (ROUTES as readonly string[]).includes(word) ? (word as Route) : DEFAULT_ROUTE;
}

function readLocation(): Route {
  try {
    return parseHash(window.location.hash);
  } catch {
    return DEFAULT_ROUTE;
  }
}

let current: Route = typeof window === 'undefined' ? DEFAULT_ROUTE : readLocation();
const listeners = new Set<() => void>();

function setCurrent(route: Route): void {
  if (route === current) return;
  current = route;
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => setCurrent(readLocation()));
}

/** 지금 화면 */
export function currentRoute(): Route {
  return current;
}

/** 화면을 바꾼다. 주소를 못 바꾸는 환경(막힌 프레임)에서도 화면은 바뀐다 */
export function navigate(route: Route): void {
  setCurrent(route);
  try {
    if (parseHash(window.location.hash) !== route || window.location.hash === '') {
      window.location.hash = route;
    }
  } catch {
    // 주소는 그대로 두고 화면만 바꾼다
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 지금 화면을 구독하는 훅 */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, () => DEFAULT_ROUTE);
}
