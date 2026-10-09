import { streamUrl, type StreamParams } from '../api';
import type { StreamStats } from '../types';

export interface StreamEvents {
  onAudio: (samples: Float32Array, rttMs: number) => void;
  onStats: (stats: StreamStats) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

/** /ws/stream 과 Float32 PCM 청크를 주고받는다. */
export class VoiceStream {
  private ws: WebSocket | null = null;
  private sendTimes: number[] = [];
  private events: StreamEvents;
  closedByUser = false;

  constructor(events: StreamEvents) {
    this.events = events;
  }

  connect(params: StreamParams): Promise<StreamStats> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(streamUrl(params));
      ws.binaryType = 'arraybuffer';
      let ready = false;
      ws.onopen = () => {
        /* ready 메시지를 기다린다 */
      };
      ws.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
          const sent = this.sendTimes.shift();
          const rtt = sent === undefined ? 0 : performance.now() - sent;
          this.events.onAudio(new Float32Array(e.data), rtt);
          return;
        }
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(e.data)) as Record<string, unknown>;
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          ready = true;
          const stats = msg as unknown as StreamStats;
          this.events.onStats(stats);
          resolve(stats);
        } else if (msg.type === 'stats') {
          this.events.onStats(msg as unknown as StreamStats);
        } else if (msg.type === 'error') {
          this.events.onError(String(msg.message ?? '알 수 없는 오류'));
        }
      };
      ws.onerror = () => {
        if (!ready) reject(new Error('서버에 연결할 수 없습니다. Python 서버(8765)가 켜져 있는지 확인하세요.'));
      };
      ws.onclose = (ev) => {
        if (!ready) reject(new Error(ev.reason || '연결이 거부됐습니다'));
        this.events.onClose();
      };
      this.ws = ws;
    });
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(samples: Float32Array): void {
    if (!this.connected || !this.ws) return;
    // 네트워크/서버가 밀리면 보낸 만큼 돌아오지 않은 청크가 쌓인다. 4개 이상 밀리면 버려서 지연이 누적되지 않게 한다.
    if (this.sendTimes.length >= 4) return;
    this.sendTimes.push(performance.now());
    this.ws.send(samples.buffer as ArrayBuffer);
  }

  set(update: { agent?: string; pitch?: number; gate?: number }): void {
    if (!this.connected || !this.ws) return;
    this.ws.send(JSON.stringify({ type: 'set', ...update }));
  }

  close(): void {
    this.closedByUser = true;
    const ws = this.ws;
    this.ws = null;
    this.sendTimes = [];
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'bye');
  }
}
