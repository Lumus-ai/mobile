import { describe, expect, test } from "bun:test"
import { role, roles, templates } from "@opencode/schema/orchestra"

const findRole = (id: string) => roles.find((item) => item.id === id)

describe("built-in Orchestra role contracts", () => {
  test("every role has a unique ID, a clear mission, and substantive rules", () => {
    expect(new Set(roles.map((item) => item.id)).size).toBe(roles.length)

    for (const item of roles) {
      expect(item.description.trim().length).toBeGreaterThan(20)
      expect(item.rules.trim().length).toBeGreaterThan(80)
      expect(item.rules).toContain("Mission:")
    }
  })

  test("keeps root-cause analysis, acceptance testing, review, and falsification distinct", () => {
    expect(findRole("debugger")?.rules).toContain("root cause")
    expect(findRole("tester")?.rules).toContain("independently")
    expect(findRole("reviewer")?.readOnly).toBe(true)

    const adversary = findRole("counterexample-engineer")
    expect(adversary).toBeDefined()
    if (!adversary) throw new Error("counterexample-engineer must be registered")
    expect(adversary.readOnly).toBe(true)
    expect(adversary.rules).toContain("trying to disprove")
    expect(adversary.rules).toContain("concrete counterexamples")
  })

  test("keeps the core template lean while allowing adversarial review on demand", () => {
    const core = templates.find((item) => item.id === "opencode-core")
    expect(core).toBeDefined()
    if (!core) throw new Error("opencode-core template must be registered")

    const memberAgents = core.members.map((member) => member.agent)
    for (const id of [
      "architect",
      "core-maintainer",
      "integration-engineer",
      "api-contract-engineer",
      "security-auditor",
      "tester",
      "reviewer",
    ]) {
      expect(memberAgents).toContain(role(id))
    }

    // The orchestrator creates this specialist only when task risk justifies the extra session.
    expect(memberAgents).not.toContain(role("counterexample-engineer"))
  })

  test("every built-in team template references registered roles", () => {
    for (const template of templates) {
      for (const member of template.members) {
        expect(roles.some((item) => role(item.id) === member.agent)).toBe(true)
      }
    }
  })
})
