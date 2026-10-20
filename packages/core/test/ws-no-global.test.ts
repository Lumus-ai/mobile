import { expect, test } from "bun:test"
import { Effect } from "effect"
import { fromWebSocket } from "../../ai/src/route/transport/websocket"

test("websocket transport does not need globalThis.WebSocket (nodejs-mobile)", async () => {
  const saved = globalThis.WebSocket
  // @ts-expect-error simulate a runtime without the global
  delete globalThis.WebSocket
  try {
    const fake = { readyState: 3 } as unknown as globalThis.WebSocket
    const result = await Effect.runPromise(
      fromWebSocket(fake, { url: "wss://example.test", headers: {} } as never).pipe(Effect.flip),
    )
    expect(String((result as { reason?: { message?: string } }).reason?.message ?? result)).toContain("closed before opening")
  } finally {
    globalThis.WebSocket = saved
  }
})
