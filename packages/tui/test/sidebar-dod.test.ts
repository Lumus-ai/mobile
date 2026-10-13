import { expect, test } from "bun:test"
import { access, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DOD_PANEL, openDodPanel, parseDodBoard, resolveDodRoot, summarizeDodBoard } from "../src/feature-plugins/sidebar/dod"

test("nested sessions resolve the DoD board from the nearest repository root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-dod-root-"))
  const project = path.join(temporary, "project")
  const nested = path.join(project, "packages", "core", "src")
  try {
    await mkdir(path.join(project, ".git"), { recursive: true })
    await mkdir(nested, { recursive: true })
    await access(path.join(project, ".git"))
    expect(await resolveDodRoot(nested)).toBe(project)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("markerless projects keep their selected directory as the DoD root", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-dod-markerless-"))
  const project = path.join(temporary, "plain-project")
  const nested = path.join(project, "src")
  try {
    await mkdir(nested, { recursive: true })
    expect(await resolveDodRoot(project)).toBe(project)
    expect(await resolveDodRoot(nested)).toBe(nested)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test("DoD progress counts only tasks with a terminal state", () => {
  const items = parseDodBoard([
    "task_id: PROJECT-BOARD",
    "stages: []",
    "leaves:",
    "  - id: L-001",
    "    what: Parse the board",
    "    task_state: DONE",
    "    steps:",
    '      - "[x] parse"',
    '      - "[X] validate"',
    "  - id: L-002",
    "    what: Add tests",
    "    task_state: IN_PROGRESS",
    "    steps:",
    '      - "[x] add test"',
    '      - "[ ] run test"',
    "  - id: L-003",
    "    what: Not in scope",
    "    task_state: OUT_OF_SCOPE",
  ].join("\n"))

  expect(items.map((item) => ({ id: item.id, done: item.done, total: item.total }))).toEqual([
    { id: "L-001", done: 2, total: 2 },
    { id: "L-002", done: 1, total: 2 },
    { id: "L-003", done: 0, total: 0 },
  ])
  expect(summarizeDodBoard(items)).toEqual({ finished: 2, total: 3, percent: 67 })
})

test("an empty DoD board is zero progress, not completed work", () => {
  const items = parseDodBoard("task_id: PROJECT-BOARD\nstages: []\nleaves: []")
  expect(summarizeDodBoard(items)).toEqual({ finished: 0, total: 0, percent: 0 })
})

test("malformed DoD data raises an error rather than looking like an empty board", () => {
  expect(() => parseDodBoard("nope")).toThrow("DoD must be a YAML mapping")
  expect(() => parseDodBoard("leaves: nope")).toThrow("DoD leaves must be a list")
})

test("the DoD launcher opens the registered full task panel", () => {
  const opened: string[] = []
  const context = {
    ui: {
      panel: {
        open: (name: string) => {
          opened.push(name)
          return true
        },
      },
    },
  } as unknown as Parameters<typeof openDodPanel>[0]

  expect(openDodPanel(context)).toBe(true)
  expect(opened).toEqual([DOD_PANEL])
})
