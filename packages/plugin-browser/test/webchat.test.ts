import { describe, expect, it } from "bun:test"
import { composerRef, resolveChatGPTWebURL } from "../src/webchat.js"

describe("ChatGPT Web bridge", () => {
  it("allows only HTTPS ChatGPT URLs", () => {
    expect(resolveChatGPTWebURL("https://chatgpt.com/c/abc")).toBe("https://chatgpt.com/c/abc")
    expect(resolveChatGPTWebURL("https://chat.openai.com/")).toBe("https://chat.openai.com/")
    expect(() => resolveChatGPTWebURL("http://chatgpt.com/")).toThrow("Only HTTPS URLs")
    expect(() => resolveChatGPTWebURL("https://example.com/")).toThrow("Only HTTPS URLs")
    expect(() => resolveChatGPTWebURL("https://user:pass@chatgpt.com/")).toThrow("Only HTTPS URLs")
  })

  it("finds a message textbox, not login fields or unrelated controls", () => {
    expect(composerRef('  @e12 [textbox] "Message ChatGPT" ')).toBe("e12")
    expect(composerRef('  @e4 [textbox] "Email address"\n  @e8 [button] "Continue"')).toBeUndefined()
    expect(composerRef('  @e3 [textbox] "Ask anything"')).toBe("e3")
  })
})
