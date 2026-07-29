/**
 * Battle resolution, as a modal: the dice, then both fleets laid out side by side to take the
 * damage.
 *
 * Assigning hits by hunting for pulsing rings on the map made you read the board twice — once to
 * find the pieces, once to work out which were still legal targets. Here the whole engagement is
 * on one surface: your force above, theirs below, every piece a sprite. A click damages a fresh
 * piece, a second click destroys it, which is exactly the engine's health model.
 *
 * Two things this gets right that the map could not:
 *
 *  - **Destroyed pieces stay put.** A destroyed figure leaves the system, so reading live state
 *    alone would drop it and the row would reflow under the cursor. The roster is the pieces in
 *    the system *plus* everything this battle has already hit, recovered from the journal — so
 *    it is derived, not snapshotted, and stays right through undo, remount and loading a save
 *    mid-assignment. Destroyed pieces render as the colourless `*-empty` silhouette in place.
 *  - **Undo.** Every hit is a journalled action, so stepping back is just replaying the journal
 *    minus the trailing hits. "Start over" returns to the moment after the roll.
 *
 * Legality is never decided here: a piece is clickable exactly when the engine is offering a
 * `battle/hit` for it, which is what keeps the phase order (own ships → enemy ships → enemy
 * buildings) and the Cities-only-when-buildings-are-hit rule honest.
 */

import { Location, contentsOf, parseFigureId } from '@arcs/engine'
import type { Action, GameState } from '@arcs/engine'


import { store } from '../store.js'
import { colorOf, figureArt } from '../theme.js'
import { useRoll } from './Dice3D.js'

/** The battle context the hit/finish actions carry. */
interface Ctx {
  faction: string
  system: string
  enemy: string
  self: number
  ships: number
  buildings: number
  keys: number
  intercepted?: number
  /** Set for the Railgun Arrays volley, which lands its hit *before* any dice are collected. */
  railgun?: boolean
}

interface RosterPiece {
  id: string
  color: string
  piece: string
}

/** Piece -> art basename, matching the board. */
const PIECE_ART: Record<string, string> = {
  Ship: 'ship',
  City: 'city',
  Starport: 'starport',
  Agent: 'agent',
}

/**
 * The colourless silhouette left behind when a piece is destroyed. These are the same
 * empty-slot assets the board uses for unbuilt building slots.
 */
const EMPTY_ART: Record<string, string> = {
  Ship: 'ship-empty',
  City: 'building-empty',
  Starport: 'building-empty',
  Agent: 'agent-empty',
}

/** Ships first, then the buildings behind them, then anything else. */
const ORDER: Record<string, number> = { Ship: 0, Starport: 1, City: 2, Agent: 3 }

/**
 * The hits placed so far in this battle — the trailing run of journalled `battle/hit` actions,
 * newest last. Their targets are how destroyed pieces are recovered for the roster: the figure
 * has left the system by then, but the action that killed it names it.
 */
function hitsThisBattle(journal: readonly string[]): string[] {
  const targets: string[] = []
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i]!
    if (!entry.startsWith('battle/hit(')) break
    const m = /target="([^"]+)"/.exec(entry)
    if (m !== null) targets.unshift(m[1]!)
  }
  return targets
}

/** Everything of `color` involved in this battle: still in the system, or already hit in it. */
function rosterFor(
  state: GameState,
  system: string,
  color: string,
  touched: readonly string[],
): RosterPiece[] {
  const ids = new Set([...contentsOf(state.figures, Location.system(system)), ...touched])
  return [...ids]
    .map((id) => ({ id, ...parseFigureId(id) }))
    .filter((f) => f.color === color)
    .map((f) => ({ id: f.id, color: f.color, piece: f.piece }))
    .sort((a, b) => (ORDER[a.piece] ?? 9) - (ORDER[b.piece] ?? 9) || a.id.localeCompare(b.id))
}

export function DamageAssign({
  state,
  ctx,
  hits,
  done,
  lastRoll,
}: {
  state: GameState
  ctx: Ctx
  hits: readonly Action[]
  done: Action | undefined
  lastRoll: GameState['lastRoll']
}): JSX.Element {
  const placed = hitsThisBattle(state.journal)
  /*
   * Where this battle's roll sits in the journal — it is the entry just before the run of hits.
   * Used to tell one roll from another with the same faces, so undoing back in does not replay
   * the tumble while a genuinely new roll still does. Stable while hits are placed and undone,
   * since journal and hit count move together.
   */
  const rollAt = state.journal.length - placed.length - 1
  /*
   * `lastRoll` is absent for the Railgun Arrays volley — it strikes before the attacker collects
   * dice, so there is no roll to show and `rollAt` points at the `battle/target` entry instead.
   * `useRoll` renders nothing and reports settled immediately in that case, so the assignment is
   * usable rather than waiting on a tumble that will never come.
   */
  const { rolling, row } = useRoll(lastRoll, String(rollAt))
  const mine = rosterFor(state, ctx.system, ctx.faction, placed)
  const theirs = rosterFor(state, ctx.system, ctx.enemy, placed)

  const onBoard = new Set(contentsOf(state.figures, Location.system(ctx.system)))
  const byTarget = new Map(hits.map((a) => [a['target'] as string, a]))
  const phase = hits[0]?.['phase'] as 'self' | 'ships' | 'buildings' | undefined

  const assigned = placed.length
  /*
   * Step back one journalled action, whatever it happens to be.
   *
   * This used to be disabled until a hit had been placed, which made the moment right after a
   * roll a dead end: nothing to undo here, and the modal's own backdrop covers the toolbar's
   * Undo. With nothing placed the previous entry is the roll itself, so undoing walks back out
   * of the battle to the dice — which is what "keep going back" has to mean.
   */
  const undoLast = (): void => store.undo()
  const startOver = (): void => {
    for (let i = 0; i < assigned; i++) store.undo()
  }

  const prompt =
    phase === 'self'
      ? `Assign ${ctx.self} self-hit${ctx.self === 1 ? '' : 's'} — pick your own ships`
      : phase === 'ships'
        ? `Assign ${ctx.ships} hit${ctx.ships === 1 ? '' : 's'} to ${ctx.enemy} ships`
        : phase === 'buildings'
          ? `Assign ${ctx.buildings} hit${ctx.buildings === 1 ? '' : 's'} to ${ctx.enemy} buildings`
          : assigned > 0
            ? 'Damage assigned — confirm, or start over'
            : 'No effect — the dice came up empty'

  return (
    <>
      {row}

      {!rolling ? (
        <>
          <div className="bt-tally da-tally">
            {chip('Self', ctx.self)}
            {chip('Ships', ctx.ships)}
            {chip('Buildings', ctx.buildings)}
            {chip('Keys', ctx.keys)}
          </div>
          {ctx.railgun === true ? (
            <div className="da-note">
              Railgun Arrays — {ctx.enemy} strikes first, before you collect any dice.
            </div>
          ) : null}
          {(ctx.intercepted ?? 0) > 0 ? (
            <div className="da-note">
              Intercepted — {ctx.intercepted} of those self-hits are {ctx.enemy} striking back.
            </div>
          ) : null}

          <div className={`da-prompt${phase === 'self' ? ' warn' : ''}`}>{prompt}</div>

          <Force
            label="Your force"
            color={ctx.faction}
            pieces={mine}
            onBoard={onBoard}
            damaged={state.damaged}
            byTarget={byTarget}
            active={phase === 'self'}
          />
          <Force
            label={`${ctx.enemy} force`}
            color={ctx.enemy}
            pieces={theirs}
            onBoard={onBoard}
            damaged={state.damaged}
            byTarget={byTarget}
            active={phase === 'ships' || phase === 'buildings'}
          />

          <div className="da-actions">
            <button className="da-ghost" onClick={undoLast} disabled={!store.canUndo()}>
              {assigned > 0 ? 'Undo last' : 'Undo roll'}
            </button>
            <button className="da-ghost" onClick={startOver} disabled={assigned === 0}>
              Start over
            </button>
            <span className="da-spacer" />
            {done !== undefined ? (
              <button className="da-confirm" onClick={() => store.apply(done)}>
                Confirm
              </button>
            ) : (
              <span className="da-remaining">
                {ctx.self + ctx.ships + ctx.buildings} left to place
              </span>
            )}
          </div>
        </>
      ) : null}
    </>
  )
}

/**
 * Both fleets, shown without any pending hits — the context the gather step needs, since the
 * dice you may roll are capped by the ships you have here and Raid dice need enemy buildings.
 */
export function Forces({
  state,
  system,
  faction,
  enemy,
}: {
  state: GameState
  system: string
  faction: string
  enemy: string
}): JSX.Element {
  const onBoard = new Set(contentsOf(state.figures, Location.system(system)))
  const none = new Map<string, Action>()
  return (
    <>
      <Force
        label="Your force"
        color={faction}
        pieces={rosterFor(state, system, faction, [])}
        onBoard={onBoard}
        damaged={state.damaged}
        byTarget={none}
        active
      />
      <Force
        label={`${enemy} force`}
        color={enemy}
        pieces={rosterFor(state, system, enemy, [])}
        onBoard={onBoard}
        damaged={state.damaged}
        byTarget={none}
        active
      />
    </>
  )
}

function chip(label: string, n: number): JSX.Element | null {
  if (n <= 0) return null
  return (
    <span className="bt-chip">
      {label}: <strong>{n}</strong>
    </span>
  )
}

function Force({
  label,
  color,
  pieces,
  onBoard,
  damaged,
  byTarget,
  active,
}: {
  label: string
  color: string
  pieces: readonly RosterPiece[]
  onBoard: ReadonlySet<string>
  damaged: readonly string[]
  byTarget: ReadonlyMap<string, Action>
  /** Whether this side is the one currently taking hits — dims the other. */
  active: boolean
}): JSX.Element {
  return (
    <div className={`da-force${active ? ' active' : ''}`}>
      <div className="da-force-head" style={{ borderColor: colorOf(color) }}>
        {label}
      </div>
      <div className="da-row">
        {pieces.length === 0 ? (
          <span className="da-empty-note">nothing here</span>
        ) : (
          pieces.map((p) => (
            <PieceCell
              key={p.id}
              piece={p}
              status={!onBoard.has(p.id) ? 'destroyed' : damaged.includes(p.id) ? 'damaged' : 'fresh'}
              action={byTarget.get(p.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PieceCell({
  piece,
  status,
  action,
}: {
  piece: RosterPiece
  status: 'fresh' | 'damaged' | 'destroyed'
  action: Action | undefined
}): JSX.Element {
  const art =
    status === 'destroyed'
      ? `/game-assets/figure/${EMPTY_ART[piece.piece] ?? 'ship-empty'}.webp`
      : figureArt(piece.color, PIECE_ART[piece.piece] ?? 'ship', status === 'damaged')

  const selectable = action !== undefined
  const title = selectable
    ? `${status === 'damaged' ? 'Destroy' : 'Damage'} ${piece.color} ${piece.piece}`
    : `${piece.color} ${piece.piece} — ${status}`

  return (
    <button
      className={`da-piece ${status}${selectable ? ' selectable' : ''} ${piece.piece.toLowerCase()}`}
      title={title}
      disabled={!selectable}
      onClick={() => action && store.apply(action)}
    >
      <img src={art ?? undefined} alt={title} />
      {status === 'damaged' ? <span className="da-badge dmg">damaged</span> : null}
      {status === 'destroyed' ? <span className="da-badge gone">destroyed</span> : null}
    </button>
  )
}
