// 음향 처리 모듈의 공개 API.
export {
  FX_GROUPS,
  FX_PARAMS,
  NATURAL_FX_LIMITS,
  NEUTRAL_FX,
  clampFx,
  formatFxValue,
  isNaturalFx,
  isNeutralFx,
  toNaturalFx,
} from './fxSchema.ts';
export type { FxGroup, FxGroupDef, FxParamDef } from './fxSchema.ts';

export { createLiveChain, renderVoice } from './render.ts';
export { buildFxGraph, fxTailSec } from './fxGraph.ts';
export type { FxGraph, FxGraphOptions } from './fxGraph.ts';
export { needsPitch, shiftPitch } from './pitch.ts';
export type { ShiftPitchOptions } from './pitch.ts';

export { finishSpeech } from './finish.ts';
export type { FinishOptions } from './finish.ts';
export { limitPeaks } from './limiter.ts';

export { decodeWav, encodeWav, encodeWavBytes } from './wav.ts';
export { encodeMp3, encodeMp3Bytes } from './mp3.ts';
export { decodeAudio } from './decode.ts';
export { resample } from './resample.ts';

export { activeRms, bandLevelDb, bestLag, correlation, estimateF0, f0Frames, fromDb, peak, rms, toDb } from './analysis.ts';
export type { F0Options } from './analysis.ts';
