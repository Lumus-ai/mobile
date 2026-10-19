import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useMuse } from "./state"
import {
  IconBranch, IconChat, IconChevron, IconCode, IconFolder, IconInfo, IconNodes, IconPlus, IconServer, IconShield,
  IconTerminal, IconGrid, IconMoon, IconFlag, IconImage, IconCheck, IconTrash,
} from "./icons"
import { avatarSettings } from "./avatar-store"

export function Title(props: { children: JSX.Element }) {
  return <h1 class="mz-title">{props.children}</h1>
}

function when(ts: number) {
  const date = new Date(ts)
  const now = new Date()
  const same = date.toDateString() === now.toDateString()
  if (same) return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  const days = Math.floor((now.getTime() - ts) / 86400000)
  if (days <= 1) return "вчера"
  if (days < 7) return `${days} дн. назад`
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
}

const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path

function Row(props: { icon: JSX.Element; title: string; sub?: JSX.Element; onClick?: () => void; trailing?: JSX.Element }) {
  return (
    <button type="button" class="mz-row" onClick={props.onClick}>
      <span class="mz-row-icon">{props.icon}</span>
      <span class="mz-row-text">
        <span class="mz-row-title">{props.title}</span>
        <Show when={props.sub}>
          <span class="mz-row-sub">{props.sub}</span>
        </Show>
      </span>
      {props.trailing}
    </button>
  )
}

export function SessionsScreen() {
  const muse = useMuse()
  return (
    <div class="mz-page">
      <Title>Сессии</Title>
      <div class="mz-card">
        <h3>Текущий проект</h3>
        <p class="mz-muted">
          {baseName(muse.directory())} · {muse.connected() ? "сервер работает" : "сервер запускается"}
        </p>
        <div class="mz-card-buttons">
          <button type="button" class="mz-btn mz-btn-gray" onClick={() => muse.setTab("projects")}>
            Сменить
          </button>
          <button type="button" class="mz-btn mz-btn-blue" onClick={muse.newChat}>
            Новый чат
          </button>
        </div>
      </div>
      <Show
        when={muse.sessions().length > 0}
        fallback={<p class="mz-muted mz-pad">Сессий пока нет. Напиши первое сообщение в чате.</p>}
      >
        <div class="mz-list">
          <For each={muse.sessions()}>
            {(item) => (
              <Row
                icon={<IconChat />}
                title={item.title || "Новая сессия"}
                sub={
                  <>
                    {baseName(item.location.directory)} · {when(item.time.updated)}
                    <Show when={muse.sessionId() === item.id}> · <span class="mz-green">открыта</span></Show>
                  </>
                }
                onClick={() => muse.openSession(item.id)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

export function ProjectsScreen() {
  const muse = useMuse()
  const [dir, setDir] = createSignal("")
  const projects = createMemo(() => muse.ctx()?.projects.list() ?? [])
  const open = (directory: string) => {
    const c = muse.ctx()
    if (!c) return
    c.projects.open(directory)
    c.projects.touch(directory)
    muse.newChat()
  }
  return (
    <div class="mz-page">
      <Title>Проекты</Title>
      <div class="mz-list">
        <For each={projects()}>
          {(project) => (
            <Row
              icon={project.worktree === muse.directory() ? <IconCheck /> : <IconFolder />}
              title={baseName(project.worktree)}
              sub={
                <>
                  {project.worktree}
                  <Show when={project.worktree === muse.directory()}> · <span class="mz-green">активен</span></Show>
                </>
              }
              onClick={() => open(project.worktree)}
            />
          )}
        </For>
      </div>
      <div class="mz-card">
        <h3>Новый проект</h3>
        <p class="mz-muted">Путь к папке на телефоне. Для папки в памяти приложения оставь /projects/имя.</p>
        <input class="mz-input" value={dir()} placeholder={`${muse.directory().replace(/\/[^/]*$/, "")}/имя-проекта`} onInput={(e) => setDir(e.currentTarget.value)} />
        <div class="mz-card-buttons">
          <button type="button" class="mz-btn mz-btn-blue" disabled={!dir().trim().startsWith("/")} onClick={() => open(dir().trim())}>
            <IconPlus width={18} height={18} /> Открыть
          </button>
        </div>
      </div>
    </div>
  )
}

type Todo = { id: string; text: string; done: boolean }
const TODO_KEY = "muse.todos"
function loadTodos(): Todo[] {
  try {
    return JSON.parse(localStorage.getItem(TODO_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function TasksScreen() {
  const muse = useMuse()
  const [todos, setTodos] = createSignal<Todo[]>(loadTodos())
  const [text, setText] = createSignal("")
  const save = (next: Todo[]) => {
    setTodos(next)
    try {
      localStorage.setItem(TODO_KEY, JSON.stringify(next))
    } catch {}
  }
  const active = createMemo(() => muse.ctx()?.data.session.active() ?? [])
  const add = () => {
    const value = text().trim()
    if (!value) return
    save([{ id: crypto.randomUUID(), text: value, done: false }, ...todos()])
    setText("")
  }
  const sendToAgent = async (todo: Todo) => {
    muse.newChat()
    await muse.send(todo.text)
    save(todos().map((item) => (item.id === todo.id ? { ...item, done: true } : item)))
  }
  return (
    <div class="mz-page">
      <Title>Задачи</Title>
      <Show when={active().length > 0}>
        <div class="mz-card">
          <h3>Сейчас работает</h3>
          <For each={active()}>
            {(id) => (
              <button type="button" class="mz-inline-row" onClick={() => muse.openSession(id)}>
                <span class="mz-spinner" data-on="1" />
                <span>{muse.ctx()?.data.session.get(id)?.title || "Сессия"}</span>
                <IconChevron width={18} height={18} />
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="mz-card">
        <h3>Мои задачи</h3>
        <div class="mz-add">
          <input class="mz-input" placeholder="Новая задача" value={text()} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button type="button" class="mz-btn mz-btn-blue mz-btn-sm" onClick={add}>
            <IconPlus width={18} height={18} />
          </button>
        </div>
        <For each={todos()} fallback={<p class="mz-muted">Пусто. Запиши задачу и отправь её Фенриру одним нажатием.</p>}>
          {(todo) => (
            <div class="mz-todo" data-done={todo.done ? "1" : "0"}>
              <button type="button" class="mz-check" aria-label="Готово" onClick={() => save(todos().map((i) => (i.id === todo.id ? { ...i, done: !i.done } : i)))}>
                {todo.done ? <IconCheck width={20} height={20} /> : null}
              </button>
              <span>{todo.text}</span>
              <Show when={!todo.done}>
                <button type="button" class="mz-link" onClick={() => void sendToAgent(todo)}>Фенриру</button>
              </Show>
              <button type="button" class="mz-icon-btn" aria-label="Удалить" onClick={() => save(todos().filter((i) => i.id !== todo.id))}>
                <IconTrash width={18} height={18} />
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

export function RoomsScreen() {
  const muse = useMuse()
  const [code, setCode] = createSignal("")
  const [status, setStatus] = createSignal<string>()
  const [rooms, { refetch }] = createResource(
    () => (muse.connected() ? muse.ctx() : undefined),
    async (c) => (await c.sdk.api.room.list().catch(() => [])) as Array<{ id: string; name: string; sessionID: string; open?: boolean }>,
  )
  const [codes, setCodes] = createSignal<Record<string, string>>({})
  const showCode = async (id: string) => {
    try {
      const result = await muse.ctx()!.sdk.api.room.code({ roomID: id } as never)
      setCodes({ ...codes(), [id]: (result as { code: string }).code })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }
  const create = async () => {
    const id = muse.sessionId()
    if (!id) return setStatus("Сначала открой чат: комната создаётся из сессии.")
    try {
      await muse.ctx()!.sdk.api.room.create({ sessionID: id, name: muse.session()?.title || "Комната" } as never)
      setStatus("Комната создана")
      void refetch()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }
  const join = async () => {
    const value = code().trim().toUpperCase()
    if (value.length < 4) return
    try {
      const joined = (await muse.ctx()!.sdk.api.room.join({ code: value, name: "OpenCode++ телефон" } as never)) as { room: { name: string }; role: string }
      setStatus(`Вошёл в «${joined.room.name}» как ${joined.role}`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Не удалось войти. Проверь код и сеть.")
    }
  }
  const cells = () => Array.from({ length: 6 }, (_, i) => code()[i] ?? "")
  return (
    <div class="mz-page">
      <Title>LAN-комнаты</Title>
      <div class="mz-card">
        <h3>Подключиться по коду</h3>
        <p class="mz-muted">Код живёт 10 минут. Спроси его у хоста комнаты.</p>
        <label class="mz-cells">
          <For each={cells()}>{(char, i) => <span data-active={i() === code().length ? "1" : "0"}>{char}</span>}</For>
          <input
            class="mz-cells-input"
            maxLength={6}
            autocapitalize="characters"
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9А-Я]/g, ""))}
          />
        </label>
        <button type="button" class="mz-btn mz-btn-blue mz-btn-wide" onClick={() => void join()}>
          Войти в комнату
        </button>
        <Show when={status()}>
          <p class="mz-muted mz-status">{status()}</p>
        </Show>
      </div>
      <p class="mz-section">Мои комнаты</p>
      <div class="mz-list">
        <For each={rooms() ?? []}>
          {(room) => (
            <Row
              icon={<IconNodes />}
              title={room.name}
              sub={
                codes()[room.id] ? (
                  <>Код: <b class="mz-code-big">{codes()[room.id]}</b></>
                ) : (
                  <span class="mz-green">в сети</span>
                )
              }
              onClick={() => void showCode(room.id)}
            />
          )}
        </For>
        <Row icon={<IconPlus />} title="Создать свою комнату" sub="из текущей сессии, гости по коду" onClick={() => void create()} />
      </div>
    </div>
  )
}

export function SettingsScreen() {
  const muse = useMuse()
  const navigate = useNavigate()
  const full = (hash?: string) => navigate(`/settings${hash ?? ""}`)
  const chevron = () => <IconChevron class="mz-chev" width={18} height={18} />
  return (
    <div class="mz-page mz-page-settings">
      <div class="mz-card mz-card-stat">
        <div class="mz-stat-top">
          <h3>Модель</h3>
          <span class="mz-muted">{muse.modelName()}</span>
        </div>
        <p class="mz-muted">Бесплатные модели opencode работают после входа в аккаунт opencode.</p>
        <button type="button" class="mz-link" onClick={() => muse.setTab("chat")}>Выбрать в чате (плашка справа сверху)</button>
      </div>
      <div class="mz-group">
        <Row icon={<IconGrid />} title="Провайдеры" onClick={() => full()} trailing={chevron()} />
        <Row icon={<IconImage />} title="Аватар Фенрира" sub="свои картинки и GIF для состояний" onClick={() => muse.setTab("avatar")} trailing={chevron()} />
        <Row icon={<IconCode />} title="Терминал" sub="свой Linux для команд ИИ (Alpine или Debian)" onClick={() => muse.setTab("terminal")} trailing={chevron()} />
        <Row icon={<IconServer />} title="Встроенный сервер" sub={muse.connected() ? "работает · 127.0.0.1:4096" : "запускается"} onClick={() => full()} trailing={chevron()} />
        <Row icon={<IconNodes />} title="LAN-комнаты" onClick={() => muse.setTab("rooms")} trailing={chevron()} />
        <Row icon={<IconMoon />} title="Тема и общие" onClick={() => full()} trailing={chevron()} />
      </div>
      <p class="mz-section">Приложение</p>
      <div class="mz-group">
        <Row icon={<IconInfo />} title="О приложении" sub="MIT · на базе opencode" onClick={() => full()} trailing={chevron()} />
        <Row icon={<IconCode />} title="Исходный код" sub="github.com/Lumus-ai/mobile" onClick={() => window.open("https://github.com/Lumus-ai/mobile", "_blank")} trailing={chevron()} />
        <Row icon={<IconFlag />} title="Сообщить о проблеме" onClick={() => window.open("https://github.com/Lumus-ai/mobile/issues", "_blank")} trailing={chevron()} />
      </div>
    </div>
  )
}

export { IconBranch, avatarSettings }
