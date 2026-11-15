// 시드가 같으면 같은 수열을 내는 난수. 임펄스 응답과 잡음 버퍼가 매번 같게 만들어지도록 쓴다.

/** mulberry32. 0 이상 1 미만 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 평균 0, 분산 1 인 정규 분포 난수 */
export function seededGaussian(seed: number): () => number {
  const rand = seededRandom(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    while (u < 1e-12) u = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * rand();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}
