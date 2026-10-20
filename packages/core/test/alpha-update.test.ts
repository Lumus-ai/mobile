import { describe, expect, test } from "bun:test"
import { alphaUpdateURL, describeAlphaUpdate, runAlphaUpdate } from "../../app/src/shell/alpha-update"

describe("alpha /update command", () => {
  test("reports up to date", () => {
    const notice = describeAlphaUpdate(200, '{"status":"up-to-date","installed":26102105,"channel":26102105}')
    expect(notice.variant).toBe("success")
    expect(notice.title).toBe("Already up to date")
  })
  test("reports a downloaded update and asks to confirm the install", () => {
    const notice = describeAlphaUpdate(200, '{"status":"installing","installed":26102104,"channel":26102105}')
    expect(notice.variant).toBe("success")
    expect(notice.title).toContain("26102105")
    expect(notice.description).toContain("installer")
  })
  test("surfaces the updater error instead of hiding it", () => {
    const notice = describeAlphaUpdate(500, '{"status":"error","message":"sha256 mismatch"}')
    expect(notice).toMatchObject({ variant: "error", description: "sha256 mismatch" })
  })
  test("explains it is alpha-only when the local updater is unreachable", async () => {
    const calls: string[] = []
    const notice = await runAlphaUpdate((async (url: string) => {
      calls.push(url)
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch)
    expect(calls).toEqual([alphaUpdateURL])
    expect(notice.variant).toBe("error")
    expect(notice.description).toContain("alpha")
  })
  test("posts to the loopback updater only", async () => {
    let seen: { url?: string; method?: string } = {}
    await runAlphaUpdate((async (url: string, init?: RequestInit) => {
      seen = { url, method: init?.method }
      return new Response('{"status":"up-to-date","installed":1,"channel":1}', { status: 200 })
    }) as unknown as typeof fetch)
    expect(seen).toEqual({ url: "http://127.0.0.1:4198/alpha/update", method: "POST" })
  })
})
