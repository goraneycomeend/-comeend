import { useEffect, useState } from 'react';
import { useApp } from './store';

/** zustand persist 하이드레이션 완료 여부 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(useApp.persist.hasHydrated());
  useEffect(() => {
    const unsub = useApp.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useApp.persist.hasHydrated());
    return unsub;
  }, []);
  return hydrated;
}

/** 1초마다 갱신되는 현재 시각 (카운트다운용) */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
