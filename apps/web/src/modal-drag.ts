/**
 * Drag a modal out of the way of the board.
 *
 * The console dialogs (battle, the court shelf, raids, slot arranging, the tray's card modals)
 * sit centred over the map — and the map is often exactly what the decision is about. Every one
 * of them shares the `.da-backdrop > .da-modal > .da-head` shape, so one hook gives them all the
 * same behaviour: grab the header, drag the dialog anywhere on screen, and the backdrop's dim
 * thins out once you have moved it — you dragged it aside *to look*, so the look gets brighter.
 *
 * Pointer capture on the header keeps the drag alive outside the element without window
 * listeners; a guard ignores presses on buttons so header controls stay clickable. The offset is
 * clamped so a good handful of the dialog always stays on screen — a modal you can lose is a
 * game you cannot finish. Position resets when the modal unmounts, which is per decision: the
 * battle window keeps its spot across the battle's steps, the next battle opens centred again.
 */

import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'

/** How much of the dialog must remain visible past each screen edge, in px. */
const KEEP = 120

export interface ModalDrag {
  /** True once the user has moved the dialog — the backdrop thins (`.da-backdrop.aside`). */
  dragged: boolean
  /** Goes on the `.da-modal` element. */
  ref: RefObject<HTMLDivElement>
  style: CSSProperties | undefined
  /** Spread onto the `.da-head` element — it becomes the drag handle. */
  handle: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    style: CSSProperties
  }
}

export function useModalDrag(): ModalDrag {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  /** The press that started the drag: pointer position and the offset it grabbed at. */
  const grip = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // A press on a control in the header is a click, not a drag.
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea') !== null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    grip.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const g = grip.current
    if (g === null) return
    let x = g.ox + e.clientX - g.px
    let y = g.oy + e.clientY - g.py
    const r = ref.current?.getBoundingClientRect()
    if (r !== undefined) {
      // The rect already includes the current offset; clamp the prospective position.
      const dx = x - offset.x
      const dy = y - offset.y
      const left = r.left + dx
      const top = r.top + dy
      if (left < KEEP - r.width) x += KEEP - r.width - left
      if (left > window.innerWidth - KEEP) x -= left - (window.innerWidth - KEEP)
      if (top < 0) y -= top
      if (top > window.innerHeight - 60) y -= top - (window.innerHeight - 60)
    }
    setOffset({ x, y })
  }

  const onPointerUp = (): void => {
    grip.current = null
  }

  const at = offset.x !== 0 || offset.y !== 0
  return {
    dragged: at,
    ref,
    style: at ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      style: { cursor: 'grab', touchAction: 'none', userSelect: 'none' },
    },
  }
}
