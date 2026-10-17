import { readdirSync, lstatSync, realpathSync, existsSync } from "node:fs"
import path from "node:path"

const roots = ["packages/server/node_modules", "packages/core/node_modules", "node_modules"].filter(existsSync)
const external = new Set<string>()
for (const root of roots) {
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".")) continue
    if (entry.startsWith("@")) {
      for (const sub of readdirSync(path.join(root, entry))) {
        const full = path.join(root, entry, sub)
        const isWs = lstatSync(full).isSymbolicLink() && realpathSync(full).includes("/packages/")
        if (!isWs) { external.add(`${entry}/${sub}`); external.add(`${entry}/${sub}/*`) }
      }
    } else { external.add(entry); external.add(`${entry}/*`) }
  }
}
console.error(`externals: ${external.size / 2} packages`)
const profile = process.env.PROFILE ?? ""
const variant = process.env.SQLITE_VARIANT ?? ""
const aliases: Record<string, string> = {}
if (profile === "android") {
  aliases["#sqlite"] = "packages/core/src/database/sqlite.sqljs.ts"
  aliases["#pty"] = "packages/core/src/pty/pty.android.ts"
  // Device bundle: inline everything except native/wasm-bearing modules and sql.js.
  // Native ones never load on the android profile (aliased/toggled off or lazy), sql.js
  // ships as the single real node_modules dependency next to the bundle.
  const keep = ["sql.js", "@ff-labs/fff-node", "@ff-labs/fff-bun", "bun-pty", "@lydell/node-pty",
    "@opencode-ai/pty", "@parcel/watcher", "@silvia-odwyer/photon-node", "web-tree-sitter",
    "tree-sitter-bash", "tree-sitter-powershell", "@vscode/ripgrep", "jsonc-parser"]
  external.clear()
  for (const k of keep) { external.add(k); external.add(k + "/*") }
}
if (variant) aliases["#sqlite"] = `packages/core/src/database/sqlite.${variant}.ts`
const plugins = Object.keys(aliases).length
  ? [{
      name: "profile-aliases",
      setup(build: any) {
        for (const [spec, target] of Object.entries(aliases))
          build.onResolve({ filter: new RegExp("^" + spec.replace("#", "\\#") + "$") }, () => ({
            path: path.resolve(target),
          }))
        if (profile === "android")
          // Node-22-only APIs (vm.constants, module.registerHooks); the android profile
          // disables plugin loading anyway, so swap in the no-dynamic-import stub.
          build.onResolve({ filter: /^\#runtime-import$/ }, () => ({
            path: path.resolve("packages/util/src/runtime/import.workerd.ts"),
          }))
      },
    }]
  : []
const outdir = profile ? `poc/dist-${profile}` : variant ? `poc/dist-${variant}` : "poc/dist"
const result = await Bun.build({
  entrypoints: [process.env.PROFILE === "android" ? "packages/server/poc-entry-android.ts" : "packages/server/poc-entry.ts"],
  outdir,
  target: "node",
  format: "esm",
  external: [...external],
  splitting: true,
  plugins,
})
if (!result.success) { for (const l of result.logs) console.error(l); process.exit(1) }
console.error("bundled ok:", result.outputs.length, "files")
