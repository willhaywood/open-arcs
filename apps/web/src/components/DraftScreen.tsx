/**
 * The Leaders and Lore draft, as a table of cards rather than a list of buttons.
 *
 * A draft is a reading exercise before it is a choosing one: what makes a leader worth taking is
 * its printed text, and what makes it worth taking *now* is what the other players have already
 * got. So this screen shows the whole dealt pool at once and **keeps taken cards in place**,
 * tagged with their owner, instead of removing them as they go. Everyone at the table can see
 * what has gone, read it, and plan against it — which is the whole point of drafting in the open.
 *
 * Clicking a card opens it at readable size; taking it is a deliberate second click from there.
 * That split is what lets a player study a rival's card without the risk of drafting it by
 * accident.
 *
 * The screen invents nothing: it renders whatever `leaders/take` actions the engine is offering
 * and dispatches one, exactly as the action panel did. Undo, save and replay are untouched.
 */

import { leaderPool, lorePool } from '@arcs/engine'
import type { Action, Continue, FactionId, GameState } from '@arcs/engine'
import { useEffect, useState } from 'react'

import { store } from '../store.js'
import { colorOf, figureArt } from '../theme.js'
import { LeaderCardReader, cardArt, cardName } from './LeaderCardReader.js'
import { asset } from '../assets.js'

/** A card on the table: what it is, who has it, and whether it can be taken right now. */
interface DraftCard {
  id: string
  kind: 'leader' | 'lore'
  name: string
  art: string
  owner: FactionId | undefined
  take: Action | undefined
}

/**
 * The full dealt pool, taken cards included.
 *
 * `state.draft` holds only what is *left*, so the taken ones are recovered from where they went.
 * Sorting by id keeps a card in the same place all draft long — the deal order would do too, but
 * it is not recorded, and a row that reshuffles itself as cards are taken would defeat the point
 * of leaving them on screen.
 */
function pool(state: GameState, takes: readonly Action[]): DraftCard[] {
  const draft = state.draft
  if (draft === undefined) return []

  const takeFor = (id: string): Action | undefined =>
    takes.find((a) => a['card'] === id)

  const leaderOwner = new Map<string, FactionId>()
  for (const f of state.factions) {
    const id = state.leaders[f]
    if (id !== undefined) leaderOwner.set(id, f)
  }
  const loreOwner = new Map<string, FactionId>()
  for (const f of state.factions) {
    for (const id of state.lores[f] ?? []) loreOwner.set(id, f)
  }

  const leaders = [...draft.leaders, ...leaderOwner.keys()].sort().map(
    (id): DraftCard => ({
      id,
      kind: 'leader',
      name: cardName(id, 'leader'),
      art: cardArt(id, 'leader'),
      owner: leaderOwner.get(id),
      take: takeFor(id),
    }),
  )
  const lores = [...draft.lores, ...loreOwner.keys()].sort().map(
    (id): DraftCard => ({
      id,
      kind: 'lore',
      name: cardName(id, 'lore'),
      art: cardArt(id, 'lore'),
      owner: loreOwner.get(id),
      take: takeFor(id),
    }),
  )
  return [...leaders, ...lores]
}

/**
 * Fill every remaining pick at random, for getting to the board quickly.
 *
 * Each pick is dispatched as a normal `leaders/take`, so the journal, undo and replay are exactly
 * as if they had been clicked — undo steps back one card at a time. `Math.random` is safe here for
 * the same reason: it only chooses *which action to send*, and the action itself is recorded, so a
 * replay of the resulting journal is still deterministic. Engine randomness stays on the seeded
 * generator.
 *
 * The loop reads the store back after each apply rather than the render's `cont`, which is a
 * snapshot from before the first pick. It is bounded because the draft is finite and every pick
 * removes a card; the cap is a guard against a malformed rule chain, not an expected exit.
 */
function draftAtRandom(): void {
  for (let guard = 0; guard < 200; guard++) {
    const result = store.getSnapshot()
    if (result === null || result.continue.kind !== 'ask') return
    const takes = result.continue.actions.filter((a) => a.type === 'leaders/take')
    if (takes.length === 0) return
    store.apply(takes[Math.floor(Math.random() * takes.length)]!)
  }
}

/**
 * Cards already turned over, for this page session, keyed `<game>:<card>`.
 *
 * The draft re-renders after every pick, so without this the whole table would flip again each
 * time somebody took a card. A card turns over once, the first time it is seen — the same reason
 * and the same shape as `watched` in `Dice3D`, which keeps a roll from re-tumbling on undo.
 *
 * **The game number is what makes a new deal deal again.** Two games from the same seed are
 * identical in state, right down to the card ids, so a set keyed on the id alone would open the
 * second game with every card already face up. `store.generation` counts games started and is the
 * only thing that separates them — exactly the role `instance` plays for a roll in `Dice3D`.
 *
 * Marked when the flip *starts firing*, not on mount: under StrictMode the effect runs twice, and
 * marking it up front would let the second pass cancel the reveal the first pass was scheduling.
 */
const revealed = new Set<string>()

export function DraftScreen({
  state,
  cont,
}: {
  state: GameState
  cont: Continue
}): JSX.Element | null {
  const [reading, setReading] = useState<string | null>(null)
  // Which game this is. Read at render: it only changes when a new one is started, which is
  // exactly when this screen should deal again.
  const game = store.generation

  const takes =
    cont.kind === 'ask' ? cont.actions.filter((a) => a.type === 'leaders/take') : []
  const drafting = state.draft !== undefined && takes.length > 0

  // A card left open when the draft ends would hang over the board.
  useEffect(() => {
    if (!drafting) setReading(null)
  }, [drafting])

  if (!drafting || cont.kind !== 'ask') return null

  const cards = pool(state, takes)
  const leaders = cards.filter((c) => c.kind === 'leader')
  const lores = cards.filter((c) => c.kind === 'lore')

  const faction = cont.faction
  const needsLeader = state.leaders[faction] === undefined

  /*
   * What stayed in the box. Both decks are dealt from and the remainder is set aside, so each row
   * gets the pile it came out of — the leader and lore decks' own backs, with the real count on
   * them. `leaderPool` / `lorePool` are the same lists the deal drew from, so these cannot drift
   * from what the engine actually did.
   */
  const opts = state.leadersAndLore
  const expansion = opts?.expansion ?? false
  const inBox = {
    leader: leaderPool(expansion).length - (cards.filter((c) => c.kind === 'leader').length + Object.keys(state.leaders).length),
    lore: lorePool(expansion, opts?.unofficialLore ?? false).length -
      (cards.filter((c) => c.kind === 'lore').length +
        Object.values(state.lores).reduce((n, l) => n + (l?.length ?? 0), 0)),
  }
  const open = reading === null ? undefined : cards.find((c) => c.id === reading)

  return (
    <div className="draft">
      <div className="draft-head">
        <span className="draft-title">Leaders and Lore</span>
        <span className="draft-turn">
          <span className="draft-who" style={{ color: colorOf(faction) }}>
            {faction}
          </span>
          <span className="draft-what">
            {needsLeader ? 'takes a leader' : 'takes a lore card'}
          </span>
        </span>
        <button
          type="button"
          className="draft-random"
          onClick={draftAtRandom}
          title="Fill every remaining pick at random and go to the board"
        >
          Randomize rest
        </button>
      </div>

      <div className="draft-body">
        <Row
          title="Leaders"
          cards={leaders}
          onRead={setReading}
          game={game}
          kind="leader"
          left={inBox.leader}
        />
        <Row title="Lore" cards={lores} onRead={setReading} game={game} kind="lore" left={inBox.lore} />
      </div>

      <p className="draft-note">
        Click a card to read it. Cards already taken stay on the table, so everyone can see what
        has gone.
      </p>

      {open !== undefined ? (
        <LeaderCardReader
          id={open.id}
          kind={open.kind}
          owner={open.owner}
          action={open.take}
          onClose={() => setReading(null)}
        />
      ) : null}
    </div>
  )
}

function Row({
  title,
  cards,
  onRead,
  game,
  kind,
  left,
}: {
  title: string
  cards: readonly DraftCard[]
  onRead: (id: string) => void
  /** Which game this is, so a new one deals again — see `revealed`. */
  game: number
  kind: 'leader' | 'lore'
  /** Still in the box — drawn as the deck these were dealt from. */
  left: number
}): JSX.Element | null {
  if (cards.length === 0) return null
  return (
    <section className="draft-row">
      <h2 className="draft-row-title">{title}</h2>
      <div className="draft-cards">
        {left > 0 ? (
          <div
            className={`draft-pile ${kind}`}
            title={`${left} ${kind} card${left === 1 ? '' : 's'} left in the box`}
          >
            <img src={asset(`game-assets/${kind}/${kind}-back.webp`)} alt="" />
            <span className="draft-pile-n">{left}</span>
          </div>
        ) : null}
        {cards.map((c, i) => (
          /*
           * The game number is in the key as well as in `revealed`, so a new game *remounts* the
           * cards. Without that the mounted components keep their own face-up state and a fresh
           * deal opens face up however the set is keyed.
           */
          <DraftCardView key={`${game}:${c.id}`} card={c} game={game} index={i} onRead={onRead} />
        ))}
      </div>
    </section>
  )
}

function DraftCardView({
  card,
  game,
  index,
  onRead,
}: {
  card: DraftCard
  game: number
  index: number
  onRead: (id: string) => void
}): JSX.Element {
  const taken = card.owner !== undefined
  const seen = `${game}:${card.id}`
  // Already seen? Start face up, so a re-render never replays the deal.
  const [faceUp, setFaceUp] = useState(() => revealed.has(seen))

  useEffect(() => {
    if (revealed.has(seen)) return
    // Dealt left to right, so each card turns a beat after the one before it.
    const t = setTimeout(() => {
      revealed.add(seen)
      setFaceUp(true)
    }, 220 + index * 70)
    return () => clearTimeout(t)
  }, [seen, index])

  return (
    <button
      type="button"
      className={`draft-card ${card.kind}${taken ? ' taken' : ''}${card.take ? ' takeable' : ''}${
        faceUp ? ' face-up' : ''
      }`}
      style={taken ? { ['--owner']: colorOf(card.owner!) } as React.CSSProperties : undefined}
      onClick={() => onRead(card.id)}
      title={taken ? `${card.name} — taken by ${card.owner}` : `${card.name} — click to read`}
      aria-label={faceUp ? card.name : 'Face-down card'}
    >
      <span className="dc-inner">
        {/* In flow, so it still sizes the card exactly as it did before the flip was added. */}
        <img src={card.art} alt={card.name} />
        <span className="dc-back">
          <img src={asset(`game-assets/${card.kind}/${card.kind}-back.webp`)} alt="" />
        </span>
        {taken ? (
          <span className="draft-owner">
            {figureArt(card.owner!, 'ship') !== null ? (
              <img className="draft-owner-mark" src={figureArt(card.owner!, 'ship')!} alt="" />
            ) : null}
            {card.owner}
          </span>
        ) : null}
      </span>
    </button>
  )
}
