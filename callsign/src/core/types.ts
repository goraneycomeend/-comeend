// 모듈 간 계약. 여러 담당이 이 파일을 기준으로 따로 작업하므로 임의로 바꾸지 않는다.
// 타입과 상수만 둔다. 동작하는 코드는 각 모듈에.

/** voice.bin 의 기본 보이스 10개. 배열 순서가 voice.bin 인덱스 0..9 */
export const BASE_VOICE_IDS = ['F1', 'F2', 'F3', 'F4', 'F5', 'M1', 'M2', 'M3', 'M4', 'M5'] as const;
export type BaseVoiceId = (typeof BASE_VOICE_IDS)[number];

/** 기본 보이스의 볼록 결합. 가중치 ≥ 0, 쓸 때 합 1 로 정규화. 성분은 최대 3개 */
export type VoiceBlend = Partial<Record<BaseVoiceId, number>>;

export const LANGS = ['ko', 'en', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu',
  'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi', 'na'] as const;
export type Lang = (typeof LANGS)[number];

/** 모노 PCM */
export interface PcmAudio { samples: Float32Array; sampleRate: number }

export interface TtsRequest {
  text: string;
  lang: Lang;
  blend: VoiceBlend;
  /** 말 빠르기 배율 0.8~1.4 (1.0 = 모델 기본 속도) */
  speed: number;
  /** 디노이징 스텝 4~16. 기본 8. 클수록 느리고 깨끗하다 */
  steps: number;
  /** 주면 같은 입력에 같은 음성(사전 렌더·테스트용). 없으면 매번 다른 테이크 */
  seed?: number;
}
export interface TtsProgress { chunkIndex: number; chunkCount: number; step: number; steps: number }
export interface ModelLoadProgress { phase: 'download' | 'init'; loadedBytes: number; totalBytes: number; file?: string }
export type TtsEngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface TtsEngine {
  readonly status: TtsEngineStatus;
  readonly error: Error | null;
  /** 상태 변화 구독. 해제 함수를 돌려준다 */
  subscribe(listener: (status: TtsEngineStatus) => void): () => void;
  /** 모델을 받아 세션을 만든다. 여러 번 불러도 한 번만 로드한다 */
  load(onProgress?: (p: ModelLoadProgress) => void): Promise<void>;
  /** 결과는 모델 출력 그대로(후처리 전). 동시 호출은 순서대로 처리한다 */
  synthesize(req: TtsRequest, opts?: { onProgress?: (p: TtsProgress) => void; signal?: AbortSignal }): Promise<PcmAudio>;
  dispose(): void;
}

/** 요원 목소리의 음향 처리. 전부 0 이면 아무 처리도 하지 않는다 */
export interface VoiceFx {
  /** 피치 이동(반음) -12..12 */
  pitch: number;
  /** 포먼트 이동(반음) -6..6. 목소리의 '체구' */
  formant: number;
  /** 저역 온기 -1..1 */
  warmth: number;
  /** 중고역 또렷함 -1..1 */
  presence: number;
  /** 초고역 공기감 -1..1 */
  air: number;
  /** 컴프레서 0..1 */
  punch: number;
  /** 짧은 룸 리버브 0..1 */
  room: number;
  /** 무전기 0..1 */
  radio: number;
  /** 에코 0..1 */
  echo: number;
  /** 더블링 0..1 */
  doubler: number;
  /** 기계음(링 모듈레이션) 0..1 */
  robot: number;
  /** 출력 게인 dB -12..12 */
  gainDb: number;
}

export type LineCategory = 'greeting' | 'ready' | 'tactics' | 'clutch' | 'banter' | 'victory' | 'comfort';
export interface AgentLine { id: string; category: LineCategory; text: string; lang: Lang }

/** 선봉 / 정찰 / 수비 / 지원 */
export type AgentRole = 'vanguard' | 'recon' | 'anchor' | 'support';

export interface AgentVoice { blend: VoiceBlend; speed: number; fx: VoiceFx }

export interface AgentDef {
  /** 소문자 영문·숫자·하이픈 */
  id: string;
  /** 한글 콜사인 */
  callsign: string;
  /** 영문 대문자 표기 */
  callsignEn: string;
  role: AgentRole;
  /** 한 줄 소개 */
  tagline: string;
  /** 두세 문장 소개 */
  bio: string;
  /** 목소리 특징 태그 3개 */
  traits: string[];
  /** 대표색 #rrggbb */
  color: string;
  voice: AgentVoice;
  lines: AgentLine[];
  /** 사용자가 랩에서 만든 요원 */
  custom?: boolean;
}

export interface LiveVoiceChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** 입력→출력 지연(초) */
  readonly latencySec: number;
  update(fx: VoiceFx): void;
  dispose(): void;
}
