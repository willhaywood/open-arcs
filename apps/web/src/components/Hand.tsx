/**
 * Your hand, fanned along the bottom of the board. Cards are sorted by suit then strength;
 * hovering raises a card into full view; playing happens straight from here.
 *
 * The fan also answers every other ask about your own cards (Phase 3): seizing the initiative is
 * clicking the card you discard, Farseers' multi-discard is clicking cards into the pile, and
 * the two-player mulligan is a banner over the fan you are judging. Each mode reuses the play
 * machinery — the raised card shows one button naming the act — plus a banner carrying the
 * prompt and the way out.
 *
 * "Yours" means the current player in a hotseat game and your own seat in a joined one — see the
 * note in the body, which is where the hidden-information boundary is actually drawn.
 *
 * The panel on the right no longer lists card-play buttons — those live here now. A card may
 * map to more than one legal play (a same-suit follow can Surpass or Copy), in which case the
 * raised card shows a button per option; a single-option card plays on click.
 */

import { CardLocation, SUITS, contentsOf, parseCardId } from '@arcs/engine'
import type { Action, Continue, GameState } from '@arcs/engine'
import type { CSSProperties } from 'react'

import { store } from '../store.js'
import { handOwner } from '../multiplayer/seat.js'
import { CardFace } from './CardFace.js'

const PLAY_TYPES = ['turn/lead', 'turn/surpass', 'turn/copy', 'turn/pivot']

const PLAY_LABEL: Record<string, string> = {
  'turn/lead': 'Lead',
  'turn/surpass': 'Surpass',
  'turn/copy': 'Copy',
  'turn/pivot': 'Pivot',
  'turn/seize': 'Seize',
  'turn/farseers-pick': 'Discard',
}

/** What the fan is being asked, beyond ordinary card plays. */
type HandMode =
  | { kind: 'plays' }
  | { kind: 'seize'; lattice: Action | undefined; out: Action | undefined }
  | { kind: 'mulligan'; draw: Action; keep: Action }
  | { kind: 'farseers'; done: Action; picked: readonly string[] }

function modeOf(cont: Continue): HandMode {
  if (cont.kind !== 'ask') return { kind: 'plays' }
  const find = (t: string): Action | undefined => cont.actions.find((a) => a.type === t)
  if (find('turn/seize') !== undefined || find('turn/lattice-seize') !== undefined) {
    return { kind: 'seize', lattice: find('turn/lattice-seize'), out: find('turn/skip-seize') }
  }
  const draw = find('turn/mulligan')
  const keep = find('turn/keep-hand')
  if (draw !== undefined && keep !== undefined) return { kind: 'mulligan', draw, keep }
  const done = find('turn/farseers-done')
  if (done !== undefined) {
    return { kind: 'farseers', done, picked: (done['picked'] as readonly string[]) ?? [] }
  }
  return { kind: 'plays' }
}

interface Props {
  state: GameState
  cont: Continue
}

export function Hand({ state, cont }: Props): JSX.Element | null {
  if (cont.kind !== 'ask') return null

  /*
   * Whose cards these are — the one place the seat boundary shows up in the rendering.
   *
   * Rivals' hands are the one genuinely hidden zone in the base game (`observe.ts` has the full
   * list), so this is the whole of the visible half. It is not a *guarantee*: every client holds the
   * seed and can replay the journal, which docs/17 section 2 records as a known boundary of the
   * shared-journal design. This stops shoulder-surfing and mis-clicks, not devtools.
   *
   * Bot seats are excluded from "the browser's players": while a bot is asked, the lone human's
   * own hand stays on the table instead of the bot's — see `handOwner`.
   */
  const bots = store.botSeats()
  const humans = state.factions.filter((f) => !bots.includes(f))
  const faction = handOwner(store.seatView(), cont.faction, humans)
  if (faction === null) return null // watching: nobody's hand is yours to see
  const yourTurn = cont.faction === faction

  const hand = contentsOf(state.cards, CardLocation.hand(faction))
  const mode: HandMode = yourTurn ? modeOf(cont) : { kind: 'plays' }
  // A mode ask can outlive the cards it is about (Lattice Spies with an empty hand, Farseers
  // after picking everything) — the banner still has to render, or the game stops.
  if (hand.length === 0 && mode.kind === 'plays') return null

  /*
   * Which cards act right now, and how. Ordinary plays and the mode picks share one pipeline:
   * seize and Farseers name a `card` exactly as a play does, so the raised card grows one button
   * naming the act and a lone option applies on click. `cont.actions` belong to `cont.faction`,
   * so off your turn there is nothing here and every card renders unplayable.
   */
  const playsByCard = new Map<string, Action[]>()
  if (yourTurn) {
    for (const a of cont.actions) {
      if (!PLAY_TYPES.includes(a.type) && a.type !== 'turn/seize' && a.type !== 'turn/farseers-pick') {
        continue
      }
      const id = a['card'] as string
      const list = playsByCard.get(id) ?? []
      list.push(a)
      playsByCard.set(id, list)
    }
  }

  const cards = [...hand].sort(bySuitThenStrength)
  const n = cards.length
  const spread = Math.min(n * 7, 34) // total fan angle
  const step = n > 1 ? spread / (n - 1) : 0

  const banner =
    mode.kind === 'plays' ? null : (
      <div className="hand-banner">
        <span className="hand-banner-text">
          {mode.kind === 'seize'
            ? 'Seize the initiative — click a card to discard'
            : mode.kind === 'mulligan'
              ? 'Keep this hand, or draw a new six?'
              : `Farseers — click cards to discard (${mode.picked.length} picked)`}
        </span>
        {mode.kind === 'seize' && mode.lattice !== undefined ? (
          <button className="hand-banner-btn" onClick={() => store.apply(mode.lattice!)}>
            {String(mode.lattice['label'] ?? 'Seize with Lattice Spies')}
          </button>
        ) : null}
        {mode.kind === 'seize' && mode.out !== undefined ? (
          <button className="hand-banner-btn ghosted" onClick={() => store.apply(mode.out!)}>
            {String(mode.out['label'] ?? 'Keep cards')}
          </button>
        ) : null}
        {mode.kind === 'mulligan' ? (
          <>
            <button className="hand-banner-btn" onClick={() => store.apply(mode.draw)}>
              Draw a new six
            </button>
            <button className="hand-banner-btn ghosted" onClick={() => store.apply(mode.keep)}>
              Keep this hand
            </button>
          </>
        ) : null}
        {mode.kind === 'farseers' ? (
          <button className="hand-banner-btn" onClick={() => store.apply(mode.done)}>
            {String(mode.done['label'] ?? 'Done')}
          </button>
        ) : null}
      </div>
    )

  return (
    <div className="hand">
      {banner}
      {cards.map((cardId, i) => {
        const mid = (n - 1) / 2
        const rot = (i - mid) * step
        const tx = (i - mid) * 78
        const ty = Math.abs(i - mid) ** 2 * 3
        const plays = playsByCard.get(cardId) ?? []
        const playable = plays.length > 0
        const picked = mode.kind === 'farseers' && mode.picked.includes(cardId)

        return (
          <div
            key={cardId}
            className={`hand-card${playable ? ' playable' : ''}${picked ? ' picked' : ''}`}
            style={
              {
                '--rot': `${rot}deg`,
                '--tx': `${tx}px`,
                '--ty': `${ty}px`,
                zIndex: i,
              } as CSSProperties
            }
            onClick={() => {
              if (plays.length === 1) store.apply(plays[0]!)
            }}
          >
            <CardFace cardId={cardId} />
            {playable ? (
              <div className="card-plays">
                {plays.map((a, j) => (
                  <button
                    key={j}
                    className="play-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      store.apply(a)
                    }}
                  >
                    {PLAY_LABEL[a.type] ?? 'Play'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function bySuitThenStrength(a: string, b: string): number {
  const ca = parseCardId(a)
  const cb = parseCardId(b)
  const sa = SUITS.indexOf(ca.suit)
  const sb = SUITS.indexOf(cb.suit)
  if (sa !== sb) return sa - sb
  return ca.strength - cb.strength
}
