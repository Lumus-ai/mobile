import path from "node:path"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { useCompactLayout } from "../../ui/compact-layout"
import { useT } from "../../util/i18n"

const FILE = path.join(".opencode", "dod.yaml")
const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])
const MARK: Record<string, string> = {
  DONE: "✓",
  IN_PROGRESS: "●",
  BLOCKED: "!",
  FAILED: "✗",
  OUT_OF_SCOPE: "–",
  NOT_STARTED: "○",
}

export type DodTask = {
  id: string
  title: string
  state: string
  done: number
  total: number
}

type BoardState =
  | { type: "loading" }
  | { type: "missing" }
  | { type: "ready"; items: DodTask[] }
  | { type: "error"; reason: string }

// Keep the sidebar's progress definition aligned with the project's DoD service:
// only explicitly finished or out-of-scope leaf tasks count as complete.
export function parseDodBoard(source: string): DodTask[] {
  const parsed: unknown = Bun.YAML.parse(source)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DoD must be a YAML mapping")
  }

  const leaves = (parsed as Record<string, unknown>).leaves
  if (leaves === undefined) return []
  if (!Array.isArray(leaves)) throw new Error("DoD leaves must be a list")

  return leaves.flatMap((raw): DodTask[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
    const leaf = raw as Record<string, unknown>
    if (typeof leaf.id !== "string" || !leaf.id.trim()) return []
    const steps = Array.isArray(leaf.steps) ? leaf.steps.filter((step): step is string => typeof step === "string") : []
    return [{
      id: leaf.id.trim(),
      title: typeof leaf.what === "string" && leaf.what.trim() ? leaf.what.trim() : leaf.id.trim(),
      state: typeof leaf.task_state === "string" && leaf.task_state.trim() ? leaf.task_state.trim() : "NOT_STARTED",
      done: steps.filter((step) => /^\\s*\\[(x|X)\\]/.test(step)).length,
      total: steps.length,
    }]
  })
}

export function summarizeDodBoard(items: readonly DodTask[]) {
  const finished = items.filter((item) => FINISHED.has(item.state)).length
  return {
    finished,
    total: items.length,
    percent: items.length === 0 ? 0 : Math.round((finished / items.length) * 100),
  }
}

// Project DoD in the session's right sidebar. It reads the same .opencode/dod.yaml
// that the orchestrator and room board use; this is a view, not a second task store.
export function SidebarDod(props: { context: Plugin.Context; sessionID: string }) {
  const theme = props.context.theme
  const t = useT()
  const layout = useCompactLayout()
  const [board, setBoard] = createSignal<BoardState>({ type: "loading" })
  const [open, setOpen] = createSignal(false)
  let revision = 0

  const directory = () =>
    props.context.data.session.get(props.sessionID)?.location?.directory ?? props.context.location?.directory

  const refresh = async (root: string | undefined) => {
    const current = ++revision
    if (!root) {
      setBoard({ type: "missing" })
      return
    }
    try {
      const file = Bun.file(path.join(root, FILE))
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
  const width = () => Math.max(6, Math.min(22, layout.sidebarWidth() - (layout.compact() ? 5 : 7)))
  const filled = () => Math.round((summary().percent / 100) * width())
  const heading = () => {
    const value = board()
    if (value.type === "loading") return t("Loading DoD…")
    if (value.type === "missing") return t("DoD file is missing")
    if (value.type === "error") return t("DoD read error: {reason}", { reason: value.reason })
    return `${summary().finished}/${summary().total} · ${summary().percent}%`
  }
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

  return (
    <box gap={1}>
      <box
        id="sidebar.dod.toggle"
        flexDirection="row"
        alignItems="center"
        gap={1}
        onMouseUp={() => setOpen((value) => !value)}
      >
        <text fg={theme.text.action.primary.base}>{open() ? "▾" : "▸"}</text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} wrapMode="none" truncate>
            <b>{t("DoD")}</b>
          </text>
        </box>
        <text fg={theme.text.muted} wrapMode="none" truncate>
          {heading()}
        </text>
      </box>

      <Show when={board().type === "ready"}>
        <text id="sidebar.dod.progress" wrapMode="none">
          <span style={{ fg: theme.text.feedback.success.base }}>{"█".repeat(filled())}</span>
          <span style={{ fg: theme.text.muted }}>{"░".repeat(Math.max(0, width() - filled()))}</span>
        </text>
      </Show>

      <Show when={open()}>
        <Show when={board().type === "loading"}>
          <text fg={theme.text.muted}>{t("Loading DoD…")}</text>
        </Show>
        <Show when={board().type === "missing"}>
          <text fg={theme.text.muted}>{t("DoD file is missing")}</text>
        </Show>
        <Show when={board().type === "error"}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {t("DoD read error: {reason}", { reason: board().type === "error" ? board().reason : "" })}
          </text>
        </Show>
        <Show when={board().type === "ready"}>
          <Show when={items().length === 0}>
            <text fg={theme.text.muted}>{t("No tasks yet")}</text>
          </Show>
          <For each={items()}>
            {(item) => (
              <box flexDirection="row" alignItems="center" gap={1}>
                <text fg={color(item.state)}>{MARK[item.state] ?? "·"}</text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} wrapMode="none" truncate>
                    <span style={{ fg: theme.text.muted }}>{item.id} </span>
                    {item.title}
                  </text>
                </box>
                <Show when={item.total > 0}>
                  <text fg={theme.text.muted} wrapMode="none">
                    {item.done}/{item.total}
                  </text>
                </Show>
              </box>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}
