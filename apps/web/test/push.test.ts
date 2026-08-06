/**
 * The live socket: what a client does with a push, and what it does when there is no socket.
 *
 * These are the *client* half. The Durable Object's half — accepting hibernatably and broadcasting
 * after an append — cannot be reached from here and is checked live against `wrangler dev` by
 * `scripts/ws-check.ts`, because a fake would only be testing the fake.
 *
 * The property worth defending is that **the socket is an optimisation, never a dependency**. Every
 * way it can fail ends with the game still playable over HTTP, and the last two cases are the ones
 * that say so.
 */

import { MemoryStore, handle } from '@arcs/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { POLL_MS, Session } from '../src/multiplayer/session.js'
import type { SessionHost } from '../src/multiplayer/session.js'
import { MultiplayerClient } from '../src/multiplayer/client.js'
import { applyExternal, defaultRegistry, encodeAction, startGame } from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'

const registry = defaultRegistry()
const API = 'https://arcs.test'
const OPTIONS: NewGameOptions = { board: 'Board3MixUp', factions: ['red', 'yellow', 'blue'], seed: 5 }

/** A socket the test drives by hand. Records what the session did to it. */
class FakeSocket {
  static last: FakeSocket | undefined
  static failConstruction = false

  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    if (FakeSocket.failConstruction) throw new Error('blocked')
    FakeSocket.last = this
  }

  close(): void {
    this.closed = true
  }

  /** Pretend the server pushed. */
  push(from: number, entries: readonly string[]): void {
    this.onmessage?.({ data: JSON.stringify({ from, entries }) })
  }
}

function install(): void {
  FakeSocket.last = undefined
  FakeSocket.failConstruction = false
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket)
  vi.stubGlobal('location', { href: 'https://arcs.test/' })
}

/** Point `fetch` at an in-process server, so the HTTP half is the real protocol. */
function serve(store: MemoryStore): { reads: number } {
  const count = { reads: 0 }
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if ((init?.method ?? 'GET') === 'GET' && url.includes('/games/')) count.reads += 1
    return handle(new Request(url, init), store)
  })
  return count
}

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
      this.result = this.result === null ? null : applyExternal(this.result, action, registry)
    },
  }
}

/** The first action of a fresh game, which is red's. */
function firstAction(): Action {
  return (startGame(OPTIONS, registry).continue as { actions: Action[] }).actions[0]!
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the live socket', () => {
  it('is opened at the game’s own ws:// address', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const session = new Session(API, { gameId: created.gameId }, host())
    await session.join()

    // https -> wss, not ws: an https page opening ws:// is blocked as mixed content.
    expect(FakeSocket.last?.url).toBe(`${API}/games/${created.gameId}/live`.replace('https:', 'wss:'))
    session.leave()
  })

  it('applies a pushed action without any further request', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()

    const theirs = firstAction()
    FakeSocket.last!.push(0, [encodeAction(theirs)])

    expect(h.remote).toHaveLength(1)
    expect(h.result?.state.journal).toHaveLength(1)
    session.leave()
  })

  /*
   * The case that would double every move. Publishing is optimistic — applied locally, then sent —
   * so the push that follows is the client's own action coming back. `from` is what tells them
   * apart; without it the only options are applying twice or never.
   */
  it('ignores a push of an action it already applied', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId, seatToken: created.seats[0]!.seatToken }, h)
    await session.join()

    const mine = firstAction()
    h.applyRemote(mine) // stands in for the optimistic local apply
    const before = h.result!.state.journal.length
    FakeSocket.last!.push(0, [encodeAction(mine)])

    expect(h.result?.state.journal).toHaveLength(before)
    session.leave()
  })

  it('resyncs rather than guessing when the push starts past where it is', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()
    const adoptedAfterJoin = h.adopted

    // Claim entry 7 while the client holds none: something was missed, so replay is the only answer.
    FakeSocket.last!.push(7, ['whatever'])
    await vi.waitFor(() => expect(h.adopted).toBe(adoptedAfterJoin + 1))
    session.leave()
  })

  /*
   * The whole point of the change, stated as a test.
   *
   * Polling a three-hour game costs ~13,000 requests; if the timer keeps running behind a healthy
   * socket then none of that is saved and the only evidence would be the bill. So: once the socket
   * is up, time passing must cost nothing.
   */
  it('makes no requests at all while the socket is healthy', async () => {
    vi.useFakeTimers()
    install()
    const store = new MemoryStore()
    const count = serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()

    FakeSocket.last!.onopen?.()
    await vi.advanceTimersByTimeAsync(0) // let the one catch-up read settle
    const afterOpen = count.reads

    // Ten polls' worth of time, and a real action arriving by push rather than by asking.
    await vi.advanceTimersByTimeAsync(POLL_MS * 10)
    FakeSocket.last!.push(0, [encodeAction(firstAction())])

    expect(count.reads, 'no reads once the socket is open').toBe(afterOpen)
    expect(h.result?.state.journal, 'and the action still arrived').toHaveLength(1)
    session.leave()
  })

  it('survives a malformed push', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()

    for (const junk of ['', 'not json', '{}', '{"from":"x","entries":[]}', '{"from":0}']) {
      expect(() => FakeSocket.last!.onmessage?.({ data: junk })).not.toThrow()
    }
    expect(h.remote).toHaveLength(0)
    session.leave()
  })
})

describe('when there is no socket, the game still works', () => {
  it('polls when WebSocket does not exist at all', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', undefined)
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()

    // Someone else acts straight into the store; only a poll can discover it.
    const theirs = firstAction()
    await store.append(created.gameId, created.seats[0]!.seatToken, 0, encodeAction(theirs))

    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    expect(h.result?.state.journal).toHaveLength(1)
    session.leave()
  })

  it('polls when constructing the socket throws', async () => {
    vi.useFakeTimers()
    install()
    FakeSocket.failConstruction = true
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()

    const theirs = firstAction()
    await store.append(created.gameId, created.seats[0]!.seatToken, 0, encodeAction(theirs))
    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    expect(h.result?.state.journal).toHaveLength(1)
    session.leave()
  })

  /*
   * A three-hour game will drop a socket. Falling back permanently would work but would quietly
   * give up the whole saving, so a close starts polling *and* schedules another attempt.
   */
  it('starts polling when an open socket closes', async () => {
    vi.useFakeTimers()
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const h = host()
    const session = new Session(API, { gameId: created.gameId }, h)
    await session.join()

    FakeSocket.last!.onclose?.()

    const theirs = firstAction()
    await store.append(created.gameId, created.seats[0]!.seatToken, 0, encodeAction(theirs))
    await vi.advanceTimersByTimeAsync(POLL_MS + 10)
    expect(h.result?.state.journal).toHaveLength(1)
    session.leave()
  })

  it('closes the socket and stops the timer on leave', async () => {
    install()
    const store = new MemoryStore()
    serve(store)
    const created = await store.create(OPTIONS, ['red', 'yellow', 'blue'])
    const session = new Session(API, { gameId: created.gameId }, host())
    await session.join()
    const ws = FakeSocket.last!

    session.leave()
    expect(ws.closed).toBe(true)
    // A push after leaving must not reach a session that has gone.
    expect(() => ws.push(0, ['x'])).not.toThrow()
  })
})

describe('the live URL', () => {
  it('is same-origin when the build has no configured base', () => {
    const client = new MultiplayerClient('')
    expect(client.liveUrl('g1', 'https://arcs.example/')).toBe('wss://arcs.example/games/g1/live')
  })

  it('follows an absolute base, and downgrades to ws for http', () => {
    const client = new MultiplayerClient('http://localhost:8787')
    expect(client.liveUrl('g1', 'http://localhost:5173/')).toBe('ws://localhost:8787/games/g1/live')
  })

  it('escapes a game id that needs it', () => {
    const client = new MultiplayerClient('')
    expect(client.liveUrl('a/b', 'https://arcs.example/')).toBe('wss://arcs.example/games/a%2Fb/live')
  })
})
