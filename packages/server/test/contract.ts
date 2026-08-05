/**
 * The endpoint contract — what *any* `GameStore` implementation has to satisfy.
 *
 * docs/17 section 4b rule 2: both platforms serve exactly these routes with exactly these
 * semantics, so the client cannot tell what is behind it. That is a claim about more than one
 * implementation, so this file is a **suite parameterised by store** rather than a test of a
 * backend — and it is run twice, against `MemoryStore` and against the Durable Object adapter.
 *
 * A Postgres store should pass it unchanged. If it ever does not, the pivot described in docs/17 has
 * quietly become a rewrite, and this is where that would show up.
 *
 * Every case goes through `handle`; nothing touches a store directly. The compare-and-set cases are
 * the ones that matter, and everything else is plumbing.
 */

import { describe, expect, it } from 'vitest'

import { handle } from '../src/index.js'
import type { CreatedGame, GameStore } from '../src/index.js'

const BASE = 'https://arcs.test'

const post = (path: string, body: unknown): Request =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const get = (path: string): Request => new Request(`${BASE}${path}`)

/** A store is made fresh per test, so the suite can be run against any implementation. */
export type MakeStore = () => GameStore

export function describeStoreContract(label: string, makeStore: MakeStore): void {
  /** A game with three seats, in a fresh store. */
  async function seeded(): Promise<{ store: GameStore; game: CreatedGame }> {
    const store = makeStore()
    const res = await handle(
      post('/games', { options: { board: 'Board3MixUp', seed: 7 }, factions: ['red', 'yellow', 'blue'] }),
      store,
    )
    expect(res.status).toBe(201)
    return { store, game: (await res.json()) as CreatedGame }
  }

describe(label, () => {
  describe('POST /games', () => {
    it('mints a game and one secret seat per faction', async () => {
      const { game } = await seeded()
      expect(game.gameId).toBeTruthy()
      expect(game.seats.map((s) => s.faction)).toEqual(['red', 'yellow', 'blue'])
      // The token is the credential (docs/17 section 3), so seats must not share one.
      expect(new Set(game.seats.map((s) => s.seatToken)).size).toBe(3)
    })

    it('rejects a request with no factions', async () => {
      const store = makeStore()
      expect((await handle(post('/games', { options: {} }), store)).status).toBe(400)
      expect((await handle(post('/games', { options: {}, factions: [] }), store)).status).toBe(400)
    })
  })

  describe('GET /games/:id', () => {
    it('returns the options it was given, verbatim and uninspected', async () => {
      // The server never runs the engine, so `options` is opaque JSON it stores and hands back.
      const { store, game } = await seeded()
      const body = (await (await handle(get(`/games/${game.gameId}`), store)).json()) as {
        options: unknown
        entries: string[]
        length: number
      }
      expect(body.options).toEqual({ board: 'Board3MixUp', seed: 7 })
      expect(body.entries).toEqual([])
      expect(body.length).toBe(0)
    })

    it('returns only the tail from ?since=N, which is what makes polling cheap', async () => {
      const { store, game } = await seeded()
      const token = game.seats[0]!.seatToken
      for (let i = 0; i < 3; i++) {
        await handle(
          post(`/games/${game.gameId}/actions`, { seatToken: token, expectedLength: i, action: `a${i}` }),
          store,
        )
      }
      const body = (await (await handle(get(`/games/${game.gameId}?since=2`), store)).json()) as {
        entries: string[]
        length: number
      }
      // The usual poll returns nothing at all; `length` is what the caller needs either way.
      expect(body.entries).toEqual(['a2'])
      expect(body.length).toBe(3)
    })

    it('404s an unknown game rather than inventing an empty one', async () => {
      const store = makeStore()
      expect((await handle(get('/games/nope'), store)).status).toBe(404)
    })
  })

  describe('POST /games/:id/actions — the compare-and-set', () => {
    it('appends when the expected length matches', async () => {
      const { store, game } = await seeded()
      const res = await handle(
        post(`/games/${game.gameId}/actions`, {
          seatToken: game.seats[0]!.seatToken,
          expectedLength: 0,
          action: 'turn/lead(card="X")',
        }),
        store,
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, length: 1 })
    })

    it('makes a double-tap a no-op rather than a duplicated action', async () => {
      /*
       * The reason `expectedLength` exists. The same request sent twice — a retried fetch, an
       * impatient click — must not append twice, because the journal *is* the game and a duplicated
       * action is a corrupted one.
       */
      const { store, game } = await seeded()
      const body = {
        seatToken: game.seats[0]!.seatToken,
        expectedLength: 0,
        action: 'turn/lead(card="X")',
      }
      expect((await handle(post(`/games/${game.gameId}/actions`, body), store)).status).toBe(200)

      const second = await handle(post(`/games/${game.gameId}/actions`, body), store)
      expect(second.status).toBe(409)
      expect(await second.json()).toEqual({ error: 'conflict', length: 1 })

      const tail = (await (await handle(get(`/games/${game.gameId}`), store)).json()) as {
        entries: string[]
      }
      expect(tail.entries).toEqual(['turn/lead(card="X")'])
    })

    it('tells a loser of a race where to resume', async () => {
      // 409 carries the current length so the caller re-reads from there instead of guessing.
      const { store, game } = await seeded()
      await handle(
        post(`/games/${game.gameId}/actions`, {
          seatToken: game.seats[0]!.seatToken,
          expectedLength: 0,
          action: 'first',
        }),
        store,
      )
      const stale = await handle(
        post(`/games/${game.gameId}/actions`, {
          seatToken: game.seats[1]!.seatToken,
          expectedLength: 0,
          action: 'second',
        }),
        store,
      )
      expect(stale.status).toBe(409)
      expect(((await stale.json()) as { length: number }).length).toBe(1)
    })

    it('refuses a seat token from another game', async () => {
      const a = await seeded()
      const b = await seeded()
      const res = await handle(
        post(`/games/${a.game.gameId}/actions`, {
          seatToken: b.game.seats[0]!.seatToken,
          expectedLength: 0,
          action: 'x',
        }),
        a.store,
      )
      expect(res.status).toBe(403)
    })

    it('does NOT check whose turn it is — that would mean running the engine', async () => {
      /*
       * Deliberate, and stated here so nobody "fixes" it. The server stores strings; turns are
       * strictly sequential, so a client cannot produce a legal action out of turn, and an illegal one
       * fails on every client's replay rather than corrupting the journal. Checking turn order here
       * would put a second copy of the rules in the server and end its portability.
       */
      const { store, game } = await seeded()
      const outOfTurn = await handle(
        post(`/games/${game.gameId}/actions`, {
          seatToken: game.seats[2]!.seatToken,
          expectedLength: 0,
          action: 'blue acts first',
        }),
        store,
      )
      expect(outOfTurn.status).toBe(200)
    })

    it('rejects a malformed body rather than storing nonsense', async () => {
      const { store, game } = await seeded()
      const cases = [
        { expectedLength: 0, action: 'x' }, // no seat
        { seatToken: game.seats[0]!.seatToken, action: 'x' }, // no expectedLength
        { seatToken: game.seats[0]!.seatToken, expectedLength: 0 }, // no action
        { seatToken: game.seats[0]!.seatToken, expectedLength: -1, action: 'x' },
      ]
      for (const body of cases) {
        expect((await handle(post(`/games/${game.gameId}/actions`, body), store)).status).toBe(400)
      }
    })
  })

  describe('cross-origin, because the client is served from elsewhere', () => {
    it('answers the preflight and allows the request', async () => {
      const store = makeStore()
      const pre = await handle(new Request(`${BASE}/games`, { method: 'OPTIONS' }), store)
      expect(pre.status).toBe(204)
      expect(pre.headers.get('access-control-allow-origin')).toBe('*')

      const { game } = await seeded()
      const res = await handle(get(`/games/${game.gameId}`), store)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })
  })

})
}
