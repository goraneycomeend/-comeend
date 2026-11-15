# 콜사인

오리지널 요원들이 저마다 다른 목소리로 말하는 음성 앱입니다.
글을 적으면 요원 목소리로 읽어 주는 AI 음성 합성과, 마이크 소리에 바로 효과를 입히는 보이스 체인저가 들어갑니다.
둘 다 기기 안에서만 돕니다. 적은 글도, 마이크 소리도 밖으로 나가지 않습니다.

> 아직 만드는 중입니다. 지금은 프로젝트 뼈대와 준비 스크립트까지 들어 있습니다.

## 실행

Node 22.12 이상이 필요합니다.

```bash
npm install
npm run setup   # 음성 모델(약 145MB)과 wasm 런타임을 public/ 아래에 준비
npm run dev
```

`npm run setup` 은 처음 한 번이면 됩니다. 다시 돌려도 이미 받은 것이 멀쩡하면 건너뜁니다.
`dev` 나 `build` 가 알아서 받아 주지는 않으니, 처음에는 꼭 직접 돌려 주세요.

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run setup` | 아래 두 스크립트를 차례로 실행 |
| `node scripts/copy-ort.mjs` | onnxruntime-web 의 wasm 런타임 2개를 `public/ort/` 로 복사 |
| `node scripts/fetch-models.mjs` | 음성 모델을 받아 `public/models/` 에 12MiB 조각과 `manifest.json` 으로 저장 (`--check` 검사만, `--force` 다시 만들기) |
| `npm run dev` | 개발 서버 |
| `npm run build` | `dist/` 에 정적 빌드 (상대 경로라 어느 주소 아래에 올려도 열립니다) |
| `npm run preview` | 빌드 결과 미리 보기 |
| `npm test` | 단위 테스트 (vitest, `tests/`) |
| `npm run e2e` | 브라우저 테스트 (Playwright, `e2e/`). 먼저 빌드해 두어야 합니다 |
| `npm run typecheck` | 타입 검사 |

## 폴더

```
scripts/      준비 스크립트
public/       models/ 와 ort/ 는 setup 이 만드는 것이라 저장소에 넣지 않습니다
src/core/     화면과 무관한 핵심 코드. types.ts 가 모듈 사이의 약속입니다
src/engine/   브라우저에서 도는 부분 (음성 합성 워커, 재생, 마이크)
src/app/      상태와 화면이 쓰는 서비스
src/ui/       화면
tests/        단위 테스트
e2e/          브라우저 테스트
```

## 음성 모델

Supertone 의 Supertonic 3 를 씁니다. 모델 라이선스는 OpenRAIL-M 입니다.
가중치는 sherpa-onnx 가 int8 로 변환한 것(약 145MB)을 npm 레지스트리에서 받고,
받은 tarball 은 sha512 로, 합친 파일은 크기와 sha256 으로 확인합니다. 값은 `scripts/fetch-models.mjs` 에 고정해 두었습니다.
