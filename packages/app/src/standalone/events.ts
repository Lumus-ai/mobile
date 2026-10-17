/**
 * Standalone SSE hub: one in-process event bus, served to the app as the
 * /api/event stream (text/event-stream over a ReadableStream) and emitted by
 * the shim's own endpoint handlers.
 */

export type StandaloneEvent = {
  id: string
  created: number
  type: string
  location?: { directory?: string }
  data?: unknown
  durable?: { aggregateID: string; seq: number; version: number }
  metadata?: Record<string, unknown>
}

const listeners = new Set<(event: StandaloneEvent) => void>()
let seq = 0
let counter = 0

export const standaloneEvents = {
  publish(type: string, data?: unknown, extra?: { directory?: string; aggregateID?: string; metadata?: Record<string, unknown>; id?: string }) {
    const event: StandaloneEvent = {
      id: extra?.id ?? `evt_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      created: Date.now(),
      type,
      ...(extra?.directory ? { location: { directory: extra.directory } } : {}),
      data: (data ?? {}) as unknown,
      ...(extra?.aggregateID ? { durable: { aggregateID: extra.aggregateID, seq: ++seq, version: 1 } } : {}),
      ...(extra?.metadata ? { metadata: extra.metadata } : {}),
    }
    for (const listener of listeners) listener(event)
  },
  stream(signal: AbortSignal): Response {
    let interval: ReturnType<typeof setInterval> | undefined
    const body = new ReadableStream<string>({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(chunk)
          } catch {}
        }
        send(`data: ${JSON.stringify({ id: `evt_${Date.now().toString(36)}boot`, type: "server.connected", data: {} })}\n\n`)
        const listener = (event: StandaloneEvent) => send(`data: ${JSON.stringify(event)}\n\n`)
        listeners.add(listener)
        interval = setInterval(() => send(": heartbeat\n\n"), 15_000)
        signal.addEventListener("abort", () => {
          listeners.delete(listener)
          if (interval) clearInterval(interval)
          try {
            controller.close()
          } catch {}
        })
      },
      cancel() {
        if (interval) clearInterval(interval)
      },
    })
    return new Response(body.pipeThrough(new TextEncoderStream()), {
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    })
  },
}
