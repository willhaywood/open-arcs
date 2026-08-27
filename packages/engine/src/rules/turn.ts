/**
 * Chapter / round / turn structure. Transcribed from haunt-roll-fail's
 * arcs/game-common.scala; see docs/06-turn-structure.md for the full mapping.
 *
 * Flow:
 *   chapter/start  -> shuffle the deck, deal 6, begin round 1
 *   round/start    -> initiative holder leads
 *   lead           -> play a card face-up; its pips drive the lead player's turn
 *   (each other faction, in order) follow: surpass | copy | pivot | pass
 *   seize          -> a 7-strength surpass auto-seizes; otherwise a follower may discard
 *                     a card to seize the initiative for next round
 *   prelude        -> spend resources for free actions before any pip is spent (prelude.ts)
 *   turn           -> spend pips one at a time on standard actions (see standard-actions)
 *   round ends when everyone holding cards has passed -> chapter ends
 *
 * Deferred to phase 2 or later, and marked where they'd attach: event cards, and
 * Faithful/Zeal/Wisdom. Chapter/game end scoring is a stub (see checkChapterEnd).
 */

import type { Action } from '../action.js'
import type { ActionCard, StandardAction, Suit } from '../cards.js'
import {
  CHAPTER_HAND_SIZE,
  SUIT_ACTIONS,
  cardId,
  deckFor,
  parseCardId,
} from '../cards.js'
import type { Continue } from '../continue.js'
import { Continue as C } from '../continue.js'
import { citiesInReserve, rules, slotsOf } from '../control.js'
import { system as systemInfo } from '../board.js'
import {
  CourtPile,
  FARSEERS,
  GALACTIC_BARDS,
  RELIC_FENCE,
  LATTICE_SPIES,
  SWORN_GUARDIANS,
  courtCard,
  hasGuild,
  securedCards,
} from '../court.js'
import type { RuleModule, RuleResult } from '../dispatch.js'
import { unhandled } from '../dispatch.js'
import { CardLocation, Location, parseFigureId } from '../ids.js'
import type { FactionId, SystemId } from '../ids.js'
import { Prelude, guildPreludes, lorePreludes, preludeOffers } from '../prelude.js'
import type { GuildPrelude } from '../prelude.js'
import type { Resource } from '../resources.js'
import {
  ResourceSlot,
  gain,
  heldTokens,
  openSlots,
  parseResourceToken,
  slotCapacity,
  spendToken,
  RESOURCES,
  countResource,
} from '../resources.js'
import { shuffle } from '../rng.js'
import type { Ambition, GameState, Lead } from '../state.js'
import { contentsOf, move, moveAll, place } from '../tracker.js'
import {
  CheckDeclare,
  ScoreAmbitions,
  ambitionsForStrength,
  chapterAmbitionable,
  afterDeclarePeek,
  takeAmbitionMarker,
} from './ambitions.js'
import {
  TakeAction,
  arrangeThen,
  canMustBattleMove,
  canMustSecureInfluence,
  canTake,
  overflowThen,
} from './standard-actions.js'
import type { PipReturn } from './standard-actions.js'
import { hasTrait } from '../leaders.js'
import {
  TYCOONS_AMBITION,
  TYCOONS_CHARM,
  TYRANTS_EGO,
  WARLORDS_TERROR,
  loreActive,
  loreCard,
} from '../lore.js'
import { clearOutrage } from '../outrage.js'
import { copiedOrPivoted } from '../observe.js'

// --- action constructors ---------------------------------------------------

export const StartChapter = (): Action => ({ type: 'chapter/start' })
const StartRound = (): Action => ({ type: 'round/start' })

/**
 * The two-player mulligan.
 *
 * Rulebook p19 "Two-Player Mulligans": *In games with 2 players, after drawing, the player without
 * initiative may discard their hand of 6 action cards to draw a new hand of 6 action cards. They
 * must accept this new hand.* Setup P is the same offer at chapter 1, and because setup reaches
 * chapter 1 through `StartChapter` like every other chapter, one implementation covers both.
 *
 * The compensation for going second, and the reason it is *without initiative* specifically.
 */
const Mulligan = (faction: FactionId): Action => ({
  type: 'turn/mulligan',
  faction,
  label: 'Discard and draw 6 new',
})
const KeepHand = (faction: FactionId): Action => ({
  type: 'turn/keep-hand',
  faction,
  label: 'Keep this hand',
})
const LeadMain = (faction: FactionId): Action => ({ type: 'turn/lead-main', faction })

const Lead = (faction: FactionId, card: string, suit: Suit): Action => ({
  type: 'turn/lead',
  faction,
  card,
  suit,
  label: `Play ${card}`,
})
const Pass = (faction: FactionId): Action => ({ type: 'turn/pass', faction, label: 'Pass' })

const FollowMain = (faction: FactionId): Action => ({ type: 'turn/follow-main', faction })
const Surpass = (faction: FactionId, card: string): Action => ({
  type: 'turn/surpass',
  faction,
  card,
  label: `Surpass with ${card}`,
})
const Copy = (faction: FactionId, card: string): Action => ({
  type: 'turn/copy',
  faction,
  card,
  label: `Copy with ${card}`,
})
const Pivot = (faction: FactionId, card: string, suit: Suit): Action => ({
  type: 'turn/pivot',
  faction,
  card,
  suit,
  label: `Pivot with ${card} as ${suit}`,
})

const CheckSeize = (faction: FactionId, pips: number, suit: Suit): Action => ({
  type: 'turn/check-seize',
  faction,
  pips,
  suit,
})
const Seize = (faction: FactionId, card: string, pips: number, suit: Suit): Action => ({
  type: 'turn/seize',
  faction,
  card,
  pips,
  suit,
  label: `Seize by discarding ${card}`,
})
const SkipSeize = (faction: FactionId, pips: number, suit: Suit): Action => ({
  type: 'turn/skip-seize',
  faction,
  pips,
  suit,
  label: 'Keep cards',
})

const Turn = (faction: FactionId, suit: Suit, done: number, total: number): Action => ({
  type: 'turn/pips',
  faction,
  suit,
  done,
  total,
})
const EndTurn = (faction: FactionId): Action => ({ type: 'turn/end', faction })

// --- prelude ---------------------------------------------------------------
// Sits between the seize check and the pip loop, as in HRF
// (game-common.scala:1510 `CheckSeizeAction(f, PrePreludeActionAction(...))`). It is a loop:
// every spend returns to the menu, so any number of resources can be spent.

const PreludeSpend = (
  faction: FactionId,
  resource: Resource,
  action: StandardAction,
  suit: Suit,
  pips: number,
): Action => ({ type: 'turn/prelude-spend', faction, resource, action, suit, pips })
const PreludeBattleOption = (
  faction: FactionId,
  resource: Resource,
  suit: Suit,
  pips: number,
): Action => ({ type: 'turn/prelude-battle', faction, resource, suit, pips })
const PreludeDiscard = (
  faction: FactionId,
  resource: Resource,
  suit: Suit,
  pips: number,
): Action => ({ type: 'turn/prelude-discard', faction, resource, suit, pips })
const EndPrelude = (faction: FactionId, suit: Suit, pips: number): Action => ({
  type: 'turn/prelude-done',
  faction,
  suit,
  pips,
  label: pips > 0 ? `Begin actions (${pips} pip${pips === 1 ? '' : 's'})` : 'Done',
})

// --- helpers ---------------------------------------------------------------

function hand(state: GameState, faction: FactionId): readonly string[] {
  return contentsOf(state.cards, CardLocation.hand(faction))
}

function factionsWithCards(state: GameState): FactionId[] {
  return state.factions.filter((f) => hand(state, f).length > 0)
}

/** Seating rotated so `holder` is first, preserving order. */
function rotateTo(order: readonly FactionId[], holder: FactionId): FactionId[] {
  const i = order.indexOf(holder)
  if (i === -1) throw new Error(`${holder} not in initiative order`)
  return [...order.slice(i), ...order.slice(0, i)]
}

function nextInOrder(state: GameState, after: FactionId): FactionId | undefined {
  const order = state.initiativeOrder
  const i = order.indexOf(after)
  return order[(i + 1) % order.length]
}

// --- chapter / deal --------------------------------------------------------

function performStartChapter(state: GameState): RuleResult {
  // Return every played and held card to the deck, then shuffle and deal fresh hands.
  let cards = state.cards
  const deck = CardLocation.deck()
  for (const f of state.factions) {
    cards = moveAll(cards, [...contentsOf(cards, CardLocation.hand(f))], deck)
    cards = moveAll(cards, [...contentsOf(cards, CardLocation.played(f))], deck)
  }
  cards = moveAll(cards, [...contentsOf(cards, CardLocation.discard())], deck)

  // The deck used depends on player count (3p drops 1s and 7s). Ensure only those cards
  // are present — on the first chapter the deck is empty and we populate it.
  const wanted = new Set(deckFor(state.factions.length).map(cardId))
  const present = new Set(contentsOf(cards, deck))
  if (![...wanted].every((id) => present.has(id)) || present.size !== wanted.size) {
    cards = seedDeck(cards, state.factions.length)
  }

  /*
   * Shuffle from the deck's **canonical** order (`deckFor`), not from whatever order the cards
   * arrived in. A Fisher-Yates over the arrival order meant any change to which pile a card sat
   * in — a refactor of discards, not a rules change — re-dealt every later chapter for the same
   * seed and broke every recorded journal (docs/22). Chapter 1 is seeded in this order already,
   * so first-chapter deals are byte-identical to before.
   */
  const inDeck = new Set(contentsOf(cards, deck))
  const canonical = deckFor(state.factions.length).map(cardId).filter((id) => inDeck.has(id))
  const [order, rng] = shuffle(state.rng, canonical)
  let dealt = cards
  for (const f of state.factions) {
    const take = order.splice(0, CHAPTER_HAND_SIZE)
    dealt = moveAll(dealt, take, CardLocation.hand(f))
  }
  /*
   * "Discard all action cards not in players' hands into the action discard pile on the map
   * face down, then shuffle it." The remainder is already in shuffled order, so it lands in the
   * discard as-is — the pile the bottom-of-discard draws (Farseers, Call to Action) read from
   * is therefore populated from the chapter's first turn, as at the table. It used to stay in
   * the deck, where nothing ever drew from it (docs/22).
   */
  dealt = moveAll(dealt, order, CardLocation.discard())

  // Initiative carries across chapters. HRF sets the faction order once at setup
  // (game-common.scala:282) and thereafter only rotates it on a transfer of initiative
  // (:2238) — a new chapter never resets it, so whoever ended the last chapter with the
  // initiative opens the next one.
  const first = state.initiativeOrder[0] ?? state.factions[0]!
  const chapter = state.chapter + 1
  const next: GameState = {
    ...state,
    cards: dealt,
    rng,
    chapter,
    round: 0,
    current: first,
    initiativeOrder: [...state.initiativeOrder],
    lead: undefined,
    roundPlays: [],
    seized: undefined,
    passed: 0,
    // Fresh ambition markers for the chapter; previous declarations clear.
    ambitionable: chapterAmbitionable(chapter),
    declared: [],
    log: [...state.log, `Chapter ${chapter}: dealt ${CHAPTER_HAND_SIZE} cards each`],
  }
  return { state: next, continue: offerMulligan(next) ?? C.then(StartRound()) }
}

/**
 * Offer the mulligan, or `undefined` when there is none to offer.
 *
 * Two players only, and only to the one **without** initiative — at three or four this returns
 * nothing and the chapter starts exactly as it always did.
 */
function offerMulligan(state: GameState): Continue | undefined {
  if (state.factions.length !== 2) return undefined
  const withInitiative = state.initiativeOrder[0] ?? state.factions[0]!
  const other = state.factions.find((f) => f !== withInitiative)
  if (other === undefined) return undefined
  return C.ask(other, [Mulligan(other), KeepHand(other)], 'Keep this hand, or draw a new six?')
}

/**
 * Take the mulligan: the six go away and six fresh ones come back.
 *
 * The old hand goes to the **discard**, not back to the deck, so it cannot be dealt straight back —
 * "draw a new hand" has to mean a different one. The remaining deck is then shuffled rather than
 * dealt off the top, because after the chapter reset the deck's order is whatever returning the
 * hands left it in, which is deterministic but not random. Shuffling with the state's own RNG keeps
 * the draw both fair and exactly reproducible under replay.
 */
function performMulligan(state: GameState, faction: FactionId): RuleResult {
  const hand = CardLocation.hand(faction)
  const discard = CardLocation.discard()
  let cards = moveAll(state.cards, [...contentsOf(state.cards, hand)], discard)
  // The undealt cards live in the discard now (see `performStartChapter`), so the new six come
  // from there: shuffle the pile so the returned hand cannot simply be drawn straight back.
  const [order, rng] = shuffle(state.rng, contentsOf(cards, discard))
  cards = moveAll(cards, order, discard)
  cards = moveAll(cards, order.slice(0, CHAPTER_HAND_SIZE), hand)
  return {
    state: {
      ...state,
      cards,
      rng,
      log: [...state.log, `${faction} took a new hand of ${CHAPTER_HAND_SIZE}`],
    },
    continue: C.then(StartRound()),
  }
}

/** Register the deck's cards as tracker entities. Called once, lazily, on first chapter. */
function seedDeck(cards: GameState['cards'], players: number): GameState['cards'] {
  const ids = deckFor(players).map(cardId)
  // `place` needs entities not yet tracked; the deck starts empty.
  return place(cards, ids, CardLocation.deck())
}

// --- round / lead ----------------------------------------------------------

function performStartRound(state: GameState): RuleResult {
  const round = state.round + 1
  const holder = state.initiativeOrder[0]!
  return {
    state: {
      ...state,
      round,
      seized: undefined,
      passed: 0,
      lead: undefined,
      roundPlays: [],
      current: holder,
    },
    continue: C.then(LeadMain(holder)),
  }
}

function performLeadMain(state: GameState, faction: FactionId): RuleResult {
  const cards = hand(state, faction)
  if (cards.length === 0) {
    // Nothing to lead; treat as a pass.
    return { state, continue: C.then(Pass(faction)) }
  }
  const options: Action[] = cards.map((id) => {
    const card = parseCardId(id)
    return { ...Lead(faction, id, card.suit), faction, label: `Lead ${id}` }
  })
  return {
    state: { ...state, current: faction },
    continue: C.ask(faction, [...options, Pass(faction)], `${faction} leads`),
  }
}

function performLead(state: GameState, faction: FactionId, cardIdStr: string, suit: Suit): RuleResult {
  const card = parseCardId(cardIdStr)
  const cards = move(state.cards, cardIdStr, CardLocation.played(faction))
  const lead: Lead = {
    faction,
    cardId: cardIdStr,
    suit,
    strength: card.strength,
    pips: card.pips,
    zeroed: false,
  }
  const next: GameState = {
    ...state,
    cards,
    lead,
    roundPlays: [{ faction, cardId: cardIdStr, kind: 'lead' }],
    passed: 0,
    log: [...state.log, `${faction} led with ${cardIdStr} (${card.pips} pips)`],
  }
  // The lead player may declare an ambition matching the card strength before spending pips.
  return { state: next, continue: C.then(CheckDeclare(faction, suit, card.strength, card.pips)) }
}

// --- follow ----------------------------------------------------------------

function performFollowMain(state: GameState, faction: FactionId): RuleResult {
  const lead = state.lead
  if (lead === undefined) throw new Error('follow with no lead')
  const leadSuit = lead.suit
  const cards = hand(state, faction)

  // Every card offers Copy — you play it face down and take one action of the *lead* suit, so
  // its own suit is irrelevant (`game-common.scala:1474`, which puts no condition on Copy).
  // Surpass and Pivot are the conditional plays layered on top, matching HRF exactly:
  //
  //   Surpass — same suit as the lead, and strictly stronger (a zeroed lead counts as 0).
  //   Pivot   — a *different* suit; play it face up in its own suit for one action.
  //   Copy    — any card at all.
  //
  // The earlier code only offered Copy on same-suit cards, so a follower holding nothing of
  // the lead suit saw Pivot alone and could never copy.
  const options: Action[] = []
  for (const id of cards) {
    const card = parseCardId(id)
    if (card.suit === leadSuit) {
      // Equality is unreachable — (suit, strength) is unique across the deck, so a same-suit
      // card of equal strength *is* the lead card, and that is in the leader's played pile,
      // not a follower's hand. The deck-uniqueness test in turn.test.ts pins that assumption.
      if (lead.zeroed || card.strength > lead.strength) {
        options.push({ ...Surpass(faction, id), faction, label: `Surpass with ${id}` })
      }
    } else {
      options.push({ ...Pivot(faction, id, card.suit), faction, label: `Pivot with ${id}` })
    }
    options.push({ ...Copy(faction, id), faction, label: `Copy with ${id}` })
  }

  /*
   * **No Pass here — a follower must play a card.**
   *
   * Rulebook p10: "On your turn, you must play an action card in one of three ways" (Surpass, Copy
   * or Pivot), and only "players with no cards in their hand skip their turn". Passing belongs to
   * the initiative holder alone (p8), where it is a different move entirely: it hands the marker on
   * and *immediately ends the round*.
   *
   * Offering it here let a follower fire the initiative-holder's rule. Reported from a real game
   * and reproduced from the save: yellow led Administration-2, blue copied, white held Aggression-4
   * and was offered Pass — taking it logged "initiative passes to red", cleared the lead and
   * restarted the round, handing the human a lead out of turn. It also let bots hoard cards for
   * free, so a chapter ended with hands still full.
   *
   * Nobody can be stranded by this. Every card above pushes a `Copy` option unconditionally — Copy
   * puts the card face down for one action of the lead suit, so its own suit never disqualifies it —
   * and `advanceAfterTurn` skips a faction holding nothing before this function is ever reached.
   * A follower who gets here therefore always has at least one legal play.
   */
  return {
    state: { ...state, current: faction },
    continue: C.ask(faction, options, `${faction} follows ${lead.cardId}`),
  }
}

function performSurpass(state: GameState, faction: FactionId, cardIdStr: string): RuleResult {
  const lead = state.lead!
  const card = parseCardId(cardIdStr)
  const cards = move(state.cards, cardIdStr, CardLocation.played(faction))

  // Surpassing with a 7 seizes the initiative automatically (game-common.scala:1501).
  let seized = state.seized
  let log = [...state.log, `${faction} surpassed with ${cardIdStr}`]
  if (seized === undefined && card.strength === 7) {
    seized = faction
    log = [...log, `${faction} seized the initiative (surpassed with a 7)`]
  }

  const next = {
    ...state,
    cards,
    seized,
    passed: 0,
    roundPlays: [...state.roundPlays, { faction, cardId: cardIdStr, kind: 'surpass' as const }],
    log,
  }
  // Surpass grants the full pips, in the lead suit.
  return {
    state: next,
    continue: C.then(CheckSeize(faction, card.pips, lead.suit)),
  }
}

function performCopy(state: GameState, faction: FactionId, cardIdStr: string): RuleResult {
  const lead = state.lead!
  const cards = move(state.cards, cardIdStr, CardLocation.played(faction))
  const next = {
    ...state,
    cards,
    passed: 0,
    roundPlays: [...state.roundPlays, { faction, cardId: cardIdStr, kind: 'copy' as const }],
    log: [...state.log, `${faction} copied with ${cardIdStr}`],
  }
  // Copy grants a single pip, in the lead suit.
  return { state: next, continue: C.then(CheckSeize(faction, 1, lead.suit)) }
}

function performPivot(state: GameState, faction: FactionId, cardIdStr: string, suit: Suit): RuleResult {
  const cards = move(state.cards, cardIdStr, CardLocation.played(faction))
  const next = {
    ...state,
    cards,
    passed: 0,
    roundPlays: [...state.roundPlays, { faction, cardId: cardIdStr, kind: 'pivot' as const }],
    log: [...state.log, `${faction} pivoted with ${cardIdStr} as ${suit}`],
  }
  // Pivot grants a single pip, in the new suit.
  return { state: next, continue: C.then(CheckSeize(faction, 1, suit)) }
}

// --- seize -----------------------------------------------------------------

function performCheckSeize(state: GameState, faction: FactionId, pips: number, suit: Suit): RuleResult {
  /**
   * Galactic Bards (bc25) gets first refusal, ahead of the seize itself
   * (`game-common.scala:1550`): declare an ambition matching your played card's strength — or
   * any ambition if you played a 7. Once per turn.
   *
   * The window is "if an ambition has not been declared yet **this round**" (printed text) —
   * not this chapter. The gate used to be `declared.length === 0`, which killed the card for
   * the rest of the chapter the moment anyone declared; HRF clears its per-faction `declared`
   * flags in round-end cleanup (`game-common.scala:2226`), which is the same round scope.
   */
  const played = state.roundPlays.filter((p) => p.faction === faction).at(-1)
  if (
    hasGuild(state, faction, GALACTIC_BARDS) &&
    !state.usedThisTurn.includes(GALACTIC_BARDS) &&
    !state.declared.some((d) => d.round === state.round) &&
    state.ambitionable.length > 0 &&
    played !== undefined
  ) {
    const strength = parseCardId(played.cardId).strength
    const eligible =
      strength === 7 ? [...state.ambitions] : ambitionsForStrength(strength).filter((a) => state.ambitions.includes(a))
    const options: Action[] = eligible.map((a) => ({
      type: 'turn/bards-declare',
      faction,
      ambition: a,
      pips,
      suit,
      label: `Declare ${a} with Galactic Bards`,
    }))
    if (options.length > 0) {
      return {
        state,
        continue: C.ask(
          faction,
          [...options, { type: 'turn/bards-skip', faction, pips, suit, label: 'Skip Galactic Bards' }],
          `${faction} — Galactic Bards`,
        ),
      }
    }
  }

  if (state.seized !== undefined) {
    return { state, continue: C.then(Prelude(faction, suit, pips)) }
  }
  // A follower who has not seized may discard a non-lead card to seize initiative.
  const discardable = hand(state, faction)
  // Lattice Spies (bc16) is a card you can burn instead of a hand card
  // (`game-common.scala:1559`), which is the whole point of holding it.
  const lattice = hasGuild(state, faction, LATTICE_SPIES)
  if (discardable.length === 0 && !lattice) {
    return { state, continue: C.then(Prelude(faction, suit, pips)) }
  }
  const options: Action[] = discardable.map((id) => ({
    ...Seize(faction, id, pips, suit),
    faction,
    label: `Seize by discarding ${id}`,
  }))
  if (lattice) {
    options.push({
      type: 'turn/lattice-seize',
      faction,
      pips,
      suit,
      label: 'Seize with Lattice Spies',
    })
  }
  return {
    state,
    continue: C.ask(faction, [...options, SkipSeize(faction, pips, suit)], `${faction} may seize`),
  }
}

/** Seize by discarding the Lattice Spies card itself rather than a card from hand. */
function performLatticeSeize(
  state: GameState,
  faction: FactionId,
  pips: number,
  suit: Suit,
): RuleResult {
  const next: GameState = {
    ...state,
    courtCards: move(state.courtCards, LATTICE_SPIES, CourtPile.discard()),
    seized: faction,
    log: [...state.log, `${faction} seized the initiative with Lattice Spies`],
  }
  return { state: next, continue: C.then(Prelude(faction, suit, pips)) }
}

function performBardsDeclare(
  state: GameState,
  faction: FactionId,
  ambition: Ambition,
  pips: number,
  suit: Suit,
): RuleResult {
  // Free, and like Populist Demands it does not zero the played card.
  const taken = takeAmbitionMarker(state, faction, ambition)
  const next: GameState = { ...taken, usedThisTurn: [...taken.usedThisTurn, GALACTIC_BARDS] }
  // "When you declare an ambition" — the Farseers peek covers this declare too (docs/20 A3),
  // judged on the pre-declare hold so a Connected-drawn Farseers stays quiet (docs/21 B4).
  return {
    state: next,
    continue: afterDeclarePeek(
      next,
      faction,
      CheckSeize(faction, pips, suit),
      hasGuild(state, faction, FARSEERS),
    ),
  }
}

function performSeize(
  state: GameState,
  faction: FactionId,
  cardIdStr: string,
  pips: number,
  suit: Suit,
): RuleResult {
  const cards = move(state.cards, cardIdStr, CardLocation.discard())
  const next = {
    ...state,
    cards,
    seized: faction,
    log: [...state.log, `${faction} seized the initiative`],
  }
  return { state: next, continue: C.then(Prelude(faction, suit, pips)) }
}

// --- prelude ---------------------------------------------------------------

/** One spendable token of `r` in the faction's usable slots, if any. */
function tokenOf(state: GameState, faction: FactionId, r: Resource): string | undefined {
  const capacity = slotsOf(state, faction)
  return heldTokens(state.resources, capacity).find(
    (id) => parseResourceToken(id).resource === r,
  )
}

/** Pay one token of `r` back to the supply. Throws rather than silently granting a freebie. */
function paying(state: GameState, faction: FactionId, r: Resource): GameState {
  const token = tokenOf(state, faction, r)
  if (token === undefined) throw new Error(`${faction} has no ${r} to spend`)
  return { ...state, resources: spendToken(state.resources, token) }
}

function performPrelude(
  state: GameState,
  faction: FactionId,
  suit: Suit,
  pips: number,
): RuleResult {
  const leadSuit = state.lead?.suit ?? suit
  // Same guard as the pip menu, and it matters more here: a Prelude spend pays the **token**
  // before handing to the action, so an action that can do nothing costs a resource rather
  // than a pip. Discards stay on offer — emptying a slot is the point of them.
  const offers = preludeOffers(state, faction, suit, leadSuit).filter((o) =>
    o.kind === 'action' ? canTake(state, faction, o.action, Prelude(faction, suit, pips)) : true,
  )
  if (offers.length === 0) {
    return { state, continue: C.then(Turn(faction, suit, 0, pips)) }
  }

  const options: Action[] = offers.map((o) => {
    switch (o.kind) {
      case 'action':
        // A Loyal-granted spend names the card and the type it is spent as, so "Psionic:
        // Secure" reads as the Loyal Keepers play it is rather than an impossible option.
        return o.via === undefined
          ? {
              ...PreludeSpend(faction, o.resource, o.action, suit, pips),
              faction,
              label: `${o.resource}: ${o.action}`,
            }
          : {
              ...PreludeSpend(faction, o.resource, o.action, suit, pips),
              faction,
              via: o.via,
              label: `${o.resource} as ${o.via.as}: ${o.action} (${courtCard(o.via.card).name})`,
            }
      case 'battle-option':
        return {
          ...PreludeBattleOption(faction, o.resource, suit, pips),
          faction,
          label: `${o.resource}: add Battle option`,
        }
      case 'discard':
        return {
          ...PreludeDiscard(faction, o.resource, suit, pips),
          faction,
          label: `Discard ${o.resource} (no effect)`,
        }
    }
  })

  /**
   * Guild card Prelude abilities. The offer object carries everything the performer needs, so
   * this spreads it into the action rather than switching per kind — a new card is then a
   * `guildPreludes` entry plus a label plus a performer case.
   */
  const guild: Action[] = guildPreludes(state, faction).map((g) => ({
    ...g,
    type: 'turn/prelude-guild',
    ability: g.kind,
    faction,
    suit,
    pips,
    label: guildPreludeLabel(g),
  }))

  /*
   * "You may rearrange any resources in your resource slots." The forced half of that rule runs
   * itself, off any gain that leaves the board illegal. The *optional* half needs a door, and the
   * Prelude is the right one: it is the moment you are already looking at your resources, and its
   * `then` is the Prelude itself, so arranging returns you to the same menu having spent nothing.
   *
   * Not offered after every gain instead, which was tried: it puts a modal between every tax and
   * everything downstream of it, and reorders every trait that hangs off taxing.
   *
   * Unconditional, because reaching this menu at all means `preludeOffers` found something, which
   * means you are holding a resource. A guard for "nothing to arrange" could never be false here.
   */
  /*
   * Lore Prelude abilities. Like the guild ones these **discard the card** as their cost, so none
   * needs a once-per-turn marker. The five outrage-clearing cards are deliberately *not* gated on
   * their ambition: that half of the card prints only "Prelude", where the other half prints
   * "While X is declared".
   */
  const lore: Action[] = lorePreludes(state, faction).map((l) => ({
    ...l,
    type: 'turn/prelude-lore',
    faction,
    suit,
    pips,
    label: l.label,
  }))

  /*
   * Warlord's Terror (lore24) and Tyrant's Ego (lore25): spend a **piece you have taken** in your
   * Prelude, returning it, to take one action for free. They are the same shape — a pile, an
   * action, one for each — so they are built together and differ only in which pile and which
   * action.
   *
   * "Returning them" means back to their owner's reserve, not to your own: a trophy is a rival's
   * ship and a captive is a rival's agent. Returning a captive to *your* reserve would quietly
   * hand you a piece that is not yours.
   */
  const spoils: Action[] = []
  for (const [card, pile, act] of [
    [WARLORDS_TERROR, 'trophies', 'Influence'],
    [TYRANTS_EGO, 'captives', 'Secure'],
  ] as const) {
    if (!loreActive(state, faction, card)) continue
    const held = contentsOf(
      state.figures,
      pile === 'trophies' ? Location.trophies(faction) : Location.captives(faction),
    )
    if (held.length === 0) continue
    if (!canTake(state, faction, act, Prelude(faction, suit, pips))) continue
    spoils.push({
      type: 'turn/prelude-spoils',
      faction,
      card,
      pile,
      act,
      piece: held[0]!,
      suit,
      pips,
      label: `${loreCard(card).name} — return a ${pile === 'trophies' ? 'trophy' : 'captive'} to ${act.toLowerCase()}`,
    })
  }

  /*
   * Tycoon's Charm (lore28), first half: "you may discard any number of Material and Fuel to gain
   * 1 resource for each." Offered one swap at a time — the Prelude loops, so "any number" is
   * taking it repeatedly, and that keeps each swap a separate journalled choice rather than a
   * bulk action the player cannot undo halfway through.
   */
  const charm: Action[] = []
  if (loreActive(state, faction, TYCOONS_CHARM)) {
    const slots = slotsOf(state, faction)
    for (const spend of ['Material', 'Fuel'] as const) {
      if (countResource(state.resources, slots, spend) === 0) continue
      for (const gain of RESOURCES) {
        charm.push({
          type: 'turn/prelude-charm',
          faction,
          spend,
          gain,
          suit,
          pips,
          label: `Tycoon's Charm — trade ${spend} for ${gain}`,
        })
      }
    }
  }

  /*
   * Tycoon's Ambition (lore27): "While Tycoon is declared, before taking any other actions, you
   * may discard all of your Material and Fuel to declare exactly 1 undeclared ambition. Do not
   * place the zero marker."
   *
   * **"Do not place the zero marker" is about your played card, not the ambition marker.**
   * Declaring normally zeroes the card you played for surpass purposes — `performDeclare` sets
   * `lead.zeroed` — and this skips exactly that step while still taking an ambition marker like
   * any other declaration. So it is `takeAmbitionMarker` without the zeroing.
   *
   * "Before taking any other actions" is where it sits: the Prelude runs before the pips.
   */
  const tycoon: Action[] = []
  if (loreActive(state, faction, TYCOONS_AMBITION) && state.ambitionable.length > 0) {
    /*
     * No resource gate — the official FAQ: "You can use its ability even if you have zero
     * Material and Fuel" (docs/21 A4). Discarding all of nothing is a legal cost, so the offer
     * stands whenever Tycoon is declared and an undeclared ambition remains.
     */
    for (const a of state.ambitions) {
      if (state.declared.some((d) => d.ambition === a)) continue
      tycoon.push({
        type: 'turn/prelude-tycoon',
        faction,
        ambition: a,
        suit,
        pips,
        label: `Tycoon's Ambition — discard all Material and Fuel to declare ${a}`,
      })
    }
  }

  const arrange: Action = {
    type: 'turn/prelude-arrange',
    faction,
    suit,
    pips,
    label: 'Arrange your resource slots',
  }

  return {
    state,
    continue: C.ask(
      faction,
      [...options, ...guild, ...lore, ...spoils, ...charm, ...tycoon, arrange, EndPrelude(faction, suit, pips)],
      `${faction} — Prelude`,
    ),
  }
}

function guildPreludeLabel(g: GuildPrelude): string {
  const name = courtCard(g.card).name
  switch (g.kind) {
    case 'relic-fence':
      return `${name} — spend ${g.spend} for a Relic`
    case 'silver-tongues-resource':
      return `${name} — steal ${g.resource} from ${g.rival}`
    case 'silver-tongues-card':
      return `${name} — steal ${courtCard(g.stolen).name} from ${g.rival}`
    case 'farseers':
      return `${name} — discard your hand and redraw`
    case 'fill-slots':
      return `${name} — fill your open slots with ${g.resource}`
    case 'cartel':
      return `${name} — steal ${g.resource} from ${g.rival}`
    case 'take-played':
      return `${name} — take ${g.taken} from ${g.from}`
    case 'gates':
      return `${name} — a ship at every gate`
    case 'ships':
      return `${name} — 3 ships in a system you control`
    case 'gain-three':
      return `${name} — gain Material, Fuel and Weapon`
  }
}

/**
 * Warlord's Terror / Tyrant's Ego: give a taken piece back, take the action it buys.
 *
 * The card is **not** discarded — unlike the outrage-clearing five, these are repeatable for as
 * long as the pile lasts, which is why the offer is rebuilt each time the Prelude loops.
 */
function performPreludeSpoils(state: GameState, action: Action): RuleResult {
  const faction = action['faction'] as FactionId
  const suit = action['suit'] as Suit
  const pips = action['pips'] as number
  const piece = action['piece'] as string
  const act = action['act'] as StandardAction
  const card = action['card'] as string

  // Home to whoever owns it — a trophy is a rival's ship, a captive a rival's agent.
  const owner = parseFigureId(piece).color
  const next: GameState = {
    ...state,
    figures: move(state.figures, piece, Location.reserve(owner)),
    log: [...state.log, `${faction} returned a ${owner} piece to ${act.toLowerCase()} (${loreCard(card).name})`],
  }
  return { state: next, continue: C.then(TakeAction(faction, act, Prelude(faction, suit, pips))) }
}

/**
 * A lore card's Prelude ability. Discards the card, then applies its effect.
 *
 * Only the outrage-clearing five use this channel today; each is `{ card, clears }`, so the
 * performer is the same for all of them and a new one is a `lorePreludes` entry.
 */
function performLorePrelude(state: GameState, action: Action): RuleResult {
  const faction = action['faction'] as FactionId
  const suit = action['suit'] as Suit
  const pips = action['pips'] as number
  const card = action['card'] as string
  const clears = action['clears'] as readonly Resource[]

  const held = state.lores[faction] ?? []
  const spent: GameState = {
    ...state,
    lores: { ...state.lores, [faction]: held.filter((id) => id !== card) },
    log: [...state.log, `${faction} discarded ${loreCard(card).name}`],
  }
  return { state: clearOutrage(spent, faction, clears), continue: C.then(Prelude(faction, suit, pips)) }
}

/**
 * A Guild card's Prelude ability. Every one of these **discards the card** as its cost, which
 * is why none of them needs a once-per-turn marker.
 */
function performGuildPrelude(state: GameState, action: Action): RuleResult {
  const faction = action['faction'] as FactionId
  const suit = action['suit'] as Suit
  const pips = action['pips'] as number
  const card = action['card'] as string
  const backTo = Prelude(faction, suit, pips)
  const back = C.then(backTo)

  // Spend the card first — it is the cost, and it is paid whatever the ability does.
  const spent = (s: GameState, note: string): GameState => ({
    ...s,
    courtCards: move(s.courtCards, card, CourtPile.discard()),
    log: [...s.log, `${faction} discarded ${courtCard(card).name} — ${note}`],
  })

  switch (action['ability'] as string) {
    case 'relic-fence': {
      /*
       * The one guild Prelude that does NOT pay with the card (docs/20 A4): "Once per turn, you
       * may discard 1 resource to gain 1 Relic" — the resource is the whole cost, the card stays
       * secured, and `usedThisTurn` is the printed limit. Deliberately not `spent`.
       */
      const give = action['spend'] as Resource
      let next = paying(state, faction, give)
      const capacity = slotsOf(next, faction)
      const got = gain(next.resources, capacity, 'Relic', ResourceSlot.overflow(faction))
      next = {
        ...next,
        resources: got.tracker,
        usedThisTurn: [...next.usedThisTurn, RELIC_FENCE],
        log: [
          ...next.log,
          `${faction} traded ${give} for a Relic (Relic Fence)${got.gained ? '' : ' (no open slot)'}`,
        ],
      }
      return { state: next, continue: back }
    }

    case 'silver-tongues-resource': {
      const rival = action['rival'] as FactionId
      const resource = action['resource'] as Resource
      const token = tokenOf(state, rival, resource)
      if (token === undefined) return { state, continue: back }
      let resources = spendToken(state.resources, token)
      const capacity = slotsOf(state, faction)
      resources = gain(resources, capacity, resource, ResourceSlot.overflow(faction)).tracker
      return {
        state: spent({ ...state, resources }, `stole ${resource} from ${rival}`),
        continue: back,
      }
    }

    case 'silver-tongues-card': {
      const rival = action['rival'] as FactionId
      const stolen = action['stolen'] as string
      /*
       * "If this card is stolen, bury it" — stealing Sworn Guardians costs the theft and yields a
       * buried card (bottom of the court deck), not a kept one (docs/20 B2). Every other guild
       * card is kept as before.
       */
      const buried = stolen === SWORN_GUARDIANS
      const next: GameState = {
        ...state,
        courtCards: move(
          state.courtCards,
          stolen,
          buried ? CourtPile.deck() : CourtPile.secured(faction),
        ),
      }
      return {
        state: spent(
          next,
          buried
            ? `stole ${courtCard(stolen).name} from ${rival} — buried`
            : `stole ${courtCard(stolen).name} from ${rival}`,
        ),
        continue: back,
      }
    }

    case 'farseers': {
      /*
       * "You may discard this and **any number** of cards from your hand. Draw the same number of
       * cards **(including Farseers)** from the **bottom of the action discard pile**."
       *
       * The audit (docs/20 A3) found this wrong three ways — forced whole-hand, drawing the deck
       * top, and drawing one too few — all three confirmed by the official FAQ ("discarded 2
       * cards plus Farseers → draw 3"). The card is spent the moment the ability is chosen; the
       * picker below asks which hand cards join it, zero included ("discard zero → draw 1").
       */
      const paid = spent(state, 'chose cards to send with it')
      return { state: paid, continue: farseersPick(paid, faction, [], suit, pips) }
    }

    /**
     * Mining / Shipping Interest: top every open slot up. HRF falls back to *stealing* the
     * resource once the supply empties (`game-guilds.scala:77`), which is the card's second
     * sentence and easy to miss.
     */
    case 'fill-slots': {
      const r = action['resource'] as Resource
      let next = state
      let gained = 0
      let stolen = 0
      for (;;) {
        const capacity = slotsOf(next, faction)
        if (openSlots(next.resources, capacity).length === 0) break
        if (contentsOf(next.resources, ResourceSlot.supply(r)).length > 0) {
          next = { ...next, resources: gain(next.resources, capacity, r, ResourceSlot.overflow(faction)).tracker }
          gained++
          continue
        }
        // Supply dry — take one off a rival instead, if any is reachable.
        const victim = next.factions.find(
          (e) =>
            e !== faction &&
            !securedCards(next, e).includes(SWORN_GUARDIANS) &&
            tokenOf(next, e, r) !== undefined,
        )
        if (victim === undefined) break
        next = { ...next, resources: spendToken(next.resources, tokenOf(next, victim, r)!) }
        next = { ...next, resources: gain(next.resources, capacity, r, ResourceSlot.overflow(faction)).tracker }
        stolen++
      }
      const note = `filled ${gained} slot(s) with ${r}${stolen > 0 ? `, stealing ${stolen}` : ''}`
      return { state: spent(next, note), continue: back }
    }

    case 'cartel': {
      const rival = action['rival'] as FactionId
      const r = action['resource'] as Resource
      const token = tokenOf(state, rival, r)
      if (token === undefined) return { state, continue: back }
      let resources = spendToken(state.resources, token)
      resources = gain(resources, slotsOf(state, faction), r, ResourceSlot.overflow(faction)).tracker
      return { state: spent({ ...state, resources }, `took ${r} from ${rival}`), continue: back }
    }

    /**
     * The Unions take a card out of a played pile — **held until the round ends** (docs/20 B1).
     * The card says "When the round ends, draw that card into your hand", and the official FAQ
     * confirms: "at the end of the round, after all players have finished their turns." This file
     * used to take it straight to hand with an equivalence argument about replays; the argument
     * missed that a card in hand this round can fund a seize-by-discard, counts in the public
     * hand sizes, and is swept by whole-hand effects. `performEndRound` delivers.
     */
    case 'take-played': {
      const taken = action['taken'] as string
      const from = action['from'] as FactionId
      const next: GameState = {
        ...state,
        cards: move(state.cards, taken, CardLocation.pending(faction)),
      }
      return {
        state: spent(next, `set aside ${taken} from ${from}'s played cards until the round ends`),
        continue: back,
      }
    }

    case 'gates': {
      /*
       * "Place 1 ship in each gate (unless out of play)." The card does not say what happens when
       * the reserve cannot reach every gate — the same silence Mass Uprising resolves by making
       * the systems that get a ship the player's choice (vox.ts, docs/20 B3). This used to fill
       * gates in board-definition order, an accident of data layout; now the shortage prompts,
       * and only the shortage: with a ship for every gate there is nothing to decide.
       */
      const gates = state.board.systems.filter((s) => systemInfo(s).isGate)
      const ships = contentsOf(state.figures, Location.reserve(faction)).filter(
        (id) => parseFigureId(id).piece === 'Ship',
      ).length
      if (ships > 0 && ships < gates.length) {
        const paid = spent(state, `placing ${ships} ship(s) at gates of their choice`)
        return { state: paid, continue: gatesPlacement(paid, faction, [], suit, pips) }
      }
      let next = state
      let placed = 0
      for (const s of gates) {
        const ship = shipFromReserve(next, faction)
        if (ship === undefined) break
        next = { ...next, figures: move(next.figures, ship, Location.system(s)) }
        placed++
      }
      return { state: spent(next, `placed ${placed} ship(s), one at each gate`), continue: back }
    }

    case 'ships': {
      /*
       * "Place 3 ships in a system you control." The system is picked on the map: choosing the
       * ability spends the card, then a `turn/ships-place` ask lights the controlled systems up
       * (the docs/20 B3 pattern). Old journals carry the system inside this action — that shape
       * still places directly, so existing saves replay unchanged.
       */
      const chosen = action['system'] as SystemId | undefined
      if (chosen === undefined) {
        const ships = contentsOf(state.figures, Location.reserve(faction)).filter(
          (id) => parseFigureId(id).piece === 'Ship',
        ).length
        const n = Math.min(3, ships)
        const paid = spent(state, `placing ${n} ship${n === 1 ? '' : 's'} in a system they control`)
        return { state: paid, continue: shipsPlacement(paid, faction, suit, pips) }
      }
      let next = state
      let placed = 0
      for (let i = 0; i < 3; i++) {
        const ship = shipFromReserve(next, faction)
        if (ship === undefined) break
        next = { ...next, figures: move(next.figures, ship, Location.system(chosen)) }
        placed++
      }
      return { state: spent(next, `placed ${placed} ship(s) in ${chosen}`), continue: back }
    }

    case 'gain-three': {
      let next = state
      /*
       * Elder Broker is the one Prelude that gains without spending first, so it is the only one
       * here that can overrun the slots — every other case frees a slot before filling one, and
       * `overflowThen` would be a no-op for them.
       */
      for (const r of ['Material', 'Fuel', 'Weapon'] as const) {
        const capacity = slotsOf(next, faction)
        next = { ...next, resources: gain(next.resources, capacity, r, ResourceSlot.overflow(faction)).tracker }
      }
      const brokered = spent(next, 'gained Material, Fuel and Weapon')
      return { state: brokered, continue: overflowThen(brokered, faction, backTo) }
    }

    default:
      return { state, continue: back }
  }
}

function shipFromReserve(state: GameState, faction: FactionId): string | undefined {
  return contentsOf(state.figures, Location.reserve(faction)).find(
    (id) => parseFigureId(id).piece === 'Ship',
  )
}

/**
 * Spend the token, then take the action for free. The action's `then` is the Prelude menu
 * again, not the next pip — that is what keeps it free and what lets several be bought.
 */
function performPreludeSpend(
  state: GameState,
  faction: FactionId,
  resource: Resource,
  action: StandardAction,
  suit: Suit,
  pips: number,
): RuleResult {
  const next = paying(state, faction, resource)
  return {
    state: { ...next, log: [...next.log, `${faction} spent ${resource} in Prelude for ${action}`] },
    continue: C.then(TakeAction(faction, action, Prelude(faction, suit, pips))),
  }
}

function performPreludeBattleOption(
  state: GameState,
  faction: FactionId,
  resource: Resource,
  suit: Suit,
  pips: number,
): RuleResult {
  const next = paying(state, faction, resource)
  return {
    state: {
      ...next,
      anyBattle: true,
      log: [...next.log, `${faction} spent ${resource} in Prelude — this card may Battle`],
    },
    continue: C.then(Prelude(faction, suit, pips)),
  }
}

function performPreludeDiscard(
  state: GameState,
  faction: FactionId,
  resource: Resource,
  suit: Suit,
  pips: number,
): RuleResult {
  const next = paying(state, faction, resource)
  return {
    state: { ...next, log: [...next.log, `${faction} discarded ${resource}`] },
    continue: C.then(Prelude(faction, suit, pips)),
  }
}

// --- pip loop --------------------------------------------------------------

/**
 * A second action riding along with a single pip, for Tactical (Warrior) and Charismatic
 * (Feastbringer).
 *
 * Both cards read "you may X before or after you Y", and the shape that gives is *not* a new kind
 * of pip. It is a different **continuation**: HRF spells the same thing by passing a `MayMove` /
 * `MustSecure` step as the action's `then` (game-common.scala:2041-2078), and `then` is already
 * exactly that in this engine. So the pip loop is untouched — what changes is what a chosen
 * action returns to.
 *
 * "Before or after" then falls out of offering *two menu entries* rather than asking about
 * ordering mid-action:
 *
 *   Tactical     Battle, then may Move  |  Move, then may Battle
 *   Charismatic  Secure, then may Influence  |  Influence, then must Secure
 *
 * The second of each pair is what buys you the "before". Its follow-up is a **must**, because the
 * pip was bought for the primary action — Influence-then-Secure may not quietly become a free
 * Influence. `Move, then must Battle` is offered only when the suit does not already grant Move,
 * which is HRF's `if (canMove.not)`: with both in the suit the may-pair already covers it.
 *
 * Both traits require `one` — a pip from a Copy or a Pivot — which is what the cards mean by
 * "when you Copy or Pivot". Battle counts even when it was a spent Weapon that granted it, since
 * `available` already includes that and the Warrior's card calls it out explicitly.
 */
function pipOptions(
  state: GameState,
  faction: FactionId,
  available: readonly StandardAction[],
  then: PipReturn,
): Action[] {
  const bonus = copiedOrPivoted(state, faction)
  const tactical = bonus && hasTrait(state, faction, 'Tactical') && available.includes('Battle')
  const charismatic = bonus && hasTrait(state, faction, 'Charismatic') && available.includes('Secure')

  const pair = (act: StandardAction, follow: StandardAction, label: string): Action => ({
    ...TakeAction(faction, act, MayFollow(faction, follow, then)),
    faction,
    label,
  })

  // Only offer what could actually do something. Without this a pip spent on Repair with
  // nothing damaged, or Tax with no untaxed city, falls straight through and is simply gone.
  const options: Action[] = []
  for (const a of available) {
    if (!canTake(state, faction, a, then)) continue
    if (tactical && a === 'Battle') options.push(pair('Battle', 'Move', 'Battle, then may Move'))
    else if (tactical && a === 'Move') options.push(pair('Move', 'Battle', 'Move, then may Battle'))
    else if (charismatic && a === 'Secure')
      options.push(pair('Secure', 'Influence', 'Secure, then may Influence'))
    else options.push({ ...TakeAction(faction, a, then), faction, label: a })
  }

  /*
   * The "before" entries, which reach an action this suit may not otherwise offer. Each is gated
   * on the required follow-up being satisfiable at all (docs/21 B1) — the FAQ says an unmet
   * "must" undoes the primary action, and the constructive equivalent is never opening a pair
   * whose second half cannot happen. The action offers themselves then restrict per-leg/per-slot.
   */
  if (
    tactical &&
    !available.includes('Move') &&
    canTake(state, faction, 'Move', then) &&
    canMustBattleMove(state, faction)
  ) {
    options.push({
      ...TakeAction(faction, 'Move', MustFollow(faction, 'Battle', then)),
      faction,
      label: 'Move, then must Battle',
    })
  }
  if (
    charismatic &&
    canTake(state, faction, 'Influence', then) &&
    canMustSecureInfluence(state, faction)
  ) {
    options.push({
      ...TakeAction(faction, 'Influence', MustFollow(faction, 'Secure', then)),
      faction,
      label: 'Influence, then must Secure',
    })
  }
  return options
}

/*
 * Handled by the leaders module. The type strings are written out here rather than imported
 * because `rules/leaders.ts` reaches this file through `rules/setup.ts`, so importing it back
 * would close a cycle — the same reason `ambition/declare` builds `leaders/after-declare` inline.
 */
const MayFollow = (faction: FactionId, act: StandardAction, then: PipReturn): Action => ({
  type: 'leaders/may-follow',
  faction,
  act,
  then,
})
const MustFollow = (faction: FactionId, act: StandardAction, then: PipReturn): Action => ({
  type: 'leaders/must-follow',
  faction,
  act,
  then,
})

function performTurn(
  state: GameState,
  faction: FactionId,
  suit: Suit,
  done: number,
  total: number,
): RuleResult {
  if (done >= total) {
    return { state, continue: C.then(EndTurn(faction)) }
  }
  const suited = SUIT_ACTIONS[suit as keyof typeof SUIT_ACTIONS] ?? []
  // A Weapon spent in the Prelude adds Battle to a card whose suit cannot buy it.
  const available =
    state.anyBattle && !suited.includes('Battle') ? [...suited, 'Battle' as const] : suited
  const then = Turn(faction, suit, done + 1, total)
  const options = pipOptions(state, faction, available, then)
  const forfeit: Action = { ...EndTurn(faction), faction, label: `End turn (forfeit ${total - done})` }

  // Nothing this card's suit can buy is possible — end the turn rather than stall on a menu
  // whose only option is to leave.
  if (options.length === 0) {
    return {
      state: {
        ...state,
        log: [...state.log, `${faction} has no ${suit} action available (${total - done} pip(s) lost)`],
      },
      continue: C.then(EndTurn(faction)),
    }
  }

  return {
    state,
    continue: C.ask(faction, [...options, forfeit], `${faction} — action ${done + 1} of ${total} (${suit})`),
  }
}

// --- end turn / round ------------------------------------------------------

/**
 * Ships and starports this faction has anywhere on the map.
 *
 * Cities are deliberately not counted. The rulebook's condition is "no starports **or ships** on
 * the map", so a faction reduced to cities alone still qualifies — which is the interesting case,
 * since a city with no fleet around it is exactly the position this rule exists to rescue.
 */
function fleetOnMap(state: GameState, faction: FactionId): number {
  return state.board.systems.reduce((n, s) => {
    const here = contentsOf(state.figures, Location.system(s)).filter((id) => {
      const p = parseFigureId(id)
      return p.color === faction && (p.piece === 'Ship' || p.piece === 'Starport')
    })
    return n + here.length
  }, 0)
}

/** Reinforcements for a swept-off faction — rulebook p22, "Elimination & Concession". */
const Reinforce = (faction: FactionId, system: SystemId): Action => ({
  type: 'turn/reinforce',
  faction,
  system,
  label: `Place ships in ${system}`,
})

/**
 * The no-elimination rule.
 *
 * p22: *Rarely, a player will have no starports or ships on the map. If this happens, they place 3
 * fresh ships in any gate at the end of their turn.* There is no elimination in Arcs — a player
 * swept off the board comes straight back, which is what keeps a runaway leader from removing
 * someone from the game entirely.
 *
 * **"Any gate" means any gate**, not one they control or can reach: they hold nothing, so a
 * reachability test would have nothing to work from. Every gate in play is offered.
 *
 * Reserve ships are always fresh, so no filtering is needed — destroying a ship clears its damage
 * on the way back (`battle.ts`). Returns `undefined` when there is nothing to decide, which covers
 * both the ordinary case and a faction whose ships are all held as someone else's trophies.
 */
function offerReinforce(state: GameState, faction: FactionId): Continue | undefined {
  if (fleetOnMap(state, faction) > 0) return undefined
  const spare = contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  )
  if (spare.length === 0) return undefined
  const gates = state.board.systems.filter((s) => systemInfo(s).isGate)
  return C.ask(
    faction,
    gates.map((g) => Reinforce(faction, g)),
    'Swept from the map — place ships in any gate',
  )
}

/**
 * Place the reinforcements, then carry on with the turn hand-off.
 *
 * Three, or as many as remain: the fine print is explicit that if you must place more pieces than
 * possible you place the maximum possible.
 */
function performReinforce(state: GameState, faction: FactionId, target: SystemId): RuleResult {
  const ships = contentsOf(state.figures, Location.reserve(faction))
    .filter((id) => parseFigureId(id).piece === 'Ship')
    .slice(0, REINFORCEMENTS)
  const figures = ships.reduce((f, id) => move(f, id, Location.system(target)), state.figures)
  return advanceAfterTurn(
    {
      ...state,
      figures,
      log: [
        ...state.log,
        `${faction} was swept from the map and placed ${ships.length} ship${
          ships.length === 1 ? '' : 's'
        } in ${target}`,
      ],
    },
    faction,
  )
}

/** How many ships a swept faction returns with. */
const REINFORCEMENTS = 3

/**
 * Gatekeepers' shortage picker: which gates get the remaining ships (docs/20 B3).
 *
 * Only reached when the reserve holds fewer ships than there are gates in play — the case the
 * card does not cover, resolved as the player's choice by the same reasoning as Mass Uprising's
 * shortage (vox.ts). `placed` excludes gates already given a ship, which is what enforces
 * "1 ship in **each** gate"; the loop ends when the reserve or the gates run out.
 */
function gatesPlacement(
  state: GameState,
  faction: FactionId,
  placed: readonly string[],
  suit: Suit,
  pips: number,
): Continue {
  const remaining = state.board.systems.filter(
    (s) => systemInfo(s).isGate && !placed.includes(s),
  )
  const ships = contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  ).length
  if (ships === 0 || remaining.length === 0) return C.then(Prelude(faction, suit, pips))
  const options: Action[] = remaining.map((s) => ({
    type: 'turn/gates-place',
    faction,
    system: s,
    placed: [...placed],
    suit,
    pips,
    label: `Place a ship in ${s} (${ships} left, one per gate)`,
  }))
  return C.ask(faction, options, `Gatekeepers — choose gates for the last ${ships} ship(s)`)
}

/**
 * The 3-ships placement: which controlled system takes the group (bc12/13/14/15).
 *
 * One click places the whole group — "3 ships in a system you control" is a single system, so
 * unlike Gatekeepers' shortage there is no loop and no exclusion list. Controlled systems can
 * exist at ability-choice time and all be gone here only if `rules` changed in between, which
 * nothing on this path does — the empty guard is belt-and-braces for the replay of a stale
 * journal, where the ability is already paid and the Prelude simply resumes.
 */
function shipsPlacement(state: GameState, faction: FactionId, suit: Suit, pips: number): Continue {
  const ships = contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === 'Ship',
  ).length
  const n = Math.min(3, ships)
  const options: Action[] = state.board.systems
    .filter((s) => rules(state, faction, s))
    .map((s) => ({
      type: 'turn/ships-place',
      faction,
      system: s,
      suit,
      pips,
      label: `Place ${n} ship${n === 1 ? '' : 's'} in ${s}`,
    }))
  if (n === 0 || options.length === 0) return C.then(Prelude(faction, suit, pips))
  return C.ask(faction, options, `Place ${n} ship${n === 1 ? '' : 's'} in a system you control`)
}

/** Put the group down in the chosen system, then return to the Prelude. */
function performShipsPlace(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  suit: Suit,
  pips: number,
): RuleResult {
  let next = state
  let placed = 0
  for (let i = 0; i < 3; i++) {
    const ship = shipFromReserve(next, faction)
    if (ship === undefined) break
    next = { ...next, figures: move(next.figures, ship, Location.system(system)) }
    placed++
  }
  return {
    state: {
      ...next,
      log: [...next.log, `${faction} placed ${placed} ship${placed === 1 ? '' : 's'} in ${system}`],
    },
    continue: C.then(Prelude(faction, suit, pips)),
  }
}

/** Place one Gatekeepers ship in the chosen gate, then re-ask until the reserve runs out. */
function performGatesPlace(
  state: GameState,
  faction: FactionId,
  system: SystemId,
  placed: readonly string[],
  suit: Suit,
  pips: number,
): RuleResult {
  const ship = shipFromReserve(state, faction)
  if (ship === undefined) return { state, continue: C.then(Prelude(faction, suit, pips)) }
  const next: GameState = {
    ...state,
    figures: move(state.figures, ship, Location.system(system)),
    log: [...state.log, `${faction} placed a ship in ${system} (Gatekeepers)`],
  }
  return { state: next, continue: gatesPlacement(next, faction, [...placed, system], suit, pips) }
}

/**
 * Farseers' picker: which hand cards join the discard. Carried in the actions themselves —
 * journal-safe plain ids — and rebuilt after every pick, so the journal replays the exact
 * sequence and Done always announces the true draw count.
 */
function farseersPick(
  state: GameState,
  faction: FactionId,
  picked: readonly string[],
  suit: Suit,
  pips: number,
): Continue {
  const hand = contentsOf(state.cards, CardLocation.hand(faction)).filter(
    (c) => !picked.includes(c),
  )
  const options: Action[] = hand.map((c) => ({
    type: 'turn/farseers-pick',
    faction,
    card: c,
    picked: [...picked],
    suit,
    pips,
    label: `Discard ${c}`,
  }))
  options.push({
    type: 'turn/farseers-done',
    faction,
    picked: [...picked],
    suit,
    pips,
    label: `Done — draw ${picked.length + 1} from the discard's bottom`,
  })
  return C.ask(faction, options, `${faction} — Farseers: discard any number of cards`)
}

/**
 * The resolution: shuffle the picked cards **before** placing them (the official FAQ's ruling —
 * "one of the few situations where discard order matters", because the draws come off the same
 * pile's bottom and a small pile can hand your own discards back), then draw picked + 1, the +1
 * being Farseers itself.
 */
function performFarseersDone(
  state: GameState,
  faction: FactionId,
  picked: readonly string[],
  suit: Suit,
  pips: number,
): RuleResult {
  const [shuffled, rng] = shuffle(state.rng, picked)
  let cards = state.cards
  for (const c of shuffled) cards = move(cards, c, CardLocation.discard())
  const want = picked.length + 1
  let drawn = 0
  for (let i = 0; i < want; i++) {
    const bottom = contentsOf(cards, CardLocation.discard())[0]
    if (bottom === undefined) break
    cards = move(cards, bottom, CardLocation.hand(faction))
    drawn++
  }
  return {
    state: {
      ...state,
      cards,
      rng,
      log: [
        ...state.log,
        `${faction} discarded ${picked.length} card(s) and drew ${drawn} from the bottom of the discard (Farseers)`,
      ],
    },
    continue: C.then(Prelude(faction, suit, pips)),
  }
}

function performEndTurn(state: GameState, faction: FactionId): RuleResult {
  // Per-turn resets: cities become taxable and starports buildable again next turn.
  // `usedThisTurn` joined this list late (docs/20 A4): without it, Galactic Bards' and Relic
  // Fence's "once per turn" was actually once per game.
  state = {
    ...state,
    taxedThisTurn: [],
    workedThisTurn: [],
    loreUsedThisTurn: [],
    usedThisTurn: [],
    anyBattle: false,
  }
  /*
   * Checked before the hand-off, because the rule is "at the end of *their* turn" — the pieces have
   * to be back before the next faction acts into the space they left.
   */
  const sweptOff = offerReinforce(state, faction)
  if (sweptOff !== undefined) return { state, continue: sweptOff }
  return advanceAfterTurn(state, faction)
}

/** Hand the turn on: the tail of `performEndTurn`, shared with the reinforcement path. */
function advanceAfterTurn(state: GameState, faction: FactionId): RuleResult {
  const next = nextInOrder(state, faction)
  if (next === undefined) throw new Error('no next faction')

  // The player who led this turn keeps play moving to the next in order who still holds
  // cards; when we come back around to the lead player, the round is over.
  const leadFaction = state.lead?.faction
  if (next === leadFaction || state.lead === undefined) {
    return { state, continue: C.then(EndRound()) }
  }
  if (hand(state, next).length === 0) {
    // Skip a faction with no cards.
    return { state: { ...state, current: next }, continue: C.then(EndTurn(next)) }
  }
  return { state: { ...state, current: next }, continue: C.then(FollowMain(next)) }
}

const EndRound = (): Action => ({ type: 'round/end' })

/**
 * Who holds the initiative after this round (`game-common.scala:2162`).
 *
 * A seize settles it. Otherwise it goes to whoever played the **highest-strength card of the
 * lead suit**, and only face-up plays count:
 *
 *   - **lead** and **surpass** qualify — both go to HRF's `f.displayed` in the lead suit.
 *   - **copy** never does: the card is played face down (`f.blind`, game-common.scala:1515),
 *     so copying keeps your card secret at the cost of any claim on the initiative.
 *   - **pivot** never does: it is displayed as its *new* suit, which is by definition not the
 *     lead suit.
 *
 * A lead player who **declared an ambition is excluded** — declaring zeroes the card, and that
 * is what makes declaring cost you the initiative rather than being free.
 *
 * With nobody eligible, it stays with the current holder, matching HRF's stable sort over a
 * faction list already ordered by initiative.
 */
function nextInitiative(state: GameState): FactionId {
  if (state.seized !== undefined) return state.seized
  const lead = state.lead
  if (lead === undefined) return state.initiativeOrder[0]!

  let best: { faction: FactionId; strength: number } | undefined
  for (const play of state.roundPlays) {
    if (play.kind !== 'lead' && play.kind !== 'surpass') continue
    if (play.faction === lead.faction && lead.zeroed) continue
    const card = parseCardId(play.cardId)
    if (card.suit !== lead.suit) continue
    if (best === undefined || card.strength > best.strength) {
      best = { faction: play.faction, strength: card.strength }
    }
  }
  return best?.faction ?? state.initiativeOrder[0]!
}

/**
 * What every round end does, whether it arrives normally or by a pass (5.1.2: passing
 * "immediately end[s] the round").
 *
 * Rulebook 5.4.1: "Discard all played action cards, and any action card used to seize the
 * initiative, into the action discard pile on the map face down." The seize card is already
 * discarded when it is spent; the played piles used to persist for the whole chapter (docs/22),
 * which let a Union take any card anyone had played in any earlier round and left the action
 * discard nearly empty for the bottom-of-discard draws.
 *
 * Then the Unions' held cards arrive — "when the round ends" (docs/20 B1).
 */
function endRoundHousekeeping(state: GameState): GameState {
  let cards = state.cards
  const log: string[] = []
  let discarded = 0
  for (const f of state.factions) {
    const played = [...contentsOf(cards, CardLocation.played(f))]
    if (played.length === 0) continue
    cards = moveAll(cards, played, CardLocation.discard())
    discarded += played.length
  }
  if (discarded > 0) log.push(`round over — ${discarded} played card${discarded === 1 ? '' : 's'} discarded`)
  for (const f of state.factions) {
    for (const id of contentsOf(cards, CardLocation.pending(f))) {
      cards = move(cards, id, CardLocation.hand(f))
      log.push(`${f} drew ${id} (held by a Union)`)
    }
  }
  return log.length > 0 ? { ...state, cards, log: [...state.log, ...log] } : state
}

function performEndRound(state: GameState): RuleResult {
  state = endRoundHousekeeping(state)

  const holder = nextInitiative(state)
  const order = rotateTo(state.factions, holder)

  if (factionsWithCards(state).length === 0) {
    return {
      state: { ...state, initiativeOrder: order },
      continue: C.then(CheckChapterEnd()),
    }
  }
  return {
    state: { ...state, initiativeOrder: order, lead: undefined, seized: undefined },
    continue: C.then(StartRound()),
  }
}

// --- pass -----------------------------------------------------------------

function performPass(state: GameState, faction: FactionId): RuleResult {
  const holdingCards = factionsWithCards(state)
  const passed = hand(state, faction).length > 0 ? state.passed + 1 : state.passed
  const log = [...state.log, `${faction} passed`]

  if (passed >= holdingCards.length || holdingCards.length === 0) {
    // Everyone still holding cards has passed — the chapter ends.
    return { state: { ...state, passed: 0, log }, continue: C.then(CheckChapterEnd()) }
  }

  // Passing hands the initiative on and restarts the lead (`game-common.scala:1338-1348`).
  //
  // A seize is **not** cleared here. HRF's pass touches neither `seized` nor the played
  // cards; ours discarded the claim, so a rival seizing and anyone passing afterwards lost
  // the seize entirely — 1419 claims across 40 driven games. `seized` is cleared where it is
  // consumed, at end of round.
  const next = nextInOrder(state, faction) ?? faction
  const order = rotateTo(state.factions, next)
  // 5.1.2: a pass ends the round, so the played cards go and the Unions' held cards arrive.
  const ended = endRoundHousekeeping({ ...state, log })
  return {
    state: {
      ...ended,
      passed,
      initiativeOrder: order,
      lead: undefined,
      roundPlays: [],
      current: next,
      log: [...ended.log, `initiative passes to ${next}`],
    },
    continue: C.then(LeadMain(next)),
  }
}

// --- chapter end -----------------------------------------------------------

const CheckChapterEnd = (): Action => ({ type: 'chapter/check-end' })

/**
 * The chapter is over: hand off to ambition scoring, which awards power, then checks the
 * win condition and either ends the game or starts the next chapter (ambitions.ts).
 */
function performCheckChapterEnd(state: GameState): RuleResult {
  return { state, continue: C.then(ScoreAmbitions()) }
}

// --- module ----------------------------------------------------------------

export const TurnModule: RuleModule = {
  id: 'turn',
  perform(state: GameState, action: Action): RuleResult {
    switch (action.type) {
      case 'chapter/start':
        return performStartChapter(state)
      case 'round/start':
        return performStartRound(state)
      case 'turn/mulligan':
        return performMulligan(state, action['faction'] as FactionId)
      case 'turn/keep-hand':
        return { state, continue: C.then(StartRound()) }
      case 'turn/lead-main':
        return performLeadMain(state, action['faction'] as FactionId)
      case 'turn/lead':
        return performLead(
          state,
          action['faction'] as FactionId,
          action['card'] as string,
          action['suit'] as Suit,
        )
      case 'turn/follow-main':
        return performFollowMain(state, action['faction'] as FactionId)
      case 'turn/surpass':
        return performSurpass(state, action['faction'] as FactionId, action['card'] as string)
      case 'turn/copy':
        return performCopy(state, action['faction'] as FactionId, action['card'] as string)
      case 'turn/pivot':
        return performPivot(
          state,
          action['faction'] as FactionId,
          action['card'] as string,
          action['suit'] as Suit,
        )
      case 'turn/check-seize':
        return performCheckSeize(
          state,
          action['faction'] as FactionId,
          action['pips'] as number,
          action['suit'] as Suit,
        )
      case 'turn/seize':
        return performSeize(
          state,
          action['faction'] as FactionId,
          action['card'] as string,
          action['pips'] as number,
          action['suit'] as Suit,
        )
      case 'turn/lattice-seize':
        return performLatticeSeize(
          state,
          action['faction'] as FactionId,
          action['pips'] as number,
          action['suit'] as Suit,
        )
      case 'turn/bards-declare':
        return performBardsDeclare(
          state,
          action['faction'] as FactionId,
          action['ambition'] as Ambition,
          action['pips'] as number,
          action['suit'] as Suit,
        )
      case 'turn/bards-skip':
        return {
          state: {
            ...state,
            usedThisTurn: [...state.usedThisTurn, GALACTIC_BARDS],
          },
          continue: C.then(
            CheckSeize(
              action['faction'] as FactionId,
              action['pips'] as number,
              action['suit'] as Suit,
            ),
          ),
        }
      case 'turn/skip-seize':
        return {
          state,
          continue: C.then(Prelude(action['faction'] as FactionId, action['suit'] as Suit, action['pips'] as number)),
        }
      case 'turn/prelude':
        return performPrelude(
          state,
          action['faction'] as FactionId,
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/prelude-spend':
        return performPreludeSpend(
          state,
          action['faction'] as FactionId,
          action['resource'] as Resource,
          action['action'] as StandardAction,
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/prelude-battle':
        return performPreludeBattleOption(
          state,
          action['faction'] as FactionId,
          action['resource'] as Resource,
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/prelude-guild':
        return performGuildPrelude(state, action)
      case 'turn/prelude-discard':
        return performPreludeDiscard(
          state,
          action['faction'] as FactionId,
          action['resource'] as Resource,
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/prelude-tycoon': {
        const faction = action['faction'] as FactionId
        const suit = action['suit'] as Suit
        const pips = action['pips'] as number
        const ambition = action['ambition'] as Ambition
        // All of both, which is the price the card names.
        let resources = state.resources
        const slots = slotsOf(state, faction)
        for (const token of heldTokens(resources, slots)) {
          const r = parseResourceToken(token).resource
          if (r === 'Material' || r === 'Fuel') resources = spendToken(resources, token)
        }
        const paid: GameState = {
          ...state,
          resources,
          log: [...state.log, `${faction} discarded all Material and Fuel (Tycoon's Ambition)`],
        }
        // Marker taken as normal; the played card is *not* zeroed.
        const declaredNow = takeAmbitionMarker(paid, faction, ambition)
        return { state: declaredNow, continue: C.then(Prelude(faction, suit, pips)) }
      }
      case 'turn/prelude-charm': {
        const faction = action['faction'] as FactionId
        const suit = action['suit'] as Suit
        const pips = action['pips'] as number
        const spend = action['spend'] as Resource
        const want = action['gain'] as Resource
        const slots = slotsOf(state, faction)
        const token = heldTokens(state.resources, slots).find(
          (t) => parseResourceToken(t).resource === spend,
        )
        if (token === undefined) return { state, continue: C.then(Prelude(faction, suit, pips)) }
        const after = gain(spendToken(state.resources, token), slots, want, ResourceSlot.overflow(faction))
        const next: GameState = {
          ...state,
          resources: after.tracker,
          log: [...state.log, `${faction} traded ${spend} for ${want} (Tycoon's Charm)`],
        }
        return { state: next, continue: overflowThen(next, faction, Prelude(faction, suit, pips)) }
      }
      case 'turn/prelude-spoils':
        return performPreludeSpoils(state, action)
      case 'turn/prelude-lore':
        return performLorePrelude(state, action)
      case 'turn/prelude-arrange': {
        const faction = action['faction'] as FactionId
        const suit = action['suit'] as Suit
        const pips = action['pips'] as number
        // Returns to the Prelude, so arranging costs neither a pip nor a resource.
        return { state, continue: arrangeThen(state, faction, Prelude(faction, suit, pips)) }
      }
      case 'turn/prelude-done':
        return {
          state,
          continue: C.then(
            Turn(action['faction'] as FactionId, action['suit'] as Suit, 0, action['pips'] as number),
          ),
        }
      case 'turn/pips':
        return performTurn(
          state,
          action['faction'] as FactionId,
          action['suit'] as Suit,
          action['done'] as number,
          action['total'] as number,
        )
      case 'turn/reinforce':
        return performReinforce(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
        )
      case 'turn/ships-place':
        return performShipsPlace(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/gates-place':
        return performGatesPlace(
          state,
          action['faction'] as FactionId,
          action['system'] as SystemId,
          action['placed'] as string[],
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/farseers-pick':
        return {
          state,
          continue: farseersPick(
            state,
            action['faction'] as FactionId,
            [...(action['picked'] as string[]), action['card'] as string],
            action['suit'] as Suit,
            action['pips'] as number,
          ),
        }
      case 'turn/farseers-done':
        return performFarseersDone(
          state,
          action['faction'] as FactionId,
          action['picked'] as string[],
          action['suit'] as Suit,
          action['pips'] as number,
        )
      case 'turn/end':
        return performEndTurn(state, action['faction'] as FactionId)
      case 'round/end':
        return performEndRound(state)
      case 'turn/pass':
        return performPass(state, action['faction'] as FactionId)
      case 'chapter/check-end':
        return performCheckChapterEnd(state)
      default:
        return unhandled(state)
    }
  },
}

export type { ActionCard }
