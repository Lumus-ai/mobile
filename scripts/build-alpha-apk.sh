#!/usr/bin/env bash
set -euo pipefail
# Refresh the actual embedded server, not just the WebView assets.
BASE=$(realpath "$1"); DIST=$(realpath "$2"); OUT=$(realpath -m "$3")
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
PLAT=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/stage/assets/nodejs-project" "$W/cls" "$W/jar"
cp -r "$DIST" "$W/stage/assets/public"
cp -r "$ROOT/poc/stage/server/." "$W/stage/assets/nodejs-project/"
# Keep working no-ICU/CORS/path bootstrap from the real released APK.
unzip -p "$BASE" assets/nodejs-project/bootstrap.js > "$W/stage/assets/nodejs-project/bootstrap.js"
rm -f "$W/stage/assets/nodejs-project/embedded-config.json"
# Reuse native runtime/libraries and unchanged Java UI from release v13.15.
curl -fsSL https://dl.google.com/dl/android/maven2/androidx/core/core/1.13.1/core-1.13.1.aar -o "$W/core.aar"
unzip -q "$W/core.aar" classes.jar -d "$W/jar"
SRC="$ROOT/android-app/android/app/src/main/java"
EMB="$SRC/com/opencode/plusplus/embedded"
# Bump extraction marker so an existing app cannot keep its old bundle.
cp -r "$SRC" "$W/java"
python3 - "$W/java/com/opencode/plusplus/embedded/NodeServerService.java" <<'PY'
from pathlib import Path
import sys,re
p=Path(sys.argv[1]);s=p.read_text();s=s.replace('.extracted-v9','.extracted-alpha-nogate-2');p.write_text(s)
PY
javac --release 17 -nowarn -cp "$PLAT/android.jar:$W/jar/classes.jar" -sourcepath "$W/java" -d "$W/cls" "$W/java/com/opencode/plusplus/embedded/NodeServerService.java" "$EMB/NodeRuntime.java" "$EMB/BootLog.java" "$EMB/AssetExtractor.java" "$EMB/Redact.java"
"$BT/d8" --release --min-api 24 --lib "$PLAT/android.jar" --output "$W" $(find "$W/cls" -name '*.class')
cp "$BASE" "$W/app.apk"
zip -q -d "$W/app.apk" 'assets/public/*' 'assets/nodejs-project/*' 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.MF' || true
mkdir "$W/dex" "$W/dexout"
unzip -q "$W/app.apk" 'classes*.dex' -d "$W/dex"
zip -q -d "$W/app.apk" 'classes*.dex'
N=$(ls "$W/dex"/classes*.dex | wc -l)
for i in $(seq "$N" -1 1); do from="$W/dex/classes.dex"; [ "$i" -gt 1 ] && from="$W/dex/classes$i.dex"; mv "$from" "$W/dexout/classes$((i+1)).dex"; done
mv "$W/classes.dex" "$W/dexout/classes.dex"
(cd "$W/dexout" && zip -q -0 "$W/app.apk" classes*.dex)
(cd "$W/stage" && zip -q -r "$W/app.apk" assets)
"$BT/zipalign" -p -f 4 "$W/app.apk" "$W/aligned.apk"
keytool -genkeypair -keystore "$W/ci.jks" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Android Debug' >/dev/null 2>&1
"$BT/apksigner" sign --ks "$W/ci.jks" --ks-pass pass:android --out "$OUT" "$W/aligned.apk"
"$BT/apksigner" verify "$OUT"
sha256sum "$OUT"
