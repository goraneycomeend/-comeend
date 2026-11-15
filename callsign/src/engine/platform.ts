// 실행 환경마다 다른 부분을 한곳에 모은다: 저장·공유, 마이크, 앱 자산 주소, 간단한 저장소.
// 지금은 세 환경(web / native / artifact)이 같은 동작을 하지만, 환경별로 바꿔 끼울 자리를 나눠 두었다.

export type PlatformKind = 'web' | 'native' | 'artifact';

/** 'saved' = 저장을 시작했다, 'failed' = 이 환경에서는 저장하지 못했다 */
export type SaveOutcome = 'saved' | 'failed';
/** 'shared' = 공유 창으로 넘겼다, 'saved' = 공유가 안 돼 저장으로 대신했다, 'cancelled' = 사용자가 닫았다 */
export type ShareOutcome = 'shared' | 'saved' | 'cancelled' | 'failed';

interface HostWindow {
  Capacitor?: { isNativePlatform?: () => boolean };
  claude?: unknown;
  callsignDesktop?: unknown;
}

function hostWindow(): HostWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as HostWindow);
}

function detectKind(): PlatformKind {
  const w = hostWindow();
  if (!w) return 'web';
  try {
    if (w.Capacitor?.isNativePlatform?.() === true) return 'native';
  } catch {
    // 판별 함수가 던지면 웹으로 본다
  }
  if (w.claude !== undefined && w.claude !== null) return 'artifact';
  return 'web';
}

export interface PlatformInfo {
  /** web = 브라우저, native = 앱 웹뷰, artifact = 게시된 페이지 안 */
  readonly kind: PlatformKind;
  /** PC 앱(데스크톱 셸) 안에서 돌고 있는지. 정보 화면 표기용 */
  readonly desktop: boolean;
}

export const platform: PlatformInfo = Object.freeze({
  kind: detectKind(),
  desktop: hostWindow()?.callsignDesktop !== undefined && hostWindow()?.callsignDesktop !== null,
});

// ── 앱 자산 주소 ─────────────────────────────────────────────

function webAppBase(): string {
  if (typeof document === 'undefined') return '';
  try {
    return new URL('.', document.baseURI).href;
  } catch {
    return '';
  }
}

/** 환경별 '앱 파일이 놓인 곳'. 모델·클립 위치가 다른 환경은 여기만 바꾼다 */
const appBaseByKind: Record<PlatformKind, () => string> = {
  web: webAppBase,
  native: webAppBase,
  artifact: webAppBase,
};

/** 앱이 놓인 폴더의 절대 주소(끝에 '/'). 알 수 없으면 빈 문자열 */
export function appBase(): string {
  return appBaseByKind[platform.kind]();
}

/** 앱 폴더 기준 상대 경로를 절대 주소로. 예) assetUrl('clips/clips.json') */
export function assetUrl(path: string): string {
  const clean = path.replace(/^(\.\/|\/)+/, '');
  const base = appBase();
  if (!base) return clean;
  try {
    return new URL(clean, base).href;
  } catch {
    return clean;
  }
}

// ── 마이크 ───────────────────────────────────────────────────

function browserMicAvailable(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (window.isSecureContext === false) return false;
  return typeof navigator.mediaDevices?.getUserMedia === 'function';
}

const micByKind: Record<PlatformKind, () => boolean> = {
  web: browserMicAvailable,
  native: browserMicAvailable,
  artifact: browserMicAvailable,
};

/** 이 환경에서 마이크를 요청해 볼 수 있는지(권한을 받았다는 뜻은 아니다) */
export function canUseMic(): boolean {
  try {
    return micByKind[platform.kind]();
  } catch {
    return false;
  }
}

// ── 저장·공유 ────────────────────────────────────────────────

/** 파일 이름에 쓸 수 없는 글자를 빼고 길이를 줄인다. 확장자는 그대로 둔다 */
export function safeFilename(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).replace(/[^.A-Za-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    // 제어 문자와 Windows 에서 못 쓰는 글자
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 60);
  return `${stem || '콜사인'}${ext}`;
}

/** 파일 이름 조각을 이어 붙인다. 예) audioFilename(['하루', '목표 지점 확보'], 'wav') → '콜사인_하루_목표-지점-확보.wav' */
export function audioFilename(parts: string[], ext: string): string {
  const body = parts
    .map((p) => p.replace(/<[^>]*>/g, ' ').trim().slice(0, 24).trim())
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/\s+/g, '-'))
    .join('_');
  return safeFilename(`콜사인_${body || '음성'}.${ext.replace(/^\./, '')}`);
}

/** `<a download>` 로 내려받는다. 브라우저와 PC 앱에서는 이것으로 충분하다 */
function saveWithAnchor(blob: Blob, filename: string): Promise<SaveOutcome> {
  if (typeof document === 'undefined') return Promise.resolve('failed');
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 내려받기가 시작될 시간을 준 뒤에 주소를 거둔다
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return Promise.resolve('saved');
  } catch {
    return Promise.resolve('failed');
  }
}

/** 환경별 저장 방법. 앱 웹뷰·게시 페이지용 저장 방식은 이 표의 해당 칸만 바꿔 끼운다 */
const saveByKind: Record<PlatformKind, (blob: Blob, filename: string) => Promise<SaveOutcome>> = {
  web: saveWithAnchor,
  native: saveWithAnchor,
  artifact: saveWithAnchor,
};

/** 소리 파일을 기기에 저장한다 */
export async function saveAudio(blob: Blob, filename: string): Promise<SaveOutcome> {
  try {
    return await saveByKind[platform.kind](blob, safeFilename(filename));
  } catch {
    return 'failed';
  }
}

async function shareWithNavigator(blob: Blob, filename: string, title: string): Promise<ShareOutcome | null> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null;
  if (typeof navigator.canShare !== 'function' || typeof File === 'undefined') return null;
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const data: ShareData = { files: [file], title };
  let ok = false;
  try {
    ok = navigator.canShare(data);
  } catch {
    ok = false;
  }
  if (!ok) return null;
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    return null;
  }
}

/** 환경별 공유 방법. null 을 돌려주면 저장으로 대신한다 */
const shareByKind: Record<PlatformKind, (blob: Blob, filename: string, title: string) => Promise<ShareOutcome | null>> = {
  web: shareWithNavigator,
  native: shareWithNavigator,
  artifact: shareWithNavigator,
};

/** 공유 창을 띄운다. 파일 공유를 못 하는 환경이면 저장한다 */
export async function shareAudio(blob: Blob, filename: string, title: string): Promise<ShareOutcome> {
  const name = safeFilename(filename);
  let shared: ShareOutcome | null = null;
  try {
    shared = await shareByKind[platform.kind](blob, name, title);
  } catch {
    shared = null;
  }
  if (shared) return shared;
  return (await saveAudio(blob, name)) === 'saved' ? 'saved' : 'failed';
}

/** 파일 공유 창을 쓸 수 있는 환경인지(버튼 이름을 '공유'로 할지 '저장'으로 할지 정할 때) */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof File === 'undefined') {
    return false;
  }
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'a.wav', { type: 'audio/wav' })] });
  } catch {
    return false;
  }
}

// ── 간단한 저장소 ────────────────────────────────────────────

/** 저장소를 못 쓰는 환경(막힌 프레임, 사생활 보호 창)에서는 이 표가 대신한다. 창을 닫으면 사라진다 */
const memory = new Map<string, string>();

function local(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 문자열 저장소. 어떤 경우에도 던지지 않는다 */
export const storage = {
  get(key: string): string | null {
    try {
      const v = local()?.getItem(key);
      if (typeof v === 'string') return v;
    } catch {
      // 아래 메모리 값으로 넘어간다
    }
    return memory.get(key) ?? null;
  },
  /** 기기에 남겼으면 true. 남기지 못하면 이번 실행 동안만 기억하고 false */
  set(key: string, value: string): boolean {
    memory.set(key, value);
    try {
      const ls = local();
      if (!ls) return false;
      ls.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      local()?.removeItem(key);
    } catch {
      // 지울 수 없으면 그대로 둔다
    }
  },
};
