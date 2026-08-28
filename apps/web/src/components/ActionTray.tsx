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
 * So the tray still groups by source — but only the **pip row** lives in the band. Every other
 * source (a leader trait, a guild or lore card granting alts) is a *chip*: clicking it opens the
 * card at readable size with that source's actions on it, and picking one acts. Card sources used
 * to be full rows in the band, and a hand holding two or three such cards stacked rows until the
 * band scrolled — the chip → modal → action shape keeps the band one line no matter how many
 * cards are offering, and puts the decision on the card itself, which is the house pattern
 * (CardShelf, RaidModal).
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
import type { Action, Continue, FactionId, GameState, StandardAction, Suit } from '@arcs/engine'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { asset } from '../assets.js'
import { store } from '../store.js'
import { useModalDrag } from '../modal-drag.js'
import { ESCAPES, owns } from '../surfaces.js'
import { colorOf } from '../theme.js'
import { cardArt, cardName } from './LeaderCardReader.js'

/**
 * Does the tray draw this Ask?
 *
 * One predicate over the shared table, so no two surfaces can ever both answer it. The battle
 * window's deadlock came from exactly that kind of split: one component hid actions believing
 * another owned them, and on one path neither drew.
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

/** What the chip's modal shows: the card the source is, at readable size. */
function sourceArt(row: Row): string {
  if (row.card !== undefined) return cardArt(row.card.id, row.card.kind)
  // A card-less source row is a court card named on the rail; its key is the card id.
  return asset(`game-assets/court/${row.key}.webp`)
}

function sourceName(row: Row): string {
  if (row.card !== undefined) return cardName(row.card.id, row.card.kind)
  return row.note ?? row.rail
}

export function ActionTray({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  /*
   * Which source chip's modal is open, by row key. Applying an action changes the Ask and the
   * rebuilt rows may no longer contain the key, so the modal is derived per render — a stale key
   * simply finds no row and nothing shows.
   */
  const [openSource, setOpenSource] = useState<string | null>(null)

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


  // The band draws the pip row; every other source collapses to a chip and its modal.
  const pipRow = rows[0]!
  const sources = rows.slice(1)
  const opened = sources.find((r) => r.key === openSource)

  /*
   * One horizontal band: identity rail | rows | the way out. The head used to be its own line and
   * the End button lived in a footer with a standing hint — three stacked strips whose height
   * outgrew the fixed hand row and resized the map every time the tray came up. The hint is not
   * lost: every greyed button already carries it as its tooltip.
   */
  return (
    <div className="at-tray">
      <div className="at-inner">
        <div className="at-head">
          <span className="at-who" style={{ color: colorOf(faction) }}>
            {faction}
          </span>
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
          <div className="at-row" key={pipRow.key}>
            <div className="at-rail">
              <span className="at-rail-name">{pipRow.rail}</span>
              {pipRow.note !== undefined ? (
                <span className="at-rail-note">{pipRow.note}</span>
              ) : null}
            </div>
            <div className="at-entries">
              {pipRow.entries.map((e, i) => (
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
              {/*
                * The other sources, as chips on the same line: click to open the card with its
                * actions. Rows here are what used to stack the band past its fixed height.
                */}
              {sources.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  className="at-src"
                  title={`${sourceName(row)} — ${row.entries.length} action${row.entries.length === 1 ? '' : 's'}, click to choose`}
                  onClick={() => setOpenSource(row.key)}
                >
                  <span className="at-src-kind">{row.rail}</span>
                  <span className="at-src-name">{sourceName(row)}</span>
                  {row.entries.length > 1 ? <span className="at-src-n">{row.entries.length}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>

        {escape !== undefined ? (
          <button className="at-end" onClick={() => store.apply(escape)}>
            {String(escape['label'] ?? 'Done')}
          </button>
        ) : null}
      </div>

      {opened !== undefined ? (
        <SourceModal row={opened} faction={faction} onClose={() => setOpenSource(null)} />
      ) : null}
    </div>
  )
}

/**
 * The chip's modal: the source card at readable size, its actions beside it.
 *
 * The same shape as the court shelf — the card is the decision surface, the buttons act, and
 * cancelling costs nothing (the pip is only committed by choosing). Portalled for the usual
 * stacking-context reason (CardZoom.tsx explains it).
 */
function SourceModal({
  row,
  faction,
  onClose,
}: {
  row: Row
  faction: FactionId
  onClose: () => void
}): JSX.Element {
  const drag = useModalDrag()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className={`da-backdrop${drag.dragged ? ' aside' : ''}`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={drag.ref}
        className="da-modal src-modal"
        style={drag.style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="da-head" {...drag.handle}>
          <span className="da-title">{sourceName(row)}</span>
          <span className="da-prompt">
            <span style={{ color: colorOf(faction) }}>{faction}</span> — {row.rail.toLowerCase()}{' '}
            action
          </span>
        </div>
        <div className="srcm-body">
          <img className="srcm-art" src={sourceArt(row)} alt={sourceName(row)} />
          <div className="srcm-actions">
            {row.entries.map((e, i) => (
              <button
                key={`${e.label}-${i}`}
                type="button"
                className="srcm-act"
                disabled={e.action === undefined}
                onClick={() => {
                  if (e.action === undefined) return
                  onClose()
                  store.apply(e.action)
                }}
              >
                <span className="srcm-act-label">{e.label}</span>
                {e.cost !== undefined ? <span className="srcm-act-cost">{e.cost}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="da-actions">
          <button className="da-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
