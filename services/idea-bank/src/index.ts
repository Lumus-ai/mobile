interface Env {
  DB: D1Database
  IDEA_BANK_ADMIN_TOKEN?: string
  RATE_LIMIT_SALT?: string
}

type IdeaRow = {
  id: string
  title: string
  summary: string
  category: string
  tags: string
  language: string
  status: "pending" | "published" | "rejected"
  submitter_hash: string
  content_hash: string
  created_at: number
  updated_at: number
  reviewed_at: number | null
}

type PublicIdea = {
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  language: string
  createdAt: number
  updatedAt: number
}

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} satisfies Record<string, string>

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers })
}

function clean(value: unknown, max: number) {
  if (typeof value !== "string") return ""
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max)
}

const sensitivePatterns = [
  /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/u,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/iu,
  /\b(?:password|passwd|secret|(?:api[_ -]?)?key|(?:access[_ -]?)?token|authorization|bearer)\s*[:=]/iu,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u,
  /https?:\/\/\S+/iu,
  /(?:[A-Z]:\\Users\\|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/iu,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/u,
]

function hasSensitiveContent(value: string) {
  return sensitivePatterns.some((pattern) => pattern.test(value))
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function decodeIdea(row: IdeaRow): PublicIdea {
  let tags: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.tags)
    if (Array.isArray(parsed)) tags = parsed.filter((item): item is string => typeof item === "string")
  } catch {
    // A malformed tag column must not break otherwise valid search results.
  }
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    category: row.category,
    tags,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validLanguage(value: string) {
  return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value)
}

async function listIdeas(request: Request, env: Env) {
  const url = new URL(request.url)
  const query = clean(url.searchParams.get("q"), 120)
  const category = clean(url.searchParams.get("category"), 60)
  const language = clean(url.searchParams.get("language"), 8)
  const rawLimit = Number(url.searchParams.get("limit") ?? 20)
  const rawOffset = Number(url.searchParams.get("offset") ?? 0)
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20
  const offset = Number.isSafeInteger(rawOffset) ? Math.min(100_000, Math.max(0, rawOffset)) : 0
  const clauses = ["status = 'published'"]
  const bindings: (string | number)[] = []
  if (query) {
    clauses.push("instr(lower(title || ' ' || summary || ' ' || category || ' ' || tags), lower(?)) > 0")
    bindings.push(query)
  }
  if (category) {
    clauses.push("lower(category) = lower(?)")
    bindings.push(category)
  }
  if (language && validLanguage(language)) {
    clauses.push("language = ?")
    bindings.push(language)
  }
  const where = clauses.join(" AND ")
  const total = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ideas WHERE ${where}`)
    .bind(...bindings)
    .first<{ total: number }>()
  const result = await env.DB.prepare(
    `SELECT id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, reviewed_at
     FROM ideas WHERE ${where} ORDER BY updated_at DESC, title COLLATE NOCASE LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, limit, offset)
    .all<IdeaRow>()
  return json({ items: result.results.map(decodeIdea), total: total?.total ?? 0, limit, offset })
}

async function submitIdea(request: Request, env: Env) {
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 16_384)
    return json({ error: "Idea submission body exceeds 16 KiB" }, 413)
  if (!env.RATE_LIMIT_SALT)
    return json({ error: "Idea Bank is not configured: RATE_LIMIT_SALT is missing" }, 503)
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: "Body must be valid JSON" }, 400)
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Expected an idea object" }, 400)
  const body = raw as Record<string, unknown>
  if (body.consent !== true)
    return json({ error: "Explicit consent is required before an idea can be sent to the shared bank" }, 400)

  const title = clean(body.title, 120)
  const summary = clean(body.summary, 1800)
  const category = clean(body.category, 60)
  const language = clean(body.language ?? "en", 8)
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((item) => clean(item, 32)).filter(Boolean))].slice(0, 8)
    : []

  if (title.length < 8) return json({ error: "Title must contain at least 8 characters" }, 400)
  if (summary.length < 30) return json({ error: "Summary must contain at least 30 characters" }, 400)
  if (category.length < 2) return json({ error: "Category is required" }, 400)
  if (!validLanguage(language)) return json({ error: "Language must be a code such as en or ru" }, 400)
  if (hasSensitiveContent([title, summary, category, ...tags].join("\n")))
    return json({ error: "The idea appears to contain private or sensitive data; remove it before sharing" }, 400)

  const contentHash = await hash(`${title.toLocaleLowerCase()}\n${summary.toLocaleLowerCase()}\n${category.toLocaleLowerCase()}`)
  const duplicate = await env.DB.prepare("SELECT id, status FROM ideas WHERE content_hash = ? LIMIT 1")
    .bind(contentHash)
    .first<{ id: string; status: string }>()
  if (duplicate)
    return json({ error: "A matching idea already exists", existingId: duplicate.id, status: duplicate.status }, 409)

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown"
  const salt = env.RATE_LIMIT_SALT
  const submitterHash = await hash(`${salt}:${ip}`)
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM ideas WHERE submitter_hash = ? AND created_at >= ?",
  )
    .bind(submitterHash, dayAgo)
    .first<{ total: number }>()
  if ((recent?.total ?? 0) >= 5) return json({ error: "Contribution limit reached; try again later" }, 429)

  const now = Date.now()
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO ideas
      (id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(id, title, summary, category, JSON.stringify(tags), language, submitterHash, contentHash, now, now)
    .run()

  return json({ id, status: "pending", message: "Submitted for moderation; public search shows it only after approval." }, 202)
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index++) difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

function authorized(request: Request, env: Env) {
  if (!env.IDEA_BANK_ADMIN_TOKEN) return false
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? ""
  return token.length > 0 && constantTimeEqual(token, env.IDEA_BANK_ADMIN_TOKEN)
}

async function adminQueue(request: Request, env: Env) {
  if (!authorized(request, env)) return json({ error: "Admin authorization required" }, 401)
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50)
  const limit = Number.isSafeInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50
  const result = await env.DB.prepare(
    `SELECT id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, reviewed_at
     FROM ideas WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
  )
    .bind(limit)
    .all<IdeaRow>()
  return json({ items: result.results.map(decodeIdea).map((idea) => ({ ...idea, status: "pending" })) })
}

async function reviewIdea(request: Request, env: Env, id: string) {
  if (!authorized(request, env)) return json({ error: "Admin authorization required" }, 401)
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ error: "Body must be valid JSON" }, 400)
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ error: "Expected a review object" }, 400)
  const status = (raw as Record<string, unknown>).status
  if (status !== "published" && status !== "rejected")
    return json({ error: "status must be published or rejected" }, 400)
  const now = Date.now()
  const result = await env.DB.prepare(
    "UPDATE ideas SET status = ?, updated_at = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(status, now, now, id)
    .run()
  if (result.meta.changes === 0) return json({ error: "Pending idea not found or already reviewed" }, 404)
  return json({ id, status })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/+$/, "") || "/"

    try {
      if (pathname === "/" && request.method === "GET")
        return json({ service: "opencode-idea-bank", apiVersion: 1 })
      if (pathname === "/v1/health" && request.method === "GET")
        return json({ status: "ok", service: "opencode-idea-bank", apiVersion: 1 })
      if (pathname === "/v1/ideas" && request.method === "GET") return listIdeas(request, env)
      if (pathname === "/v1/ideas" && request.method === "POST") return submitIdea(request, env)

      const detail = /^\/v1\/ideas\/([a-zA-Z0-9_-]{1,80})$/.exec(pathname)
      if (detail && request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT id, title, summary, category, tags, language, status, submitter_hash, content_hash, created_at, updated_at, reviewed_at FROM ideas WHERE id = ? AND status = 'published'",
        )
          .bind(detail[1])
          .first<IdeaRow>()
        return row ? json({ idea: decodeIdea(row) }) : json({ error: "Idea not found" }, 404)
      }

      if (pathname === "/v1/admin/submissions" && request.method === "GET") return adminQueue(request, env)
      const review = /^\/v1\/admin\/submissions\/([a-zA-Z0-9_-]{1,80})\/review$/.exec(pathname)
      const reviewID = review?.[1]
      if (reviewID && request.method === "POST") return reviewIdea(request, env, reviewID)

      if (request.method !== "GET" && request.method !== "POST") return json({ error: "Method not allowed" }, 405)
      return json({ error: "Not found" }, 404)
    } catch (error) {
      // Never log idea text, request bodies, or authorization headers.
      console.error("Idea Bank request failed", error instanceof Error ? error.name : "unknown error")
      return json({ error: "Idea Bank temporarily unavailable" }, 500)
    }
  },
} satisfies ExportedHandler<Env>
