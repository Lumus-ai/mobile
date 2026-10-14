export * as SkillCatalogTool from "./skill-catalog.js"

import { ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { Mcp } from "../../mcp/index.js"
import { Permission } from "../../permission.js"
import { McpTool } from "../mcp.js"

export const name = "skill_catalog"

/** The MCP server this wrapper is the single native path to. */
export const server = "skillsmp"

/**
 * Marketplace hits are metadata, not instructions: the cap keeps a broad query from filling
 * the context before the model has chosen one skill. The server allows 50, the tool does not.
 */
export const MAX_RESULTS = 10
const DEFAULT_RESULTS = 5
/** A cold marketplace query plus a dead oc-mcp-hub can wait forever; past this the model gets a refusal. */
const CALL_TIMEOUT = "20 seconds"
const DESCRIPTION_LIMIT = 200
/** Nothing the model reads from a catalog hit needs more text than this. */
const RAW_LIMIT = 4000

export const description = [
  "Search the SkillsMP marketplace for ready-made agent skills, and read one skill's details.",
  "",
  "Use the skill tool for skills already installed on this machine; use this one when nothing local fits the task and a published skill might.",
  "",
  "Actions:",
  `  search — find skills by words in query (required), up to ${MAX_RESULTS} results (${DEFAULT_RESULTS} by default); narrow with category or language, and order by stars or recent.`,
  "  get — full details of one skill, including its GitHub URL, by the bare name from a search row in id (required). The bare name and owner/name both resolve; the SkillsMP page slug does not.",
  "",
  "A hit is metadata only. Installing a skill is the user's decision: report what you found and let them choose.",
  "",
  `Permission: each call is checked under the proxied MCP tool name (${McpTool.name(server, "search_skills")}, ${McpTool.name(server, "get_skill")}), the same name a deny rule aimed at that server already uses, and under ${name}.`,
].join("\n")

export const Input = Schema.Struct({
  action: Schema.Literals(["search", "get"]).annotate({
    description: "Search the marketplace for skills, or read the details of one found skill",
  }),
  query: Schema.optionalKey(Schema.String).annotate({
    description: "A few words naming the task, for search",
  }),
  id: Schema.optionalKey(Schema.String).annotate({
    description: "Exact skill name or slug from a search result, for get",
  }),
  limit: Schema.optionalKey(Schema.Number).annotate({
    description: `How many results search returns, 1 to ${MAX_RESULTS}`,
  }),
  category: Schema.optionalKey(Schema.String).annotate({
    description: "Category slug for search, for example data-ai, devops, web-development",
  }),
  language: Schema.optionalKey(Schema.String).annotate({
    description: "Content language code for search, for example en, zh, ja, ru",
  }),
  sort: Schema.optionalKey(Schema.Literals(["stars", "recent"])).annotate({
    description: "Result order for search, most starred first by default",
  }),
})
export type Input = typeof Input.Type

const Skill = Schema.Struct({
  name: Schema.String,
  stars: Schema.optionalKey(Schema.Number),
  description: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
})

export const Output = Schema.Struct({
  output: Schema.String,
  action: Schema.Literals(["search", "get"]),
  reported: Schema.optionalKey(Schema.Number),
  skills: Schema.optionalKey(Schema.Array(Skill)),
  truncated: Schema.optionalKey(Schema.Boolean),
})
export type Output = typeof Output.Type

/** Which proxied call an input means, with the arguments narrowed to what the server accepts. */
type Call = {
  readonly tool: "search_skills" | "get_skill"
  readonly args: Record<string, unknown>
  /** Permission resource: the proxied tool, not `*` as the generic MCP tool asserts. */
  readonly resource: string
}

/** One search row as the server prints it: `1. **name** ⭐12` then indented description and links. */
const ROW = /^(\d+)\.\s+\*\*(.+?)\*\*(?:\s*⭐\s*(\d+))?$/
const LINK = /^(?:GitHub|SkillsMP):\s*(\S+)$/
/**
 * The count in the header is how many skills came back on this page, not how many the catalog
 * holds: the live server answered `Found 5 skills` for limit 5, `Found 2` for limit 2 and
 * `Found 50` for limit 60, which is the most it will ever return. Reading it as a catalog total
 * would tell the model a number the server never claimed.
 */
const HEAD = /^Found\s+(\d+)\s+skills for '([^']*)'\s+\(page\s+(\d+)\)/
const EMPTY = "The skill catalog returned no text."

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1)}…`)

const call = (input: Input): Effect.Effect<Call, ToolFailure> => {
  if (input.action === "get") {
    if (input.id === undefined)
      return Effect.fail(new ToolFailure({ message: "skill_catalog get needs id: the skill name from a search" }))
    return Effect.succeed({ tool: "get_skill", args: { id: input.id }, resource: "get_skill" })
  }
  // A blank query is refused here rather than forwarded: the server answers one in well under a
  // second with `API error 400: {"code":"MISSING_QUERY"}` for an empty string and
  // `INVALID_QUERY` for whitespace, both with isError:false. Without this guard the model would
  // read the upstream's rejection of the query as the catalog's answer.
  if (input.query === undefined || input.query.trim() === "")
    return Effect.fail(new ToolFailure({ message: "skill_catalog search needs query: a few words naming the task" }))
  const wanted = typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : DEFAULT_RESULTS
  return Effect.succeed({
    tool: "search_skills",
    args: {
      query: input.query,
      limit: Math.min(Math.max(Math.round(wanted), 1), MAX_RESULTS),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.language === undefined ? {} : { language: input.language }),
      ...(input.sort === undefined ? {} : { sort_by: input.sort }),
    },
    resource: "search_skills",
  })
}

const parseRow = (block: string) => {
  const [head = "", ...rest] = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const found = ROW.exec(head)
  if (found === null) return undefined
  const link = rest.map((line) => LINK.exec(line)).find((match) => match !== null)
  const summary = rest.find((line) => !LINK.test(line))
  return {
    name: found[2],
    ...(found[3] === undefined ? {} : { stars: Number(found[3]) }),
    ...(summary === undefined ? {} : { description: clip(summary, DESCRIPTION_LIMIT) }),
    ...(link === null || link === undefined ? {} : { url: link[1] }),
  }
}

/**
 * The server answers in markdown this parser knows. When a future version of it prints
 * something else, the raw text is still bounded and handed on rather than dropped.
 */
const searched = (text: string): Output => {
  const header = HEAD.exec(text)
  const reported = Number(header?.[1] ?? Number.NaN)
  const page = Number(header?.[3] ?? Number.NaN)
  const skills = text
    .split(/\n{2,}/)
    .flatMap((block) => {
      const row = parseRow(block)
      return row ? [row] : []
    })
    .slice(0, MAX_RESULTS)
  // A header with no rows is an empty catalog answer, not a format the parser missed: the live
  // server prints exactly `Found 0 skills for 'x' (page 1):` for a query nothing matches.
  if (skills.length === 0 && !Number.isFinite(reported))
    return { output: clip(text || EMPTY, RAW_LIMIT), action: "search" }
  return {
    action: "search",
    ...(Number.isFinite(reported) ? { reported } : {}),
    skills,
    output: [
      `Found ${skills.length} skill${skills.length === 1 ? "" : "s"}${Number.isFinite(page) ? ` on page ${page}` : ""}:`,
      ...skills.map((skill) =>
        [
          `- ${skill.name}${skill.stars === undefined ? "" : ` (${skill.stars} stars)`}`,
          ...(skill.description === undefined ? [] : [`  ${skill.description}`]),
          ...(skill.url === undefined ? [] : [`  ${skill.url}`]),
        ].join("\n"),
      ),
    ].join("\n"),
  }
}

/**
 * The server reports some failures as a successful answer whose body is the failure: with
 * isError:false it answered `No skill found matching 'x'` on a miss, `API error 400 …` on a
 * rejected query and `API error 429 …` once the daily quota was spent. Handed on as a result,
 * the model reads "this skill does not exist" off an upstream refusal, so these bodies become
 * refusals before anything is parsed. Its own read timeout is the one failure left out: it
 * took 30.8s, 31.1s, 32.0s and 31.4s on four live calls, every one of them past CALL_TIMEOUT,
 * so this leaf's own ceiling answers first and the body never reaches here.
 */
const NOT_FOUND = /^No skill found/
const UPSTREAM_ERROR = /^API error \d+:/

const bodyFailure = (answer: string): ToolFailure | undefined => {
  if (NOT_FOUND.test(answer))
    return new ToolFailure({
      message: `The ${server} catalog has no skill with that id. Use an id from a search result, or search again with other words.`,
    })
  if (UPSTREAM_ERROR.test(answer))
    return new ToolFailure({
      message: `The ${server} server refused the call: ${clip(answer.split("\n")[0] ?? "", DESCRIPTION_LIMIT)}. That is an upstream failure and not a missing skill, so do not report the skill as absent.`,
    })
  return undefined
}

const detailed = (text: string): Output => {
  const clipped = text.length > RAW_LIMIT
  return { action: "get", output: clip(text || EMPTY, RAW_LIMIT), ...(clipped ? { truncated: true } : {}) }
}

const text = (result: Mcp.ToolResult) =>
  result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

/**
 * The registry accepts only its own `Tool.Error`. A permission failure arrives typed and
 * becomes one, while a plain decline raised as a defect and interruption stay untouched.
 * Exported so the feedback contract below is checkable without reaching the model.
 */
export const failed = (error: unknown) => {
  if (error instanceof ToolFailure) return error
  // A decline carrying feedback has an empty `message` by design, so without this branch the
  // model would read "Skill catalog call failed: " and never learn what it got wrong.
  if (error instanceof Permission.CorrectedError) return new ToolFailure({ message: error.feedback, error })
  const message = error instanceof Error ? error.message : String(error)
  return new ToolFailure({ message: `Skill catalog call failed: ${message}`, error })
}

export const Plugin = {
  id: "opencode.tool.skill_catalog",
  effect: Effect.fn("SkillCatalogTool.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service

    const authorize = Effect.fn("SkillCatalogTool.authorize")(function* (
      context: Tool.Context,
      action: string,
      resource: string,
    ) {
      // `save` is what turns the prompt into a lasting rule: without it the dialog offers only
      // once/reject (tui/src/routes/session/permission.tsx:233) and `Permission.reply` drops an
      // "always" on the floor (core/src/permission.ts:303). The proxied MCP tool saves "*";
      // this wrapper saves the one tool it is about to call, which is narrower and enough to
      // silence both of this call's prompts for good.
      yield* permission.assert({
        action,
        resources: [resource],
        save: [resource],
        metadata: {},
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const target = yield* call(input)
              // Two rule surfaces, one check each. The canonical MCP name is asserted first:
              // it is the name a deny rule for this server already carries, so a denial there
              // stops the call before anything else is asked of the user.
              yield* authorize(context, McpTool.name(server, target.tool), target.resource)
              yield* authorize(context, name, target.resource)
              const result = yield* mcp
                .callTool({ server, name: target.tool, args: target.args, sessionID: context.sessionID })
                .pipe(
                  Effect.timeout(CALL_TIMEOUT),
                  Effect.catchTags({
                    "MCP.NotFoundError": (error) =>
                      new ToolFailure({
                        message: `MCP server "${error.server}" is not configured, so there is no skill catalog to search. Enable the ${server} server in opencode.json.`,
                      }),
                    "MCP.ToolCallError": (error) => new ToolFailure({ message: error.message }),
                    TimeoutError: () =>
                      new ToolFailure({
                        message: `The ${server} server did not answer within ${CALL_TIMEOUT}. It is most likely offline; use the skill tool or search the web instead.`,
                      }),
                  }),
                )
              if (result.isError)
                return yield* new ToolFailure({ message: text(result).trim() || "The skill catalog returned an error" })
              const answer = text(result)
              const refusal = bodyFailure(answer)
              if (refusal !== undefined) return yield* refusal
              return input.action === "search" ? searched(answer) : detailed(answer)
              // Permission declines and interruptions stay typed: this leaf never converts them.
            }).pipe(
              Effect.map((output) => ({ output, content: output.output })),
              Effect.mapError(failed),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
