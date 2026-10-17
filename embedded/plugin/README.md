# @opencode-plus-plus/embedded-server (skeleton, not integrated)

Capacitor plugin that runs the bundled opencode server on-device via
nodejs-mobile inside a foreground service. Prepared in
~/apk-opencodepp/embedded/plugin/ — android-app/ is untouched until Shadow
confirms v12.1.

## Wiring (per nodejs-mobile-samples)
1. Drop the nodejs-mobile AAR into android/src/main/libs/ and uncomment the
   `implementation files(...)` line in android/build.gradle.
2. Copy the server bundle (stage/server/: main.js + chunk-*.js + node_modules/)
   plus assets-template/nodejs-project/bootstrap.js into
   android/src/main/assets/nodejs-project/.
3. NodeServerService.ensureProjectExtracted() copies it to the private files
   dir on first run, writes embedded-config.json (random per-launch password,
   db path, config dir), and starts the runtime on bootstrap.js.
4. EmbeddedServerPlugin.start() launches the service and polls
   GET http://127.0.0.1:4096/api/info with Basic opencode:<password> until
   200 (401 also means up, per the spec handshake section).
5. The web layer adds the "On-device" connection profile from
   start()'s resolved { url, username, password }.

## Server bundle status (stage v2, 2026-10-17)
All v1 findings fixed by the server agent. Verified on node 22 with ONLY the
staged node_modules:
- main.js is now a bootstrap that sets the tree-sitter wasm envs before
  importing bundle.js; staged node_modules has jsonc-parser, the tree-sitter
  packages, sql.js, and an @parcel/watcher stub (stays cold).
- Password order: OPENCODE_SERVER_PASSWORD env > embedded-config.json next to
  bundle.js > auto-generated persisted. Verified: password-source=env and
  password-source=embedded-config both log at boot; wrong password gets 401.
  NOTE: embedded-config.json carries ONLY the password - OPENCODE_CONFIG_DIR
  still comes from env (bootstrap.js here already sets it, compatible).
- DB lands at $OPENCODE_CONFIG_DIR/opencode-android.db (49 migrations, sql.js).
- Verified endpoints: /api/info (401 no-auth, 200 authed), /api/model,
  POST /api/integration/opencode/connect/oauth {"methodID":"device"},
  POST /api/credential {"integrationID":"openrouter","value":{"type":"key",...}}.

## Verified on the desktop PoC (node 22, same env as Android profile)
- Boots, migrates DB (sql.js), listens on 127.0.0.1:4096.
- 401 without auth; 200 with Basic opencode:<password>. /api/info, /api/model,
  /api/project all answer.
- POST /api/integration/opencode/connect/oauth {"methodID":"device"} returns
  attemptID + console device URL + user code + 10 min expiry, as spec'd.
