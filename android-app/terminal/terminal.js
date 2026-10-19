// Embedded Linux terminal helper (runs inside the nodejs-mobile process).
// Variant C: proot (libproot.so from jniLibs) + Alpine or Debian rootfs that the user
// installs with one button. Everything here is plain node (fs, https, zlib, http), no deps.
//
// - init({cfg, configDir}) sets SHELL/PATH-related env so the opencode shell tool runs
//   inside proot (through libtermsh.so), or falls back to /system/bin/sh when no rootfs yet.
// - A small local HTTP API on 127.0.0.1:4097 (password = server password) serves the app UI:
//   GET /term/status, POST /term/install {distro}, POST /term/remove, POST /term/exec {cmd,cwd}.
import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import http from "node:http"
import zlib from "node:zlib"
import crypto from "node:crypto"
import { spawn } from "node:child_process"

export const PORT = 4097
const DISTROS = { alpine: "Alpine", debian: "Debian" }

let ctx = null
const job = { running: false, distro: null, phase: "", pct: 0, msg: "", error: null, startedAt: 0 }

const log = (...a) => console.log("[terminal]", ...a)

function paths(configDir) {
  const base = path.join(configDir, "..", "terminal")
  return {
    base,
    rootfs: path.join(base, "rootfs"),
    tmp: path.join(base, "tmp"),
    state: path.join(base, "state.json"),
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(ctx.p.state, "utf8"))
  } catch {
    return {}
  }
}
function writeState(s) {
  fs.mkdirSync(ctx.p.base, { recursive: true })
  fs.writeFileSync(ctx.p.state, JSON.stringify(s))
}

export function rootfsReady(rootfs) {
  try {
    return fs.existsSync(path.join(rootfs, "bin", "sh")) || fs.lstatSync(path.join(rootfs, "bin", "sh")).isSymbolicLink()
  } catch {
    return false
  }
}

// ---------- download helpers ----------
function getStream(url, headers = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": "opencodepp-terminal", ...headers } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        // never forward the registry bearer token to the CDN host
        const h = new URL(next).host === new URL(url).host ? headers : {}
        return resolve(getStream(next, h, redirects - 1))
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      resolve(res)
    })
    req.on("error", reject)
    req.setTimeout(30000, () => req.destroy(new Error("timeout " + url)))
  })
}
async function getText(url, headers) {
  const res = await getStream(url, headers)
  const chunks = []
  for await (const c of res) chunks.push(c)
  return Buffer.concat(chunks).toString("utf8")
}

// Downloads url to destFile, verifying sha256 when given; reports progress 0..1.
async function download(url, destFile, sha256, headers, onProgress) {
  const res = await getStream(url, headers)
  const total = Number(res.headers["content-length"] || 0)
  const hash = crypto.createHash("sha256")
  const out = fs.createWriteStream(destFile)
  let got = 0
  await new Promise((resolve, reject) => {
    res.on("data", (c) => {
      got += c.length
      hash.update(c)
      if (total) onProgress(got / total)
    })
    res.on("error", reject)
    out.on("error", reject)
    out.on("finish", resolve)
    res.pipe(out)
  })
  const digest = hash.digest("hex")
  if (sha256 && digest !== sha256) throw new Error(`checksum mismatch (got ${digest.slice(0, 12)}…, want ${sha256.slice(0, 12)}…)`)
  return digest
}

// ---------- minimal tar reader/extractor (ustar, GNU long names, pax paths) ----------
const str = (b, o, l) => {
  const s = b.toString("utf8", o, o + l)
  const i = s.indexOf("\0")
  return i < 0 ? s : s.slice(0, i)
}
const oct = (b, o, l) => parseInt(str(b, o, l).trim() || "0", 8) || 0

export async function extractTarGz(file, dest, onProgress = () => {}) {
  fs.mkdirSync(dest, { recursive: true })
  const size = fs.statSync(file).size
  const gunzip = zlib.createGunzip()
  const src = fs.createReadStream(file)
  let read = 0
  src.on("data", (c) => {
    read += c.length
    onProgress(Math.min(1, read / size))
  })
  src.pipe(gunzip)

  let buf = Buffer.alloc(0)
  let hdr = null // current entry header awaiting data
  let longName = null
  let paxPath = null
  let skipBlocks = 0
  let count = 0
  const dirModes = []
  const root = path.resolve(dest)

  const safe = (name) => {
    const p = path.resolve(root, name.replace(/^\/+/, ""))
    if (p !== root && !p.startsWith(root + path.sep)) throw new Error("unsafe path in archive: " + name)
    return p
  }
  const ensureDir = (p) => {
    // A symlink pointing outside is possible in rootfs tarballs (/lib -> usr/lib is relative and fine).
    fs.mkdirSync(p, { recursive: true })
  }
  const place = (h, data) => {
    const target = safe(h.name)
    const parent = path.dirname(target)
    try {
      ensureDir(parent)
    } catch (e) {
      // parent may be a dangling absolute symlink created earlier; ignore and let the write fail loudly
      throw e
    }
    const rm = () => {
      try {
        fs.rmSync(target, { recursive: true, force: true })
      } catch {}
    }
    switch (h.type) {
      case "0":
      case "\0":
      case "7": {
        rm()
        fs.writeFileSync(target, data)
        fs.chmodSync(target, (h.mode & 0o777) | 0o200)
        break
      }
      case "5": {
        ensureDir(target)
        dirModes.push([target, (h.mode & 0o777) | 0o700])
        break
      }
      case "2": {
        rm()
        fs.symlinkSync(h.link, target)
        break
      }
      case "1": {
        rm()
        const from = safe(h.link)
        try {
          fs.linkSync(from, target)
        } catch {
          fs.copyFileSync(from, target)
        }
        break
      }
      default:
        // character/block devices, fifos: not needed (proot binds /dev)
        break
    }
    count++
  }

  const pending = []
  await new Promise((resolve, reject) => {
    gunzip.on("data", (chunk) => {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
        for (;;) {
          if (hdr) {
            const padded = Math.ceil(hdr.size / 512) * 512
            if (buf.length < padded) return
            const data = buf.subarray(0, hdr.size)
            buf = buf.subarray(padded)
            const h = hdr
            hdr = null
            if (h.type === "L") longName = str(data, 0, data.length)
            else if (h.type === "x" || h.type === "g") {
              const text = data.toString("utf8")
              for (const m of text.matchAll(/\d+ (path|linkpath)=([^\n]*)\n/g)) {
                if (m[1] === "path") paxPath = m[2]
                else h.paxLink = m[2]
              }
              if (h.paxLink) hdr = null
            } else {
              if (longName) {
                h.name = longName
                longName = null
              }
              if (paxPath) {
                h.name = paxPath
                paxPath = null
              }
              place(h, data)
            }
            continue
          }
          if (buf.length < 512) return
          const b = buf.subarray(0, 512)
          buf = buf.subarray(512)
          if (b.every((x) => x === 0)) continue
          const prefix = str(b, 345, 155)
          const h = {
            name: (prefix ? prefix + "/" : "") + str(b, 0, 100),
            mode: oct(b, 100, 8),
            size: oct(b, 124, 12),
            type: String.fromCharCode(b[156] || 0x30),
            link: str(b, 157, 100),
          }
          if (h.type === "0" && h.name.endsWith("/")) h.type = "5"
          if (h.size > 0 && ["0", "\0", "7", "L", "x", "g"].includes(h.type)) {
            hdr = h
          } else {
            if (longName) {
              h.name = longName
              longName = null
            }
            if (paxPath) {
              h.name = paxPath
              paxPath = null
            }
            place(h, Buffer.alloc(0))
          }
        }
      } catch (e) {
        gunzip.destroy()
        reject(e)
      }
    })
    gunzip.on("end", resolve)
    gunzip.on("error", reject)
    src.on("error", reject)
  })
  for (const [d, m] of dirModes.reverse()) {
    try {
      fs.chmodSync(d, m)
    } catch {}
  }
  return count
}

// ---------- distro sources ----------
async function fetchAlpine(dest, setProgress) {
  const base = "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/"
  setProgress("Ищу свежий Alpine…", 0)
  const yaml = await getText(base + "latest-releases.yaml")
  const m = yaml.match(/file:\s*(alpine-minirootfs-[^\s]+-aarch64\.tar\.gz)[\s\S]*?sha256:\s*([0-9a-f]{64})/)
  if (!m) throw new Error("не нашёл minirootfs в latest-releases.yaml")
  const [, file, sha] = m
  await download(base + file, dest, sha, {}, (f) => setProgress(`Скачиваю ${file}`, f))
  return file
}

async function fetchDebian(dest, setProgress) {
  const repo = "library/debian"
  const tag = "bookworm-slim"
  setProgress("Получаю доступ к реестру Debian…", 0)
  const tok = JSON.parse(await getText(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`)).token
  const auth = { authorization: `Bearer ${tok}` }
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ")
  const reg = "https://registry-1.docker.io/v2/" + repo
  let manifest = JSON.parse(await getText(`${reg}/manifests/${tag}`, { ...auth, accept }))
  if (manifest.manifests) {
    const arm = manifest.manifests.find((x) => x.platform?.architecture === "arm64" && x.platform?.os === "linux" && !x.platform?.variant?.startsWith("v8x"))
    if (!arm) throw new Error("нет arm64 сборки Debian")
    manifest = JSON.parse(await getText(`${reg}/manifests/${arm.digest}`, { ...auth, accept }))
  }
  if (!manifest.layers || manifest.layers.length !== 1) throw new Error("неожиданный формат образа Debian (слоёв: " + (manifest.layers?.length ?? "?") + ")")
  const layer = manifest.layers[0]
  const sha = layer.digest.replace("sha256:", "")
  await download(`${reg}/blobs/${layer.digest}`, dest, sha, auth, (f) => setProgress(`Скачиваю Debian ${tag}`, f))
  return `debian-${tag}`
}

// ---------- install / remove ----------
function setJob(phase, msg, pct) {
  job.phase = phase
  job.msg = msg
  if (pct != null) job.pct = pct
}

function writeEtc(rootfs) {
  const w = (rel, text, onlyIfMissing) => {
    const f = path.join(rootfs, rel)
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true })
      if (onlyIfMissing && fs.existsSync(f)) return
      fs.writeFileSync(f, text)
    } catch (e) {
      log("writeEtc", rel, String(e))
    }
  }
  w("etc/resolv.conf", "nameserver 1.1.1.1\nnameserver 8.8.8.8\n")
  w("etc/hosts", "127.0.0.1 localhost\n::1 localhost\n")
  w("etc/profile.d/opencodepp.sh", 'export PS1="\\u@opencodepp:\\w\\$ "\n')
  fs.mkdirSync(path.join(rootfs, "tmp"), { recursive: true })
  try {
    fs.chmodSync(path.join(rootfs, "tmp"), 0o1777)
  } catch {}
  fs.mkdirSync(path.join(rootfs, "root"), { recursive: true })
}

export async function install(distro) {
  if (job.running) throw new Error("установка уже идёт")
  if (!DISTROS[distro]) throw new Error("неизвестный дистрибутив: " + distro)
  Object.assign(job, { running: true, distro, phase: "download", pct: 0, msg: "Старт…", error: null, startedAt: Date.now() })
  ;(async () => {
    const { base, rootfs } = ctx.p
    const archive = path.join(base, `${distro}.tar.gz`)
    try {
      fs.mkdirSync(base, { recursive: true })
      fs.mkdirSync(ctx.p.tmp, { recursive: true })
      const free = (fs.statfsSync ? fs.statfsSync(base) : null)
      if (free && free.bavail * free.bsize < 400 * 1024 * 1024) throw new Error("мало места: нужно хотя бы 400 МБ свободно")
      const name = await (distro === "alpine" ? fetchAlpine : fetchDebian)(archive, (m, f) => setJob("download", m, Math.round(f * 100)))
      setJob("extract", "Распаковываю…", 0)
      fs.rmSync(rootfs, { recursive: true, force: true })
      const n = await extractTarGz(archive, rootfs, (f) => setJob("extract", "Распаковываю…", Math.round(f * 100)))
      writeEtc(rootfs)
      fs.rmSync(archive, { force: true })
      if (!rootfsReady(rootfs)) throw new Error("после распаковки нет /bin/sh (файлов: " + n + ")")
      writeState({ distro, name, installedAt: Date.now(), files: n, tools: false })
      setJob("check", "Проверяю запуск (proot)…", 100)
      const t = await exec("echo proot-ok && uname -m && cat /etc/os-release | head -2", undefined, 60000)
      if (!t.out.includes("proot-ok")) throw new Error("rootfs распакован, но proot не запустился: " + t.out.slice(0, 300))
      setJob("done", "Готово", 100)
      log("installed", distro, n, "files;", t.out.replace(/\n/g, " | "))
    } catch (e) {
      job.error = String(e && e.message ? e.message : e)
      setJob("error", job.error)
      log("install failed:", job.error)
      try {
        fs.rmSync(archive, { force: true })
      } catch {}
    } finally {
      job.running = false
    }
  })()
}

export function remove() {
  if (job.running) throw new Error("идёт установка")
  fs.rmSync(ctx.p.rootfs, { recursive: true, force: true })
  fs.rmSync(ctx.p.state, { force: true })
  Object.assign(job, { phase: "", pct: 0, msg: "", error: null, distro: null })
}

export function exec(cmd, cwd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/system/bin/sh"
    let out = ""
    let done = false
    const child = spawn(shell, ["-c", cmd], { cwd: cwd || process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    const finish = (code) => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve({ code, out: out.slice(-20000) })
    }
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {}
      out += "\n[timeout]"
      finish(124)
    }, timeoutMs)
    child.stdout.on("data", (c) => (out += c.toString("utf8")))
    child.stderr.on("data", (c) => (out += c.toString("utf8")))
    child.on("error", (e) => {
      out += "spawn error: " + String(e)
      finish(127)
    })
    child.on("close", (code) => finish(code ?? 1))
  })
}

export function status() {
  const st = readState()
  const ready = rootfsReady(ctx.p.rootfs)
  return {
    proot: fs.existsSync(ctx.proot),
    launcher: fs.existsSync(ctx.termsh),
    installed: ready && !!st.distro,
    distro: ready ? st.distro : null,
    name: ready ? st.name : null,
    installing: job.running,
    job: { phase: job.phase, pct: job.pct, msg: job.msg, error: job.error, distro: job.distro },
    shell: process.env.SHELL || null,
  }
}

// ---------- local HTTP API ----------
function serve(password) {
  const server = http.createServer((req, res) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    }
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end()
    const send = (code, obj) => res.writeHead(code, { "content-type": "application/json", ...cors }).end(JSON.stringify(obj))
    if (password) {
      const h = String(req.headers.authorization || "")
      const given = h.startsWith("Basic ") ? Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":") : ""
      if (given !== password) return send(401, { error: "unauthorized" })
    }
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", async () => {
      try {
        const data = body ? JSON.parse(body) : {}
        const url = new URL(req.url, "http://x")
        if (req.method === "GET" && url.pathname === "/term/status") return send(200, status())
        if (req.method === "POST" && url.pathname === "/term/install") {
          await install(String(data.distro || "alpine"))
          return send(202, status())
        }
        if (req.method === "POST" && url.pathname === "/term/remove") {
          remove()
          return send(200, status())
        }
        if (req.method === "POST" && url.pathname === "/term/exec") {
          return send(200, await exec(String(data.cmd || ""), data.cwd ? String(data.cwd) : undefined, Math.min(Number(data.timeout) || 60000, 300000)))
        }
        send(404, { error: "not found" })
      } catch (e) {
        send(500, { error: String(e && e.message ? e.message : e) })
      }
    })
  })
  server.on("error", (e) => log("http error", String(e)))
  server.listen(PORT, "127.0.0.1", () => log("api on 127.0.0.1:" + PORT))
}

// ---------- entry ----------
export function init({ cfg, configDir }) {
  const nativeDir = cfg.nativeBinDir
  const p = paths(configDir)
  ctx = {
    p,
    proot: nativeDir ? path.join(nativeDir, "libproot.so") : "",
    termsh: nativeDir ? path.join(nativeDir, "libtermsh.so") : "",
  }
  fs.mkdirSync(p.base, { recursive: true })
  fs.mkdirSync(p.tmp, { recursive: true })
  if (nativeDir && fs.existsSync(ctx.termsh)) {
    // The opencode shell tool runs SHELL -c "<cmd>". libtermsh enters proot when a rootfs exists,
    // otherwise it execs /system/bin/sh, so the bash tool works before the terminal is installed.
    process.env.SHELL = ctx.termsh
    process.env.TERM_ROOTFS = p.rootfs
    process.env.TERM_PROOT = ctx.proot
    process.env.TERM_BIND = path.resolve(configDir, "..")
    process.env.PROOT_LOADER = path.join(nativeDir, "libproot-loader.so")
    process.env.PROOT_TMP_DIR = p.tmp
    log("SHELL ->", ctx.termsh, "rootfs", rootfsReady(p.rootfs) ? "present" : "absent (fallback to android sh)")
  } else {
    log("libtermsh.so not found in", nativeDir, "- terminal disabled")
  }
  serve(cfg.password || "")
}
