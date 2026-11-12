#!/usr/bin/env bash
# index.html(claude.ai 아티팩트용 본문)을 완전한 HTML 문서로 감싸
#  - android/app/src/main/assets/index.html (APK 에 들어가는 화면)
#  - offline.html (브라우저에서 바로 여는 오프라인용)
# 두 곳에 복사한다. index.html 을 고친 뒤 실행할 것.
set -euo pipefail
cd "$(dirname "$0")"
wrap() {
  printf '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n'
  cat index.html
  printf '\n</body></html>\n'
}
mkdir -p android/app/src/main/assets
wrap > android/app/src/main/assets/index.html
wrap > offline.html
echo "synced"
