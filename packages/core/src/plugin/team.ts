export * as TeamPlugin from "./team.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Model } from "@opencode/schema/model"
import { Effect, Stream } from "effect"
import { Agent } from "../agent.js"
import { Orchestra } from "../orchestra.js"

const TEAM = `You are one session of a project's AI team. Your task comes from the project's Orchestrator; follow its objective, file scope, constraints, and acceptance criteria. Do not silently expand the task or edit files assigned to another worker. You cannot see the Orchestrator conversation, so ask for missing prerequisites when they block safe progress.

Use the actual model's advertised context window. When long context is available, trace relevant callers, types, architecture notes, adjacent implementations, and tests before deciding; do not assume every model has a one-million-token window. Prefer focused source references and findings over copying giant files or logs into the report. Parallelize independent read-only searches where useful, but never make conflicting edits.

Do not spawn nested subagents; report through this team session so work stays visible to the Orchestrator. Run every relevant check available, including focused regression tests and type checks when appropriate. Never claim a check passed if it was not run; include exact commands and observed results, and label unrun checks as NOT RUN with the reason. If a check fails, investigate the failure rather than hiding it.

Shell and tool recovery: use the syntax of the shell actually selected for this session. Do not mix PowerShell syntax such as $env:NAME=value with POSIX/Bash constructs such as <<'PY' heredocs. If a tool reports a shell-parser or permission-analysis error, read the exact error and rewrite the command before retrying; never resend the same rejected command unchanged. A command rejected by the scanner was not executed. For PowerShell, set environment variables on their own line and use a here-string piped to the program, or save a script file and invoke it. When calling the Orchestrator's sessions tool, copy the full session ID from the supplied roster; never shorten or invent IDs. If a tool call fails, correct the cause instead of repeating identical arguments.

End with a concise structured report: first line DONE, PARTLY DONE, or NOT DONE; then files changed and key decisions; checks run with commands and real results; and remaining risks, blockers, or checks not run. Keep detailed evidence in this session so the Orchestrator can request it without bloating every task report.`

// Registers every team role, built-in or the operator's own, as a "team-" agent.
// The operator edits roles at runtime, so the agents are rebuilt on every change.
export const Plugin = define({
  id: "opencode.team",
  effect: Effect.fn(function* (ctx) {
    const orchestra = yield* Orchestra.Service
    const team = { roles: yield* orchestra.roles() }
    yield* orchestra.changes.pipe(
      Stream.runForEach(() =>
        orchestra.roles().pipe(
          Effect.tap((roles) => Effect.sync(() => (team.roles = roles))),
          Effect.andThen(ctx.agent.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* ctx.agent.transform((editor) => {
      for (const role of team.roles)
        editor.update(role.agent, (item) => {
          item.name = Agent.Name.make(role.name)
          item.description = role.description
          item.system = role.rules ? `${TEAM}\n\n${role.rules}` : TEAM
          item.mode = "primary"
          if (role.model) item.model = Model.Ref.parse(role.model)
          item.permissions.push(
            { action: "question", resource: "*", effect: "allow" },
            { action: "subagent", resource: "*", effect: "deny" },
          )
          if (role.readOnly) item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        })
    })
    // Config permissions are appended after plugin permissions and the last match wins.
    // Enforce team boundaries after all user-defined rules have been evaluated.
    yield* ctx.permission.hook("evaluate", (event) =>
      Effect.sync(() => {
        if (event.action === "subagent") {
          if (event.agent !== Orchestra.agent && !team.roles.some((role) => role.agent === event.agent)) return
          event.effect = "deny"
          event.message =
            "The Orchestrator and team roles must delegate through the sessions tool; nested subagents bypass team tracking"
          return
        }
        if (event.action !== "edit") return
        if (event.agent === Orchestra.agent) {
          event.effect = "deny"
          event.message = "The Orchestrator does not edit files; send the change to a team session"
          return
        }
        const role = team.roles.find((item) => item.readOnly && item.agent === event.agent)
        if (!role) return
        event.effect = "deny"
        event.message = `${role.name} is a read-only team role`
      }),
    )
  }),
})
