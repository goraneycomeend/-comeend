<h1 align="center">요원보이스</h1>

<p align="center">
  마이크로 말하면 <b>VALORANT 요원 목소리</b>로 바꿔 주는 실시간 음성 변환 앱<br>
  Python 변환 서버 + 브라우저 UI · 요원별 RVC 모델 · 모델이 없어도 DSP 폴백으로 동작
</p>

> 비공식 팬 제작 도구이며 Riot Games 와 무관합니다. 요원 목소리는 **실제 성우의 음성**이므로, 변환 결과는 개인 게임·방송 용도로만 쓰고 타인을 속이거나 상업적으로 이용하지 마세요.
> 이 저장소에는 요원 음성 모델이 **포함되어 있지 않습니다** (아래 [모델 준비](#2-요원-모델-준비-rvc) 참고).

## 어떻게 동작하나

```
[브라우저]  마이크 → AudioWorklet (300~500ms 청크) ──WebSocket──▶ [Python 서버]
                                                                      │  요원별 엔진 선택
                                                                      ├─ RVC 엔진: 요원 .pth/.index 모델로 음색 변환 (GPU 권장)
                                                                      └─ DSP 폴백: 피치·포먼트·효과만 변환 (모델 없을 때)
            스피커 또는 가상 케이블(VB-CABLE) ◀── 변환된 PCM ◀─────────┘
                        │
            [VALORANT / Discord] 마이크 = 가상 케이블 Output
```

- **실시간 모드**: 청크 단위로 변환해 돌려줍니다. 이전 청크 꼬리를 문맥으로 붙이고 경계를 크로스페이드해 끊김을 줄입니다.
- **녹음 후 변환 모드**: 버튼을 누르고 있는 동안 녹음 → 한 번에 변환 → 재생/WAV 저장. 지연이 상관없을 때 품질이 가장 좋습니다.
- **엔진 자동 선택**: 요원 모델 파일이 있으면 RVC, 없으면 그 요원만 DSP 폴백. UI 의 카드 배지(`RVC`/`DSP`)로 구분됩니다.

## 솔직한 한계

- **"AI 인지 전혀 모를 정도"는 보장할 수 없습니다.** 좋은 RVC 모델 + GPU + 적절한 청크 길이면 음색은 상당히 비슷해지지만, 억양·말투·호흡은 본인 연기에 달려 있고, 실시간 변환은 음질을 어느 정도 희생합니다. 녹음 후 변환이 더 자연스럽습니다.
- **모델은 직접 준비해야 합니다.** 게임 음성 파일은 Riot 의 저작물이고 성우의 음성권이 걸려 있어 이 저장소에서 배포하지 않습니다.
- **RVC 는 NVIDIA GPU 가 사실상 필수**입니다. CPU 로도 돌지만 청크당 수 초가 걸려 실시간은 불가능하고, 녹음 후 변환만 쓸 만합니다.
- DSP 폴백은 "목소리를 바꾸는" 수준이지 요원과 닮게 만들지는 못합니다.

## 1. 설치 및 실행

요구 사항: Python 3.10+, Node.js 20+, Chrome/Edge (출력 장치 선택 기능 때문에 권장)

```bash
cd voice-changer

# 서버
cd server
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m agent_voice                                     # http://127.0.0.1:8765

# 웹 UI (다른 터미널)
cd ../web
npm install
npm run build        # → web/dist, 서버가 자동으로 서빙 → http://127.0.0.1:8765 접속
# 개발 중이면: npm run dev  → http://localhost:5173 (api/ws 는 8765 로 프록시)
```

브라우저에서 요원을 고르고 **변환 시작**을 누르면 됩니다. 처음엔 DSP 폴백 배너가 뜨는 게 정상입니다.

## 2. 요원 모델 준비 (RVC)

이 앱의 "요원과 비슷한 목소리"는 전부 **RVC(Retrieval-based Voice Conversion) 모델**에서 나옵니다. 요원별로 `.pth`(필수) 와 `.index`(선택, 있으면 유사도 ↑) 파일이 필요합니다.

1. RVC 의존성 설치 (Python 3.10~3.11 가상환경 권장)
   ```bash
   # CUDA 에 맞는 torch 먼저 (예: CUDA 12.x)
   pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
   pip install -r requirements-rvc.txt
   ```
2. 모델 파일을 `server/models/` 에 넣습니다. 파일 이름은 `server/agents.json` 의 `model` / `index` 와 맞추면 됩니다 (기본: `models/jett.pth`, `models/jett.index` …).
3. 서버를 다시 시작하면 해당 요원 카드가 `RVC` 배지로 바뀝니다. `/api/agents` 에서 `ready: true` 로 확인할 수 있습니다.

모델을 구하는 방법은 두 가지입니다.

- **직접 학습**: [RVC WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) 로 요원별 깨끗한 음성 샘플(배경음 없는 대사, 10분 이상 권장)을 학습합니다. 음성 샘플의 저작권·사용 범위는 본인이 확인하세요.
- **공개 모델 사용**: 커뮤니티에 올라온 RVC v2 모델을 내려받아 넣습니다. 출처와 이용 조건을 반드시 확인하세요.

품질 조정은 `agents.json` 의 `pitch`(요원별 반음 보정) 와 `server/agent_voice/engines/rvc.py` 의 `DEFAULT_PARAMS`(`index_rate`, `protect`, `f0method`) 로 합니다. `index_rate` 를 올리면 모델 음색에 가까워지고, 내리면 발음이 또렷해집니다.

## 3. 게임·디스코드에서 쓰기 (가상 마이크)

브라우저가 내는 소리를 게임이 "마이크"로 받게 하려면 가상 오디오 케이블이 필요합니다.

1. [VB-CABLE](https://vb-audio.com/Cable/) (Windows) 또는 BlackHole (macOS) 설치
2. 요원보이스 **출력** 을 `CABLE Input` 으로 선택 (이 기능은 Chrome/Edge 에서 동작)
3. VALORANT / Discord 의 마이크(입력 장치)를 `CABLE Output` 으로 설정
4. 내 귀로도 들으려면 **기본 스피커로도 함께 듣기(모니터)** 를 켜세요.

## 4. 지연 시간 줄이기

예상 지연 ≈ 청크 길이 + 서버 처리 시간 + 재생 버퍼. UI 의 상태 패널에 표시됩니다.

| 항목 | 권장 |
| --- | --- |
| 청크 길이 | RVC: 300~500ms, DSP: 200~300ms |
| GPU | RTX 3060 이상이면 400ms 청크를 50~150ms 안에 처리 |
| 브라우저 | Chrome/Edge, 다른 탭의 무거운 작업 피하기 |
| 노이즈 게이트 | 말하지 않을 때 변환을 건너뛰어 GPU 를 아낌 (`-55 dB` 기본) |

더 낮은 지연(100ms 이하)이 필요하면 전용 실시간 변환기인 [w-okada voice changer](https://github.com/w-okada/voice-changer) 에 같은 RVC 모델을 넣어 쓰는 것이 낫습니다. 이 앱은 설치가 쉽고 요원 선택·녹음 변환·브라우저만으로 동작하는 데 초점을 두었습니다.

## 설정 / API

환경 변수 (서버):

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `AGENT_VOICE_ENGINE` | `auto` | `auto` / `rvc` / `dsp`. `rvc` 는 RVC 가 없으면 시작 실패 |
| `AGENT_VOICE_DEVICE` | `auto` | `cuda:0` / `cpu` / `mps` |
| `AGENT_VOICE_MODELS` | `server/models` | 모델 디렉터리 |
| `AGENT_VOICE_AGENTS` | `server/agents.json` | 요원 설정 파일 |
| `AGENT_VOICE_HOST` / `PORT` | `127.0.0.1` / `8765` | 바인딩 주소 |

API (`/docs` 에 Swagger):

- `GET /api/status` — 엔진·장치
- `GET /api/agents` — 요원 목록, 모델 준비 여부
- `POST /api/convert` — `file`(WAV/FLAC/OGG), `agent`, `pitch` → WAV
- `WS /ws/stream?agent=jett&sr=48000&pitch=0&gate=-55` — Float32LE PCM 청크 ↔ 변환된 청크. 텍스트 프레임 `{"type":"set","agent":"omen","pitch":2}` 로 실행 중 변경

## 개발

```bash
cd server && pip install -r requirements-dev.txt && pytest     # DSP 엔진, REST, WebSocket 테스트
cd web && npm run typecheck && npm run build
```

```
server/
  agent_voice/main.py          FastAPI: REST, WebSocket, 정적 UI 서빙
  agent_voice/stream.py        실시간 세션: 문맥 붙이기, 크로스페이드, 노이즈 게이트
  agent_voice/engines/dsp.py   DSP 폴백 (위상 보코더 피치 이동 + 켑스트럼 포먼트 보정 + 효과)
  agent_voice/engines/rvc.py   RVC 엔진 (rvc-python, 요원별 모델 LRU 로드)
  agent_voice/agents.py        agents.json 로딩
  agents.json                  요원 28명: 이름·역할·색·모델 경로·DSP 프리셋
web/
  src/App.tsx                  화면: 요원 그리드, 장치 선택, 실시간/녹음 모드, 상태
  src/audio/capture.ts         getUserMedia + AudioWorklet 청크 캡처
  src/audio/playback.ts        끊김 없는 스트림 재생, 출력 장치(setSinkId)
  src/audio/stream.ts          WebSocket 송수신, 왕복 시간 측정
  public/worklet/              AudioWorklet 프로세서
```
