#!/usr/bin/env bash
# v13.13+: guarded embedded build. Fails loudly if the web bundle was built
# without VITE_OPENCODE_EMBEDDED=1 (v13.12 shipped standalone by mistake).
set -euo pipefail
cd "$(dirname "$0")"
APP=../repo/packages/app

echo "== vite build (VITE_OPENCODE_EMBEDDED=1) =="
(cd "$APP" && VITE_OPENCODE_EMBEDDED=1 VITE_OPENCODE_SERVER_MODE=none NODE_OPTIONS=--max-old-space-size=700 npx vite build)

echo "== check: embedded flavor marker in dist =="
grep -rq '__BUILD_FLAVOR__' "$APP"/dist/_assets/*.js \
  || { echo "FATAL: dist missing __BUILD_FLAVOR__ — web built WITHOUT VITE_OPENCODE_EMBEDDED=1"; exit 1; }
grep -rq 'embedded-noserver' "$APP"/dist/_assets/*.js \
  || { echo "FATAL: dist flavor is not embedded-noserver — web built WITHOUT VITE_OPENCODE_SERVER_MODE=none"; exit 1; }

echo "== cap copy android =="
npx cap copy android

echo "== check: marker + plugin strings in APK assets =="
grep -q 'embedded-noserver' android/app/src/main/assets/public/_assets/*.js \
  || { echo "FATAL: APK assets missing __BUILD_FLAVOR__ (stale copy?)"; exit 1; }
[ -f android/app/src/main/assets/nodejs-project/bootstrap.js ] \
  || { echo "FATAL: nodejs-project assets missing"; exit 1; }

echo "== gradle assembleRelease =="
(cd android && JAVA_HOME="${JAVA_HOME:-/tmp/jdk21}" ANDROID_HOME="${ANDROID_HOME:-/tmp/android-sdk}" ./gradlew :app:assembleRelease --console=plain)

APK=android/app/build/outputs/apk/release/app-release-unsigned.apk
echo "== check: marker inside built APK =="
unzip -p "$APK" 'assets/public/_assets/index-*.js' > /tmp/apk-index-check.js
grep -q 'embedded-noserver' /tmp/apk-index-check.js \
  || { echo "FATAL: built APK missing __BUILD_FLAVOR__"; exit 1; }
echo "OK: embedded flavor verified in dist, assets and APK"
