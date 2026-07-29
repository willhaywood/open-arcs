/**
 * Lore cards — the *Leaders and Lore* variant's one-off abilities.
 *
 * Data only, like `leaders.ts`. Names and set membership are transcribed from haunt-roll-fail's
 * `arcs/game-lore.scala` and checked against the card art in `assets/images/lore`; the effects
 * are a later phase (docs/14).
 *
 * Unlike guild cards, lore is **held from the draft** rather than secured from the court, and
 * several cards are spent by discarding them. That is why they are their own deck here and not
 * an extension of `court.ts`.
 */

/**
 * Which box a card comes from.
 *
 * `unofficial` is HRF's own `UnofficialLore`: two fan-made cards printed in neither box. They
 * are a separate opt-in rather than part of `expansion`, so enabling the expansion never
 * silently deals a card that does not physically exist.
 */
import type { FactionId } from './ids.js'
import type { Resource } from './resources.js'

export type LoreSet = 'base' | 'expansion' | 'unofficial'

export interface LoreCard {
  readonly id: string
  readonly name: string
  readonly set: LoreSet
}

const lore = (id: string, name: string, set: LoreSet): LoreCard => ({ id, name, set })

/**
 * All 30 lore cards, in card order (`game-lore.scala`, `Lores.all`).
 *
 * The base/expansion boundary is by card number — the cards carry no printed set code, see
 * docs/14 section 1. Note that the ten ambition-paired cards (Empath's, Keeper's, Warlord's,
 * Tyrant's, Tycoon's, two each) all sit in the expansion range.
 */
export const LORE: readonly LoreCard[] = [
  // --- base game (01-14) ---
  lore('lore01', 'Tool Priests', 'base'),
  lore('lore02', 'Galactic Rifles', 'base'),
  lore('lore03', 'Sprinter Drives', 'base'),
  lore('lore04', 'Mirror Plating', 'base'),
  lore('lore05', 'Hidden Harbors', 'base'),
  lore('lore06', 'Signal Breaker', 'base'),
  lore('lore07', 'Repair Drones', 'base'),
  lore('lore08', 'Gate Ports', 'base'),
  lore('lore09', 'Cloud Cities', 'base'),
  lore('lore10', 'Living Structures', 'base'),
  lore('lore11', 'Gate Stations', 'base'),
  lore('lore12', 'Railgun Arrays', 'base'),
  lore('lore13', 'Ancient Holdings', 'base'),
  lore('lore14', 'Seeker Torpedoes', 'base'),

  // --- Leaders & Lore Pack (15-28) ---
  lore('lore15', 'Predictive Sensors', 'expansion'),
  lore('lore16', 'Force Beams', 'expansion'),
  lore('lore17', 'Raider Exosuits', 'expansion'),
  lore('lore18', 'Survival Overrides', 'expansion'),
  lore('lore19', "Empath's Vision", 'expansion'),
  lore('lore20', "Empath's Bond", 'expansion'),
  lore('lore21', "Keeper's Trust", 'expansion'),
  lore('lore22', "Keeper's Solidarity", 'expansion'),
  lore('lore23', "Warlord's Cruelty", 'expansion'),
  lore('lore24', "Warlord's Terror", 'expansion'),
  lore('lore25', "Tyrant's Ego", 'expansion'),
  lore('lore26', "Tyrant's Authority", 'expansion'),
  lore('lore27', "Tycoon's Ambition", 'expansion'),
  lore('lore28', "Tycoon's Charm", 'expansion'),

  // --- fan-made, in neither box ---
  lore('lore29', 'Guild Loyalty', 'unofficial'),
  lore('lore30', 'Catapult Overdrive', 'unofficial'),
]

const BY_ID = new Map(LORE.map((c) => [c.id, c]))

export function loreCard(id: string): LoreCard {
  const found = BY_ID.get(id)
  if (found === undefined) throw new Error(`unknown lore card: ${id}`)
  return found
}

/** The lore deck for a given pool: base always, expansion and unofficial when enabled. */
export function lorePool(expansion: boolean, unofficial = false): readonly LoreCard[] {
  return LORE.filter(
    (c) =>
      c.set === 'base' ||
      (c.set === 'expansion' && expansion) ||
      (c.set === 'unofficial' && unofficial),
  )
}

// --- draft sizing ----------------------------------------------------------

/**
 * How many lore each player drafts. One by default; the higher settings are HRF's `DoubleLore`
 * through `PentaLore`, which are mutually exclusive there and so are a single number here.
 */
export const MAX_LORE_PER_PLAYER = 5

/**
 * Cards the draft must deal: one more than the number of players, so the last to pick still has
 * a choice, plus the extras every player takes beyond their first
 * (`game-leaders.scala`, `LeadersLoresShuffledAction`).
 */
export function loreNeeded(players: number, perPlayer: number): number {
  return players + 1 + (perPlayer - 1) * players
}

/** Leaders the draft must deal — one more than the number of players, for the same reason. */
export function leadersNeeded(players: number): number {
  return players + 1
}

/**
 * The largest lore-per-player setting a pool can actually deal.
 *
 * Base-only supplies 14 lore, which cannot cover every setting: 3 players at x5 needs 16, and 4
 * players needs 17 at x4 and 21 at x5. Offering a combination that runs the deck dry would fail
 * at deal time, so the caller caps the choice instead — see docs/14 section 4.
 */
export function maxLorePerPlayer(players: number, poolSize: number): number {
  let best = 1
  for (let n = 1; n <= MAX_LORE_PER_PLAYER; n++) {
    if (loreNeeded(players, n) <= poolSize) best = n
  }
  return best
}

// --- cards the rules reach for by name -------------------------------------

/** Guild Loyalty (fan-made): your Guild cards survive an outrage of their suit. */
/*
 * The ten ambition-paired expansion lore (19-28). Every one is gated on **"While <Ambition> is
 * declared"**, which is what makes them a set rather than ten unrelated cards: the gate is one
 * helper, `loreActive`, and each card's own effect hangs off it.
 *
 * Five of them also print the same second half — "Prelude: You may discard this to clear your
 * <resource> Outrage" — which is the first thing in the game that clears outrage at all. See
 * `LORE_CLEARS_OUTRAGE`.
 */
export const EMPATHS_VISION = 'lore19'
export const EMPATHS_BOND = 'lore20'
export const KEEPERS_TRUST = 'lore21'
export const KEEPERS_SOLIDARITY = 'lore22'
export const WARLORDS_CRUELTY = 'lore23'
export const WARLORDS_TERROR = 'lore24'
export const TYRANTS_EGO = 'lore25'
export const TYRANTS_AUTHORITY = 'lore26'
export const TYCOONS_AMBITION = 'lore27'
export const TYCOONS_CHARM = 'lore28'

/** Which ambition each of the ten is gated on. */
export const LORE_AMBITION: Readonly<Record<string, string>> = {
  [EMPATHS_VISION]: 'Empath',
  [EMPATHS_BOND]: 'Empath',
  [KEEPERS_TRUST]: 'Keeper',
  [KEEPERS_SOLIDARITY]: 'Keeper',
  [WARLORDS_CRUELTY]: 'Warlord',
  [WARLORDS_TERROR]: 'Warlord',
  [TYRANTS_EGO]: 'Tyrant',
  [TYRANTS_AUTHORITY]: 'Tyrant',
  [TYCOONS_AMBITION]: 'Tycoon',
  [TYCOONS_CHARM]: 'Tycoon',
}

/**
 * "Prelude: You may discard this to clear your <resource> Outrage."
 *
 * Note this half is **not** gated on the ambition — the card says only "Prelude", where the other
 * half says "While X is declared". So a card whose ambition is undeclared is still worth holding
 * as a way out of an outrage.
 */
export const LORE_CLEARS_OUTRAGE: Readonly<Record<string, readonly Resource[]>> = {
  [EMPATHS_VISION]: ['Psionic'],
  [KEEPERS_TRUST]: ['Relic'],
  [WARLORDS_CRUELTY]: ['Weapon'],
  [TYRANTS_EGO]: ['Weapon'],
  [TYCOONS_CHARM]: ['Material', 'Fuel'],
}

export const GUILD_LOYALTY = 'lore29'
/** Tool Priests: once a turn, summon a ship at any city in a system you rule. */
export const TOOL_PRIESTS = 'lore01'
/** Galactic Rifles: a ranged strike into an adjacent system, on the Battle slot. */
export const GALACTIC_RIFLES = 'lore02'
/** Sprinter Drives: once a turn, move the fresh ships you just moved one more time. */
export const SPRINTER_DRIVES = 'lore03'
/** Living Structures: Nurture (Build) taxes a city; Prune (Repair) swaps city and starport. */
export const LIVING_STRUCTURES = 'lore10'
/** Mirror Plating: defending, adds an Intercept to an attacker who rolled assault dice. */
export const MIRROR_PLATING = 'lore04'
/** Hidden Harbors: defending, denies raid dice while a defending starport is fresh. */
export const HIDDEN_HARBORS = 'lore05'
/** Signal Breaker: attacking from an all-fresh fleet, ignores one Intercept rolled. */
export const SIGNAL_BREAKER = 'lore06'
/** Ancient Holdings: one extra resource slot, on the card, raided for four keys. */
export const ANCIENT_HOLDINGS = 'lore13'
/** Cloud Cities: build a city on a planet outside its slots, paying its resource type. */
export const CLOUD_CITIES = 'lore09'
/** Gate Ports: starports may be built on gates, one of yours per gate. */
export const GATE_PORTS = 'lore08'
/** Gate Stations: cities may be built on gates, one of yours per gate. */
export const GATE_STATIONS = 'lore11'
/** Seeker Torpedoes: reroll assault dice, one per fresh attacking ship. */
export const SEEKER_TORPEDOES = 'lore14'
/** Railgun Arrays: defending, the attacker takes a hit before collecting dice. */
export const RAILGUN_ARRAYS = 'lore12'
/** Repair Drones: repairs one attacking ship after a battle. */
export const REPAIR_DRONES = 'lore07'

/**
 * Does this faction hold `loreId`?
 *
 * The lore counterpart of `hasTrait`, and false for everyone when the variant is off, so base
 * rules can consult it without depending on the expansion. Typed structurally for the same
 * reason: `state.ts` imports this module, so importing `GameState` back would be a cycle.
 *
 * Lore is held from the draft, not secured from the court, which is why this reads `state.lores`
 * rather than going through `hasGuild`.
 */
/**
 * Does this faction hold `loreId` **and** is the ambition it is gated on declared?
 *
 * The one question all ten ambition-paired lore ask. Kept here so no card re-implements it and
 * none of them can drift on what "while X is declared" means: an ambition is declared once a
 * marker sits on it, whoever declared it — the card does not say "you declared it".
 */
export function loreActive(
  state: {
    readonly lores: Partial<Record<FactionId, readonly string[]>>
    readonly declared: readonly { readonly ambition: string }[]
  },
  faction: FactionId,
  loreId: string,
): boolean {
  if (!hasLore(state, faction, loreId)) return false
  const want = LORE_AMBITION[loreId]
  if (want === undefined) return true
  return state.declared.some((d) => d.ambition === want)
}

export function hasLore(
  state: { readonly lores: Partial<Record<FactionId, readonly string[]>> },
  faction: FactionId,
  loreId: string,
): boolean {
  return (state.lores[faction] ?? []).includes(loreId)
}
