import { createSignal, For, Show } from "solid-js"
import { runFetchProbe } from "@/embedded"

type Status = "pending" | "run" | "pass" | "fail" | "skip"
interface Check {
  id: string
  name: string
  status: Status
  detail?: string
}

interface CapacitorLike {
  isNativePlatform?: () => boolean
  Plugins?: Record<string, any>
}

const cap = () => (globalThis as { Capacitor?: CapacitorLike }).Capacitor

const info = () => (globalThis as any).__OPENCODE_EMBEDDED__ as
  | { url: string; username: string; password: string; state?: string; error?: string; projectsDir?: string }
  | undefined

async function api(path: string, init?: RequestInit, auth = true): Promise<Response> {
  const i = info()
  if (!i) throw new Error("embedded server not running")
  const headers = new Headers(init?.headers)
  if (auth) headers.set("authorization", `Basic ${btoa(`${i.username}:${i.password}`)}`)
  return fetch(`${i.url}${path}`, { ...init, headers })
}

async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const r = await api(path, init)
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r.json()
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))])

export function DebugSelfTest() {
  const [checks, setChecks] = createSignal<Check[]>([])
  let extraReport = ""
  const [apkVersion, setApkVersion] = createSignal<string>("")
  void (async () => {
    try {
      const di = await cap()?.Plugins?.EmbeddedServer?.deviceInfo?.()
      if (di) setApkVersion(`APK v${di.versionName} (code ${di.versionCode}), Android ${di.release} SDK ${di.sdkInt}, page ${di.pageSizeBytes}B`)
    } catch {}
  })()
  const [running, setRunning] = createSignal(false)
  const [copied, setCopied] = createSignal(false)

  const set = (id: string, status: Status, detail?: string) =>
    setChecks((list) => list.map((c) => (c.id === id ? { ...c, status, detail } : c)))

  const report = () =>
    [
      `OpenCode++ self-test ${new Date().toISOString()}`,
      ...checks().map((c) => `[${c.status.toUpperCase()}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`),
      ...(extraReport ? ["", extraReport] : []),
    ].join("\n")

  const copy = async () => {
    const text = report()
    try {
      const p = (globalThis as any).Capacitor?.Plugins?.Clipboard
      if (p?.write) await p.write({ string: text })
      else await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setCopied(false)
      alert(`Copy failed: ${e}`)
    }
  }

  const run = async () => {
    if (running()) return
    setRunning(true)
    setCopied(false)
    extraReport = ""
    const defs: Array<[string, string]> = [
      ["device", "Device / app info"],
      ["state-file", "Server state file + node log"],
      ["redaction", "Secret redaction in report"],
      ["mode", "Embedded server mode (not standalone)"],
      ["fetch-probe", "WebView fetch probe (origin/CORS/status)"],
      ["plugin-state", "Server process state"],
      ["port", "Port 4096 answers"],
      ["auth", "Auth handshake (password)"],
      ["db", "DB write + read (session)"],
      ["project-dir", "Project directory"],
      ["models", "Model catalog (incl. opencode free)"],
      ["device-login", "Device login can start"],
      ["browser", "System browser available"],
      ["keycheck", "Key validation endpoint reachable"],
      ["storage", "Local storage persistence"],
    ]
    setChecks(defs.map(([id, name]) => ({ id, name, status: "pending" as Status })))
    const promptRows: string[] = []

    // 1. device info
    set("device", "run")
    try {
      const di = cap()?.Plugins?.EmbeddedServer?.deviceInfo
        ? await cap()!.Plugins!.EmbeddedServer.deviceInfo()
        : undefined
      if (di) {
        set(
          "device",
          "pass",
          `${di.device ?? "?"}; Android ${di.release ?? "?"} (SDK ${di.sdkInt ?? "?"}); ABI ${di.abis ?? "?"}; page size ${di.pageSizeBytes ?? "?"} B${di.pageSizeBytes === 16384 ? " (16KB)" : ""}; app v${di.versionName ?? "?"} (code ${di.versionCode ?? "?"})`,
        )
      } else {
        set("device", "skip", "not a native build (no EmbeddedServer plugin)")
      }
    } catch (e) {
      set("device", "fail", String(e))
    }

    // 1b. state file + node log (works in fallback too — this is where the
    // :node process publishes its failure reason)
    set("state-file", "run")
    try {
      const di = await cap()?.Plugins?.EmbeddedServer?.debugInfo?.()
      if (!di) {
        set("state-file", "skip", "plugin not present")
      } else {
        set("state-file", "pass", "captured — included in the report below")
        extraReport = `--- state file ---\n${di.stateFile ?? "(none)"}\n--- node log tail ---\n${di.logTail ?? "(none)"}\n--- java boot log tail ---\n${di.bootLog ?? "(none)"}\n--- node variant results ---\n${di.variantResults ?? "(none)"}`
      }
    } catch (e) {
      set("state-file", "fail", String(e))
    }

    // 1c. secret redaction: fixture with a secret must leave the report clean
    set("redaction", "run")
    try {
      const rt = await cap()?.Plugins?.EmbeddedServer?.redactSelfTest?.()
      if (!rt) {
        set("redaction", "skip", "plugin not present")
      } else if (rt.leaks) {
        set("redaction", "fail", `fixture secret LEAKED into report: ${String(rt.sample ?? "").slice(0, 120)}`)
      } else if (!rt.keepsContext) {
        set("redaction", "fail", `over-redacted — state/ts/path lost: ${String(rt.sample ?? "").slice(0, 120)}`)
      } else {
        set("redaction", "pass", "password/token/key/cookie scrubbed, state/ts/paths kept")
      }
    } catch (e) {
      set("redaction", "fail", String(e))
    }

    // 1d. WebView fetch probe: what fetch() actually sees from inside the
    // WebView (v13.10: every call died "TypeError: Failed to fetch" while the
    // server answered curl — missing CORS). Reuses the boot probe if present.
    set("fetch-probe", "run")
    try {
      const cached = (globalThis as any).__OPENCODE_FETCH_PROBE__
      const i2 = info()
      const probe = cached ?? (i2 ? await runFetchProbe(i2) : undefined)
      if (!probe) {
        set("fetch-probe", "skip", "embedded server not running")
      } else {
        const bad = probe.probes.filter((x) => !x.ok && !(x.name.startsWith("no-auth") && x.status === 401))
        const detail = probe.probes
          .map((x) => `${x.name}: ${x.ok ? `HTTP ${x.status}` : x.status ? `HTTP ${x.status}` : x.error}`)
          .join(" | ")
        set("fetch-probe", bad.length ? "fail" : "pass", `origin=${probe.origin}; ${detail}`.slice(0, 300))
      }
    } catch (e) {
      set("fetch-probe", "fail", String(e))
    }

    // 2. embedded mode
    set("mode", "run")
    const i = info()
    if (i?.password) set("mode", "pass", `embedded at ${i.url}`)
    else {
      const why = (globalThis as any).__OPENCODE_EMBEDDED_ERROR__
      set("mode", "fail", `standalone fallback active${why ? ` — ${why}` : " — status line shows -standalone"}`)
    }

    // 3. plugin state
    set("plugin-state", "run")
    try {
      const st = cap()?.Plugins?.EmbeddedServer?.status ? await cap()!.Plugins!.EmbeddedServer.status() : undefined
      if (!st) set("plugin-state", "skip", "plugin not present")
      else if (st.state === "ready" || st.state === "running") set("plugin-state", "pass", `state=${st.state}`)
      else set("plugin-state", "fail", `state=${st.state}${st.lastError || st.error ? ` (${st.lastError ?? st.error})` : ""}`)
    } catch (e) {
      set("plugin-state", "fail", String(e))
    }

    // 4. port answers (no auth; any HTTP response = server listening)
    set("port", "run")
    if (!i) set("port", "skip", "embedded server not running")
    else {
      try {
        const r = await withTimeout(api("/api/info", undefined, false).catch(() => api("/api/provider", undefined, false)), 8000, "port probe")
        set("port", "pass", `HTTP ${r.status} (server listening; 401 expected without password)`)
      } catch (e) {
        set("port", "fail", String(e))
      }
    }

    // 5. auth handshake
    set("auth", "run")
    if (!i) set("auth", "skip", "embedded server not running")
    else {
      try {
        await withTimeout(apiJson("/api/integration"), 8000, "auth handshake")
        set("auth", "pass", "authenticated request OK")
      } catch (e) {
        set("auth", "fail", String(e))
      }
    }

    // 6. DB write+read via session create
    let sessionID: string | undefined
    set("db", "run")
    if (!i) set("db", "skip", "embedded server not running")
    else {
      try {
        const created = await withTimeout(
          apiJson("/api/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "debug-selftest" }),
          }),
          10000,
          "session create",
        )
        sessionID = created?.data?.id ?? created?.id
        if (!sessionID) throw new Error("no session id in response")
        const list = await apiJson("/api/session")
        const found = (list?.data ?? []).some((s: any) => s.id === sessionID)
        if (!found) throw new Error("session not readable after create")
        set("db", "pass", `session ${sessionID} written and read back`)
      } catch (e) {
        set("db", "fail", String(e))
      }
    }

    // 7. project dir
    set("project-dir", "run")
    if (!i) set("project-dir", "skip", "embedded server not running")
    else {
      try {
        const dir = i.projectsDir
        const r = await withTimeout(apiJson("/api/fs/list?path=."), 8000, "fs list")
        const n = (r?.data ?? []).length
        set("project-dir", "pass", `${dir ?? "(unknown dir)"}; fs list OK (${n} entries)`)
      } catch (e) {
        set("project-dir", "fail", String(e))
      }
    }

    // 8. model catalog
    let models: any[] = []
    set("models", "run")
    if (!i) set("models", "skip", "embedded server not running")
    else {
      try {
        const r = await withTimeout(apiJson("/api/model"), 10000, "model list")
        models = r?.data ?? []
        const byProvider: Record<string, number> = {}
        for (const m of models) byProvider[m.providerID] = (byProvider[m.providerID] ?? 0) + 1
        const freeInput = (cost: any) =>
          (Array.isArray(cost) ? (cost.find((t: any) => t?.tier === undefined) ?? cost[0])?.input : cost?.input) ?? 1
        const free = models.filter((m) => m.providerID === "opencode" && freeInput(m.cost) === 0)
        set(
          "models",
          "pass",
          `${models.length} models; opencode: ${byProvider["opencode"] ?? 0} (${free.length} free); providers: ${Object.entries(byProvider)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")}`,
        )
      } catch (e) {
        set("models", "fail", String(e))
      }
    }

    // 9. device login can start (then cancel)
    set("device-login", "run")
    if (!i) set("device-login", "skip", "embedded server not running")
    else {
      try {
        const r = await withTimeout(
          apiJson("/api/integration/opencode/connect/oauth", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ methodID: "device" }),
          }),
          12000,
          "device login start",
        )
        const auth = r?.data ?? r
        if (!auth?.attemptID || !auth?.url) throw new Error(`unexpected response: ${JSON.stringify(auth).slice(0, 120)}`)
        try {
          await api(`/api/integration/opencode/connect/oauth/${encodeURIComponent(auth.attemptID)}`, { method: "DELETE" })
        } catch {}
        set("device-login", "pass", `code issued (attempt ${auth.attemptID.slice(0, 12)}…), url present, cancelled after check`)
      } catch (e) {
        set("device-login", "fail", String(e))
      }
    }

    // 10. system browser capability
    set("browser", "run")
    const hasBrowser = !!cap()?.Plugins?.Browser
    if (hasBrowser) set("browser", "pass", "Capacitor Browser plugin present (links open in system browser)")
    else if (cap()?.isNativePlatform?.()) set("browser", "fail", "native build without Browser plugin — device login link cannot open")
    else set("browser", "skip", "web build uses window.open")

    // 11. key validation reachable
    set("keycheck", "run")
    try {
      const r = await withTimeout(
        fetch("https://openrouter.ai/api/v1/auth/key", { headers: { authorization: "Bearer sk-or-debug-selftest-invalid" } }),
        10000,
        "keycheck",
      )
      if (r.status === 401 || r.status === 403) set("keycheck", "pass", `provider reachable, bad key correctly rejected (HTTP ${r.status})`)
      else set("keycheck", "fail", `expected 401/403 for a bad key, got HTTP ${r.status}`)
    } catch (e) {
      set("keycheck", "fail", `endpoint unreachable: ${e}`)
    }

    // 12. local storage persistence
    set("storage", "run")
    try {
      const k = "opencode-debug-selftest"
      localStorage.setItem(k, "ok")
      const v = localStorage.getItem(k)
      localStorage.removeItem(k)
      if (v === "ok") set("storage", "pass", "localStorage write/read/remove OK")
      else throw new Error(`read back ${JSON.stringify(v)}`)
    } catch (e) {
      set("storage", "fail", String(e))
    }

    // 13. prompt per connected provider
    if (!i || !sessionID) {
      promptRows.push("skipped — no embedded server or session")
    } else {
      let connected: string[] = []
      try {
        const ints = await apiJson("/api/integration")
        connected = (ints?.data ?? [])
          .filter((x: any) => (x.connections ?? []).length > 0)
          .map((x: any) => x.id)
          .filter((id: string) => models.some((m) => m.providerID === id))
      } catch (e) {
        promptRows.push(`cannot list integrations: ${e}`)
      }
      if (connected.length === 0) promptRows.push("no connected providers with models — nothing to prompt")
      for (const pid of connected) {
        const model = models.find((m) => m.providerID === pid)
        try {
          await withTimeout(
            api(`/api/session/${encodeURIComponent(sessionID)}/model`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ model: { providerID: pid, id: model.id } }),
            }).then((r) => {
              if (!r.ok && r.status !== 204) throw new Error(`switch model HTTP ${r.status}`)
            }),
            8000,
            "switch model",
          )
          await api(`/api/session/${encodeURIComponent(sessionID)}/prompt`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: "Reply with exactly one word: OK" }),
          }).then(async (r) => {
            if (!r.ok) throw new Error(`prompt HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
          })
          const deadline = Date.now() + 30000
          let got = ""
          while (Date.now() < deadline && !got) {
            await new Promise((r2) => setTimeout(r2, 2000))
            const msgs = await apiJson(`/api/session/${encodeURIComponent(sessionID)}/message?limit=20`).catch(() => undefined)
            const arr = msgs?.data ?? []
            const reply = arr.find((m: any) => m.role === "assistant" || m.type === "assistant" || m.info?.role === "assistant")
            const err = arr.find((m: any) => m.error || m.info?.error)
            if (reply) got = "reply received"
            else if (err) throw new Error(`provider error: ${JSON.stringify(err.error ?? err.info?.error).slice(0, 160)}`)
          }
          if (!got) throw new Error("no assistant reply within 30s")
          promptRows.push(`${pid}/${model.id}: OK (reply received)`)
        } catch (e) {
          promptRows.push(`${pid}/${model?.id}: FAIL — ${e}`)
        }
      }
    }
    setChecks((list) => [
      ...list,
      ...promptRows.map((row, n) => ({
        id: `prompt-${n}`,
        name: `Prompt test ${n + 1}`,
        status: (row.includes("FAIL") ? "fail" : row.startsWith("skipped") || row.startsWith("no connected") || row.startsWith("cannot") ? "skip" : "pass") as Status,
        detail: row,
      })),
    ])

    setRunning(false)
  }

  const [variantsRunning, setVariantsRunning] = createSignal(false)
  const [variantLines, setVariantLines] = createSignal<string[]>([])

  // "Try all Node start ways": the :node service runs each start variant in a
  // fresh process (eval hello-world, eval http listen, require(bootstrap.js),
  // fresh re-extract + normal start) and records a result line per variant —
  // including "process died" when a native crash kills the attempt.
  const runVariants = async () => {
    if (variantsRunning()) return
    setVariantsRunning(true)
    setVariantLines([])
    try {
      const plug = cap()?.Plugins?.EmbeddedServer
      if (!plug?.runNodeVariants) {
        setVariantLines(["EmbeddedServer plugin not present / плагин недоступен (не нативная сборка?)"])
        return
      }
      setVariantLines(["Запускаю диагностику способов старта Node — процесс :node будет перезапускаться, это займёт 1-3 минуты…"])
      await plug.runNodeVariants()
      const fmt = (vr: string) =>
        vr
          .split("\n")
          .filter(Boolean)
          .map((l) => {
            try {
              const j = JSON.parse(l)
              return `${j.variant}: ${String(j.status).toUpperCase()}${j.detail ? ` — ${j.detail}` : ""}`
            } catch {
              return l
            }
          })
      const deadline = Date.now() + 6 * 60 * 1000
      let sawAny = false
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const di = await plug.debugInfo().catch(() => undefined)
        if (!di) continue
        const lines = fmt(String(di.variantResults ?? ""))
        if (lines.length) {
          sawAny = true
          setVariantLines(lines)
        }
        const vs = String(di.variantState ?? "(none)")
        if (sawAny && vs === "(none)") break
      }
      extraReport += `${extraReport ? "\n" : ""}--- node variant results ---\n${variantLines().join("\n")}`
    } catch (e) {
      setVariantLines((v) => [...v, `error: ${e}`])
    } finally {
      setVariantsRunning(false)
    }
  }

  return (
    <div style={{ "margin-top": "24px", "border-top": "1px solid var(--border-weak-base, #333)", "padding-top": "16px" }}>
      <h3 style={{ "font-weight": "600", "margin-bottom": "8px" }}>Self-test / Самотест</h3>
      <Show when={apkVersion()}>
        <p style={{ "font-size": "12px", "font-family": "monospace", "margin-bottom": "4px" }}>{apkVersion()}</p>
      </Show>
      <p style={{ "font-size": "12px", opacity: "0.7", "margin-bottom": "12px" }}>
        Runs on-device checks and builds a copyable report. Запускает проверки на телефоне и собирает отчёт для отправки.
      </p>
      <div style={{ display: "flex", gap: "8px", "margin-bottom": "12px" }}>
        <button type="button" class="settings-about-link" onClick={() => void run()} disabled={running()}>
          {running() ? "Running…" : "Run self-test / Запустить"}
        </button>
        <button type="button" class="settings-about-link" onClick={() => void runVariants()} disabled={variantsRunning()}>
          {variantsRunning() ? "Probing Node starts… / Пробую…" : "Try all Node start ways / Все способы запуска Node"}
        </button>
        <Show when={checks().length > 0 && !running()}>
          <button type="button" class="settings-about-link" onClick={() => void copy()}>
            {copied() ? "Copied!" : "Copy report / Скопировать"}
          </button>
        </Show>
      </div>
      <Show when={checks().length > 0}>
        <ul style={{ "font-size": "12px", "line-height": "1.6", "font-family": "monospace" }}>
          <For each={checks()}>
            {(c) => (
              <li>
                {c.status === "pass" ? "✅" : c.status === "fail" ? "❌" : c.status === "skip" ? "➖" : c.status === "run" ? "⏳" : "•"} {c.name}
                <Show when={c.detail}>
                  <span style={{ opacity: "0.65" }}>{` — ${c.detail}`}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={variantLines().length > 0}>
        <pre style={{ "font-size": "11px", "white-space": "pre-wrap", "word-break": "break-word", opacity: "0.85" }}>{variantLines().join("\n")}</pre>
      </Show>
    </div>
  )
}
