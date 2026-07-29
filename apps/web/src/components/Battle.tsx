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
 *   - `battle/reroll` on offer  — Skirmishers, Seeker Torpedoes, Tricky and Empath's Vision:
 *     pick which of the dice just rolled go back in the cup;
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
import { Die3D } from './Dice3D.js'

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
  if (ctx !== undefined) {
    /*
     * A `ctx` is enough on its own; requiring `state.lastRoll` too used to deadlock the game.
     *
     * The Railgun Arrays volley (lore12) assigns a hit *before* the attacker collects dice, so
     * `lastRoll` is undefined at that point — this branch fell through, no other branch matched,
     * and `battle/hit` is hidden from the action panel because this window is supposed to own it.
     * The result was an ask with nothing anywhere on screen able to answer it.
     *
     * The volley is also passed **no** roll rather than whatever `lastRoll` still holds: on any
     * battle after the first that is the *previous* battle's dice, and showing those would be a
     * worse bug than showing none.
     */
    return (
      <Shell system={ctx.system} faction={ctx.faction} enemy={ctx.enemy}>
        <DamageAssign
          state={state}
          ctx={ctx}
          hits={hitOpts}
          done={done}
          lastRoll={ctx.railgun === true ? undefined : state.lastRoll}
        />
      </Shell>
    )
  }

  /*
   * A reroll is a decision *about dice that are already on the table*, so it has to show them.
   * It used to fall through every branch here and render nothing, leaving the choice as a list of
   * "Reroll 2 dice (3, 5)" buttons in the action panel with the dice themselves nowhere on screen
   * — you could not see what you were rerolling away, nor what you got back.
   *
   * It comes before the resolution branch because a reroll ask carries no `battle/hit` or
   * `battle/finish`, so `ctx` is undefined and that branch cannot draw it either.
   */
  const rerollOpts = actions.filter((a) => a.type === 'battle/reroll')
  if (rerollOpts.length > 0) {
    const first = rerollOpts[0]!
    return (
      <Shell
        system={String(first['system'])}
        faction={String(first['faction'])}
        enemy={String(first['enemy'])}
      >
        <RerollTray options={rerollOpts} prompt={cont.kind === 'ask' ? cont.prompt : undefined} />
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
 * Pick which dice go back in the cup.
 *
 * **The engine enumerates reroll options by the *faces* they take, not by which physical die.**
 * `offerReroll` dedupes on the sorted face list, so rerolling "the 3 and the 5" is one option no
 * matter which two dice show a 3 and a 5. This tray therefore lets you click dice, then looks up
 * the option whose faces match the selection — clicking either of two 4s reaches the same action,
 * which is correct rather than a shortcut.
 *
 * Dice this source cannot touch are shown but locked: Seeker Torpedoes rerolls assault dice only,
 * and seeing the skirmish dice sitting there greyed is what makes that legible. The eligible set
 * is read off the options rather than re-derived from the card, so the tray cannot disagree with
 * the engine about what is allowed.
 */
function RerollTray({
  options,
  prompt,
}: {
  options: readonly Action[]
  prompt: string | undefined
}): JSX.Element {
  const dice = (options[0]?.['rolls'] ?? []) as readonly { die: DieType; face: number }[]
  const source = String(options[0]?.['source'] ?? 'Reroll')

  // Which dice any option is willing to take, and the most that may go at once.
  const { eligible, limit } = useMemo(() => {
    const set = new Set<number>()
    let max = 0
    for (const o of options) {
      const idx = (o['indices'] ?? []) as readonly number[]
      for (const i of idx) set.add(i)
      max = Math.max(max, idx.length)
    }
    return { eligible: set, limit: max }
  }, [options])

  const [picked, setPicked] = useState<readonly number[]>([])

  const facesOf = (idx: readonly number[]): string =>
    idx
      .map((i) => dice[i]?.face ?? 0)
      .sort((a, b) => a - b)
      .join(',')

  // The action matching the current selection — the "keep" option is simply the empty one.
  const chosen = useMemo(() => {
    const want = facesOf(picked)
    return options.find((o) => facesOf((o['indices'] ?? []) as readonly number[]) === want)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, picked, dice])

  function toggle(i: number): void {
    if (!eligible.has(i)) return
    setPicked((cur) => {
      if (cur.includes(i)) return cur.filter((x) => x !== i)
      if (cur.length >= limit) return cur
      return [...cur, i]
    })
  }

  return (
    <>
      <div className="da-prompt">{prompt ?? `${source} — choose dice to reroll`}</div>
      <div className="bt-result three-d rr-tray">
        {dice.map((d, i) => {
          const locked = !eligible.has(i)
          const on = picked.includes(i)
          return (
            <button
              key={i}
              type="button"
              className={`rr-die${on ? ' on' : ''}${locked ? ' locked' : ''}`}
              onClick={() => toggle(i)}
              disabled={locked}
              title={locked ? `${d.die} — ${source} cannot reroll this` : `${d.die} — showing ${d.face}`}
            >
              <Die3D die={d.die} face={d.face} index={i} armed />
            </button>
          )
        })}
      </div>
      <div className="bt-tally">
        <span className="bt-chip">
          <strong>{source}</strong>
        </span>
        <span className="bt-chip">
          up to <strong>{limit}</strong>
        </span>
        <span className="bt-chip">
          chosen <strong>{picked.length}</strong>
        </span>
      </div>
      <div className="da-actions">
        {picked.length > 0 ? (
          <button className="da-ghost" onClick={() => setPicked([])}>
            Clear
          </button>
        ) : null}
        <span className="da-spacer" />
        <button
          className="da-confirm"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen !== undefined) store.apply(chosen)
          }}
        >
          {picked.length === 0
            ? 'Keep these dice'
            : `Reroll ${picked.length} ${picked.length === 1 ? 'die' : 'dice'}`}
        </button>
      </div>
    </>
  )
}

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
