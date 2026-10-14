import { describe, expect, test } from "bun:test"
import { ToolFailure } from "@opencode/ai"
import { Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { Session } from "@opencode/core/session"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable } from "@opencode/core/session/sql"
import { SkillCatalogTool } from "@opencode/core/tool/plugin/skill-catalog"
import { McpTool } from "@opencode/core/tool/mcp"
import { Tool } from "@opencode/core/tool"
import { AbsolutePath } from "@opencode/core/schema"
import { location } from "./fixture/location"
import { it } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { codeModeListings, executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_skill_catalog_test")

/**
 * Verbatim answers from the live server on 2026-10-14, read back over JSON-RPC from
 * `http://127.0.0.1:5100/skillsmp/mcp` (`tools/call` on `search_skills` / `get_skill`). They are
 * public marketplace listings: the skills, their descriptions and their GitHub URLs are what the
 * server hands any caller, and nothing private was in the transcript they were taken from.
 */
const SEARCH_TEXT = [
  "Found 5 skills for 'pdf' (page 1):",
  "",
  "1. **nano-pdf** ⭐391533",
  "   Edit PDFs with natural-language instructions using the nano-pdf CLI.",
  "   GitHub: https://github.com/openclaw/openclaw/tree/main/skills/nano-pdf",
  "   SkillsMP: https://skillsmp.com/creators/openclaw/openclaw/skills-nano-pdf",
  "",
  "2. **summarize** ⭐391533",
  "   Summarize or transcribe URLs, YouTube/videos, podcasts, articles, transcripts, PDFs, and local files.",
  "   GitHub: https://github.com/openclaw/openclaw/tree/main/skills/summarize",
  "   SkillsMP: https://skillsmp.com/creators/openclaw/openclaw/skills-summarize",
  "",
  "3. **visa-doc-translate** ⭐276549",
  "   ビザ申請書類（画像）を英語に翻訳し、原文と翻訳を含むバイリンガルPDFを作成する",
  "   GitHub: https://github.com/affaan-m/ECC/tree/main/docs/ja-JP/skills/visa-doc-translate",
  "   SkillsMP: https://skillsmp.com/creators/affaan-m/ecc/docs-ja-jp-skills-visa-doc-translate",
  "",
  "4. **visa-doc-translate** ⭐276549",
  "   将签证申请文件（图片）翻译成英文，并创建包含原文和译文的双语PDF",
  "   GitHub: https://github.com/affaan-m/ECC/tree/main/docs/zh-CN/skills/visa-doc-translate",
  "   SkillsMP: https://skillsmp.com/creators/affaan-m/ecc/docs-zh-cn-skills-visa-doc-translate",
  "",
  "5. **nutrient-document-processing** ⭐276549",
  "   使用Nutrient DWS API处理、转换、OCR识别、提取、编辑、签名和填写文档。支持PDF、DOCX、XLSX、PPTX、HTML和图像格式。",
  "   GitHub: https://github.com/affaan-m/ECC/tree/main/docs/zh-CN/skills/nutrient-document-processing",
  "   SkillsMP: https://skillsmp.com/creators/affaan-m/ecc/docs-zh-cn-skills-nutrient-document-processing",
  "",
].join("\n")

/** The live header for a query nothing matches: a parseable header and no rows at all. */
const EMPTY_TEXT = "Found 0 skills for 'zzzqqqnosuchskillzzz' (page 1):\n"

const GET_TEXT = [
  "## nano-pdf",
  "",
  "**Description:** Edit PDFs with natural-language instructions using the nano-pdf CLI.",
  "",
  "**Author:** openclaw",
  "**Language:** en",
  "**Stars:** ⭐391533",
  "**GitHub:** https://github.com/openclaw/openclaw/tree/main/skills/nano-pdf",
  "**SkillsMP:** https://skillsmp.com/creators/openclaw/openclaw/skills-nano-pdf",
].join("\n")

/**
 * Failures the server reports as a successful answer: live bodies with isError:false, read back
 * over JSON-RPC. The first is a miss, the second is the upstream refusing the call outright.
 */
const NOT_FOUND_TEXT = "No skill found matching 'nano-pdf-does-not-exist'"
const UPSTREAM_ERROR_TEXT =
  'API error 429: {"success":false,"error":{"code":"DAILY_QUOTA_EXCEEDED","message":"Daily API quota of 50 requests exceeded. Resets at midnight UTC. Sign up and use an API key for a higher quota (500/day)."}}'

type Call = { server: string; name: string; args: Record<string, unknown> }

/** What the harness reports back: what reached the server, what was asked, what was offered to save. */
type Seen = { calls: Call[]; asked: string[]; saves: string[] }

const seen = (): Seen => ({ calls: [], asked: [], saves: [] })

const grant = (input: { action: string; resources: readonly string[]; save?: readonly string[] }) => {
  return `${input.action}:${(input.save ?? []).join(",")}`
}

const answer = (value: string, isError = false) =>
  ({
    server: Mcp.ServerName.make(SkillCatalogTool.server),
    tool: "search_skills",
    isError,
    content: [{ type: "text" as const, text: value }],
  }) satisfies Mcp.ToolResult

/** How the permission edge refuses, which is the difference the model ends up reading. */
type Refusal = "blocked" | "corrected"

/**
 * The tool against the real registry with only the two edges it owns replaced: the MCP
 * service it proxies through and the permission it asks. Everything else is production code.
 */
function harness(
  reply: (call: Call) => Effect.Effect<Mcp.ToolResult, Mcp.NotFoundError | Mcp.ToolCallError>,
  report: Seen,
  refusal?: Refusal,
) {
  return AppNodeBuilder.build(
    LayerNode.group([
      Tool.node,
      makeLocationNode({
        name: "test/skill-catalog-plugin",
        layer: Layer.effectDiscard(registerToolPlugin(SkillCatalogTool.Plugin)),
        deps: [Tool.node, Mcp.node, Permission.node],
      }),
      Mcp.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(process.cwd()) }))),
      ),
      Permission.node.replace(
        refusal === undefined
          ? permissionLayer({
              assert: (input) => {
                report.asked.push(`${input.action}:${input.resources.join(",")}`)
                report.saves.push(grant(input))
                return Effect.void
              },
            })
          : permissionLayer({
              assert: (input) => {
                report.asked.push(`${input.action}:${input.resources.join(",")}`)
                report.saves.push(grant(input))
                return refusal === "corrected"
                  ? Effect.fail(new Permission.CorrectedError({ feedback: FEEDBACK }))
                  : Effect.fail(
                      new Permission.BlockedError({
                        rules: [],
                        permission: input.action,
                        resources: input.resources,
                        reason: "Permission refused by the test",
                      }),
                    )
              },
            }),
      ),
      Mcp.node.replace(
        Layer.mock(Mcp.Service, {
          callTool: (input) => {
            const seen: Call = {
              server: input.server as string,
              name: input.name as string,
              args: (input.args ?? {}) as Record<string, unknown>,
            }
            report.calls.push(seen)
            return reply(seen)
          },
        }),
      ),
    ],
  )
}

const call = (id: string, input: Record<string, unknown>) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: SkillCatalogTool.name, input },
})

const run = (tools: Tool.Interface, id: string, input: Record<string, unknown>) => executeTool(tools, call(id, input))

/** The text a model reads: only `content` ever reaches it. */
const modelText = (result: { readonly content?: ReadonlyArray<Tool.Content> }) =>
  (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")

/** The model-facing refusal text, unescaped so a test can read it the way the model does. */
const refusal = (result: { readonly error?: { readonly message?: string } }) => result.error?.message ?? ""

/**
 * The same tool, but with the real permission layer behind it: rules are stored on the agent
 * and evaluated by production code, so a deny here is the same deny the server would apply.
 */
function guardedHarness(report: Seen) {
  return AppNodeBuilder.build(
    LayerNode.group([
      Database.node,
      Bus.node,
      SessionStore.node,
      PermissionSaved.node,
      Agent.node,
      Permission.node,
      Tool.node,
      makeLocationNode({
        name: "test/skill-catalog-plugin",
        layer: Layer.effectDiscard(registerToolPlugin(SkillCatalogTool.Plugin)),
        deps: [Tool.node, Mcp.node, Permission.node],
      }),
      Mcp.node,
    ]),
    [
      Location.node.replace(
        Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") }))),
      ),
      Mcp.node.replace(
        Layer.mock(Mcp.Service, {
          callTool: (input) => {
            report.calls.push({
              server: input.server as string,
              name: input.name as string,
              args: (input.args ?? {}) as Record<string, unknown>,
            })
            return Effect.succeed(answer(SEARCH_TEXT))
          },
        }),
      ),
    ],
  )
}

/** A project row, a session row and the agent's own rules: what `Permission.assert` reads. */
function seedRules(rules: Permission.Ruleset) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: "test",
        directory: "/project",
        title: "test",
        version: "test",
        agent: toolIdentity.agent,
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform((editor) =>
      editor.update(toolIdentity.agent, (agent) => {
        agent.permissions = [...rules]
      }),
    )
    yield* Effect.void
  })
}

const answers = (value: string) => () => Effect.succeed(answer(value))

/** What a user writes when they refuse a call with a reason; it is the only text the model can read. */
const FEEDBACK = "No, use the skill tool instead of the marketplace"

describe("SkillCatalogTool", () => {
  it.live("searches the marketplace and hands the model one compact row per skill", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-search", { action: "search", query: "pdf", limit: 3 })

      expect(result).toMatchObject({ status: "completed" })
      expect(report.calls).toEqual([{ server: "skillsmp", name: "search_skills", args: { query: "pdf", limit: 3 } }])
      // Both rule surfaces, canonical MCP name first, and each narrowed to the proxied tool
      // rather than to "*" as the generic MCP tool asserts.
      expect(report.asked).toEqual(["skillsmp_search_skills:search_skills", "skill_catalog:search_skills"])
      // Each prompt offers the one tool it is about to call as a lasting rule, which is what
      // puts "Always allow" on the dialog at all.
      expect(report.saves).toEqual(["skillsmp_search_skills:search_skills", "skill_catalog:search_skills"])
      const output = result.output as {
        reported: number
        skills: ReadonlyArray<{ name: string; stars: number; url: string; description: string }>
      }
      // The server counts the rows it returned on this page, not the catalog: five live answers
      // for limits 5, 2, 60, 60 and 50 read "Found 5", "Found 2", "Found 50", "Found 50" and
      // "Found 50". Reporting that number as a catalog total would invent a claim.
      expect(output.reported).toBe(5)
      expect(output.skills.map((skill) => skill.name)).toEqual([
        "nano-pdf",
        "summarize",
        "visa-doc-translate",
        "visa-doc-translate",
        "nutrient-document-processing",
      ])
      expect(output.skills[0].stars).toBe(391533)
      expect(output.skills[0].url).toBe("https://github.com/openclaw/openclaw/tree/main/skills/nano-pdf")
      expect(output.skills[0].description).toBe("Edit PDFs with natural-language instructions using the nano-pdf CLI.")
      const text = modelText(result)
      expect(text).toContain("Found 5 skills on page 1:")
      expect(text).toContain("- nano-pdf (391533 stars)")
      expect(text).toContain("Edit PDFs with natural-language instructions using the nano-pdf CLI.")
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })

  it.live("reads one skill by id", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-get", { action: "get", id: "nano-pdf" })

      expect(result).toMatchObject({ status: "completed" })
      expect(report.calls).toEqual([{ server: "skillsmp", name: "get_skill", args: { id: "nano-pdf" } }])
      expect(report.asked).toEqual(["skillsmp_get_skill:get_skill", "skill_catalog:get_skill"])
      expect(modelText(result)).toContain("**GitHub:** https://github.com/openclaw/openclaw/tree/main/skills/nano-pdf")
      expect((result.output as { action: string }).action).toBe("get")
    }).pipe(Effect.provide(harness(answers(GET_TEXT), report)))
  })

  it.live("keeps a huge answer inside the context budget and admits the cut", () => {
    const report = seen()
    const flood = `## huge\n\n${"x".repeat(50_000)}`
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-huge", { action: "get", id: "huge" })

      expect(result).toMatchObject({ status: "completed" })
      const output = result.output as { output: string; truncated?: boolean }
      expect(output.truncated).toBe(true)
      expect(output.output.length).toBe(4000)
    }).pipe(Effect.provide(harness(answers(flood), report)))
  })

  it.live("caps a runaway limit and a runaway result set at the tool maximum", () => {
    const report = seen()
    // The shape the live server actually answers with for limit 60: 50 rows under a header that
    // counts those same 50. The tool asked for 10 and must still bound what it reads.
    const many = [
      "Found 50 skills for 'test' (page 1):",
      "",
      Array.from({ length: 50 }, (_, index) => `3. **skill-${index}** ⭐${index}`).join("\n\n"),
      "",
    ].join("\n")
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-cap", { action: "search", query: "x", limit: 500 })

      expect(result).toMatchObject({ status: "completed" })
      expect(report.calls[0].args.limit).toBe(SkillCatalogTool.MAX_RESULTS)
      expect((result.output as { skills: ReadonlyArray<unknown> }).skills).toHaveLength(SkillCatalogTool.MAX_RESULTS)
    }).pipe(Effect.provide(harness(answers(many), report)))
  })

  it.live("keeps a nonsense limit from reaching the server as nonsense", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      yield* run(tools, "call-zero", { action: "search", query: "x", limit: 0 })
      yield* run(tools, "call-default", { action: "search", query: "x" })

      expect(report.calls[0].args.limit).toBe(1)
      expect(report.calls[1].args.limit).toBe(5)
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })

  it.live("forwards the search filters the model asked for", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      yield* run(tools, "call-filters", {
        action: "search",
        query: "scraping",
        category: "web-development",
        language: "en",
        sort: "recent",
      })

      expect(report.calls[0].args).toEqual({
        query: "scraping",
        limit: 5,
        category: "web-development",
        language: "en",
        sort_by: "recent",
      })
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })

  it.live("hands back raw text when the server answers in a shape it does not know", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-unknown", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "completed" })
      expect(modelText(result)).toBe("a new format the parser does not know")
      expect((result.output as { skills?: unknown }).skills).toBeUndefined()
    }).pipe(Effect.provide(harness(answers("a new format the parser does not know"), report)))
  })

  it.live("reads a live answer that matches nothing as an empty list, not as an unknown format", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-empty", { action: "search", query: "zzzqqqnosuchskillzzz" })

      expect(result).toMatchObject({ status: "completed" })
      // The live answer for a query nothing matches is a parseable header and no rows. Treating
      // it as a format the parser missed would leave the model with an error-looking message.
      const output = result.output as { skills: unknown[]; reported: number }
      expect(output.skills).toEqual([])
      expect(output.reported).toBe(0)
      expect(modelText(result)).toBe("Found 0 skills on page 1:")
    }).pipe(Effect.provide(harness(answers(EMPTY_TEXT), report)))
  })

  it.live("refuses a blank query instead of handing the model the server's rejection of it", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      // Live: search_skills with query "" answers `API error 400 … MISSING_QUERY` and with
      // whitespace `INVALID_QUERY`, both inside a second and both with isError:false. Without
      // the guard the model would read that rejection as the catalog's answer.
      const result = yield* run(tools, "call-blank-query", { action: "search", query: "   " })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("search needs query")
      expect(report.calls).toEqual([])
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })

  it.live("refuses a call that is missing its argument without reaching the server", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const search = yield* run(tools, "call-no-query", { action: "search" })
      const get = yield* run(tools, "call-no-id", { action: "get" })

      expect(search).toMatchObject({ status: "error" })
      expect(refusal(search)).toContain("search needs query")
      expect(get).toMatchObject({ status: "error" })
      expect(refusal(get)).toContain("get needs id")
      expect(report.calls).toEqual([])
      expect(report.asked).toEqual([])
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })

  it.live("turns a server that is not configured into a refusal instead of a hang", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-missing", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("is not configured")
      expect(refusal(result)).toContain("opencode.json")
      expect(report.calls).toHaveLength(1)
    }).pipe(
      Effect.provide(
        harness(() => Effect.fail(new Mcp.NotFoundError({ server: Mcp.ServerName.make("skillsmp") })), report),
      ),
    )
  })

  it.live("surfaces a tool call failure as a refusal the model can read", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-fail", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("boom")
      expect(report.calls).toHaveLength(1)
    }).pipe(
      Effect.provide(
        harness(
          () =>
            Effect.fail(
              new Mcp.ToolCallError({
                server: Mcp.ServerName.make("skillsmp"),
                tool: "search_skills",
                message: "boom",
              }),
            ),
          report,
        ),
      ),
    )
  })

  it.live("surfaces an error result from the server instead of printing it as an answer", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-is-error", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("API error 503")
    }).pipe(Effect.provide(harness(() => Effect.succeed(answer("API error 503: upstream down", true)), report)))
  })

  it.live("turns a body that says the skill is missing into a refusal, not an answer", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-not-found", { action: "get", id: "nano-pdf-does-not-exist" })

      expect(result).toMatchObject({ status: "error" })
      // Live body with isError:false. As a result the model would read "no such skill" off a
      // search row that simply did not match; as a refusal it can try another id.
      expect(refusal(result)).toContain("no skill with that id")
      expect(refusal(result)).toContain("search")
      expect(report.calls).toHaveLength(1)
    }).pipe(Effect.provide(harness(answers(NOT_FOUND_TEXT), report)))
  })

  it.live("turns an upstream refusal in the body into a refusal that draws no conclusion", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-upstream", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      // Live body with isError:false: the catalog is fine, the upstream said no. The model must
      // not turn this into "there is no skill for pdf".
      expect(refusal(result)).toContain("refused the call")
      expect(refusal(result)).toContain("DAILY_QUOTA_EXCEEDED")
      expect(refusal(result)).toContain("not a missing skill")
      expect(report.calls).toHaveLength(1)
    }).pipe(Effect.provide(harness(answers(UPSTREAM_ERROR_TEXT), report)))
  })

  it.live("never reaches the server when permission refused the call", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-denied", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("Permission refused by the test")
      expect(report.calls).toEqual([])
      expect(report.asked).toEqual(["skillsmp_search_skills:search_skills"])
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report, "blocked")))
  })

  it.live("gives the model the reason when a refusal carries feedback", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const result = yield* run(tools, "call-corrected", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      // A CorrectedError has an empty `message` by design, so its feedback is the only text
      // the model can learn from. Without the leaf's branch this reads as a bare prefix.
      expect(refusal(result)).toBe(FEEDBACK)
      expect(refusal(result)).not.toBe("")
      expect(report.calls).toEqual([])
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report, "corrected")))
  })

  it.live("is blocked by a deny rule aimed at the MCP server, not only at the tool", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* seedRules([{ action: "skillsmp_*", resource: "*", effect: "deny" }])

      const result = yield* run(tools, "call-deny-rule", { action: "search", query: "pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("skillsmp_search_skills")
      expect(report.calls).toEqual([])
    }).pipe(Effect.provide(guardedHarness(report)))
  })

  it.live("still answers a get the search rule does not deny", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* seedRules([
        { action: "*", resource: "*", effect: "deny" },
        { action: "skillsmp_search_skills", resource: "*", effect: "deny" },
        { action: "skillsmp_get_skill", resource: "*", effect: "allow" },
        { action: "skill_catalog", resource: "*", effect: "allow" },
      ])

      const refused = yield* run(tools, "call-rule-search", { action: "search", query: "pdf" })
      const allowed = yield* run(tools, "call-rule-get", { action: "get", id: "nano-pdf" })

      expect(refused).toMatchObject({ status: "error" })
      expect(allowed).toMatchObject({ status: "completed" })
      expect(report.calls).toEqual([{ server: "skillsmp", name: "get_skill", args: { id: "nano-pdf" } }])
    }).pipe(Effect.provide(guardedHarness(report)))
  })

  it.live("is blocked by a deny rule aimed at the wrapper tool itself", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      // The proxied name is allowed so the refusal can only have come from the wrapper rule.
      yield* seedRules([
        { action: "*", resource: "*", effect: "deny" },
        { action: "skillsmp_get_skill", resource: "*", effect: "allow" },
        { action: "skill_catalog", resource: "*", effect: "deny" },
      ])

      const result = yield* run(tools, "call-rule-wrapper", { action: "get", id: "nano-pdf" })

      expect(result).toMatchObject({ status: "error" })
      expect(refusal(result)).toContain("skill_catalog")
      expect(report.calls).toEqual([])
    }).pipe(Effect.provide(guardedHarness(report)))
  })

  test("puts the feedback in the failure's own text, not only in the cause it carries", () => {
    // The session error already unwraps a cause to `permission.rejected` with the feedback, so
    // the model was never left with the empty message. What the leaf must still get right is
    // the ToolFailure it produces: its own text is what logs and any future unwrap path read.
    const failure = SkillCatalogTool.failed(new Permission.CorrectedError({ feedback: FEEDBACK }))

    expect(failure).toBeInstanceOf(ToolFailure)
    expect(failure.message).toBe(FEEDBACK)
  })

  it.live("keeps an always answer, so the next call of the same kind asks nothing", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      const bus = yield* Bus.Service
      const permission = yield* Permission.Service
      const saved = yield* PermissionSaved.Service
      // No rules at all: `evaluate` falls back to ask, which is the state this tool meets on
      // a machine where nobody wrote a rule for it yet.
      yield* seedRules([])
      const asked: Permission.Request[] = []
      // Answered the way a person can: the dialog only offers "always" because `save` was set.
      const unsubscribe = yield* bus.listen((event) => {
        if (event.type !== Permission.Event.Asked.type) return Effect.void
        const request = event.data as Permission.Request
        return Effect.sync(() => asked.push(request)).pipe(
          Effect.flatMap(() => permission.reply({ requestID: request.id, reply: "always" })),
          Effect.catchTag("Permission.NotFoundError", () => Effect.void),
        )
      })
      yield* Effect.addFinalizer(() => unsubscribe)

      const first = yield* Effect.forkScoped(run(tools, "call-always-1", { action: "search", query: "pdf" }))
      yield* Fiber.join(first)

      expect(asked.map((request) => `${request.action}:${(request.save ?? []).join(",")}`)).toEqual([
        "skillsmp_search_skills:search_skills",
        "skill_catalog:search_skills",
      ])
      // Compared as a set: the store does not promise an order, and the pair is what matters.
      expect(
        (yield* saved.list({ projectID: Project.ID.global }))
          .map((rule) => `${rule.action}:${rule.resource}`)
          .toSorted(),
      ).toEqual(["skill_catalog:search_skills", "skillsmp_search_skills:search_skills"])

      const second = yield* run(tools, "call-always-2", { action: "search", query: "pdf" })

      expect(second).toMatchObject({ status: "completed" })
      expect(report.calls).toHaveLength(2)
      // No third prompt: the two saved rules answer both asserts on their own.
      expect(asked).toHaveLength(2)
    }).pipe(Effect.provide(guardedHarness(report)))
  })

  test("names the canonical MCP tool in its description, so a rule author can find it", () => {
    expect(SkillCatalogTool.description).toContain(McpTool.name(SkillCatalogTool.server, "search_skills"))
    expect(SkillCatalogTool.description).toContain(McpTool.name(SkillCatalogTool.server, "get_skill"))
  })

  test("tells the model to take search and get here, and which raw tools are the fallback", () => {
    // Two names, so the registry's "latest registration for a name wins" never fires and the raw
    // `skillsmp_search_skills` / `skillsmp_get_skill` sit beside this tool on the model list. The
    // description is the only thing that decides which of the two doors the model walks through,
    // so the preference has to be spelled out for the model, not just for a reader.
    expect(SkillCatalogTool.description).toContain(
      `Prefer this tool over the raw ${McpTool.name(SkillCatalogTool.server, "search_skills")} and ${McpTool.name(SkillCatalogTool.server, "get_skill")} for finding and reading skills`,
    )
    // The other half of the promise: the raw tools are deferred to, not banned. Dropping
    // semantic_search_skills from that list would quietly take semantic search away, since this
    // tool does not cover it.
    expect(SkillCatalogTool.description).toContain(
      [
        McpTool.name(SkillCatalogTool.server, "read_skill"),
        McpTool.name(SkillCatalogTool.server, "list_categories"),
        McpTool.name(SkillCatalogTool.server, "semantic_search_skills"),
        McpTool.name(SkillCatalogTool.server, "get_cache_stats"),
        McpTool.name(SkillCatalogTool.server, "warm_cache"),
      ].join(", "),
    )
  })

  test("is registered in the internal pre list, the only place production loads it from", async () => {
    // A source check on purpose: deleting the line from `pre` leaves every other test green,
    // because they all register the plugin themselves.
    const source = await Bun.file(new URL("../src/plugin/internal.ts", import.meta.url)).text()
    const pre = /const pre = \[([\s\S]*?)\n\] as const/.exec(source)?.[1]

    expect(pre).not.toBeUndefined()
    expect(pre).toContain("SkillCatalogTool.Plugin")
    expect(source).toContain('import { SkillCatalogTool } from "../tool/plugin/skill-catalog.js"')
  })

  it.live("advertises itself on the model tool list, not only inside CodeMode", () => {
    const report = seen()
    return Effect.gen(function* () {
      const tools = yield* Tool.Service

      const snapshot = yield* tools.snapshot()

      expect(snapshot.definitions.map((definition) => definition.name)).toContain(SkillCatalogTool.name)
      // codemode:false keeps it off the catalog the model would otherwise have to dig through.
      expect(codeModeListings(snapshot.codeModeCatalog!).map((entry) => entry.path)).not.toContain(
        SkillCatalogTool.name,
      )
    }).pipe(Effect.provide(harness(answers(SEARCH_TEXT), report)))
  })
})
