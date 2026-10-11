import { spawnSync } from "node:child_process"

declare const OPENCODE_VERSION: string
declare const OPENCODE_CHANNEL: string
declare const OPENCODE_ARTIFACT: string

// A dev checkout run straight from source (bun src/index.ts) has no compile-time define,
// so the version would fall back to "local" and the opencode.ai free tier would reject the
// client as below 1.18.0. Resolve the tagged release like the build script does, and fall
// back to a known-good floor when there is no tag or git is unavailable.
const MINIMUM_ANNOUNCED_VERSION = "1.18.0"
const FALLBACK_VERSION = "2.0.0"

function gitTagVersion(): string | undefined {
  try {
    const out = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (out.status !== 0) return undefined
    const tag = out.stdout.trim().replace(/^v/, "")
    const match = tag.match(/^\d+\.\d+\.\d+/)
    if (!match) return undefined
    return match[0]
  } catch {
    return undefined
  }
}

const version = (() => {
  if (typeof OPENCODE_VERSION === "string" && OPENCODE_VERSION !== "undefined") return OPENCODE_VERSION
  const tag = gitTagVersion()
  if (tag) {
    const [major, minor] = tag.split(".").map(Number)
    if (major > 1 || (major === 1 && minor >= 18)) return tag
  }
  return FALLBACK_VERSION
})()
const channel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
const artifact = typeof OPENCODE_ARTIFACT === "string" ? OPENCODE_ARTIFACT : "cli"

export { version as OPENCODE_VERSION, channel as OPENCODE_CHANNEL, artifact as OPENCODE_ARTIFACT }
export const OPENCODE_LOCAL = channel === "local"
