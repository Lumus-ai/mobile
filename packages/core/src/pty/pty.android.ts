import { spawn as spawnChild } from "node:child_process"
import type { Disp, Exit, Opts, Proc } from "./pty.js"

export type { Disp, Exit, Opts, Proc } from "./pty.js"

// Android PTY: nodejs-mobile cannot forkpty in-process and Android (targetSdk 29+) only
// allows exec from the app's nativeLibraryDir, so the app ships a tiny NDK bridge
// (ptywrap.c -> libptywrap.so in jniLibs) and this driver spawns it as a child process.
// The bridge owns posix_openpt/fork/TIOCSCTTY/exec; we talk to it over its stdio pipes:
// stdin = terminal input, stdout = terminal output, fd 3 = control ("R <cols> <rows>").
// When OPP_PTY_WRAPPER is unset the terminal stays honestly unavailable.
export function spawn(file: string, args: string[], opts: Opts): Proc {
  const wrapper = process.env.OPP_PTY_WRAPPER
  if (!wrapper) throw new Error("Terminals are unavailable in this Android build")
  const cols = opts.cols ?? 80
  const rows = opts.rows ?? 24
  const child = spawnChild(wrapper, [String(cols), String(rows), file, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env, TERM: opts.name ?? "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  })
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(event: Exit) => void>()
  let exited: Exit | undefined
  child.stdout!.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    for (const listener of dataListeners) listener(text)
  })
  child.on("error", () => {})
  child.on("exit", (code, signal) => {
    exited = { exitCode: code ?? 128 + (signal ? 0 : 1), signal: signal ?? undefined }
    for (const listener of exitListeners) listener(exited)
  })
  child.on("close", (code, signal) => {
    if (exited) return
    exited = { exitCode: code ?? -1, signal: signal ?? undefined }
    for (const listener of exitListeners) listener(exited)
  })
  const ctl = child.stdio[3]
  return {
    pid: child.pid ?? -1,
    onData(listener) {
      dataListeners.add(listener)
      return { dispose: () => void dataListeners.delete(listener) }
    },
    onExit(listener) {
      if (exited) { listener(exited); return { dispose: () => {} } }
      exitListeners.add(listener)
      return { dispose: () => void exitListeners.delete(listener) }
    },
    write(data) {
      if (!child.stdin!.destroyed) child.stdin!.write(data)
    },
    resize(c, r) {
      if (ctl && !(ctl as any).destroyed) (ctl as any).write(`R ${c} ${r}\n`)
    },
    kill(signal) {
      try { child.kill((signal as NodeJS.Signals) ?? "SIGHUP") } catch {}
    },
  }
}
