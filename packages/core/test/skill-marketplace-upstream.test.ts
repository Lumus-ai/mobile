import { describe, expect, test } from "bun:test"
import { Duration, Effect } from "effect"
import { SkillMarketplaceUpstream } from "@opencode/core/skill-marketplace/upstream"
import { LISTING_A, QUOTA_REFUSAL } from "./fixture/skill-marketplace"

/**
 * A stand-in for the catalog's MCP endpoint. It answers `initialize`, the notification and
 * `tools/call`, records every request, and hands out a session id the way a real server does.
 */
const endpoint = (options: { tools?: string; session?: boolean; status?: number; raw?: string } = {}) => {
  const requests: { headers: Headers; body: Record<string, unknown> }[] = []
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    requests.push({ headers: new Headers(init?.headers), body })
    const headers = new Headers({ "content-type": "application/json" })
    if (options.session !== false) headers.set("Mcp-Session-Id", "session-abc")
    const status = options.status ?? 200
    if (status !== 200) return new Response("upstream is unwell", { status })
    const method = String(body.method)
    if (method === "initialize")
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-11-25" } }), {
        headers,
      })
    if (method === "notifications/initialized") return new Response("", { status: 202, headers })
    if (options.raw !== undefined) return new Response(options.raw, { headers })
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: options.tools ?? LISTING_A }] },
      }),
      { headers },
    )
  }) as unknown as typeof globalThis.fetch
  return { fetch, requests, headers: requests }
}

const call = (input: SkillMarketplaceUpstream.Query, fetch: typeof globalThis.fetch, extra = {}) =>
  Effect.runPromise(SkillMarketplaceUpstream.search(input, { fetch, wait: false, ...extra }))

const failure = (
  input: SkillMarketplaceUpstream.Query,
  fetch: typeof globalThis.fetch,
  extra: { timeout?: Duration.Duration } = {},
) => Effect.runPromise(SkillMarketplaceUpstream.search(input, { fetch, wait: false, ...extra }).pipe(Effect.flip))

describe("skill catalog endpoint", () => {
  test("initializes, then calls search_skills with the documented arguments", async () => {
    const catalog = endpoint()

    const listing = await call(
      { query: "react hooks", limit: 7, category: "data-ai", language: "ja", sortBy: "recent" },
      catalog.fetch,
    )

    expect(listing.data.skills.length).toBeGreaterThan(0)
    const methods = catalog.requests.map((request) => request.body.method)
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call"])
    const tool = catalog.requests[2]!.body.params as { name: string; arguments: Record<string, unknown> }
    expect(tool.name).toBe("search_skills")
    expect(tool.arguments).toEqual({
      query: "react hooks",
      limit: 7,
      page: 1,
      sortBy: "recent",
      category: "data-ai",
      language: "ja",
    })
  })

  test("every request carries the protocol version the endpoint demands", async () => {
    const catalog = endpoint()

    await call({ query: "react hooks" }, catalog.fetch)

    // Without this header the endpoint answers `MCP-Protocol-Version header is required`.
    for (const request of catalog.requests) expect(request.headers.get("MCP-Protocol-Version")).toBe("2025-11-25")
    expect(catalog.requests[0]?.headers.get("User-Agent")).toBe("opencode-skill-catalog/1.0")
  })

  test("the session id the endpoint hands out rides on the call that follows", async () => {
    const catalog = endpoint()

    await call({ query: "react hooks" }, catalog.fetch)

    // Without it some servers treat every call as a brand-new client.
    expect(catalog.requests[0]?.headers.get("Mcp-Session-Id")).toBeNull()
    expect(catalog.requests[1]?.headers.get("Mcp-Session-Id")).toBe("session-abc")
    expect(catalog.requests[2]?.headers.get("Mcp-Session-Id")).toBe("session-abc")
  })

  test("a body that refuses inside a 200 is an error carrying the catalog's own code", async () => {
    const catalog = endpoint({ tools: QUOTA_REFUSAL })

    const error = await failure({ query: "react hooks" }, catalog.fetch)

    expect(error).toBeInstanceOf(SkillMarketplaceUpstream.UpstreamError)
    expect(error.code).toBe("DAILY_QUOTA_EXCEEDED")
    expect(error.message).toContain("quota")
  })

  test("a non-200 is an error carrying the status", async () => {
    const catalog = endpoint({ status: 503 })

    const error = await failure({ query: "react hooks" }, catalog.fetch)

    expect(error.status).toBe(503)
    expect(error.message).toContain("503")
  })

  test("a body that is not the contract is an error, not an empty listing", async () => {
    const catalog = endpoint({ raw: "<html>maintenance</html>" })

    const error = await failure({ query: "react hooks" }, catalog.fetch)

    expect(error.message).toContain("unreadable")
    expect(error.code).toBeUndefined()
  })

  test("a tool result marked as an error never becomes rows", async () => {
    const catalog = endpoint({
      raw: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { isError: true, content: [{ type: "text", text: "rate limited, try later" }] },
      }),
    })

    const error = await failure({ query: "react hooks" }, catalog.fetch)

    expect(error.message).toContain("rate limited")
  })

  test("structured content is read as the catalog's own JSON", async () => {
    const catalog = endpoint({
      raw: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        result: { structuredContent: JSON.parse(LISTING_A) },
      }),
    })

    const listing = await call({ query: "react hooks" }, catalog.fetch)

    expect(listing.data.skills).toHaveLength(3)
    expect(listing.data.pagination.provenRowCount).toBe(4)
    expect(listing.data.pagination.provenPageCount).toBe(2)
  })

  test("a network failure keeps the real reason instead of a wrapper's name", async () => {
    const fetch = (async () => {
      throw new TypeError("getaddrinfo ENOTFOUND skillsmp.com")
    }) as unknown as typeof globalThis.fetch

    const error = await failure({ query: "react hooks" }, fetch)

    expect(error.message).toContain("ENOTFOUND skillsmp.com")
    expect(error.message).not.toContain("Effect.tryPromise")
  })

  test("a catalog that never answers is an error, not a hanging tool", async () => {
    const fetch = (async () => await new Promise(() => {})) as unknown as typeof globalThis.fetch

    const error = await failure({ query: "react hooks" }, fetch, { timeout: Duration.millis(50) })

    expect(error.message).toContain("in time")
  })

  test("calls are spaced so a burst is not answered with a refusal", async () => {
    const catalog = endpoint()
    const started = Date.now()

    await Effect.runPromise(SkillMarketplaceUpstream.search({ query: "one" }, { fetch: catalog.fetch }))
    await Effect.runPromise(SkillMarketplaceUpstream.search({ query: "two" }, { fetch: catalog.fetch }))

    // Thirty calls a minute is two seconds apart, so the second call cannot leave immediately.
    // This is the property that keeps a burst from being answered with a refusal.
    expect(Date.now() - started).toBeGreaterThanOrEqual(Duration.toMillis(SkillMarketplaceUpstream.MIN_INTERVAL) - 50)
  })
})
