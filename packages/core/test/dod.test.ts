import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { Dod } from "@opencode/core/dod"
import { tmpdir } from "./fixture/tmpdir"

const FILE = `# The plan; comments stay.
task_id: T-1
stages:
  - name: "Stage 1"
    id: L-002
leaves:
  - id: L-001
    what: "Read the protocol"
    group: "Stage 1"
    task_state: DONE
    steps:
      - "[x] read it"

  - id: L-002
    what: "Add the check"   # keep this comment
    group: "Stage 1"
    task_state: NOT_STARTED
    steps:
      - "[x] find the spot"
      - "[ ] write it"
    depends_on: [L-001]

  - id: L-003
    what: "Document it"
`

async function project(text = FILE) {
  const dir = await tmpdir()
  await mkdir(path.join(dir.path, ".opencode"), { recursive: true })
  await Bun.write(path.join(dir.path, Dod.FILE), text)
  return dir
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const fails = <A>(effect: Effect.Effect<A, Dod.DodError>) =>
  Effect.runPromise(Effect.flip(effect)).then((error) => error.message)

describe("Dod", () => {
  test("reads the items in file order with their step counts", async () => {
    await using dir = await project()
    const dod = await run(Dod.read(dir.path))
    expect(dod.items).toEqual([
      { id: "L-001", what: "Read the protocol", stage: "Stage 1", state: "DONE", done: 1, total: 1 },
      { id: "L-002", what: "Add the check", stage: "Stage 1", state: "NOT_STARTED", done: 1, total: 2 },
      { id: "L-003", what: "Document it", stage: "Ungrouped", state: "NOT_STARTED", done: 0, total: 0 },
    ])
  })

  test("a project without a DoD has no items", async () => {
    await using dir = await tmpdir()
    expect((await run(Dod.read(dir.path))).items).toEqual([])
  })

  test("taking an item edits only its owner and state lines", async () => {
    await using dir = await project()
    const dod = await run(Dod.take({ directory: dir.path, id: "L-002", owner: "Alex" }))
    expect(dod.items[1]).toMatchObject({ id: "L-002", state: "IN_PROGRESS", owner: "Alex" })
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    expect(text).toBe(
      FILE.replace(
        '    task_state: NOT_STARTED\n    steps:\n      - "[x] find',
        '    task_state: IN_PROGRESS\n    owner: "Alex"\n    steps:\n      - "[x] find',
      ),
    )
  })

  test("an item without task_state gets the owner at its end, before the blank line", async () => {
    await using dir = await project(FILE + '\n  - id: L-004\n    what: "Last"\n\n')
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: "Bo" }))
    const text = await Bun.file(path.join(dir.path, Dod.FILE)).text()
    expect(text).toContain(
      '  - id: L-003\n    what: "Document it"\n    owner: "Bo"\n    task_state: IN_PROGRESS\n\n  - id: L-004',
    )
  })

  test("someone else's or a finished item cannot be taken", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: "Alex" }))
    expect(await fails(Dod.take({ directory: dir.path, id: "L-002", owner: "Bo" }))).toBe("L-002 is taken by Alex")
    expect(await fails(Dod.take({ directory: dir.path, id: "L-001", owner: "Bo" }))).toBe("L-001 is already done")
    expect(await fails(Dod.take({ directory: dir.path, id: "L-404", owner: "Bo" }))).toBe("The DoD has no item L-404")
  })

  test("releasing gives the item back; only its owner or the host may", async () => {
    await using dir = await project()
    await run(Dod.take({ directory: dir.path, id: "L-003", owner: "Alex" }))
    expect(await fails(Dod.release({ directory: dir.path, id: "L-003", owner: "Bo" }))).toBe("L-003 is taken by Alex")
    const dod = await run(Dod.release({ directory: dir.path, id: "L-003", owner: "Alex" }))
    expect(dod.items[2]).toEqual({
      id: "L-003",
      what: "Document it",
      stage: "Ungrouped",
      state: "NOT_STARTED",
      done: 0,
      total: 0,
    })
    // Started work stays in progress for whoever picks it up next.
    await run(Dod.take({ directory: dir.path, id: "L-002", owner: "Alex" }))
    const host = await run(Dod.release({ directory: dir.path, id: "L-002" }))
    expect(host.items[1]).toEqual({
      id: "L-002",
      what: "Add the check",
      stage: "Stage 1",
      state: "IN_PROGRESS",
      done: 1,
      total: 2,
    })
    expect(await Bun.file(path.join(dir.path, Dod.FILE)).text()).not.toContain("owner:")
  })
})
