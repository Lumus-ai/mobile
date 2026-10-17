import { createBrowserDraftStore } from "@/runtime/persistence/drafts"
import type { Platform } from "./platform"

export function createWebPlatform(version: string) {
  const platform: Platform = {
    platform: "web",
    draftStore: createBrowserDraftStore(),
    version,
    openExternal(value) {
      if (!URL.canParse(value)) return
      const url = new URL(value)

      if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "mailto:") return
      // Inside the Android WebView window.open is a no-op; route through the
      // Capacitor Browser plugin so links (device login!) open in the system browser.
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Browser?: { open: (opts: { url: string }) => Promise<void> } } } }).Capacitor
      if (cap?.isNativePlatform?.() && cap?.Plugins?.Browser) {
        void cap.Plugins.Browser.open({ url: url.href })
        return
      }
      window.open(url.href, "_blank", "noopener,noreferrer")
    },
    restart: async () => window.location.reload(),
    async notify(title, description, onClick) {
      if (!("Notification" in window)) return

      const permission =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied")
          : Notification.permission

      if (permission !== "granted") return

      if (document.visibilityState === "visible" && document.hasFocus()) return

      const notification = new Notification(title, {
        body: description ?? "",
        icon: "https://opencode.ai/favicon-96x96-v3.png",
      })

      notification.onclick = () => {
        window.focus()
        onClick?.()
        notification.close()
      }
    },
  }

  return {
    platform,
    currentServerUrl: getCurrentServerUrl(),
  }
}

function getCurrentServerUrl() {
  if (import.meta.env.VITE_OPENCODE_SERVER_MODE === "none") return undefined

  // Embedded (Capacitor native): the WebView origin is the app's own static
  // host (http://localhost) — never a real opencode server. Treating it as
  // one creates a ghost "localhost" server that steals the default "local"
  // scope (v13.13: two server tabs, dead chat selectors).
  const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (import.meta.env.VITE_OPENCODE_EMBEDDED === "1" && capacitor?.isNativePlatform?.()) return undefined

  if (import.meta.env.DEV) {
    const loopback =
      location.hostname === "localhost" || location.hostname === "[::1]" || location.hostname.startsWith("127.")

    const host = import.meta.env.VITE_OPENCODE_SERVER_HOST ?? (loopback ? location.hostname : "localhost")

    return `http://${host}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  }

  return location.origin
}
