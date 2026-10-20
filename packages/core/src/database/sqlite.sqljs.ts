/**
 * SQLite driver for runtimes without node:sqlite and without bun:sqlite - notably
 * nodejs-mobile (Node 18) on Android. Uses sql.js (SQLite compiled to WASM).
 *
 * Durability model: sql.js keeps the database in memory. On open we load the file bytes if
 * present; after every mutating statement we schedule a debounced export() back to the file,
 * and we flush once more when the layer's scope closes. A hard crash can lose the last
 * ~250ms of writes - accepted for the Android v1 profile; the node:sqlite driver stays the
 * default everywhere else.
 */
import { createRequire } from "node:module"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { renameSync } from "node:fs"
import { dirname } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Reactivity } from "effect/unstable/reactivity"
import { SqlClient } from "effect/unstable/sql"
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError"
import { Sqlite } from "./sqlite.js"

const TypeId = "~@opencode/core/database/SqliteSqlJs" as const

// In-memory engine: tuning pragmas and foreign-key toggles do not apply the way the native
// drivers expose them.
export const supportsTuningPragmas = false
export const supportsForeignKeyToggle = false

interface Config extends Sqlite.ClientConfig {
  readonly filename: string
  readonly readonly?: boolean
  readonly create?: boolean
  readonly readwrite?: boolean
  readonly disableWAL?: boolean
  readonly timeout?: number
  readonly allowExtension?: boolean
}

interface SqlJsStatement {
  bind(params?: ReadonlyArray<unknown>): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  get(): Array<unknown>
  free(): boolean
}
interface SqlJsDatabase {
  prepare(query: string): SqlJsStatement
  exec(query: string): unknown
  export(): Uint8Array
  close(): void
}
interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase
}

const MUTATING = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX)/i
const FLUSH_DEBOUNCE_MS = 250

const make = (options: Config) =>
  Effect.gen(function* () {
    const native = (yield* Sqlite.Native) as {
      db: SqlJsDatabase
      flush: () => void
      scheduleFlush: () => void
    }

    const collect = (query: string, params: ReadonlyArray<unknown>, arrays: boolean) => {
      const statement = native.db.prepare(query)
      try {
        statement.bind(params as unknown[])
        const rows: Array<unknown> = []
        while (statement.step()) rows.push(arrays ? statement.get() : statement.getAsObject())
        if (MUTATING.test(query)) native.scheduleFlush()
        return rows
      } finally {
        statement.free()
      }
    }

    const run = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => collect(query, params, false) as Array<Record<string, unknown>>,
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
          }),
      })

    const runValues = (query: string, params: ReadonlyArray<unknown> = []) =>
      Effect.try({
        try: () => collect(query, params, true) as ReadonlyArray<ReadonlyArray<unknown>>,
        catch: (cause) =>
          new SqlError({
            reason: classifySqliteError(cause, { message: "Failed to execute statement", operation: "execute" }),
          }),
      })

    const noExtension = (path: string) =>
      Effect.fail(
        new SqlError({
          reason: classifySqliteError(new Error(`sql.js cannot load extensions (${path})`), {
            message: "Failed to load extension",
            operation: "loadExtension",
          }),
        }),
      )

    const connection = Sqlite.makeConnection(run, runValues, { loadExtension: noExtension })

    return yield* Sqlite.makeClient(options, connection, TypeId, (acquirer) => ({
      loadExtension: (path: string) => Effect.flatMap(acquirer, () => noExtension(path)),
    }))
  })

const initSqlJs = Effect.promise(async (): Promise<SqlJsStatic> => {
  const require = createRequire(import.meta.url)
  const init = require("sql.js") as (config: { locateFile: (file: string) => string }) => Promise<SqlJsStatic>
  const wasm = require.resolve("sql.js/dist/sql-wasm.wasm")
  return init({ locateFile: () => wasm })
})

const nativeLayer = (config: Config) =>
  Layer.effect(
    Sqlite.Native,
    Effect.gen(function* () {
      const SQL = yield* initSqlJs
      const filename = config.filename
      const persistent = filename !== ":memory:"
      let bytes: Uint8Array | undefined
      if (persistent && existsSync(filename)) bytes = readFileSync(filename)
      const db = new SQL.Database(bytes)

      let timer: NodeJS.Timeout | undefined
      const flush = () => {
        if (!persistent || config.readonly) return
        const data = db.export()
        mkdirSync(dirname(filename), { recursive: true })
        const temporary = `${filename}.sqljs.tmp`
        writeFileSync(temporary, data)
        renameSync(temporary, filename)
      }
      const scheduleFlush = () => {
        if (!persistent || config.readonly) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(flush, FLUSH_DEBOUNCE_MS)
        if (typeof timer.unref === "function") timer.unref()
      }

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (timer) clearTimeout(timer)
          try {
            flush()
          } finally {
            db.close()
          }
        }),
      )
      return { db, flush, scheduleFlush }
    }),
  )

const clientLayer = (config: Config) => Layer.effect(SqlClient.SqlClient, make(config))

export const sqliteLayer = (config: Config) => {
  const native = nativeLayer(config)
  return Layer.merge(native, clientLayer(config).pipe(Layer.provide(native))).pipe(Layer.provide(Reactivity.layer))
}
