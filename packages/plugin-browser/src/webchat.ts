export * as ChatGPTWeb from "./webchat.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Duration, Effect, Schema } from "effect"
import type { BrowserConnection } from "./connection.js"
import { Browser } from "./rpc.js"

const MAX_TASK_CHARS = 8_000
const SNAPSHOT = Schema.Struct({
  tab: Browser.Tab,
  content: Schema.String,
  truncated: Schema.Boolean,
})
const WEB_URL = "https://chatgpt.com/"

export function resolveChatGPTWebURL(value?: string) {
  const input = value?.trim() || WEB_URL
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("OPENCODE_CHATGPT_WEB_URL must be a valid ChatGPT web URL.")
  }
  if (
    url.protocol !== "https:" ||
    !["chatgpt.com", "chat.openai.com"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.port !== "" && url.port !== "443")
  )
    throw new Error("Only HTTPS URLs on chatgpt.com or chat.openai.com are allowed.")
  return url.href
}

export function composerRef(content: string) {
  const line = content.split(/\r?\n/).find(
    (value) =>
      /\[(?:textbox|searchbox)\]/i.test(value) &&
      /(message|ask|chatgpt|prompt)/i.test(value),
  )
  return line?.match(/^\s*@?(e[1-9]\d*)\s+\[(?:textbox|searchbox)\]/i)?.[1]
}

function isChatGPTURL(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && ["chatgpt.com", "chat.openai.com"].includes(url.hostname)
  } catch {
    return false
  }
}

export const register = Effect.fn("ChatGPTWeb.register")(function* (
  ctx: Pick<Context, "command" | "session">,
  connection: BrowserConnection.Connection,
) {
  const run = (sessionID: Session.ID, action: Browser.Action) =>
    connection.target(sessionID, action).pipe(
      Effect.flatMap((target) => target.request([])),
      Effect.map((result) => result.value),
    )

  yield* ctx.command.transform((editor) =>
    editor.add({
      name: "chatgpt-web",
      description:
        "Send a task directly to your signed-in ChatGPT website without calling the current OpenCode model. Usage: /chatgpt-web <task>. ChatGPT must have GitHub access connected for repository changes.",
      execute: (input) =>
        Effect.gen(function* () {
          const task = input.prompt.text.trim()
          if (!task) return yield* Effect.fail(new Error("Usage: /chatgpt-web <task>"))
          if (task.length > MAX_TASK_CHARS)
            return yield* Effect.fail(new Error("The ChatGPT Web task is too long. Keep it below 8000 characters."))

          const configuredURL = process.env.OPENCODE_CHATGPT_WEB_URL?.trim()
          const startURL = resolveChatGPTWebURL(configuredURL)
          const state = yield* run(input.sessionID, { type: "tabs.list" }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Browser.State)),
          )
          const existing = state.tabs.find((tab) => isChatGPTURL(tab.url))
          const tab: Browser.Tab = existing
            ? yield* Effect.gen(function* () {
                yield* run(input.sessionID, { type: "tabs.focus", tabID: existing.id })
                const path = new URL(existing.url).pathname
                const settingsPage = path.startsWith("/settings/")
                if ((configuredURL && existing.url !== startURL) || (!configuredURL && settingsPage))
                  return yield* run(input.sessionID, {
                    type: "navigate",
                    tabID: existing.id,
                    url: configuredURL ? startURL : WEB_URL,
                  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Browser.Tab)))
                return existing
              })
            : yield* run(input.sessionID, { type: "tabs.open", url: startURL, focus: true }).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Browser.Tab)),
              )

          let ref: string | undefined
          const deadline = Date.now() + 25_000
          while (!ref && Date.now() < deadline) {
            const snapshot = yield* run(input.sessionID, {
              type: "snapshot",
              tabID: tab.id,
              depth: 12,
            }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(SNAPSHOT)))
            ref = composerRef(snapshot.content)
            if (!ref) yield* Effect.sleep(Duration.millis(500))
          }
          if (!ref)
            return yield* Effect.fail(
              new Error(
                "Could not find the ChatGPT message box, so no task was sent. Sign in to ChatGPT in the opened browser, solve any visible verification prompt, then run /chatgpt-web again once.",
              ),
            )

          const message = [
            "This task was submitted from OpenCode++ through the normal ChatGPT web interface.",
            "Use the GitHub integration connected to this ChatGPT account, if available, for repository work. If GitHub is not connected or write access is unavailable, stop and report that blocker. Verify every change through actual tool results. Do not merge pull requests unless explicitly requested. Respect normal usage limits, sign-in, verification, and approval prompts; do not bypass them.",
            "User task:",
            task,
          ].join("\n\n")

          yield* run(input.sessionID, {
            type: "fill",
            tabID: tab.id,
            ref: Browser.Ref.make(ref),
            text: message,
          })
          yield* run(input.sessionID, { type: "press", tabID: tab.id, key: "Enter" })
          yield* ctx.session.synthetic({
            sessionID: input.sessionID,
            description: "ChatGPT Web bridge",
            text:
              "Task sent to ChatGPT Web in the focused browser tab. Continue the conversation there; OpenCode's current model was not called. If ChatGPT displays a usage limit, sign-in, or approval prompt, handle it normally.",
          })
        }),
    }),
  )
})
