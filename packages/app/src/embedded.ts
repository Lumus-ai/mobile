/**
 * Embedded server mode (VITE_OPENCODE_EMBEDDED=1): the APK ships a real
 * opencode server (nodejs-mobile) started by the EmbeddedServer Capacitor
 * plugin in a foreground service. On boot the app starts it and switches the
 * built-in 127.0.0.1:4096 profile from the in-page standalone shim to the
 * real server with the plugin's per-launch random password. If the plugin is
 * missing or fails, the app falls back to the standalone shim.
 */
export interface EmbeddedInfo {
  url: string
  username: string
  password: string
  state: string
  error?: string
  /** Real on-device dir for user projects (app-private files dir). */
  projectsDir?: string
}

declare global {
  interface Window {
    __OPENCODE_EMBEDDED__?: EmbeddedInfo
  }
}

const enabled = () => import.meta.env.VITE_OPENCODE_EMBEDDED === "1"

// Build-flavor marker: survives minification only in embedded builds (the
// constant condition is dead-code-eliminated otherwise). The APK build check
// and CI grep dist for __BUILD_FLAVOR__="embedded" to catch a bundle built
// without VITE_OPENCODE_EMBEDDED=1 (v13.12 shipped standalone by mistake).
if (import.meta.env.VITE_OPENCODE_EMBEDDED === "1") {
  ;(globalThis as Record<string, unknown>).__BUILD_FLAVOR__ =
    import.meta.env.VITE_OPENCODE_SERVER_MODE === "none" ? "embedded-noserver" : "embedded"
}

export function embeddedProjectsDir(): string | undefined {
  return window.__OPENCODE_EMBEDDED__?.projectsDir
}

export function embeddedAvailable(): boolean {
  const capacitor = (globalThis as { Capacitor?: any }).Capacitor
  return enabled() && !!capacitor?.isNativePlatform?.() && !!capacitor?.Plugins?.EmbeddedServer
}

declare global {
  interface Window {
    /** Why the last embedded start attempt failed (shown by the debug self-test). */
    __OPENCODE_EMBEDDED_ERROR__?: string
  }
}

const recordFailure = (reason: string) => {
  window.__OPENCODE_EMBEDDED_ERROR__ = reason
}

/**
 * Starts the on-device server; resolves undefined on any failure (caller falls
 * back). First boot on a phone can exceed the plugin's 30s ready deadline
 * (38MB asset extraction + node cold start), so retry while the native side
 * keeps booting; the failure reason is stashed for the debug self-test.
 */
export async function startEmbeddedServer(): Promise<EmbeddedInfo | undefined> {
  if (!embeddedAvailable()) {
    recordFailure("embedded not available: missing Capacitor, EmbeddedServer plugin, native platform, or VITE_OPENCODE_EMBEDDED")
    return undefined
  }
  const capacitor = (globalThis as { Capacitor?: any }).Capacitor
  let lastError = "unknown"
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const info = (await capacitor.Plugins.EmbeddedServer.start()) as EmbeddedInfo
      if (info?.password) {
        window.__OPENCODE_EMBEDDED__ = info
        void runFetchProbe(info)
        return info
      }
      lastError = "start returned no password"
    } catch (e) {
      lastError = String((e as any)?.message ?? e)
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  recordFailure(`embedded server start failed after 4 attempts: ${lastError}`)
  return undefined
}

export interface FetchProbeResult {
  ts: number
  origin: string
  userAgentMobile: boolean
  probes: { name: string; url: string; ok: boolean; status?: number; error?: string }[]
}

/**
 * Diagnoses WebView -> embedded-server fetch from INSIDE the WebView (v13.10:
 * every call died with "TypeError: Failed to fetch" while curl from the host
 * worked — turned out to be missing CORS headers/preflight answers). Runs
 * once after the server comes up; the result is written to the native files
 * dir so the self-test and CI can read it back.
 */
export async function runFetchProbe(info: EmbeddedInfo): Promise<FetchProbeResult> {
  const probes: FetchProbeResult["probes"] = []
  const auth = `Basic ${btoa(`${info.username}:${info.password}`)}`
  const attempt = async (name: string, init: RequestInit) => {
    const url = `${info.url}/api/info`
    try {
      const r = await fetch(url, init)
      probes.push({ name, url, ok: r.ok, status: r.status })
    } catch (e) {
      probes.push({ name, url, ok: false, error: `${(e as any)?.name ?? "Error"}: ${(e as any)?.message ?? String(e)}` })
    }
  }
  await attempt("no-auth (expect 401 readable, not TypeError)", {})
  await attempt("basic-auth", { headers: { authorization: auth } })
  const result: FetchProbeResult = {
    ts: Date.now(),
    origin: globalThis.location?.origin ?? "unknown",
    userAgentMobile: /android/i.test(globalThis.navigator?.userAgent ?? ""),
    probes,
  }
  try {
    const capacitor = (globalThis as { Capacitor?: any }).Capacitor
    await capacitor?.Plugins?.EmbeddedServer?.writeFetchProbe?.({ json: JSON.stringify(result) })
  } catch {}
  ;(globalThis as any).__OPENCODE_FETCH_PROBE__ = result
  return result
}

/** Calls an embedded-server endpoint with the per-launch credentials. */
export async function embeddedFetch(path: string, init?: RequestInit): Promise<Response> {
  const info = window.__OPENCODE_EMBEDDED__
  if (!info) throw new Error("embedded server not running")
  const headers = new Headers(init?.headers)
  headers.set("authorization", `Basic ${btoa(`${info.username}:${info.password}`)}`)
  return fetch(`${info.url}${path}`, { ...init, headers })
}
