# 중국앱 통역노트

상하이·중국 여행 중 위챗, 알리페이, 메이퇀, 따종디엔핑, 디디, 가오더지도 화면을 번역해 주는 안드로이드 앱.

- **자동 번역**: 접근성 권한을 켜 두면 위챗·알리페이·메이퇀·따종디엔핑·디디·가오더지도·어러머·타오바오·12306 을 열 때 화면의 중국어 글자 위에 한국어 라벨이 뜸. 용어집 단어는 즉시, 나머지는 "AI로 번역"을 켠 경우 Claude 로 번역 후 기억. 오른쪽 `译` 버튼: 탭=라벨 켜기/끄기, 끌기=위치 이동, 길게=앱 열기
- **화면 번역**: 스크린샷을 고르거나, 다른 앱에서 **공유 → 통역노트로 번역**을 누르면 Claude 가 화면 글자 뜻과 눌러야 할 버튼을 알려줌 (본인 Claude API 키 필요)
- **용어집**: 앱별 버튼·메뉴 용어 약 220개, 한국어/중국어/병음 검색, 중국어 발음 듣기 (오프라인)
- **보여주기**: 직원·기사에게 크게 띄워 보여주는 중국어 문장 카드 (오프라인)

## 설치

1. [Releases](https://github.com/goraneycomeend/-comeend/releases) 에서 가장 최근 **중국앱 통역노트 빌드 #N** 의 `tongyeok-N.apk` 다운로드 → 설치
2. 앱 실행 → 화면 번역 탭에서 Claude API 키 저장 ([console.anthropic.com](https://console.anthropic.com/settings/keys) 에서 발급, 사용량만큼 과금)
3. 자동 번역: 앱의 **자동 번역 켜기** → 접근성 → 중국앱 자동 번역 → 사용. Android 13 이상에서 "제한된 설정"으로 막히면 앱 정보 → ⋮ → 제한된 설정 허용 후 다시
4. 발음 듣기가 안 되면: 휴대폰 설정 → 텍스트 음성 변환 → 중국어(简体) 음성 데이터 설치

중국 현지 유심/와이파이에서는 Anthropic API 접속이 막힐 수 있음. 한국 통신사 로밍·로밍 eSIM 으로 쓰는 것을 권장. 용어집과 보여주기는 인터넷 없이 동작.

## 구조

- `index.html` — 화면 전체(웹). claude.ai 아티팩트로도 게시됨
- `sync-web.sh` — `index.html` 을 APK 에셋(`android/app/src/main/assets/index.html`)과 `offline.html` 로 복사
- `android/` — WebView 앱(Java). `ClaudeTranslator.java` 가 Anthropic Java SDK 로 Claude 호출, `MainActivity.java` 가 공유 받기·TTS·파일 선택 처리, `AutoTranslateService.java` 가 중국 앱 화면 위 자동 번역 라벨(용어집 `Glossary.java` + Claude 번역 캐시 `TranslationCache.java`)
- `.github/workflows/tongyeok-apk.yml` — 이 폴더가 바뀌면 APK 빌드 후 프리릴리스로 게시

`android/app/tongyeok.keystore` 는 업데이트 덮어쓰기용 사이드로드 서명 키(비밀번호 `tongyeok`)라 공개되어 있음. 스토어 배포용이 아님.
