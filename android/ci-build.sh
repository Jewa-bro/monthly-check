#!/usr/bin/env bash
# APK 빌드 (GitHub Actions 에서 실행).
# 고칠 일이 생기면 이 파일만 바꾼다 — 워크플로 파일은 손대지 않아도 되도록.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AND="$ROOT/android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"

echo "── 환경 ──────────────────────────────"
echo "ANDROID_HOME=$SDK"
java -version 2>&1 | head -1
gradle --version 2>/dev/null | grep -E '^Gradle' || echo "gradle: 없음"

if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  echo "::error::안드로이드 SDK 를 찾을 수 없습니다 (ANDROID_HOME 미설정)"
  exit 1
fi

# ── sdkmanager 찾기 (PATH 에 없는 경우가 많다) ──────────────────
SDKM=""
for c in "$(command -v sdkmanager 2>/dev/null || true)" \
         "$SDK/cmdline-tools/latest/bin/sdkmanager" \
         "$SDK/cmdline-tools/bin/sdkmanager" \
         "$SDK/tools/bin/sdkmanager"; do
  if [ -n "$c" ] && [ -x "$c" ]; then SDKM="$c"; break; fi
done
echo "sdkmanager=${SDKM:-없음}"

echo "── 이미 설치된 것 ────────────────────"
ls "$SDK/platforms" 2>/dev/null || echo "platforms 없음"
ls "$SDK/build-tools" 2>/dev/null || echo "build-tools 없음"

# ── 필요한 구성 요소 확보 ─────────────────────────────────────
need_install=()
[ -d "$SDK/platforms/android-33" ] || need_install+=("platforms;android-33")
# build-tools 는 33 이상이면 아무 버전이나 쓴다. 없을 때만 받는다
BUILD_TOOLS="$(ls "$SDK/build-tools" 2>/dev/null | sort -V | awk -F. '$1>=33' | tail -1 || true)"
if [ -z "$BUILD_TOOLS" ]; then need_install+=("build-tools;33.0.1"); fi

if [ ${#need_install[@]} -gt 0 ]; then
  if [ -z "$SDKM" ]; then
    echo "::error::${need_install[*]} 가 없는데 sdkmanager 도 없습니다"
    exit 1
  fi
  echo "── 설치: ${need_install[*]}"
  yes 2>/dev/null | "$SDKM" --licenses >/dev/null 2>&1 || true
  "$SDKM" "${need_install[@]}"
  BUILD_TOOLS="$(ls "$SDK/build-tools" | sort -V | awk -F. '$1>=33' | tail -1)"
fi
export BUILD_TOOLS
echo "쓸 build-tools=$BUILD_TOOLS"

# ── 앱 화면을 APK 안으로 복사 ─────────────────────────────────
# 원본은 저장소 루트의 index.html 하나. 두 곳에 두면 어긋난다.
# sw.js 는 넣지 않는다: 파일이 이미 APK 안에 있어 서비스워커가 필요 없고,
# 캐시가 오히려 옛 화면을 붙잡는다.
ASSETS="$AND/app/src/main/assets"
mkdir -p "$ASSETS"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" \
   "$ROOT/icon-192.png" "$ROOT/icon-512.png" \
   "$ROOT/apple-touch-icon.png" "$ROOT/favicon.png" "$ASSETS/"
echo "── APK 에 담을 파일 ──────────────────"
ls -l "$ASSETS"

# ── SDK 위치와 서명 키 ────────────────────────────────────────
echo "sdk.dir=$SDK" > "$AND/local.properties"

if [ -z "${KEYSTORE_BASE64:-}" ]; then
  echo "::error::ANDROID_KEYSTORE_BASE64 Secret 이 없습니다"
  exit 1
fi
echo "$KEYSTORE_BASE64" | base64 -d > "$AND/deliverycheck.keystore"
cat > "$AND/keystore.properties" <<EOF
storeFile=deliverycheck.keystore
storePassword=${STORE_PASSWORD:-}
keyAlias=${KEY_ALIAS:-}
keyPassword=${KEY_PASSWORD:-}
EOF
echo "서명 키 준비됨 ($(stat -c%s "$AND/deliverycheck.keystore") bytes)"

# ── 빌드 ──────────────────────────────────────────────────────
cd "$AND"
gradle assembleRelease --no-daemon --console=plain --stacktrace

# ── 결과 확인 ─────────────────────────────────────────────────
APK="$(find "$AND/app/build/outputs/apk/release" -name '*.apk' | head -1)"
if [ -z "$APK" ]; then
  echo "::error::APK 가 만들어지지 않았습니다"
  exit 1
fi
echo "── 결과 ──────────────────────────────"
ls -l "$APK"
"$SDK/build-tools/$BUILD_TOOLS/apksigner" verify --print-certs "$APK"
echo "APK_PATH=$APK" >> "${GITHUB_ENV:-/dev/null}"
