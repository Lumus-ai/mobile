export * as Dod from "./dod.js"

import { chmod, rename, stat } from "node:fs/promises"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
import type { Room } from "@opencode/schema/room"

// The project's Definition of Done, .opencode/dod.yaml, as a room shares it. The file
// belongs to the people and AIs on the host: the oc-dod board, the lead AI and a text
// editor all write it. A room only reads its items and marks who took one, by editing
// the item's own owner and task_state lines, so comments, order and every other field
// stay exactly as their authors wrote them.
export const FILE = path.join(".opencode", "dod.yaml")

export class DodError extends Schema.TaggedError<DodError>()("Dod.Error", {
  message: Schema.String,
}) {}

const FINISHED = new Set(["DONE", "OUT_OF_SCOPE"])
const STEP = /^\s*\[(x|X)\]/
// Another writer can save between this read and this write; a few fresh tries settle it.
const ATTEMPTS = 3

const Leaf = Schema.Struct({
  id: Schema.String,
  what: Schema.String.pipe(Schema.optional),
  group: Schema.String.pipe(Schema.optional),
  task_state: Schema.String.pipe(Schema.optional),
  steps: Schema.Array(Schema.String).pipe(Schema.optional),
  owner: Schema.String.pipe(Schema.optional),
})
const decodeLeaf = Schema.decodeUnknownOption(Leaf)

// The items in file order, which is the order of the work. An empty list when the
// project has no DoD.
export const read = Effect.fn("Dod.read")(function* (directory: string) {
  const text = yield* load(directory)
  return { items: text === undefined ? [] : yield* items(text) } satisfies Room.Dod
})

// Marks the item as the owner's and in progress. Fails on an item that is finished or
// that someone else already took.
export const take = Effect.fn("Dod.take")(function* (input: { directory: string; id: string; owner: string }) {
  return yield* change(
    input.directory,
    (item) => {
      if (FINISHED.has(item.state)) return `${item.id} is already ${item.state === "DONE" ? "done" : "out of scope"}`
      if (item.owner && item.owner !== input.owner) return `${item.id} is taken by ${item.owner}`
      return { owner: input.owner, task_state: "IN_PROGRESS" }
    },
    input.id,
  )
})

// Frees the item. With an owner, only that owner's item; without one, as the host, any.
// An item nobody started goes back to NOT_STARTED; one with checked steps stays in progress.
export const release = Effect.fn("Dod.release")(function* (input: { directory: string; id: string; owner?: string }) {
  return yield* change(
    input.directory,
    (item) => {
      if (input.owner && item.owner && item.owner !== input.owner) return `${item.id} is taken by ${item.owner}`
      return {
        owner: undefined,
        task_state: item.state === "IN_PROGRESS" && item.done === 0 ? "NOT_STARTED" : item.state,
      }
    },
    input.id,
  )
})

function load(directory: string) {
  const file = Bun.file(path.join(directory, FILE))
  return Effect.promise(async () => ((await file.exists()) ? await file.text() : undefined))
}

function items(text: string) {
  return Effect.try({
    try: () => Bun.YAML.parse(text),
    catch: (error) => new DodError({ message: `dod.yaml does not parse: ${String(error)}` }),
  }).pipe(
    Effect.map((data) => {
      const leaves = Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Struct({ leaves: Schema.Array(Schema.Unknown) }))(data),
      )?.leaves
      return (leaves ?? []).flatMap((raw) =>
        Option.toArray(decodeLeaf(raw)).map((leaf): Room.DodItem => {
          const steps = leaf.steps ?? []
          return {
            id: leaf.id,
            what: leaf.what?.trim() ?? "",
            stage: leaf.group?.trim() || "Ungrouped",
            state: leaf.task_state?.trim() || "NOT_STARTED",
            done: steps.filter((step) => STEP.test(step)).length,
            total: steps.length,
            ...(leaf.owner?.trim() ? { owner: leaf.owner.trim() } : {}),
          }
        }),
      )
    }),
  )
}

// Reads the file, lets decide() refuse with a message or name the field values to write,
// and replaces the file atomically only if nobody saved it in between.
function change(
  directory: string,
  decide: (item: Room.DodItem) => string | Record<string, string | undefined>,
  id: string,
): Effect.Effect<Room.Dod, DodError> {
  const file = path.join(directory, FILE)
  const attempt = (left: number): Effect.Effect<Room.Dod, DodError> =>
    Effect.gen(function* () {
      const before = yield* load(directory)
      if (before === undefined) return yield* new DodError({ message: "This project has no DoD (.opencode/dod.yaml)" })
      const list = yield* items(before)
      const item = list.find((entry) => entry.id === id)
      if (!item) return yield* new DodError({ message: `The DoD has no item ${id}` })
      const fields = decide(item)
      if (typeof fields === "string") return yield* new DodError({ message: fields })
      const after = edit(before, id, fields)
      if (after === undefined)
        return yield* new DodError({ message: `Could not find item ${id} in dod.yaml to edit it` })
      const saved = yield* Effect.promise(async () => {
        if ((await Bun.file(file).text()) !== before) return false
        const temporary = path.join(path.dirname(file), ".dod.yaml.room.tmp")
        await Bun.write(temporary, after)
        await chmod(temporary, (await stat(file)).mode & 0o777)
        await rename(temporary, file)
        return true
      })
      if (saved) return { items: yield* items(after) }
      if (left <= 1) return yield* new DodError({ message: "dod.yaml keeps changing; try again" })
      return yield* attempt(left - 1)
    })
  return attempt(ATTEMPTS)
}

// Sets or removes top-level scalar fields of one item, touching no other line. The item is
// the sequence entry holding `id: <id>`; its keys sit at one indent, and a field missing
// there is added after task_state, or at the end of the item.
export function edit(text: string, id: string, fields: Record<string, string | undefined>) {
  const lines = text.split("\n")
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const idLine = new RegExp(`^(\\s*)(- )?id:\\s*(["']?)${escaped}\\3\\s*(#.*)?$`)
  // Other sections, such as stages or a handover, may list the same id; only leaves are items.
  const leaves = lines.findIndex((line) => /^leaves:\s*(#.*)?$/.test(line))
  const at = leaves < 0 ? -1 : lines.findIndex((line, index) => index > leaves && idLine.test(line))
  if (at < 0) return
  const match = idLine.exec(lines[at])!
  const indent = match[1].length + (match[2] ? 2 : 0)
  const dash = new RegExp(`^\\s{${indent - 2}}- `)
  const start = match[2] ? at : findLast(lines, at, (line) => dash.test(line))
  if (start < 0) return
  const after = lines.slice(start + 1).findIndex((line) => line.trim() !== "" && leading(line) < indent)
  const end = after < 0 ? lines.length : start + 1 + after
  // The item's last line with content, so a new field lands above the blank lines between items.
  const last = findLast(lines, end - 1, (line) => line.trim() !== "")
  const key = (name: string) => (line: string, index: number) =>
    (index === 0 ? line.slice(indent - 2).replace(/^- /, "") : line.slice(indent)).startsWith(`${name}:`) &&
    (index === 0 || leading(line) === indent)
  const block = lines.slice(start, end)
  const result = Object.entries(fields).reduce(
    (state, [name, value]) => {
      const index = state.block.findIndex(key(name))
      const entry = `${name}: ${name === "task_state" ? value : JSON.stringify(value)}`
      const line = `${" ".repeat(indent)}${entry}`
      // The entry's first line carries the sequence dash; removing it would merge the item into the one above.
      if (index === 0)
        return value === undefined
          ? state
          : { ...state, block: state.block.with(0, `${" ".repeat(indent - 2)}- ${entry}`) }
      if (index >= 0 && value === undefined) return { ...state, block: state.block.toSpliced(index, 1) }
      if (index >= 0) return { ...state, block: state.block.with(index, line) }
      if (value === undefined) return state
      const anchor = state.block.findIndex(key("task_state"))
      const position = anchor >= 0 ? anchor + 1 : state.last + 1
      return { block: state.block.toSpliced(position, 0, line), last: state.last + 1 }
    },
    { block, last: last - start },
  )
  return [...lines.slice(0, start), ...result.block, ...lines.slice(end)].join("\n")
}

function leading(line: string) {
  return line.length - line.trimStart().length
}

function findLast(lines: string[], from: number, test: (line: string) => boolean) {
  const index = lines
    .slice(0, from + 1)
    .toReversed()
    .findIndex(test)
  return index < 0 ? -1 : from - index
}
