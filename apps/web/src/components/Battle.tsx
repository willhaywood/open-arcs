/**
 * The battle window — one modal for the whole engagement, from picking dice to placing the last
 * hit. Driven entirely by whatever Ask the engine is offering: like the rest of the UI it invents
 * nothing, it reads `cont.actions` and dispatches one.
 *
 * There used to be two surfaces: a small tray floating over the board for choosing dice, and a
 * modal for the damage. Splitting them meant the thing you were deciding about — the two fleets
 * in the system — was only visible for half the decision, even though the dice you may roll are
 * capped by the ships you have there and Raid dice need enemy buildings to aim at. The window now
 * keeps the same frame and the same fleet layout throughout; only the panel under them changes:
 *
 *   - `battle/target` on offer  — pick which enemy colour to attack (only when a system holds
 *     more than one, so the fleets are not shown yet: there is no single opponent to lay out);
 *   - `battle/roll` on offer    — gather the dice pool;
 *   - `state.lastRoll` set      — the roll, then hit assignment (`DamageAssign.tsx`).
 *
 * `state.lastRoll` is a view of the seeded roll the engine already made; the animation is purely
 * cosmetic and never decides a face.
 */

import type { Action, Continue, DieType, GameState } from '@arcs/engine'
import { useMemo, useState } from 'react'

import { dieArt } from '../dice-art.js'
import { store } from '../store.js'
import { colorOf, textOn } from '../theme.js'
import { DamageAssign, Forces } from './DamageAssign.js'

const DICE: readonly DieType[] = ['Skirmish', 'Assault', 'Raid']

interface Props {
  state: GameState
  cont: Continue
}

export function Battle({ state, cont }: Props): JSX.Element | null {
  const actions = cont.kind === 'ask' ? cont.actions : []
  const rollOpts = actions.filter((a) => a.type === 'battle/roll')
  const targetOpts = actions.filter((a) => a.type === 'battle/target')
  const hitOpts = actions.filter((a) => a.type === 'battle/hit')
  const cancel = actions.find((a) => a.type === 'battle/cancel')
  const done = actions.find((a) => a.type === 'battle/finish')

  // Resolution: the dice are rolled and hits are being placed. Assignment always ends on a
  // `battle/finish` confirm, so one of these two is present for the whole of it.
  const ctx = (hitOpts[0] ?? done)?.['ctx'] as Parameters<typeof DamageAssign>[0]['ctx'] | undefined
  if (state.lastRoll !== undefined && ctx !== undefined) {
    return (
      <Shell system={ctx.system} faction={ctx.faction} enemy={ctx.enemy}>
        <DamageAssign state={state} ctx={ctx} hits={hitOpts} done={done} lastRoll={state.lastRoll} />
      </Shell>
    )
  }

  if (rollOpts.length > 0) {
    const first = rollOpts[0]!
    const system = String(first['system'])
    const faction = String(first['faction'])
    const enemy = String(first['enemy'])
    return (
      <Shell system={system} faction={faction} enemy={enemy}>
        <DiceGather rolls={rollOpts} cancel={cancel}>
          <Forces state={state} system={system} faction={faction} enemy={enemy} />
        </DiceGather>
      </Shell>
    )
  }

  if (targetOpts.length > 0) {
    const first = targetOpts[0]!
    return (
      <Shell system={String(first['system'])} faction={String(first['faction'])} enemy={undefined}>
        <TargetChooser targets={targetOpts} cancel={cancel} />
      </Shell>
    )
  }

  return null
}

/** The window itself: backdrop, frame, and the "who is fighting where" header. */
function Shell({
  system,
  faction,
  enemy,
  children,
}: {
  system: string
  faction: string
  /** Absent until a target is chosen. */
  enemy: string | undefined
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="da-backdrop">
      <div className="da-modal">
        <div className="da-head">
          <span className="da-title">Battle in {system}</span>
          <span className="da-vs">
            <Swatch color={faction} />
            {enemy !== undefined ? (
              <>
                <span className="da-vs-x">vs</span>
                <Swatch color={enemy} />
              </>
            ) : null}
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

function Swatch({ color }: { color: string }): JSX.Element {
  return (
    <span className="da-swatch" style={{ background: colorOf(color), color: textOn(color) }}>
      {color}
    </span>
  )
}

// --- gather ----------------------------------------------------------------

/**
 * Choose a dice pool. The engine offers every legal split as its own `battle/roll` action; this
 * is a friendlier face over that set — one card per die type, capped by the ships present (the
 * largest offered total) and by which dice are legal at all (Raid only against buildings, which
 * is why its card simply does not appear when there is nothing to raid).
 */
function DiceGather({
  rolls,
  cancel,
  children,
}: {
  rolls: readonly Action[]
  cancel: Action | undefined
  /** The two fleets. Rendered just above the footer, where they also sit during assignment, so
      they hold the same place on screen as the window moves from gathering to resolving. */
  children: React.ReactNode
}): JSX.Element {
  // Every offered split, keyed for O(1) validity checks and action lookup.
  const byCombo = useMemo(() => {
    const m = new Map<string, Action>()
    for (const a of rolls) m.set(`${a['skirmish']}/${a['assault']}/${a['raid']}`, a)
    return m
  }, [rolls])

  const maxTotal = useMemo(
    () => Math.max(...rolls.map((a) => Number(a['skirmish']) + Number(a['assault']) + Number(a['raid']))),
    [rolls],
  )
  const maxOf = (key: 'skirmish' | 'assault' | 'raid'): number =>
    Math.max(0, ...rolls.map((a) => Number(a[key])))

  const cap = { Skirmish: maxOf('skirmish'), Assault: maxOf('assault'), Raid: maxOf('raid') }
  const [pool, setPool] = useState<Record<DieType, number>>({ Skirmish: 1, Assault: 0, Raid: 0 })

  const total = pool.Skirmish + pool.Assault + pool.Raid
  const chosen = byCombo.get(`${pool.Skirmish}/${pool.Assault}/${pool.Raid}`)

  const bump = (die: DieType, delta: number): void => {
    setPool((p) => {
      const next = Math.min(cap[die], Math.max(0, p[die] + delta))
      const others = p.Skirmish + p.Assault + p.Raid - p[die]
      // Keep the whole pool within the ship count.
      if (others + next > maxTotal) return p
      return { ...p, [die]: next }
    })
  }

  return (
    <>
      <div className="da-prompt">Gather your dice — up to {maxTotal}, one per ship here</div>

      <div className="dg-cards">
        {DICE.filter((d) => cap[d] > 0).map((die) => (
          <div className={`dg-card${pool[die] > 0 ? ' on' : ''}`} key={die}>
            <img className="dg-die" src={dieArt(die, 0)} alt={die} />
            <div className="dg-name">{die}</div>
            <div className="dg-stepper">
              <button className="bt-step" onClick={() => bump(die, -1)} disabled={pool[die] === 0}>
                −
              </button>
              <span className="dg-count">{pool[die]}</span>
              <button
                className="bt-step"
                onClick={() => bump(die, 1)}
                disabled={pool[die] >= cap[die] || total >= maxTotal}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {children}

      <div className="da-actions">
        {cancel ? (
          <button className="da-ghost" onClick={() => store.apply(cancel)}>
            Cancel
          </button>
        ) : null}
        <span className="da-spacer" />
        <span className="da-remaining">
          {total} of {maxTotal} dice
        </span>
        <button
          className="da-confirm"
          disabled={chosen === undefined}
          onClick={() => chosen && store.apply(chosen)}
        >
          Roll
        </button>
      </div>
    </>
  )
}

// --- target chooser --------------------------------------------------------

function TargetChooser({ targets, cancel }: { targets: readonly Action[]; cancel: Action | undefined }): JSX.Element {
  return (
    <>
      <div className="da-prompt">More than one enemy is here — choose who to attack</div>
      <div className="dg-targets">
        {targets.map((a, i) => {
          const enemy = String(a['enemy'])
          return (
            <button
              key={`${enemy}-${i}`}
              className="dg-target"
              style={{ background: colorOf(enemy), color: textOn(enemy) }}
              onClick={() => store.apply(a)}
            >
              {enemy}
            </button>
          )
        })}
      </div>
      <div className="da-actions">
        {cancel ? (
          <button className="da-ghost" onClick={() => store.apply(cancel)}>
            Cancel
          </button>
        ) : null}
      </div>
    </>
  )
}
