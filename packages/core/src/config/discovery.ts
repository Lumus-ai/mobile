export * as ConfigDiscovery from "./discovery.js"

import path from "path"
import { Effect } from "effect"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { AbsolutePath } from "../schema.js"
import type { Options } from "../config.js"

export const names = ["opencode.json", "opencode.jsonc"]

/** Eligible sources in priority order, including paths that may appear later. */
export interface Sources {
  readonly global?: AbsolutePath
  readonly explicit?: AbsolutePath
  readonly direct: readonly AbsolutePath[]
  readonly project: readonly { readonly path: AbsolutePath; readonly present: boolean }[]
  readonly claude: readonly AbsolutePath[]
  readonly agents: readonly AbsolutePath[]
}

export const discover = Effect.fn("ConfigDiscovery.discover")(function* (options?: Options) {
  const fs = yield* FSUtil.Service
  const global = yield* Global.Service
  const location = yield* Location.Service
  const globalDirectory = AbsolutePath.make(global.config)
  const globalAgentsDirectory = AbsolutePath.make(path.join(global.home, ".agents"))
  const globalClaudeDirectory = AbsolutePath.make(path.join(global.home, ".claude"))
  const globalRoots = yield* Effect.forEach([globalDirectory, globalClaudeDirectory, globalAgentsDirectory], (item) =>
    fs.resolve(item),
  )
  const resolvedLocation = yield* fs.resolve(location.directory)
  const resolvedHome = yield* fs.resolve(global.home)
  const isWithin = (root: string, candidate: string) => {
    const relative = path.relative(root, candidate)
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  }
  const upward =
    resolvedLocation === globalRoots[0] || options?.project === false
      ? []
      : yield* fs.up({ targets: ["."], start: location.directory }).pipe(Effect.orDie)
  // When a project lives under the user's home, do not walk above that boundary.
  // This prevents parent directories from injecting unrelated ecosystem config.
  const directories = isWithin(resolvedHome, resolvedLocation)
    ? yield* Effect.gen(function* () {
        const result: typeof upward = []
        for (const directory of upward) {
          const resolved = yield* fs.resolve(directory)
          if (isWithin(resolvedHome, resolved)) result.push(directory)
        }
        return result
      })
    : upward
  const discovered = yield* Effect.forEach(directories, (directory) =>
    Effect.gen(function* () {
      // Resolve the parent too: missing children must honor symlinked global roots.
      const parent = yield* fs.resolve(directory)
      return yield* Effect.forEach([".claude", ".agents", ".opencode", ...names.toReversed()], (name) =>
        fs
          .resolve(path.join(parent, name))
          .pipe(Effect.map((resolved) => ({ item: AbsolutePath.make(path.join(directory, name)), resolved }))),
      )
    }),
  ).pipe(
    Effect.map((items) => items.flat()),
    Effect.orDie,
  )

  const globalEnabled = options?.global !== false
  const globalFiles = yield* Effect.forEach(names, (name) => fs.resolve(path.join(globalDirectory, name)))
  // Global sources must not re-enter through the project walk.
  const visible = discovered
    .filter(({ resolved }) =>
      globalEnabled
        ? !globalRoots.includes(resolved) && !globalFiles.includes(resolved)
        : !globalRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep)),
    )
    .map(({ item }) => item)

  return {
    global: globalEnabled ? globalDirectory : undefined,
    explicit: options?.file ? AbsolutePath.make(path.resolve(options.file)) : undefined,
    direct: visible.filter((item) => ![".agents", ".claude", ".opencode"].includes(path.basename(item))).toReversed(),
    project: yield* Effect.forEach(
      visible.filter((item) => path.basename(item) === ".opencode").toReversed(),
      (directory) => fs.isDir(directory).pipe(Effect.map((present) => ({ path: directory, present }))),
    ),
    claude: [
      ...new Set([
        ...(globalEnabled ? [globalClaudeDirectory] : []),
        ...visible.filter((item) => path.basename(item) === ".claude").toReversed(),
      ]),
    ],
    agents: [
      ...new Set([
        ...(globalEnabled ? [globalAgentsDirectory] : []),
        ...visible.filter((item) => path.basename(item) === ".agents").toReversed(),
      ]),
    ],
  } satisfies Sources
})
