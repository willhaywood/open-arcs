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
import type { FactionId, NewGameOptions } from '@arcs/engine'
import { useState } from 'react'

import { SETUP_CARDS } from '../setups.js'
import { store } from '../store.js'
import { ShareGame } from './ShareGame.js'
import { MultiplayerClient } from '../multiplayer/client.js'
import type { CreatedGame } from '../multiplayer/client.js'
import { MULTIPLAYER_URL, multiplayerEnabled } from '../multiplayer/config.js'
import { hashFor } from '../multiplayer/link.js'
import { colorOf } from '../theme.js'
import { asset } from '../assets.js'

const ALL_FACTIONS: FactionId[] = ['red', 'yellow', 'blue', 'white']

/*
 * The setup deck's own back, not the action deck's — they are different cards and the action back
 * was standing in. There is only one setup back: the physical cards are **double-sided with a
 * setup on each side** (a 2-player setup backs onto a 4-player one), so the player count varies on
 * the fronts and no per-count back exists to use.
 */
const CARD_BACK = asset('game-assets/setup/setup-back.webp')
/** `apps/web/public/game-assets` is a symlink to `assets/images`, so this is served as-is. */
const BANNER = asset('game-assets/arcsheader.jpg')

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
  /**
   * A created multiplayer game, waiting for its links to be shared.
   *
   * Held here rather than in the store because until someone takes a seat there is no game to play
   * locally — only a set of links. The store learns about it when `ShareGame` hands back a seat.
   */
  const [created, setCreated] = useState<CreatedGame | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
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
  const [lorePer, setLorePer] = useState(1)
  /** Seats played by a bot. Order follows seating, not click order — see `enterGame`. */
  const [bots, setBots] = useState<string[]>([])

  const byName = new Map(boardsFor(players).map((b) => [b.name, b]))

  /*
   * A base-only deck holds 14 lore, which cannot cover every setting — 3 players at x5 needs 16,
   * 4 players needs 17 at x4. Rather than offer a combination that would run the deck dry when
   * it came to deal, the cap is derived from the pool actually selected (docs/14 section 4).
   */
  const loreCap = maxLorePerPlayer(players, lorePool(expansion).length)
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

  /** The options this screen has assembled, shared by the local and multiplayer paths. */
  function chosenOptions(): NewGameOptions | null {
    if (picked === null) return null
    const seats = ALL_FACTIONS.slice(0, players)
    return {
      board: picked,
      factions: seats,
      seed,
      ...(leaders ? { leadersAndLore: { expansion, lorePerPlayer } } : {}),
      ...(bots.length > 0 ? { bots: seats.filter((f) => bots.includes(f)) } : {}),
    }
  }

  /**
   * Create the game on the server and show its links.
   *
   * Bot seats are deliberately not sent: a bot in a joined game would never publish its moves and
   * every client would diverge silently (see `store.botsAvailable`). The option is dropped here
   * rather than disabled above, so choosing bots and then choosing multiplayer does something
   * predictable instead of quietly playing a different game than the one on screen.
   */
  async function createShared(): Promise<void> {
    const options = chosenOptions()
    if (options === null || MULTIPLAYER_URL === null) return
    const { bots: _dropped, ...withoutBots } = options
    setCreating(true)
    setCreateError(null)
    try {
      const client = new MultiplayerClient(MULTIPLAYER_URL)
      setCreated(await client.create(withoutBots, withoutBots.factions))
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  function enterGame(): void {
    if (picked === null) return
    const seats = ALL_FACTIONS.slice(0, players)
    store.start({
      board: picked,
      factions: seats,
      seed,
      // Omitted entirely for a base game, so the option's absence is what turns it off.
      ...(leaders ? { leadersAndLore: { expansion, lorePerPlayer } } : {}),
      // Same: absent rather than empty, so a base game's options are unchanged by this existing.
      ...(bots.length > 0 ? { bots: seats.filter((f) => bots.includes(f)) } : {}),
    })
  }

  const drawn = picked !== null ? SETUP_CARDS[picked] : undefined

  /*
   * Once a game exists on the server this screen is only in the way — the links are the thing that
   * matters, and losing them loses the seats.
   */
  if (created !== null) {
    return (
      <div className="newgame">
        {/* The banner stays: this is still the start screen, one step further in. */}
        {hasBanner ? (
          <div className="ng-banner">
            <img src={BANNER} alt="Arcs" onError={() => setHasBanner(false)} />
          </div>
        ) : (
          <h1 className="ng-wordmark">Arcs</h1>
        )}
        <ShareGame
          game={created}
          onEnter={(seatToken) => {
            /*
             * Put the creator's own link in the address bar before joining. `joinSession` stashes
             * the seat token under the game id, but a stash is only reachable if something still
             * knows the game id — and without this the creator is the one player whose URL never
             * carries it. They would be the only seat at the table that a reload cannot recover,
             * which is the exact failure `ShareGame` exists to prevent.
             *
             * Nothing listens for `hashchange`, so this does not re-enter the game; it is read on
             * the next load, by `main.tsx`.
             */
            window.location.hash = hashFor(created.gameId, seatToken)
            void store.joinSession(MULTIPLAYER_URL!, { gameId: created.gameId, seatToken })
          }}
        />
      </div>
    )
  }

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
        <div className="ng-field">
          <span className="ng-label">Players</span>
          <div className="seg">
            {[2, 3, 4].map((n) => (
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
                ? `${leaderPool(expansion).length} leaders · ${lorePool(expansion).length} lore`
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
              {/*
               * No "fan-made lore" opt-in. It offered the two cards printed in neither box, and
               * one of them (Catapult Overdrive, lore30) has no implementation — ticking the box
               * could deal a card that silently did nothing. The engine still honours
               * `unofficialLore` so old saves replay, but nothing sets it.
               */}
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

        {/*
         * Which seats a bot plays. Here rather than behind the variant toggle because a bot seat is
         * orthogonal to leaders and lore — you can want one in a base game — and because a setup
         * option you cannot see is a setup option nobody uses.
         */}
        <div className="ng-bots">
          <span className="ng-sub-label">Bot seats</span>
          <div className="ng-bot-row">
            {ALL_FACTIONS.slice(0, players).map((f) => {
              const on = bots.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  className={`ng-bot${on ? ' on' : ''}`}
                  disabled={revealed}
                  style={on ? { borderColor: colorOf(f), color: colorOf(f) } : undefined}
                  onClick={() => setBots((cur) => (on ? cur.filter((x) => x !== f) : [...cur, f]))}
                >
                  {f}
                </button>
              )
            })}
          </div>
          <em className="ng-bot-note">
            {bots.length === 0
              ? 'all seats played by hand'
              : bots.length === players
                ? 'every seat is a bot — watch it play'
                : `${players - bots.length} played by hand`}
          </em>
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

        {/* Absent entirely when the build has no server configured — see `multiplayer/config.ts`. */}
        {multiplayerEnabled() ? (
          <div className="ng-online">
            <button
              className="ghost ng-online-go"
              onClick={() => void createShared()}
              disabled={picked === null || creating}
            >
              {creating ? 'Creating…' : 'Play online with friends'}
            </button>
            <em>one link each</em>
            {createError !== null ? <span className="ng-online-error">{createError}</span> : null}
          </div>
        ) : null}
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
