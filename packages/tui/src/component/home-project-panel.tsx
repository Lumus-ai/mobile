import path from "node:path"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Orchestra } from "@opencode/schema/orchestra"
import { useData } from "../context/data"
import { useLocation } from "../context/location"
import { useProjects } from "../context/projects"
import { useRoute } from "../context/route"
import { useTheme } from "../context/theme"
import { useT } from "../util/i18n"
import { parseDodBoard, resolveDodRoot, summarizeDodBoard, type DodTask } from "../feature-plugins/sidebar/dod"

const MARK: Record<string, string> = {
  DONE: "✓",
  IN_PROGRESS: "●",
  BLOCKED: "!",
  FAILED: "✗",
  OUT_OF_SCOPE: "–",
  NOT_STARTED: "○",
}

type BoardState =
  | { type: "loading" }
  | { type: "missing" }
  | { type: "ready"; items: DodTask[] }
  | { type: "error"; reason: string }

export function HomeProjectPanel(props: { width: number }) {
  const theme = useTheme()
  const t = useT()
  const route = useRoute()
  const data = useData()
  const location = useLocation()
  const projects = useProjects()
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [boardRoot, setBoardRoot] = createSignal<string>()
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
  const color = (state: string) =>
    state === "DONE" || state === "OUT_OF_SCOPE"
      ? theme.text.feedback.success.base
      : state === "IN_PROGRESS"
        ? theme.text.feedback.info.base
        : state === "BLOCKED"
          ? theme.text.feedback.warning.base
          : state === "FAILED"
            ? theme.text.feedback.error.base
            : theme.text.muted
  const stateLabel = (state: string) => {
    const labels: Record<string, string> = {
      DONE: "Done",
      IN_PROGRESS: "In progress",
      BLOCKED: "Blocked",
      FAILED: "Failed",
      OUT_OF_SCOPE: "Out of scope",
      NOT_STARTED: "Not started",
    }
    return t(labels[state] ?? state)
  }

  return (
    <box
      width={props.width}
      height="100%"
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
      <box flexDirection="row" alignItems="center" flexShrink={0}>
        <box flexDirection="column" flexGrow={1} minWidth={0} gap={1}>
          <text fg={theme.text.base}>
            <b>{t("Project DoD")}</b>
          </text>
          <text fg={theme.text.muted} wrapMode="none" truncate>
            {project()?.name ?? (boardRoot() ? props.width : t("Current directory"))}
            {boardRoot() ? ` · ${boardRoot()}` : ""}
          </text>
        </box>
      </box>

      <Show when={board().type === "loading"}>
        <text fg={theme.text.muted}>{t("Loading DoD…")}</text>
      </Show>
      <Show when={board().type === "missing"}>
        <text fg={theme.text.muted} wrapMode="word">{t("DoD file is missing")}</text>
      </Show>
      <Show when={board().type === "error"}>
        <text fg={theme.text.feedback.error.base} wrapMode="word">
          {(board() as Extract<BoardState, { type: "error" }>).reason}
        </text>
      </Show>

      <Show when={board().type === "ready"}>
        <box flexDirection="column" gap={1} flexShrink={0}>
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={theme.text.base}>{t("Progress")}</text>
            <text fg={theme.text.feedback.success.base} wrapMode="none">
              {summary().finished}/{summary().total} · {summary().percent}%
            </text>
          </box>
          <text wrapMode="none">
            <span style={{ fg: theme.text.feedback.success.base }}>{"█".repeat(filled())}</span>
            <span style={{ fg: theme.text.muted }}>{"░".repeat(Math.max(0, barWidth() - filled()))}</span>
          </text>
          <text fg={theme.text.feedback.info.base}>{t("In progress")}: {items().filter((item) => item.state === "IN_PROGRESS").length}</text>
          <text fg={theme.text.feedback.warning.base}>{t("Blocked")}: {items().filter((item) => item.state === "BLOCKED").length}</text>
          <text fg={theme.text.feedback.error.base}>{t("Failed")}: {items().filter((item) => item.state === "FAILED").length}</text>
        </box>
        <box flexGrow={1} minHeight={0}>
          <scrollbox
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: true }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column" gap={1} paddingRight={1}>
              <Show when={items().length === 0}>
                <text fg={theme.text.muted}>{t("No tasks yet")}</text>
              </Show>
              <For each={items()}>
                {(item) => (
                  <box
                    flexDirection="column"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    border={["bottom"]}
                    borderColor={theme.border.base}
                  >
                    <box flexDirection="row" gap={1}>
                      <text flexShrink={0} fg={color(item.state)}>{MARK[item.state] ?? "·"}</text>
                      <box flexGrow={1} minWidth={0}>
                        <text fg={theme.text.base} wrapMode="word">
                          <span style={{ fg: theme.text.muted }}>{item.id + " "}</span>
                          {item.title}
                        </text>
                      </box>
                    </box>
                    <text fg={color(item.state)}>{stateLabel(item.state)}</text>
                    <Show when={item.total > 0}>
                      <text fg={theme.text.muted}>{item.done}/{item.total} steps</text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}
