import { useLocation, Route, useParams } from "@solidjs/router"
import { createMemo, lazy, Show, Suspense, type ParentProps } from "solid-js"
import { Home } from "@/home/route"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { LayoutProvider } from "@/shell/state/layout"
import { SettingsSurfaceProvider } from "@/settings/surface"
import Shell from "@/shell/shell"
import { requireServerKey } from "./session"
import { ExtensionAttachment } from "@/runtime/extension/root"

export const File = lazy(() => import("@opencode/session-ui/file").then((module) => ({ default: module.File })))

const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)

const DraftRoute = lazy(() => import("@/new-session/route").then((module) => ({ default: module.DraftRoute })))

const SettingsScreen = lazy(() => import("@/settings/shell").then((module) => ({ default: module.SettingsScreen })))

const OfflineHomeScreen = lazy(() =>
  import("@/servers/connect/offline-screen").then((module) => ({ default: module.OfflineHomeScreen })),
)

const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]

  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)

  if (pathname === "/settings") return SettingsScreen.preload().then(() => undefined)

  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)

  return Promise.resolve()
}

export function AppRoutes() {
  return (
    <Route component={AppLayout}>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsScreen} />
      <Route
        path="/server/:serverKey/session/:id"
        component={() => (
          <SessionRouteFrame>
            <Suspense
              fallback={
                <div class="flex min-h-0 flex-1 px-[var(--shell-inline-inset,8px)] pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
                  <SessionPanelFrame raised />
                </div>
              }
            >
              <TargetServerRoute>
                <TargetSessionRouteContent />
              </TargetServerRoute>
            </Suspense>
          </SessionRouteFrame>
        )}
      />
      <Route path="/new-session" component={DraftRoute} />
    </Route>
  )
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()

  const connection = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === requireServerKey(params.serverKey)),
  )

  return (
    <Show when={connection()} keyed>
      {(connection) => <ServerProvider conn={connection}>{props.children}</ServerProvider>}
    </Show>
  )
}

function AppLayout(props: ParentProps) {
  const servers = useServers()
  const global = useGlobal()
  const location = useLocation()
  // Settings must always open, even with no reachable server: the full settings stack
  // renders on the launch-screen branch too (server-dependent sections just show empty).
  const settingsPath = () => location.pathname === "/settings"

  // The shell only mounts when every saved server answers; an unreachable (or not-yet-embedded)
  // server leaves the app on the launch screen. Health polls every 10s, so the app flips on its own.
  const reachable = () =>
    servers.list.every((server) => global.servers.health[ServerConnection.key(server)]?.healthy !== false)

  // A lone server that rejects our credentials (e.g. the web app before pairing) has nothing else to show.
  const signedOut = () => {
    const only = servers.list.length === 1 ? servers.list[0] : undefined

    if (only?.type !== "http") return

    return global.servers.health[ServerConnection.key(only)]?.unauthorized ? only : undefined
  }

  return (
    <Show
      when={servers.list.length > 0 && !signedOut() && reachable()}
      fallback={
        // No pairing UI in this build: with no reachable server, stay on the launch screen quietly.
        <Show
          when={settingsPath()}
          fallback={<OfflineHomeScreen />}
        >
          <LayoutProvider>
            <SettingsSurfaceProvider>
              <SettingsScreen />
            </SettingsSurfaceProvider>
          </LayoutProvider>
        </Show>
      }
    >
      <LayoutProvider>
        <SettingsSurfaceProvider>
          <ExtensionAttachment>
            <Shell>{props.children}</Shell>
          </ExtensionAttachment>
        </SettingsSurfaceProvider>
      </LayoutProvider>
    </Show>
  )
}
