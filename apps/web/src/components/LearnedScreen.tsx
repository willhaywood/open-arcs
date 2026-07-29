/**
 * The Archivist's Learned draw: five lore cards, keep two.
 *
 * Presented as cards rather than as a list of the ten possible pairs, for the same reason the
 * draft itself is: choosing between lore is a *reading* exercise, and a pair of names in a button
 * tells you nothing about what either card does.
 *
 * **Clicking a card keeps or unkeeps it**, which is the one place this deliberately differs from
 * the draft screen. There, clicking reads and taking is a second click, because taking a card is
 * irreversible and a mis-click steals from a rival. Here nothing is committed until *Keep these*,
 * so a direct toggle is safe and spares the player four extra clicks. The magnifier still opens
 * the same reader when the printed text is what matters.
 *
 * The engine offers one action per legal pair. This screen never invents a choice: it reads the
 * pairs it was given, lets the player build one, and dispatches the matching action.
 *
 * **The cards wear `.learned-card`, not the draft's `.draft-card`.** The two screens share their
 * shell — they are the same shape of full-screen picker — but a *card* is where they diverge: the
 * draft's has a flip wrapper inside it and this one does not. They were briefly the same class,
 * and narrowing a sizing rule to the draft's inner wrapper silently blew these up to their natural
 * 744x1039. Separate classes so a change to one cannot reach the other.
 */

import type { Action, Continue } from '@arcs/engine'
import { useEffect, useState } from 'react'

import { store } from '../store.js'
import { colorOf } from '../theme.js'
import { LeaderCardReader, cardArt, cardName } from './LeaderCardReader.js'

/** The action whose kept pair is exactly this selection, if the engine offered one. */
function actionFor(offers: readonly Action[], picked: readonly string[]): Action | undefined {
  const want = [...picked].sort().join(',')
  return offers.find((a) => [...(a['keep'] as string[])].sort().join(',') === want)
}

export function LearnedScreen({ cont }: { cont: Continue }): JSX.Element | null {
  const [picked, setPicked] = useState<string[]>([])
  const [reading, setReading] = useState<string | null>(null)

  const offers = cont.kind === 'ask' ? cont.actions.filter((a) => a.type === 'leaders/learned') : []
  const open = offers.length > 0

  // A choice left half-made when the step resolves would carry into the next one.
  useEffect(() => {
    if (!open) {
      setPicked([])
      setReading(null)
    }
  }, [open])

  if (!open || cont.kind !== 'ask') return null

  const drawn = (offers[0]!['drawn'] as string[]) ?? []
  const keepCount = (offers[0]!['keep'] as string[]).length
  const faction = cont.faction

  const toggle = (id: string): void => {
    setPicked((was) =>
      was.includes(id)
        ? was.filter((x) => x !== id)
        : was.length >= keepCount
          ? was
          : [...was, id],
    )
  }

  const chosen = actionFor(offers, picked)

  return (
    <div className="draft">
      <div className="draft-head">
        <span className="draft-title">Learned</span>
        <span className="draft-turn">
          <span className="draft-who" style={{ color: colorOf(faction) }}>
            {faction}
          </span>
          <span className="draft-what">
            keeps {keepCount} of {drawn.length} — the rest are scrapped
          </span>
        </span>
        <button
          type="button"
          className="draft-random"
          disabled={chosen === undefined}
          onClick={() => {
            if (chosen !== undefined) store.apply(chosen)
          }}
        >
          {picked.length < keepCount
            ? `Choose ${keepCount - picked.length} more`
            : 'Keep these'}
        </button>
      </div>

      <div className="draft-body">
        <section className="draft-row">
          <div className="draft-cards">
            {drawn.map((id) => (
              <div key={id} className="learned-slot">
                <button
                  type="button"
                  className={`learned-card${picked.includes(id) ? ' kept' : ''}`}
                  onClick={() => toggle(id)}
                  title={
                    picked.includes(id)
                      ? `${cardName(id, 'lore')} — click to put back`
                      : `${cardName(id, 'lore')} — click to keep`
                  }
                >
                  <img src={cardArt(id, 'lore')} alt={cardName(id, 'lore')} />
                  {picked.includes(id) ? <span className="learned-kept">Keeping</span> : null}
                </button>
                <button
                  type="button"
                  className="learned-read"
                  onClick={() => setReading(id)}
                  title={`Read ${cardName(id, 'lore')}`}
                >
                  ⌕
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="draft-note">
        Click a card to keep it. Nothing is decided until you confirm — the cards you do not keep
        are scrapped and returned to the box.
      </p>

      {reading !== null ? (
        <LeaderCardReader id={reading} kind="lore" onClose={() => setReading(null)} />
      ) : null}
    </div>
  )
}
