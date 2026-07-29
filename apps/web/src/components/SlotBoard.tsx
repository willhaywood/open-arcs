/**
 * Your resource slots, as the board rather than as a list of sentences.
 *
 * The rule is *"when you take or are given a resource you may rearrange any resources in your
 * resource slots, but you must discard resources you cannot hold"*, and both halves are the same
 * physical act: you push tokens along the row until it looks how you want it. So this is the row,
 * at a size you can drag on, and every drop is one engine action.
 *
 * **Where a token sits matters**, which is the whole reason this screen exists. Each slot prints a
 * key cost, and a raider pays *that slot's* price to steal what is in it — so a 3-key slot is
 * where your Relic belongs and a 1-key slot is what you leave exposed. The printed cost is drawn
 * above every slot for exactly that reason.
 *
 * Three drops, matching the three things the engine offers:
 *
 *   - onto an **empty** slot — it moves there;
 *   - onto an **occupied** slot, from another slot — the two **swap**, and nothing is lost;
 *   - onto an **occupied** slot, from the arrivals tray — the occupant is **ejected** to the
 *     supply, which is what "you must discard resources you cannot hold" looks like when you do it
 *     with your hands.
 *
 * Dragging is pointer-based rather than HTML5 drag-and-drop, so it works under touch and so the
 * token can follow the cursor. **A press that does not move is a lift**, left in the air for a
 * second click to place — the accessible path, and the one the tests drive. Escape puts it down.
 *
 * The screen renders exactly the moves it was offered and invents nothing: a slot is a legal
 * target only if an action exists for it.
 */

import { citiesInReserve } from '@arcs/engine'
import type { Action, Continue, FactionId, GameState, Resource } from '@arcs/engine'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { CITIES_PER_FACTION, groupSlots, slotRow } from '../slots.js'
import type { SlotInfo } from '../slots.js'
import { store } from '../store.js'
import { colorOf, figureArt } from '../theme.js'

const iconFor = (r: Resource): string => `/game-assets/icon/${r.toLowerCase()}.webp`

/** The resource a token id names, e.g. `Fuel#5`. */
const resourceOf = (token: string): Resource => token.slice(0, token.indexOf('#')) as Resource

interface Move {
  action: Action
  token: string
  to: string
  /** Set when landing here throws the occupant away. */
  eject: string | undefined
  /** Set when the two tokens change places. */
  swap: string | undefined
}

export function SlotBoard({ state, cont }: { state: GameState; cont: Continue }): JSX.Element | null {
  /** The token in the air, if any, and where the pointer has dragged it — null until it moves. */
  const [held, setHeld] = useState<string | null>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  // Pointer handlers are bound to the window and must read the current lift without re-binding.
  const heldRef = useRef<string | null>(null)
  /** Is the button still down? Only then is movement a drag. */
  const downRef = useRef(false)
  const movedRef = useRef(false)

  const asked = cont.kind === 'ask' ? cont.actions : []
  const moves: Move[] = asked
    .filter((a) => a.type === 'resources/arrange-move')
    .map((a) => ({
      action: a,
      token: String(a['token']),
      to: String(a['to']),
      eject: a['eject'] === undefined ? undefined : String(a['eject']),
      swap: a['swap'] === undefined ? undefined : String(a['swap']),
    }))
  const discards = asked.filter((a) => a.type === 'resources/arrange-discard')
  const done = asked.find((a) => a.type === 'resources/arrange-done')
  const open = moves.length > 0 || discards.length > 0

  const moveFor = (token: string, to: string): Move | undefined =>
    moves.find((m) => m.token === token && m.to === to)
  const discardFor = (token: string): Action | undefined =>
    discards.find((a) => String(a['token']) === token)

  /** Put `token` down on `drop`, if the engine offered that. Clears the lift either way. */
  function release(token: string, drop: string): void {
    put(null)
    if (drop === 'discard') {
      const d = discardFor(token)
      if (d !== undefined) store.apply(d)
      return
    }
    const m = moveFor(token, drop)
    if (m !== undefined) store.apply(m.action)
  }

  function put(token: string | null): void {
    heldRef.current = token
    movedRef.current = false
    downRef.current = token !== null
    setHeld(token)
    setAt(null)
  }

  /*
   * Follow the pointer, and drop on release — but only if the pointer moved **while the button was
   * down**. That qualifier is the whole difference between the two ways of using this screen: a
   * press that goes nowhere is a *lift*, and waits for a second click to place it. Without it,
   * moving the mouse after a click-lift armed the next click to drop the token wherever the cursor
   * happened to be, which quietly discarded resources.
   */
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (heldRef.current === null || !downRef.current) return
      movedRef.current = true
      setAt({ x: e.clientX, y: e.clientY })
    }
    const onUp = (e: PointerEvent): void => {
      const token = heldRef.current
      const dragged = downRef.current && movedRef.current
      downRef.current = false
      if (token === null || !dragged) return
      const target = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el): el is HTMLElement => el instanceof HTMLElement && el.dataset['drop'] !== undefined)
      if (target === undefined) {
        put(null)
        return
      }
      release(token, target.dataset['drop']!)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') put(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  })

  // A token left in the air when the step resolves would carry into the next one.
  useEffect(() => {
    if (!open && heldRef.current !== null) put(null)
  }, [open])

  if (!open || cont.kind !== 'ask') return null

  const faction = cont.faction
  /*
   * The **whole** row, not just the slots the engine offered — the covered ones are why you have
   * so few, and hiding them makes the board a mystery. Read from state through the same helper the
   * player board uses, so the two cannot disagree about which city covers what.
   */
  const row = slotRow(state, faction)
  const built = CITIES_PER_FACTION - citiesInReserve(state, faction)
  const city = figureArt(faction, 'city')
  /** Tokens waiting to land: offered a move but sitting in no slot. */
  const inSlots = new Set(row.map((s) => s.token).filter((t): t is string => t !== undefined))
  const arrivals = [...new Set(moves.map((m) => m.token))].filter((t) => !inSlots.has(t))

  const legal = (slot: string): boolean => held !== null && moveFor(held, slot) !== undefined

  return createPortal(
    <div className="da-backdrop" onClick={() => put(null)} role="presentation">
      <div className="da-modal sb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="da-head">
          <span className="da-title">Resource slots</span>
          <span className="da-prompt" style={{ color: colorOf(faction as FactionId) }}>
            {cont.prompt ?? faction}
          </span>
        </div>

        {arrivals.length > 0 ? (
          <section className="sb-tray">
            <h3 className="da-force-head">Arriving — no room for it as things stand</h3>
            <div className="sb-tokens" data-drop="arrivals">
              {arrivals.map((t) => (
                <Token key={t} token={t} held={held === t} onDown={() => put(t)} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="sb-row">
          <div className="sb-slots">
            {groupSlots(row).map((group, gi) => (
              <div
                key={gi}
                className={`sb-group${group.locked ? ' locked' : ''}`}
                title={
                  group.locked
                    ? `Covered by one of your cities — build ${group.needs - built} more to open ` +
                      `${group.items.length > 1 ? `these ${group.items.length} slots` : 'this slot'}`
                    : undefined
                }
              >
                {group.items.map((slot) => (
                  <Slot
                    key={slot.id}
                    slot={slot}
                    move={held === null ? undefined : moveFor(held, slot.id)}
                    legal={legal(slot.id)}
                    heldToken={held}
                    onDrop={() => {
                      if (held !== null) release(held, slot.id)
                    }}
                    onLift={(t) => put(t)}
                  />
                ))}
                {group.locked && city !== null ? (
                  <img className="sb-city" src={city} alt={`${faction} city`} />
                ) : null}
              </div>
            ))}

            {/* Hard right, away from the row: dropping here is losing the resource, not moving it. */}
            <div
              className={`sb-bin${held !== null && discardFor(held) !== undefined ? ' legal' : ''}`}
              data-drop="discard"
              onClick={() => {
                if (held !== null) release(held, 'discard')
              }}
              title="Return this resource to the supply"
            >
              <div className="sb-well bin" />
              <span className="sb-bin-label">Return to supply</span>
            </div>
          </div>
        </section>

        <div className="da-actions">
          <button
            className="sb-done"
            disabled={done === undefined}
            onClick={() => {
              if (done !== undefined) store.apply(done)
            }}
          >
            {done === undefined ? 'Make room first' : 'Done'}
          </button>
        </div>

        <p className="da-note">Drag resources to re-arrange. Dropping onto a full slot swaps them.</p>
      </div>

      {at !== null && held !== null ? (
        <img className="sb-ghost" src={iconFor(resourceOf(held))} alt="" style={{ left: at.x, top: at.y }} />
      ) : null}
    </div>,
    document.body,
  )
}

/**
 * One slot: its printed raid cost above, its well below, and — when a city still covers it — the
 * city token drawn over the group by the caller.
 *
 * A covered slot is not a drop target and takes no pointer events; it is here to show *why* the
 * row is as short as it is.
 */
function Slot({
  slot,
  move,
  legal,
  heldToken,
  onDrop,
  onLift,
}: {
  slot: SlotInfo
  move: Move | undefined
  legal: boolean
  heldToken: string | null
  onDrop: () => void
  onLift: (token: string) => void
}): JSX.Element {
  return (
    <div
      className={
        'sb-slot' +
        (slot.locked ? ' locked' : '') +
        (legal ? ' legal' : '') +
        (move?.eject !== undefined ? ' ejects' : '') +
        (move?.swap !== undefined ? ' swaps' : '')
      }
      data-drop={slot.locked ? undefined : slot.id}
      onClick={slot.locked ? undefined : onDrop}
      title={
        slot.locked
          ? undefined // the group carries the explanation
          : move?.eject !== undefined
            ? `Land here — the ${resourceOf(move.eject)} is returned to the supply`
            : move?.swap !== undefined
              ? `Swap with the ${resourceOf(move.swap)}`
              : `Costs ${slot.keys} keys to raid`
      }
    >
      <img
        className="sb-keys"
        src={`/game-assets/icon/keys-${slot.keys}.webp`}
        alt={`${slot.keys} keys`}
      />
      <div className="sb-well">
        {slot.token === undefined ? null : (
          <Token
            token={slot.token}
            held={heldToken === slot.token}
            onDown={() => onLift(slot.token!)}
          />
        )}
      </div>
    </div>
  )
}

function Token({
  token,
  held,
  onDown,
}: {
  token: string
  held: boolean
  onDown: () => void
}): JSX.Element {
  const r = resourceOf(token)
  return (
    <img
      className={`sb-token${held ? ' held' : ''}`}
      src={iconFor(r)}
      alt={r}
      title={r}
      draggable={false}
      onPointerDown={(e) => {
        e.stopPropagation()
        onDown()
      }}
      // Kept off the slot beneath, so lifting a token never counts as clicking its slot.
      onClick={(e) => e.stopPropagation()}
    />
  )
}
