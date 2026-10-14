import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

const migration = await readFile(new URL("../migrations/0001_init.sql", import.meta.url), "utf8")

describe("Global Idea Bank D1 migration", () => {
  it("creates every column used by the Worker API", () => {
    expect(migration).toContain("signal_count INTEGER NOT NULL DEFAULT 0")
    expect(migration).toContain("search_text TEXT NOT NULL DEFAULT ''")
    expect(migration).toContain("content_hash TEXT NOT NULL UNIQUE")
  })

  it("creates the atomic daily submission quota table", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS submission_rate_limits")
    expect(migration).toContain("PRIMARY KEY (submitter_hash, window_start)")
    expect(migration).toContain("count BETWEEN 1 AND 5")
  })

  it("makes the seeded ideas searchable and visible in popularity ordering", () => {
    expect(migration).toContain("ideas_public_order ON ideas(status, signal_count DESC, updated_at DESC)")
    expect(migration).toContain("UPDATE ideas SET signal_count = 1 WHERE id LIKE 'seed-%'")
    expect(migration).toContain("SET search_text = lower(title || ' ' || summary || ' ' || category || ' ' || tags)")
    expect((migration.match(/'seed-[a-z-]+'/g) ?? []).length).toBeGreaterThanOrEqual(8)
  })
})
