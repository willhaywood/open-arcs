/**
 * The seat boundary: who you are, what you may do, and what you may see.
 *
 * Lives in `apps/web` because it is the only package that may import **both** the engine and the
 * server. That is the point of putting it here rather than in either of them: the server's
 * `actorOf` re-implements a rule that belongs to the engine's `encodeAction`, and the only honest
 * way to check the two agree is to run one over the output of the other.
 */

import { MemoryStore, actorOf, handle } from '@arcs/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { canAct, handOwner, viewFor } from '../src/multiplayer/seat.js'
import type { SeatView } from '../src/multiplayer/seat.js'
import { Watching } from '../src/components/Watching.js'
import { isPublicSurface, surfaceFor } from '../src/surfaces.js'
import {
  applyExternal,
  defaultRegistry,
  encodeAction,
  isUserAction,
  startGame,
} from '@arcs/engine'
import type { Action, Ask, Continue, NewGameOptions, RuleResult } from '@arcs/engine'

const registry = defaultRegistry()
const BASE = 'https://arcs.test'

/** Drive a real game and collect every action the engine actually journals. */
function realActions(options: NewGameOptions, steps = 400): Action[] {
  let r: RuleResult = startGame(options, registry)
  const taken: Action[] = []
  for (let i = 0; i < steps; i++) {
    const c = r.continue as Continue
    if (c.kind !== 'ask') break
    const actions = c.actions
    if (actions.length === 0) break
    // Vary the pick so this walks more branches than "always the first offer".
    const action = actions[(i * 7) % actions.length]!
    taken.push(action)
    r = applyExternal(r, action, registry)
    if (r.state.isOver) break
  }
  return taken
}

const CONFIGS: NewGameOptions[] = [
  { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7 },
  { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 7, leadersAndLore: true },
  { board: 'Board4MixUp1', factions: ['red', 'yellow', 'blue', 'white'], seed: 11 },
  { board: 'Board4MixUp1', factions: ['red', 'yellow', 'blue', 'white'], seed: 12, leadersAndLore: true },
  /*
   * The expansion pack, and not for variety's sake: the Archivist is `leader09`, so `learned` — the
   * one surface a watcher must never be shown — is unreachable without it. Every config above ran
   * with base leaders only, which is why the walk below never once produced it, and why the
   * assertion about private surfaces used to hold no matter what `isPublicSurface` said.
   *
   * Seed 5 reaches the Archivist's draw at step 12 on this board; it was picked by searching seeds
   * 1-40 for one that does, rather than assumed.
   */
  {
    board: 'Board3MixUp',
    factions: ['red', 'yellow', 'blue'],
    seed: 5,
    leadersAndLore: { expansion: true, lorePerPlayer: 3 },
  },
  /*
   * Two players, whose asks are not a subset of the others': the mulligan exists only here, and it
   * was unclaimed — so a watcher's screen went blank on it. Both sweeps in this repo ran three and
   * four players only, which is how it reached a real game.
   */
  {
    board: 'Board2MixUp2',
    factions: ['red', 'yellow'],
    seed: 3,
    leadersAndLore: { expansion: false, lorePerPlayer: 1 },
  },
]

describe('actorOf, against actions the engine really produces', () => {
  /*
   * The load-bearing test for server-side enforcement. `actorOf` duplicates the engine's
   * field-splitting rule in a package that may not import the engine, so the risk is not that it is
   * wrong today — it is that `encodeAction` changes and nothing notices until players can act for
   * each other in production.
   */
  it('reads the actor off every action, across variants and player counts', () => {
    let checked = 0
    for (const options of CONFIGS) {
      for (const action of realActions(options)) {
        expect(isUserAction(action)).toBe(true)
        expect(actorOf(encodeAction(action))).toBe(action['faction'])
        checked++
      }
    }
    // Guards against the loop silently doing nothing, which would make the assertions vacuous.
    expect(checked).toBeGreaterThan(1000)
  })

  it('reads the field named faction, not the first text that looks like one', () => {
    /*
     * The case that earns the scanner its keep, and it took a failed mutation to find. The obvious
     * implementation — `/faction="([^"]*)"/` — passes every other test in this file, because it is
     * saved by two coincidences: `encodeAction` sorts keys, so the real `faction=` usually comes
     * first, and a nested action serialises as JSON, so its faction reads `"faction":` with a colon
     * and never matches.
     *
     * Neither coincidence holds for a field whose *name ends in* `faction` and sorts ahead of it.
     * `attackerfaction` is not hypothetical for long: the moment a battle action names both sides,
     * a regex starts reporting the defender as the actor, and the server starts refusing legal moves
     * and accepting forged ones.
     */
    const hostile = 't(attackerfaction="blue",faction="red")'
    expect(actorOf(hostile)).toBe('red')

    // And the nested-JSON shape, which is what real actions actually look like.
    const nested = encodeAction({
      type: 'action/take',
      faction: 'red',
      then: { type: 'turn/pips', faction: 'blue', done: 1 },
    })
    expect(nested).toContain('"faction":"blue"')
    expect(actorOf(nested)).toBe('red')
  })

  it('returns undefined rather than guessing, on anything it cannot read', () => {
    for (const junk of ['', 'x', 'plain-type', 'type(', 'type(faction)', 'type(faction=notjson)']) {
      expect(actorOf(junk)).toBeUndefined()
    }
    // A non-string faction is not an actor either.
    expect(actorOf('type(faction=7)')).toBeUndefined()
  })
})

describe('the server refuses an action published from the wrong seat', () => {
  async function seeded(): Promise<{ store: MemoryStore; game: any }> {
    const store = new MemoryStore()
    const res = await handle(
      new Request(`${BASE}/games`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ options: CONFIGS[0], factions: ['red', 'yellow', 'blue'] }),
      }),
      store,
    )
    return { store, game: await res.json() }
  }

  const append = (gameId: string, seatToken: string, action: string): Request =>
    new Request(`${BASE}/games/${gameId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken, expectedLength: 0, action }),
    })

  it('accepts your own faction and rejects somebody else’s', async () => {
    const { store, game } = await seeded()
    const red = game.seats.find((s: any) => s.faction === 'red').seatToken
    const first = realActions(CONFIGS[0]!, 1)[0]!
    expect(first['faction']).toBe('red')

    // Red publishing red's own move.
    expect((await handle(append(game.gameId, red, encodeAction(first)), store)).status).toBe(200)

    // Red publishing a move that says it is blue's.
    const forged = encodeAction({ ...first, faction: 'blue' })
    const res = await handle(append(game.gameId, red, forged), store)
    expect(res.status).toBe(403)
    // And it did not land: the journal still holds only the legitimate first action.
    expect((await store.read(game.gameId, 0))!.length).toBe(1)
  })

  it('still stores an action with no readable actor, because the server holds opaque strings', async () => {
    /*
     * Deliberate, and stated here so it is not "fixed" into strictness. Refusing these would couple
     * the server to the engine's encoding — and an action with no faction does not replay as a legal
     * move for anyone, so it buys an attacker nothing.
     */
    const { store, game } = await seeded()
    const res = await handle(append(game.gameId, game.seats[0].seatToken, 'opaque'), store)
    expect(res.status).toBe(200)
  })
})

describe('the server tells a client which seat it holds', () => {
  it('answers yourFaction for a seat token, and nothing for a spectator', async () => {
    const store = new MemoryStore()
    const created = await store.create(CONFIGS[0], ['red', 'yellow', 'blue'])
    const blue = created.seats.find((s) => s.faction === 'blue')!.seatToken

    const withSeat = await handle(
      new Request(`${BASE}/games/${created.gameId}?since=0`, { headers: { 'x-seat-token': blue } }),
      store,
    )
    expect(((await withSeat.json()) as any).yourFaction).toBe('blue')

    const watching = await handle(new Request(`${BASE}/games/${created.gameId}?since=0`), store)
    expect(((await watching.json()) as any).yourFaction).toBeUndefined()

    // A wrong token reads as a spectator rather than as an error — see the note on `read`.
    const wrong = await handle(
      new Request(`${BASE}/games/${created.gameId}?since=0`, {
        headers: { 'x-seat-token': 'not-a-token' },
      }),
      store,
    )
    expect(wrong.status).toBe(200)
    expect(((await wrong.json()) as any).yourFaction).toBeUndefined()
  })

  it('allows the seat-token header through the preflight', async () => {
    /*
     * A custom header is what makes even a GET preflight cross-origin. Omitting it from the
     * allow-list fails as "you are a spectator" — the request succeeds without the header — which is
     * a genuinely confusing way for identity to break.
     */
    const pre = await handle(new Request(`${BASE}/games`, { method: 'OPTIONS' }), new MemoryStore())
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-seat-token')
  })
})

describe('acting and watching are different questions', () => {
  const askOf = (faction: string, ...types: string[]): Ask =>
    ({
      kind: 'ask',
      faction,
      actions: types.map((type, i) => ({ type, faction, label: `${i}` })),
    }) as unknown as Ask

  const SEAT: SeatView = { kind: 'seat', faction: 'red' }
  const HOTSEAT: SeatView = { kind: 'hotseat' }
  const WATCHING: SeatView = { kind: 'spectator' }

  /** A battle roll: the surface a watcher most wants, and the one this work exists to restore. */
  const battle = (faction: string) => askOf(faction, 'battle/roll')
  /** The Archivist's draw, off the hidden lore deck. */
  const learned = (faction: string) => askOf(faction, 'leaders/learned')

  it('lets nobody but the asked seat act', () => {
    expect(canAct(battle('red'), SEAT)).toBe(true)
    expect(canAct(battle('blue'), SEAT)).toBe(false)
    expect(canAct(battle('blue'), WATCHING)).toBe(false)
    // Hotseat plays every seat, so it always may.
    expect(canAct(battle('blue'), HOTSEAT)).toBe(true)
  })

  /*
   * The regression this replaces. `viewFor` used to empty the actions of *any* ask not addressed to
   * you, which stopped you acting and also stopped you seeing: `surfaceFor` returns nothing for an
   * ask with no actions, so the battle window and its dice went blank for everyone but the roller.
   */
  it('still draws a public surface for someone who cannot act on it', () => {
    const theirs = battle('blue')
    expect(viewFor(theirs, SEAT)).toBe(theirs)
    expect(viewFor(theirs, WATCHING)).toBe(theirs)
    expect(surfaceFor(viewFor(theirs, SEAT))).toBe('battle')
  })

  it('withholds a private surface entirely', () => {
    // The Archivist's five come off `state.unusedLore`, which `observe.ts` lists as hidden: drawing
    // this for anyone else reveals the three they discard.
    const theirs = learned('blue')
    expect((viewFor(theirs, SEAT) as Ask).actions).toEqual([])
    expect((viewFor(theirs, WATCHING) as Ask).actions).toEqual([])
    // ...and your own is untouched, by identity: nothing is rebuilt for the seat being asked.
    const mine = learned('red')
    expect(viewFor(mine, SEAT)).toBe(mine)
  })

  it('keeps the faction on a withheld ask, because the board still names whose turn it is', () => {
    expect((viewFor(learned('blue'), SEAT) as Ask).faction).toBe('blue')
  })

  /*
   * The dead two-player game, as a unit test.
   *
   * `surfaceFor` returning `undefined` means no surface claims the ask, and the first cut of this
   * file treated that as a reason to hide it — which reintroduced the original regression for every
   * action type the table had not got round to. `turn/mulligan` was one: offered only at two
   * players, so no sweep played it, so nobody claimed it, so a watcher sat on an empty prompt while
   * the actor played on through the fallback strip, which draws unclaimed asks deliberately.
   *
   * Hiding is the dangerous default here, and the asymmetry is the argument: an unclaimed *public*
   * ask is the normal case and blanking it kills the screen, while an unclaimed *private* one
   * requires someone to add a private surface and leave it out of `PRIVATE`.
   */
  it('draws an ask that no surface claims, rather than blanking it', () => {
    const unclaimed = askOf('blue', 'turn/some-action-added-next-week')
    expect(surfaceFor(unclaimed), 'the fixture is genuinely unclaimed').toBeUndefined()
    expect(viewFor(unclaimed, SEAT)).toBe(unclaimed)
    expect(viewFor(unclaimed, WATCHING)).toBe(unclaimed)
  })

  it('draws the two-player mulligan for the player who is not being offered it', () => {
    // The reported case, by its real action types — which are now claimed by the strip.
    const theirs = askOf('blue', 'turn/mulligan', 'turn/keep-hand')
    expect(surfaceFor(theirs)).toBe('strip')
    expect(viewFor(theirs, SEAT)).toBe(theirs)
    expect(canAct(theirs, SEAT)).toBe(false)
  })

  it('leaves a hotseat game entirely alone', () => {
    const any = learned('blue')
    expect(viewFor(any, HOTSEAT)).toBe(any)
  })
})

/**
 * The measurement that found the regression, kept as a test.
 *
 * Walking real games and comparing the surface an actor resolves to against the surface a
 * non-acting seat resolves to is exactly the check that would have caught nine surfaces going
 * blank. Hand-written asks cannot do this job: the bug was in which surfaces real play produces.
 */
describe('across real games, a watcher loses only the private surfaces', () => {
  it('resolves every public surface identically for a seat that cannot act', () => {
    const lost = new Set<string>()
    const kept = new Set<string>()
    /** Every surface the walk produced at all, so the expectation is not derived from the result. */
    const reached = new Set<string>()
    let asks = 0

    for (const options of CONFIGS) {
      let r: RuleResult = startGame(options, registry)
      for (let i = 0; i < 400; i++) {
        const c = r.continue
        if (c.kind !== 'ask' || c.actions.length === 0) break
        asks++
        const other = options.factions.find((f) => f !== c.faction)!
        const seen = surfaceFor(viewFor(c, { kind: 'seat', faction: other }))
        const actual = surfaceFor(c)
        if (actual !== undefined) {
          reached.add(actual)
          ;(seen === actual ? kept : lost).add(actual)
        }
        r = applyExternal(r, c.actions[(i * 7) % c.actions.length]!, registry)
        if (r.state.isOver) break
      }
    }

    expect(asks, 'the walk actually reached asks').toBeGreaterThan(500)
    /*
     * Both directions, against `reached` rather than against `lost`.
     *
     * The first cut of this compared `lost` to `['hand', 'learned'].filter((s) => lost.has(s))`,
     * which derives the expectation from the answer: it caught a *public* surface going dark, and
     * passed unchanged when a private one leaked, because an empty `lost` matches an empty expected.
     * That is the half that matters — making `learned` public is the mutation this test exists for.
     *
     * Anchoring on the surfaces the walk actually produced fixes it: every private surface the walk
     * reached must be lost, and every other surface it reached must be kept.
     */
    const expectedLost = [...reached].filter((s) => !isPublicSurface(s as never)).sort()
    expect(expectedLost, 'the walk reaches the private surfaces at all').toEqual(['hand', 'learned'])
    expect([...lost].sort(), 'exactly the private surfaces are withheld').toEqual(expectedLost)
    // And the ones that matter are genuinely reaching a watcher.
    expect(kept, 'the battle surface survives for a watcher').toContain('battle')
  })
})

describe('whose hand is on screen', () => {
  /*
   * The regression that a browser found and the unit tests had not. `handOwner` used to take
   * `FactionId | null`, where `null` meant *both* hotseat and spectator — so a watching stranger
   * fell through to the hotseat branch and was shown the current player's hand. Three named states
   * exist because two of them looked identical and wanted opposite behaviour.
   */
  it('shows the asked player in hotseat, your own seat in a joined game, and nobody while watching', () => {
    expect(handOwner({ kind: 'hotseat' }, 'blue')).toBe('blue')
    expect(handOwner({ kind: 'seat', faction: 'red' }, 'blue')).toBe('red')
    expect(handOwner({ kind: 'spectator' }, 'blue')).toBeNull()
  })

  it('shows your own hand on your turn and off it, because you hold your cards either way', () => {
    const mine: SeatView = { kind: 'seat', faction: 'red' }
    expect(handOwner(mine, 'red')).toBe('red')
    expect(handOwner(mine, 'yellow')).toBe('red')
  })

  /*
   * Bot seats are not the browser's players. Their hands are as private as a rival's in a joined
   * game, and fanning one face-up during the bot's paced turn was a leak: the hotseat branch
   * showed "whoever is asked" without asking whether anyone at this keyboard is playing that seat.
   */
  it('never fans a bot hand: the lone human keeps their own cards while bots play', () => {
    const hotseat: SeatView = { kind: 'hotseat' }
    // A human asked among humans is unchanged.
    expect(handOwner(hotseat, 'red', ['red'])).toBe('red')
    // A bot asked: the one human's cards stay on the table.
    expect(handOwner(hotseat, 'yellow', ['red'])).toBe('red')
    // Several humans: no one "you" to pick, so nobody's cards while the bot plays.
    expect(handOwner(hotseat, 'yellow', ['red', 'blue'])).toBeNull()
    // Every seat a bot: nothing to show at all.
    expect(handOwner(hotseat, 'yellow', [])).toBeNull()
    // No bot information (old callers): the plain hotseat rule.
    expect(handOwner(hotseat, 'yellow')).toBe('yellow')
  })
})

/**
 * The `inert` attribute itself, because everything else here tests the decision and not the effect.
 *
 * `canAct` returning false is only advice until something acts on it, and the whole of that
 * something is one attribute in one component. Deleting it left all 58 tests passing while a watcher
 * could press every button on screen — the browser caught that, and no test did. The attribute is
 * also easy to lose by accident: React 18 does not type `inert`, so it is passed through a cast that
 * a future React upgrade will want to remove.
 *
 * `renderToStaticMarkup` is enough and needs no DOM. It cannot tell us the browser honors `inert` —
 * that was checked by hit-testing a real click against an actor doing the same thing — but it does
 * tell us we still emit it.
 */
describe('the wrapper that makes watching inert', () => {
  const markup = (canAct: boolean): string =>
    renderToStaticMarkup(createElement(Watching, { canAct }, 'contents'))

  it('marks the subtree inert for a client that may not act', () => {
    expect(markup(false)).toContain('inert')
  })

  it('leaves it interactive for one that may', () => {
    expect(markup(true)).not.toContain('inert')
  })

  it('renders the children either way, which is the point of not hiding them', () => {
    expect(markup(false)).toContain('contents')
    expect(markup(true)).toContain('contents')
  })
})
