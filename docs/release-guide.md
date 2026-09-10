# 스토어 출시 가이드 (폰만으로 진행)

> **먼저 읽어 주세요 — 출시 리스크**
>
> 1. 이 앱은 Riot 이 공식 제공하지 않는 상점 API 를 쓰고, 사용자의 Riot 로그인 세션을 다룹니다. Riot 개발자 정책은 비공식 API 사용과 로그인 정보 수집을 금지하고 있어, 스토어 심사 거절·출시 후 삭제 요청·사용자 계정 제재 가능성이 있습니다.
> 2. Google Play 와 App Store 는 제3자 서비스 로그인을 WebView 로 받는 앱을 엄격히 봅니다. 심사팀에게 테스트용 Riot 계정을 제공해야 하며, 거절될 수 있습니다.
> 3. 위 리스크를 감수하지 않으려면 지금처럼 GitHub Releases 의 APK 로 개인 사용하는 것이 가장 안전합니다.

## A. Google Play (Android) — 폰만으로 가능

### 1. 계정 준비 (1회)

| 항목 | 비용 | 비고 |
|---|---|---|
| Google Play Console 개발자 계정 | US$25 (1회) | https://play.google.com/console — 신분증 본인 확인 필요, 승인까지 1~2일 |
| Expo 계정 | 무료 | https://expo.dev — 서명 키 보관 및 클라우드 빌드 |

개인 개발자 계정(2023년 11월 이후 생성)은 프로덕션 출시 전에 **비공개 테스트에 테스터 12명 이상, 14일 연속** 참여가 필요합니다. 친구들에게 테스트 링크를 보내 두세요.

### 2. Expo 토큰을 GitHub 에 등록 (1회)

1. 폰 브라우저로 https://expo.dev 로그인 → 프로필 → **Account settings → Access tokens → Create token**
2. 토큰 문자열 복사
3. GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `EXPO_TOKEN`
   - Secret: 복사한 토큰

### 3. 출시용 AAB 만들기

1. GitHub 저장소 → **Actions → "Play 출시용 AAB (EAS)" → Run workflow**
2. 20~30분 뒤 완료되면 **Releases** 에 `play-N` 릴리스와 `.aab` 파일이 올라옵니다.
   - 첫 실행 때 EAS 가 서명 키(keystore)를 자동 생성해 Expo 계정에 보관합니다. 이후 빌드는 같은 키를 씁니다.
   - `.aab` 는 Play 업로드 전용이고 폰에 직접 설치되지 않습니다. 직접 설치용은 기존 `build-N` 릴리스의 `.apk` 입니다.

### 4. Play Console 에서 앱 등록

1. **앱 만들기** — 이름은 `docs/store-listing.md` 참고, 무료 앱, 기본 언어 한국어
2. **대시보드 → 앱 설정** 항목을 순서대로 완료
   - 개인정보처리방침 URL: `docs/privacy-policy.md` 의 연락 이메일을 채운 뒤 아래 주소 사용
     `https://github.com/goraneycomeend/-comeend/blob/main/docs/privacy-policy.md`
     (main 브랜치에 병합한 뒤 사용하거나, 현재 브랜치 경로로 바꿔도 됩니다)
   - 앱 액세스: "일부 기능 제한됨" → 테스트용 Riot 계정 아이디/비밀번호 입력 (2단계 인증 꺼진 계정)
   - 광고: 없음 / 콘텐츠 등급 설문 / 타겟층: 만 18세 이상 권장 / 데이터 보안: `store-listing.md` 참고
3. **스토어 등록정보** — 설명, 아이콘 512×512, 그래픽 이미지 1024×500, 스크린샷 2장 이상
4. **테스트 → 비공개 테스트 → 새 버전 만들기** → Play 앱 서명 사용 동의 → `.aab` 업로드 → 테스터 이메일 목록 등록 → 출시
5. 테스터 12명 × 14일 조건 충족 후 **프로덕션 → 액세스 신청** → 심사 (보통 며칠)

### 5. 업데이트

코드를 고친 뒤 3번을 다시 실행하면 버전 코드가 자동으로 올라간 새 `.aab` 가 나옵니다. Play Console 에서 새 버전으로 업로드하세요.

## B. App Store (iOS)

폰만으로는 어렵고, 아래가 추가로 필요합니다.

| 항목 | 비용 | 비고 |
|---|---|---|
| Apple Developer Program | US$99/년 | https://developer.apple.com — 승인까지 1~2일 |
| App Store Connect API 키 | 무료 | EAS 가 인증서·프로비저닝을 자동 관리하도록 하는 데 필요 |

진행 순서(컴퓨터 1회 필요):

1. App Store Connect 에서 앱 등록 (Bundle ID `com.comeend.skinjigi`)
2. 컴퓨터에서 `eas build --platform ios --profile production` 실행 → Apple 계정 로그인 → EAS 가 인증서 자동 생성
3. `eas submit --platform ios` 로 TestFlight 업로드 → App Store Connect 에서 심사 제출
4. 심사 노트에 테스트용 Riot 계정을 반드시 기재

iOS 는 백그라운드 실행 시점을 보장하지 않으므로 심사 노트에 "상점 갱신 리마인더" 기능을 함께 설명하면 좋습니다.

## C. 체크리스트

- [ ] `docs/privacy-policy.md` 연락 이메일 채우기
- [ ] 앱 이름에서 Riot 상표 제거 여부 결정 (`app.json` → `expo.name`)
- [ ] 스크린샷 4장, 아이콘 512×512, 그래픽 이미지 1024×500 준비
- [ ] 심사용 Riot 테스트 계정 준비 (2단계 인증 끄기)
- [ ] 비공개 테스터 12명 모집
