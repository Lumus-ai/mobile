import { For, Show, type JSX } from "solid-js"
import { IconCopy } from "./icons"

// Small renderer: fenced code, inline code, bold, links, bullet lines. No HTML injection (everything is JSX text).
function inline(text: string): JSX.Element[] {
  const out: JSX.Element[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(https?:\/\/[^\s<)]+)/g
  let last = 0
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const token = match[0]
    if (token.startsWith("`")) out.push(<code class="mz-code-inline">{token.slice(1, -1)}</code>)
    else if (token.startsWith("**")) out.push(<strong>{token.slice(2, -2)}</strong>)
    else if (token.startsWith("[")) {
      const split = token.indexOf("](")
      out.push(
        <a href={token.slice(split + 2, -1)} target="_blank" rel="noreferrer">
          {token.slice(1, split)}
        </a>,
      )
    } else
      out.push(
        <a href={token} target="_blank" rel="noreferrer">
          {token}
        </a>,
      )
    last = index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block = { kind: "code"; lang: string; text: string } | { kind: "text"; text: string }

function split(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split("\n")
  let buffer: string[] = []
  let code: string[] | undefined
  let lang = ""
  const flush = () => {
    if (buffer.length) blocks.push({ kind: "text", text: buffer.join("\n") })
    buffer = []
  }
  for (const line of lines) {
    const fence = line.match(/^\s*```(\w*)/)
    if (fence && !code) {
      flush()
      code = []
      lang = fence[1] ?? ""
    } else if (fence && code) {
      blocks.push({ kind: "code", lang, text: code.join("\n") })
      code = undefined
    } else if (code) code.push(line)
    else buffer.push(line)
  }
  if (code) blocks.push({ kind: "code", lang, text: code.join("\n") })
  flush()
  return blocks
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined)
}

export function Markdown(props: { text: string }) {
  return (
    <For each={split(props.text)}>
      {(block) =>
        block.kind === "code" ? (
          <div class="mz-codeblock">
            <div class="mz-codeblock-head">
              <span>{block.lang || "terminal"}</span>
              <button type="button" aria-label="Копировать" onClick={() => copy(block.text)}>
                <IconCopy width={18} height={18} />
              </button>
            </div>
            <pre>{block.text}</pre>
          </div>
        ) : (
          <For each={block.text.split(/\n{2,}/).filter((p) => p.trim())}>
            {(paragraph) => (
              <Show
                when={/^\s*[-*]\s/.test(paragraph)}
                fallback={<p>{inline(paragraph.replace(/\n/g, " "))}</p>}
              >
                <ul>
                  <For each={paragraph.split("\n").filter((l) => l.trim())}>
                    {(line) => <li>{inline(line.replace(/^\s*[-*]\s/, ""))}</li>}
                  </For>
                </ul>
              </Show>
            )}
          </For>
        )
      }
    </For>
  )
}
