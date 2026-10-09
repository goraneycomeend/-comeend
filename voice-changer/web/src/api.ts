import type { Agent, AgentsResponse, InstallResponse } from './types';

export async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
  return (await res.json()) as AgentsResponse;
}

/** 모델(.pth/.zip) 과 선택적 .index 를 업로드해 설치한다. XHR 을 써서 업로드 진행률을 받는다. */
export function uploadModel(
  agentId: string,
  model: File,
  index: File | null,
  force: boolean,
  onProgress: (fraction: number) => void,
): Promise<InstallResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('model', model, model.name);
    if (index) form.append('index', index, index.name);
    form.append('force', force ? 'true' : 'false');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/models/${encodeURIComponent(agentId)}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new Error('업로드 중 연결이 끊어졌습니다'));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* 비 JSON 응답 */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as InstallResponse);
      else reject(new Error((body as { detail?: string } | null)?.detail ?? `설치 실패 (${xhr.status})`));
    };
    xhr.send(form);
  });
}

export async function deleteModel(agentId: string): Promise<Agent> {
  const res = await fetch(`/api/models/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
  if (!res.ok) {
    let detail = `삭제 실패 (${res.status})`;
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? detail;
    } catch {
      /* 본문 없음 */
    }
    throw new Error(detail);
  }
  return ((await res.json()) as { agent: Agent }).agent;
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
