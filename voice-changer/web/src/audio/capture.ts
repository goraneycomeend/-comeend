export interface CaptureOptions {
  deviceId?: string;
  chunkMs: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const WORKLET_URL = '/worklet/capture-processor.js';

/** 마이크 → AudioWorklet 으로 Float32 청크를 꺼내 준다. */
export class MicCapture {
  ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;

  onChunk: ((samples: Float32Array) => void) | null = null;
  onLevel: ((rms: number) => void) | null = null;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(opts: CaptureOptions): Promise<void> {
    if (this.ctx) await this.stop();
    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        channelCount: 1,
        noiseSuppression: opts.noiseSuppression,
        echoCancellation: opts.echoCancellation,
        autoGainControl: opts.autoGainControl,
        sampleRate: 48000,
      },
      video: false,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(WORKLET_URL);
    const chunkSize = Math.max(1024, Math.round((this.ctx.sampleRate * opts.chunkMs) / 1000));
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { chunkSize, levelEvery: Math.round(this.ctx.sampleRate / 20) },
    });
    this.node.port.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; samples?: Float32Array; rms?: number };
      if (msg.type === 'chunk' && msg.samples) this.onChunk?.(msg.samples);
      else if (msg.type === 'level' && typeof msg.rms === 'number') this.onLevel?.(msg.rms);
    };
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination); // 워크릿 출력은 무음
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setChunkMs(ms: number): void {
    if (!this.node || !this.ctx) return;
    this.node.port.postMessage({ type: 'chunkSize', value: Math.max(1024, Math.round((this.ctx.sampleRate * ms) / 1000)) });
  }

  async stop(): Promise<void> {
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    const ctx = this.ctx;
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close();
      } catch {
        /* 이미 닫힘 */
      }
    }
  }
}

export interface DeviceLists {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

export async function listDevices(): Promise<DeviceLists> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === 'audioinput'),
    outputs: all.filter((d) => d.kind === 'audiooutput'),
  };
}

/** 장치 라벨은 마이크 권한을 받은 뒤에만 보이므로, 한 번 열었다가 바로 닫는다. */
export async function requestMicPermission(): Promise<void> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((t) => t.stop());
}

export function supportsOutputSelection(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}
