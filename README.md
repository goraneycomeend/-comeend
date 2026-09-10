<p align="center">
  <img src="assets/icon.png" width="120" alt="스킨지기 아이콘">
</p>

<h1 align="center">스킨지기</h1>

<p align="center">
  VALORANT 계정을 최대 5개 등록해 두면, 매일 상점이 갱신될 때 확인해서<br>
  <b>위시리스트에 담은 스킨이 뜨면 휴대폰으로 알림</b>을 보내주는 안드로이드 앱
</p>

<p align="center">
  <a href="https://github.com/goraneycomeend/-comeend/releases/latest"><b>📥 최신 APK 다운로드</b></a>
</p>

> 스토어에는 올리지 않는 개인 제작 앱입니다. Riot Games 와 무관한 비공식 앱이며, Riot 이 공식 제공하지 않는 API 를 사용합니다.
> 사용에 따른 책임은 본인에게 있으며, Riot 정책 변경으로 언제든 동작이 멈출 수 있습니다.

## 설치 (안드로이드)

1. 폰에서 [최신 릴리스](https://github.com/goraneycomeend/-comeend/releases/latest) 페이지를 열고 `skinjigi-N.apk` 를 눌러 다운로드
2. 파일을 열면 "출처를 알 수 없는 앱" 경고가 뜹니다 → 브라우저의 설치 허용을 켜고 설치
3. 앱 실행 → **계정** 탭에서 라이엇 로그인 (계정마다 반복) → **위시리스트** 에 스킨 등록 → **설정** 에서 알림 권한 허용
4. 삼성 등 배터리 절전이 강한 기기는 설정 → 배터리에서 이 앱을 절전 대상에서 제외 (안 하면 자동 알림이 늦거나 안 올 수 있음)

업데이트는 새 APK 를 기존 앱 위에 덮어 설치하면 되고, 데이터는 유지됩니다.
iOS 는 빌드 파일을 제공하지 않습니다. 직접 빌드하려면 아래 [개발](#개발) 항목을 참고하세요.

## 주요 기능

- 라이엇 공식 로그인 페이지(WebView)로 계정 연동 — 캡차·2단계 인증도 그대로 통과, 비밀번호는 앱에 저장하지 않음
- 계정 최대 5개, 계정별 상태 표시(정상 / 재로그인 필요 / 오류)
- 위시리스트: 스킨 이름 검색(한국어) 으로 정확히 지정하거나, `리버` 같은 **키워드**로 시리즈 전체 등록
- 위시리스트를 모든 계정에 적용하거나 특정 계정에만 적용
- 오늘의 상점 + 야시장 화면(스킨 이미지, 가격, 등급, 위시 표시, 갱신 카운트다운, VP 잔액)
- 야시장이 새로 열리면 할인 목록 알림(옵션), 위시리스트에 "지금 상점에 있음" 표시
- 일시적 네트워크 오류는 자동 재시도, 알림을 누르면 상점 화면으로 이동
- 백그라운드 자동 확인 (Android WorkManager / iOS BGTaskScheduler) + 앱을 열 때마다 확인
- 로컬 푸시 알림, 선택적으로 Discord 웹훅으로도 동시 전송
- 같은 로테이션에서 같은 스킨은 한 번만 알림 (중복 방지)
- 세션 만료 시 "다시 로그인 필요" 알림 (하루 1회)
- 알림 기록, 매일 상점 요약 알림(옵션), 상점 갱신 리마인더(옵션)

## 동작 원리

```
[WebView 라이엇 로그인] → 리다이렉트 URL 에서 access_token 획득 + ssid 쿠키 → SecureStore 에 ssid 저장
                                                     │
[백그라운드 태스크 / 앱 열림 / 수동 새로고침] ──────────┘
   └→ ssid 로 재인증(1시간짜리 토큰 발급) → entitlements → pd.{shard}.a.pvp.net/store/v3/storefront
   └→ valorant-api.com 스킨 카탈로그로 이름·이미지·등급 매핑
   └→ 위시리스트 대조 → 새 매칭이면 로컬 알림(+Discord) → 기록 저장
```

- 로테이션 키(`daily:YYYY-MM-DD`)로 "이미 확인한 상점"을 기억해, 백그라운드 실행이 여러 번 돼도 네트워크 요청과 알림이 중복되지 않습니다.
- 토큰(1시간)은 메모리에만 두고, 오래 가는 `ssid` 쿠키만 기기 보안 저장소(Keychain / Keystore)에 저장합니다.

## 직접 빌드하기

> Expo Go 로는 실행할 수 없습니다. 백그라운드 태스크·쿠키 접근·SecureStore 가 네이티브 모듈이라 **개발 빌드(Dev Client) 또는 EAS 빌드**가 필요합니다.

```bash
npm install

# Android (Android Studio + 에뮬레이터 또는 USB 연결 기기)
npx expo run:android

# iOS (macOS + Xcode)
npx expo run:ios
```

설치형 APK / IPA 가 필요하면 EAS 빌드를 사용합니다.

```bash
npm i -g eas-cli
eas login
eas build --platform android --profile preview   # APK
eas build --platform ios                          # TestFlight 등
```

GitHub Actions 는 이 저장소에 푸시될 때마다 APK 를 빌드해 Releases 에 올립니다 (`.github/workflows/android-apk.yml`).

## 스토어 출시 (하지 않음)

스토어에는 올리지 않기로 했습니다. 참고용으로 남겨 둔 절차와 문서는 `docs/release-guide.md`, `docs/store-listing.md`, `docs/privacy-policy.md` 를 참고하세요.
GitHub Actions 의 **Play 출시용 AAB (EAS)** 워크플로우가 Play Console 업로드용 App Bundle 을 만들어 Releases 에 올립니다 (`EXPO_TOKEN` 시크릿 필요).

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest (토큰 파싱, 상점 파싱, 위시리스트 매칭)
```

```
app/                  expo-router 화면
  _layout.tsx         루트: 백그라운드 태스크 등록, 앱 활성화 시 확인
  (tabs)/index.tsx    오늘의 상점
  (tabs)/wishlist.tsx 위시리스트
  (tabs)/accounts.tsx 계정
  (tabs)/history.tsx  알림 기록
  (tabs)/settings.tsx 설정
  login.tsx           라이엇 WebView 로그인
src/
  riot/tokens.ts      리다이렉트 URL 토큰 파싱, 지역→샤드 (순수 함수)
  riot/auth.ts        ssid 재인증, entitlements, userinfo, 지역 조회
  riot/store.ts       상점 조회·파싱·로테이션 키·카탈로그 매핑
  riot/catalog.ts     valorant-api.com 스킨/등급 카탈로그, 검색
  riot/cookies.ts     네이티브 쿠키 저장소 읽기/비우기
  matcher.ts          위시리스트 매칭
  checker.ts          계정별 확인 파이프라인, 계정 연동/해제
  notify.ts           로컬 알림, Discord 웹훅, 리마인더
  background.ts       expo-background-task 정의/등록
  store.ts            zustand + AsyncStorage 영속 상태
  storage/secure.ts   SecureStore(ssid)
test/                 vitest 단위 테스트
```

## 알아두어야 할 점

- **비공식 API**: 라이엇은 상점 API 를 공식 제공하지 않습니다. 이 앱은 게임 클라이언트가 쓰는 비공개 엔드포인트를 사용하며, 라이엇 정책 변경으로 언제든 동작이 멈출 수 있고 이용약관 위반 소지가 있습니다. 개인 용도로만 사용하세요. Riot Games 와 무관합니다.
- **백그라운드 실행 시점**은 OS 가 정합니다. Android 는 배터리 최적화 제외 시 안정적이고, iOS 는 지연될 수 있어 "상점 갱신 리마인더"를 함께 켜는 것을 권장합니다. 앱을 열면 항상 즉시 확인합니다.
- **세션 만료**: ssid 쿠키는 보통 몇 주~몇 달 유지되지만 비밀번호 변경·기기 정리 등으로 만료되면 "다시 로그인 필요" 알림이 오고, 계정 탭에서 다시 로그인하면 됩니다.
- **Android 쿠키 공유**: RN 의 fetch 는 WebView 와 쿠키 저장소를 공유하므로, 앱은 계정별 요청 전후로 라이엇 쿠키를 비워 계정이 섞이지 않게 합니다.
- 스킨 이름·이미지는 [valorant-api.com](https://valorant-api.com) 을 사용하며, 언어는 설정의 카탈로그 언어(기본 `ko-KR`)를 따릅니다.

## 라이선스

MIT
