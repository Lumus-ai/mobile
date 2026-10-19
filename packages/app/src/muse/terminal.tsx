import { createSignal, onCleanup, onMount, Show } from "solid-js"

const BASE = "http://127.0.0.1:4097"

type TermStatus = {
  proot: boolean
  launcher: boolean
  installed: boolean
  distro: string | null
  name: string | null
  installing: boolean
  job: { phase: string; pct: number; msg: string; error: string | null; distro: string | null }
}

function authHeader() {
  const info = (window as { __OPENCODE_EMBEDDED__?: { password?: string } }).__OPENCODE_EMBEDDED__
  return info?.password ? { authorization: "Basic " + btoa("opencode:" + info.password) } : {}
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...authHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
  return json as T
}

const PHASE: Record<string, string> = {
  download: "Скачивание",
  extract: "Распаковка",
  check: "Проверка запуска",
  done: "Готово",
  error: "Ошибка",
}

export function TerminalScreen() {
  const [status, setStatus] = createSignal<TermStatus>()
  const [error, setError] = createSignal<string>()
  const [distro, setDistro] = createSignal<"alpine" | "debian">("alpine")
  const [cmd, setCmd] = createSignal("uname -a; cat /etc/os-release | head -2")
  const [out, setOut] = createSignal("")
  const [running, setRunning] = createSignal(false)
  let timer: ReturnType<typeof setInterval> | undefined

  const refresh = async () => {
    try {
      setStatus(await call<TermStatus>("/term/status"))
      setError(undefined)
    } catch (e) {
      setStatus(undefined)
      setError("Помощник терминала недоступен. Сервер ещё запускается или это сборка без терминала.")
    }
  }
  onMount(() => {
    void refresh()
    timer = setInterval(() => void refresh(), 1200)
  })
  onCleanup(() => clearInterval(timer))

  const install = async () => {
    try {
      await call("/term/install", { distro: distro() })
      void refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }
  const remove = async () => {
    if (!confirm("Удалить Linux-окружение? Файлы проектов не пострадают.")) return
    try {
      await call("/term/remove", {})
      setOut("")
      void refresh()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }
  const run = async () => {
    setRunning(true)
    try {
      const r = await call<{ code: number; out: string }>("/term/exec", { cmd: cmd(), timeout: 60000 })
      setOut(`${r.out}\n[код выхода ${r.code}]`)
    } catch (e) {
      setOut(String(e instanceof Error ? e.message : e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div class="mz-page">
      <div class="mz-card">
        <h3>Терминал для ИИ</h3>
        <p class="mz-muted">
          Свой Linux прямо в приложении (proot). Когда он установлен, инструмент bash у Фенрира выполняет команды в нём:
          apt или apk, git, python и всё остальное. Папка проектов доступна по тому же пути. Каждую команду по-прежнему
          подтверждаешь ты, как и раньше.
        </p>
        <Show when={status()} fallback={<p class="mz-muted">{error() ?? "Проверяю…"}</p>}>
          {(s) => (
            <>
              <Show when={!s().launcher || !s().proot}>
                <p class="mz-error">В этой сборке нет нативных частей терминала (proot). Нужна сборка с терминалом.</p>
              </Show>
              <Show when={s().installed}>
                <p>
                  Установлено: <strong>{s().distro === "debian" ? "Debian" : "Alpine"}</strong>
                  <span class="mz-muted"> · {s().name}</span>
                </p>
              </Show>
              <Show when={s().installing}>
                <p>
                  {PHASE[s().job.phase] ?? s().job.phase}: {s().job.msg} {s().job.pct}%
                </p>
                <div class="mz-progress">
                  <div style={{ width: `${s().job.pct}%` }} />
                </div>
              </Show>
              <Show when={!s().installing && s().job.error}>
                <p class="mz-error">Не получилось: {s().job.error}</p>
              </Show>
            </>
          )}
        </Show>
      </div>

      <Show when={status() && !status()!.installed && !status()!.installing && status()!.proot}>
        <div class="mz-card">
          <h3>Выбери систему</h3>
          <div class="mz-seg">
            <button type="button" classList={{ on: distro() === "alpine" }} onClick={() => setDistro("alpine")}>
              Alpine
              <small>~4 МБ, лёгкий, apk</small>
            </button>
            <button type="button" classList={{ on: distro() === "debian" }} onClick={() => setDistro("debian")}>
              Debian
              <small>~30 МБ, привычный, apt</small>
            </button>
          </div>
          <p class="mz-muted">Скачивается один раз по интернету и проверяется по контрольной сумме. Нужно около 400 МБ места.</p>
          <button type="button" class="mz-btn mz-btn-blue mz-btn-wide" onClick={install}>
            Установить терминал
          </button>
        </div>
      </Show>

      <Show when={status()?.installed}>
        <div class="mz-card">
          <h3>Проверка</h3>
          <textarea class="mz-term-input" value={cmd()} onInput={(e) => setCmd(e.currentTarget.value)} rows={2} spellcheck={false} />
          <button type="button" class="mz-btn mz-btn-blue mz-btn-wide" disabled={running()} onClick={run}>
            {running() ? "Выполняю…" : "Выполнить в Linux"}
          </button>
          <Show when={out()}>
            <pre class="mz-term-out">{out()}</pre>
          </Show>
        </div>
        <button type="button" class="mz-btn mz-btn-danger mz-btn-wide" onClick={remove}>
          Удалить окружение
        </button>
      </Show>
      <p class="mz-muted mz-licence">
        Запуск Linux использует proot (GPL-2, исходники: github.com/green-green-avk/proot). Сам Alpine и Debian поставляются под своими лицензиями и скачиваются с их официальных серверов.
      </p>
      <Show when={error() && status()}>
        <p class="mz-error">{error()}</p>
      </Show>
    </div>
  )
}
