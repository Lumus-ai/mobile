import path from "node:path"
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { Orchestra } from "@opencode/schema/orchestra"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useProjects } from "../context/projects"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useT } from "../util/i18n"
import {
  DodTaskList,
  parseDodBoard,
  resolveDodRoot,
  summarizeDodBoard,
  type DodTask,
} from "../feature-plugins/sidebar/dod"

type BoardState =
  { type: "loading" } | { type: "missing" } | { type: "ready"; items: DodTask[] } | { type: "error"; reason: string }

export function HomeProjectPanel(props: {
  width: number
  collapsed?: boolean
  onHide?: () => void
  onShow?: () => void
}) {
  const theme = useTheme()
  const t = useT()
  const route = useRoute()
  const data = useData()
  const location = useLocation()
  const projects = useProjects()
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [boardRoot, setBoardRoot] = createSignal<string>()
  const [closeHovered, setCloseHovered] = createSignal(false)
  let revision = 0

  const currentDirectory = () =>
    location.current?.directory ?? location.ref?.directory ?? data.location.default().directory

  const project = createMemo(() => {
    const all = projects.list()
    const currentRoute = route.data
    if (currentRoute.type === "home" && currentRoute.project) {
      const selected = all.find((item) => item.id === currentRoute.project)
      if (selected) return selected
    }
    const owner = Orchestra.ownerOf(all, currentDirectory())
    return owner ?? (all.length === 1 ? all[0] : undefined)
  })

  const directory = () => project()?.directory ?? currentDirectory()
  const refresh = async (value: string | undefined) => {
    const current = ++revision
    if (!value) {
      setBoardRoot(undefined)
      setBoard({ type: "missing" })
      return
    }
    try {
      const root = await resolveDodRoot(value)
      if (current !== revision) return
      setBoardRoot(root)
      const file = Bun.file(path.join(root, ".opencode", "dod.yaml"))
      if (!(await file.exists())) {
        if (current === revision) setBoard({ type: "missing" })
        return
      }
      const items = parseDodBoard(await file.text())
      if (current === revision) setBoard({ type: "ready", items })
    } catch (cause) {
      if (current !== revision) return
      setBoard({ type: "error", reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  createEffect(() => void refresh(directory()))
  onMount(() => {
    const timer = setInterval(() => void refresh(directory()), 5_000)
    onCleanup(() => {
      revision++
      clearInterval(timer)
    })
  })

  const items = () => {
    const value = board()
    return value.type === "ready" ? value.items : []
  }
  const summary = () => summarizeDodBoard(items())
  const barWidth = () => Math.max(8, Math.min(28, props.width - 10))
  const filled = () => Math.round((summary().percent / 100) * barWidth())

  return (
    <Show
      when={!props.collapsed}
      fallback={
        <box
          width={props.width}
          height="100%"
          flexShrink={0}
          backgroundColor={theme.background.raised.base}
          border={["left"]}
          borderColor={theme.border.base}
          paddingTop={1}
        >
          <box
            id="home-project-panel-show"
            width={3}
            height={1}
            flexShrink={0}
            alignItems="center"
            justifyContent="center"
            backgroundColor={theme.background.raised.base}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => {
              event.stopPropagation()
              props.onShow?.()
            }}
          >
            <text fg={theme.text.action.primary.base}>‹</text>
          </box>
        </box>
      }
    >
      <box
        width={props.width}
        height="100%"
        position="relative"
        flexShrink={0}
        minWidth={0}
        minHeight={0}
        flexDirection="column"
        padding={1}
        gap={1}
        backgroundColor={theme.background.raised.base}
        border={["left"]}
        borderColor={theme.border.base}
      >
        <box flexDirection="column" flexShrink={0} gap={1} paddingRight={5}>
          <text fg={theme.text.base} wrapMode="none" truncate>
            <b>{t("Project DoD")}</b>
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {project()?.name ?? t("Current directory")}
          </text>
          <Show when={boardRoot()}>
            {(root) => (
              <text fg={theme.text.muted} wrapMode="none" truncate>
                {root()}
              </text>
            )}
          </Show>
        </box>

        <Show when={board().type === "loading"}>
          <text fg={theme.text.muted}>{t("Loading DoD…")}</text>
        </Show>
        <Show when={board().type === "missing"}>
          <text fg={theme.text.muted} wrapMode="word">
            {t("DoD file is missing")}
          </text>
        </Show>
        <Show when={board().type === "error"}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {(board() as Extract<BoardState, { type: "error" }>).reason}
          </text>
        </Show>

        <Show when={board().type === "ready"}>
          <box flexDirection="column" gap={1} flexShrink={0}>
            <box flexDirection="row" alignItems="center" gap={1} minWidth={0}>
              <text fg={theme.text.base} flexShrink={0}>
                {t("Progress")}
              </text>
              <box flexGrow={1} minWidth={0} />
              <text fg={theme.text.feedback.success.base} wrapMode="none" flexShrink={0}>
                {`${summary().finished}/${summary().total} · ${summary().percent}%`}
              </text>
            </box>
            <text wrapMode="none">
              <span style={{ fg: theme.text.feedback.success.base }}>{"█".repeat(filled())}</span>
              <span style={{ fg: theme.text.muted }}>{"░".repeat(Math.max(0, barWidth() - filled()))}</span>
            </text>
            <text fg={theme.text.feedback.info.base}>
              {t("In progress")}: {items().filter((item) => item.state === "IN_PROGRESS").length}
            </text>
            <text fg={theme.text.feedback.warning.base}>
              {t("Blocked")}: {items().filter((item) => item.state === "BLOCKED").length}
            </text>
            <text fg={theme.text.feedback.error.base}>
              {t("Failed")}: {items().filter((item) => item.state === "FAILED").length}
            </text>
          </box>
          <DodTaskList items={items()} />
        </Show>
        {/* Keep the collapse control above all panel content and outside normal flex layout. */}
        <Show when={props.onHide}>
          <box
            id="home-project-panel-hide"
            position="absolute"
            top={1}
            right={1}
            width={5}
            height={1}
            flexShrink={0}
            alignItems="center"
            justifyContent="center"
            backgroundColor={closeHovered() ? theme.increase(theme.background.base, 4) : theme.background.raised.base}
            onMouseOver={() => setCloseHovered(true)}
            onMouseOut={() => setCloseHovered(false)}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => {
              event.stopPropagation()
              props.onHide?.()
            }}
          >
            <text
              fg={
                closeHovered()
                  ? (theme.text.action?.primary?.hovered ?? theme.increase(theme.text.action.primary.base, 2))
                  : theme.text.action.primary.base
              }
              wrapMode="none"
            >
              ›
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}
