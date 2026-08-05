/**
 * The seat boundary: who you are, what you may do, and what you may see.
 *
 * Lives in `apps/web` because it is the only package that may import **both** the engine and the
 * server. That is the point of putting it here rather than in either of them: the server's
 * `actorOf` re-implements a rule that belongs to the engine's `encodeAction`, and the only honest
 * way to check the two agree is to run one over the output of the other.
 */

import { MemoryStore, actorOf, handle } from '@arcs/server'
import { describe, expect, it } from 'vitest'

import { handOwner, viewFor } from '../src/multiplayer/seat.js'
import type { SeatView } from '../src/multiplayer/seat.js'
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

describe('the UI is never offered another seat’s decision', () => {
  const ask = (faction: string, n: number): Ask =>
    ({
      kind: 'ask',
      faction,
      actions: Array.from({ length: n }, (_, i) => ({ type: 't', faction, label: `${i}` })),
    }) as unknown as Ask

  const SEAT: SeatView = { kind: 'seat', faction: 'red' }
  const HOTSEAT: SeatView = { kind: 'hotseat' }
  const WATCHING: SeatView = { kind: 'spectator' }

  it('empties the actions of an ask addressed to someone else', () => {
    const theirs = viewFor(ask('blue', 3), SEAT)
    expect(theirs.kind).toBe('ask')
    expect((theirs as Ask).actions).toEqual([])
    // The faction survives, because the board still has to show whose turn it is.
    expect((theirs as Ask).faction).toBe('blue')
  })

  it('passes your own ask through untouched', () => {
    const mine = ask('red', 3)
    expect(viewFor(mine, SEAT)).toBe(mine)
  })

  it('leaves a hotseat game entirely alone, since it plays every seat', () => {
    const any = ask('blue', 3)
    expect(viewFor(any, HOTSEAT)).toBe(any)
  })

  it('offers a spectator nothing, whoever is acting', () => {
    for (const f of ['red', 'blue', 'yellow']) {
      expect((viewFor(ask(f, 3), WATCHING) as Ask).actions).toEqual([])
    }
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
})
