import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { RoomDod } from "@opencode/client/promise"
import { createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import { RoomDodRows } from "../../src/component/room-dod"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const board: RoomDod = {
  status: "ready",
  items: [
    { id: "auth", what: "Login works", stage: "build", state: "IN_PROGRESS", done: 1, total: 2 },
    { id: "docs", what: "Docs updated", stage: "build", state: "DONE", done: 1, total: 1 },
  ],
}

async function render(load: () => Promise<RoomDod>, roomID: () => string = () => "room") {
  const [hover, setHover] = createSignal<string>()
  return testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
            <ToastProvider>
              <RoomDodRows
                id={roomID()}
                load={load}
                release={load}
                feed={() => new Promise(() => {})}
                hover={hover}
                setHover={setHover}
              />
            </ToastProvider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 12 },
  )
}

async function frameWith(setup: Awaited<ReturnType<typeof render>>, text: string) {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for "${text}":\n${setup.captureCharFrame()}`)
}

test("a DoD that cannot be read says why instead of listing nothing", async () => {
  const setup = await render(() => Promise.reject(new Error("host unreachable")))
  try {
    const frame = await frameWith(setup, "DoD connection error")
    expect(frame).toContain("host unreachable")
  } finally {
    setup.renderer.destroy()
  }
})

test("a synchronous DoD adapter failure is rendered as a connection error", async () => {
  const setup = await render(() => {
    throw new Error("synchronous adapter failure")
  })
  try {
    const frame = await frameWith(setup, "DoD connection error")
    expect(frame).toContain("synchronous adapter failure")
  } finally {
    setup.renderer.destroy()
  }
})

test("a failed refresh keeps the board and says since when it is stale", async () => {
  const outcomes = [Promise.resolve(board)]
  const setup = await render(() => outcomes.shift() ?? Promise.reject(new Error("connection reset")))
  try {
    await frameWith(setup, "1/2")
    // The panel polls every five seconds; the second read fails.
    const frame = await waitLong(setup, "DoD response is stale")
    expect(frame).toContain("connection reset")
    expect(frame).toContain("1/2")
  } finally {
    setup.renderer.destroy()
  }
}, 12_000)

test("a state-unknown response is not presented as ready", async () => {
  const setup = await render(() => Promise.reject(new Error("Service did not answer: state unknown")))
  try {
    const frame = await frameWith(setup, "DoD state unknown")
    expect(frame).toContain("Service did not answer: state unknown")
  } finally {
    setup.renderer.destroy()
  }
})

test("a missing board is reported as disabled, not as an empty completed board", async () => {
  const setup = await render(() => Promise.resolve({ items: [], status: "disabled" as const }))
  try {
    const frame = await frameWith(setup, "DoD is disabled")
    expect(frame).toContain(".opencode/dod.yaml is missing")
    expect(frame).not.toContain("Everything is done.")
  } finally {
    setup.renderer.destroy()
  }
})

test("a response without an explicit state remains unknown", async () => {
  const legacy: RoomDod = { items: board.items }
  const setup = await render(() => Promise.resolve(legacy))
  try {
    const frame = await frameWith(setup, "DoD state unknown")
    expect(frame).toContain("omitted the explicit service state")
    expect(frame).toContain("1/2")
  } finally {
    setup.renderer.destroy()
  }
})

test("a recovered connection returns the panel to ready", async () => {
  const outcomes = [Promise.reject(new Error("connection reset")), Promise.resolve(board)]
  const setup = await render(() => outcomes.shift() ?? Promise.resolve(board))
  try {
    const error = await frameWith(setup, "DoD connection error")
    expect(error).toContain("connection reset")
    const recovered = await waitLong(setup, "1/2")
    expect(recovered).not.toContain("DoD connection error")
    expect(recovered).not.toContain("DoD state unknown")
  } finally {
    setup.renderer.destroy()
  }
}, 12_000)

test("switching projects ignores a late response from the previous project", async () => {
  const [roomID, setRoomID] = createSignal("first")
  let resolvePrevious!: (dod: RoomDod) => void
  const previous = new Promise<RoomDod>((resolve) => {
    resolvePrevious = resolve
  })
  const next: RoomDod = {
    status: "ready",
    items: [{ id: "new", what: "Current project task", stage: "build", state: "IN_PROGRESS", done: 0, total: 1 }],
  }
  const setup = await render(() => (roomID() === "first" ? previous : Promise.resolve(next)), roomID)
  try {
    await frameWith(setup, "DoD service is starting")
    setRoomID("second")
    const current = await frameWith(setup, "DoD 0/1")
    expect(current).not.toContain("DoD 1/2")
    resolvePrevious(board)
    await Bun.sleep(50)
    await setup.renderOnce()
    const afterLateResponse = setup.captureCharFrame()
    expect(afterLateResponse).toContain("DoD 0/1")
    expect(afterLateResponse).not.toContain("DoD 1/2")
  } finally {
    setup.renderer.destroy()
  }
})

async function waitLong(setup: Awaited<ReturnType<typeof render>>, text: string) {
  const started = Date.now()
  while (Date.now() - started < 8_000) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(text)) return frame
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for "${text}":\n${setup.captureCharFrame()}`)
}
