import nodeCrypto from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
// ES2023+ array/object helpers missing on Node 18.
const AP = Array.prototype as any
if (!AP.toReversed) AP.toReversed = function () { return [...this].reverse() }
if (!AP.toSorted) AP.toSorted = function (cmp?: any) { return [...this].sort(cmp) }
if (!AP.toSpliced) AP.toSpliced = function (start: number, del: number, ...items: any[]) { const c = [...this]; c.splice(start, del, ...items); return c }
if (!AP.with) AP.with = function (i: number, v: any) { const c = [...this]; c[i < 0 ? c.length + i : i] = v; return c }
if (!AP.findLast) AP.findLast = function (fn: any, thisArg?: any) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i] }
if (!AP.findLastIndex) AP.findLastIndex = function (fn: any, thisArg?: any) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i; return -1 }
if (!(Array as any).fromAsync) (Array as any).fromAsync = async (iter: any, map?: any) => { const out: any[] = []; let i = 0; for await (const v of iter as any) out.push(map ? await map(v, i++) : v); return out }
// Iterator helpers (ES2025, Node 22+): attach to %IteratorPrototype%.
const iterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())) as any
if (iterProto && !iterProto.map) {
  iterProto.map = function* (fn: any) { let i = 0; for (const v of this) yield fn(v, i++) }
  iterProto.filter = function* (fn: any) { let i = 0; for (const v of this) if (fn(v, i++)) yield v }
  iterProto.take = function* (n: number) { let i = 0; for (const v of this) { if (i++ >= n) break; yield v } }
  iterProto.drop = function* (n: number) { let i = 0; for (const v of this) { if (i++ < n) continue; yield v } }
  iterProto.flatMap = function* (fn: any) { let i = 0; for (const v of this) yield* fn(v, i++) as any }
  iterProto.reduce = function (fn: any, init?: any) { let acc = init; let started = arguments.length > 1; for (const v of this) { acc = started ? fn(acc, v) : v; started = true } if (!started) throw new TypeError("Reduce of empty iterator"); return acc }
  iterProto.forEach = function (fn: any) { let i = 0; for (const v of this) fn(v, i++) }
  iterProto.some = function (fn: any) { let i = 0; for (const v of this) if (fn(v, i++)) return true; return false }
  iterProto.every = function (fn: any) { let i = 0; for (const v of this) if (!fn(v, i++)) return false; return true }
  iterProto.find = function (fn: any) { let i = 0; for (const v of this) if (fn(v, i++)) return v }
  iterProto.toArray = function () { return [...this] }
}
if (!(Map as any).groupBy) (Map as any).groupBy = function (items: any, fn: any) { const m = new Map(); let i = 0; for (const v of items as any) { const k = fn(v, i++); if (!m.has(k)) m.set(k, []); m.get(k).push(v) } return m }
if (!(Object as any).groupBy) (Object as any).groupBy = function (items: any, fn: any) { const o: any = Object.create(null); let i = 0; for (const v of items as any) { const k = fn(v, i++); (o[k] ||= []).push(v) } return o }
if (!String.prototype.isWellFormed) (String.prototype as any).isWellFormed = function () { try { encodeURIComponent(this); return true } catch { return false } }
if (!String.prototype.toWellFormed) (String.prototype as any).toWellFormed = function () { let r = ""; for (const c of this) { const cc = c.codePointAt(0)!; r += (cc >= 0xd800 && cc <= 0xdfff) ? "\uFFFD" : c } return r }
if (!(Promise as any).withResolvers) (Promise as any).withResolvers = function () { let resolve: any, reject: any; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
// Node 18 lacks URL.parse/canParse (Node 22+).
if (typeof (URL as any).parse !== "function") {
  (URL as any).parse = (url: string, base?: string | URL) => {
    try { return new URL(url, base) } catch { return null }
  }
}
if (typeof (URL as any).canParse !== "function") {
  (URL as any).canParse = (url: string, base?: string | URL) => {
    try { new URL(url, base); return true } catch { return false }
  }
}

// Node 18 (nodejs-mobile) has no global webcrypto; Node 20+ does.
if (!(globalThis as any).crypto) (globalThis as any).crypto = (nodeCrypto as any).webcrypto
import { NodeServices } from "@effect/platform-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"

const main = Effect.scoped(
  Effect.gen(function* () {
    const { start } = yield* Effect.promise(() => import("@opencode/server/process"))
    const { serverOptions, replacements } = yield* Effect.promise(() => import("@opencode/server/android"))
    // Password: env first (plugin injects a random per-launch one), then an
    // embedded-config.json written by the plugin next to this bundle, else generate
    // one and persist it there so the app and server agree across restarts.
    const embeddedConfigPath =
      process.env.OPP_EMBEDDED_CONFIG ?? path.join(path.dirname(new URL(import.meta.url).pathname), "embedded-config.json")
    let password = process.env.OPENCODE_SERVER_PASSWORD ?? ""
    if (!password) {
      try { password = JSON.parse(readFileSync(embeddedConfigPath, "utf8")).password ?? "" } catch {}
    }
    if (!password) {
      password = nodeCrypto.randomBytes(18).toString("base64url")
      try { writeFileSync(embeddedConfigPath, JSON.stringify({ password }), { mode: 0o600 }) } catch {}
    }
    console.log("ANDROID-POC-AUTH user=opencode password-source=" + (process.env.OPENCODE_SERVER_PASSWORD ? "env" : "embedded-config"))
    const profile = {
      password,
      events: { persist: true as const },
    }
    const server = yield* start(
      {
        ...serverOptions(profile),
        hostname: "127.0.0.1",
        port: 4096,
        database: {
          path:
            process.env.POC_DB ??
            process.env.OPENCODE_DB_PATH ??
            path.join(process.env.OPENCODE_CONFIG_DIR ?? "/tmp/opp-poc/config", "opencode-android.db"),
        },
      },
      undefined,
      undefined,
      replacements(profile),
    )
    yield* Effect.sync(() => console.log("ANDROID-POC-LISTENING", JSON.stringify(server.address)))
    return yield* server.shutdown
  }),
).pipe(
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
      replacements: [
        Global.node.replace(
          Global.layerWith(process.env.OPENCODE_CONFIG_DIR ? { config: process.env.OPENCODE_CONFIG_DIR } : {}),
        ),
      ],
    }),
  ),
  Effect.provide(NodeServices.layer),
)

Effect.runPromise(main as any).then(
  () => console.log("POC-EXIT-CLEAN"),
  (err) => { console.error("POC-FATAL", err); process.exit(1) },
)
