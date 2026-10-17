import type { Proc } from "./pty.js"

export type { Disp, Exit, Opts, Proc } from "./pty.js"

// The Android v1 profile ships no PTY: spawning needs binaries the sandbox cannot execute
// from app-private storage (targetSdk 29+). A later profile executes a bundled NDK shim from
// the app's native library directory, where Android does allow exec.
export function spawn(): Proc {
  throw new Error("Terminals are unavailable in this Android build")
}
