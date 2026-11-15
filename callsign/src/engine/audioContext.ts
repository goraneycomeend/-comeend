// 앱 전체가 함께 쓰는 AudioContext 하나.
// 브라우저는 사용자가 무언가 누르기 전까지 소리를 막아 두므로, 첫 입력 때 자동으로 깨운다.

let shared: AudioContext | null = null;

function installUnlock(ctx: AudioContext): void {
  if (typeof window === 'undefined') return;
  const events = ['pointerdown', 'keydown', 'touchend'] as const;
  const unlock = (): void => {
    if (ctx.state === 'closed') {
      remove();
      return;
    }
    if (ctx.state === 'running') {
      remove();
      return;
    }
    void ctx.resume().then(remove, () => {});
  };
  const remove = (): void => {
    for (const e of events) window.removeEventListener(e, unlock, true);
  };
  for (const e of events) window.addEventListener(e, unlock, { capture: true, passive: true });
}

/** 공유 컨텍스트. 없으면 만든다. 소리가 막혀 있을 수 있으니 버튼 핸들러에서는 resumeAudio() 를 부른다 */
export function getAudioContext(): AudioContext {
  if (shared && shared.state !== 'closed') return shared;
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) throw new Error('이 브라우저에서는 소리를 낼 수 없어요.');
  shared = new Ctor({ latencyHint: 'interactive' });
  if (shared.state !== 'running') installUnlock(shared);
  return shared;
}

/** 사용자 입력(클릭·키) 핸들러 안에서 부른다. 컨텍스트를 깨워서 돌려준다 */
export async function resumeAudio(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // 아직 사용자 입력이 없어서 막힌 경우. 다음 입력 때 자동으로 풀린다
    }
  }
  return ctx;
}

/** 소리를 바로 낼 수 있는 상태인지 */
export function isAudioRunning(): boolean {
  return shared !== null && shared.state === 'running';
}
