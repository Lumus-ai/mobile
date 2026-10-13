import { createSignal, type JSX } from "solid-js"
import { useTheme } from "../context/theme"

type Props = {
  id?: string
  onClick: () => void
  children: JSX.Element
  disabled?: boolean
  flexShrink?: number
  flexGrow?: number
  minWidth?: number
  maxWidth?: number
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  gap?: number
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around"
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// A clickable action gets a background highlight across its entire hit area, not just
// brighter text. Stop pointer events from reaching parent rows so buttons never trigger
// the row's action as well.
export function HoverAction(props: Props) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)

  return (
    <box
      id={props.id}
      flexShrink={props.flexShrink ?? 0}
      flexGrow={props.flexGrow}
      minWidth={props.minWidth}
      maxWidth={props.maxWidth}
      paddingLeft={props.paddingLeft ?? 1}
      paddingRight={props.paddingRight ?? 1}
      paddingTop={props.paddingTop}
      paddingBottom={props.paddingBottom}
      gap={props.gap}
      justifyContent={props.justifyContent}
      backgroundColor={hovered() && !props.disabled ? theme.increase(theme.background.base, 4) : undefined}
      onMouseOver={(event) => {
        event.stopPropagation()
        setHovered(true)
        props.onMouseEnter?.()
      }}
      onMouseOut={(event) => {
        event.stopPropagation()
        setHovered(false)
        props.onMouseLeave?.()
      }}
      onMouseUp={(event) => {
        event.stopPropagation()
        if (!props.disabled) props.onClick()
      }}
    >
      {props.children}
    </box>
  )
}
