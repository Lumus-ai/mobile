import { createSignal, For, onCleanup, Show } from "solid-js"
import {
  AVATAR_HINT, AVATAR_LABEL, AVATAR_STATES, avatarKind, avatarSettings, avatarUrl, clearAvatarImage, isCustomAvatar,
  resetAvatar, setAvatarImage, updateAvatarSettings, type AvatarState,
} from "./avatar-store"
import { FenrirAvatar } from "./avatar"
import { IconImage, IconTrash } from "./icons"

const CAPTIONS: Record<AvatarState, string> = {
  idle: "",
  start: "Начинает работу",
  thinking: "Думает",
  coding: "Пишет код · MainActivity.kt",
  waiting: "Ждёт разрешения",
  done: "Готово",
}

function Slot(props: { state: AvatarState; onError: (message?: string) => void }) {
  let input!: HTMLInputElement
  const pick = async (file: File | undefined) => {
    if (!file) return
    const result = await setAvatarImage(props.state, file)
    props.onError(result.ok ? undefined : result.error)
    input.value = ""
  }
  return (
    <div class="mz-slot">
      <div class="mz-slot-pic">
        <img src={avatarUrl(props.state)} alt="" />
      </div>
      <div class="mz-slot-text">
        <strong>{AVATAR_LABEL[props.state]}</strong>
        <span class="mz-muted">{AVATAR_HINT[props.state]}</span>
        <span class="mz-slot-kind">
          {isCustomAvatar(props.state)
            ? avatarKind(props.state) === "image/gif"
              ? "своя GIF"
              : "своя картинка"
            : props.state === "idle"
              ? "Фенрир по умолчанию"
              : "как «Обычный»"}
        </span>
      </div>
      <div class="mz-slot-actions">
        <button type="button" class="mz-icon-btn" aria-label="Выбрать" onClick={() => input.click()}>
          <IconImage width={20} height={20} />
        </button>
        <Show when={isCustomAvatar(props.state)}>
          <button type="button" class="mz-icon-btn" aria-label="Сбросить" onClick={() => void clearAvatarImage(props.state)}>
            <IconTrash width={20} height={20} />
          </button>
        </Show>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.currentTarget.files?.[0])} />
      </div>
    </div>
  )
}

function Toggle(props: { label: string; hint?: string; on: boolean; set: (value: boolean) => void }) {
  return (
    <button type="button" class="mz-toggle-row" onClick={() => props.set(!props.on)} role="switch" aria-checked={props.on}>
      <span class="mz-row-text">
        <span class="mz-row-title">{props.label}</span>
        <Show when={props.hint}>
          <span class="mz-row-sub">{props.hint}</span>
        </Show>
      </span>
      <span class="mz-switch" data-on={props.on ? "1" : "0"}>
        <span />
      </span>
    </button>
  )
}

export function AvatarSettingsScreen() {
  const [error, setError] = createSignal<string>()
  const [preview, setPreview] = createSignal<AvatarState>("idle")
  let timer: ReturnType<typeof setInterval> | undefined
  const play = () => {
    clearInterval(timer)
    const order: AvatarState[] = ["start", "thinking", "coding", "waiting", "done", "idle"]
    let index = 0
    setPreview(order[0])
    timer = setInterval(() => {
      index += 1
      if (index >= order.length) {
        clearInterval(timer)
        return
      }
      setPreview(order[index])
    }, 1500)
  }
  onCleanup(() => clearInterval(timer))
  return (
    <div class="mz-page">
      <div class="mz-card mz-preview">
        <FenrirAvatar state={preview()} size={112} />
        <p class="mz-preview-caption">{avatarSettings().captions ? CAPTIONS[preview()] || "OpenCode++" : "OpenCode++"}</p>
        <button type="button" class="mz-btn mz-btn-blue" onClick={play}>
          Показать все состояния
        </button>
      </div>
      <p class="mz-muted mz-pad">
        Выбери своё фото или GIF для каждого состояния. Нет своей картинки для состояния: берётся «Обычный», а состояние видно по свечению и значку. GIF до 6 МБ, фото сжимается само.
      </p>
      <Show when={error()}>
        <div class="mz-error" onClick={() => setError(undefined)}>{error()}</div>
      </Show>
      <div class="mz-group">
        <For each={AVATAR_STATES}>{(state) => <Slot state={state} onError={setError} />}</For>
      </div>
      <p class="mz-section">Поведение</p>
      <div class="mz-group">
        <Toggle label="Подпись действия" hint="Под именем: «Пишет код · файл»" on={avatarSettings().captions} set={(captions) => updateAvatarSettings({ captions })} />
        <Toggle label="Свечение при работе" on={avatarSettings().glow} set={(glow) => updateAvatarSettings({ glow })} />
        <Toggle label="Покачивание" hint="Лёгкое движение аватара" on={avatarSettings().bob} set={(bob) => updateAvatarSettings({ bob })} />
        <div class="mz-toggle-row mz-stepper">
          <span class="mz-row-text">
            <span class="mz-row-title">Показывать «Готово»</span>
            <span class="mz-row-sub">{avatarSettings().doneSeconds} сек.</span>
          </span>
          <input
            type="range"
            min="1"
            max="10"
            value={avatarSettings().doneSeconds}
            onInput={(e) => updateAvatarSettings({ doneSeconds: Number(e.currentTarget.value) })}
          />
        </div>
      </div>
      <button type="button" class="mz-btn mz-btn-danger mz-btn-wide mz-mt" onClick={() => void resetAvatar()}>
        Сбросить аватар
      </button>
    </div>
  )
}
