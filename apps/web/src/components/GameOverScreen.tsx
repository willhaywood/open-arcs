/**
 * The end of the game, given the whole table: the winner presented by their leader card, what
 * they won chapter by chapter, and the field ranked beneath them.
 *
 * The winner's face is their **leader card** — the game's own portrait of who they were — with
 * the runners-up in the same dress at smaller size. A base game has no leaders, so those tables
 * get a plaque instead: the faction's flagship on its own colour. "What they won" is real data,
 * not ceremony: the per-chapter ambition awards come from replaying the journal
 * (`buildGameHistory`), so a game loaded from a file five minutes ago still tells its whole
 * story.
 *
 * Same shell and reasoning as the chapter interlude: portalled, outside `Watching` (a finished
 * game has nothing left to guard — every seat and spectator gets the screen), dismissable, and
 * reopenable from the side panel's "View summary".
 */

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { courtCard, heldTokens, parseResourceToken, securedCards, slotsOf } from '@arcs/engine'
import type { Continue, FactionId, GameState } from '@arcs/engine'

import { asset } from '../assets.js'
import { store, useInterlude } from '../store.js'
import { colorOf, figureArt, textOn } from '../theme.js'
import { cardArt, cardName } from './LeaderCardReader.js'
import { FactionChip, roman } from './ChapterInterlude.js'
import type { GameHistory } from '../chapter-report.js'

const RESOURCES = ['Material', 'Fuel', 'Weapon', 'Relic', 'Psionic'] as const

export function GameOverScreen({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  useInterlude()
  const open = store.interlude?.kind === 'gameOver'

  /*
   * The history is a full journal replay — cheap enough to do once, not per render. Keyed on the
   * journal length so a different finished game (new load, next game) recomputes.
   */
  const history = useMemo(
    () => (open ? store.history() : null),
    [open, state.journal.length],
  )

  if (!open || history === null) return null

  const winner = history.winner
  const reason = cont.kind === 'gameOver' ? cont.reason : history.reason

  return createPortal(
    <div className="draft interlude gos" role="dialog" aria-label="Game over">
      <div className="il-col">
        {/* No borrowed art here — the grand-ambitions strips are score charts, not banners. */}
        <header className="gos-banner">
          <h1 className="draft-title">Victory</h1>
          <span className="il-sub">{reason}</span>
        </header>

        <div className="gos-hero-row">
          <LeaderPortrait state={state} faction={winner} hero />
          <div className="gos-hero-story">
            <FactionChip faction={winner} />
            <span className="gos-final-power">
              {history.standings[0]!.power} <em>power</em>
            </span>
            <ChapterWins history={history} faction={winner} />
            <FinalHoldings state={state} faction={winner} />
          </div>
        </div>

        {history.standings.length > 1 ? (
          <div className="gos-runners">
            {history.standings.slice(1).map((s, i) => (
              <div key={s.faction} className="gos-runner">
                <span className="gos-rank">{i + 2}</span>
                <LeaderPortrait state={state} faction={s.faction} />
                <FactionChip faction={s.faction} />
                <span className="gos-runner-power">{s.power} power</span>
                <ChapterWins history={history} faction={s.faction} compact />
              </div>
            ))}
          </div>
        ) : null}

        <footer className="il-foot">
          <button className="il-continue" onClick={() => store.reset()}>
            New game
          </button>
          <button className="il-close" onClick={() => store.dismissInterlude()}>
            Close
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The faction's face: their leader card when the game has leaders, else a plaque with their
 * flagship on their colour — the base game's closest thing to a portrait.
 */
function LeaderPortrait({
  state,
  faction,
  hero = false,
}: {
  state: GameState
  faction: FactionId
  hero?: boolean
}): JSX.Element {
  const leader = state.leaders[faction]
  const frame = { boxShadow: `0 0 ${hero ? 34 : 16}px ${colorOf(faction)}66, 0 0 0 2px ${colorOf(faction)}` }
  if (leader !== undefined) {
    return (
      <img
        className={`gos-leader${hero ? ' hero' : ''}`}
        style={frame}
        src={cardArt(leader, 'leader')}
        alt={cardName(leader, 'leader')}
        title={cardName(leader, 'leader')}
      />
    )
  }
  return (
    <div className={`gos-plaque${hero ? ' hero' : ''}`} style={frame}>
      <img src={figureArt(faction, 'flagship') ?? figureArt(faction, 'city') ?? undefined} alt="" />
      <span style={{ color: colorOf(faction) === '#e8e8ea' ? textOn(faction) : colorOf(faction) }}>
        {faction}
      </span>
    </div>
  )
}

/** The faction's awards, chapter by chapter — the story of where their power came from. */
function ChapterWins({
  history,
  faction,
  compact = false,
}: {
  history: GameHistory
  faction: FactionId
  compact?: boolean
}): JSX.Element | null {
  const lines = history.chapters.flatMap((ch) =>
    ch.results.flatMap((r) =>
      r.awards
        .filter((a) => a.faction === faction)
        .map((a) => ({
          chapter: ch.chapter,
          text: `${a.place === 'first' ? 'won' : a.place === 'second' ? 'second in' : 'tied'} ${r.ambition} (+${a.power})`,
        })),
    ),
  )
  if (lines.length === 0) {
    return compact ? null : <p className="gos-wins-none">Never scored an ambition.</p>
  }
  return (
    <ul className={`gos-wins${compact ? ' compact' : ''}`}>
      {lines.map((l, i) => (
        <li key={i}>
          <span className="gos-ch">Chapter {roman(l.chapter)}</span> — {l.text}
        </li>
      ))}
    </ul>
  )
}

/** What is still on their board at the end: resources and secured court cards. */
function FinalHoldings({ state, faction }: { state: GameState; faction: FactionId }): JSX.Element | null {
  const held = heldTokens(state.resources, slotsOf(state, faction))
  const counts = new Map<string, number>()
  for (const t of held) {
    const r = parseResourceToken(t).resource
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const secured = securedCards(state, faction)
  if (counts.size === 0 && secured.length === 0) return null
  return (
    <div className="gos-holdings">
      {RESOURCES.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => (
        <span key={r} className="il-res">
          <img src={asset(`game-assets/icon/${r.toLowerCase()}.webp`)} alt={r} />
          ×{counts.get(r)}
        </span>
      ))}
      {secured.map((id) => (
        <span key={id} className="gos-card-pill" title={courtCard(id).name}>
          {courtCard(id).name}
        </span>
      ))}
    </div>
  )
}
