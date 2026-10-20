import { Component, Match, Switch, createSignal, onCleanup, onMount } from "solid-js"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { Button } from "@opencode/ui/button"
import { Spinner } from "@opencode/ui/spinner"
import { useDialog } from "@opencode/ui/context/dialog"
import { alphaStep, progressPercent, type AlphaProgress } from "@/shell/alpha-update"

type Phase =
  | { name: "checking" }
  | { name: "current"; build?: number }
  | { name: "available"; installed?: number; channel?: number }
  | { name: "downloading"; progress: AlphaProgress }
  | { name: "ready"; channel?: number }
  | { name: "error"; message: string }

const mb = (n: number) => (n / 1024 / 1024).toFixed(1)

// /update: searching for an update, then Download / Skip, then a download window with progress.
export const DialogAlphaUpdate: Component = () => {
  const dialog = useDialog()
  const [phase, setPhase] = createSignal<Phase>({ name: "checking" })
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => timer && clearInterval(timer)

  const watch = () => {
    stop()
    timer = setInterval(async () => {
      try {
        const progress = await alphaStep.progress()
        if (progress.status === "ready") {
          stop()
          setPhase({ name: "ready", channel: progress.channel })
        } else if (progress.status === "error") {
          stop()
          setPhase({ name: "error", message: progress.message || "Download failed" })
        } else setPhase({ name: "downloading", progress })
      } catch (cause) {
        stop()
        setPhase({ name: "error", message: cause instanceof Error ? cause.message : String(cause) })
      }
    }, 500)
  }

  const download = async () => {
    setPhase({ name: "downloading", progress: { status: "downloading", done: 0, total: 0 } })
    try {
      await alphaStep.download()
      watch()
    } catch (cause) {
      setPhase({ name: "error", message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const install = async () => {
    try {
      await alphaStep.install()
      dialog.close()
    } catch (cause) {
      setPhase({ name: "error", message: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  onMount(async () => {
    try {
      const result = await alphaStep.check()
      if (result.status === "available") setPhase({ name: "available", installed: result.installed, channel: result.channel })
      else if (result.status === "up-to-date") setPhase({ name: "current", build: result.installed })
      else setPhase({ name: "error", message: result.message ?? "Update check failed" })
    } catch {
      setPhase({ name: "error", message: "/update works only in the OpenCode++ alpha app on Android." })
    }
  })
  onCleanup(stop)

  const downloading = () => {
    const p = phase()
    return p.name === "downloading" ? p.progress : undefined
  }

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitle>Alpha update</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-4 px-4 pb-4">
          <Switch>
            <Match when={phase().name === "checking"}>
              <div class="flex items-center gap-3">
                <Spinner />
                <span>Searching for an update...</span>
              </div>
            </Match>
            <Match when={phase().name === "current"}>
              <span>You have the latest build.</span>
              <Button variant="neutral" onClick={() => dialog.close()}>Close</Button>
            </Match>
            <Match when={phase().name === "available"}>
              <span>
                New build {(phase() as { channel?: number }).channel} is available (installed{" "}
                {(phase() as { installed?: number }).installed}). Download it?
              </span>
              <div class="flex gap-2">
                <Button variant="neutral" onClick={() => dialog.close()}>Skip</Button>
                <Button variant="contrast" onClick={download}>Download</Button>
              </div>
            </Match>
            <Match when={phase().name === "downloading"}>
              <span>
                Downloading...{" "}
                {downloading() && progressPercent(downloading()!) !== undefined
                  ? `${progressPercent(downloading()!)}% (${mb(downloading()!.done)} / ${mb(downloading()!.total)} MB)`
                  : downloading()
                    ? `${mb(downloading()!.done)} MB`
                    : ""}
              </span>
              <div class="h-2 w-full overflow-hidden rounded bg-background-stronger">
                <div
                  class="h-full bg-text-base"
                  style={{ width: `${progressPercent(downloading() ?? { done: 0, total: 0 }) ?? 5}%` }}
                />
              </div>
            </Match>
            <Match when={phase().name === "ready"}>
              <span>Downloaded and verified (checksum, package, version). Install now?</span>
              <div class="flex gap-2">
                <Button variant="neutral" onClick={() => dialog.close()}>Later</Button>
                <Button variant="contrast" onClick={install}>Install</Button>
              </div>
            </Match>
            <Match when={phase().name === "error"}>
              <span>{(phase() as { message: string }).message}</span>
              <Button variant="neutral" onClick={() => dialog.close()}>Close</Button>
            </Match>
          </Switch>
        </div>
      </DialogBody>
    </Dialog>
  )
}
