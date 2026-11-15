// 잠깐 떴다 사라지는 알림. 띄울 때는 `toast('저장했어요', 'ok')` (src/app/store.ts) 를 부른다.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../app/store.ts';
import type { ToastItem } from '../../app/types.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';

const ICON: Record<ToastItem['tone'], IconName> = { info: 'info', ok: 'check', warn: 'warning', error: 'warning' };
/** 알림이 떠 있는 시간(ms). 문제 알림은 조금 더 오래 둔다 */
const LIFE_MS: Record<ToastItem['tone'], number> = { info: 3200, ok: 2600, warn: 5000, error: 6500 };

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useAppStore((s) => s.dismissToast);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), LIFE_MS[item.tone]);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.id, item.tone]);

  return (
    <li className={`toast toast--${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
      <Icon name={ICON[item.tone]} size={18} className="toast__icon" />
      <span className="toast__text">{item.message}</span>
      <button type="button" className="toast__close" aria-label="알림 닫기" onClick={() => dismiss(item.id)}>
        <Icon name="close" size={16} />
      </button>
    </li>
  );
}

/** 알림이 뜨는 자리. App 이 한 번 그린다 */
export function ToastHost() {
  const toasts = useAppStore((s) => s.toasts);
  return createPortal(
    <ol className="toast-host" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} />
      ))}
    </ol>,
    document.body,
  );
}
