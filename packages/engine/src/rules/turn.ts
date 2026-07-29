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
import { citiesInReserve, slotsOf } from '../control.js'
import { system as systemInfo } from '../board.js'
import {
  CourtPile,
  GALACTIC_BARDS,
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
  takeAmbitionMarker,
} from './ambitions.js'
import { TakeAction, arrangeThen, canTake, overflowThen } from './standard-actions.js'
import type { PipReturn } from './standard-actions.js'
import { hasTrait } from '../leaders.js'
import { TYCOONS_CHARM, TYRANTS_EGO, WARLORDS_TERROR, loreActive, loreCard } from '../lore.js'
import { clearOutrage } from '../outrage.js'
import { copiedOrPivoted } from '../observe.js'

// --- action constructors ---------------------------------------------------

export const StartChapter = (): Action => ({ type: 'chapter/start' })
const StartRound = (): Action => ({ type: 'round/start' })
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

  const [order, rng] = shuffle(state.rng, contentsOf(cards, deck))
  let dealt = cards
  for (const f of state.factions) {
    const take = order.splice(0, CHAPTER_HAND_SIZE)
    dealt = moveAll(dealt, take, CardLocation.hand(f))
  }

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
  return { state: next, continue: C.then(StartRound()) }
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

  return {
    state: { ...state, current: faction },
    continue: C.ask(faction, [...options, Pass(faction)], `${faction} follows ${lead.cardId}`),
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
   * (`game-common.scala:1550`): before anyone has declared, declare an ambition matching your
   * played card's strength — or any ambition if you played a 7. Once per turn.
   */
  const played = state.roundPlays.filter((p) => p.faction === faction).at(-1)
  if (
    hasGuild(state, faction, GALACTIC_BARDS) &&
    !state.usedThisTurn.includes(GALACTIC_BARDS) &&
    state.declared.length === 0 &&
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
  return { state: next, continue: C.then(CheckSeize(faction, pips, suit)) }
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
        return {
          ...PreludeSpend(faction, o.resource, o.action, suit, pips),
          faction,
          label: `${o.resource}: ${o.action}`,
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
      [...options, ...guild, ...lore, ...spoils, ...charm, arrange, EndPrelude(faction, suit, pips)],
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
      return `${name} — 3 ships in ${g.system}`
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
      const give = action['spend'] as Resource
      let next = paying(state, faction, give)
      const capacity = slotsOf(next, faction)
      const got = gain(next.resources, capacity, 'Relic', ResourceSlot.overflow(faction))
      next = { ...next, resources: got.tracker }
      return {
        state: spent(next, `traded ${give} for a Relic${got.gained ? '' : ' (no open slot)'}`),
        continue: back,
      }
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
      const next: GameState = {
        ...state,
        courtCards: move(state.courtCards, stolen, CourtPile.secured(faction)),
      }
      return {
        state: spent(next, `stole ${courtCard(stolen).name} from ${rival}`),
        continue: back,
      }
    }

    case 'farseers': {
      const held = contentsOf(state.cards, CardLocation.hand(faction))
      let cards = moveAll(state.cards, held, CardLocation.discard())
      let drawn = 0
      for (let i = 0; i < held.length; i++) {
        const top = contentsOf(cards, CardLocation.deck())[0]
        if (top === undefined) break
        cards = move(cards, top, CardLocation.hand(faction))
        drawn++
      }
      return {
        state: spent({ ...state, cards }, `redrew ${drawn} of ${held.length} card(s)`),
        continue: back,
      }
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
     * The Unions take a card out of a played pile. HRF holds it until end of round
     * (`discardAfterRound`); taking it straight to hand is equivalent here, because the
     * Prelude runs *after* you have played, so you cannot replay it this round either way.
     */
    case 'take-played': {
      const taken = action['taken'] as string
      const from = action['from'] as FactionId
      const next: GameState = {
        ...state,
        cards: move(state.cards, taken, CardLocation.hand(faction)),
      }
      return { state: spent(next, `took ${taken} from ${from}'s played cards`), continue: back }
    }

    case 'gates': {
      let next = state
      let placed = 0
      for (const s of state.board.systems) {
        if (!systemInfo(s).isGate) continue
        const ship = shipFromReserve(next, faction)
        if (ship === undefined) break
        next = { ...next, figures: move(next.figures, ship, Location.system(s)) }
        placed++
      }
      return { state: spent(next, `placed ${placed} ship(s), one at each gate`), continue: back }
    }

    case 'ships': {
      const system = action['system'] as SystemId
      let next = state
      let placed = 0
      for (let i = 0; i < 3; i++) {
        const ship = shipFromReserve(next, faction)
        if (ship === undefined) break
        next = { ...next, figures: move(next.figures, ship, Location.system(system)) }
        placed++
      }
      return { state: spent(next, `placed ${placed} ship(s) in ${system}`), continue: back }
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

  // The "before" entries, which reach an action this suit may not otherwise offer.
  if (tactical && !available.includes('Move') && canTake(state, faction, 'Move', then)) {
    options.push({
      ...TakeAction(faction, 'Move', MustFollow(faction, 'Battle', then)),
      faction,
      label: 'Move, then must Battle',
    })
  }
  if (charismatic && canTake(state, faction, 'Influence', then)) {
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

function performEndTurn(state: GameState, faction: FactionId): RuleResult {
  // Per-turn resets: cities become taxable and starports buildable again next turn.
  state = { ...state, taxedThisTurn: [], workedThisTurn: [], loreUsedThisTurn: [], anyBattle: false }
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

function performEndRound(state: GameState): RuleResult {
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
  return {
    state: {
      ...state,
      passed,
      initiativeOrder: order,
      lead: undefined,
      roundPlays: [],
      current: next,
      log: [...log, `initiative passes to ${next}`],
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
