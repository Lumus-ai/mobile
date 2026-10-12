export * as HubState from "./state.js"

import path from "path"
import fs from "fs/promises"
import { Option, Schema } from "effect"
import { Path } from "@opencode/util/global"

const StateSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Record(Schema.String, Schema.Boolean),
  // The terminal hub commands run in; absent means the first installed of nu, pwsh, bash.
  terminal: Schema.optional(Schema.Literals(["bash", "nu", "pwsh"])),
})

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(StateSchema))

export type State = Schema.Schema.Type<typeof StateSchema>

export type Options = {
  // Tests inject their own directory; production falls back to the Global state directory.
  readonly directory?: string
}

// Atomic rename protects a single write from partial content, but concurrent
// read-modify-writes can still start from the same snapshot and overwrite one another.
const pendingWrites = new Map<string, Promise<void>>()

// A missing, unreadable, or foreign-shaped file means "nothing enabled": the hub is
// opt-in, so a broken state file must degrade to an empty prompt block, not fail.
export async function read(options: Options = {}): Promise<State> {
  const text = await fs.readFile(file(options), "utf8").catch(() => undefined)
  if (text === undefined) return { version: 1, enabled: {} }
  return Option.getOrElse(decodeState(text), () => ({ version: 1, enabled: {} }))
}

export function setEnabled(id: string, enabled: boolean, options: Options = {}): Promise<void> {
  return setEnabledMany([id], enabled, options)
}

export function setEnabledMany(ids: readonly string[], enabled: boolean, options: Options = {}): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return update(options, (state) => ({
    ...state,
    enabled: { ...state.enabled, ...Object.fromEntries(ids.map((id) => [id, enabled])) },
  }))
}

export function setTerminal(terminal: NonNullable<State["terminal"]>, options: Options = {}): Promise<void> {
  return update(options, (state) => ({ ...state, terminal }))
}

function update(options: Options, change: (state: State) => State): Promise<void> {
  const key = path.resolve(file(options))
  const previous = pendingWrites.get(key) ?? Promise.resolve()
  const operation = previous.then(async () => {
    const state = await read(options)
    await write(change(state), options)
  })
  const settled = operation.then(() => undefined, () => undefined)
  pendingWrites.set(key, settled)
  void settled.then(() => {
    if (pendingWrites.get(key) === settled) pendingWrites.delete(key)
  })
  return operation
}

async function write(next: State, options: Options) {
  const destination = file(options)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`
  // temp+rename in the same directory: a crash between write and rename leaves the previous
  // file intact, whereas a half-written hub.json would read back as "nothing enabled".
  await fs.writeFile(temporary, JSON.stringify(next, null, 2)).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await fs.rename(temporary, destination).catch(async (error) => {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}

const file = (options: Options) => path.join(options.directory ?? Path.state, "hub.json")
