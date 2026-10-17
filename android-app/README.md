# OpenCode++ Android wrapper (com.opencode.plusplus)

Capacitor shell + embedded nodejs-mobile server. Sources only:
- build-apk.sh — guarded release build (sets VITE_OPENCODE_EMBEDDED=1 + VITE_OPENCODE_SERVER_MODE=none, verifies the embedded-noserver flavor marker in dist, assets and APK)
- capacitor.config.json, package.json — webDir points at ../packages/app/dist (in this repo layout: ../packages/app relative to android-app/)
- android/ — gradle project (MainActivity, EmbeddedServerPlugin)
- ../embedded/ — embedded-server sources (plugin, rebuild-kit)

Excluded on purpose (build outputs / binaries): node_modules, android/app/build,
android/.gradle, android/app/src/main/assets (public/ = vite dist copy,
nodejs-project/ = staged embedded server), android/app/src/main/jniLibs
(libnode.so), android/app/src/main/cpp (node headers), embedded/stage*,
*.keystore, *.apk.

Build diary: BUILD-NOTES.md (versioned per APK: v13.x entries with md5s).
