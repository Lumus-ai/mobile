import type { JSX } from "solid-js"

// Own line icons (24px grid, 1.8 stroke). Not taken from any other app.
const base = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" } as const
type P = JSX.SvgSVGAttributes<SVGSVGElement>
const I = (children: () => JSX.Element) => (props: P) => <svg {...base} {...props}>{children()}</svg>

export const IconChat = I(() => <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.3-4.6A7.5 7.5 0 1 1 20 11.5Z" />)
export const IconStack = I(() => <><rect x="3.5" y="4" width="17" height="7" rx="2.5" /><rect x="3.5" y="13" width="17" height="7" rx="2.5" /></>)
export const IconFolder = I(() => <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.2l2 2.2H18A2.5 2.5 0 0 1 20.5 9.7v7.8A2.5 2.5 0 0 1 18 20H6a2.5 2.5 0 0 1-2.5-2.5Z" />)
export const IconCheck = I(() => <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8.5 12.3 2.5 2.5 4.6-5" /></>)
export const IconNodes = I(() => <><circle cx="12" cy="18" r="2.3" /><circle cx="5.5" cy="6" r="2.3" /><circle cx="18.5" cy="6" r="2.3" /><path d="M7 7.8 11 15.9M17 7.8l-4 8.1M7.8 6h8.4" /></>)
export const IconMenu = I(() => <path d="M5 8h14M5 12h14M5 16h9" />)
export const IconPlus = I(() => <path d="M12 5v14M5 12h14" />)
export const IconMic = I(() => <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>)
export const IconSend = I(() => <path d="M12 19V5M6 11l6-6 6 6" />)
export const IconStop = I(() => <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />)
export const IconSliders = I(() => <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>)
export const IconChevron = I(() => <path d="m9 6 6 6-6 6" />)
export const IconBack = I(() => <path d="m14.5 6-6 6 6 6" />)
export const IconCode = I(() => <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />)
export const IconTerminal = I(() => <><path d="m5 7 5 5-5 5" /><path d="M13 17h6" /></>)
export const IconBranch = I(() => <><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="8.5" r="2" /><path d="M6.5 7.5v9M17.5 10.5c0 4-5 3-11 6" /></>)
export const IconGrid = I(() => <><rect x="4" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" /></>)
export const IconShield = I(() => <><path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.3 7 9 4.1-1.7 7-4.8 7-9V6Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>)
export const IconServer = I(() => <><rect x="3.5" y="4" width="17" height="6.5" rx="2.2" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="2.2" /><path d="M7 7.2h.01M7 16.7h.01" /></>)
export const IconMoon = I(() => <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" />)
export const IconInfo = I(() => <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>)
export const IconFlag = I(() => <path d="M6 20V4.5M6 5h11l-2 3.5L17 12H6" />)
export const IconImage = I(() => <><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5 4.5 4" /></>)
export const IconCopy = I(() => <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>)
export const IconDownload = I(() => <path d="M12 4.5v11M7.5 11 12 15.5 16.5 11M5 19.5h14" />)
export const IconLaptop = I(() => <><rect x="5" y="5.5" width="14" height="9.5" rx="2" /><path d="M3 18.5h18" /></>)
export const IconSpark = I(() => <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18l-1.8-5.4-5.7-1.8L10.2 9Z" />)
export const IconTrash = I(() => <path d="M5 7h14M10 4h4M7 7l.8 12h8.4L17 7M10.5 10.5v6M13.5 10.5v6" />)
export const IconPause = I(() => <><path d="M9 6v12M15 6v12" /></>)
