// @refresh reload

import "@/runtime/polyfills"
import { init } from "@sentry/solid"
import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { loadInitialLocale } from "@/runtime/i18n/language"
import { PlatformProvider } from "@/runtime/platform/platform"
import { createWebPlatform } from "@/runtime/platform/web"
import { isStandalone, PwaRoutePersistence, restorePwaRoute } from "@/runtime/platform/pwa"
import { KeyboardInsets } from "@/runtime/platform/keyboard"
import en from "@/runtime/i18n/en"
import zh from "@/runtime/i18n/zh"
import { authFromToken } from "@/runtime/server/api"
import { installStandaloneFetch } from "@/standalone/server"
import { startEmbeddedServer } from "@/embedded"
import pkg from "../package.json"
import { ServerConnection } from "@/runtime/server/registry"

const getLocale = () => {
  if (typeof navigator === "undefined") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]

  for (const language of languages) {
    if (!language) continue

    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }

  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()

  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const root = document.getElementById("root")

if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const clearAuthToken = () => {
  const params = new URLSearchParams(location.search)

  if (!params.has("auth_token")) return
  params.delete("auth_token")
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash)
}

const web = createWebPlatform(pkg.version)

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"), { once: true })
}

if (import.meta.env.VITE_SENTRY_DSN) {
  init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? `web@${pkg.version}`,
    initialScope: {
      tags: {
        platform: "web",
      },
    },
    integrations: (integrations) => {
      return integrations.filter(
        (i) =>
          i.name !== "Breadcrumbs" && !(import.meta.env.OPENCODE_CHANNEL === "prod" && i.name === "GlobalHandlers"),
      )
    },
  })
}

function showEmbeddedStartErrorBanner() {
  try {
    const reason = (window as any).__OPENCODE_EMBEDDED_ERROR__ ?? "unknown error"
    const box = document.createElement("div")
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#2a1518;border:1px solid #7a3038;color:#f0d8da;padding:12px;border-radius:10px;font-family:monospace;font-size:12px"
    const text = document.createElement("div")
    text.textContent =
      "Сервер не запустился — автономный режим. / Embedded server failed, standalone mode. " + reason
    box.appendChild(text)
    const row = document.createElement("div")
    row.style.cssText = "margin-top:8px;display:flex;gap:12px"
    const copy = document.createElement("button")
    copy.textContent = "Скопировать ошибку"
    copy.style.cssText = "text-decoration:underline;color:#fff"
    copy.onclick = () => {
      void navigator.clipboard?.writeText(reason).catch(() => undefined)
      copy.textContent = "Скопировано"
    }
    const hint = document.createElement("span")
    hint.textContent = "Настройки → О приложении → Самотест"
    hint.style.cssText = "opacity:0.7;align-self:center"
    const close = document.createElement("button")
    close.textContent = "✕"
    close.style.cssText = "margin-left:auto;color:#fff"
    close.onclick = () => box.remove()
    row.appendChild(copy)
    row.appendChild(hint)
    row.appendChild(close)
    box.appendChild(row)
    document.body.appendChild(box)
  } catch {}
}

if (root instanceof HTMLElement && root.dataset.opencodeMounted === undefined) {
  // Lazy chunks can import the entry chunk back under a distinct URL, so claim the root before async startup.
  root.dataset.opencodeMounted = ""
  const bootStatus = (t: string) => (window as any).__setBootStatus?.(t)
  void (async () => {
    // Never block the UI on the embedded server: give it a short window
    // (warm launches answer in <2s via the service state file), then boot
    // standalone and reload once if the server becomes ready late.
    bootStatus("Запуск сервера… / Starting server…")
    ;(window as any).__setServerStatus?.("starting")
    const pending = startEmbeddedServer()
    const embedded = await Promise.race([
      pending,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20000)),
    ])
    if (embedded) {
      window.__OPENCODE_EMBEDDED__ = embedded
      ;(window as any).__setServerStatus?.("running")
      try { sessionStorage.removeItem("oc-embedded-reloaded") } catch {}
    } else {
      installStandaloneFetch()
      bootStatus("Сервер недоступен — автономный режим / Standalone mode")
      void pending
        .catch(() => undefined)
        .then((late) => {
          if (late) {
            // Server came up after we fell back: reload to boot on it. Slow
            // devices (and the ARM-translated CI emulator) can need more than
            // one round, so allow up to 3 reloads per app start, then stay
            // standalone rather than loop forever.
            let n = 0
            try {
              n = Number(sessionStorage.getItem("oc-embedded-reloaded") ?? "0") || 0
              sessionStorage.setItem("oc-embedded-reloaded", String(n + 1))
            } catch {}
            if (n < 3) {
              location.reload()
              return
            }
            return
          }
          ;(window as any).__setServerStatus?.("error", (window as any).__OPENCODE_EMBEDDED_ERROR__ ?? "unknown")
          showEmbeddedStartErrorBanner()
        })
    }
    return loadInitialLocale()
  })().then((locale) => {
    const auth = authFromToken(new URLSearchParams(location.search).get("auth_token"))
    clearAuthToken()
    const standalone = isStandalone()
    root.dataset.standalone = String(standalone)

    if (standalone) restorePwaRoute()

    const server: ServerConnection.Http | undefined = web.currentServerUrl
      ? {
          type: "http",
          authToken: !!auth,
          http: {
            url: web.currentServerUrl,
            ...auth,
          },
        }
      : undefined

    render(
      () => (
        <PlatformProvider value={web.platform}>
          <AppBaseProviders locale={locale}>
            <AppInterface
              canonicalLocalServer={server ? ServerConnection.key(server) : undefined}
              servers={server ? [server] : []}
            >
              <KeyboardInsets />
              {standalone && <PwaRoutePersistence />}
            </AppInterface>
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )
    ;(window as any).__removeBootSplash?.()
  })
}
