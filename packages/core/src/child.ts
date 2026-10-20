export * as Child from "./child.js"

import { spawn } from "node:child_process"

export interface Options {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly detached?: boolean
}

export interface Proc {
  readonly pid: number
  readonly stdout: Promise<string>
  readonly stderr: Promise<string>
  readonly exited: Promise<number>
  readonly kill: () => void
}

/**
 * The slice of Bun.spawn the codebase uses, over node:child_process so the same call sites run
 * under any Node-compatible runtime. Streams are always piped and stdin stays closed.
 */
export function piped(argv: readonly string[], options: Options = {}): Proc {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: options.detached ?? false,
    windowsHide: true,
  })
  const read = (stream: NodeJS.ReadableStream | null) =>
    new Promise<string>((resolve) => {
      if (!stream) return resolve("")
      const chunks: Buffer[] = []
      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
      stream.on("error", () => resolve(Buffer.concat(chunks).toString("utf8")))
    })
  const exited = new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1))
    child.on("error", () => resolve(1))
  })
  return {
    pid: child.pid ?? -1,
    stdout: read(child.stdout),
    stderr: read(child.stderr),
    exited,
    kill: () => {
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    },
  }
}
