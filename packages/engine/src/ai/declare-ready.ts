/**
 * Whether a faction is in a position to *declare* the ambition it wants.
 *
 * docs/19 section 4, step 3 — and the first of these steps that adds something the evaluator has no
 * proxy for at all. Steps 1 and 2 sharpened information the bot already had a coarse version of
 * (cities), and neither moved strength. Nothing anywhere in `featuresOf` knows what is in the hand,
 * whose turn it is to lead, or whether a marker is still free.
 *
 * ## What the rules actually require
 *
 * Three things must line up, and the bot can currently see none of them:
 *
 *   - **Only the lead player may declare** (`turn.ts` — `CheckDeclare` follows a lead and nothing
 *     else), so it takes initiative, not merely a good position.
 *   - **The card's strength picks the ambition.** A 2 declares Tycoon, a 5 Keeper, a 7 declares
 *     anything (`ambitionsForStrength`). Wanting Keeper with no 5 and no 7 in hand is wanting
 *     something unreachable this round.
 *   - **A marker must still be available** this chapter (`ambitionable`).
 *
 * This is what makes "is it worth winning initiative in order to declare?" answerable at all: the
 * question needs a term that is *high when the declaration is one lead away* and low otherwise.
 *
 * ## It reads the hand, and that is allowed here
 *
 * The anti-flap rule (section 2b) governs `intentFor`, which must not move across a faction's own
 * actions. This is a **value** feature, and a value that falls when you spend the card you were
 * going to declare with is not a flap — it is the truth. That is also why it lives here rather than
 * in feasibility.
 *
 * Rivals' hands are hidden, so this reads zero for everyone but `self`. That asymmetry is honest:
 * `ObservedState` hides what a player cannot see, and a bot that scored rivals' readiness would be
 * cheating in the way section 2k had to close for dice.
 */

import { AMBITION_STRENGTH } from '../rules/ambitions.js'
import { AMBITIONS } from '../state.js'
import { parseCardId } from '../cards.js'
import type { FactionId } from '../ids.js'
import type { ObservedState } from '../observe.js'
import type { Ambition } from '../state.js'
import type { ChapterIntent } from './intent.js'

/** Can this hand declare `ambition` — a card of its strength, or a 7, which declares any. */
function holdsCardFor(hand: readonly string[], ambition: Ambition): boolean {
  const needed = AMBITION_STRENGTH[ambition]
  return hand.some((id) => {
    const strength = parseCardId(id).strength
    return strength === needed || strength === 7
  })
}

/**
 * How ready this faction is to declare something it wants, in units the value function can use.
 *
 * The best single opportunity rather than a sum over all of them: declaring consumes the lead and
 * one marker, so holding a 2 *and* a 5 is not twice as good as holding one of them — it is the
 * better of the two chances.
 */
export function declareReadiness(
  observed: ObservedState,
  self: FactionId,
  intent: ChapterIntent,
): number {
  // Nothing to declare into: no marker left this chapter.
  const marker = Math.max(0, ...observed.ambitionable.map((m) => m.high))
  if (marker === 0) return 0
  if (observed.self !== self) return 0 // Rivals' hands are hidden; see the note above.

  /*
   * Only the lead player declares, so this is worth what the chance of leading is worth. Whoever
   * holds initiative leads next; once someone has led this round the chance has gone for now, but
   * not for the chapter, which is why it decays rather than zeroing.
   */
  const first = observed.initiativeOrder[0] === self
  const lead = observed.lead === undefined ? (first ? 1 : 0.4) : first ? 0.5 : 0.2

  let best = 0
  for (const ambition of AMBITIONS) {
    if (!holdsCardFor(observed.hand, ambition)) continue
    // Weighted by how much this faction wants it — a reachable declaration it does not want is worth little.
    best = Math.max(best, intent.pursuing.get(ambition) ?? 0)
  }
  return marker * lead * best
}
