/**
 * The start screen: pick the player count, then draw a setup.
 *
 * The board used to be a `<select>` of engine identifiers (`Board3CoreConflict`), which is the
 * one place the game's own vocabulary was thrown away — the physical game hands you a deck of
 * setup cards. So the setups *are* the cards, and they are dealt the way cards are dealt:
 *
 *   1. shuffled face down, so which is which is not known;
 *   2. you pick one — it lifts and takes a gold edge, but stays face down;
 *   3. Start turns it over, and the screen holds there showing what you drew;
 *   4. Continue enters the game.
 *
 * The names are deliberately not shown until the reveal. Printing them under face-down cards
 * would make the shuffle decorative, since you would simply read the one you wanted.
 *
 * Nothing is selected to begin with and Start stays disabled until something is. That is not
 * just ceremony — `board(name)` is a required parameter the engine never defaults, mirroring
 * HRF's setup selector, which has no default case and throws when nothing is chosen
 * (docs/05 section 2). The screen now enforces the same thing the rules do.
 */

import { boardsFor, leaderPool, lorePool, maxLorePerPlayer } from '@arcs/engine'
import type { FactionId } from '@arcs/engine'
import { useState } from 'react'

import { SETUP_CARDS } from '../setups.js'
import { store } from '../store.js'

const ALL_FACTIONS: FactionId[] = ['red', 'yellow', 'blue', 'white']

/*
 * The setup deck's own back, not the action deck's — they are different cards and the action back
 * was standing in. There is only one setup back: the physical cards are **double-sided with a
 * setup on each side** (a 2-player setup backs onto a 4-player one), so the player count varies on
 * the fronts and no per-count back exists to use.
 */
const CARD_BACK = '/game-assets/setup/setup-back.webp'
/** `apps/web/public/game-assets` is a symlink to `assets/images`, so this is served as-is. */
const BANNER = '/game-assets/arcsheader.jpg'

/** Fisher-Yates. The deck order is cosmetic, so it does not come from the game seed. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function NewGame(): JSX.Element {
  const [players, setPlayers] = useState(4)
  const [deck, setDeck] = useState<string[]>(() => shuffled(boardsFor(4).map((b) => b.name)))
  const [picked, setPicked] = useState<string | null>(null)
  /** Set by Start: the chosen card turns over and the screen waits before entering the game. */
  const [revealed, setRevealed] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9))
  const [hasBanner, setHasBanner] = useState(true)

  // --- Leaders and Lore ---
  const [leaders, setLeaders] = useState(false)
  const [expansion, setExpansion] = useState(false)
  const [unofficial, setUnofficial] = useState(false)
  const [lorePer, setLorePer] = useState(1)

  const byName = new Map(boardsFor(players).map((b) => [b.name, b]))

  /*
   * A base-only deck holds 14 lore, which cannot cover every setting — 3 players at x5 needs 16,
   * 4 players needs 17 at x4. Rather than offer a combination that would run the deck dry when
   * it came to deal, the cap is derived from the pool actually selected (docs/14 section 4).
   */
  const loreCap = maxLorePerPlayer(players, lorePool(expansion, unofficial).length)
  const lorePerPlayer = Math.min(lorePer, loreCap)

  function deal(n: number): void {
    setDeck(shuffled(boardsFor(n).map((b) => b.name)))
    setPicked(null)
    setRevealed(false)
  }

  function choosePlayers(n: number): void {
    setPlayers(n)
    deal(n) // a different count is a different deck
  }

  function enterGame(): void {
    if (picked === null) return
    store.start({
      board: picked,
      factions: ALL_FACTIONS.slice(0, players),
      seed,
      // Omitted entirely for a base game, so the option's absence is what turns it off.
      ...(leaders
        ? { leadersAndLore: { expansion, unofficialLore: unofficial, lorePerPlayer } }
        : {}),
    })
  }

  const drawn = picked !== null ? SETUP_CARDS[picked] : undefined

  return (
    <div className="newgame">
      {hasBanner ? (
        <div className="ng-banner">
          <img src={BANNER} alt="Arcs" onError={() => setHasBanner(false)} />
        </div>
      ) : (
        <h1 className="ng-wordmark">Arcs</h1>
      )}

      <div className="ng-body">
        <p className="subtitle">Base game · hotseat · rules engine build</p>

        <div className="ng-field">
          <span className="ng-label">Players</span>
          <div className="seg">
            {[3, 4].map((n) => (
              <button
                key={n}
                className={players === n ? 'on' : ''}
                disabled={revealed}
                onClick={() => choosePlayers(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="ng-field">
          <span className="ng-label">
            Setup
            <em className="ng-hint">
              {revealed
                ? `you drew ${drawn?.label ?? picked}`
                : picked === null
                  ? 'shuffled — take a card'
                  : 'turn it over to begin'}
            </em>
          </span>
          <div className={`ng-cards${revealed ? ' revealed' : ''}`}>
            {deck.map((name) => (
              <SetupCard
                key={name}
                name={name}
                clusters={byName.get(name)?.clusters ?? []}
                picked={picked === name}
                flipped={revealed && picked === name}
                onSelect={() => !revealed && setPicked(name)}
              />
            ))}
          </div>
        </div>

        <div className="ng-field">
          <span className="ng-label">Seed</span>
          <div className="seed-row">
            <input
              type="number"
              value={seed}
              disabled={revealed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
            <button
              title="Reroll"
              disabled={revealed}
              onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
            >
              ↺
            </button>
          </div>
        </div>

        <div className="ng-field">
          <span className="ng-label">
            Variant
            <em className="ng-hint">
              {leaders
                ? `${leaderPool(expansion).length} leaders · ${lorePool(expansion, unofficial).length} lore`
                : 'base game'}
            </em>
          </span>

          {/* The two boxes you would actually own, as the plaques printed on them. */}
          <div className="ng-boxes">
            <label className={`ng-plaque${leaders ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={leaders}
                disabled={revealed}
                onChange={(e) => setLeaders(e.target.checked)}
              />
              <span className="ng-plaque-text">Leaders &amp; Lore</span>
            </label>

            <label
              className={`ng-plaque${expansion && leaders ? ' on' : ''}${leaders ? '' : ' locked'}`}
              title={leaders ? undefined : 'Turn on Leaders & Lore first'}
            >
              <input
                type="checkbox"
                checked={expansion && leaders}
                disabled={revealed || !leaders}
                onChange={(e) => setExpansion(e.target.checked)}
              />
              <span className="ng-plaque-text">Leaders &amp; Lore Pack</span>
              <em className="ng-plaque-sub">leaders 9-16 · lore 15-28</em>
            </label>
          </div>

          {leaders ? (
            <div className="ng-sub">

              <label className="ng-check">
                <input
                  type="checkbox"
                  checked={unofficial}
                  disabled={revealed}
                  onChange={(e) => setUnofficial(e.target.checked)}
                />
                <span>
                  Fan-made lore <em>2 cards in neither box</em>
                </span>
              </label>

              <div className="ng-lore-count">
                <span className="ng-sub-label">Lore each</span>
                <div className="seg">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={lorePerPlayer === n ? 'on' : ''}
                      /*
                        Capped to what the chosen deck can deal — a base-only pool cannot
                        supply 4 players x4. Disabled rather than hidden, so it is visible
                        that the expansion is what unlocks it.
                      */
                      disabled={revealed || n > loreCap}
                      title={n > loreCap ? 'Not enough lore cards in this deck' : undefined}
                      onClick={() => setLorePer(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {revealed ? (
          <div className="ng-go">
            <button className="primary ng-start" onClick={enterGame}>
              Continue
            </button>
            {/* Drawing blind should not be able to trap you in a setup you did not want. */}
            <button className="ng-redeal" onClick={() => deal(players)}>
              Shuffle and deal again
            </button>
          </div>
        ) : (
          <button
            className="primary ng-start"
            onClick={() => setRevealed(true)}
            disabled={picked === null}
          >
            {picked === null ? 'Take a card' : 'Start game'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * One setup, as its card: a plain two-sided CSS flip with the faces hidden from behind, so only
 * one is ever readable. `picked` lifts it and gives it a gold edge while still face down;
 * `flipped` is what actually turns it over, and only Start sets that.
 *
 * The name is rendered only once the card is face up — while it is face down, naming it would
 * defeat the shuffle.
 */
function SetupCard({
  name,
  clusters,
  picked,
  flipped,
  onSelect,
}: {
  name: string
  clusters: readonly number[]
  picked: boolean
  flipped: boolean
  onSelect: () => void
}): JSX.Element {
  const card = SETUP_CARDS[name]
  return (
    <div className={`ng-card-slot${picked ? ' chosen' : ''}`}>
      <button
        className={`setup-card${picked ? ' picked' : ''}${flipped ? ' flipped' : ''}`}
        onClick={onSelect}
        aria-pressed={picked}
        aria-label={flipped ? (card?.label ?? name) : 'Face-down setup card'}
      >
        <span className="sc-inner">
          <span className="sc-face sc-back">
            <img src={CARD_BACK} alt="" />
          </span>
          <span className="sc-face sc-front">
            {card !== undefined ? (
              <img src={card.art} alt={card.label} />
            ) : (
              // A board with no card art still needs to be drawable.
              <span className="sc-plain">
                <strong>{name}</strong>
                <em>clusters {clusters.join(', ')}</em>
              </span>
            )}
          </span>
        </span>
      </button>
      <div className="ng-card-name">{flipped ? (card?.label ?? name) : ' '}</div>
      {flipped && card?.note !== undefined ? (
        <div className="ng-card-note">{card.note}</div>
      ) : null}
    </div>
  )
}
