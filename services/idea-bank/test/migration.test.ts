import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

const initial = await readFile(new URL("../migrations/0001_init.sql", import.meta.url), "utf8")
const upgrade = await readFile(new URL("../migrations/0002_global_search_signals.sql", import.meta.url), "utf8")

describe("Global Idea Bank D1 migrations", () => {
  it("applies cleanly in order and creates every column used by the worker", () => {
    const db = new Database(":memory:")
    try {
      db.exec(initial)
      const originalColumns = (db.query("PRAGMA table_info(ideas)").all() as { name: string }[]).map((item) => item.name)
      expect(originalColumns).toContain("content_hash")
      expect(originalColumns).not.toContain("search_text")

      db.exec(upgrade)
      const columns = (db.query("PRAGMA table_info(ideas)").all() as { name: string }[]).map((item) => item.name)
      expect(columns).toContain("signal_count")
      expect(columns).toContain("search_text")
      expect(columns).toContain("reviewed_at")

      const quotaTable = db
        .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get("submission_rate_limits") as { name: string } | null
      expect(quotaTable?.name).toBe("submission_rate_limits")
    } finally {
      db.close()
    }
  })

  it("backfills seed ideas for search and starts each with one catalogue signal", () => {
    const db = new Database(":memory:")
    try {
      db.exec(initial)
      db.exec(upgrade)
      const seed = db
        .query("SELECT title, summary, signal_count, search_text FROM ideas WHERE id = ?")
        .get("seed-game-localization") as {
          title: string
          summary: string
          signal_count: number
          search_text: string
        }
      expect(seed.signal_count).toBe(1)
      expect(seed.search_text).toContain("translation")
      expect(seed.search_text).toContain(seed.title.toLowerCase())
      expect(seed.search_text).toContain(seed.summary.toLowerCase())
    } finally {
      db.close()
    }
  })

  it("enforces the contribution quota schema", () => {
    const db = new Database(":memory:")
    try {
      db.exec(initial)
      db.exec(upgrade)
      db.query("INSERT INTO submission_rate_limits (submitter_hash, window_start, count) VALUES (?, ?, ?)")
        .run("hashed-address", 20000, 5)
      expect(() =>
        db.query("INSERT INTO submission_rate_limits (submitter_hash, window_start, count) VALUES (?, ?, ?)")
          .run("over-limit", 20000, 6),
      ).toThrow()
    } finally {
      db.close()
    }
  })
})
