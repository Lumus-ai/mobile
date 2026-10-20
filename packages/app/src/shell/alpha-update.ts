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
