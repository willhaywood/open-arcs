/**
 * Build save files parked on a card interaction, ready to load and poke at by hand.
 *
 * Why this exists: every bug found in the lore cards so far has been an *interaction* the unit
 * tests could not see — a valid engine Ask that no UI surface would draw (Railgun Arrays), or a
 * decision rendered without the thing it was about (the rerolls). Both needed a human looking at
 * a real game. What made that slow was reaching the position; this removes that cost.
 *
 * A save is `{ version, options, journal }` and nothing else (docs/11), so a scenario cannot be
 * hand-assembled from a desired board — it has to be *played into*. Each scenario therefore names
 * the cards it needs and a predicate for the moment it wants, and the runner plays real games,
 * sweeping seeds, until an Ask satisfies the predicate. Everything written here is a position the
 * rules can actually reach, which is the whole point: a fabricated state could not be trusted.
 *
 *   npm run saves:build             # everything
 *   npm run saves:build -- lore14   # by card id, whatever the file happens to be called
 *   npm run saves:build -- reroll   # by batch name or file slug
 *
 * Output is `saves/lore/<id>-<card name>--<what it tests>.json` plus a regenerated
 * `saves/lore/README.md` index. Deterministic: the same scenario finds the same seed and writes the
 * same journal every time, so re-running is safe and the diff is empty unless behaviour changed.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  LORE,
  applyExternal,
  defaultRegistry,
  leaderCard,
  loreCard,
  serializeGame,
  startGame,
} from '@arcs/engine'
import type { Action, Continue, GameState, NewGameOptions, RuleResult } from '@arcs/engine'

const registry = defaultRegistry()
const OUT = join(import.meta.dirname, '..', 'saves', 'lore')

type Ask = Extract<Continue, { kind: 'ask' }>

interface Scenario {
  /**
   * What this save tests, as the tail of the file name — see `fileOf` for the whole shape. Reads
   * as English after the card name: `lore04-mirror-plating--vs-signal-breaker`.
   */
  readonly slug: string
  readonly batch: string
  /** Human name of the interaction under test. */
  readonly title: string
  /**
   * Cards the scenario needs drafted, **primary first** — the primary is what the save is named
   * and filed under, and what the coverage table counts it against.
   */
  readonly cards: readonly string[]
  /**
   * Where the cards must land.
   *
   * `one` — a single faction holds them all. Right when the interaction is between two of *your*
   * own cards (two defender interrupts, two reroll sources, a move alt and a move modifier).
   *
   * `split` — different factions. Right when the cards face each other across a battle: Hidden
   * Harbors defends and Raider Exosuits attacks, so putting both on one player tests nothing.
   *
   * Getting this wrong is silent — the save builds and looks fine while exercising nothing, which
   * is why it is explicit per scenario rather than inferred.
   */
  readonly hold?: 'one' | 'split'
  /** Why this pairing is worth a human's time. */
  readonly why: string
  /**
   * The single next action to take on loading — an instruction, not an observation.
   *
   * Separate from `steps` because a list that opens with "the window should show X" leaves you
   * reading rather than doing. The save resumes mid-decision, so the one thing worth stating first
   * is which button to press.
   */
  readonly first: string
  /** What to check afterwards, in order. */
  readonly steps: readonly string[]
  /** The moment to stop and save. */
  readonly stopAt: (state: GameState, ask: Ask) => boolean
  /** Nudge play toward the interaction. Return an action from `ask.actions`, or undefined. */
  readonly steer?: (state: GameState, ask: Ask) => Action | undefined
  readonly players?: number
  readonly lorePerPlayer?: number
  /** Seeds to sweep. Raise it for scenarios needing several things to coincide. */
  readonly seeds?: number
}

// --- predicate helpers -----------------------------------------------------

const types = (a: Ask): Set<string> => new Set(a.actions.map((x) => x.type))
const has = (a: Ask, t: string): boolean => a.actions.some((x) => x.type === t)
const ctxOf = (a: Ask): Record<string, unknown> | undefined =>
  a.actions.find((x) => x['ctx'] !== undefined)?.['ctx'] as Record<string, unknown> | undefined
const find = (a: Ask, t: string): Action | undefined => a.actions.find((x) => x.type === t)
const labelled = (a: Ask, re: RegExp): Action | undefined =>
  a.actions.find((x) => re.test(String(x['label'] ?? '')))

/**
 * A reroll ask, from the named source, with `used` telling how many sources are already spent.
 *
 * The source matters: several cards reroll, and whichever asks first wins. Keyed on `source` so a
 * scenario cannot claim Seeker Torpedoes and hand over an Empath's Vision prompt — a save that
 * misdescribes itself is worse than a missing one, because it gets believed.
 */
const rerollBy = (a: Ask, source: RegExp, spent = 0): boolean =>
  a.actions.some(
    (x) =>
      x.type === 'battle/reroll' &&
      source.test(String(x['source'] ?? '')) &&
      ((x['used'] as readonly string[] | undefined)?.length ?? 0) >= spent + 1,
  )

/**
 * Steering that reaches a battle and stays in it, **rolling assault-heavy pools**.
 *
 * The dice choice is not incidental. Seeker Torpedoes rerolls assault dice and Mirror Plating and
 * Signal Breaker only matter once an intercept can be rolled, so a picker that grabs the first
 * offered pool — `1S 0A 0R` — never triggers any of them. Left on the default fallback, three
 * scenarios here simply never occurred.
 */
const towardBattle = (_s: GameState, a: Ask): Action | undefined => {
  const assault = a.actions
    .filter((x) => x.type === 'battle/roll')
    .sort((x, y) => Number(y['assault']) - Number(x['assault']))[0]
  return (
    find(a, 'battle/target') ??
    find(a, 'battle/system') ??
    a.actions.find((x) => x.type === 'action/take' && x['action'] === 'Battle') ??
    assault ??
    undefined
  )
}

/** Steering toward a Move, for the Move-alt cards. */
const towardMove = (_s: GameState, a: Ask): Action | undefined =>
  a.actions.find((x) => x.type === 'action/take' && x['action'] === 'Move') ?? undefined

// --- the scenarios ---------------------------------------------------------

const SCENARIOS: readonly Scenario[] = [
  // ---------------------------------------------------------------- battle
  {
    slug: 'volley',
    first: 'Click one of your own ships to take the railgun hit, then Confirm.',
    batch: 'Battle interrupts',
    title: 'Railgun Arrays — the hit before the dice',
    cards: ['lore12'],
    why:
      'The only hit assignment in the game with no dice on the table. It deadlocked the UI once ' +
      'already: the window would not draw an assignment without a roll, and the panel hides ' +
      'battle/hit because the window owns it.',
    steps: [
      'There should be NO dice tray, and a line naming Railgun Arrays as the reason.',
      'Assign the hit, confirm, and check it hands off to the dice gather.',
      'Undo back out and confirm it does not strand you.',
    ],
    stopAt: (s, a) => ctxOf(a)?.['railgun'] === true && s.lastRoll === undefined,
    steer: towardBattle,
  },
  {
    slug: 'then-railgun-arrays',
    first: 'You are the defender: pick a neighbouring system and bring ships into the battle.',
    batch: 'Battle interrupts',
    title: 'Predictive Sensors then Railgun Arrays — two defender interrupts, one battle',
    cards: ['lore15', 'lore12'],
    why:
      'Both fire for the defender before the attacker collects dice, and the order matters: ' +
      'ships pulled in by Sensors should be standing there for the Railgun volley. Two ' +
      'interrupts in sequence is also the case most likely to strand the flow.',
    steps: [
      'The ask belongs to the DEFENDER, not the attacker whose turn it is.',
      'Bring ships in, then confirm the Railgun volley fires after that, not before.',
      'Decline instead (bring in no ships) and check the volley still fires.',
      'Watch for the turn passing to the wrong player between the two.',
    ],
    stopAt: (_s, a) => has(a, 'battle/sensors-pull'),
    steer: towardBattle,
    lorePerPlayer: 3,
  },
  {
    slug: 'with-empaths-vision',
    first: 'Click assault dice to reroll them, then Reroll — a second source should ask next.',
    batch: 'Rerolls',
    title: 'Seeker Torpedoes + Empath’s Vision — two reroll sources in one roll',
    cards: ['lore14', 'lore19'],
    why:
      'offerReroll recurses through sources carrying a `used` list. One source is the tested ' +
      'path; two in a single roll is where an exhausted source could be re-offered, or the ' +
      'second silently skipped. Empath’s Vision also needs Empath declared, so its gate is live.',
    steps: [
      'Reroll from the first source and check you are then asked again by the SECOND source.',
      'The dice shown the second time must be the NEW faces, not the originals.',
      'Decline the first and confirm the second is still offered.',
      'Empath’s Vision takes any dice; Seeker Torpedoes only assault. Check the locked dice differ.',
    ],
    // `used` carrying two entries means one source is spent and another is asking — the only
    // way to prove from a single Ask that two really are in play.
    stopAt: (_s, a) => rerollBy(a, /./, 1),
    /*
     * Empath's Vision is gated on Empath being declared, so this needs three things to coincide:
     * one faction holding both cards, Empath out, and that faction attacking with assault dice.
     * Declaring Empath is the rare one, so it is steered explicitly rather than waited for.
     */
    steer: (st, a) =>
      a.actions.find((x) => x.type === 'ambition/declare' && x['ambition'] === 'Empath') ??
      towardBattle(st, a),
    lorePerPlayer: 3,
    seeds: 1500,
  },
  {
    slug: 'reroll-tray',
    first: 'Click an assault die and press Reroll.',
    batch: 'Rerolls',
    title: 'Seeker Torpedoes — the plain reroll',
    cards: ['lore14'],
    why: 'The baseline for the reroll tray: one source, assault dice only, skirmish dice locked.',
    steps: [
      'The rolled dice should be visible and clickable.',
      'Skirmish dice should be locked and greyed; assault dice selectable.',
      'Selecting none should read "Keep these dice" rather than looking like a dead end.',
      'Reroll and confirm the new faces are shown before hits are assigned.',
    ],
    stopAt: (_s, a) => rerollBy(a, /Seeker/),
    steer: towardBattle,
  },
  {
    slug: 'vs-raider-exosuits',
    first: 'Read the raid column, then set a pool with 1 raid die and Roll.',
    batch: 'Battle dice',
    title: 'Hidden Harbors + Raider Exosuits — both rewrite the raid-dice limit',
    cards: ['lore05', 'lore17'],
    why:
      'One opens the no-buildings case to a single raid die, the other shuts raid dice off while ' +
      'a defending starport is fresh. They should never both apply — a starport is a building — ' +
      'so this is the check that the two conditions really are exclusive in play.',
    steps: [
      'Open a battle and read the raid column in the gather.',
      'Against no buildings, the Exosuits holder should be offered exactly 1 raid die.',
      'Against a fresh defending starport, raid dice should be 0 regardless.',
      'Against a damaged starport, the ordinary 6 should be back.',
    ],
    stopAt: (_s, a) => has(a, 'battle/roll'),
    steer: towardBattle,
    lorePerPlayer: 3,
    hold: 'split',
  },
  {
    slug: 'vs-signal-breaker',
    first: 'Set an assault-heavy pool and Roll, then read the Intercepted note.',
    batch: 'Battle dice',
    title: 'Mirror Plating + Signal Breaker — the intercept that cancels itself',
    cards: ['lore04', 'lore06'],
    why:
      'These are computed as one number, clamped at zero. Held against each other they should ' +
      'cancel exactly. The interesting case is one on each side of the same battle.',
    steps: [
      'With both cards in the battle the intercept should come out at zero, not negative.',
      'Check the self-hit count matches what the note claims.',
    ],
    /*
     * Parked on the dice gather rather than on a live intercept: an intercept needs an assault
     * die to come up on the intercept face, which the sweep cannot force without choosing the
     * roll for you. You pick the pool — assault-heavy — and watch what the tally says.
     */
    stopAt: (_s, a) => has(a, 'battle/roll') && a.actions.some((x) => Number(x['assault']) >= 2),
    steer: towardBattle,
    lorePerPlayer: 3,
    hold: 'split',
  },
  // ---------------------------------------------------------------- movement
  {
    slug: 'guide-mixed-group',
    first: 'Take the Guide option, pick a lane, move some of one colour — then look for the second ask.',
    batch: 'Move alts',
    title: 'Force Beams — Guide a mixed group',
    cards: ['lore16'],
    why:
      'One Guide may carry your ships and a rival’s together; it used to end after one colour. ' +
      'It must also ignore the Gate Ports toll and refuse to start a catapult.',
    steps: [
      'You should be asked AGAIN on the same lane — take a different colour.',
      'Guide into a gate a rival holds with a fresh starport: no agent should be captured.',
      'Guide into a gate and confirm no "and further" catapult continuation is offered.',
    ],
    stopAt: (_s, a) => labelled(a, /^Guide /) !== undefined,
    steer: towardMove,
  },
  {
    slug: 'vs-sprinter-drives',
    first: 'Move ships normally first and note the sprint offer; then Guide the same ships.',
    batch: 'Move alts',
    title: 'Force Beams + Sprinter Drives — a move modifier that must not fire',
    cards: ['lore16', 'lore03'],
    why:
      'Sprinter Drives hangs off moving fresh Loyal ships. Guide is not a move, so no sprint leg ' +
      'should follow it — but a plain Move of the same ships SHOULD offer one. Both in one game ' +
      'is the only way to see the difference by eye.',
    steps: [
      'Move ships normally and confirm the Sprinter Drives leg is offered.',
      'Now Guide the same ships along a lane: no sprint leg should appear.',
      'Check the log distinguishes "guided" from "moved".',
    ],
    stopAt: (_s, a) => labelled(a, /^Guide /) !== undefined,
    steer: towardMove,
    lorePerPlayer: 3,
  },
  {
    slug: 'martyr',
    first: 'Take the Martyr option and note your trophy count before you confirm.',
    batch: 'Move alts',
    title: 'Survival Overrides — Martyr’s asymmetric disposal',
    cards: ['lore18'],
    why:
      'Two ships leave the board to different places: yours home to reserve, theirs to your ' +
      'trophy pile. Getting that backwards is invisible until someone counts trophies.',
    steps: [
      'Compare your trophy count before and after.',
      'Your ship must NOT become a trophy; theirs must.',
      'Try it on a damaged rival ship: it should be destroyed outright, not repaired.',
      'Check your ship comes back into reserve and can be rebuilt.',
    ],
    stopAt: (_s, a) => labelled(a, /^Martyr /) !== undefined,
    steer: towardMove,
  },
  // ---------------------------------------------------------------- building
  {
    slug: 'annex',
    first: 'Take Build, then the Annex option on a rival building.',
    batch: 'Build alts',
    title: 'Tyrant’s Authority — Annex, and the slot it frees',
    cards: ['lore26'],
    why:
      'Annex replaces a rival building in place, so the replaced piece must leave before yours ' +
      'lands — no free slot is needed. A returned city also re-covers a resource slot on its ' +
      'owner’s board, which can shrink their capacity and strand a token.',
    steps: [
      'Their city should return to THEIR player board, not the box.',
      'Watch their resource slots: a returned city can shrink capacity.',
      'Annex a starport and confirm you get a starport, not a city.',
    ],
    stopAt: (_s, a) => labelled(a, /^Annex /) !== undefined,
    steer: (_s, a) =>
      a.actions.find((x) => x.type === 'action/take' && x['action'] === 'Build') ??
      find(a, 'ambition/declare'),
  },
  {
    slug: 'with-gate-stations',
    first: 'Take Build and look for a gate in the target list.',
    batch: 'Build alts',
    title: 'Gate Ports + Gate Stations — two cards building on gates',
    cards: ['lore08', 'lore11'],
    why:
      'Both open gates as build sites with a "max 1 per gate" limit, and docs/14 records a known ' +
      'divergence: our per-faction test is stricter than the ruling. Holding both is where that ' +
      'wrongly blocks a legal build.',
    steps: [
      'Build a city on a gate (Gate Stations), then try a starport on the same gate (Gate Ports).',
      'The ruling allows it; we may wrongly refuse. Note which happens.',
      'Check the gate city takes its cluster’s resource types.',
    ],
    stopAt: (_s, a) => labelled(a, /Gate/) !== undefined && has(a, 'action/build'),
    steer: (_s, a) => a.actions.find((x) => x.type === 'action/take' && x['action'] === 'Build'),
    lorePerPlayer: 3,
  },
  // ---------------------------------------------------------------- prelude
  {
    slug: 'outrage-clear',
    first:
      'The Prelude tray is already open and the outrage already provoked — take the ' +
      'discard-to-clear option.',
    batch: 'Prelude',
    title: 'The outrage-clearing discards — ungated by ambition',
    cards: ['lore23'],
    why:
      'Five ambition-paired cards print a Prelude discard that clears your outrage, and that ' +
      'half is deliberately NOT gated on the ambition. Easy to over-gate by accident.',
    steps: [
      'The discard should be offered whether or not the ambition is declared.',
      'Confirm it clears the right resource and the card leaves play.',
      'With no outrage, it should not be offered at all.',
    ],
    stopAt: (_s, a) => has(a, 'turn/prelude-lore'),
    steer: (_s, a) => find(a, 'turn/prelude') ?? towardBattle(_s, a),
  },
  {
    slug: 'declare-without-zeroing',
    first:
      "The Prelude tray is already open, Tycoon is declared and the resources are held — take " +
      "the Tycoon's Ambition option.",
    batch: 'Prelude',
    title: 'Tycoon’s Ambition — a declaration that does not zero the card',
    cards: ['lore27'],
    why:
      'Takes an ambition marker while leaving the played card at its printed strength. If the ' +
      'card gets zeroed anyway, surpass maths goes wrong later in the round and nothing near ' +
      'the card will point at it.',
    steps: [
      'Use the Ambition option and check ALL Material and Fuel are discarded.',
      'The played card must keep its strength — check the lead card in the play area.',
      'Confirm a rival can still surpass it as if it were unzeroed.',
    ],
    stopAt: (_s, a) => has(a, 'turn/prelude-tycoon'),
    steer: (_s, a) => find(a, 'ambition/declare') ?? find(a, 'turn/prelude'),
    lorePerPlayer: 3,
  },
  // ---------------------------------------------------------------- ambition gate
  {
    slug: 'tax-build-catapult',
    first: "Take Tax and look for a rival's city in the list.",
    batch: 'Ambition-gated',
    title: 'Empath’s Bond — tax, build and catapult all rewritten at once',
    cards: ['lore20'],
    why:
      'The most invasive card in the set: it changes three different action offers, and its ' +
      'build clause makes ships arrive damaged in rival-controlled systems. Three surfaces, one ' +
      'gate — a good candidate for one of them being missed.',
    steps: [
      'With Empath declared, tax a RIVAL city: it should work and take NO captive.',
      'Build a ship at a rival starport; in a rival-ruled system it should arrive damaged.',
      'Catapult out of a rival starport.',
      'Undeclare (next chapter) and confirm all three revert.',
    ],
    stopAt: (s, a) =>
      // Empath actually declared, or the card is inert and the save proves nothing.
      s.declared.some((d) => d.ambition === 'Empath') &&
      a.actions.some(
        (x) => x.type === 'action/tax-city' || (x.type === 'action/build' && x['starport'] !== undefined),
      ),
    steer: (_s, a) =>
      a.actions.find((x) => x.type === 'ambition/declare' && x['ambition'] === 'Empath') ??
      a.actions.find((x) => x.type === 'action/take' && (x['action'] === 'Tax' || x['action'] === 'Build')),
  },
]

/** The printed name of a lore or leader card. */
const nameOf = (id: string): string =>
  id.startsWith('leader') ? leaderCard(id).name : loreCard(id).name

/** "Empath's Vision" -> "empaths-vision". */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * `lore12-railgun-arrays--volley` — id, printed name, then what the scenario is about.
 *
 * The id leads so the directory sorts into card order; the **name** is there because an id alone
 * is unreadable. `lore23-outrage-clear` tells you nothing unless you happen to know lore23 is
 * Warlord's Cruelty, and a directory you have to decode is a directory you do not use.
 *
 * Only the primary card is named. A pair would run to eighty characters otherwise, so the second
 * card goes in the scenario part where it reads as English (`--vs-signal-breaker`), and both cards
 * always appear in the coverage table — which is what you actually search.
 */
const fileOf = (sc: Scenario): string =>
  `${sc.cards[0]}-${slugify(nameOf(sc.cards[0]!))}--${sc.slug}`

// --- the runner ------------------------------------------------------------

/** Everything a scenario asks to be drafted, still missing from every faction. */
function stillWanted(state: GameState, cards: readonly string[]): string[] {
  const held = new Set<string>([
    ...Object.values(state.lores).flatMap((l) => [...(l ?? [])]),
    ...Object.values(state.leaders).flatMap((l) => (l === undefined ? [] : [l])),
  ])
  return cards.filter((c) => !held.has(c))
}

/**
 * The draft pick that serves the scenario.
 *
 * The draft is a shared pool picked round-robin, so *which seat* takes a wanted card is decided
 * here and nowhere else. Under `one` the first seat offered a wanted card becomes the holder and
 * every other seat then avoids them, so they survive the round-robin to reach it. Under `split`
 * each seat may take at most one, which is what puts two cards on opposite sides of a battle.
 */
function draftPick(
  state: GameState,
  ask: Ask,
  want: readonly string[],
  hold: 'one' | 'split',
  holders: Map<string, number>,
): Action {
  const missing = stillWanted(state, want)
  const offered = ask.actions.filter((x) => missing.includes(String(x['card'])))
  const mineAlready = holders.get(ask.faction) ?? 0
  const chosen = [...holders.keys()]

  const mayTake =
    offered.length > 0 &&
    (hold === 'one'
      ? chosen.length === 0 || chosen.includes(ask.faction)
      : mineAlready === 0)

  if (mayTake) {
    holders.set(ask.faction, mineAlready + 1)
    return offered[0]!
  }
  // Not this seat's card: take anything else so the wanted ones stay in the pool.
  const neutral = ask.actions.filter((x) => !want.includes(String(x['card'])))
  return (neutral[0] ?? ask.actions[0])!
}

/** Which faction holds each of the scenario's cards, read back off the finished state. */
function holdingOf(state: GameState, cards: readonly string[]): string {
  const where = (id: string): string => {
    for (const [f, l] of Object.entries(state.lores)) if ((l ?? []).includes(id)) return f
    for (const [f, l] of Object.entries(state.leaders)) if (l === id) return f
    return 'nobody'
  }
  return cards.map((c) => `${c}=${where(c)}`).join(', ')
}

interface Hit {
  readonly seed: number
  readonly journal: number
  readonly faction: string
  readonly prompt: string
  readonly json: string
  /** Who ended up holding what — checked, not assumed. */
  readonly holding: string
}

function hunt(sc: Scenario, seeds: number): Hit | { misses: string } {
  const players = sc.players ?? 3
  const factions = ['red', 'yellow', 'blue', 'white'].slice(0, players)
  let closest = 'never drafted the cards'

  for (let seed = 1; seed <= seeds; seed++) {
    const options: NewGameOptions = {
      board: players === 3 ? 'Board3MixUp' : 'Board4Standard',
      factions: factions as NewGameOptions['factions'],
      seed,
      leadersAndLore: { expansion: true, lorePerPlayer: sc.lorePerPlayer ?? 2 },
    }
    let r: RuleResult
    try {
      r = startGame(options, registry)
    } catch {
      continue
    }
    let drafted = false
    const holders = new Map<string, number>()

    for (let step = 0; step < 3000; step++) {
      if (r.continue.kind !== 'ask') break
      const ask = r.continue

      if (drafted && sc.stopAt(r.state, ask)) {
        return {
          seed,
          journal: r.state.journal.length,
          faction: ask.faction,
          prompt: ask.prompt ?? '',
          json: serializeGame(options, r),
          holding: holdingOf(r.state, sc.cards),
        }
      }

      let pick: Action | undefined
      if (types(ask).size === 1 && has(ask, 'leaders/take')) {
        pick = draftPick(r.state, ask, sc.cards, sc.hold ?? 'one', holders)
      } else {
        if (!drafted) {
          if (stillWanted(r.state, sc.cards).length > 0) break // this seed never dealt them
          drafted = true
          closest = 'drafted the cards but never reached the moment'
        }
        pick = sc.steer?.(r.state, ask)
        // Never steer into a dead end: a cancel or skip would undo the approach.
        if (pick === undefined || /cancel|skip/.test(pick.type)) {
          pick =
            ask.actions.find((x) => !/cancel|skip|pass/.test(x.type)) ?? ask.actions[0]
        }
      }
      if (pick === undefined) break
      try {
        r = applyExternal(r, pick, registry)
      } catch {
        break
      }
    }
  }
  return { misses: closest }
}

// --- main ------------------------------------------------------------------

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const wanted = SCENARIOS.filter(
  (s) =>
    filter.length === 0 ||
    filter.some(
      (f) =>
        fileOf(s).includes(f) ||
        s.cards.includes(f) ||
        s.batch.toLowerCase().includes(f.toLowerCase()),
    ),
)

mkdirSync(OUT, { recursive: true })

/*
 * A full build owns the directory: stale saves are deleted first.
 *
 * Renaming a scenario would otherwise leave an orphan behind, and an orphan is not harmless — the
 * replay test keeps validating it, so `npm test` stays green while the index no longer mentions it
 * and nobody knows what it is for.
 *
 * **Only on a full build.** A filtered run rebuilds a subset and must leave the rest alone, or
 * `saves:build -- reroll` would quietly delete twelve other scenarios.
 */
if (filter.length === 0) {
  const keep = new Set(wanted.map((s) => `${fileOf(s)}.json`))
  for (const name of readdirSync(OUT)) {
    if (!name.endsWith('.json') || keep.has(name)) continue
    rmSync(join(OUT, name))
    process.stdout.write(`  prune ${name}\n`)
  }
}

const built: { sc: Scenario; hit: Hit }[] = []
const failed: { sc: Scenario; why: string }[] = []

for (const sc of wanted) {
  const res = hunt(sc, sc.seeds ?? 300)
  if ('misses' in res) {
    failed.push({ sc, why: res.misses })
    process.stdout.write(`  MISS  ${fileOf(sc)} — ${res.misses}\n`)
    continue
  }
  writeFileSync(join(OUT, `${fileOf(sc)}.json`), res.json)
  built.push({ sc, hit: res })
  process.stdout.write(
    `  ok    ${fileOf(sc)}  seed=${res.seed} journal=${res.journal} → ${res.faction}\n`,
  )
}

// --- the index the human actually reads ------------------------------------

const byBatch = new Map<string, { sc: Scenario; hit: Hit }[]>()
for (const b of built) {
  const list = byBatch.get(b.sc.batch) ?? []
  list.push(b)
  byBatch.set(b.sc.batch, list)
}

const lines: string[] = [
  '# Lore interaction test saves',
  '',
  '**Generated — do not edit.** Rebuild with `npm run saves:build`.',
  '',
  'Each file is a real game played into the moment the interaction becomes testable, so every',
  'position here is one the rules can actually reach. Load one with **Load** on the start screen',
  '(or the Load button in the top bar), and the game resumes on the decision described.',
  '',
  'These exist because every lore bug found so far has been an interaction the unit tests could',
  'not see — a valid Ask no UI would draw, or a decision shown without the thing it was about.',
  'Those need eyes. What they do not need is twenty minutes of setup first.',
  '',
  `${built.length} of ${wanted.length} scenarios built.`,
  '',
]

/*
 * Coverage, by card.
 *
 * The point of naming saves after card ids: this table falls out of it, and it is the thing that
 * makes the approach systemic rather than a pile of ad-hoc fixtures. A card with no save is a card
 * nobody has looked at in a running game — which, given that every bug so far was an interaction
 * only visible in one, is the list that matters.
 *
 * Implemented cards only. Counting lore30 as a gap would be noise: it is deliberately not built.
 */
const SKIP = new Set(['lore29', 'lore30'])
const coverage = new Map<string, string[]>()
for (const { sc } of built) {
  for (const c of sc.cards) {
    const list = coverage.get(c) ?? []
    list.push(fileOf(sc))
    coverage.set(c, list)
  }
}
const covered = LORE.filter((c) => !SKIP.has(c.id) && coverage.has(c.id))
const bare = LORE.filter((c) => !SKIP.has(c.id) && !coverage.has(c.id))

lines.push('## Coverage by card', '')
lines.push(
  `${covered.length} of ${covered.length + bare.length} implemented lore cards have a save.`,
  '',
)
lines.push('| Card | | Saves |', '| ---: | --- | --- |')
for (const card of LORE) {
  if (SKIP.has(card.id)) continue
  const files = coverage.get(card.id) ?? []
  const cell =
    files.length === 0
      ? '—'
      : files.map((f) => `[${f}](${f}.json)`).join('<br>')
  lines.push(`| \`${card.id}\` | ${card.name} | ${cell} |`)
}
lines.push('')
if (bare.length > 0) {
  lines.push(
    '**No save yet:** ' + bare.map((c) => `${c.name} (\`${c.id}\`)`).join(', ') + '.',
    '',
    'Not a claim that these are broken — a claim that nobody has watched them run. Add a scenario',
    'to `scripts/build-test-saves.ts` to close one.',
    '',
  )
}

for (const [batch, items] of byBatch) {
  lines.push(`## ${batch}`, '')
  for (const { sc, hit } of items) {
    lines.push(`### ${sc.title}`, '')
    lines.push(`\`saves/lore/${fileOf(sc)}.json\` — seed ${hit.seed}, ${hit.journal} actions in.`)
    lines.push('')
    // Most engine prompts already lead with the faction ("red — assign 1 self-hit"), so only
    // prefix it when it does not, or the line reads "red — red — ...".
    const where = hit.prompt.startsWith(hit.faction) ? hit.prompt : `${hit.faction} — ${hit.prompt}`
    lines.push(`**You are here:** ${where}`)
    lines.push('')
    lines.push(`**➜ Do this first:** ${sc.first}`)
    lines.push('')
    lines.push('**Then check:**')
    lines.push('')
    for (const t of sc.steps) lines.push(`- ${t}`)
    lines.push('')
    lines.push(`**Why it is worth checking:** ${sc.why}`)
    lines.push('')
    lines.push(`Cards: ${hit.holding}`)
    lines.push('')
  }
}

if (failed.length > 0) {
  lines.push('## Not built', '')
  lines.push(
    'The seed sweep never reached these. They are listed rather than dropped so the gap is',
    'visible — a missing scenario is not the same as a passing one.',
    '',
  )
  for (const { sc, why } of failed) lines.push(`- **${sc.title}** (\`${fileOf(sc)}\`) — ${why}`)
  lines.push('')
}

writeFileSync(join(OUT, 'README.md'), lines.join('\n'))
process.stdout.write(`\n${built.length} built, ${failed.length} missed → ${OUT}\n`)
