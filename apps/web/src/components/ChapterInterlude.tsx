/**
 * The end-of-chapter interlude: scoring, shown where it happens to matter — between chapters,
 * over the whole table.
 *
 * Scoring used to be log lines scrolling past while the board snapped into the next chapter.
 * This screen holds that moment: each declared ambition with its marker values, who won it and
 * for how much (the engine's own demotion and tie language preserved), what everyone was holding
 * when the count was made, and the power standings against the goal.
 *
 * The store pauses the bots while it is up and re-arms them on dismissal; in an all-bot game
 * nobody needs to click, so it dismisses itself after a few seconds and the show keeps rolling.
 * Rendered outside `Watching` — a summary is not a decision, and every seat and spectator gets
 * to read and dismiss it — and portalled to the body so no stacking context can trap it.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { heldTokens, parseResourceToken, slotsOf } from '@arcs/engine'
import type { Ambition, FactionId, GameState, Resource } from '@arcs/engine'

import { asset } from '../assets.js'
import { store, useInterlude } from '../store.js'
import { colorOf, textOn } from '../theme.js'
import { LeaderArt } from './LeaderCardReader.js'
import type { AmbitionResult, ChapterReport } from '../chapter-report.js'

/** How long an all-bot game lingers on the screen before play resumes on its own. */
const ALL_BOT_LINGER_MS = 8000

export function roman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][n - 1] ?? String(n)
}

/** The resources an ambition counts, for the holdings row's icons. */
const AMBITION_RESOURCES: Partial<Record<Ambition, readonly Resource[]>> = {
  Tycoon: ['Material', 'Fuel'],
  Keeper: ['Relic'],
  Empath: ['Psionic'],
}

const PLACE_LABEL = { first: 'Won', second: '2nd', tied: 'Tied' } as const

export function ChapterInterlude(): JSX.Element | null {
  useInterlude()
  const it = store.interlude
  const open = it?.kind === 'chapter'

  // The all-bot auto-dismiss. Keyed on `open` so a fresh interlude restarts the clock.
  useEffect(() => {
    if (!open || !store.allBots()) return
    const t = setTimeout(() => store.dismissInterlude(), ALL_BOT_LINGER_MS)
    return () => clearTimeout(t)
  }, [open])

  if (it?.kind !== 'chapter') return null
  const { report, prevState } = it

  return createPortal(
    <div className="draft interlude" role="dialog" aria-label={`Chapter ${report.chapter} scoring`}>
      <div className="il-col">
        <header className="il-head">
          <img className="il-chapter-art" src={asset(`game-assets/chapter-${report.chapter}.webp`)} alt="" />
          <div>
            <h1 className="draft-title">Chapter {roman(report.chapter)}</h1>
            <span className="il-sub">Ambitions scored</span>
          </div>
        </header>

        <div className="il-body">
          {report.results.length === 0 ? (
            <p className="il-none">No ambitions were declared this chapter.</p>
          ) : (
            report.results.map((r) => <AmbitionRow key={r.ambition} r={r} prev={prevState} />)
          )}

          {report.cleanup.trophies || report.cleanup.captives ? (
            <p className="il-cleanup">
              All{' '}
              {[report.cleanup.trophies ? 'trophies' : null, report.cleanup.captives ? 'captives' : null]
                .filter(Boolean)
                .join(' and ')}{' '}
              returned to their owners.
            </p>
          ) : null}

          <PowerStrip report={report} />
        </div>

        <footer className="il-foot">
          <button className="il-continue" onClick={() => store.dismissInterlude()}>
            Begin Chapter {roman(report.chapter + 1)}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** A faction's name chip, worn everywhere on these screens. */
export function FactionChip({ faction }: { faction: FactionId }): JSX.Element {
  return (
    <span className="il-chip" style={{ background: colorOf(faction), color: textOn(faction) }}>
      {faction}
    </span>
  )
}

function AmbitionRow({ r, prev }: { r: AmbitionResult; prev: GameState }): JSX.Element {
  return (
    <section className="il-ambition-row">
      <div className="il-ambition">
        <span className="il-ambition-name">{r.ambition}</span>
        <span className="il-markers">
          {r.markers.map((m, i) => (
            <img
              key={i}
              src={asset(`game-assets/ambition/ambition-values-${m.high}-${m.low}.webp`)}
              alt={`${m.high}/${m.low}`}
            />
          ))}
        </span>
      </div>

      <div className="il-awards">
        {r.noOneScored ? <span className="il-none">No one scored it.</span> : null}
        {r.awards.map((a) => {
          const leader = prev.leaders[a.faction]
          return (
            <span key={`${a.faction}-${a.place}`} className="il-award">
              {leader !== undefined ? <LeaderArt id={leader} className="il-leader-thumb" /> : null}
              <FactionChip faction={a.faction} />
              <span className="il-place">{PLACE_LABEL[a.place]}</span>
              <span className="il-power">+{a.power}</span>
              {a.demoted ? <span className="il-demoted">(their leader)</span> : null}
            </span>
          )
        })}
        {r.phantom.map((place, i) => (
          <span key={`phantom-${i}`} className="il-award il-phantom">
            out-of-play resources — {PLACE_LABEL[place].toLowerCase()}
          </span>
        ))}
      </div>

      <Holdings r={r} prev={prev} />
    </section>
  )
}

/**
 * What the count was made over: the resource icons an ambition scores, per faction that held
 * any, or the trophy/captive tallies for Warlord and Tyrant (no icon art exists for those —
 * the number is the figure).
 */
function Holdings({ r, prev }: { r: AmbitionResult; prev: GameState }): JSX.Element | null {
  if (r.holdings.length === 0) return null
  const resources = AMBITION_RESOURCES[r.ambition]
  return (
    <div className="il-holdings">
      {r.holdings.map((h) => (
        <span key={h.faction} className="il-holding" title={`${h.faction}: ${h.value}`}>
          <i className="il-dot" style={{ background: colorOf(h.faction) }} />
          {resources === undefined ? (
            <span>{h.value} {r.ambition === 'Warlord' ? 'trophies' : 'captives'}</span>
          ) : (
            resources.map((res) => {
              const n = heldTokens(prev.resources, slotsOf(prev, h.faction)).filter(
                (t) => parseResourceToken(t).resource === res,
              ).length
              if (n === 0) return null
              return (
                <span key={res} className="il-res">
                  <img src={asset(`game-assets/icon/${res.toLowerCase()}.webp`)} alt={res} />
                  ×{n}
                </span>
              )
            })
          )}
        </span>
      ))}
    </div>
  )
}

function PowerStrip({ report }: { report: ChapterReport }): JSX.Element {
  const threshold = 39 - report.factions.length * 3
  return (
    <div className="il-power-strip">
      {report.power.map((p) => (
        <span key={p.faction} className="il-power-cell">
          <FactionChip faction={p.faction} />
          <span className="il-power-nums">
            {p.before}
            {p.after !== p.before ? (
              <>
                {' → '}
                <b className="il-delta">{p.after}</b>
              </>
            ) : null}
          </span>
        </span>
      ))}
      <img
        className="il-goal"
        src={asset(`game-assets/goal-${threshold}.webp`)}
        alt={`${threshold} power to win`}
        title={`${threshold} power wins the game`}
      />
    </div>
  )
}
