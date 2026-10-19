import { Show } from "solid-js"
import { avatarSettings, avatarUrl, type AvatarState } from "./avatar-store"
import { IconCheck, IconCode, IconLaptop, IconPause, IconSpark } from "./icons"

const BADGE: Partial<Record<AvatarState, () => import("solid-js").JSX.Element>> = {
  start: () => <IconSpark />,
  thinking: () => <IconSpark />,
  coding: () => <IconLaptop />,
  waiting: () => <IconPause />,
  done: () => <IconCheck />,
}

/** The seal in the header: animated, and it changes while the agent works. */
export function FenrirAvatar(props: { state: AvatarState; size?: number }) {
  const size = () => props.size ?? 72
  return (
    <div
      class="mz-avatar"
      data-state={props.state}
      data-glow={avatarSettings().glow ? "1" : "0"}
      data-bob={avatarSettings().bob ? "1" : "0"}
      style={{ width: `${size()}px`, height: `${size()}px` }}
      aria-label="Фенрир"
    >
      <img src={avatarUrl(props.state)} alt="" draggable={false} />
      <Show when={BADGE[props.state]}>{(badge) => <span class="mz-avatar-badge">{badge()()}</span>}</Show>
    </div>
  )
}

export { IconCode }
