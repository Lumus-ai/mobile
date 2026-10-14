export const SESSION_SIDEBAR_WIDTH = 42
export const SESSION_TABS_COMPACT_WIDTH = 5
export const SESSION_TABS_COMPACT_BREAKPOINT = 12
export const SESSION_SIDEBAR_MIN_WIDTH = 34
export const SESSION_SIDEBAR_MAX_WIDTH = 56
const SESSION_CONTENT_MIN_WIDTH = 44
const SESSION_CONTENT_PREFERRED_WIDTH = 64

export function sessionTabsFitVertically(total: number, width = SESSION_SIDEBAR_WIDTH) {
  return total >= width + SESSION_CONTENT_PREFERRED_WIDTH
}

export function clampSessionTabsWidth(width: number, total: number) {
  const max = Math.max(
    SESSION_TABS_COMPACT_WIDTH,
    Math.min(SESSION_SIDEBAR_MAX_WIDTH, total - SESSION_CONTENT_MIN_WIDTH),
  )
  // On a normally sized terminal, keep the project tree wide enough for actual names.
  // Collapse to the compact rail only when a wider sidebar would starve the main content.
  const min =
    total >= SESSION_SIDEBAR_MIN_WIDTH + SESSION_CONTENT_MIN_WIDTH
      ? SESSION_SIDEBAR_MIN_WIDTH
      : SESSION_TABS_COMPACT_WIDTH
  return Math.max(Math.min(min, max), Math.min(width, max))
}

export function clampSessionPaneWidth(width: number, total: number) {
  const half = Math.max(1, Math.floor(total / 2))
  // Preserve the equal split when there is not enough room for both pane minima.
  return Math.max(Math.min(24, half), Math.min(width, Math.max(half, total - SESSION_CONTENT_MIN_WIDTH)))
}

// Compact layout keeps both side panels open on a laptop-sized terminal: the
// project panel gets its own narrower width and the session sidebar docks beside
// the chat as long as the chat keeps its preferred width.
// Full layout uses the normal-width sidebar, but may dock it once the chat can still
// retain its readable minimum. Otherwise the sidebar remains available via its toggle.
export const SESSION_TABS_COMPACT_LAYOUT_WIDTH = 34
export const SESSION_SIDEBAR_COMPACT_WIDTH = 32
const SESSION_SIDEBAR_DOCK_GUTTER = 8
const COMPACT_LAYOUT_AUTO_FROM = 110
const COMPACT_LAYOUT_AUTO_BELOW = 170

export function compactLayout(mode: "auto" | "compact" | "full" | undefined, total: number) {
  if (mode === "compact") return true
  if (mode === "full") return false
  return total >= COMPACT_LAYOUT_AUTO_FROM && total < COMPACT_LAYOUT_AUTO_BELOW
}

export function sessionSidebarDocks(available: number, compact: boolean) {
  if (compact) return available >= SESSION_SIDEBAR_COMPACT_WIDTH + SESSION_CONTENT_PREFERRED_WIDTH
  return available >= SESSION_SIDEBAR_WIDTH + SESSION_CONTENT_MIN_WIDTH + SESSION_SIDEBAR_DOCK_GUTTER
}

// Home's right project dashboard is optional at narrow widths: reserve enough space
// for the centered prompt and cap the panel so it cannot swallow the main content.
export const HOME_PROJECT_PANEL_MIN_WIDTH = 30
export const HOME_PROJECT_PANEL_WIDTH = 42
const HOME_CONTENT_MIN_WIDTH = 64

export function homeProjectPanelWidth(total: number, leftPanelWidth: number) {
  const available = total - leftPanelWidth - HOME_CONTENT_MIN_WIDTH
  if (available < HOME_PROJECT_PANEL_MIN_WIDTH) return 0
  return Math.min(HOME_PROJECT_PANEL_WIDTH, available)
}

// A terminal or plugin panel opens at half the room in the full layout and at
// two fifths in the compact one, so the chat beside it stays readable.
export function defaultSessionPaneWidth(total: number, compact: boolean) {
  return Math.max(1, Math.floor(compact ? (total * 2) / 5 : total / 2))
}
