// 미리 보고 누르는 피크 리미터. 순수 함수라서 Node 에서도 돈다.

export interface LimiterOptions {
  /** 피크가 오기 전에 미리 줄이기 시작하는 시간(ms). 기본 5 */
  lookaheadMs?: number;
  /** 눌렀던 게인이 돌아오는 시간(ms). 기본 80 */
  releaseMs?: number;
}

/**
 * 어떤 샘플도 ceiling 을 넘지 않게 한다. 넘는 곳이 없으면 입력과 똑같은 복사본을 돌려준다.
 * 급하게 자르지 않고 피크 앞뒤로 게인을 부드럽게 내렸다 올리므로 찌그러지는 소리가 나지 않는다.
 */
export function limitPeaks(
  samples: Float32Array,
  sampleRate: number,
  ceiling = 0.891,
  opts: LimiterOptions = {},
): Float32Array<ArrayBuffer> {
  const n = samples.length;
  const out = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(samples[i]) ? samples[i] : 0;
    out[i] = v;
    const av = v < 0 ? -v : v;
    if (av > max) max = av;
  }
  if (max <= ceiling || n === 0) return out;

  const look = Math.max(1, Math.round(((opts.lookaheadMs ?? 5) / 1000) * sampleRate));
  const release = Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate));

  // 1) 샘플마다 필요한 게인
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const av = out[i] < 0 ? -out[i] : out[i];
    need[i] = av > ceiling ? ceiling / av : 1;
  }

  // 2) 앞으로 look 샘플 안의 최솟값(단조 덱) → 피크보다 먼저 내려가기 시작한다
  const ahead = new Float32Array(n);
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const end = Math.min(n - 1, i + look);
    while (next <= end) {
      while (tail > head && need[deque[tail - 1]] >= need[next]) tail--;
      deque[tail++] = next++;
    }
    while (deque[head] < i) head++;
    ahead[i] = need[deque[head]];
  }

  // 3) 내려갈 때는 바로, 올라올 때는 천천히
  let g = 1;
  for (let i = 0; i < n; i++) {
    const recovered = 1 - (1 - g) * release;
    g = ahead[i] < recovered ? ahead[i] : recovered;
    ahead[i] = g;
  }

  // 4) 지난 look 샘플의 평균으로 모서리를 둥글게. 평균에 들어가는 값은 모두 그 샘플에 필요한 게인 이하라서 넘치지 않는다
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ahead[i];
    if (i > look) sum -= ahead[i - look - 1];
    const count = i < look ? i + 1 : look + 1;
    let gain = sum / count;
    if (gain > need[i]) gain = need[i]; // 부동소수 오차 대비
    out[i] *= gain;
  }
  return out;
}
