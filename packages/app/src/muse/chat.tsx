import { createEffect, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js"
import { useMuse } from "./state"
import { Markdown } from "./markdown"
import { IconMic, IconPlus, IconSend, IconStop } from "./icons"

type AnyMessage = ReturnType<ReturnType<typeof useMuse>["messages"]>[number]

function ToolCard(props: { part: Extract<AnyMessage, { type: "assistant" }>["content"][number] & { type: "tool" } }) {
  const state = () => props.part.state
  const input = () => {
    const value = (state() as { input?: unknown }).input
    if (typeof value === "string") return value
    const obj = (value ?? {}) as Record<string, unknown>
    return String(obj.command ?? obj.filePath ?? obj.path ?? obj.pattern ?? obj.url ?? "")
  }
  const status = () => state().status
  return (
    <div class="mz-tool" data-status={status()}>
      <div class="mz-tool-head">
        <span class="mz-spinner" data-on={status() === "running" || status() === "streaming" ? "1" : "0"} data-err={status() === "error" ? "1" : "0"} />
        <strong>{props.part.name}</strong>
        <span class="mz-tool-status">
          {status() === "completed" ? "готово" : status() === "error" ? "ошибка" : "выполняется"}
        </span>
      </div>
      <Show when={input()}>
        <div class="mz-tool-cmd">{input().slice(0, 240)}</div>
      </Show>
    </div>
  )
}

function AssistantMessage(props: { message: Extract<AnyMessage, { type: "assistant" }> }) {
  return (
    <For each={props.message.content}>
      {(part) => (
        <Switch>
          <Match when={part.type === "text" && part.text.trim()}>
            <div class="mz-bubble mz-bubble-ai">
              <Markdown text={(part as { text: string }).text} />
            </div>
          </Match>
          <Match when={part.type === "tool"}>
            <ToolCard part={part as never} />
          </Match>
          <Match when={part.type === "reasoning" && (part as { text: string }).text.trim()}>
            <details class="mz-reasoning">
              <summary>Размышления</summary>
              <div>{(part as { text: string }).text}</div>
            </details>
          </Match>
        </Switch>
      )}
    </For>
  )
}

export function ChatScreen() {
  const muse = useMuse()
  const [text, setText] = createSignal("")
  let scroller!: HTMLDivElement
  let input!: HTMLTextAreaElement

  const toBottom = (smooth = false) =>
    queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" }))
  onMount(() => toBottom())
  createEffect(on(() => [muse.messages().length, muse.pending().length, muse.activity().caption], () => toBottom(true)))
  createEffect(on(muse.sessionId, () => toBottom()))

  const grow = () => {
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`
  }
  const submit = async () => {
    const value = text()
    if (!value.trim()) {
      if (muse.running()) muse.interrupt()
      return
    }
    setText("")
    queueMicrotask(grow)
    const ok = await muse.send(value)
    if (!ok) setText(value)
  }

  return (
    <div class="mz-chat">
      <div class="mz-scroll" ref={scroller}>
        <Show
          when={muse.messages().length > 0 || muse.pending().length > 0}
          fallback={
            <div class="mz-empty">
              <h2>Чем займёмся?</h2>
              <p>Напиши задачу для проекта. Фенрир сам читает файлы, правит код и запускает команды, а важное спросит у тебя.</p>
            </div>
          }
        >
          <For each={muse.messages()}>
            {(message) => (
              <Switch>
                <Match when={message.type === "user"}>
                  <div class="mz-bubble mz-bubble-me">
                    <p>{(message as { text: string }).text}</p>
                  </div>
                </Match>
                <Match when={message.type === "assistant"}>
                  <AssistantMessage message={message as never} />
                </Match>
                <Match when={message.type === "shell"}>
                  <div class="mz-codeblock">
                    <div class="mz-codeblock-head">
                      <span>terminal</span>
                    </div>
                    <pre>{`$ ${(message as { command: string }).command}`}</pre>
                  </div>
                </Match>
              </Switch>
            )}
          </For>
          <For each={muse.pending()}>
            {(item) => (
              <div class="mz-bubble mz-bubble-me">
                <p>{(item as { payload?: { text?: string } }).payload?.text ?? ""}</p>
              </div>
            )}
          </For>
          <For each={muse.permissions()}>
            {(request) => (
              <div class="mz-perm">
                <h3>Нужно разрешение</h3>
                <p class="mz-perm-action">{request.action}</p>
                <Show when={request.resources.length > 0}>
                  <div class="mz-tool-cmd">{request.resources.join("\n").slice(0, 300)}</div>
                </Show>
                <div class="mz-perm-buttons">
                  <button type="button" class="mz-btn mz-btn-gray" onClick={() => muse.reply(request.id, "reject")}>
                    Нет
                  </button>
                  <button type="button" class="mz-btn mz-btn-gray" onClick={() => muse.reply(request.id, "always")}>
                    Всегда
                  </button>
                  <button type="button" class="mz-btn mz-btn-blue" onClick={() => muse.reply(request.id, "once")}>
                    Разрешить
                  </button>
                </div>
              </div>
            )}
          </For>
        </Show>
        <Show when={muse.error()}>
          <div class="mz-error" role="alert" onClick={() => muse.setError(undefined)}>
            {muse.error()}
          </div>
        </Show>
      </div>
      <form
        class="mz-composer"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <button type="button" class="mz-composer-icon" aria-label="Добавить" disabled>
          <IconPlus />
        </button>
        <textarea
          ref={input}
          rows={1}
          placeholder="Сообщение..."
          value={text()}
          enterkeyhint="send"
          onInput={(event) => {
            setText(event.currentTarget.value)
            grow()
          }}
        />
        <Show
          when={text().trim() || muse.sending() || muse.running()}
          fallback={
            <button type="button" class="mz-composer-round" aria-label="Голос" disabled>
              <IconMic />
            </button>
          }
        >
          <button type="submit" class="mz-composer-round mz-composer-send" aria-label="Отправить" disabled={muse.sending()}>
            {muse.running() && !text().trim() ? <IconStop /> : <IconSend />}
          </button>
        </Show>
      </form>
    </div>
  )
}
