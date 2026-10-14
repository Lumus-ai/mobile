import { expect, test } from "bun:test"
import {
  clampSessionPaneWidth,
  clampSessionTabsWidth,
  defaultSessionPaneWidth,
  homeProjectPanelWidth,
  sessionSidebarDocks,
  sessionTabsFitVertically,
  SESSION_SIDEBAR_MAX_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
  SESSION_SIDEBAR_WIDTH,
  SESSION_TABS_COMPACT_WIDTH,
} from "../../src/ui/layout"

test("vertical tabs match the session sidebar and preserve readable content width", () => {
  expect(SESSION_SIDEBAR_WIDTH).toBe(42)
  expect(sessionTabsFitVertically(106)).toBe(true)
  expect(sessionTabsFitVertically(105)).toBe(false)
})

test("vertical tabs account for a resized width", () => {
  expect(sessionTabsFitVertically(124, 60)).toBe(true)
  expect(sessionTabsFitVertically(123, 60)).toBe(false)
})

test("project tree width is bounded and stays readable on a normal terminal", () => {
  expect(SESSION_SIDEBAR_MIN_WIDTH).toBe(34)
  expect(SESSION_SIDEBAR_MAX_WIDTH).toBe(56)
  expect(clampSessionTabsWidth(0, 120)).toBe(SESSION_SIDEBAR_MIN_WIDTH)
  expect(clampSessionTabsWidth(11, 120)).toBe(SESSION_SIDEBAR_MIN_WIDTH)
  expect(clampSessionTabsWidth(42, 120)).toBe(42)
  expect(clampSessionTabsWidth(100, 120)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
  expect(clampSessionTabsWidth(100, 100)).toBe(SESSION_SIDEBAR_MAX_WIDTH)
})

test("a compact rail is allowed only when the terminal cannot fit both readable panes", () => {
  expect(clampSessionTabsWidth(0, 77)).toBe(SESSION_TABS_COMPACT_WIDTH)
  expect(clampSessionTabsWidth(12, 77)).toBe(12)
  expect(clampSessionTabsWidth(42, 54)).toBe(10)
  expect(sessionTabsFitVertically(69, SESSION_TABS_COMPACT_WIDTH)).toBe(true)
  expect(sessionTabsFitVertically(68, SESSION_TABS_COMPACT_WIDTH)).toBe(false)
})

test("the session sidebar docks beside a readable chat at laptop widths", () => {
  // After the left project tree is taken out, a ~100-column content area must still
  // show the right sidebar rather than stretching the transcript across the window.
  expect(sessionSidebarDocks(94, false)).toBe(true)
  expect(sessionSidebarDocks(93, false)).toBe(false)
  expect(sessionSidebarDocks(98, false)).toBe(true)
  expect(sessionSidebarDocks(96, true)).toBe(true)
  expect(sessionSidebarDocks(95, true)).toBe(false)
})

test("home project panel respects width bounds and preserves usable prompt space", () => {
  expect(homeProjectPanelWidth(160, 42)).toBe(42)
  expect(homeProjectPanelWidth(130, 34)).toBe(32)
  expect(homeProjectPanelWidth(128, 34)).toBe(30)
  expect(homeProjectPanelWidth(127, 34)).toBe(0)
  expect(homeProjectPanelWidth(90, 0)).toBe(0)
})

test("right panel resizing keeps the chat readable and allows useful width changes", () => {
  expect(clampSessionPaneWidth(10, 108)).toBe(28)
  expect(clampSessionPaneWidth(43, 108)).toBe(43)
  expect(clampSessionPaneWidth(100, 108)).toBe(52)
  expect(clampSessionPaneWidth(100, 90)).toBe(34)
  expect(clampSessionPaneWidth(30, 54)).toBe(1)
  expect(defaultSessionPaneWidth(108, false)).toBe(43)
  expect(defaultSessionPaneWidth(108, true)).toBe(38)
})
