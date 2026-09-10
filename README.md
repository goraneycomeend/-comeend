# 발로 스킨 알리미 (Valorant Skin Alert)

발로란트 계정을 **최대 4개** 연동해 두면, 매일 상점이 갱신될 때(UTC 00:00 = 한국 시간 09:00) 각 계정의 상점을 확인하고
**위시리스트에 등록한 스킨이 뜨면 휴대폰 알림**을 보내주는 앱입니다. 야시장(Night Market) 도 함께 확인합니다.

Expo(React Native) 로 만든 iOS / Android 앱이며, 별도 서버 없이 **모든 처리가 휴대폰 안에서** 이루어집니다.

## 주요 기능

- 라이엇 공식 로그인 페이지(WebView)로 계정 연동 — 캡차·2단계 인증도 그대로 통과, 비밀번호는 앱에 저장하지 않음
- 계정 최대 4개, 계정별 상태 표시(정상 / 재로그인 필요 / 오류)
- 위시리스트: 스킨 이름 검색(한국어) 으로 정확히 지정하거나, `리버` 같은 **키워드**로 시리즈 전체 등록
- 위시리스트를 모든 계정에 적용하거나 특정 계정에만 적용
- 오늘의 상점 + 야시장 화면(스킨 이미지, 가격, 등급, 위시 표시, 갱신 카운트다운)
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

## 시작하기

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

### 앱에서 할 일

1. **계정 탭 → 라이엇 계정 연동** → 라이엇 로그인 (계정마다 반복, 최대 4개)
2. **위시리스트 탭**에서 스킨 검색 후 추가 (또는 키워드 추가)
3. **설정 탭**에서 알림 권한 허용, 백그라운드 확인이 "켜짐"인지 확인
4. (선택) Discord 웹훅 URL 입력, 매일 요약 알림 / 상점 갱신 리마인더 켜기

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
