import { createSignal } from "solid-js"
import fenrirDefault from "./assets/fenrir.png"

/** Avatar states: the seal changes picture while the agent works. */
export type AvatarState = "idle" | "start" | "thinking" | "coding" | "waiting" | "done"
export const AVATAR_STATES: AvatarState[] = ["idle", "start", "thinking", "coding", "waiting", "done"]
export const AVATAR_LABEL: Record<AvatarState, string> = {
  idle: "Обычный",
  start: "Начало работы",
  thinking: "Думает",
  coding: "Пишет код",
  waiting: "Ждёт ответа",
  done: "Готово",
}
export const AVATAR_HINT: Record<AvatarState, string> = {
  idle: "Когда ничего не происходит. Основная картинка для всех состояний без своей.",
  start: "Первые секунды после отправки сообщения.",
  thinking: "Агент рассуждает или готовит ответ.",
  coding: "Правит файлы или запускает команды.",
  waiting: "Нужно твоё разрешение.",
  done: "Показывается несколько секунд после окончания работы.",
}

export type AvatarSettings = {
  captions: boolean
  glow: boolean
  bob: boolean
  doneSeconds: number
}
const DEFAULTS: AvatarSettings = { captions: true, glow: true, bob: true, doneSeconds: 4 }
const SETTINGS_KEY = "muse.avatar.settings"
const MAX_BYTES = 6 * 1024 * 1024
const MAX_SIDE = 512

const [settings, setSettingsSignal] = createSignal<AvatarSettings>(load())
const [urls, setUrls] = createSignal<Partial<Record<AvatarState, string>>>({})
const [ready, setReady] = createSignal(false)
const [kinds, setKinds] = createSignal<Partial<Record<AvatarState, string>>>({})

function load(): AvatarSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }
  } catch {
    return DEFAULTS
  }
}

export const avatarSettings = settings
export function updateAvatarSettings(patch: Partial<AvatarSettings>) {
  const next = { ...settings(), ...patch }
  setSettingsSignal(next)
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
  } catch {}
}

// Images live in IndexedDB: GIFs are too big for localStorage.
const DB = "muse-avatar"
const STORE = "image"
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let started = false
export async function initAvatar() {
  if (started) return
  started = true
  try {
    const nextUrls: Partial<Record<AvatarState, string>> = {}
    const nextKinds: Partial<Record<AvatarState, string>> = {}
    for (const state of AVATAR_STATES) {
      const blob = await tx<Blob | undefined>("readonly", (store) => store.get(state))
      if (blob) {
        nextUrls[state] = URL.createObjectURL(blob)
        nextKinds[state] = blob.type
      }
    }
    setUrls(nextUrls)
    setKinds(nextKinds)
  } catch {
    // IndexedDB unavailable: the default Fenrir stays.
  }
  setReady(true)
}

export const avatarReady = ready
export const isCustomAvatar = (state: AvatarState) => !!urls()[state]
export const avatarKind = (state: AvatarState) => kinds()[state]
export const defaultAvatarUrl = fenrirDefault

/** Picture for a state: its own, else the "idle" one, else the built-in Fenrir. */
export function avatarUrl(state: AvatarState): string {
  const all = urls()
  return all[state] ?? all.idle ?? fenrirDefault
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode"))), "image/webp", 0.9),
  )
}

export type SetAvatarResult = { ok: true } | { ok: false; error: string }

export async function setAvatarImage(state: AvatarState, file: File): Promise<SetAvatarResult> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Нужна картинка или GIF" }
  const animated = file.type === "image/gif" || file.type === "image/webp" || file.type === "image/apng"
  // Animated files are kept as they are (a canvas would flatten them to one frame).
  if (animated && file.size > MAX_BYTES) return { ok: false, error: "GIF больше 6 МБ. Возьми поменьше." }
  try {
    const blob = animated ? file : await shrink(file)
    await tx("readwrite", (store) => store.put(blob, state))
    const old = urls()[state]
    if (old) URL.revokeObjectURL(old)
    setUrls({ ...urls(), [state]: URL.createObjectURL(blob) })
    setKinds({ ...kinds(), [state]: blob.type })
    return { ok: true }
  } catch {
    return { ok: false, error: "Не получилось сохранить картинку" }
  }
}

export async function clearAvatarImage(state: AvatarState) {
  try {
    await tx("readwrite", (store) => store.delete(state))
  } catch {}
  const old = urls()[state]
  if (old) URL.revokeObjectURL(old)
  const nextUrls = { ...urls() }
  const nextKinds = { ...kinds() }
  delete nextUrls[state]
  delete nextKinds[state]
  setUrls(nextUrls)
  setKinds(nextKinds)
}

export async function resetAvatar() {
  for (const state of AVATAR_STATES) await clearAvatarImage(state)
  updateAvatarSettings(DEFAULTS)
}
