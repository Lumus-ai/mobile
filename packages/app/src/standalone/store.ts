/**
 * Standalone mode: device-only storage for the in-app server shim.
 * Everything lives in localStorage; nothing leaves the device except direct
 * calls from the shim's chat executor to the user's chosen provider APIs.
 */

export type StandaloneProviderKey = {
  integrationID: string
  key: string
  answer?: Record<string, string>
  connected: number
}

export type StandaloneSession = {
  id: string
  projectID: string
  agent: string
  model: { id: string; providerID: string; variant?: string }
  title?: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number; updated: number }
  location: { directory: string }
}

export type StandaloneMessage = {
  id: string
  sessionID: string
  time: { created: number; streamed?: number; completed?: number }
  type: "user" | "assistant" | "model-switched" | "agent-switched"
  text?: string
  files?: unknown[]
  agents?: unknown[]
  skills?: unknown[]
  metadata?: Record<string, unknown>
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  content?: Array<{ type: "text"; text: string } | { type: "reasoning"; text: string }>
  finish?: string
  cost?: number
  tokens?: StandaloneSession["tokens"]
  error?: unknown
}

const read = <A>(key: string, fallback: A): A => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as A) : fallback
  } catch {
    return fallback
  }
}

const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value))

const KEYS_KEY = "opencode.standalone:provider-keys"
const SESSIONS_KEY = "opencode.standalone:sessions"
const MESSAGES_KEY = "opencode.standalone:messages"
const PROJECTS_KEY = "opencode.standalone:projects"

export const standaloneStore = {
  keys: {
    list: () => read<StandaloneProviderKey[]>(KEYS_KEY, []),
    set(integrationID: string, key: string, answer?: Record<string, string>) {
      const list = standaloneStore.keys.list().filter((item) => item.integrationID !== integrationID)
      list.push({ integrationID, key, answer, connected: Date.now() })
      write(KEYS_KEY, list)
    },
    remove(integrationID: string) {
      write(
        KEYS_KEY,
        standaloneStore.keys.list().filter((item) => item.integrationID !== integrationID),
      )
    },
    get: (integrationID: string) => standaloneStore.keys.list().find((item) => item.integrationID === integrationID),
  },
  sessions: {
    list: () => read<StandaloneSession[]>(SESSIONS_KEY, []),
    put(session: StandaloneSession) {
      const list = standaloneStore.sessions.list().filter((item) => item.id !== session.id)
      list.push(session)
      write(SESSIONS_KEY, list)
    },
    get: (id: string) => standaloneStore.sessions.list().find((item) => item.id === id),
    remove(id: string) {
      write(
        SESSIONS_KEY,
        standaloneStore.sessions.list().filter((item) => item.id !== id),
      )
      const messages = read<Record<string, StandaloneMessage[]>>(MESSAGES_KEY, {})
      delete messages[id]
      write(MESSAGES_KEY, messages)
    },
  },
  messages: {
    list: (sessionID: string) => read<Record<string, StandaloneMessage[]>>(MESSAGES_KEY, {})[sessionID] ?? [],
    get: (id: string) => {
      const all = read<Record<string, StandaloneMessage[]>>(MESSAGES_KEY, {})
      for (const list of Object.values(all)) {
        const found = list.find((item) => item.id === id)
        if (found) return found
      }
      return undefined
    },
    put(message: StandaloneMessage) {
      const all = read<Record<string, StandaloneMessage[]>>(MESSAGES_KEY, {})
      const list = (all[message.sessionID] ?? []).filter((item) => item.id !== message.id)
      list.push(message)
      list.sort((a, b) => a.time.created - b.time.created)
      all[message.sessionID] = list
      write(MESSAGES_KEY, all)
    },
  },
  projects: {
    list: () =>
      read<Array<{ id: string; canonical: string; vcs: null; time: { created: number; updated: number; active: number }; sandboxes: [] }>>(
        PROJECTS_KEY,
        [],
      ),
    add(directory: string) {
      const list = standaloneStore.projects.list()
      if (list.some((item) => item.canonical === directory)) return list[0]
      const now = Date.now()
      const project = {
        id: "local-" + now.toString(36),
        canonical: directory,
        vcs: null,
        time: { created: now, updated: now, active: now },
        sandboxes: [] as [],
      }
      write(PROJECTS_KEY, [...list, project])
      return project
    },
  },
}

let counter = 0
export const standaloneID = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 10)}`
