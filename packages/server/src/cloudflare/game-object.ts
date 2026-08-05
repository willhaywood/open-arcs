/**
 * One Durable Object per game.
 *
 * This is the whole reason Cloudflare was chosen (docs/17 section 4a): a Durable Object is
 * single-threaded, so two players appending at once are serialised by the platform and the
 * compare-and-set costs nothing to implement.
 *
 * **It is still written as an explicit check** — rule 3. Single-threading is what makes it *free*
 * here, not what makes it *correct*. Postgres does the same job with
 * `WHERE array_length(journal, 1) = $expected` and a row-count test, and it can only do that if the
 * caller states the length it expects. Letting "the object is single-threaded" stand in for the
 * check would work perfectly until the day it had to be ported.
 *
 * ## Storage shape, and why entries are separate keys
 *
 * `meta` holds `{ options, seats }`; each journal entry is its own key, `j:` plus a zero-padded
 * index. One array under a single key would have been less code, but two things argue against it:
 * a DO storage value caps at 128 KiB and a long game's journal is not far off that, and **one entry
 * per key is one row per entry**, which is the shape Postgres wants. The lazier option would have
 * been portable in principle and awkward in practice.
 *
 * ## What is deliberately absent
 *
 * No alarms, no WebSocket hibernation, no transactional storage API — rule 5. Those are the parts
 * with no plain equivalent, and none of them is needed to append a string to a list.
 */

import type { AppendResult, GameTail, Seat } from '../store.js'
import type { DurableObjectState } from './types.js'

interface Meta {
  readonly options: unknown
  readonly seats: readonly Seat[]
}

/** Fixed width so `list({ start })` orders correctly as strings — 10^6 actions is far beyond a game. */
const key = (index: number): string => `j:${String(index).padStart(6, '0')}`

export class GameObject {
  private meta: Meta | undefined
  /** Entry count, cached so an append does not have to list storage to learn the length. */
  private length = 0
  private loaded = false

  constructor(private readonly state: DurableObjectState) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    await this.state.blockConcurrencyWhile(async () => {
      if (this.loaded) return
      this.meta = await this.state.storage.get<Meta>('meta')
      const entries = await this.state.storage.list<string>({ prefix: 'j:' })
      this.length = entries.size
      this.loaded = true
    })
  }

  /**
   * The object's private protocol. Not the public API — that is `api.ts`, which is the same on every
   * platform (rule 2). This exists only because a Worker reaches a Durable Object by `fetch`.
   */
  async fetch(request: Request): Promise<Response> {
    await this.load()
    const url = new URL(request.url)
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

    switch (url.pathname) {
      case '/create': {
        const body = (await request.json()) as Meta
        // Idempotent: re-creating an existing game must not wipe its journal.
        if (this.meta !== undefined) return json({ ok: false, reason: 'exists' }, 409)
        this.meta = { options: body.options, seats: body.seats }
        await this.state.storage.put('meta', this.meta)
        return json({ ok: true })
      }

      case '/read': {
        if (this.meta === undefined) return json(undefined, 404)
        const since = Math.max(0, Math.min(Number(url.searchParams.get('since') ?? 0), this.length))
        const found = await this.state.storage.list<string>({ prefix: 'j:', start: key(since) })
        const tail: GameTail = {
          options: this.meta.options,
          entries: [...found.values()],
          length: this.length,
        }
        return json(tail)
      }

      case '/append': {
        if (this.meta === undefined) return json({ ok: false, reason: 'no-such-game' }, 404)
        const body = (await request.json()) as {
          seatToken: string
          expectedLength: number
          action: string
        }
        if (!this.meta.seats.some((s) => s.seatToken === body.seatToken)) {
          return json({ ok: false, reason: 'bad-seat' }, 403)
        }
        // The compare-and-set. See the note at the top on why it is written out.
        if (body.expectedLength !== this.length) {
          const conflict: AppendResult = { ok: false, reason: 'conflict', length: this.length }
          return json(conflict, 409)
        }
        await this.state.storage.put(key(this.length), body.action)
        this.length += 1
        const ok: AppendResult = { ok: true, length: this.length }
        return json(ok)
      }

      default:
        return json({ error: 'not found' }, 404)
    }
  }
}
