/**
 * Which surface draws an Ask — one table, read by every component that needs the answer.
 *
 * ## Why this exists
 *
 * Three bugs have now had the same shape: **the engine produced a valid Ask and nothing on screen
 * would draw it.**
 *
 *   - Railgun Arrays assigned a hit before any dice existed. `ActionPanel` hid `battle/hit`
 *     believing the battle window owned it; the battle window required a roll before it would draw
 *     an assignment and there was none. The game could not be progressed.
 *   - The reroll offered its dice as text while the dice themselves were nowhere on screen.
 *   - Ancient Holdings' resource slot was returned by the engine and drawn by no surface.
 *
 * None of these can fail an engine test — the engine passes. They were split across two components
 * that did not know about each other: one hid action types it *believed* another owned, the other
 * decided independently whether to render. Ownership was expressed twice, in different terms, and
 * where the two disagreed the Ask fell through the gap.
 *
 * So ownership is stated **once**, here, as a total function. `surfaceFor` returns the surface that
 * draws a given Ask, or `undefined` — and `undefined` is the bug. `test/surfaces.test.ts` plays
 * games and asserts it never happens, which is the check none of the three bugs above could have
 * survived.
 *
 * ## The rule for adding to this
 *
 * A new action type must be claimed here, by the surface that draws it. Claiming it is not
 * optional: leaving it unclaimed fails the test, which is the point — an action nobody draws is an
 * unplayable game, and that should be loud at the moment it is introduced rather than the first
 * time someone reaches it in a real game.
 */

import type { Continue } from '@arcs/engine'

/** The surfaces that can draw an Ask. `panel` is the fallback list of labelled buttons. */
export type Surface =
  | 'panel'
  | 'hand'
  | 'draft'
  | 'learned'
  | 'prelude'
  | 'slots'
  | 'raid'
  | 'shelf'
  | 'battle'
  | 'tray'
  | 'map'
  | 'ambitions'

/**
 * Surfaces a player who is **not** acting may still watch.
 *
 * Whose turn it is has never been secret, and neither is most of what a turn looks like — the dice,
 * the board, the court. Watching someone play is the game. Two surfaces are different, and they are
 * listed here rather than anywhere else for the same reason ownership is: a rule about surfaces that
 * lives in two places is a rule that will disagree with itself.
 *
 *   - **`hand`** — rivals' hands are the one genuinely hidden zone in the base game (`observe.ts`).
 *   - **`learned`** — the Archivist's five come off the top of `state.unusedLore`, which `observe.ts`
 *     also lists as hidden. Drawing that screen for anyone else would reveal the three they discard,
 *     which is the trap in "a watcher should just see everything".
 *
 * `draft` looks like it belongs with them and does not: the deal goes into a shared pool that
 * everyone picks from in turn, so it is open information.
 */
const PRIVATE: readonly Surface[] = ['hand', 'learned']

/** Whether a surface may be drawn for someone who is not the one being asked. */
export function isPublicSurface(surface: Surface): boolean {
  return !PRIVATE.includes(surface)
}

/** Card plays live in the fanned hand at the bottom of the screen. */
const HAND = ['turn/lead', 'turn/surpass', 'turn/copy', 'turn/pivot']

/** The Leaders and Lore draft, and the Archivist's post-setup draw, each have their own screen. */
const DRAFT = ['leaders/take']
const LEARNED = ['leaders/learned']

/** The Prelude is a choice between resource tokens, so it gets the tokens. */
const PRELUDE = [
  'turn/prelude-spend',
  'turn/prelude-battle',
  'turn/prelude-discard',
  'turn/prelude-guild',
  'turn/prelude-arrange',
  'turn/prelude-done',
  'turn/prelude-lore',
  'turn/prelude-spoils',
  'turn/prelude-charm',
  'turn/prelude-tycoon',
]

/** The resource slots are a board you push tokens around on, not a list of moves. */
const SLOTS = ['resources/arrange-move', 'resources/arrange-discard', 'resources/arrange-done']

/** Raiding is a shelf of cards and resources with prices on them. */
const RAID = ['battle/raid-take', 'battle/settle']

/**
 * The court decisions that pick a **card**, drawn as a shelf of the cards themselves (docs/15 S1).
 *
 * All three carry the same `{ faction, slot, then }` payload, which is what makes one surface right
 * for them. Three decisions docs/15 grouped under S1 are deliberately *not* here, because they do
 * not share that shape: `leaders/beloved` carries no card (a yes/no, so S6),
 * `turn/bards-declare` picks an ambition rather than a card, and `leaders/generous-give` picks a
 * card *and* a recipient. See the header of `CardShelf.tsx`.
 *
 * `leaders/bold` stays in the panel because it is only the door — the picks it leads to are
 * ordinary `action/influence` actions, which this surface already claims.
 */
export const SHELF = ['action/influence', 'action/secure', 'action/ransack']

/**
 * The battle window owns the engagement from target through to the last hit.
 *
 * `battle/system` is **not** here: choosing which system to fight in is still a list of labelled
 * buttons until the map targets it, so the panel keeps it. `battle/cancel` is not here either — it
 * goes with whichever surface is up, so it is resolved by `ownerOf` rather than listed.
 */
const BATTLE = [
  'battle/target',
  'battle/roll',
  'battle/hit',
  'battle/finish',
  'battle/reroll',
  'battle/sensors',
  'battle/sensors-pull',
  'battle/sensors-done',
]

/**
 * Spatial choices answered by clicking the map.
 *
 * Move and Battle already worked this way. Galactic Rifles joins them — both of its steps name
 * systems — and so does Mass Uprising, whose first step names a **cluster**: a set of systems with
 * no drawn representation at all, which made "Rise up in cluster 3" the least answerable prompt in
 * the game. Every system in the cluster lights up instead.
 */
const MAP = ['rifles/target', 'rifles/roll', 'vox/uprising', 'vox/uprising-place']

/** The action phase, grouped by the card or pip each option comes from. */
/** Declaring an ambition is done to the ambition track, which draws the five rows. */
const AMBITIONS_SURFACE = ['vox/populist']

const TRAY = ['action/take', 'action/guild-alt']

/**
 * What the panel draws as a list of labelled buttons.
 *
 * A real surface with a real claim, not a catch-all. Most of these are genuinely a yes/no or a
 * short list where a label carries the whole decision (docs/15 S6). Being a list is *not* a licence
 * to leave a decision that needs a picture as text — the reroll lived here for months.
 */
const PANEL = [
  'battle/system',
  // `rifles/from` opens the flow and carries no choice; the two picks are on the map.
  'rifles/from',
  'action/build',
  'action/move-pick',
  'action/move-ships',
  'action/move-more',
  'action/tax-city',
  'action/repair',
  'action/guide-pick',
  'action/guide-move',
  'action/martyr',
  'action/abduct',
  'action/pressgang',
  'action/execute',
  'action/trade',
  'action/trade-give',
  'action/prune',
  'action/lore-sprint',
  'action/lore-sprint-stop',
  'action/arrange-open',
  'ambition/declare',
  'ambition/skip-declare',
  'turn/seize',
  'turn/skip-seize',
  /*
   * The two-player mulligan (rulebook p19), a genuine yes/no — docs/15 S6.
   *
   * Unclaimed until a real 2-player game reached it, because every config in `surfaces.test.ts` was
   * three or four players and this offer exists only at two. The invariant is only as wide as the
   * games the sweep plays, so a 2-player config is added there alongside this.
   */
  'turn/mulligan',
  'turn/keep-hand',
  'turn/bards-declare',
  /*
   * The Farseers flows (docs/20 A3): the discard picker and the declare-time peek. Lists of
   * labelled options, which is exactly what the action panel renders; the peek's swap options
   * carry the rival's card names in their labels, so the panel is the "look".
   */
  'turn/farseers-pick',
  'turn/farseers-done',
  'ambition/farseers-look',
  'ambition/farseers-take',
  'ambition/farseers-give',
  'ambition/farseers-skip',
  'turn/prelude',
  'turn/pips',
  'turn/lead-main',
  'action/lore-prune',
  'action/move-more-go',
  // Two leader prompts that are genuinely a yes/no — docs/15 S6 wants a confirm strip for these.
  'leaders/mythic-place',
  'leaders/ruthless-hit',
  'leaders/beloved',
  'leaders/bold',
  'leaders/generous-give',
  'leaders/may-follow',
  'leaders/must-follow',
  /*
   * The Vox cards. Every one of these was unclaimed until the sweep named it, and several want a
   * real surface rather than a list — Mass Uprising picks a *cluster*, which nothing on the map
   * highlights, and Populist Demands picks an ambition marker (docs/15 S2, S3).
   */
  'vox/choose',
  'vox/done',
  'vox/free-city',
  'vox/free-seize',
  'vox/outrage',
  'vox/steal-guild',
]

const TABLE: readonly (readonly [Surface, readonly string[]])[] = [
  ['hand', HAND],
  ['draft', DRAFT],
  ['learned', LEARNED],
  ['prelude', PRELUDE],
  ['slots', SLOTS],
  ['raid', RAID],
  ['shelf', SHELF],
  ['battle', BATTLE],
  ['map', MAP],
  ['ambitions', AMBITIONS_SURFACE],
  ['tray', TRAY],
  ['panel', PANEL],
]

/** Ways out of a menu. They belong to whoever drew the menu, so they never decide ownership. */
const ESCAPES = ['action/skip', 'action/cancel', 'battle/cancel', 'turn/end', 'turn/pass']

/**
 * The surface that draws this Ask, or `undefined` if none would.
 *
 * Ownership is decided by the Ask's **non-escape** actions, because an escape tells you nothing:
 * `battle/cancel` appears beside the dice gather and beside the system choice, which different
 * surfaces draw. An Ask offering nothing but escapes is owned by the panel, which is the only
 * surface that can render a bare "cancel" meaningfully.
 *
 * `turn/end` counts as an escape, so a menu of nothing but "End turn" belongs to the panel rather
 * than leaving the tray to draw an empty grid.
 */
export function surfaceFor(cont: Continue): Surface | undefined {
  if (cont.kind !== 'ask') return undefined

  const substantive = cont.actions.filter((a) => !ESCAPES.includes(a.type))
  if (substantive.length === 0) return 'panel'

  /*
   * First claim wins, in table order, and the order is not arbitrary: an Ask can mix types, and the
   * more specific surface has to win. The action phase offers `action/take` alongside `turn/end`;
   * the Prelude offers resource spends alongside `turn/prelude-done`. Ties are broken by putting
   * the screen-owning surfaces before the tray.
   */
  for (const [surface, types] of TABLE) {
    if (substantive.some((a) => types.includes(a.type))) return surface
  }

  /*
   * Unclaimed — and that is reported, not absorbed.
   *
   * An earlier cut ended `return 'panel'` here, on the reasoning that the panel can render any
   * action as a labelled button. True, and it made the invariant worthless: `surfaceFor` could never
   * return undefined, so the test asserting "every Ask has an owner" passed no matter what. A check
   * that cannot fail is worse than no check, because it reads as coverage.
   *
   * So the panel claims a list like every other surface, and anything outside every list comes back
   * undefined. The app still draws those — `ActionPanel` renders unclaimed Asks so a missing entry
   * is never an unplayable game — but the test fails, which is where the cost belongs.
   */
  return undefined
}

/**
 * Does `surface` draw this Ask?
 *
 * The form components should use, so a component never re-derives ownership in its own terms —
 * that divergence is what this module exists to prevent.
 */
export function owns(surface: Surface, cont: Continue): boolean {
  return surfaceFor(cont) === surface
}
