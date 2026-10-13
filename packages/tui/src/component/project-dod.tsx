import { TextAttributes } from "@opentui/core"
import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import path from "node:path"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useT } from "../util/i18n"

type DodTask = {
  id: string
  what: string
  stage: string
  state: string
  done: number
  total: number
  owner?: string
  waits?: string[]
  verify?: string
}

type Board =
  | { type: "loading"; tasks: DodTask[] }
  | { type: "ready"; tasks: DodTask[] }
  | { type: "missing"; tasks: DodTask[] }
  | { type: "error"; tasks: DodTask[]; reason: string }

const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])
const MARK: Record<string, string> = {
  DONE: "✓",
  IN_PROGRESS: "●",
  BLOCKED: "!",
  FAILED: "✗",
  OUT_OF_SCOPE: "–",
  NOT_STARTED: "○",
}
const BAR = 10
const STEP = /^\s*\[(x|X)\]/

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseTasks(source: string): DodTask[] {
  const parsed: unknown = Bun.YAML.parse(source)
  if (!record(parsed) || !Array.isArray(parsed.leaves)) return []
  return parsed.leaves.flatMap((raw): DodTask[] => {
    if (!record(raw) || typeof raw.id !== "string") return []
    const steps = Array.isArray(raw.steps) ? raw.steps.filter((step): step is string => typeof step === "string") : []
    const waits = Array.isArray(raw.depends_on)
      ? raw.depends_on.filter((item): item is string => typeof item === "string")
      : []
    const verification = record(raw.verification) && typeof raw.verification.command === "string"
      ? raw.verification.command.trim()
      : undefined
    const state = typeof raw.task_state === "string" && raw.task_state.trim() ? raw.task_state.trim() : "NOT_STARTED"
    return [{
      id: raw.id,
      what: typeof raw.what === "string" ? raw.what.trim() : "",
      stage: typeof raw.group === "string" && raw.group.trim() ? raw.group.trim() : "Ungrouped",
      state,
      done: steps.filter((step) => STEP.test(step)).length,
      total: steps.length,
      ...(typeof raw.owner === "string" && raw.owner.trim() ? { owner: raw.owner.trim() } : {}),
      ...(waits.length ? { waits } : {}),
      ...(verification ? { verify: verification } : {}),
    }]
  })
}

async function readBoard(directory: string): Promise<Board> {
  const file = Bun.file(path.join(directory, ".opencode", "dod.yaml"))
  if (!(await file.exists())) return { type: "missing", tasks: [] }
  try {
    return { type: "ready", tasks: parseTasks(await file.text()) }
  } catch (error) {
    return {
      type: "error",
      tasks: [],
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function finished(tasks: DodTask[]) {
  return tasks.filter((item) => FINISHED.has(item.state)).length
}

function progress(tasks: DodTask[]) {
  return tasks.length === 0 ? 0 : Math.round((finished(tasks) / tasks.length) * 100)
}

function bar(tasks: DodTask[]) {
  const filled = Math.round((progress(tasks) / 100) * BAR)
  return "█".repeat(filled) + "░".repeat(BAR - filled)
}

function taskColor(state: string, theme: ReturnType<typeof useTheme>) {
  if (state === "DONE") return theme.text.feedback.success.base
  if (state === "IN_PROGRESS") return theme.text.feedback.info.base
  if (state === "BLOCKED") return theme.text.feedback.warning.base
  if (state === "FAILED") return theme.text.feedback.error.base
  return theme.text.muted
}

// The right-sidebar entry and the full board read the same project .opencode/dod.yaml.
// The file remains the source of truth; the UI never infers completion from a chat message.
export function ProjectDodEntry(props: { directory: string }) {
  const theme = useTheme()
  const dialog = useDialog()
  const t = useT()
  const [board, setBoard] = createSignal<Board>({ type: "loading", tasks: [] })
  let generation = 0
  const load = async () => {
    const id = ++generation
    const result = await readBoard(props.directory)
    if (id === generation) setBoard(result)
  }
  onMount(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    onCleanup(() => {
      generation++
      clearInterval(timer)
    })
  })
  const tasks = () => board().tasks
  const open = () => {
    dialog.replace(() => <ProjectDodDialog directory={props.directory} />, undefined, { size: "large" })
    dialog.setCentered(true)
  }

  return (
    <box
      flexDirection="row"
      alignItems="center"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background.panel}
      onMouseUp={(event) => {
        event.stopPropagation()
        open()
      }}
    >
      <text fg={theme.text.action.primary.base}>▸ DoD</text>
      <Show
        when={board().type === "ready"}
        fallback={
          <text fg={board().type === "error" ? theme.text.feedback.error.base : theme.text.muted}>
            {board().type === "loading"
              ? t("Loading…")
              : board().type === "missing"
                ? t("Open task board")
                : t("DoD error")}
          </text>
        }
      >
        <text fg={theme.text.muted}>{`${finished(tasks())}/${tasks().length} · ${progress(tasks())}%`}</text>
        <text fg={theme.text.feedback.success.base}>{bar(tasks())}</text>
      </Show>
    </box>
  )
}

export function ProjectDodDialog(props: { directory: string }) {
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  const t = useT()
  const [board, setBoard] = createSignal<Board>({ type: "loading", tasks: [] })
  let generation = 0
  const load = async () => {
    const id = ++generation
    const result = await readBoard(props.directory)
    if (id === generation) setBoard(result)
  }
  onMount(() => {
    void load()
    const timer = setInterval(() => void load(), 5000)
    onCleanup(() => {
      generation++
      clearInterval(timer)
    })
  })
  const tasks = () => board().tasks
  const groups = () => [...new Set(tasks().map((item) => item.stage))]
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} minHeight={8}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={theme.text.base} attributes={TextAttributes.BOLD}>Definition of Done</text>
        <text fg={theme.text.muted} onMouseUp={() => dialog.clear()}>Esc · {t("close")}</text>
      </box>
      <text fg={theme.text.muted} wrapMode="word">{props.directory}</text>
      <Show when={board().type === "ready"}>
        <box gap={1}>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme.text.base}>{t("Task progress")}</text>
            <text fg={theme.text.base}>{finished(tasks())}/{tasks().length} · {progress(tasks())}%</text>
          </box>
          <text fg={theme.text.feedback.success.base}>{bar(tasks())}</text>
        </box>
      </Show>
      <Show when={board().type === "loading"}>
        <text fg={theme.text.muted}>{t("Loading project DoD…")}</text>
      </Show>
      <Show when={board().type === "missing"}>
        <text fg={theme.text.feedback.warning.base}>{t("No DoD file found at .opencode/dod.yaml")}</text>
        <text fg={theme.text.muted}>{t("This project has no task board yet.")}</text>
      </Show>
      <Show when={board().type === "error"}>
        <text fg={theme.text.feedback.error.base}>{t("Could not read DoD: {reason}", { reason: board().type === "error" ? board().reason : "" })}</text>
      </Show>
      <Show when={board().type === "ready" && tasks().length === 0}>
        <text fg={theme.text.muted}>{t("The DoD file exists but contains no tasks.")}</text>
      </Show>
      <Show when={board().type === "ready" && tasks().length > 0}>
        <scrollbox flexGrow={1} minHeight={4} maxHeight={35} gap={1}>
          <For each={groups()}>
            {(group) => (
              <box gap={1}>
                <text fg={theme.text.secondary} attributes={TextAttributes.BOLD}>{group}</text>
                <For each={tasks().filter((item) => item.stage === group)}>
                  {(item) => (
                    <box flexDirection="row" gap={1} paddingLeft={1}>
                      <text fg={taskColor(item.state, theme)}>{MARK[item.state] ?? "·"}</text>
                      <box flexGrow={1} minWidth={0} gap={0}>
                        <text fg={theme.text.base} wrapMode="word">
                          <span style={{ fg: theme.text.muted }}>{item.id} </span>{item.what || item.id}
                        </text>
                        <box flexDirection="row" gap={1} flexWrap="wrap">
                          <text fg={taskColor(item.state, theme)}>{item.state}</text>
                          <Show when={item.total > 0}>
                            <text fg={theme.text.muted}>{`${item.done}/${item.total} steps`}</text>
                          </Show>
                          <Show when={item.owner}>
                            <text fg={theme.text.muted}>{t("Owner: {name}", { name: item.owner ?? "" })}</text>
                          </Show>
                          <Show when={item.waits && item.waits.length > 0}>
                            <text fg={theme.text.feedback.warning.base}>{t("Waiting for: {items}", { items: item.waits?.join(", ") ?? "" })}</text>
                          </Show>
                        </box>
                        <Show when={item.verify}>
                          <text fg={theme.text.muted} wrapMode="word">{t("Verify: {command}", { command: item.verify ?? "" })}</text>
                        </Show>
                      </box>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  )
}
