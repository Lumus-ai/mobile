// Helpers for the alpha-only /update command. The alpha Android app listens on loopback and runs its
// own checked updater (public version.json, fixed release URL, sha256, package and version match).
export const alphaUpdateURL = "http://127.0.0.1:4198/alpha/update"

export type AlphaUpdateNotice = { variant: "success" | "error"; title: string; description?: string }

export function describeAlphaUpdate(status: number | undefined, body: string): AlphaUpdateNotice {
  if (status === undefined)
    return {
      variant: "error",
      title: "Update is not available here",
      description: "/update works only in the OpenCode++ alpha app on Android.",
    }
  let data: { status?: string; installed?: number; channel?: number; message?: string } = {}
  try {
    data = JSON.parse(body)
  } catch {
    // keep defaults
  }
  if (status === 200 && data.status === "up-to-date")
    return { variant: "success", title: "Already up to date", description: `Build ${data.installed}` }
  if (status === 200 && (data.status === "installing" || data.status === "ready"))
    return {
      variant: "success",
      title: `Update ${data.channel} downloaded`,
      description: "Confirm the install in the Android installer window (or tap the notification).",
    }
  return {
    variant: "error",
    title: "Update failed",
    description: data.message ?? `Update server answered ${status}`,
  }
}

export async function runAlphaUpdate(fetcher: typeof fetch = fetch): Promise<AlphaUpdateNotice> {
  try {
    const response = await fetcher(alphaUpdateURL, { method: "POST" })
    return describeAlphaUpdate(response.status, await response.text())
  } catch {
    return describeAlphaUpdate(undefined, "")
  }
}

// Step API used by the /update dialog (check, download with progress, install).
const base = "http://127.0.0.1:4198/alpha"

export type AlphaCheck = { status: "up-to-date" | "available" | "error"; installed?: number; channel?: number; message?: string }
export type AlphaProgress = { status: "idle" | "downloading" | "ready" | "error"; done: number; total: number; channel?: number; message?: string }

export function progressPercent(p: Pick<AlphaProgress, "done" | "total">) {
  if (!p.total || p.total <= 0) return undefined
  return Math.max(0, Math.min(100, Math.floor((p.done / p.total) * 100)))
}

async function call<T>(path: string, method: "GET" | "POST", fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(`${base}/${path}`, { method })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok) throw new Error(body.message ?? `Update server answered ${response.status}`)
  return body
}

export const alphaStep = {
  check: (fetcher: typeof fetch = fetch) => call<AlphaCheck>("check", "POST", fetcher),
  download: (fetcher: typeof fetch = fetch) => call<AlphaProgress>("download", "POST", fetcher),
  progress: (fetcher: typeof fetch = fetch) => call<AlphaProgress>("progress", "GET", fetcher),
  install: (fetcher: typeof fetch = fetch) => call<{ status: string; message?: string }>("install", "POST", fetcher),
}
