import { expect, test } from "bun:test"
import { DOD_PANEL, openDodPanel, parseDodBoard, summarizeDodBoard } from "../src/feature-plugins/sidebar/dod"

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
