/**
 * The links, after a multiplayer game is created.
 *
 * docs/17 section 3: no accounts, no email, no login — **the link is the credential**. One per
 * player, and sending someone theirs is the entire invitation flow.
 *
 * That makes this screen more load-bearing than it looks. A link closed without being copied is a
 * seat nobody can ever take: there is no "recover my seat" flow, because there is no account to
 * recover it against. So the screen says plainly what is lost, offers a one-click copy of all of
 * them, and puts the destructive-by-omission part in front of the button that leaves.
 *
 * ## Brand
 *
 * Written in the start screen's own vocabulary rather than a new one (docs/10 section 2ab): gold
 * letterspaced caps on the display face for labels, body copy in the system sans, the `ng-field`
 * stack it sits inside, and the `seg`/`ng-redeal` button idioms. Two deliberate borrowings:
 *
 *   - **Seat rows carry the faction's own colour**, the way the player boards and the court rail do,
 *     so "which link is mine" is answered by the same cue as everywhere else in the game.
 *   - **The link itself is monospace on near-black.** It is the one place on the screen showing
 *     *data* rather than titling, and the display face would make a URL harder to check by eye —
 *     which is the only thing anyone does with it.
 *
 * `--accent` is untouched: docs/10 reserves the blue for what is live and clickable right now, and
 * a link waiting to be copied is neither.
 */

import { useState } from 'react'

import { linkFor } from '../multiplayer/link.js'
import type { CreatedGame } from '../multiplayer/client.js'
import { colorOf } from '../theme.js'
import type { FactionId } from '@arcs/engine'

interface Props {
  game: CreatedGame
  /** Called when the creator takes their own seat and enters the game. */
  onEnter: (seatToken: string) => void
}

const origin = (): string => `${window.location.origin}${window.location.pathname}`.replace(/\/$/, '')

export function ShareGame({ game, onEnter }: Props): JSX.Element {
  const [copied, setCopied] = useState<string | null>(null)

  const link = (seatToken?: string): string => linkFor(origin(), game.gameId, seatToken)

  async function copy(text: string, mark: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(mark)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      /* clipboard blocked — the field is selectable, which is the fallback */
    }
  }

  const everything = [
    ...game.seats.map((s) => `${s.faction}: ${link(s.seatToken)}`),
    `watching: ${link()}`,
  ].join('\n')

  const row = (label: string, seatToken: string | undefined, tint: string | null): JSX.Element => (
    <div className="mp-row" key={label}>
      <span
        className="mp-seat"
        style={tint === null ? undefined : { borderColor: tint, color: tint }}
      >
        {label}
      </span>
      {/* Readonly rather than static text, so it can be selected and copied by hand as well. */}
      <input
        className="mp-link"
        readOnly
        value={link(seatToken)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button className="mp-copy" onClick={() => void copy(link(seatToken), label)}>
        {copied === label ? 'Copied' : 'Copy'}
      </button>
    </div>
  )

  return (
    <div className="ng-body mp-share">
      <div className="ng-field">
        <span className="ng-label">Player Links</span>

        <div className="mp-rows">
          {game.seats.map((seat) => row(seat.faction, seat.seatToken, colorOf(seat.faction as FactionId)))}
          {row('watching', undefined, null)}
        </div>
      </div>

      <div className="mp-go">
        <button className="ng-redeal" onClick={() => void copy(everything, 'all')}>
          {copied === 'all' ? 'All links copied' : 'Copy all links'}
        </button>
        <button className="primary ng-start mp-enter" onClick={() => onEnter(game.seats[0]!.seatToken)}>
          Take {game.seats[0]!.faction} and start
        </button>
      </div>

    </div>
  )
}
