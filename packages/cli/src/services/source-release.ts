export * as SourceRelease from "./source-release"

import { $ } from "bun"
import path from "node:path"
import { parseReleaseVersion } from "./updater-action"

// Opencode++ is shared as a git checkout pinned to a release tag (release/1.2.0),
// installed by opencode-pp-install.sh or .ps1. Such a checkout updates by moving to the
// newest release tag on its origin. A checkout on a branch is a development tree: it
// only fast-forwards to its upstream, so local work is never rewritten or merged.

const PREFIX = "release/"
const checkout = path.resolve(import.meta.dir, "../../../..")

// The release this checkout is pinned to, or undefined for a development tree.
export async function current(root = checkout) {
  // Installs sit on a detached tag; a branch is a development tree even right
  // after its commit was tagged for release.
  const branch = await $`git -C ${root} symbolic-ref -q HEAD`.quiet().nothrow()
  if (branch.exitCode === 0) return undefined
  const tag = await $`git -C ${root} describe --tags --exact-match --match ${PREFIX + "*"} HEAD`
    .quiet()
    .nothrow()
    .text()
  return version(tag.trim())
}

// The newest release published on origin.
export async function latest(root = checkout) {
  const listing = await $`git -C ${root} ls-remote --tags --refs origin ${PREFIX + "*"}`.quiet().text()
  return newest(
    listing
      .split("\n")
      .map((line) => version(line.split("\t")[1]?.replace("refs/tags/", "") ?? ""))
      .filter((item): item is string => item !== undefined),
  )
}

// Moves the checkout to a release and installs its dependencies.
export async function apply(release: string, root = checkout) {
  // Without --force a release tag that moved on origin fails the fetch instead of
  // silently replacing the code this checkout already trusts.
  await $`git -C ${root} fetch --tags origin`.quiet()
  await $`git -C ${root} checkout --detach ${"refs/tags/" + PREFIX + release}`.quiet()
  // The running Bun, so the update works even when bun is not on PATH.
  // Only what the terminal app needs, as the installer does.
  await $`${process.execPath} install --frozen-lockfile --filter ./packages/cli`.cwd(root).quiet()
}

export function newest(versions: readonly string[]) {
  return versions.toSorted((a, b) => Bun.semver.order(b, a))[0]
}

function version(tag: string) {
  if (!tag.startsWith(PREFIX)) return undefined
  const value = tag.slice(PREFIX.length)
  return parseReleaseVersion(value) ? value : undefined
}

export type Branch =
  | { readonly type: "behind"; readonly name: string; readonly behind: number }
  | { readonly type: "current" }
  | { readonly type: "diverged" }
  | { readonly type: "no-upstream" }

// Where the development branch stands against its upstream after a fetch, or
// undefined when the checkout is not on a branch.
export async function branch(root = checkout): Promise<Branch | undefined> {
  const name = (await $`git -C ${root} symbolic-ref -q --short HEAD`.quiet().nothrow().text()).trim()
  if (!name) return undefined
  const upstream = await $`git -C ${root} rev-parse --abbrev-ref --symbolic-full-name @{u}`.quiet().nothrow()
  if (upstream.exitCode !== 0) return { type: "no-upstream" }
  await $`git -C ${root} fetch --quiet ${upstream.text().trim().split("/")[0]!}`.quiet()
  const [ahead, behind] = (await $`git -C ${root} rev-list --left-right --count HEAD...@{u}`.quiet().text())
    .trim()
    .split(/\s+/)
    .map(Number)
  if (!behind) return { type: "current" }
  if (ahead) return { type: "diverged" }
  return { type: "behind", name, behind }
}

// Fast-forwards the branch to its upstream and installs what the new code needs.
// Uncommitted edits stay; git refuses the merge if the incoming commits touch them.
export async function pull(root = checkout) {
  await $`git -C ${root} merge --ff-only @{u}`.quiet()
  await $`${process.execPath} install`.cwd(root).quiet()
}
