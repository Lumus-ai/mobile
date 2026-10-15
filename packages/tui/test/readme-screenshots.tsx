// Renders the README screenshots from the real TUI against a demo project and a fake server, so
// no local sessions, keys or paths end up in them. From packages/tui:
//
//   bun test/readme-screenshots.tsx            all shots into .github/readme
//   bun test/readme-screenshots.tsx home hub   only these
import type { CapturedFrame } from "@opentui/core"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createAppFixture } from "./fixture/app"

const OUT = path.resolve(import.meta.dir, "../../../.github/readme")
// One terminal cell in SVG pixels.
const CW = 9
const CH = 19
// Half and full blocks are drawn as rectangles: as glyphs they leave gaps and break the logo.
const BLOCKS: Record<string, [number, number]> = { "▀": [0, 0.5], "▄": [0.5, 0.5], "█": [0, 1] }
// The DoD panel reads a real file, so the demo project lives in a temp folder; the frames show it
// as SHOWN instead.
const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "opencode-pp-shots-")), "shop-api")
const SHOWN = "~/projects/shop-api"
const loc = { directory: dir, project: { id: "proj_shop", directory: dir, canonical: dir } }
const room = { id: "room_lab", sessionID: "ses_lab", name: "Команда Wi-Fi", ai: "linked", guestApprovals: false, created: 0 }
const sessions = ["Архитектор", "Бэкенд-разработчик", "Тестировщик", "Ревьюер", "Документация"].map((title, i) => ({
  id: `ses_${i}`,
  title,
  projectID: "proj_shop",
  location: { directory: dir },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 10 - i, updated: 20 - i },
}))

const DOD = `project:
  name: shop-api
leaves:
  - { id: API-1, what: REST API заказов, task_state: DONE, steps: ["[x] схема", "[x] эндпоинты", "[x] тесты"] }
  - { id: AUTH-2, what: Вход по JWT, task_state: DONE, steps: ["[x] токены", "[x] refresh"] }
  - { id: PAY-3, what: Оплата и вебхуки, task_state: IN_PROGRESS, steps: ["[x] клиент", "[x] вебхук", "[ ] повторы", "[ ] e2e"] }
  - { id: UI-4, what: Админка заказов, task_state: IN_PROGRESS, steps: ["[x] список", "[ ] фильтры", "[ ] экспорт"] }
  - { id: OPS-5, what: Деплой и мониторинг, task_state: NOT_STARTED, steps: ["[ ] CI", "[ ] алерты"] }
  - { id: DOC-6, what: Документация API, task_state: BLOCKED, steps: ["[ ] OpenAPI"] }
`

const IDEAS = [
  ["Голосовой ассистент для склада", "Сборщик диктует артикулы, ИИ сверяет заказ и печатает этикетку.", "Логистика", 42],
  ["Ревью PR по чек-листу команды", "Агент проверяет pull request по правилам проекта и оставляет замечания.", "Разработка", 37],
  ["Трекер подписок семьи", "Собирает списания из писем и предупреждает о продлении.", "Финансы", 29],
  ["Генератор тестов из багрепортов", "Превращает описание бага в падающий тест и PR с исправлением.", "Разработка", 24],
] as const
// The global Idea Bank is reached over HTTP, so a local stand-in serves the demo catalogue.
const ideaServer = Bun.serve({
  port: 0,
  fetch: () =>
    json({
      total: IDEAS.length,
      items: IDEAS.map(([title, summary, category, signalCount], i) => ({
        id: `idea_${i}`,
        title,
        summary,
        category,
        signalCount,
        createdAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
      })),
    }),
})
process.env.OPENCODE_IDEA_BANK_URL = `http://127.0.0.1:${ideaServer.port}`

const now = Date.now()
const NOTES = [
  {
    name: "release-plan",
    frontmatter: { title: "План релиза 1.0", status: "active", tags: ["релиз"], session: "ses_0" },
    body: "# Цели\n\n- Оплата и вебхуки\n- Админка заказов\n- Деплой и алерты\n\n## Риски\n\nПовторы вебхуков от банка приходят не по порядку.",
  },
  {
    name: "payments",
    frontmatter: { title: "Вебхуки банка", status: "inbox", tags: ["оплата", "api"] },
    body: "Банк шлёт повторы до 5 раз. Нужна идемпотентность по event_id.",
  },
  {
    name: "retro",
    frontmatter: { title: "Ретро спринта", status: "done", tags: ["команда"] },
    body: "Что хорошо: тесты до кода. Что улучшить: ревью быстрее.",
  },
].map((note, i) => ({
  ...note,
  frontmatter: { ...note.frontmatter, created: now - 3_600_000 * (i + 1), updated: now - 600_000 * (i + 1) },
  mtime: 100 - i,
}))

const shots: Record<string, () => Promise<void>> = {
  async home() {
    await using setup = await demo({})
    await setup.waitForFrame((frame) => frame.includes("▸ shop-api"))
    await click(setup, "▸ shop-api")
    await save(setup, "home", "opencode-pp — проект, команда, комната и DoD")
  },
  async ideas() {
    await using setup = await demo({ debug: true })
    await setup.waitForFrame((frame) => frame.includes("✦"))
    await click(setup, "✦")
    await setup.waitForFrame((frame) => frame.includes("Голосовой"))
    await save(setup, "ideas", "opencode-pp — банк идей")
  },
  async hub() {
    await using setup = await demo({ debug: true })
    await setup.waitForFrame((frame) => frame.includes("✦"))
    await click(setup, " Реестр")
    await setup.waitForFrame((frame) => frame.includes("nu"))
    await save(setup, "hub", "opencode-pp — Hub CLI-инструментов")
  },
  async notes() {
    await using setup = await demo({ sessionID: "ses_0" })
    await setup.waitForFrame((frame) => frame.includes("Заметки"))
    await click(setup, "Заметки")
    await setup.waitForFrame((frame) => frame.includes("Повторы вебхуков"))
    await save(setup, "notes", "opencode-pp — заметки")
  },
}

await Bun.write(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n")
await Bun.write(path.join(dir, ".opencode", "dod.yaml"), DOD)
for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(shots)) await shots[name]!()
await fs.rm(path.dirname(dir), { recursive: true, force: true })
// The app's background tasks keep the loop alive after the last fixture closes.
process.exit(0)

async function demo(input: { debug?: boolean; sessionID?: string }) {
  const setup = await createAppFixture({
    width: 140,
    height: 38,
    args: input.sessionID ? { sessionID: input.sessionID } : {},
    config: { animations: false, language: "ru", ...(input.debug ? { debug: { devtools: true } } : {}) },
    fetch: (url) => {
      const p = url.pathname
      if (p === "/api/location") return json(loc)
      if (p === "/api/project")
        return json([{ id: "proj_shop", canonical: dir, name: "shop-api", time: { created: 1, updated: 2 }, sandboxes: [] }])
      if (p === "/api/orchestra/project") return json([{ id: "prj_shop", name: "shop-api", directory: dir, created: 1 }])
      if (p === "/api/orchestra/project/prj_shop/session") return json({ data: sessions, access: {}, category: {} })
      if (p === "/api/session") return json({ data: sessions, cursor: {} })
      if (p === "/api/room") return json({ data: [room] })
      if (p === `/api/room/${room.id}/dod`)
        return json({
          status: "ready",
          items: [
            { id: "PAY-3", what: "Оплата и вебхуки", stage: "S2", state: "IN_PROGRESS", done: 2, total: 4, owner: "Аня" },
            { id: "UI-4", what: "Админка заказов", stage: "S2", state: "IN_PROGRESS", done: 1, total: 3, owner: "Я", mine: true },
            { id: "API-1", what: "REST API заказов", stage: "S1", state: "DONE", done: 3, total: 3 },
          ],
        })
      if (p === `/api/room/${room.id}/ban`) return json({ data: [] })
      if (p === `/api/room/${room.id}/member`)
        return json({ data: [{ id: "g1", name: "Аня", role: "member", joined: 0, online: true, address: "192.168.1.7" }] })
      if (p === "/api/note") return json({ location: loc, data: NOTES })
      if (p.startsWith("/api/note/")) return json({ location: loc, data: NOTES.find((note) => p.endsWith(note.name)) ?? NOTES[0] })
      const session = sessions.find((item) => p === `/api/session/${item.id}`)
      if (session) return json({ data: { ...session, agent: "build", model: { providerID: "anthropic", id: "claude" } } })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(p)) return json({ data: [], cursor: {} })
      if (p === "/api/agent") return json({ location: loc, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (p === "/api/model")
        return json({ location: loc, data: [{ id: "claude", providerID: "anthropic", name: "Claude", variants: [] }] })
      if (p === "/api/provider") return json({ location: loc, data: [{ id: "anthropic", name: "Anthropic" }] })
      if (p === "/api/vcs") return json({ location: loc, data: { branch: { current: "main", default: "main" } } })
      return undefined
    },
  })
  await setup.ready
  return setup
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } })
}

// A click right after a frame appears can land before the layout settles, so it re-reads the screen.
async function click(setup: Awaited<ReturnType<typeof demo>>, needle: string) {
  await Bun.sleep(300)
  await setup.renderOnce()
  const lines = setup.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes(needle))
  if (y < 0) throw new Error(`"${needle}" is not on screen`)
  await setup.mockMouse.click(lines[y]!.indexOf(needle), y)
}

async function save(setup: Awaited<ReturnType<typeof demo>>, name: string, title: string) {
  await Bun.sleep(400)
  await setup.renderOnce()
  await Bun.write(path.join(OUT, `${name}.svg`), svg(setup.captureSpans(), title))
  console.log(`${name}.svg`)
}

function svg(frame: CapturedFrame, title: string) {
  const width = frame.cols * CW + 24
  const height = frame.rows * CH + 42
  const area = new Map<string, number>()
  frame.lines.forEach((line) => line.spans.forEach((span) => area.set(hex(span.bg), (area.get(hex(span.bg)) ?? 0) + span.width)))
  const base = [...area].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? "#0a0a0a"
  const shapes: string[] = []
  const texts: string[] = []
  frame.lines.forEach((line, row) => {
    const y = row * CH
    line.spans.reduce((col, span) => {
      // The temp project shows as the folder a reader would have, however the UI truncated it,
      // and the fixture's "test" version label is left out. Padding keeps the grid.
      const length = Array.from(span.text).length
      const replaced = span.text.trim() === "test" ? "" : span.text.replace(/[^\s│]*[\\/]shop-api/g, SHOWN)
      const chars = Array.from(replaced.padEnd(replaced.length + length - Array.from(replaced).length))
      const fill = span.bg.a > 0 ? hex(span.bg) : base
      if (fill !== base) shapes.push(`<rect x="${col * CW}" y="${y}" width="${span.width * CW}" height="${CH}" fill="${fill}"/>`)
      const step = chars.length ? span.width / chars.length : 1
      const glyphs = chars.flatMap((ch, i) => {
        const x = (col + i * step) * CW
        const block = BLOCKS[ch]
        if (block)
          shapes.push(
            `<rect x="${x}" y="${y + block[0] * CH}" width="${CW + 0.3}" height="${block[1] * CH + 0.3}" fill="${hex(span.fg)}"/>`,
          )
        return block || ch === " " ? [] : [{ x, ch }]
      })
      if (glyphs.length) {
        const style = [
          span.attributes & 1 ? ` font-weight="bold"` : "",
          span.attributes & 2 ? ` opacity="0.6"` : "",
          span.attributes & 4 ? ` font-style="italic"` : "",
        ].join("")
        texts.push(
          `<text x="${glyphs.map((glyph) => glyph.x.toFixed(1)).join(" ")}" y="${y + CH - 5}" fill="${hex(span.fg)}"${style}>${esc(glyphs.map((glyph) => glyph.ch).join(""))}</text>`,
        )
      }
      return col + span.width
    }, 0)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" rx="10" fill="${base}"/>
<circle cx="20" cy="15" r="6" fill="#ff5f57"/><circle cx="40" cy="15" r="6" fill="#febc2e"/><circle cx="60" cy="15" r="6" fill="#28c840"/>
<text x="${width / 2}" y="20" fill="#8a8a8a" font-family="sans-serif" font-size="12" text-anchor="middle">${esc(title)}</text>
<g transform="translate(12 30)" font-family="'Cascadia Mono','JetBrains Mono',Consolas,'DejaVu Sans Mono',monospace" font-size="15">
${shapes.join("\n")}
${texts.join("\n")}
</g>
</svg>
`
}

function hex(color: { r: number; g: number; b: number }) {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

function esc(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
