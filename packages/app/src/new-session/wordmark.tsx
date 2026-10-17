import "./wordmark.css"

/**
 * Terminal-style block wordmark, matching the TUI home logo
 * (packages/tui/src/logo.ts half-block art, "open" dim + "code" bright).
 */
export function NewSessionWordmark() {
  return (
    <div
      data-component="new-session-wordmark"
      aria-hidden="true"
      class="pointer-events-none mx-auto w-full max-w-[720px]"
    >
      <div data-slot="wordmark-reveal" class="relative mx-auto w-4/5 max-md:w-[64%]">
        <svg viewBox="0 0 312 58" fill="none" xmlns="http://www.w3.org/2000/svg" class="block aspect-[312/58] w-full">
      <rect x="0" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="8" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="16" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="24" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="40" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="48" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="56" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="64" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="80" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="88" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="96" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="104" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="120" y="14.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="128" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="136" y="14.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="144" y="21.75" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="0" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="8" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="16" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="24" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="40" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="48" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="56" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="64" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="80" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="88" y="29" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="88" y="36.25" width="8" height="7.25" fill="var(--wm-open-shadow)" />
      <rect x="96" y="29" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="96" y="36.25" width="8" height="7.25" fill="var(--wm-open-shadow)" />
      <rect x="104" y="29" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="104" y="36.25" width="8" height="7.25" fill="var(--wm-open-shadow)" />
      <rect x="120" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="128" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="136" y="29" width="8" height="14.5" fill="var(--wm-open-shadow)" />
      <rect x="144" y="29" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="0" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="8" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="16" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="24" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="40" y="43.5" width="8" height="14.5" fill="var(--wm-open)" />
      <rect x="48" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="56" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="64" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="80" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="88" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="96" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="104" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="120" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="128" y="43.5" width="8" height="7.25" fill="var(--wm-open-shadow)" />
      <rect x="136" y="43.5" width="8" height="7.25" fill="var(--wm-open-shadow)" />
      <rect x="144" y="43.5" width="8" height="7.25" fill="var(--wm-open)" />
      <rect x="264" y="7.25" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="160" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="168" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="176" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="184" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="200" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="208" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="216" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="224" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="240" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="248" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="256" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="264" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="280" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="288" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="296" y="14.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="304" y="14.5" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="160" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="168" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="176" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="184" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="200" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="208" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="216" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="224" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="240" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="248" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="256" y="29" width="8" height="14.5" fill="var(--wm-code-shadow)" />
      <rect x="264" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="280" y="29" width="8" height="14.5" fill="var(--wm-code)" />
      <rect x="288" y="29" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="288" y="36.25" width="8" height="7.25" fill="var(--wm-code-shadow)" />
      <rect x="296" y="29" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="296" y="36.25" width="8" height="7.25" fill="var(--wm-code-shadow)" />
      <rect x="304" y="29" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="304" y="36.25" width="8" height="7.25" fill="var(--wm-code-shadow)" />
      <rect x="160" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="168" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="176" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="184" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="200" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="208" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="216" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="224" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="240" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="248" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="256" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="264" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="280" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="288" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="296" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
      <rect x="304" y="43.5" width="8" height="7.25" fill="var(--wm-code)" />
        </svg>
      </div>
    </div>
  )
}
