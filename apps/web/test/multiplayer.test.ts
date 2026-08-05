/**
 * The client half: links, and a session against a real server.
 *
 * The session tests run against `handle` + `MemoryStore` from `@arcs/server` rather than a mock, so
 * what is exercised is the actual protocol — the same `expectedLength` check, the same 409, the same
 * `?since=N` tail. A mock would let the client and server drift apart while both kept passing,
 * which is the failure this file exists to prevent.
 */

import { MemoryStore, handle } from '@arcs/server'
import { describe, expect, it, vi } from 'vitest'

import { hashFor, linkFor, parseLink } from '../src/multiplayer/link.js'
import { Session } from '../src/multiplayer/session.js'
import type { SessionHost } from '../src/multiplayer/session.js'
import { applyExternal, encodeAction, startGame, defaultRegistry } from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'

const registry = defaultRegistry()
const API = 'https://arcs.test'
const OPTIONS: NewGameOptions = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 5 }

/** Point `fetch` at an in-process server, so the client speaks the real protocol. */
function serve(store: MemoryStore): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input as string, init), store),
  )
}

/** A host that records what the session does to it. */
function host(): SessionHost & { result: RuleResult | null; adopted: number; remote: Action[] } {
  return {
    result: null,
    adopted: 0,
    remote: [],
    current() {
      return this.result
    },
    adopt(_options, result) {
      this.result = result
      this.adopted += 1
    },
    applyRemote(action) {
      this.remote.push(action)
      this.result = this.result === null ? null : applyTo(this.result, action)
    },
  }
}

/** Mirrors what the store does with a remote action, without importing its React wiring. */
const applyTo = (r: RuleResult, a: Action): RuleResult => applyExternal(r, a, registry)

describe('the link is the credential', () => {
  it('reads a player link and a spectator link', () => {
    expect(parseLink('#/g/abc/s/tok')).toEqual({ gameId: 'abc', seatToken: 'tok' })
    expect(parseLink('#/g/abc')).toEqual({ gameId: 'abc' })
    // A spectator holds no token, which is the whole difference between watching and playing.
    expect(parseLink('#/g/abc')?.seatToken).toBeUndefined()
  })

  it('ignores anything that is not a game link', () => {
    expect(parseLink('')).toBeUndefined()
    expect(parseLink('#/settings')).toBeUndefined()
    expect(parseLink('#/g/')).toBeUndefined()
  })

  it('round-trips ids that need escaping', () => {
    const link = linkFor('https://arcs.test', 'a/b', 'c d')
    expect(parseLink(new URL(link).hash)).toEqual({ gameId: 'a/b', seatToken: 'c d' })
  })

  /*
   * The creator never follows a link — they click through from the share screen — so their seat
   * reaches the address bar via `hashFor` instead. If it drifted from what `parseLink` accepts,
   * the one player who cannot recover a reload would be the one who started the game.
   */
  it('puts the creator on the same route a player link would', () => {
    expect(parseLink(hashFor('a/b', 'c d'))).toEqual({ gameId: 'a/b', seatToken: 'c d' })
    expect(hashFor('g1', 's1')).toBe(new URL(linkFor('https://arcs.test', 'g1', 's1')).hash)
    expect(hashFor('g1')).toBe(new URL(linkFor('https://arcs.test', 'g1')).hash)
  })
})

describe('a joined session, against the real server', () => {
  it('loads the game on join by replaying the journal', async () => {
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])

    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()
    session.leave()

    expect(h.adopted).toBe(1)
    // Replay of an empty journal is a fresh game — byte for byte, which is the design (docs/11).
    expect(h.result?.state.journal).toEqual([])
    expect(h.result?.state.board.systems.length).toBe(startGame(OPTIONS, registry).state.board.systems.length)
  })

  it('publishes a local move so another client can see it', async () => {
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])

    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()

    const first = (h.result!.continue as { actions: Action[] }).actions[0]!
    await session.publish(first, 0)
    session.leave()

    const tail = await store.read(created.gameId, 0)
    expect(tail?.entries).toHaveLength(1)
  })

  it('replays what someone else did, on poll', async () => {
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])

    // Another player acts first, straight into the store.
    const fresh = startGame(OPTIONS, registry)
    const theirs = (fresh.continue as { actions: Action[] }).actions[0]!
    await store.append(created.gameId, created.seats[1]!.seatToken, 0, encodeAction(theirs))

    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()
    session.leave()

    // Join replays it; there is nothing left for the poll to find.
    expect(h.result?.state.journal).toHaveLength(1)
  })

  it('recovers from a conflict by replaying rather than unwinding', async () => {
    /*
     * The reason optimism is affordable here. The client publishes at a length the server has moved
     * past — a stale tab, a double-tap — and instead of rolling anything back, `resync` rebuilds
     * from the authoritative journal. Replay is exact, so there is no partial state to reconcile.
     */
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const fresh = startGame(OPTIONS, registry)
    const theirs = (fresh.continue as { actions: Action[] }).actions[0]!
    await store.append(created.gameId, created.seats[1]!.seatToken, 0, encodeAction(theirs))

    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()
    const adoptedAfterJoin = h.adopted

    // Publish against a length the server has already passed.
    await session.publish(theirs, 0)
    session.leave()

    expect(h.adopted).toBe(adoptedAfterJoin + 1) // it resynced
    expect(h.result?.state.journal).toEqual((await store.read(created.gameId, 0))!.entries)
  })

  it('publishes each move at the length it was made against, not always zero', async () => {
    /*
     * Every other case here publishes the first move of a game, so `expectedLength` is 0 and a
     * hardcoded zero would pass them all — mutation testing caught exactly that. A second move has
     * to be published at 1, or the server rejects it as a conflict and the game silently stops
     * advancing after one action.
     */
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])

    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()

    // Two moves in sequence, each published at the length it was actually made against.
    for (let i = 0; i < 2; i++) {
      const before = h.result!.state.journal.length
      const next = (h.result!.continue as { actions: Action[] }).actions[0]!
      h.result = applyTo(h.result!, next)
      await session.publish(next, before)
    }
    session.leave()

    expect((await store.read(created.gameId, 0))?.entries).toHaveLength(2)
  })

  it('publishes nothing as a spectator', async () => {
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])

    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h) // no seat token
    await session.join()
    expect(session.isSpectator).toBe(true)

    const first = (h.result!.continue as { actions: Action[] }).actions[0]!
    await session.publish(first, 0)
    session.leave()

    expect((await store.read(created.gameId, 0))?.entries).toEqual([])
  })
})
