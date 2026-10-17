/**
 * Standalone chat execution: sends the prompt straight from the app to the
 * chosen provider's API and streams the reply back as the fork's session
 * events, so the existing session UI renders it live.
 */
import { standaloneEvents } from "./events"
import { standaloneID, standaloneStore, type StandaloneMessage } from "./store"

const OPENAI_COMPAT_BASE: Record<string, string> = {
  opencode: "https://opencode.ai/inference/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
}

const publish = (type: string, data: unknown, directory: string, aggregateID?: string) =>
  standaloneEvents.publish(type, data, { directory, ...(aggregateID ? { aggregateID } : {}) })

function keyFor(providerID: string): string | undefined {
  if (providerID === "opencode") return "public"
  return standaloneStore.keys.get(providerID)?.key
}

function endpointFor(providerID: string, modelID: string, stream: boolean) {
  if (providerID === "anthropic") return { url: "https://api.anthropic.com/v1/messages", kind: "anthropic" as const }
  if (providerID === "google")
    return { url: `https://generativelanguage.googleapis.com/v1beta/models/${modelID}:streamGenerateContent?alt=sse`, kind: "google" as const }
  const base = OPENAI_COMPAT_BASE[providerID] ?? OPENAI_COMPAT_BASE.opencode
  return { url: `${base}/chat/completions`, kind: "openai" as const }
}

function effortSettings(variant: string | undefined) {
  if (!variant || variant === "default" || variant === "none") return {}
  if (["low", "medium", "high"].includes(variant)) return { reasoningEffort: variant }
  return {}
}

type Delta = { text?: string; reasoning?: string }

async function* streamProvider(options: {
  providerID: string
  modelID: string
  variant?: string
  key: string
  sessionID?: string
  messages: Array<{ role: string; content: string }>
  signal?: AbortSignal
}): AsyncGenerator<Delta> {
  const { providerID, modelID, key } = options
  const endpoint = endpointFor(providerID, modelID, true)
  const effort = effortSettings(options.variant)

  let request: { url: string; init: RequestInit }
  if (endpoint.kind === "anthropic") {
    request = { url: endpoint.url, init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: modelID,
        max_tokens: 8192,
        stream: true,
        messages: options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        ...(options.messages.find((m) => m.role === "system") ? { system: options.messages.find((m) => m.role === "system")!.content } : {}),
      }),
    } }
  } else if (endpoint.kind === "google") {
    request = { url: endpoint.url, init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: options.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        ...(options.messages.find((m) => m.role === "system")
          ? { systemInstruction: { parts: [{ text: options.messages.find((m) => m.role === "system")!.content }] } }
          : {}),
      }),
    } }
  } else {
    request = { url: endpoint.url, init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...(providerID === "opencode"
          ? { "x-opencode-client": "opencode", "x-opencode-session-id": options.sessionID ?? "", "x-opencode-project": "standalone" }
          : {}),
      },
      body: JSON.stringify({
        model: modelID,
        stream: true,
        messages: options.messages,
        ...(effort.reasoningEffort ? { reasoning_effort: effort.reasoningEffort } : {}),
      }),
    } }
  }

  // On the Android WebView, provider APIs send no CORS headers, so requests
  // go through Capacitor's native HTTP bridge. Responses arrive buffered, so
  // the reply renders on completion instead of token-by-token.
  const capacitor = (globalThis as {
    Capacitor?: {
      isNativePlatform?: () => boolean
      Plugins?: {
        CapacitorHttp?: {
          request: (input: {
            url: string
            method: string
            headers: Record<string, string>
            data: string
            responseType: string
          }) => Promise<{ status: number; data: unknown }>
        }
      }
    }
  }).Capacitor

  async function* chunks(): AsyncGenerator<string> {
    if (capacitor?.isNativePlatform?.() && capacitor.Plugins?.CapacitorHttp) {
      const res = await capacitor.Plugins.CapacitorHttp.request({
        url: request.url,
        method: "POST",
        headers: request.init.headers as Record<string, string>,
        data: String(request.init.body ?? ""),
        responseType: "text",
      })
      if (res.status < 200 || res.status >= 300) {
        const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data)
        throw new Error(`${providerID} API error ${res.status}: ${text.slice(0, 300)}`)
      }
      if (typeof res.data === "string") yield res.data
      return
    }
    const response = await fetch(request.url, { ...request.init, signal: options.signal })
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "")
      throw new Error(`${providerID} API error ${response.status}: ${text.slice(0, 300)}`)
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield value
    }
  }

  let buffer = ""
  for await (const value of chunks()) {
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith("data:")) continue
      const payload = trimmed.slice(5).trim()
      if (payload === "[DONE]") return
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }
      if (endpoint.kind === "anthropic") {
        const type = parsed.type as string
        const delta = parsed.delta as { type?: string; text?: string; thinking?: string } | undefined
        if (type === "content_block_delta" && delta?.type === "text_delta" && delta.text) yield { text: delta.text }
        if (type === "content_block_delta" && delta?.type === "thinking_delta" && delta.thinking) yield { reasoning: delta.thinking }
      } else if (endpoint.kind === "google") {
        const candidates = parsed.candidates as Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> | undefined
        for (const part of candidates?.[0]?.content?.parts ?? []) {
          if (!part.text) continue
          if (part.thought) yield { reasoning: part.text }
          else yield { text: part.text }
        }
      } else {
        const choices = parsed.choices as Array<{ delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }> | undefined
        const delta = choices?.[0]?.delta
        if (delta?.content) yield { text: delta.content }
        const reasoning = delta?.reasoning_content ?? delta?.reasoning
        if (reasoning) yield { reasoning }
      }
    }
  }
}

export async function executeStandalonePrompt(
  sessionID: string,
  body: Record<string, unknown>,
  directory: string,
  json: (data: unknown, status?: number) => Response,
): Promise<Response> {
  const session = standaloneStore.sessions.get(sessionID)
  if (!session) return json({ error: "not found" }, 404)

  const now = Date.now()
  const clientID = typeof body.id === "string" && body.id.startsWith("msg_") ? body.id : undefined
  const userMessage: StandaloneMessage = {
    id: clientID ?? standaloneID("msg"),
    sessionID,
    time: { created: now },
    type: "user",
    text: String(body.text ?? ""),
    files: (body.files as unknown[]) ?? [],
    agents: (body.agents as unknown[]) ?? [],
    skills: (body.skills as unknown[]) ?? [],
  }
  if (body.agent && typeof body.agent === "string") session.agent = body.agent
  standaloneStore.messages.put(userMessage)
  publish("session.inbox.enqueued", {
    sessionID,
    inboxID: userMessage.id,
    item: {
      type: "user",
      delivery: "steer",
      payload: { text: userMessage.text, resumeOnStart: true },
    },
  }, directory, sessionID)
  publish("session.inbox.delivered", { sessionID, inboxID: userMessage.id }, directory, sessionID)

  const model = (body.model as { id?: string; providerID?: string; variant?: string } | undefined) ?? session.model
  const providerID = model.providerID ?? "opencode"
  const modelID = model.id ?? "ll-alpha-free"
  const key = keyFor(providerID)

  if (!key) {
    const error = { type: "ProviderAuthError", message: `No API key for ${providerID}. Connect it in Settings > Providers.` }
    publish("session.execution.failed", { sessionID, error }, directory, sessionID)
    return json({ error: error.message }, 400)
  }

  const assistantMessageID = standaloneID("msg")
  const started = Date.now()

  const run = async () => {
    let full = ""
    let reasoning = ""
    let reasoningOpen = false
    let textOpen = false
    try {
      publish("session.execution.started", { sessionID, messageID: assistantMessageID }, directory, sessionID)
      publish("session.step.started", { sessionID, assistantMessageID, agent: session.agent, model: { id: modelID, providerID, variant: model.variant ?? "default" }, started }, directory, sessionID)

      const history = standaloneStore.messages
        .list(sessionID)
        .filter((item) => (item.type === "user" && item.text) || item.type === "assistant")
        .map((item) => ({
          role: item.type === "user" ? "user" : "assistant",
          content: item.type === "user" ? (item.text ?? "") : (item.content ?? []).filter((c) => c.type === "text").map((c) => ("text" in c ? c.text : "")).join("\n"),
        }))
        .filter((item) => item.content)

      const stream = streamProvider({ providerID, modelID, variant: model.variant, key, sessionID, messages: history })
      let first = true
      for await (const delta of stream) {
        if (first) {
          publish("session.step.streamed", { sessionID, assistantMessageID }, directory, sessionID)
          first = false
        }
        if (delta.reasoning) {
          if (!reasoningOpen) {
            publish("session.reasoning.started", { sessionID, assistantMessageID }, directory, sessionID)
            reasoningOpen = true
          }
          reasoning += delta.reasoning
          publish("session.reasoning.delta", { sessionID, assistantMessageID, delta: delta.reasoning }, directory, sessionID)
        }
        if (delta.text) {
          if (reasoningOpen) {
            publish("session.reasoning.ended", { sessionID, assistantMessageID, text: reasoning }, directory, sessionID)
            reasoningOpen = false
          }
          if (!textOpen) {
            publish("session.text.started", { sessionID, assistantMessageID }, directory, sessionID)
            textOpen = true
          }
          full += delta.text
          publish("session.text.delta", { sessionID, assistantMessageID, delta: delta.text }, directory, sessionID)
        }
      }
      if (reasoningOpen) publish("session.reasoning.ended", { sessionID, assistantMessageID, text: reasoning }, directory, sessionID)
      if (textOpen) publish("session.text.ended", { sessionID, assistantMessageID, text: full }, directory, sessionID)

      const completed = Date.now()
      const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      publish("session.step.ended", { sessionID, assistantMessageID, finish: "stop", rawFinish: "stop", cost: 0, tokens }, directory, sessionID)
      publish("session.execution.succeeded", { sessionID, messageID: assistantMessageID }, directory, sessionID)

      const assistant: StandaloneMessage = {
        id: assistantMessageID,
        sessionID,
        time: { created: started, streamed: started, completed },
        type: "assistant",
        agent: session.agent,
        model: { id: modelID, providerID, variant: model.variant ?? "default" },
        content: [
          ...(reasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
          { type: "text" as const, text: full },
        ],
        finish: "stop",
        cost: 0,
        tokens,
      }
      standaloneStore.messages.put(assistant)
      if (!session.title) {
        session.title = userMessage.text ? userMessage.text.slice(0, 60) : "New session"
        session.time.updated = completed
        standaloneStore.sessions.put(session)
        publish("session.renamed", { sessionID, title: session.title }, directory, sessionID)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const structured = { type: "ProviderError", message }
      publish("session.step.failed", { sessionID, assistantMessageID, finish: "error", error: structured }, directory, sessionID)
      publish("session.execution.failed", { sessionID, error: structured }, directory, sessionID)
      const assistant: StandaloneMessage = {
        id: assistantMessageID,
        sessionID,
        time: { created: started, completed: Date.now() },
        type: "assistant",
        agent: session.agent,
        model: { id: modelID, providerID, variant: model.variant ?? "default" },
        content: full ? [{ type: "text" as const, text: full }] : [],
        finish: "error",
        error: { type: "ProviderError", message },
      }
      standaloneStore.messages.put(assistant)
    }
  }

  void run()
  const payload: Record<string, unknown> = { text: userMessage.text, resumeOnStart: true }
  if (userMessage.files?.length) payload.files = userMessage.files
  if (userMessage.agents?.length) payload.agents = userMessage.agents
  if (userMessage.skills?.length) payload.skills = userMessage.skills
  return json({
    data: {
      id: userMessage.id,
      sessionID,
      time: { created: now },
      type: "user",
      payload,
      delivery: "steer",
    },
  })
}
