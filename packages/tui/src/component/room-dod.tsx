import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { RoomDod, RoomDodItem } from "@opencode/client/promise"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { useT } from "../util/i18n"
import { Row } from "./panel-row"

const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])
const MARK: Record<string, string> = { DONE: "✓", IN_PROGRESS: "●", BLOCKED: "!", FAILED: "✗", OUT_OF_SCOPE: "–" }
const BAR = 8

// The shared project's Definition of Done under a room in the Multiplayer panel: the
// room's work queue, with who took each open item. A guest takes a free item and gives
// back its own; the host frees an item a guest left behind. Finished items only count
// toward the bar, so a long DoD stays a short list. A project without a DoD shows nothing.
export function RoomDodRows(props: {
  id: string
  load: () => Promise<RoomDod>
  // The guest's own name in the room; absent on the host, which frees instead of taking.
  me?: string
  take?: (item: string) => Promise<RoomDod>
  release: (item: string) => Promise<RoomDod>
  hover: () => string | undefined
  setHover: (id: string | undefined) => void
}) {
  const theme = useTheme()
  const toast = useToast()
  const t = useT()
  const [items, setItems] = createSignal<readonly RoomDodItem[]>([])
  const [open, setOpen] = createSignal(false)
  const [armed, setArmed] = createSignal<string>()
  // A gone host or a broken file lists nothing; the room view and the file's own tools say why.
  const read = () =>
    void props
      .load()
      .then((dod) => setItems(dod.items))
      .catch(() => setItems([]))
  onMount(() => {
    read()
    const timer = setInterval(read, 5000)
    onCleanup(() => clearInterval(timer))
  })
  const act = (action: () => Promise<RoomDod>) =>
    void action()
      .then((dod) => setItems(dod.items))
      .catch((error: unknown) => toast.show({ message: errorMessage(error), variant: "error" }))

  const finished = () => items().filter((item) => FINISHED.has(item.state)).length
  const remaining = () => items().filter((item) => !FINISHED.has(item.state))
  const taken = () => items().filter((item) => item.owner && !FINISHED.has(item.state)).length
  const bar = () => {
    const filled = items().length === 0 ? 0 : Math.round((finished() / items().length) * BAR)
    return "█".repeat(filled) + "░".repeat(BAR - filled)
  }
  const color = (state: string) =>
    state === "DONE"
      ? theme.text.feedback.success.base
      : state === "IN_PROGRESS"
        ? theme.text.feedback.info.base
        : state === "BLOCKED"
          ? theme.text.feedback.warning.base
          : state === "FAILED"
            ? theme.text.feedback.error.base
            : theme.text.muted
  const actionId = (item: RoomDodItem) => `${props.id}:dod:${item.id}`

  return (
    <Show when={items().length > 0}>
      <Row id={`${props.id}:dod`} hover={props.hover} setHover={props.setHover} onClick={() => setOpen(!open())}>
        <text flexShrink={0} fg={theme.text.muted}>
          {open() ? "    ▾ " : "    ▸ "}
        </text>
        <box flexGrow={1} minWidth={0}>
          <text fg={theme.text.base} wrapMode="none" truncate>
            {t("DoD")}
            <span style={{ fg: theme.text.muted }}>
              {` ${finished()}/${items().length}`}
              {taken() > 0 ? ` · ${t("{count} taken", { count: taken() })}` : ""}
            </span>
            {/* Last, so a narrow panel cuts the bar before the numbers. */}
            <span style={{ fg: theme.text.feedback.success.base }}>{` ${bar()}`}</span>
          </text>
        </box>
      </Row>
      <Show when={open()}>
        <For each={remaining()}>
          {(item) => {
            const mine = () => props.me !== undefined && item.owner === props.me
            return (
              <box flexDirection="row" paddingLeft={7} paddingRight={1}>
                <text flexShrink={0} fg={color(item.state)}>
                  {`${MARK[item.state] ?? "·"} `}
                </text>
                <box flexGrow={1} minWidth={0}>
                  <text fg={theme.text.base} wrapMode="none" truncate>
                    <span style={{ fg: theme.text.muted }}>{`${item.id} `}</span>
                    {item.what || item.id}
                    <span style={{ fg: theme.text.muted }}>{item.total > 0 ? ` ${item.done}/${item.total}` : ""}</span>
                  </text>
                </box>
                <Show
                  when={item.owner}
                  fallback={
                    <Show when={props.take}>
                      {(take) => (
                        <box flexShrink={0} onMouseUp={() => act(() => take()(item.id))}>
                          <text fg={theme.text.action.primary.base}>{` ${t("take")}`}</text>
                        </box>
                      )}
                    </Show>
                  }
                >
                  <text flexShrink={0} fg={mine() ? theme.text.formfield.base : theme.text.muted}>
                    {` ${mine() ? t("you") : item.owner}`}
                  </text>
                  <Show when={mine() || props.me === undefined}>
                    <box
                      flexShrink={0}
                      onMouseOut={() => setArmed()}
                      onMouseUp={() => {
                        // Freeing another person's item needs a second click; giving back your own does not.
                        if (!mine() && armed() !== actionId(item)) return setArmed(actionId(item))
                        setArmed()
                        act(() => props.release(item.id))
                      }}
                    >
                      <text
                        fg={
                          armed() === actionId(item)
                            ? theme.text.action.destructive.focused
                            : theme.text.action.destructive.base
                        }
                      >
                        {armed() === actionId(item) ? ` ${t("free?")}` : mine() ? ` ${t("release")}` : " ×"}
                      </text>
                    </box>
                  </Show>
                </Show>
              </box>
            )
          }}
        </For>
        <Show when={remaining().length === 0}>
          <box paddingLeft={7} paddingRight={1}>
            <text fg={theme.text.feedback.success.base}>{t("Everything is done.")}</text>
          </box>
        </Show>
      </Show>
    </Show>
  )
}
