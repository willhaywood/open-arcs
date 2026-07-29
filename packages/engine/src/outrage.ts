/**
 * Outrage — the cost of razing someone's city.
 *
 * Transcribed from haunt-roll-fail `arcs/game-common.scala:535-563` (`OutrageAction`) and
 * `arcs/game-battle.scala:568-672` (the trigger). Cross-checked against Quinnsicle/arcs_tts,
 * which confirms the physical model: five outrage slots on the player board, one per
 * resource, each covered by one of your **agents** (`tools/LayoutTools.lua`
 * `outrage_agent_layout`), and guild card text ("You ignore Outrage when spending Material
 * for its Prelude action") confirming what it blocks.
 *
 * Three things about this rule are easy to get backwards, so they are stated plainly:
 *
 * 1. **The attacker is outraged, not the city's owner.** In HRF the destroyed cities are
 *    collected into `outraged`, then `OutrageAction(f, r, ...)` is applied with `f` bound to
 *    the *battling* faction — the same `f` that takes the trophies and does the ransacking.
 *    Razing a world turns its guilds against you, not against the player you razed.
 * 2. **Provoking it discards what you already hold.** `OutrageAction` returns every token of
 *    that resource you hold to the supply. This is the part with teeth today, because it
 *    moves Tycoon scoring immediately.
 * 3. **Nothing clears it in the base game.** Every `ClearOutrageAction` call site in HRF is
 *    campaign: building a *Free* city or starport (`game-common.scala:971`, `:1005`),
 *    discarding a lore card (`:1950`), fates, and Blighted Reach setup. Outrage you provoke
 *    in a base game lasts the rest of it, which is what makes razing cities a real decision.
 *
 * The block on spending is live: the Prelude (docs/06 section 4) asks `canSpendForPrelude`
 * before offering a resource, so an outraged type buys nothing there. It can still be
 * discarded for the slot, and it still counts for the resource ambitions — outrage blocks
 * the Prelude action, not ownership.
 */

import { CourtPile, courtCard, securedCards } from './court.js'
import type { FactionId } from './ids.js'
import { GUILD_LOYALTY, hasLore } from './lore.js'
import { RESOURCES } from './resources.js'
import type { Resource } from './resources.js'
import { ResourceSlot, parseResourceToken } from './resources.js'
import { CITY_SLOT_COUNT } from './resources.js'
import type { GameState } from './state.js'
import { contentsOf, move } from './tracker.js'

/** Resource types `faction` is outraged at. */
export function outragedResources(state: GameState, faction: FactionId): readonly Resource[] {
  return state.outraged[faction] ?? []
}

export function isOutraged(state: GameState, faction: FactionId, r: Resource): boolean {
  return outragedResources(state, faction).includes(r)
}

/**
 * Whether `faction` may spend `r` for its Prelude action.
 *
 * Called by `preludeOffers` for every held resource, which is where outrage actually bites.
 * A Loyal guild of that suit overrides it — see `prelude.ts`.
 */
export function canSpendForPrelude(
  state: GameState,
  faction: FactionId,
  r: Resource,
): boolean {
  return !isOutraged(state, faction, r)
}

/**
 * Provoke outrage in `faction` for `r`: mark the type, and return every token of it the
 * faction holds to the supply (`game-common.scala:545-551`).
 *
 * Provoking an outrage you already have is not a no-op in HRF — it logs "outrage again" and
 * still discards. That only matters if you gained tokens of the type since, which the
 * discard then takes. Kept faithful.
 *
 * Tokens are swept from **all six slots**, not just the usable ones: destroying a city
 * raises cities-in-reserve and so *lowers* slot capacity, which can strand a token in a slot
 * that is no longer usable. Sweeping the full row means outrage cannot leave one behind.
 */
export function provokeOutrage(
  state: GameState,
  faction: FactionId,
  r: Resource,
): GameState {
  const held = outragedResources(state, faction)
  const already = held.includes(r)

  let resources = state.resources
  let discarded = 0
  for (let i = 0; i < CITY_SLOT_COUNT; i++) {
    for (const token of contentsOf(resources, ResourceSlot.citySlot(faction, i))) {
      if (parseResourceToken(token).resource !== r) continue
      resources = move(resources, token, ResourceSlot.supply(r))
      discarded++
    }
  }

  const log = [
    ...state.log,
    `${faction} provoked ${r} outrage${already ? ' again' : ''}` +
      (discarded > 0 ? `, discarding ${discarded} ${r}` : ''),
  ]

  /*
   * Outrage also costs you the **secured Guild cards of that suit** — the guilds of that trade
   * turn on you and leave (`OutrageAction`, game-common.scala:553). Two exemptions, both printed:
   *
   *   - a **Loyal** guild stays ("If you Provoke Outrage, keep this card"), which is the first
   *     clause on all five Loyal cards;
   *   - **Guild Loyalty** (lore29, one of the two fan-made cards) keeps all of them.
   *
   * Only guild cards go, and only of the outraged suit; Vox cards are already discarded on use.
   */
  let courtCards = state.courtCards
  const lost: string[] = []
  if (!hasLore(state, faction, GUILD_LOYALTY)) {
    for (const id of securedCards(state, faction)) {
      const card = courtCard(id)
      if (card.kind !== 'guild' || card.suit !== r || card.loyal === true) continue
      courtCards = move(courtCards, id, CourtPile.discard())
      lost.push(card.name)
    }
  }
  if (lost.length > 0) log.push(`${faction} lost ${lost.join(', ')} to the outrage`)

  return {
    ...state,
    resources,
    courtCards,
    outraged: already
      ? state.outraged
      : { ...state.outraged, [faction]: [...held, r] },
    log,
  }
}

/**
 * Clear outrage for the given types. No base-game rule reaches this — it is here because
 * the campaign's Free-city build and several fates do, and because a rule this asymmetric
 * is worth being able to state. Safe to leave unused.
 */
export function clearOutrage(
  state: GameState,
  faction: FactionId,
  types: readonly Resource[],
): GameState {
  const held = outragedResources(state, faction)
  const next = held.filter((r) => !types.includes(r))
  if (next.length === held.length) return state
  return {
    ...state,
    outraged: { ...state.outraged, [faction]: next },
    log: [...state.log, `${faction} cleared ${held.filter((r) => types.includes(r)).join(', ')} outrage`],
  }
}

/** Guard for board data, which types `resource` as a plain string. */
export function asResource(value: string | null): Resource | undefined {
  return value !== null && (RESOURCES as readonly string[]).includes(value)
    ? (value as Resource)
    : undefined
}
