// Assemble the device-ready stage: bundle + bootstrap main.js + minimal node_modules.
// Usage: bun poc/stage.ts  (run after PROFILE=android bun poc/build.ts)
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, renameSync } from "node:fs"

const stage = "poc/stage/server"
rmSync(stage, { recursive: true, force: true })
mkdirSync(`${stage}/node_modules`, { recursive: true })
cpSync("poc/dist-android", stage, { recursive: true })
renameSync(`${stage}/poc-entry-android.js`, `${stage}/bundle.js`)
rmSync(`${stage}/poc-entry-android.js.map`, { force: true })

// main.js bootstrap: fixes module-load-time concerns before touching the bundle.
// - tree-sitter wasm paths (chunk top-level reads env at import evaluation)
// - then hands off to the real entry (bundle.js), which owns password + DB defaults
writeFileSync(`${stage}/main.js`, `// OpenCode++ embedded server bootstrap (nodejs-mobile, Node 18).
import path from "node:path"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
const dir = path.dirname(fileURLToPath(import.meta.url))
const envDefault = (key, file) => {
  if (!process.env[key] && existsSync(file)) process.env[key] = file
}
envDefault("OPENCODE_TREE_SITTER_WASM_PATH", path.join(dir, "node_modules/web-tree-sitter/tree-sitter.wasm"))
envDefault("OPENCODE_TREE_SITTER_BASH_WASM_PATH", path.join(dir, "node_modules/tree-sitter-bash/tree-sitter-bash.wasm"))
envDefault("OPENCODE_TREE_SITTER_POWERSHELL_WASM_PATH", path.join(dir, "node_modules/tree-sitter-powershell/tree-sitter-powershell.wasm"))
await import("./bundle.js")
`)
writeFileSync(`${stage}/package.json`, JSON.stringify({
  name: "opencode-embedded-server", version: "1.0.0", type: "module", main: "main.js",
}, null, 2))

// Minimal node_modules — only what the bundle imports at load or lazily on-device.
const pkg = (name, files) => {
  const src = `node_modules/${name}`
  const dst = `${stage}/node_modules/${name}`
  mkdirSync(dst, { recursive: true })
  for (const f of files) cpSync(`${src}/${f}`, `${dst}/${f}`, { recursive: true })
}
pkg("sql.js", ["package.json", "dist/sql-wasm.js", "dist/sql-wasm.wasm"])
pkg("jsonc-parser", ["package.json", "lib"])
pkg("web-tree-sitter", ["package.json", "tree-sitter.js", "tree-sitter.wasm"])
pkg("tree-sitter-bash", ["package.json", "tree-sitter-bash.wasm"])
pkg("tree-sitter-powershell", ["package.json", "tree-sitter-powershell.wasm"])
// @parcel/watcher: the bundle statically imports wrapper.js (pure JS); the native
// binding loads lazily inside try/catch and simply stays off when absent. Ship only
// the wrapper + a package.json exposing it.
mkdirSync(`${stage}/node_modules/@parcel/watcher`, { recursive: true })
// Dep-free CJS stub: the real wrapper.js pulls micromatch/is-glob, but createWrapper is
// only invoked lazily inside try/catch after load() of the native binding throws, so a
// throwing stub is never reached on device.
writeFileSync(`${stage}/node_modules/@parcel/watcher/wrapper.js`, `// Stub for the Android embedded build. The native binding is never present; the
// bundle calls createWrapper lazily inside try/catch and treats failure as "watcher off".
exports.createWrapper = () => {
  throw new Error("@parcel/watcher native binding is unavailable in this build")
}
`)
writeFileSync(`${stage}/node_modules/@parcel/watcher/package.json`, JSON.stringify({
  name: "@parcel/watcher", version: "0.0.0-stub", main: "wrapper.js",
  exports: { "./wrapper.js": "./wrapper.js" },
}, null, 2))
console.error("staged ok:", stage)
