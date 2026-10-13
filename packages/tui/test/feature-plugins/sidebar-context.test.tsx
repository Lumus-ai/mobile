/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import { SidebarContext } from "../../src/feature-plugins/sidebar/context"

function context(options?: {
  cost?: number
  tokens?: number
  limit?: number
  actionColor?: boolean
  openPanel?: (name: string) => boolean
}) {
  const color = RGBA.fromInts(200, 200, 200)
  return {
    theme: {
      text: {
        base: color,
        muted: color,
        ...(options?.actionColor === false ? {} : { action: { primary: { base: color } } }),
        feedback: { success: { base: color }, info: { base: color }, warning: { base: color }, error: { base: color } },
      },
    },
    data: {
      session: {
        get: () => ({ location: { directory: "/workspace" } }),
        cost: () => options?.cost ?? 0,
        message: {
          list: () =>
            options?.tokens
              ? [
                  {
                    id: "message",
                    type: "assistant",
                    model: { providerID: "provider", id: "model" },
                    tokens: {
                      input: options.tokens,
                      output: 0,
                      reasoning: 0,
                      cache: { read: 0, write: 0 },
                    },
                  },
                ]
              : [],
        },
      },
      location: {
        model: {
          list: () =>
            options?.limit ? [{ providerID: "provider", id: "model", limit: { context: options.limit } }] : [],
        },
      },
    },
    ui: {
      panel: {
        open: (name: string) => options?.openPanel?.(name) ?? true,
      },
    },
  } as unknown as Context
}

test("sidebar omits context before usage is available", async () => {
  const app = await testRender(() => <SidebarContext context={context()} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("Context")
    expect(app.captureCharFrame()).not.toContain("Not measured")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows available context usage", async () => {
  const app = await testRender(() => <SidebarContext context={context({ tokens: 1234 })} sessionID="session" />, {
    width: 42,
    height: 8,
  })

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Context")
    expect(app.captureCharFrame()).toContain("1.2K tokens")
  } finally {
    app.renderer.destroy()
  }
})

test("sidebar shows usage against the model context limit", async () => {
  const app = await testRender(
    () => <SidebarContext context={context({ tokens: 150000, limit: 200000, cost: 1.5 })} sessionID="session" />,
    { width: 42, height: 8 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("75% used")
    expect(frame).toContain("█")
    expect(frame).toContain("150.0K / 200.0K tokens")
    expect(frame).toContain("$1.50 spent")
  } finally {
    app.renderer.destroy()
  }
})

test("DoD launcher remains visible and opens the existing task panel without an action theme color", async () => {
  const opened: string[] = []
  const app = await testRender(
    () => (
      <SidebarContext
        context={context({
          actionColor: false,
          openPanel: (name) => {
            opened.push(name)
            return true
          },
        })}
        sessionID="session"
      />
    ),
    { width: 72, height: 12 },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("DoD")
    const lines = frame.split("\n")
    const y = lines.findIndex((line) => line.includes("DoD"))
    expect(y).toBeGreaterThanOrEqual(0)
    const x = lines[y].indexOf("DoD")
    app.mockMouse.click(x, y)
    await app.renderOnce()
    expect(opened).toEqual(["opencode.sidebar.dod"])
  } finally {
    app.renderer.destroy()
  }
})
