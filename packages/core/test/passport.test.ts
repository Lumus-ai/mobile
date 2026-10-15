import { describe, expect, test } from "bun:test"
import { Passport } from "@opencode/core/passport"
import { tmpdir } from "./fixture/tmpdir"

describe.skipIf(process.platform === "win32")("Passport.run", () => {
  test("returns when the command exits although it left a child in the background", async () => {
    await using dir = await tmpdir()
    const started = Date.now()
    const result = await Passport.run("echo hi; sleep 30 &", dir.path)
    expect(result.output.trim()).toBe("hi")
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("an abort stops the command and everything it started", async () => {
    await using dir = await tmpdir()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    await Passport.run("sleep 30 & sleep 30", dir.path, controller.signal)
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
