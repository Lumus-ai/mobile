import { createMemo, createSignal, For, onMount, Show, Suspense, Match, Switch, type ParentProps } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { TitlebarRightProvider } from "@/shell/titlebar/right-slot"
import { ToastRegion } from "@/shell/notifications/toast"
import { MuseProvider, useMuse, type MuseTab } from "./state"
import { FenrirAvatar } from "./avatar"
import { avatarSettings, initAvatar } from "./avatar-store"
import { ChatScreen } from "./chat"
import { ProjectsScreen, RoomsScreen, SessionsScreen, SettingsScreen, TasksScreen } from "./screens"
import { AvatarSettingsScreen } from "./avatar-settings"
import { TerminalScreen } from "./terminal"
import { IconBack, IconChat, IconCheck, IconFolder, IconMenu, IconNodes, IconPlus, IconSliders, IconStack } from "./icons"
import "./muse.css"

const TABS: Array<{ id: MuseTab; label: string; icon: () => import("solid-js").JSX.Element }> = [
  { id: "chat", label: "Чат", icon: () => <IconChat /> },
  { id: "sessions", label: "Сессии", icon: () => <IconStack /> },
  { id: "projects", label: "Проекты", icon: () => <IconFolder /> },
  { id: "tasks", label: "Задачи", icon: () => <IconCheck /> },
  { id: "rooms", label: "Комнаты", icon: () => <IconNodes /> },
]

function ModelSheet(props: { onClose: () => void }) {
  const muse = useMuse()
  onMount(() => void muse.loadModels())
  const groups = createMemo(() => {
    const map = new Map<string, ReturnType<typeof muse.models>>()
    for (const model of muse.models()) map.set(model.providerID, [...(map.get(model.providerID) ?? []), model])
    return [...map.entries()]
  })
  return (
    <div class="mz-sheet-backdrop" onClick={props.onClose}>
      <div class="mz-sheet" onClick={(event) => event.stopPropagation()}>
        <h3>Модель</h3>
        <Show when={muse.models().length > 0} fallback={<p class="mz-muted">Моделей пока нет. Подключи провайдера в настройках.</p>}>
          <For each={groups()}>
            {([provider, items]) => (
              <>
                <p class="mz-section">{provider}</p>
                <div class="mz-group">
                  <For each={items.slice(0, 40)}>
                    {(model) => (
                      <button
                        type="button"
                        class="mz-row"
                        onClick={() => {
                          muse.setChoice(model)
                          props.onClose()
                        }}
                      >
                        <span class="mz-row-text">
                          <span class="mz-row-title">{model.name}</span>
                        </span>
                        <Show when={muse.choice()?.modelID === model.modelID && muse.choice()?.providerID === model.providerID}>
                          <span class="mz-green">●</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}

function Drawer() {
  const muse = useMuse()
  return (
    <Show when={muse.menuOpen()}>
      <div class="mz-sheet-backdrop mz-drawer-backdrop" onClick={() => muse.setMenuOpen(false)}>
        <aside class="mz-drawer" onClick={(event) => event.stopPropagation()}>
          <button type="button" class="mz-btn mz-btn-blue mz-btn-wide" onClick={muse.newChat}>
            <IconPlus width={18} height={18} /> Новый чат
          </button>
          <p class="mz-section">Недавние</p>
          <div class="mz-drawer-list">
            <For each={muse.sessions().slice(0, 30)} fallback={<p class="mz-muted">Пока пусто</p>}>
              {(item) => (
                <button type="button" class="mz-drawer-item" data-active={muse.sessionId() === item.id ? "1" : "0"} onClick={() => muse.openSession(item.id)}>
                  {item.title || "Новая сессия"}
                </button>
              )}
            </For>
          </div>
          <button type="button" class="mz-drawer-foot" onClick={() => muse.setTab("settings")}>
            Настройки
          </button>
        </aside>
      </div>
    </Show>
  )
}

function Header() {
  const muse = useMuse()
  const [sheet, setSheet] = createSignal(false)
  const tab = () => muse.tab()
  const backTitle = () => (tab() === "settings" ? "Настройки" : tab() === "avatar" ? "Аватар" : tab() === "terminal" ? "Терминал" : undefined)
  const state = () => (tab() === "chat" ? muse.activity().state : "idle")
  const caption = () => (tab() === "chat" && avatarSettings().captions ? muse.activity().caption : undefined)
  return (
    <Show
      when={!backTitle()}
      fallback={
        <header class="mz-header mz-header-back">
          <button type="button" class="mz-circle" aria-label="Назад" onClick={() => muse.setTab(tab() === "avatar" || tab() === "terminal" ? "settings" : "chat")}>
            <IconBack />
          </button>
          <h2>{backTitle()}</h2>
          <span class="mz-header-space" />
        </header>
      }
    >
      <header class="mz-header">
        <Show
          when={tab() === "chat"}
          fallback={<span class="mz-header-space" />}
        >
          <button type="button" class="mz-circle" aria-label="Меню" onClick={() => muse.setMenuOpen(true)}>
            <IconMenu />
          </button>
        </Show>
        <div class="mz-header-center">
          <FenrirAvatar state={state()} size={tab() === "chat" ? 72 : 84} />
          <span class="mz-name-pill">{tab() === "chat" ? "Фенрир (Fenrir)" : "OpenCode++"}</span>
          <Show when={caption()}>
            {(text) => (
              <span class="mz-caption-pill" data-state={state()}>
                <Show when={muse.running()}>
                  <span class="mz-spinner mz-spinner-sm" data-on="1" />
                </Show>
                {text()}
              </span>
            )}
          </Show>
        </div>
        <Show
          when={tab() === "chat"}
          fallback={
            <button type="button" class="mz-circle" aria-label="Настройки" onClick={() => muse.setTab("settings")}>
              <IconSliders />
            </button>
          }
        >
          <button type="button" class="mz-model-pill" onClick={() => setSheet(true)}>
            <span class="mz-dot" data-on={muse.connected() ? "1" : "0"} />
            <span>{muse.modelName()}</span>
          </button>
        </Show>
      </header>
      <Show when={sheet()}>
        <ModelSheet onClose={() => setSheet(false)} />
      </Show>
    </Show>
  )
}

function TabBar() {
  const muse = useMuse()
  return (
    <nav class="mz-tabbar" aria-label="Разделы">
      <For each={TABS}>
        {(item) => (
          <button type="button" aria-label={item.label} data-active={muse.tab() === item.id ? "1" : "0"} onClick={() => muse.setTab(item.id)}>
            {item.icon()}
          </button>
        )}
      </For>
    </nav>
  )
}

function Frame() {
  const muse = useMuse()
  const bare = () => muse.tab() === "settings" || muse.tab() === "avatar" || muse.tab() === "terminal"
  return (
    <>
      <Header />
      <main class="mz-main">
        <Switch>
          <Match when={muse.tab() === "chat"}>
            <ChatScreen />
          </Match>
          <Match when={muse.tab() === "sessions"}>
            <SessionsScreen />
          </Match>
          <Match when={muse.tab() === "projects"}>
            <ProjectsScreen />
          </Match>
          <Match when={muse.tab() === "tasks"}>
            <TasksScreen />
          </Match>
          <Match when={muse.tab() === "rooms"}>
            <RoomsScreen />
          </Match>
          <Match when={muse.tab() === "settings"}>
            <SettingsScreen />
          </Match>
          <Match when={muse.tab() === "avatar"}>
            <AvatarSettingsScreen />
          </Match>
          <Match when={muse.tab() === "terminal"}>
            <TerminalScreen />
          </Match>
        </Switch>
      </main>
      <Show when={!bare()}>
        <TabBar />
      </Show>
      <Drawer />
    </>
  )
}

/** Muse-style shell: Fenrir header, five tabs. Other routes (full settings, sessions opened by link) keep the old screens. */
export default function MuseShell(props: ParentProps) {
  const location = useLocation()
  onMount(() => void initAvatar())
  const atRoot = () => location.pathname === "/"
  return (
    <TitlebarRightProvider>
      <MuseProvider>
        <div class="mz-root">
          <Show
            when={atRoot()}
            fallback={
              <div class="mz-legacy">
                <Suspense>{props.children}</Suspense>
              </div>
            }
          >
            <Frame />
          </Show>
          <ToastRegion />
        </div>
      </MuseProvider>
    </TitlebarRightProvider>
  )
}
