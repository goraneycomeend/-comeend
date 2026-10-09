import type { AgentsResponse } from './types';

export async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
  return (await res.json()) as AgentsResponse;
}

export async function convertClip(wav: Blob, agent: string, pitch: number): Promise<{ blob: Blob; engine: string }> {
  const form = new FormData();
  form.append('file', wav, 'clip.wav');
  form.append('agent', agent);
  form.append('pitch', String(pitch));
  const res = await fetch('/api/convert', { method: 'POST', body: form });
  if (!res.ok) {
    let detail = `변환 실패 (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* 본문이 JSON 이 아니면 상태 코드만 */
    }
    throw new Error(detail);
  }
  return { blob: await res.blob(), engine: res.headers.get('X-Engine') ?? '?' };
}

export interface StreamParams {
  agent: string;
  sr: number;
  pitch: number;
  gate: number;
  context: number;
  xfade: number;
}

export function streamUrl(p: StreamParams): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({
    agent: p.agent,
    sr: String(p.sr),
    pitch: String(p.pitch),
    gate: String(p.gate),
    context: String(p.context),
    xfade: String(p.xfade),
  });
  return `${proto}://${location.host}/ws/stream?${q.toString()}`;
}
