/**
 * Wraps the decision surfaces so a watcher can see them without being able to touch them.
 *
 * ## Why one wrapper and not `disabled` on every button
 *
 * Thirty-five call sites across fourteen components dispatch an action. Adding a prop and a
 * `disabled` to each is a wide change whose failure mode is silent, and this codebase has already
 * been bitten once by a rule spread across components that did not know about each other — which is
 * what `surfaces.ts` exists to prevent. `App` renders every surface in one place, so the rule is
 * applied in one place too.
 *
 * ## `inert` rather than `pointer-events: none`
 *
 * `inert` is the exact semantic: the subtree is present, and it is not interactive. It also takes
 * the controls out of the accessibility tree and out of tab order, which `pointer-events` does not —
 * a watcher tabbing into a button they cannot press would be a worse bug than a clickable one,
 * because nothing on screen would explain it.
 *
 * React 18 does not type `inert` and warns on `inert={true}`, so it is passed as the empty string
 * behind a cast. That is contained here rather than repeated at every surface, which is most of the
 * point of this component. React 19 types it properly and the cast can go.
 *
 * ## What this does *not* do
 *
 * It is not a security boundary and must never be treated as one. `store.mayAct` refuses the action
 * locally and the server's `actorOf` check refuses it against a client that has been tampered with.
 * This only makes the screen honest about which of those is about to happen.
 */

import type { ReactNode } from 'react'

interface Props {
  /** False when this client is watching somebody else's turn. */
  canAct: boolean
  children: ReactNode
}

/** React 18 has no `inert` in its JSX types; the empty string is the spec's own "present" form. */
const INERT = { inert: '' } as unknown as Record<string, unknown>

export function Watching({ canAct, children }: Props): JSX.Element {
  return (
    <div className={canAct ? 'surfaces' : 'surfaces watching'} {...(canAct ? {} : INERT)}>
      {children}
    </div>
  )
}
