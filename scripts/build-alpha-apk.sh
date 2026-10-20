#!/usr/bin/env bash
set -euo pipefail
# Refresh the actual embedded server, not just the WebView assets.
BASE=$(realpath "$1"); DIST0=$(realpath "$2"); OUT=$(realpath -m "$3")
ALPHA_BUILD=${4:?build number yyMMddNN}
APKTOOL=${APKTOOL:-/tmp/apk/apktool.jar}
KS=${ALPHA_KEYSTORE:?path to alpha keystore}
ALPHA_PORT=4196
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
PLAT=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
mkdir -p "$W/stage/assets/nodejs-project" "$W/cls" "$W/jar"
# Separate alpha app: own package id, label, icon badge, version (apktool on the stable APK).
ORIG_BASE="$BASE"
java -jar "$APKTOOL" d -f -o "$W/dec" "$BASE" >/dev/null
# Stable dex keeps EmbeddedServerPlugin (UI-process side): patch its port and data path in smali.
sed -i "s/127\\.0\\.0\\.1:4096/127.0.0.1:$ALPHA_PORT/g" "$W/dec/smali/com/opencode/plusplus/embedded/EmbeddedServerPlugin.smali"
sed -i "s#/data/data/com.opencode.plusplus/#/data/data/com.opencode.plusplus.alpha/#g" "$W/dec/smali/com/opencode/plusplus/embedded/EmbeddedServerPlugin.smali"
! grep -rq "127.0.0.1:4096" "$W/dec/smali/com/opencode/plusplus/embedded/EmbeddedServerPlugin.smali"
python3 "$ROOT/scripts/alpha-identity.py" "$W/dec" "$ALPHA_BUILD"
java -jar "$APKTOOL" b -o "$W/identity.apk" "$W/dec" >/dev/null
BASE="$W/identity.apk"
# Own local port so alpha and stable can run side by side.
DIST="$W/dist"; cp -r "$DIST0" "$DIST"
grep -rlE "(127\.0\.0\.1|localhost):4096" "$DIST" | xargs -r sed -i -E "s/(127\.0\.0\.1|localhost):4096/\1:$ALPHA_PORT/g"
cp -r "$DIST" "$W/stage/assets/public"
cp -r "$ROOT/poc/stage/server/." "$W/stage/assets/nodejs-project/"
grep -q "port: 4096," "$W/stage/assets/nodejs-project/bundle.js"
sed -i "s/port: 4096,/port: $ALPHA_PORT,/" "$W/stage/assets/nodejs-project/bundle.js"
# Keep working no-ICU/CORS/path bootstrap from the real released APK.
unzip -p "$ORIG_BASE" assets/nodejs-project/bootstrap.js > "$W/stage/assets/nodejs-project/bootstrap.js"
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
p=Path(sys.argv[1]);s=p.read_text();s=s.replace('.extracted-v9','.extracted-alpha-nogate-3');p.write_text(s)
PY
sed -i "s/4096/$ALPHA_PORT/g; s#/data/data/com.opencode.plusplus/#/data/data/com.opencode.plusplus.alpha/#" "$W/java/com/opencode/plusplus/embedded/NodeServerService.java" "$W/java/com/opencode/plusplus/embedded/EmbeddedServerPlugin.java"
javac --release 17 -nowarn -cp "$PLAT/android.jar:$W/jar/classes.jar" -sourcepath "$W/java" -d "$W/cls" "$W/java/com/opencode/plusplus/embedded/NodeServerService.java" "$EMB/NodeRuntime.java" "$EMB/BootLog.java" "$EMB/AssetExtractor.java" "$EMB/Redact.java" "$EMB/AlphaUpdater.java"
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
"$BT/apksigner" sign --ks "$KS" --ks-pass env:ALPHA_KS_PASS --out "$OUT" "$W/aligned.apk"
"$BT/apksigner" verify "$OUT"
sha256sum "$OUT"
