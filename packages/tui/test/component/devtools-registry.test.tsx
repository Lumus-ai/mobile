/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { Renderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { Hub } from "@opencode/core/hub/index"
import { HubState } from "@opencode/core/hub/state"
import { RegistryPanel, type RegistryPanelOptions } from "../../src/component/devtools-registry"
import { ConfigProvider } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { ThemeProvider } from "../../src/context/theme"
import { Toast, ToastProvider } from "../../src/ui/toast"
import { hubRegistryStatus } from "../../src/util/hub-registry"
import { emptyThemeSource, tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

// rg is absent so the first row carries an install button; every other catalog
// tool resolves, so the rest of the page carries remove buttons.
const probe = (tool: string) => tool !== "rg"
const registryManager: Hub.Manager =
  process.platform === "win32" ? "winget" : process.platform === "darwin" ? "brew" : "apt"

async function render(options: RegistryPanelOptions & { onShell?: (shell: string) => void }) {
  const app = await testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <RegistryPanel options={options} onShell={options.onShell} />
                <Toast />
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 90, height: 44, kittyKeyboard: true },
  )
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Registry") && frame.includes("Search"))
  return app
}

// The click handler persists in the background while the switch updates
// optimistically, so assertions wait for the durable value to catch up.
async function untilEnabled(directory: string, tool: string, expected: boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await HubState.read({ directory })).enabled[tool] === expected) return true
    await Bun.sleep(10)
  }
  return false
}

// Value printed right after a summary label. Read the rendered row so varying
// terminal spacing doesn't make the test depend on a fixed number of spaces.
function rowValue(frame: string, label: string) {
  const row = frame.split("\n").find((line) => line.includes(label))
  return row?.slice(row.indexOf(label) + label.length).trim().split(/\s+/)[0]
}

// Cell of `needle` on the row naming `tool`: the tool's own row carries both —
// a category line or a header may contain the name too, so one line must match.
function cell(app: Awaited<ReturnType<typeof render>>, tool: string, needle: string) {
  const lines = app.captureCharFrame().split("\n")
  const row = lines.findIndex((line) => line.includes(tool) && line.includes(needle))
  if (row < 0) throw new Error(`no row for ${tool} with ${needle}`)
  const column = lines[row].indexOf(needle)
  if (column < 0) throw new Error(`no ${needle} on the ${tool} row`)
  return { x: column, y: row }
}

test("registry panel shows readiness, terminals and a paged tool list", async () => {
  await using tmp = await tmpdir()
  const status = hubRegistryStatus({ probe, terminalProbe: () => true, manager: registryManager })
  const app = await render({ probe, terminalProbe: () => true, manager: registryManager, directory: tmp.path })
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("Registry")
    expect(frame).toContain("Ready")
    expect(frame).toContain(`${status.ready}/${status.total}`)
    expect(frame).toContain("AI terminal")
    expect(frame).toContain("bash")
    expect(frame).toContain(`${status.categories[0].name} `)
    expect(frame).toContain("Search")
    // the hint block is opt-in: a fresh state file advertises nothing
    expect(rowValue(frame, "For the model")).toBe(`0/${status.tools.length}`)
    expect(status.tools.length).toBeGreaterThan(10)
    expect(frame).toContain("1/")
    // first page is the ten most actionable rows, absent tools first
    expect(frame).toContain(status.tools[0].tool)
    expect(app.captureCharFrame()).toContain("Install")
    expect(app.captureCharFrame()).toContain("Remove")
  } finally {
    app.renderer.destroy()
  }
})

test("install button runs the action and refreshes the row", async () => {
  await using tmp = await tmpdir()
  const calls: string[] = []
  const app = await render({
    probe,
    manager: registryManager,
    directory: tmp.path,
    install: async (tool) => {
      calls.push(tool)
      return { ok: true, exit: 0, output: "", command: `install ${tool}` }
    },
  })
  try {
    const target = hubRegistryStatus({ probe, manager: registryManager }).tools.find((row) => !row.installed && row.manageable)
    expect(target?.tool).toBe("rg")
    const { x, y } = cell(app, target!.tool, "Install")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("rg installed"))
    expect(calls).toEqual(["rg"])
    // the row stays actionable after the refresh rather than freezing on a spinner
    expect(app.captureCharFrame()).not.toContain("…")
  } finally {
    app.renderer.destroy()
  }
})

test("a pending install shows the pending marker until the result arrives", async () => {
  await using tmp = await tmpdir()
  let release!: (value: Hub.ActionResult) => void
  const gate = new Promise<Hub.ActionResult>((resolve) => {
    release = resolve
  })
  const app = await render({ probe, manager: registryManager, directory: tmp.path, install: () => gate })
  try {
    const { x, y } = cell(app, "rg", "Install")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("…"))
    release({ ok: true, exit: 0, output: "", command: "install rg" })
    await app.waitForFrame((frame) => frame.includes("rg installed"))
    expect(app.captureCharFrame()).not.toContain("…")
  } finally {
    app.renderer.destroy()
  }
})

test("failed install shows the command in the note and the reason in a toast", async () => {
  await using tmp = await tmpdir()
  const app = await render({
    probe,
    manager: registryManager,
    directory: tmp.path,
    install: async () => ({
      ok: false,
      exit: 100,
      output: "sudo apt-get install -y ripgrep\nE: Could not open lock file",
      command: "sudo apt-get install -y ripgrep",
    }),
  })
  try {
    const { x, y } = cell(app, "rg", "Install")
    await app.mockMouse.click(x, y)
    // the toast carries the manager's own reason for the failure
    await app.waitForFrame((frame) => frame.includes("E: Could not open lock file"))
    const frame = app.captureCharFrame()
    // the persistent note pins the exact command to rerun by hand
    expect(frame).toContain("rg: sudo apt-get install -y ripgrep")
    expect(frame).not.toContain("rg installed")
  } finally {
    app.renderer.destroy()
  }
})

test("remove needs a second click on the same button before it runs", async () => {
  await using tmp = await tmpdir()
  const calls: string[] = []
  const app = await render({
    probe,
    manager: registryManager,
    directory: tmp.path,
    remove: async (tool) => {
      calls.push(tool)
      return { ok: true, exit: 0, output: "", command: `remove ${tool}` }
    },
  })
  try {
    const target = hubRegistryStatus({ probe, manager: registryManager }).tools.find((row) => row.installed && row.manageable)
    expect(target).toBeDefined()
    const { x, y } = cell(app, target!.tool, "Remove")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes("Remove?"))
    // the first click only armed the button
    expect(calls).toEqual([])
    // the pointer never left the button, so the second click executes
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes(`${target!.tool} removed`))
    expect(calls).toEqual([target!.tool])
  } finally {
    app.renderer.destroy()
  }
})

test("a manually installed tool stays visible without an unsafe Remove action", async () => {
  await using tmp = await tmpdir()
  const app = await render({
    probe: () => true,
    platform: "linux",
    manager: "apt",
    terminalProbe: () => true,
    directory: tmp.path,
  })
  try {
    await app.mockInput.typeText("semgrep")
    const frame = await app.waitForFrame((frame) => frame.includes("semgrep") && frame.includes("installed (manual)"))
    const row = frame.split("\n").find((line) => line.includes("semgrep") && line.includes("installed (manual)"))
    expect(row).toBeDefined()
    expect(row).not.toContain("Remove")
  } finally {
    app.renderer.destroy()
  }
})

test("the switch turns a tool on for the model and writes it to hub.json", async () => {
  await using tmp = await tmpdir()
  const app = await render({ probe, manager: registryManager, directory: tmp.path })
  try {
    const tools = hubRegistryStatus({ probe, manager: registryManager }).tools
    const first = tools[0].tool
    const { x, y } = cell(app, first, "[off]")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => rowValue(frame, "For the model") === `1/${tools.length}`)
    expect(cell(app, first, "[on]").y).toBe(y)
    expect(await untilEnabled(tmp.path, first, true)).toBe(true)

    // switching it off again withdraws it from the hint block and the listing
    const off = cell(app, first, "[on]")
    await app.mockMouse.click(off.x, off.y)
    await app.waitForFrame((frame) => rowValue(frame, "For the model") === `0/${tools.length}`)
    expect(await untilEnabled(tmp.path, first, false)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("All off also clears saved switches that are outside the current registry rows", async () => {
  await using tmp = await tmpdir()
  const stale = "orphanedLegacyTool"
  const target = hubRegistryStatus({ probe }).tools.find((row) => row.installed)!.tool
  await HubState.setEnabled(stale, true, { directory: tmp.path })
  await HubState.setEnabled(target, true, { directory: tmp.path })

  const app = await render({ probe, directory: tmp.path })
  try {
    const frame = await app.waitForFrame(
      (frame) => frame.includes(`[on] ${target}`) && frame.includes("All off"),
    )
    const lines = frame.split("\n")
    const row = lines.findIndex((line) => line.includes("All off"))
    const allOff = lines[row]!.indexOf("All off")
    const x = allOff + Math.floor("All off".length / 2)
    await app.mockMouse.moveTo(x, row)
    const hitId = app.renderer.hitTest(x, row)
    let hit = Renderable.renderablesByNumber.get(hitId)
    const chain: Array<{ type: string; id: string; x: number; y: number; width: number; height: number }> = []
    while (hit && chain.length < 8) {
      chain.push({
        type: hit.constructor.name,
        id: hit.id,
        x: hit.x,
        y: hit.y,
        width: hit.width,
        height: hit.height,
      })
      hit = hit.parent instanceof Renderable ? hit.parent : undefined
    }
    await app.mockMouse.click(x, row)
    await Bun.sleep(50)
    const afterFrame = app.captureCharFrame()
    const counter = rowValue(afterFrame, "For the model")
    if (counter !== "0/" + hubRegistryStatus({ probe }).tools.length) {
      throw new Error(
        "DEBUG All off failed click: " +
          JSON.stringify(
            {
              x,
              y: row,
              rowText: lines[row],
              hitId,
              chain,
              targetEnabled: (await HubState.read({ directory: tmp.path })).enabled[target],
              staleEnabled: (await HubState.read({ directory: tmp.path })).enabled[stale],
              counter,
              statusRow: afterFrame.split("\n").find((line) => line.includes("For the model")),
            },
            null,
            2,
          ),
      )
    }

    await app.waitForFrame((frame) => rowValue(frame, "For the model") === "0/" + hubRegistryStatus({ probe }).tools.length)
    expect(await untilEnabled(tmp.path, target, false)).toBe(true)
    expect(await untilEnabled(tmp.path, stale, false)).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("pager moves to the second page of tools", async () => {
  await using tmp = await tmpdir()
  const app = await render({ probe, manager: registryManager, directory: tmp.path })
  try {
    const status = hubRegistryStatus({ probe, manager: registryManager })
    const secondPage = status.tools[12].tool
    await app.waitForFrame((frame) => !frame.includes(secondPage))
    const { x, y } = cell(app, "Search", "›")
    await app.mockMouse.click(x, y)
    await app.waitForFrame((frame) => frame.includes(secondPage))
    expect(app.captureCharFrame()).toContain("2/")
  } finally {
    app.renderer.destroy()
  }
})

test("every catalog tool gets exactly one row", async () => {
  await using _tmp = await tmpdir()
  const status = hubRegistryStatus({ probe })
  const required = new Set(
    Hub.all.filter((entry) => Hub.supportsPlatform(entry)).flatMap((entry) => entry.requires ?? []),
  )
  expect(status.tools.map((row) => row.tool).sort()).toEqual([...required].sort())
  expect(new Set(status.tools.map((row) => row.tool)).size).toBe(status.tools.length)
  // installed/missing stays a partition of the same set
  expect(new Set([...status.installed, ...status.missing.map((entry) => entry.tool)])).toEqual(required)
})

test("search narrows the tool list by name or by what a recipe does", async () => {
  await using tmp = await tmpdir()
  const app = await render({ probe, directory: tmp.path })
  try {
    // Focus the actual input with a mouse click; the component's deferred focus
    // can otherwise race with typeText on fast Windows test runs.
    const lines = app.captureCharFrame().split("\n")
    const row = lines.findIndex((line) => line.includes("tool, category or task:"))
    expect(row).toBeGreaterThanOrEqual(0)
    const x = lines[row]!.indexOf("tool, category or task:")
    await app.mockMouse.click(x, row)
    await Bun.sleep(10)
    await app.mockInput.typeText("yaml")
    await app.waitForFrame((frame) => frame.includes("[off] yq") && !frame.includes("[off] rg"))
    expect(app.captureCharFrame()).not.toContain("[off] git")
  } finally {
    app.renderer.destroy()
  }
})

test("the AI terminal can be installed and chosen", async () => {
  await using tmp = await tmpdir()
  const installed: string[] = []
  const shells: string[] = []
  // pwsh is installed, nu is not; apt can install it
  const terminalProbe = (backend: Hub.Backend) => backend !== "nu"
  const app = await render({
    probe,
    terminalProbe,
    manager: "apt",
    directory: tmp.path,
    install: async (tool) => {
      installed.push(tool)
      return { ok: true, exit: 0, output: "", command: `install ${tool}` }
    },
    onShell: (shell) => shells.push(shell),
  })
  try {
    const frame = await app.waitForFrame((frame) => frame.includes("Install nu"))
    expect(frame).toContain("● pwsh")

    const install = frame.split("\n").findIndex((line) => line.includes("Install nu"))
    await app.mockMouse.click(frame.split("\n")[install].indexOf("Install nu") + 2, install)
    await app.waitFor(() => installed.length === 1)
    expect(installed).toEqual(["nu"])

    const now = app.captureCharFrame()
    const row = now.split("\n").findIndex((line) => line.includes("○ bash"))
    await app.mockMouse.click(now.split("\n")[row].indexOf("○ bash") + 2, row)
    await app.waitForFrame((frame) => frame.includes("● bash"))
    expect((await HubState.read({ directory: tmp.path })).terminal).toBe("bash")
    expect(shells).toEqual(["bash"])
  } finally {
    app.renderer.destroy()
  }
})

test("a mirror 404 offers a system update that clears the warning", async () => {
  await using tmp = await tmpdir()
  let updates = 0
  const app = await render({
    probe,
    manager: registryManager,
    directory: tmp.path,
    install: async () => ({
      ok: false,
      exit: 1,
      output:
        "sudo pacman -S --noconfirm ripgrep\nerror: failed retrieving file 'ripgrep.pkg.tar.zst' from mirror : The requested URL returned error: 404",
      command: "sudo pacman -S --noconfirm ripgrep",
    }),
    update: async () => {
      updates++
      return { ok: true, exit: 0, output: "", command: "sudo pacman -Syu --noconfirm" }
    },
  })
  try {
    const { x, y } = cell(app, "rg", "Install")
    await app.mockMouse.click(x, y)
    const frame = await app.waitForFrame((frame) => frame.includes("Update system"))
    expect(frame).toContain("The package databases are outdated")

    const lines = frame.split("\n")
    const row = lines.findIndex((line) => line.includes("Update system"))
    await app.mockMouse.click(lines[row].indexOf("Update system") + 2, row)
    await app.waitForFrame((frame) => frame.includes("system updated") && !frame.includes("databases are outdated"))
    expect(updates).toBe(1)
  } finally {
    app.renderer.destroy()
  }
})
