type HoverTheme<T> = {
  background: {
    base: T
    raised?: {
      base?: T
      high?: T
    }
  }
  increase: (color: T, amount: number) => T
}

/**
 * Shared hover surface for interactive rows and actions throughout the TUI.
 * Prefer the theme's raised-high token so different panels render the same
 * highlight; keep a fallback for minimal/plugin test themes.
 */
export function hoverBackground<T>(theme: HoverTheme<T>): T {
  return theme.background.raised?.high ?? theme.increase(theme.background.raised?.base ?? theme.background.base, 4)
}
