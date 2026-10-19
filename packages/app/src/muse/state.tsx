import { createContext, createEffect, createMemo, createSignal, on, onCleanup, untrack, useContext, type ParentProps } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import { useServerCtx } from "@/runtime/server/runtime"
import { useServers } from "@/runtime/server/registry"
import { embeddedProjectsDir } from "@/embedded"
import { avatarSettings, type AvatarState } from "./avatar-store"

export type MuseTab = "chat" | "sessions" | "projects" | "tasks" | "rooms" | "settings" | "avatar" | "terminal"

const TAB_KEY = "muse.tab"
const SESSION_KEY = "muse.session"
const MODEL_KEY = "muse.model"

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
const write = (key: string, value: string | undefined) => {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {}
}

export type ModelChoice = { providerID: string; modelID: string; name: string }

const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit", "apply_patch"])
const READ_TOOLS = new Set(["read", "grep", "glob", "list", "ls", "find"])

function toolCaption(name: string, input: Record<string, unknown> | string | undefined) {
  const obj = typeof input === "object" && input ? input : {}
  const file = String(obj.filePath ?? obj.path ?? obj.file ?? "").split("/").pop()
  if (EDIT_TOOLS.has(name)) return `Пишет код${file ? ` · ${file}` : ""}`
  if (name === "bash" || name === "shell") return "Запускает команду"
  if (READ_TOOLS.has(name)) return `Читает проект${file ? ` · ${file}` : ""}`
  if (name.startsWith("web")) return "Ищет в сети"
  if (name === "task") return "Передаёт задачу помощнику"
  return `Работает · ${name}`
}

function createMuse() {
  const servers = useServers()
  const conn = createMemo(() => servers.visible[0])
  const ctx = useServerCtx(conn)

  const [tab, setTabSignal] = createSignal<MuseTab>((read(TAB_KEY) as MuseTab | undefined) ?? "chat")
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [sessionId, setSessionSignal] = createSignal<string | undefined>(read(SESSION_KEY))
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [justDone, setJustDone] = createSignal(false)
  const [choice, setChoiceSignal] = createSignal<ModelChoice | undefined>(
    (() => {
      try {
        return JSON.parse(read(MODEL_KEY) ?? "null") ?? undefined
      } catch {
        return undefined
      }
    })(),
  )

  const setTab = (next: MuseTab) => {
    setTabSignal(next)
    if (next !== "settings" && next !== "avatar" && next !== "terminal") write(TAB_KEY, next)
    setMenuOpen(false)
  }
  const setSession = (id: string | undefined) => {
    setSessionSignal(id)
    write(SESSION_KEY, id)
  }
  const setChoice = (value: ModelChoice) => {
    setChoiceSignal(value)
    write(MODEL_KEY, JSON.stringify(value))
  }

  const connected = () => ctx()?.sdk.connection.status() === "connected"
  const data = () => ctx()?.data

  const defaultDir = () => {
    const embedded = embeddedProjectsDir()
    return embedded ? `${embedded}/default` : "/projects/default"
  }
  const directory = createMemo(() => {
    const c = ctx()
    if (!c) return defaultDir()
    const last = c.projects.last()
    const list = c.projects.list()
    return list.find((p) => p.worktree === last)?.worktree ?? list[0]?.worktree ?? defaultDir()
  })

  // Make sure the default project exists on the first launch, so the first message has a place to go.
  createEffect(() => {
    const c = ctx()
    if (!c || !servers.hydrated()) return
    if (c.projects.list().length > 0 || c.projects.recentlyClosed().length > 0) return
    c.projects.open(defaultDir())
    c.projects.touch(defaultDir())
  })

  // Sessions known to the server, newest first.
  const [loadedSessions, setLoadedSessions] = createSignal<SessionInfo[]>([])
  async function refreshSessions() {
    const c = ctx()
    if (!c || !connected()) return
    try {
      const response = await c.sdk.api.session.list({ order: "desc" } as never)
      const items = ((response as { data?: SessionInfo[] }).data ?? []) as SessionInfo[]
      items.forEach((item) => c.data.session.remember(item))
      setLoadedSessions(items)
    } catch {
      // The local store still lists what is known.
    }
  }
  createEffect(on([connected, tab], () => void refreshSessions()))
  const sessions = createMemo(() => {
    const list = data()?.session.list() ?? []
    return list.filter((item) => !item.parentID)
  })

  const session = createMemo(() => {
    const id = sessionId()
    return id ? data()?.session.get(id) : undefined
  })

  // Load the open conversation.
  createEffect(() => {
    const id = sessionId()
    const c = ctx()
    if (!id || !c || !connected()) return
    untrack(() => {
      void c.data.session.sync(id).catch(() => undefined)
      void c.data.session.message.sync(id).catch(() => undefined)
      void c.data.session.permission.sync(id).catch(() => undefined)
      void c.data.session.pending.sync(id).catch(() => undefined)
    })
  })

  const messages = createMemo(() => {
    const id = sessionId()
    return id ? (data()?.session.message.list(id) ?? []) : []
  })
  const pending = createMemo(() => {
    const id = sessionId()
    if (!id) return []
    const d = data()
    const known = new Set(messages().map((m) => m.id))
    return (d?.session.pending.list(id) ?? []).filter(
      (item) => item.type === "user" && !known.has(item.id),
    )
  })
  const permissions = createMemo(() => {
    const id = sessionId()
    return id ? (data()?.session.permission.list(id) ?? []) : []
  })
  const running = createMemo(() => {
    const id = sessionId()
    return !!id && data()?.session.status(id) === "running"
  })

  // Show "done" for a few seconds after a run ends.
  let doneTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(
    on(running, (now, before) => {
      if (before && !now) {
        setJustDone(true)
        clearTimeout(doneTimer)
        doneTimer = setTimeout(() => setJustDone(false), avatarSettings().doneSeconds * 1000)
      }
      if (now) {
        clearTimeout(doneTimer)
        setJustDone(false)
      }
    }),
  )
  onCleanup(() => clearTimeout(doneTimer))

  /** What the agent is doing now: avatar state plus a short caption. */
  const activity = createMemo<{ state: AvatarState; caption?: string }>(() => {
    if (permissions().length > 0) return { state: "waiting", caption: "Ждёт разрешения" }
    if (sending() && !running()) return { state: "start", caption: "Начинает работу" }
    if (running()) {
      const list = messages()
      const last = list[list.length - 1]
      if (!last || last.type !== "assistant") return { state: "start", caption: "Начинает работу" }
      const part = last.content[last.content.length - 1]
      if (!part) return { state: "start", caption: "Начинает работу" }
      if (part.type === "reasoning") return { state: "thinking", caption: "Думает" }
      if (part.type === "tool") {
        const input = (part.state as { input?: Record<string, unknown> | string }).input
        const caption = toolCaption(part.name, input)
        return { state: "coding", caption }
      }
      return { state: "thinking", caption: "Пишет ответ" }
    }
    if (justDone()) return { state: "done", caption: "Готово" }
    return { state: "idle" }
  })

  // Model choice: remembered, else the server default, else the first model.
  const [models, setModels] = createSignal<ModelChoice[]>([])
  async function loadModels() {
    const c = ctx()
    if (!c || !connected()) return
    try {
      const location = { directory: directory() }
      const list = (await c.sdk.api.model.list({ location } as never)) as { data?: Array<{ providerID: string; modelID: string; name: string }> }
      const items = (list.data ?? []).map((m) => ({ providerID: m.providerID, modelID: m.modelID, name: m.name }))
      setModels(items)
      if (!choice()) {
        const fallback = (await c.sdk.api.model.default({ location } as never).catch(() => undefined)) as
          | { data?: { providerID: string; modelID: string; name: string } | null }
          | undefined
        const pick = fallback?.data ?? items.find((m) => m.providerID === "opencode") ?? items[0]
        if (pick) setChoiceSignal({ providerID: pick.providerID, modelID: pick.modelID, name: pick.name })
      }
    } catch {
      // Providers may not be ready yet; the picker retries when opened.
    }
  }
  createEffect(on(connected, (ok) => ok && void loadModels()))

  const modelName = () => {
    const c = choice()
    if (!c) return "Модель"
    return c.name.replace(/\s*\(free\)\s*$/i, "").replace(/\s*free$/i, "") || c.modelID
  }

  async function send(text: string) {
    const c = ctx()
    const value = text.trim()
    if (!c || !value || sending()) return false
    setError(undefined)
    setSending(true)
    try {
      const pick = choice()
      if (!pick) {
        await loadModels()
      }
      const model = choice()
      if (!model) throw new Error("Не выбрана модель. Подключи провайдера в настройках.")
      let id = sessionId()
      let gate: Promise<unknown> | undefined
      if (!id) {
        const created = c.data.session.create({
          agent: "build",
          model: { id: model.modelID, providerID: model.providerID },
          location: { directory: directory() },
        })
        id = created.id
        gate = created.request
        setSession(id)
      }
      await c.data.session.prompt({
        sessionID: id,
        text: value,
        gate,
        metadata: { displayText: value, agent: "build", model: { modelID: model.modelID, providerID: model.providerID } },
      } as never)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setSending(false)
    }
  }

  const interrupt = () => {
    const id = sessionId()
    const c = ctx()
    if (id && c) void c.sdk.api.session.interrupt({ sessionID: id } as never).catch(() => undefined)
  }

  const newChat = () => {
    setSession(undefined)
    setTab("chat")
  }
  const openSession = (id: string) => {
    setSession(id)
    setTab("chat")
  }
  const reply = (requestID: string, decision: "once" | "always" | "reject") => {
    const id = sessionId()
    const c = ctx()
    if (!id || !c) return
    void c.data.session.permission.reply({ sessionID: id, requestID, decision } as never)
  }

  return {
    ctx,
    conn,
    connected,
    tab,
    setTab,
    menuOpen,
    setMenuOpen,
    sessionId,
    session,
    sessions,
    refreshSessions,
    messages,
    pending,
    permissions,
    running,
    activity,
    models,
    loadModels,
    choice,
    setChoice,
    modelName,
    directory,
    send,
    sending,
    error,
    setError,
    newChat,
    interrupt,
    openSession,
    reply,
    loadedSessions,
  }
}

export type Muse = ReturnType<typeof createMuse>
const MuseContext = createContext<Muse>()

export function MuseProvider(props: ParentProps) {
  const muse = createMuse()
  return <MuseContext.Provider value={muse}>{props.children}</MuseContext.Provider>
}

export function useMuse() {
  const value = useContext(MuseContext)
  if (!value) throw new Error("useMuse outside MuseProvider")
  return value
}
