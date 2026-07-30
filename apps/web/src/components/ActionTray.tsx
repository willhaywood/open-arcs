/**
 * The action phase, as a tray across the bottom of the map — and grouped by *where each action
 * comes from*.
 *
 * The action panel it replaces was a flat list, which lost the one distinction that matters most
 * on your turn: `Move` is a pip from the card you led, while `Guide — carry any ships in or out of
 * a starport system` is a lore card offering to spend that same pip differently. Rendered as two
 * adjacent buttons those look like the same kind of thing, and the card that grants the second is
 * nowhere on screen. A player cannot weigh an option whose source and cost are invisible.
 *
 * So the tray has a row per source. The left rail names it; lore and court rows carry the card
 * itself as a `CardPill`, which opens the reader in place — the same pill the player boards and the
 * Railgun note use, so "where did this come from" has one answer everywhere.
 *
 * Three things it says that the list could not:
 *
 *   - **Which pip an alt spends.** Every card alt hangs off a standard action (`on: 'Move'`) and
 *     consumes that pip. `Guide` costs you the Move you were going to make, and until now nothing
 *     said so.
 *   - **What the suit allows but the board does not.** The engine only offers actions that can
 *     actually do something, so `Tax` with no untaxed city simply vanished — indistinguishable
 *     from a suit that never offered Tax. Those are shown greyed instead, derived from
 *     `SUIT_ACTIONS` for the led suit.
 *   - **How many pips are left**, against how many the card had.
 *
 * Sub-decisions are deliberately *not* absorbed. Choosing a system to battle in, picking dice,
 * arranging slots and the Prelude each own their own surface; the tray is the menu you return to,
 * not a shell that swallows them. Trying to own everything is how the battle window ended up
 * hiding an Ask nothing could draw.
 */

import { SUIT_ACTIONS, courtCard, guildAlt } from '@arcs/engine'
import type { Action, Continue, GameState, StandardAction, Suit } from '@arcs/engine'

import { store } from '../store.js'
import { owns } from '../surfaces.js'
import { colorOf } from '../theme.js'
import { CardPill } from './LeaderCardReader.js'

/** The ways out of a menu, which belong in the tray's footer rather than among the choices. */
const ESCAPES = ['turn/end', 'action/skip', 'action/cancel', 'battle/cancel']

/**
 * Does the tray draw this Ask?
 *
 * **Exported so `ActionPanel` can ask the same question**, because the two must never both answer
 * it. The battle window's deadlock came from exactly that kind of split: one component hid actions
 * believing another owned them, and on one path neither drew. One predicate, two readers.
 *
 * The tray owns the pip menu, and any menu offering a **card alt** — those are the menus where
 * provenance is the whole point. Card alts turn out to live one level *down* from the pip menu:
 * `withAlts` is called inside `offerBuild` and `offerMove`, so you commit the pip to Build and are
 * then offered Nurture alongside the ordinary build targets. Showing the card rows therefore means
 * owning those sub-menus too, not just the top.
 *
 * Kept as a named wrapper over the shared table so the tray reads in its own vocabulary while the
 * answer still comes from `surfaces.ts`.
 */
export function trayOwns(cont: Continue): boolean {
  return owns('tray', cont)
}

/** One row of the tray: a source, and what it is offering. */
interface Row {
  key: string
  /** Rail label — "Action pip", "Lore", "Court". */
  rail: string
  /** Card behind the row, when there is one. */
  card: { id: string; kind: 'lore' | 'leader' } | undefined
  /** Small print under the rail label. */
  note: string | undefined
  entries: Entry[]
}

interface Entry {
  label: string
  /** Absent for an entry that is shown but cannot be taken. */
  action: Action | undefined
  /** "instead of a Move" — which pip this spends. */
  cost: string | undefined
}

export function ActionTray({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  if (cont.kind !== 'ask' || !trayOwns(cont)) return null

  const asked = cont.actions
  const alts = asked.filter((a) => a.type === 'action/guild-alt')
  const escape = asked.find((a) => ESCAPES.includes(a.type))
  /*
   * Everything that is not an alt and not the way out. At the pip menu that is Move/Battle/Tax; one
   * level down it is the targets of whichever action was taken. Either way it is "what this menu
   * offers on its own account", which is the thing the card rows are being distinguished *from*.
   */
  const plain = asked.filter((a) => !alts.includes(a) && a !== escape)
  const takes = plain.filter((a) => a.type === 'action/take')

  const faction = cont.faction
  const pips = pipInfo(cont)
  const suit = pips?.suit
  /*
   * The acting faction's own play this round, named on the rail. `roundPlays` is in order, so the
   * last entry for this faction is the card whose pips are being spent — and its `kind` is worth
   * showing, because "pivot" is exactly what makes the suit differ from the round's lead.
   */
  const play = [...state.roundPlays].reverse().find((r) => r.faction === faction)
  const rows: Row[] = []

  /*
   * The pip row. `SUIT_ACTIONS` is the full set this suit could offer, and the engine hands over
   * only the ones with a legal target — so the difference between those two sets is exactly the
   * "allowed, but nothing to do with it" case, which is worth showing rather than hiding.
   *
   * Actions reached some other way — Tactical's paired Battle-then-Move, a Prelude Weapon buying a
   * Battle this suit cannot — are appended rather than matched, since they are not in the suit's
   * list at all.
   */
  /*
   * Actions a leader trait has touched move to their own row.
   *
   * They are found by the rider the engine wraps them in — `leaders/may-follow` or
   * `leaders/must-follow` — not by matching labels. Two traits do this today: Tactical (Warrior)
   * pairs Move with Battle, and Charismatic (Feastbringer) pairs Influence with Secure.
   *
   * This matters because such an action is otherwise unreadable. Administration grants no Move, so
   * the Warrior's "Move, then must Battle" arrived in the pip row marked "off-suit" — a label that
   * says why it is not in `SUIT_ACTIONS` and nothing about where it came from. You had to already
   * know the trait to understand the button.
   */
  const leaderId = state.leaders[faction]
  const rider = (a: Action): string | undefined => {
    const dig = (v: unknown, depth = 0): string | undefined => {
      if (depth > 6 || v === null || typeof v !== 'object') return undefined
      const o = v as Record<string, unknown>
      const t = o['type']
      if (t === 'leaders/may-follow') return `then may ${String(o['act'])}`
      if (t === 'leaders/must-follow') return `then must ${String(o['act'])}`
      return dig(o['then'], depth + 1)
    }
    return dig(a['then'])
  }
  const led = new Map<Action, string>()
  for (const a of plain) {
    const r = rider(a)
    if (r !== undefined) led.set(a, r)
  }

  const offered = new Map(takes.map((a) => [String(a['action']), a]))
  const isPipMenu = takes.length > 0
  const suited = suit === undefined || !isPipMenu ? [] : SUIT_ACTIONS[suit as Suit]
  const pipEntries: Entry[] = suited.flatMap((act) => {
    const a = offered.get(act)
    // Taken over by a leader trait: it is offered, but the leader row is where it is explained.
    if (a !== undefined && led.has(a)) return []
    return [
      a === undefined
        ? { label: act, action: undefined, cost: undefined }
        : { label: String(a['label'] ?? act), action: a, cost: undefined },
    ]
  })
  for (const a of plain) {
    if (led.has(a)) continue
    const act = String(a['action'] ?? '')
    if (isPipMenu && suited.includes(act as StandardAction)) continue
    pipEntries.push({
      label: String(a['label'] ?? a.type),
      action: a,
      cost: isPipMenu ? 'off-suit' : undefined,
    })
  }
  rows.push({
    key: 'pip',
    rail: isPipMenu ? 'Action pip' : 'This action',
    card: undefined,
    note:
      play === undefined
        ? suit
        : play.kind === 'lead'
          ? play.cardId
          : `${play.cardId} (${play.kind})`,
    entries: pipEntries,
  })

  /*
   * The leader's own row. The rider goes in the cost slot and is stripped from the label, so the
   * button reads "Move" with "then must Battle" beside it — the action and its condition, rather
   * than one run-on sentence.
   */
  if (led.size > 0 && leaderId !== undefined) {
    rows.push({
      key: `leader-${leaderId}`,
      rail: 'Leader',
      card: { id: leaderId, kind: 'leader' },
      note: undefined,
      entries: [...led.entries()].map(([a, r]) => ({
        label: String(a['label'] ?? a.type).split(', then ')[0]!,
        action: a,
        cost: r,
      })),
    })
  }

  // One row per card offering an alt, so a card granting two of them reads as one source.
  const byCard = new Map<string, Action[]>()
  for (const a of alts) {
    const meta = guildAlt(String(a['alt']))
    const list = byCard.get(meta.card) ?? []
    list.push(a)
    byCard.set(meta.card, list)
  }
  for (const [card, list] of byCard) {
    const meta = guildAlt(String(list[0]!['alt']))
    rows.push({
      key: card,
      rail: meta.source === 'lore' ? 'Lore' : 'Court',
      card: meta.source === 'lore' ? { id: card, kind: 'lore' } : undefined,
      note: meta.source === 'lore' ? undefined : cardLabel(card),
      entries: list.map((a) => {
        const m = guildAlt(String(a['alt']))
        return {
          // The alt's own label carries an em-dash gloss; the head of it is the action's name.
          label: String(a['label'] ?? m.id).split(' — ')[0]!,
          action: a,
          cost: `instead of a ${m.on}`,
        }
      }),
    })
  }


  return (
    <div className="at-tray">
      <div className="at-inner">
        <div className="at-head">
          <span className="at-who" style={{ color: colorOf(faction) }}>
            {faction}
          </span>
          <span className="at-title">Actions</span>
          {pips === undefined ? (
            /*
             * No `turn/pips` in the chain means no pip is being spent — a Prelude resource bought
             * this action outright. Worth saying, because the rail still names the card that was
             * played and an empty pip row beside it invites the wrong conclusion.
             */
            <span className="at-sub">bought in the Prelude — no pip spent</span>
          ) : (
            <>
              {/* The diamond the action cards print their pips as, spent ones left hollow. */}
              <span className="at-pips" aria-hidden="true">
                {Array.from({ length: pips.total }, (_, i) => (
                  <i key={i} className={`at-pip${i < pips.left ? ' on' : ''}`} />
                ))}
              </span>
              <span className="at-sub">
                {pips.left} of {pips.total} pip{pips.total === 1 ? '' : 's'} left
              </span>
            </>
          )}
        </div>

        <div className="at-rows">
          {rows.map((row) => (
            <div className="at-row" key={row.key}>
              <div className="at-rail">
                <span className="at-rail-name">{row.rail}</span>
                {row.card !== undefined ? (
                  <CardPill id={row.card.id} kind={row.card.kind} owner={faction} />
                ) : row.note !== undefined ? (
                  <span className="at-rail-note">{row.note}</span>
                ) : null}
              </div>
              <div className="at-entries">
                {row.entries.map((e, i) => (
                  <span className="at-entry" key={`${e.label}-${i}`}>
                    <button
                      type="button"
                      className={`at-btn${e.action === undefined ? ' off' : ''}`}
                      disabled={e.action === undefined}
                      title={
                        e.action === undefined
                          ? `${e.label} — this suit allows it, but nothing on the board can be ${e.label.toLowerCase()}ed right now`
                          : undefined
                      }
                      onClick={() => {
                        if (e.action !== undefined) store.apply(e.action)
                      }}
                    >
                      {e.label}
                    </button>
                    {e.cost !== undefined ? <span className="at-cost">{e.cost}</span> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="at-foot">
          <span className="at-hint">Greyed actions have no legal target right now</span>
          {escape !== undefined ? (
            <button className="at-end" onClick={() => store.apply(escape)}>
              {String(escape['label'] ?? 'Done')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * The suit being acted on, and the pips left — both read off the continuation.
 *
 * **Not from `state.lead`.** That is the card that led the *round*, which is only your card if you
 * led it. A player who pivots or copies acts on their own card at its own suit and pip count, so
 * reading the lead labelled a pivoted Aggression 2 as "Construction 2" and counted the wrong
 * card's pips. `turn/pips` carries the acting faction's `suit`, `done` and `total`, which is the
 * only place all three agree.
 *
 * Two further traps, both of which caught me:
 *
 *   - **The `then` describes the state *after* this pip is spent**, so the pips remaining now are
 *     `total - done + 1`. Taking the subtraction at face value read "0 of 3 left" beside the
 *     engine's own "End turn (forfeit 1)".
 *   - **The `then` is often wrapped** — Tactical's "Move, then must Battle" hides the `turn/pips`
 *     inside a `leaders/must-follow`, so this walks down rather than reading the top level.
 */
function pipInfo(
  cont: Extract<Continue, { kind: 'ask' }>,
): { suit: Suit; left: number; total: number } | undefined {
  const dig = (v: unknown, depth = 0): Record<string, unknown> | undefined => {
    if (depth > 6 || v === null || typeof v !== 'object') return undefined
    const o = v as Record<string, unknown>
    if (o['type'] === 'turn/pips') return o
    return dig(o['then'], depth + 1)
  }
  for (const a of cont.actions) {
    const hit = dig(a['then'])
    if (hit === undefined) continue
    const done = Number(hit['done'])
    const total = Number(hit['total'])
    const suit = hit['suit']
    if (!Number.isFinite(done) || !Number.isFinite(total) || typeof suit !== 'string') continue
    return { suit: suit as Suit, left: total - done + 1, total }
  }
  return undefined
}

/**
 * Court cards are named on the rail rather than pilled.
 *
 * `CardPill` opens the leader/lore reader, which is the wrong reader for a court card — those are
 * read from the court panel, at a different size and with agent counts on them. Naming it keeps the
 * provenance visible without pretending the two card types are interchangeable; giving court cards
 * a pill of their own is a follow-up, not a shortcut to take here.
 */
function cardLabel(id: string): string {
  return courtCard(id).name
}
