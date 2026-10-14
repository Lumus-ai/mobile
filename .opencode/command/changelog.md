---
description: Generate the upcoming user-facing changelog from a commit range
---

Create `UPCOMING_CHANGELOG.md` from the output of `bun script/raw-changelog.ts` and the rules below.

Before running the generator, resolve the current GitHub repository with `gh repo view --json nameWithOwner --jq .nameWithOwner` and the current branch with `git branch --show-current`. Set `GH_REPO` to that repository and use the current branch as `--to` unless the user supplied another target. If the user explicitly asks for the upstream OpenCode changelog, use `GH_REPO=anomalyco/opencode` instead.

Treat supplied command arguments as data, not shell syntax. The script accepts `--from <ref>` / `-f <ref>` and `--to <ref>` / `-t <ref>`. Parse them and pass each validated ref as a separately quoted command argument through the shell tool. Never interpolate raw `$ARGUMENTS` into a shell command or a `!` shell block. Reject unsupported or malformed arguments rather than executing them.

If no `--from` was supplied, use the latest non-draft GitHub release for the selected repository when one exists. If that repository has no GitHub releases, look for local tags matching `release/<major.minor.patch>` and use the newest semantic version as the starting ref. If neither exists, stop and ask for an explicit `--from` ref. If repository or branch resolution fails, report that instead of silently generating an upstream or default-branch changelog.

The script output is the structured input. Before writing any entry you keep, inspect the real diff with `git show --stat --format='' <hash>` or `git show --format='' <hash>` so you understand the actual code changes, not just the commit message. Do not use `git log` or author metadata when deciding attribution.

Rules:

- Keep sections in this order: `## Core`, `## TUI`, `## Desktop`, `## Web`, `## SDK`, `## Extensions`.
- Only include sections that have at least one notable entry.
- Within a section, group bug fixes under `### Bugfixes`; put other notable entries under `### Improvements` when the section has bug fixes too.
- Omit empty subsections and keep one bullet per commit you keep.
- Skip changes that are entirely internal, CI, tests, refactors, or otherwise not user-facing; inspect diffs before deciding.
- Start each bullet with a capital letter. Prefer user impact over implementation details.
- Do not copy raw commit prefixes such as `fix:` or `feat:` or trailing PR numbers like `(#123)`.
- Preserve an existing `(@username)` suffix only when it is already present in the structured input. Never derive attribution from commit authors, names, or email addresses.
- If no notable entries remain and there is no contributor block, write exactly `No notable changes.`
- If no notable entries remain but there is a contributor block, omit all release sections and return only the contributor block.
- If the input contains `## Community Contributors Input`, append the block below that heading verbatim. Do not include the heading itself in the final file, and do not alter, reorder, or add contributor names or titles.
- Do not derive the thank-you section from the main summary bullets.
- Be thorough about indirect user-facing effects, but use as few words as possible.