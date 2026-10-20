import { describe, expect } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError, TransportError } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import type { Bus } from "@opencode/core/bus"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Effect, Fiber } from "effect"
import { it } from "./lib/effect"

const timeout = new AIError({
  reason: new TransportError({ message: "Timed out", transport: "http", operation: "request", code: "Timeout" }),
})
const internal = new AIError({ reason: new ProviderInternalError({ message: "internal" }) })

const input = (cause: AIError) => ({
  cause,
  error: toSessionError(cause),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ id: Model.ID.make("model"), providerID: Provider.ID.make("provider") }),
  hook: () => Effect.void,
  retry: SessionRunnerRetry.isRetryable(cause),
})

// Decisions for `count` consecutive failures of the same cause within one step.
const decisions = (cause: AIError, count: number) =>
  Effect.gen(function* () {
    const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_retry"))
    const results: boolean[] = []
    for (let i = 0; i < count; i++) results.push((yield* policy(input(cause))).retry)
    return results
  })

describe("SessionRunnerRetry.policy", () => {
  it.effect("stops retrying transport timeouts after three attempts", () =>
    Effect.gen(function* () {
      expect(yield* decisions(timeout, 4)).toEqual([true, true, true, false])
    }),
  )

  it.effect("keeps the general allowance for other transient failures", () =>
    Effect.gen(function* () {
      expect(yield* decisions(internal, 10)).toEqual(Array(10).fill(true))
    }),
  )
})

const rateLimit = new AIError({ reason: new RateLimitError({ message: "Too many requests", retryAfterMs: 900_000 }) })
// wait() publishes a RetryScheduled event; decision tests need no event bus.
// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
const retryBus = { publish: () => Effect.void } as unknown as Bus.Interface

describe("SessionRunnerRetry local decisions", () => {
  it.effect("ignores provider Retry-After without changing the existing generic retry schedule", () =>
    Effect.gen(function* () {
      const retry = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_local"))
      const decision = yield* retry.decide(input(rateLimit))
      expect(decision.retry).toBe(true)
      if (decision.retry) expect(decision.delay).toBeLessThan(15_000)
    }),
  )
  it.effect("does not share retry state between sessions of one provider", () =>
    Effect.gen(function* () {
      const a = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_a"))
      const b = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_b"))
      for (let i = 0; i < 12; i++) yield* a.decide(input(rateLimit))
      const decision = yield* b.decide(input(rateLimit))
      expect(decision.retry).toBe(true)
      if (decision.retry) expect(decision.attempt).toBe(2)
    }),
  )
  it.effect("wait is interruptible", () =>
    Effect.gen(function* () {
      const retry = yield* SessionRunnerRetry.make(retryBus, SessionSchema.ID.make("ses_cancel"))
      const waiting = yield* retry
        .wait({
          decision: { retry: true, attempt: 2, delay: 10_000 },
          assistantMessageID: SessionMessage.ID.create(),
          error: toSessionError(rateLimit),
          providerID: "provider",
        })
        .pipe(Effect.forkChild)
      yield* Fiber.interrupt(waiting)
    }),
  )
})
