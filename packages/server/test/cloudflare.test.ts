/**
 * The same contract, satisfied by the Durable Object adapter.
 *
 * **This is the test that makes docs/17's portability claim measurable.** `api.test.ts` runs the
 * suite against `MemoryStore`; this runs the identical suite against `DurableObjectStore` and
 * `GameObject` — the real adapter code, including its storage layout and its compare-and-set. One
 * specification, two implementations. A Postgres store would be the third, and would add one file
 * here rather than changing anything.
 *
 * ## Why a fake runtime rather than `wrangler dev` or `vitest-pool-workers`
 *
 * Those run the real `workerd`, and for the *adapter's own* concerns — bindings resolving,
 * migrations applying, hibernation actually evicting — they are the right tool, and the live checks
 * in `scripts/` cover those. They are the wrong tool for this file, for two reasons:
 *
 *   - `@cloudflare/vitest-pool-workers` pins to particular Vitest versions. This workspace is on
 *     2.1.9 and 850-odd other tests depend on that, so taking the pin here would put a platform tool
 *     in the path of the whole suite.
 *   - The claim under test is *portability*, and checking it inside Cloudflare's own runner would be
 *     a strange way to prove code is not Cloudflare-shaped.
 *
 * ## The fake runs real SQLite
 *
 * `node:sqlite` is built into Node 22, so `FakeStorage` is a thin wrapper over an actual database
 * rather than a simulation of one. That is a stronger test than the hand-rolled key-value fake it
 * replaced: the object's SQL is genuinely parsed and executed, so a typo or a wrong `ORDER BY` fails
 * here instead of in production.
 *
 * It is also the portability claim, made concrete. The same statements run unchanged on stock
 * SQLite and on the Durable Object, which is most of the distance to running them on Postgres.
 */

import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

import { GameObject } from '../src/cloudflare/game-object.js'
import { DurableObjectStore } from '../src/cloudflare/store.js'
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStorage,
  DurableObjectStub,
  SqlStorage,
  WebSocketLike,
} from '../src/cloudflare/types.js'
import { describeStoreContract } from './contract.js'

/*
 * `node:sqlite` reached through `createRequire` rather than imported.
 *
 * Vite strips the `node:` prefix from builtins it knows and hands the rest to Node; it does not yet
 * know this one, so a static import resolves to a bare `sqlite` package that does not exist. Going
 * through `createRequire` asks Node directly and never involves the bundler. Types come from
 * `node-sqlite.d.ts` beside this file.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')


/** Real SQLite, standing in for the object's embedded database. */
class FakeStorage implements DurableObjectStorage {
  private readonly db = new DatabaseSync(':memory:')

  readonly sql: SqlStorage = {
    exec: <T,>(query: string, ...bindings: unknown[]) => {
      const rows = this.db.prepare(query).all(...(bindings as never[])) as T[]
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`)
          return rows[0]!
        },
      }
    },
  }
}

class FakeState {
  readonly storage = new FakeStorage()
  /** Sockets the object has accepted. The contract suite opens none; the push tests do. */
  private readonly sockets: WebSocketLike[] = []

  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  acceptWebSocket(ws: WebSocketLike): void {
    this.sockets.push(ws)
  }

  getWebSockets(): readonly WebSocketLike[] {
    return this.sockets
  }
}

/**
 * Objects addressed by name, created on first touch — which is how the real namespace behaves and
 * is why `create` in the adapter can treat a fresh id as a fresh object.
 */
class FakeNamespace implements DurableObjectNamespace {
  private readonly objects = new Map<string, GameObject>()

  idFromName(name: string): DurableObjectId {
    return { toString: () => name }
  }

  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString()
    let object = this.objects.get(name)
    if (object === undefined) {
      object = new GameObject(new FakeState())
      this.objects.set(name, object)
    }
    const target = object
    return { fetch: (request: Request) => target.fetch(request) }
  }
}

describeStoreContract('DurableObjectStore', () => new DurableObjectStore(new FakeNamespace()))

/**
 * Storage-layout concerns, which belong to this adapter rather than to the shared contract.
 *
 * These were written against the key-value layout, where journal keys were `j:` plus a zero-padded
 * index and dropping the padding put `j:10` before `j:2` — every game shuffled from the tenth
 * action, and none of the contract's three-entry cases could see it. Found by mutation testing.
 *
 * **They are kept even though `idx INTEGER PRIMARY KEY` cannot fail that way.** Ordering is the
 * property that actually matters — replay of a shuffled journal is a different game — and it should
 * be pinned regardless of which storage shape is underneath. That the bug they were written for is
 * now unrepresentable is the argument for the change, not for deleting its regression test.
 */
describe('GameObject storage layout', () => {
  it('keeps journal order past ten entries', async () => {
    const store = new DurableObjectStore(new FakeNamespace())
    const created = await store.create({}, ['red'])
    const token = created.seats[0]!.seatToken

    const written: string[] = []
    for (let i = 0; i < 25; i++) {
      const action = `action-${i}`
      written.push(action)
      const res = await store.append(created.gameId, token, i, action)
      expect(res.ok, `append ${i}`).toBe(true)
    }

    const tail = await store.read(created.gameId, 0)
    // Order is the whole point: replay of a shuffled journal is a different game.
    expect(tail?.entries).toEqual(written)
    expect(tail?.length).toBe(25)
  })

  it('reads the correct tail from a mid-journal offset past ten', async () => {
    const store = new DurableObjectStore(new FakeNamespace())
    const created = await store.create({}, ['red'])
    const token = created.seats[0]!.seatToken
    for (let i = 0; i < 15; i++) await store.append(created.gameId, token, i, `a${i}`)

    const tail = await store.read(created.gameId, 12)
    expect(tail?.entries).toEqual(['a12', 'a13', 'a14'])
  })
})
