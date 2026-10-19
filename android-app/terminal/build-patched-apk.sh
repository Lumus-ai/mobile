#!/usr/bin/env bash
# Builds the OpenCode++ APK WITHOUT a full gradle build, by patching a released APK:
#   - new web bundle (assets/public) from packages/app/dist
#   - terminal helper: assets/nodejs-project/terminal.js + patched bootstrap.js
#   - native: libproot.so + libproot-loader.so (green-green-avk/build-proot-android, GPL-2) and
#     libtermsh.so (termsh.c, built with the NDK)
#   - Java: NodeServerService recompiled (extraction marker bump so updated bootstrap.js is used)
# Needs: ANDROID_HOME (platforms + build-tools), ANDROID_NDK_LATEST_HOME, java, python3, zip, unzip, curl.
# Usage: build-patched-apk.sh <base.apk> <web-dist-dir> <out.apk>
set -euo pipefail
BASE_APK=$(realpath "$1"); DIST=$(realpath "$2"); OUT=$(realpath -m "$3")
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
PLAT=$(ls -d "$ANDROID_HOME"/platforms/android-* | sort -V | tail -1)
echo "build-tools=$BT platform=$PLAT"

mkdir -p "$W/stage/assets/nodejs-project" "$W/stage/lib/arm64-v8a"
cp -r "$DIST" "$W/stage/assets/public"

# --- proot (pinned) ---
PROOT_URL=https://github.com/green-green-avk/build-proot-android/raw/master/packages/proot-android-aarch64.tar.gz
PROOT_SHA=9629eb30cdf86e95c6ba681f8ab89c6fdaa9eca093d5577163513c99af5ca281
curl -fsSL "$PROOT_URL" -o "$W/proot.tgz"
echo "$PROOT_SHA  $W/proot.tgz" | sha256sum -c -
mkdir "$W/proot" && tar xzf "$W/proot.tgz" -C "$W/proot"
cp "$W/proot/root/bin/proot" "$W/stage/lib/arm64-v8a/libproot.so"
cp "$W/proot/root/libexec/proot/loader" "$W/stage/lib/arm64-v8a/libproot-loader.so"

# --- libtermsh (NDK) ---
CLANG=$(ls "$ANDROID_NDK_LATEST_HOME"/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang)
"$CLANG" -O2 -Wall -pie -o "$W/stage/lib/arm64-v8a/libtermsh.so" "$HERE/termsh.c"
file "$W/stage/lib/arm64-v8a/libtermsh.so" || true

# --- node side: terminal.js + patched bootstrap.js ---
cp "$HERE/terminal.js" "$W/stage/assets/nodejs-project/terminal.js"
unzip -q -o "$BASE_APK" assets/nodejs-project/bootstrap.js -d "$W/base"
python3 - "$W/base/assets/nodejs-project/bootstrap.js" "$W/stage/assets/nodejs-project/bootstrap.js" <<'PY'
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
marker = "  // --- ICU shims"
assert marker in s, "bootstrap.js: ICU shims marker not found"
assert "terminal.js" not in s, "bootstrap.js already patched"
hook = '''  // terminal helper (proot + Alpine/Debian): sets SHELL, serves 127.0.0.1:4097
  try {
    const term = await import("./terminal.js")
    term.init({ cfg, configDir })
  } catch (e) {
    console.error("[bootstrap] terminal helper failed:", String(e))
  }

'''
s = s.replace(marker, hook + marker, 1)
open(dst, "w").write(s)
PY

# --- Java: recompile NodeServerService with the bumped marker ---
JAVA_SRC="$REPO/android-app/android/app/src/main/java"
mkdir -p "$W/jar" "$W/cls"
curl -fsSL https://dl.google.com/dl/android/maven2/androidx/core/core/1.13.1/core-1.13.1.aar -o "$W/core.aar"
unzip -q -o "$W/core.aar" classes.jar -d "$W/jar"
curl -fsSL https://dl.google.com/dl/android/maven2/androidx/annotation/annotation-jvm/1.8.0/annotation-jvm-1.8.0.jar -o "$W/jar/annotation.jar" || true
EMB="$JAVA_SRC/com/opencode/plusplus/embedded"
javac --release 17 -nowarn -cp "$PLAT/android.jar:$W/jar/classes.jar:$W/jar/annotation.jar" -sourcepath "$JAVA_SRC" -d "$W/cls" \
  "$EMB/NodeServerService.java" "$EMB/NodeRuntime.java" "$EMB/BootLog.java" "$EMB/AssetExtractor.java" "$EMB/Redact.java"
(cd "$W/cls" && find . -name '*.class' | sort > ../classes.txt && wc -l ../classes.txt)
"$BT/d8" --release --min-api 24 --lib "$PLAT/android.jar" --output "$W" $(cd "$W/cls" && find . -name '*.class' | sed "s#^\./#$W/cls/#")
test -f "$W/classes.dex"

# --- assemble ---
cp "$BASE_APK" "$W/app.apk"
zip -q -d "$W/app.apk" 'assets/public/*' 'assets/nodejs-project/bootstrap.js' 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.MF' || true
# shift existing dex files up by one, new dex becomes classes.dex (first wins in class loading)
mkdir "$W/dex"
unzip -q "$W/app.apk" 'classes*.dex' -d "$W/dex"
zip -q -d "$W/app.apk" 'classes*.dex'
N=$(ls "$W/dex"/classes*.dex | wc -l)
mkdir "$W/dexout"
for i in $(seq "$N" -1 1); do
  from="$W/dex/classes.dex"; [ "$i" -gt 1 ] && from="$W/dex/classes$i.dex"
  mv "$from" "$W/dexout/classes$((i+1)).dex"
done
mv "$W/classes.dex" "$W/dexout/classes.dex"
(cd "$W/dexout" && zip -q -0 "$W/app.apk" classes*.dex)
(cd "$W/stage" && zip -q -r "$W/app.apk" assets lib)
"$BT/zipalign" -p -f 4 "$W/app.apk" "$W/aligned.apk"
keytool -genkeypair -keystore "$W/ci.jks" -storepass cipass123 -keypass cipass123 -alias ci -keyalg RSA -keysize 2048 -validity 3 -dname "CN=ci" 2>/dev/null
"$BT/apksigner" sign --ks "$W/ci.jks" --ks-pass pass:cipass123 --out "$OUT" "$W/aligned.apk"
"$BT/apksigner" verify "$OUT"
unzip -l "$OUT" | grep -E "classes|libproot|libtermsh|terminal.js|bootstrap.js"
ls -la "$OUT"
