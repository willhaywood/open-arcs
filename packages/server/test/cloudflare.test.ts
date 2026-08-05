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
 * migrations applying, storage surviving eviction — they are the right tool and worth adding later.
 * They are the wrong tool for this file, for two reasons:
 *
 *   - `@cloudflare/vitest-pool-workers` pins to particular Vitest versions. This workspace is on
 *     2.1.9 and 791 other tests depend on that, so taking the pin here would put a platform tool in
 *     the path of the whole suite.
 *   - The claim under test is *portability*, and checking it inside Cloudflare's own runner would be
 *     a strange way to prove code is not Cloudflare-shaped.
 *
 * The fake below implements exactly the surface `types.ts` declares — four interfaces, six methods.
 * That it is this small is itself the result worth having.
 */

import { describe, expect, it } from 'vitest'

import { GameObject } from '../src/cloudflare/game-object.js'
import { DurableObjectStore } from '../src/cloudflare/store.js'
import type {
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStorage,
  DurableObjectStub,
} from '../src/cloudflare/types.js'
import { describeStoreContract } from './contract.js'

/** Key-value storage with the ordering `list({ prefix, start })` relies on. */
class FakeStorage implements DurableObjectStorage {
  private readonly map = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined
  }

  async put<T>(key: string, value: T): Promise<void> {
    // Structured-cloned in the real thing; JSON round-trip is close enough and catches accidental
    // reliance on object identity across a storage boundary.
    this.map.set(key, JSON.parse(JSON.stringify(value)) as unknown)
  }

  async list<T>(options?: { prefix?: string; start?: string; limit?: number }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? ''
    const start = options?.start
    const keys = [...this.map.keys()]
      .filter((k) => k.startsWith(prefix) && (start === undefined || k >= start))
      .sort()
    const out = new Map<string, T>()
    for (const k of options?.limit === undefined ? keys : keys.slice(0, options.limit)) {
      out.set(k, this.map.get(k) as T)
    }
    return out
  }
}

class FakeState {
  readonly storage = new FakeStorage()
  async blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
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
 * The contract appends three entries, so it cannot see the bug below: without zero-padding, `j:10`
 * sorts before `j:2` and the journal comes back shuffled from the tenth action onward. A real game
 * is 466 actions, so every game would have hit it and none of the twelve contract cases would have
 * noticed. Found by mutation testing, which is the argument for doing it.
 */
describe('GameObject storage layout', () => {
  it('keeps journal order past ten entries, where naive keys would sort wrong', async () => {
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
