// 음성 합성 코어의 공개 API. DOM 없이 import 할 수 있다(브라우저·Worker·Node 공용).

export {
  EXPRESSION_TAGS,
  PAUSE_SEC,
  chunkText,
  cleanText,
  maxChunkLength,
  pauseAfter,
  planChunks,
  preprocessText,
  tokenize,
} from './text.ts';
export type { ExpressionTag, TextChunk } from './text.ts';

export { MAX_BLEND_COMPONENTS, blendStyle, normalizeBlend, parseVoiceBank } from './voices.ts';
export type { BlendedStyle, VoiceBank } from './voices.ts';

export {
  DATA_FILES,
  MODEL_FILE_NAMES,
  SESSION_FILES,
  buildTtsAssets,
  parseIndexer,
  parseTtsConfig,
  releaseTtsAssets,
} from './ort.ts';
export type {
  BuildAssetsOptions,
  ModelFileSource,
  OrtLike,
  OrtRuntimeLike,
  OrtSessionLike,
  OrtTensorLike,
  TtsAssets,
  TtsConfig,
  TtsSessions,
} from './ort.ts';

export {
  DEFAULT_STEPS,
  MAX_TEXT_LENGTH,
  SPEED_MAX,
  SPEED_MIN,
  STEPS_MAX,
  STEPS_MIN,
  TtsInputError,
  createAbortError,
  createRng,
  createSynthesizer,
  fillGaussian,
  findAudibleRange,
  isAbortError,
  joinChunks,
  randomSeed,
} from './synth.ts';
export type { SynthesizeOptions, Synthesizer } from './synth.ts';

export {
  ModelLoadError,
  assembleModelFiles,
  createModelStore,
  httpPartReader,
  loadModelFiles,
  openModelStore,
  parseManifest,
  sha256Hex,
  sha256HexSync,
} from './modelStore.ts';
export type {
  ModelFetchOptions,
  ModelManifest,
  ModelManifestFile,
  ModelManifestPart,
  ModelStore,
  PartReader,
} from './modelStore.ts';
