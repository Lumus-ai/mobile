export * as ServerAndroid from "./android"

/**
 * Android embed profile (nodejs-mobile, Node 18, no bun, no native addons):
 *
 * - Database runs on the sql.js (WASM) driver - bundle with `#sqlite` aliased to
 *   `sqlite.sqljs.ts` (see poc/build.ts PROFILE=android).
 * - Real on-device filesystem (node:fs works); file watcher and fff picker are off
 *   (no @parcel/watcher / fff native builds for this runtime).
 * - v1: no process spawning at all (CrossSpawnSpawner unavailable) - no bash tool, no git,
 *   no plugin installs, no terminals. PTY endpoints answer empty/unavailable honestly.
 *   v2 brings an NDK shim executed from the app's native lib dir and restores them.
 * - Provider calls go out over plain HTTPS from the nodejs-mobile runtime, so no CORS.
 */
import { Effect, Layer } from "effect"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { EnvironmentUnavailable } from "@opencode/core/environment/unavailable"
import { Pty } from "@opencode/core/pty"
import { Snapshot } from "@opencode/core/snapshot"
import { Vcs } from "@opencode/core/vcs"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import type { ServerOptions } from "./options"

export interface Options {
  readonly password?: string
  readonly app?: ServerOptions["app"]
  /** Inline opencode config content (JSON), same as `ServerOptions.config.content`. */
  readonly config?: { readonly content?: string }
  readonly models?: ServerOptions["models"]
  readonly events?: ServerOptions["events"]
}

export function serverOptions(options: Options): ServerOptions {
  return {
    app: options.app ?? { name: "opencode-android", channel: "android" },
    password: options.password,
    fs: { filewatcher: false, fff: false },
    events: options.events ?? { persist: true },
    config: { content: options.config?.content },
    models: options.models,
  }
}

const unavailable = (what: string) => Effect.die(new Error(`${what} is unavailable in this Android build`))

/** The android replacement graph, applied after the standard server replacements. */
export function replacements(_options: Options = {}): LayerNode.Replacements {
  return [
    // v2: when the app ships native binaries (nativeLibraryDir passed as
    // OPP_NATIVE_BIN_DIR), the real spawner stays and the bash tool works.
    ...(!process.env.OPP_NATIVE_BIN_DIR ? [CrossSpawnSpawner.node.replace(EnvironmentUnavailable.layer)] : []),
    Snapshot.node.replace(Snapshot.noopLayer),
    Vcs.node.replace(vcsLayer),
    // v2: when the app ships the NDK PTY bridge (OPP_PTY_WRAPPER), the real Pty
    // service runs over #pty -> pty.android.ts -> the bridge process.
    ...(!process.env.OPP_PTY_WRAPPER ? [Pty.node.replace(ptyLayer)] : []),
    // No plugin directory scan or npm installs on device; precompiled plugins only.
    ConfigPluginSource.node.replace(ConfigPluginSource.empty),
  ]
}

// No git binary on the phone in v1; Vcs degrades to empty results like workerd's.
const vcsLayer = Layer.succeed(
  Vcs.Service,
  Vcs.Service.of({
    base: () => Effect.succeed(null),
    initialize: () => Effect.fail(new Vcs.InitializeError({ kind: "unsupported" })),
    transform: () => Effect.succeed({ dispose: Effect.void }),
    reload: () => Effect.void,
    info: () => Effect.succeed({ branch: {} }),
    branches: () => Effect.succeed([]),
    status: () => Effect.succeed([]),
    diff: () => Effect.succeed([]),
  }),
)

const ptyLayer = Layer.succeed(
  Pty.Service,
  Pty.Service.of({
    list: () => Effect.succeed([]),
    get: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    create: () => unavailable("Pty.create"),
    update: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    remove: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    write: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
    attach: (ptyID) => Effect.fail(new Pty.NotFoundError({ ptyID })),
  }),
)
