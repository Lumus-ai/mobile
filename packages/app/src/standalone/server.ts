/**
 * Standalone mode: an in-app implementation of the fork's server HTTP API.
 * Requests to the seeded local server URL (http://127.0.0.1:4096) are answered
 * directly in the WebView from device storage; chat execution calls provider
 * APIs straight from the app. No server process is involved.
 */
import { standaloneEvents } from "./events"
import { standaloneID, standaloneStore, type StandaloneSession } from "./store"
import { standaloneCatalog } from "./catalog"

export const STANDALONE_HOSTS = new Set(["127.0.0.1:4096", "localhost:4096"])

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

const withLocation = (directory: string, data: unknown) => ({ location: { directory }, data })

type Params = Record<string, string>

function match(path: string, pattern: string): Params | undefined {
  const a = path.split("/").filter(Boolean)
  const b = pattern.split("/").filter(Boolean)
  if (a.length !== b.length) return
  const params: Params = {}
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(":")) params[b[i].slice(1)] = decodeURIComponent(a[i])
    else if (a[i] !== b[i]) return
  }
  return params
}

const DEFAULT_DIR = "/projects/default"

function projectFor(directory: string) {
  const existing = standaloneStore.projects.list().find((item) => item.canonical === directory)
  if (existing) return existing
  return standaloneStore.projects.add(directory)
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  const method = req.method.toUpperCase()
  const directory = url.searchParams.get("location.directory") ?? req.headers.get("x-opencode-directory") ?? DEFAULT_DIR
  const body = async () => {
    try {
      return await req.json()
    } catch {
      return {}
    }
  }
  let m: Params | undefined

  if (path === "/api/info" && method === "GET")
    return json({ version: "2.0.24-standalone", pid: 0, urls: ["standalone://local"], paths: { tmp: "" }, capabilities: { persistentPty: false } })
  if (path === "/api/event" && method === "GET") return standaloneEvents.stream(req.signal)
  if (path === "/api/location" && method === "GET") {
    const project = projectFor(directory)
    return json({ directory, project: { id: project.id, directory, canonical: directory } })
  }
  if (path === "/api/project" && method === "GET") {
    projectFor(directory)
    return json(standaloneStore.projects.list())
  }
  if (path === "/api/config" && method === "GET") return json([])
  if (path === "/api/agent" && method === "GET")
    return json(
      withLocation(directory, [
        { id: "build", name: "Build", request: { settings: {}, headers: {}, body: {} }, description: "The default agent.", mode: "primary", hidden: false, permissions: [{ action: "*", resource: "*", effect: "allow" }] },
        { id: "plan", name: "Plan", request: { settings: {}, headers: {}, body: {} }, description: "Plan without making changes.", mode: "primary", hidden: false, permissions: [] },
      ]),
    )
  if (["/api/command", "/api/mcp", "/api/reference", "/api/skill", "/api/shell", "/api/form", "/api/websearch/provider"].includes(path) && method === "GET")
    return json(withLocation(directory, []))
  if (path === "/api/vcs" && method === "GET") return json(withLocation(directory, null))
  if (path === "/api/vcs/branch" && method === "GET") return json(withLocation(directory, null))
  if (path === "/api/session/active" && method === "GET") return json({ data: {} })
  // Virtual filesystem for the standalone project picker: /projects holds one
  // directory per project; any /projects/<name> path counts as an existing
  // (empty) directory so creating a project is just picking its path.
  if (path === "/api/fs/list" && method === "GET") {
    const requested = url.searchParams.get("path") ?? "."
    const base = requested === "." ? directory : requested
    const canonical = standaloneStore.projects.list().map((item) => item.canonical)
    const entries =
      base === "/"
        ? [{ path: "/projects", type: "directory" }]
        : base === "/projects"
          ? canonical.map((item) => ({ path: item, type: "directory" }))
          : []
    return json({ location: { directory: base }, data: entries })
  }
  if (path === "/api/fs/find" && method === "GET") {
    const query = (url.searchParams.get("query") ?? "").toLowerCase()
    const matches = standaloneStore.projects
      .list()
      .map((item) => item.canonical)
      .filter((item) => !query || item.toLowerCase().includes(query))
      .slice(0, 10)
      .map((item) => ({ path: item, type: "directory" }))
    return json({ location: { directory }, data: matches })
  }

  if (path === "/api/worktree" && method === "GET") return json([])
  if (path === "/api/worktree/refresh" && method === "POST") return new Response(null, { status: 204 })
  if (path === "/api/mcp/resource" && method === "GET") return json(withLocation(directory, { resources: [], templates: [] }))
  if ((m = match(path, "/api/session/:id/inbox")) && method === "GET") return json({ data: [] })
  if ((m = match(path, "/api/session/:id/permission")) && method === "GET") return json({ data: [] })
  if ((m = match(path, "/api/session/:id/form")) && method === "GET") return json({ data: [] })

  // Providers / integrations
  if (path === "/api/integration" && method === "GET") return json(withLocation(directory, standaloneCatalog.integrations()))
  if ((m = match(path, "/api/integration/:id/connect/key")) && method === "POST") {
    const input = (await body()) as { key?: string; answer?: Record<string, string> }
    if (input.key) standaloneStore.keys.set(m.id, input.key, input.answer)
    standaloneEvents.publish("credential.updated", { integrationID: m.id }, { directory })
    standaloneEvents.publish("provider.updated", {}, { directory })
    return json({})
  }
  if ((m = match(path, "/api/integration/:id/connect/key")) && method === "DELETE") {
    standaloneStore.keys.remove(m.id)
    standaloneEvents.publish("credential.updated", { integrationID: m.id }, { directory })
    standaloneEvents.publish("provider.updated", {}, { directory })
    return json({})
  }
  if (path === "/api/provider" && method === "GET") return json(withLocation(directory, standaloneCatalog.providers()))
  if (path === "/api/model" && method === "GET") return json(withLocation(directory, standaloneCatalog.models()))

  // Sessions
  if (path === "/api/session" && method === "GET") return json({ data: standaloneStore.sessions.list().sort((a, b) => b.time.updated - a.time.updated) })
  if (path === "/api/session" && method === "POST") {
    const input = (await body()) as { agent?: string; model?: { id: string; providerID: string; variant?: string }; title?: string; location?: { directory?: string } }
    const dir = input.location?.directory ?? directory
    const project = projectFor(dir)
    const now = Date.now()
    const session: StandaloneSession = {
      id: standaloneID("ses"),
      projectID: project.id,
      agent: input.agent ?? "build",
      model: { variant: "default", ...(input.model ?? standaloneCatalog.defaultModel()) },
      ...(input.title ? { title: input.title } : {}),
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
      location: { directory: dir },
    }
    standaloneStore.sessions.put(session)
    standaloneEvents.publish("session.created", { session }, { directory: dir })
    return json({ data: session })
  }
  if ((m = match(path, "/api/session/:id")) && method === "PATCH") {
    const session = standaloneStore.sessions.get(m.id)
    if (!session) return json({ error: "not found" }, 404)
    const patch = (await body()) as { title?: string }
    if (typeof patch.title === "string" && patch.title.trim()) {
      session.title = patch.title.trim()
      standaloneStore.sessions.put(session)
      standaloneEvents.publish("session.renamed", { sessionID: m.id, title: session.title }, { directory })
    }
    return new Response(null, { status: 204 })
  }

  if ((m = match(path, "/api/session/:id")) && method === "GET") {
    const session = standaloneStore.sessions.get(m.id)
    return session ? json({ data: session }) : json({ error: "not found" }, 404)
  }
  if ((m = match(path, "/api/session/:id")) && method === "DELETE") {
    standaloneStore.sessions.remove(m.id)
    standaloneEvents.publish("session.deleted", { sessionID: m.id }, { directory })
    return json({})
  }
  if ((m = match(path, "/api/session/:id/message/:msgID")) && method === "GET") {
    const msg = standaloneStore.messages.get(m.msgID)
    if (!msg || msg.sessionID !== m.id) return json({ error: "not found" }, 404)
    return json({ data: msg })
  }

  if ((m = match(path, "/api/session/:id/message")) && method === "GET") {
    return json({ data: standaloneStore.messages.list(m.id), cursor: {} })
  }
  if ((m = match(path, "/api/session/:id/model")) && method === "POST") {
    const input = (await body()) as { model?: { id: string; providerID: string; variant?: string } }
    const session = standaloneStore.sessions.get(m.id)
    if (!session) return json({ error: "not found" }, 404)
    if (input.model) {
      session.model = { variant: "default", ...input.model }
      session.time.updated = Date.now()
      standaloneStore.sessions.put(session)
      const eventID = standaloneID("evt")
      standaloneStore.messages.put({
        id: eventID.replace(/^evt_/, "msg_"),
        sessionID: session.id,
        time: { created: Date.now() },
        type: "model-switched",
        model: session.model,
      })
      standaloneEvents.publish(
        "session.model.selected",
        { sessionID: session.id, model: session.model },
        { directory, aggregateID: session.id, id: eventID },
      )
    }
    return new Response(null, { status: 204 })
  }
  if ((m = match(path, "/api/session/:id/agent")) && method === "POST") {
    const input = (await body()) as { agent?: string }
    const session = standaloneStore.sessions.get(m.id)
    if (!session) return json({ error: "not found" }, 404)
    if (input.agent) {
      session.agent = input.agent
      session.time.updated = Date.now()
      standaloneStore.sessions.put(session)
      standaloneEvents.publish("session.agent.selected", { sessionID: session.id, agent: session.agent }, { directory })
    }
    return new Response(null, { status: 204 })
  }
  if ((m = match(path, "/api/session/:id/prompt")) && method === "POST") {
    const { executeStandalonePrompt } = await import("./chat")
    return executeStandalonePrompt(m.id, await body(), directory, json)
  }

  return json({ error: `standalone: no route for ${method} ${path}` }, 404)
}

export function isStandaloneURL(input: URL | RequestInfo): boolean {
  try {
    const raw = typeof input === "string" ? input : input instanceof Request ? input.url : String(input)
    const url = new URL(raw, "http://127.0.0.1:4096")
    return STANDALONE_HOSTS.has(url.host)
  } catch {
    return false
  }
}

export function createStandaloneFetch(original: typeof globalThis.fetch): typeof globalThis.fetch {
  const wrapped = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isStandaloneURL(input)) return original(input as RequestInfo, init)
    const req = input instanceof Request ? input : new Request(input, init)
    return route(req).catch((error) => json({ error: String(error) }, 500))
  }
  return wrapped as typeof globalThis.fetch
}

let installed = false
export function installStandaloneFetch() {
  if (installed) return
  installed = true
  globalThis.fetch = createStandaloneFetch(globalThis.fetch.bind(globalThis))
}
