import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

const initial = await readFile(new URL("../migrations/0001_init.sql", import.meta.url), "utf8")
const upgrade = await readFile(new URL("../migrations/0002_global_search_signals.sql", import.meta.url), "utf8")

describe("Global Idea Bank D1 migrations", () => {
  it("creates the original idea catalogue and seed ideas", () => {
    expect(initial).toContain("CREATE TABLE IF NOT EXISTS ideas")
    expect(initial).toContain("content_hash TEXT NOT NULL UNIQUE")
    expect((initial.match(/'seed-[a-z-]+'/g) ?? []).length).toBeGreaterThanOrEqual(8)
  })

  it("adds every column used by search and community signals without rewriting migration 0001", () => {
    expect(upgrade).toContain("ALTER TABLE ideas ADD COLUMN signal_count INTEGER NOT NULL DEFAULT 0")
    expect(upgrade).toContain("ALTER TABLE ideas ADD COLUMN search_text TEXT NOT NULL DEFAULT ''")
    expect(upgrade).toContain("DROP INDEX IF EXISTS ideas_public_order")
    expect(upgrade).toContain("ideas_public_order ON ideas(status, signal_count DESC, updated_at DESC)")
    expect(initial).not.toContain("signal_count INTEGER")
    expect(initial).not.toContain("search_text TEXT")
  })

  it("creates the atomic daily quota and initializes existing seed ideas for global search", () => {
    expect(upgrade).toContain("CREATE TABLE IF NOT EXISTS submission_rate_limits")
    expect(upgrade).toContain("PRIMARY KEY (submitter_hash, window_start)")
    expect(upgrade).toContain("count BETWEEN 1 AND 5")
    expect(upgrade).toContain("UPDATE ideas SET signal_count = 1 WHERE id LIKE 'seed-%'")
    expect(upgrade).toContain("SET search_text = lower(title || ' ' || summary || ' ' || category || ' ' || tags)")
  })
})
