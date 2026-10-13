import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { ToastProvider } from "../../src/ui/toast"
import { DialogProvider } from "../../src/ui/dialog"
import { Keymap } from "../../src/context/keymap"
import { InteractivityProvider } from "../../src/context/interactivity"
import { ProjectDodEntry } from "../../src/component/project-dod"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const source = `# Project Definition of Done
stages: []
leaves:
  - id: L-001
    what: Ship the feature
    group: Build
    task_state: DONE
    steps:
      - "[x] Implement it"
      - "[x] Test it"
  - id: L-002
    what: Document the feature
    group: Quality
    task_state: IN_PROGRESS
    steps:
      - "[x] Draft"
      - "[ ] Review"
`

async function renderBoard(directory: string) {
  return testRender(
    () => (
      <TestTuiContexts directory={directory}>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={{ discover: async () => ({}) }}>
            <InteractivityProvider enabled={true}>
              <Keymap.Provider>
                <ToastProvider>
                  <DialogProvider>
                    <ProjectDodEntry directory={directory} />
                  </DialogProvider>
                </ToastProvider>
              </Keymap.Provider>
            </InteractivityProvider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 100, height: 24 },
  )
}

async function frameWith(setup: Awaited<ReturnType<typeof renderBoard>>, value: string) {
  const started = Date.now()
  while (Date.now() - started < 3_000) {
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (frame.includes(value)) return frame
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for "${value}":\n${setup.captureCharFrame()}`)
}

test("the right-panel DoD action opens the existing project task board", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-project-dod-"))
  await mkdir(path.join(directory, ".opencode"), { recursive: true })
  await writeFile(path.join(directory, ".opencode", "dod.yaml"), source, "utf8")
  const setup = await renderBoard(directory)
  try {
    const summary = await frameWith(setup, "1/2")
    expect(summary).toContain("█████")
    const lines = summary.split("\n")
    const y = lines.findIndex((line) => line.includes("DoD"))
    expect(y).toBeGreaterThanOrEqual(0)
    const x = lines[y].indexOf("DoD")
    setup.mockMouse.click(x, y)
    const opened = await frameWith(setup, "Definition of Done")
    expect(opened).toContain("L-001")
    expect(opened).toContain("Ship the feature")
    expect(opened).toContain("L-002")
    expect(opened).toContain("Document the feature")
    expect(opened).toContain("1/2")
  } finally {
    setup.renderer.destroy()
    await rm(directory, { recursive: true, force: true })
  }
})

test("the DoD action remains available when no board exists and explains why it is empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-project-dod-missing-"))
  const setup = await renderBoard(directory)
  try {
    const frame = await frameWith(setup, "Open task board")
    const lines = frame.split("\n")
    const y = lines.findIndex((line) => line.includes("DoD"))
    const x = lines[y].indexOf("DoD")
    setup.mockMouse.click(x, y)
    const opened = await frameWith(setup, "No DoD file found")
    expect(opened).toContain(".opencode/dod.yaml")
    expect(opened).not.toContain("Everything is done")
  } finally {
    setup.renderer.destroy()
    await rm(directory, { recursive: true, force: true })
  }
})
