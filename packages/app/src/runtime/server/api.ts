import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`opencode:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)

  if (!decoded) return
  const separator = decoded.indexOf(":")

  if (separator === -1) return

  return {
    password: decoded.slice(separator + 1),
  }
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  // v13.12: the embedded server rotates its password out of band; the live
  // value on window always beats a persisted store entry for the local URL.
  const embedded = (window as { __OPENCODE_EMBEDDED__?: { url?: string; password?: string } }).__OPENCODE_EMBEDDED__
  const password =
    embedded?.password && embedded.url === input.server.url ? embedded.password : input.server.password
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient
