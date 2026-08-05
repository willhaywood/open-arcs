/**
 * The contract, satisfied by the in-memory store — plus the one thing that is *not* in the shared
 * contract.
 *
 * The same suite runs against the Durable Object adapter in `cloudflare.test.ts`. Two
 * implementations passing one specification is what makes docs/17's "swap, not rewrite" a measured
 * claim rather than an intention.
 *
 * `subscribe` is tested only here, because it is optional and the v1 Cloudflare path does not
 * implement it: a Worker is stateless, so there is nowhere to keep a listener, and push is step 2
 * (docs/17 section 8). Writing it into the shared contract was the first attempt, and running that
 * against the adapter is what surfaced the mismatch — which is the argument for having two
 * implementations under one suite at all.
 */

import { describe, expect, it } from 'vitest'

import { MemoryStore, handle } from '../src/index.js'
import type { CreatedGame } from '../src/index.js'
import { describeStoreContract } from './contract.js'

describeStoreContract('MemoryStore', () => new MemoryStore())

const BASE = 'https://arcs.test'
const post = (path: string, body: unknown): Request =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function seeded(): Promise<{ store: MemoryStore; game: CreatedGame }> {
  const store = new MemoryStore()
  const res = await handle(
    post('/games', { options: {}, factions: ['red', 'yellow', 'blue'] }),
    store,
  )
  return { store, game: (await res.json()) as CreatedGame }
}

describe('subscribe', () => {
  it('reports the new length, never the entries', async () => {
    /*
     * Rule 5 in miniature. The callback carries a length because that is what Postgres
     * `LISTEN`/`NOTIFY` can carry — its payload caps at 8000 bytes. A subscription that delivered
     * entries would work on Durable Objects and need redesigning on Postgres.
     */
    const { store, game } = await seeded()
    const seen: number[] = []
    const stop = store.subscribe(game.gameId, (length) => seen.push(length))

    await handle(
      post(`/games/${game.gameId}/actions`, {
        seatToken: game.seats[0]!.seatToken,
        expectedLength: 0,
        action: 'x',
      }),
      store,
    )
    expect(seen).toEqual([1])

    stop()
    await handle(
      post(`/games/${game.gameId}/actions`, {
        seatToken: game.seats[0]!.seatToken,
        expectedLength: 1,
        action: 'y',
      }),
      store,
    )
    expect(seen).toEqual([1])
  })
})
