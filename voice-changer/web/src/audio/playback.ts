type SinkContext = AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void> };

/**
 * 서버에서 돌아온 Float32 청크를 끊기지 않게 이어 붙여 재생한다.
 * 청크가 늦게 오면(언더런) startDelay 만큼 다시 여유를 두고 이어 간다.
 */
export class StreamPlayer {
  readonly ctx: SinkContext;
  private readonly gain: GainNode;
  private nextTime = 0;
  private readonly startDelay: number;
  underruns = 0;

  constructor(sampleRate: number, startDelayMs = 80) {
    this.ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' }) as SinkContext;
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.startDelay = startDelayMs / 1000;
  }

  async setSink(deviceId: string): Promise<void> {
    if (!this.ctx.setSinkId) return;
    await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  setVolume(v: number): void {
    this.gain.gain.value = Math.max(0, Math.min(2, v));
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  push(samples: Float32Array): void {
    if (samples.length === 0 || this.ctx.state === 'closed') return;
    const buf = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buf.getChannelData(0).set(samples);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    const now = this.ctx.currentTime;
    if (this.nextTime < now + 0.005) {
      if (this.nextTime !== 0) this.underruns++;
      this.nextTime = now + this.startDelay;
    }
    src.start(this.nextTime);
    this.nextTime += buf.duration;
  }

  /** 아직 재생되지 않고 쌓여 있는 오디오 길이 (ms) */
  get bufferedMs(): number {
    return Math.max(0, (this.nextTime - this.ctx.currentTime) * 1000);
  }

  async close(): Promise<void> {
    if (this.ctx.state !== 'closed') {
      try {
        await this.ctx.close();
      } catch {
        /* 이미 닫힘 */
      }
    }
  }
}
