# OpenCode++ on-phone embedded server (branch Mobile)

The Android profile of the fork's server, built to run inside the app via
nodejs-mobile (Node 18.20.4 runtime). The app embeds `poc/stage/server/`
(main.js bootstrap + bundle.js + minimal node_modules), launches it with
nodejs-mobile, and talks to it on 127.0.0.1:4096 with Basic auth.

## Build

```
bun install
PROFILE=android bun poc/build.ts   # bundle with the android profile aliases
bun poc/stage.ts                   # assemble poc/stage/server
```

## Run (desktop check)

```
OPENCODE_CONFIG_DIR=/some/dir OPENCODE_SERVER_PASSWORD=secret node poc/stage/server/main.js
```

Auth order: OPENCODE_SERVER_PASSWORD env -> embedded-config.json next to
bundle.js (plugin may write it) -> auto-generated and persisted (0600).
DB defaults to $OPENCODE_CONFIG_DIR/opencode-android.db.

## Env the app can set

- OPENCODE_CONFIG_DIR (required on device): app-private data dir.
- OPENCODE_SERVER_PASSWORD: per-launch random password (else embedded-config.json).
- OPENCODE_DB_PATH: override the DB path.
- OPP_EMBEDDED_CONFIG: override the embedded-config.json path.
- OPP_PTY_WRAPPER: absolute path to the PTY bridge (libptywrap.so in
  nativeLibraryDir). When set, terminals work via poc/ptywrap.c compiled per ABI.
  When unset, terminal endpoints answer honestly-unavailable.
- OPP_NATIVE_BIN_DIR: app's nativeLibraryDir. When set, the real process spawner
  stays on and the bash tool works; shell path comes from config/$SHELL.
- OPENCODE_TREE_SITTER_WASM_PATH / _BASH_ / _POWERSHELL_: wasm overrides
  (main.js bootstrap defaults them to the staged copies).

## ptywrap.c

Minimal PTY bridge for Android (targetSdk 29+ blocks exec from app-private
dirs; jniLibs libraries land in nativeLibraryDir where exec is allowed).
Build per ABI with the NDK and ship as libptywrap.so:

```
$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang -O2 -o libptywrap.so poc/ptywrap.c
# repeat for armv7a-linux-androideabi24-clang and x86_64-linux-android24-clang
```

Protocol: argv = COLS ROWS CMD [ARGS...]; stdin -> PTY master, PTY master ->
stdout, fd 3 control lines "R <cols> <rows>" resize, SIGTERM/INT/HUP forward to
the child, exit code = child's exit code.
