// 화면 계층(스토어·음성 서비스·화면)이 함께 쓰는 타입.
import type { Lang, ModelLoadProgress, PcmAudio, TtsEngineStatus } from '../core/types.ts';

/** 스튜디오에서 만든 음성 하나 */
export interface SpokenResult {
  /** 기록·재생 표시용 고유 id */
  id: string;
  agentId: string;
  /** 만들 당시의 요원 이름과 색(요원이 나중에 지워져도 기록은 남는다) */
  agentCallsign: string;
  agentColor: string;
  text: string;
  lang: Lang;
  /** 요원 기본 빠르기에 곱한 배율 */
  rate: number;
  steps: number;
  radio: boolean;
  /** 실제로 쓴 시드. 같은 값을 다시 주면 같은 테이크가 나온다 */
  seed: number;
  /** 효과까지 입힌 최종 음성 */
  audio: PcmAudio;
  durationSec: number;
  /** 만드는 데 걸린 시간(ms) */
  elapsedMs: number;
  createdAt: number;
}

/** 지금 소리를 내고 있는(또는 준비 중인) 대상 */
export interface PlaybackState {
  /** 무엇을 트는지 가리키는 id. 대사는 linePlayId(), 스튜디오 결과는 resultPlayId() */
  id: string;
  /** preparing = 받아 오거나 만드는 중, playing = 소리가 나는 중 */
  phase: 'preparing' | 'playing';
}

/** 재생 버튼 하나가 보는 상태 */
export type PlayPhase = 'idle' | 'preparing' | 'playing';

/** AI 음성 엔진 상태의 화면용 사본 */
export interface EngineMirror {
  status: TtsEngineStatus;
  progress: ModelLoadProgress | null;
  /** 실패했을 때 보여 줄 말 */
  errorMessage: string | null;
}

export type ToastTone = 'info' | 'ok' | 'warn' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}
