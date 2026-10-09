export type Role = 'duelist' | 'initiator' | 'controller' | 'sentinel';

export interface Agent {
  id: string;
  name: string;
  nameEn: string;
  role: Role;
  roleKo: string;
  color: string;
  /** RVC 모델 파일이 준비돼 있는지 */
  ready: boolean;
  /** 이 요원에 실제로 쓰일 엔진 */
  engine: 'rvc' | 'dsp';
  dsp: { pitch: number; formant: number; fx: string | null };
}

export interface EngineInfo {
  mode: string;
  active: { name: string; device: string; label: string };
  rvcAvailable: boolean;
  rvcError: string | null;
}

export interface AgentsResponse {
  engine: EngineInfo;
  agents: Agent[];
}

export interface StreamStats {
  chunks: number;
  skipped: number;
  processMs: number;
  avgProcessMs: number;
  engine: string;
  agent: string;
}

export const ROLE_ORDER: Role[] = ['duelist', 'initiator', 'controller', 'sentinel'];
