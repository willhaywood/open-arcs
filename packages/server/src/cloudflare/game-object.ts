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
 * ## Storage shape
 *
 * Three ordinary SQL tables, because they are three ordinary Postgres tables with a `game_id`
 * column added. This replaced a key-value layout whose journal keys were `j:` plus a zero-padded
 * index; `types.ts` has the full argument for why that was the harder thing to port, not the
 * easier one, and why it could not be read from the dashboard at all.
 *
 * Nothing is cached in memory. `sql.exec` is synchronous against a database local to the object, so
 * the `loaded`/`length`/`meta` fields the KV version needed are gone — and with them the class of
 * bug where a cached count and the stored rows disagree. That matters more than it looks now that
 * the object **hibernates**: an evicted object re-runs its constructor with empty fields, so any
 * state not in the database is state that quietly resets mid-game.
 *
 * ## What is deliberately absent
 *
 * No alarms and no transactional storage API — rule 5. WebSocket hibernation *is* now used, which
 * that rule named as a decision to take deliberately rather than discover; docs/17 section 4d is
 * where it was taken and why.
 */

import { actorOf } from '../actor.js'
import type { AppendResult, GameTail, Seat } from '../store.js'
import type { DurableObjectState, SqlStorage, WebSocketLike } from './types.js'

/** What a client is told when the journal grows. See `session.ts` for the receiving half. */
interface Push {
  readonly from: number
  readonly entries: readonly string[]
}

export class GameObject {
  constructor(private readonly state: DurableObjectState) {
    /*
     * Schema only, and only here. `blockConcurrencyWhile` defers other requests until this settles,
     * which is what makes it safe to assume the tables exist everywhere below — and it is the one
     * use the DO guidance endorses. It is emphatically not the concurrency control; that is
     * `expectedLength`.
     */
    void state.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS game (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        options TEXT NOT NULL
      )`)
      this.sql.exec(`CREATE TABLE IF NOT EXISTS seat (
        ord INTEGER PRIMARY KEY,
        faction TEXT NOT NULL,
        token TEXT NOT NULL
      )`)
      this.sql.exec(`CREATE TABLE IF NOT EXISTS journal (
        idx INTEGER PRIMARY KEY,
        action TEXT NOT NULL
      )`)
    })
  }

  private get sql(): SqlStorage {
    return this.state.storage.sql
  }

  /** `undefined` until `/create` has run — which is how "no such game" is answered. */
  private options(): unknown | undefined {
    const row = this.sql.exec<{ options: string }>('SELECT options FROM game WHERE id = 1').toArray()[0]
    return row === undefined ? undefined : (JSON.parse(row.options) as unknown)
  }

  /** Seats in the order they were dealt, which `ord` exists to preserve. */
  private seats(): Seat[] {
    return this.sql
      .exec<{ faction: string; token: string }>('SELECT faction, token FROM seat ORDER BY ord')
      .toArray()
      .map((r) => ({ faction: r.faction, seatToken: r.token }))
  }

  private length(): number {
    return this.sql.exec<{ n: number }>('SELECT count(*) AS n FROM journal').one().n
  }

  /**
   * Tell every connected client what was just appended.
   *
   * Outgoing messages are not billed, which is the whole reason this is cheaper than being polled:
   * one player acts, everyone else is told, and only the act cost a request. Sends are wrapped
   * because a socket can be dead without having fired `webSocketClose` yet, and one broken client
   * must not fail the append that has already been committed.
   */
  private broadcast(push: Push): void {
    const payload = JSON.stringify(push)
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        /* a client that has gone away is not this request's problem */
      }
    }
  }

  /**
   * The object's private protocol. Not the public API — that is `api.ts`, which is the same on every
   * platform (rule 2). This exists only because a Worker reaches a Durable Object by `fetch`.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

    switch (url.pathname) {
      case '/create': {
        const body = (await request.json()) as { options: unknown; seats: readonly Seat[] }
        // Idempotent: re-creating an existing game must not wipe its journal.
        if (this.options() !== undefined) return json({ ok: false, reason: 'exists' }, 409)
        this.sql.exec('INSERT INTO game (id, options) VALUES (1, ?)', JSON.stringify(body.options))
        body.seats.forEach((s, i) => {
          this.sql.exec('INSERT INTO seat (ord, faction, token) VALUES (?, ?, ?)', i, s.faction, s.seatToken)
        })
        return json({ ok: true })
      }

      /*
       * The live socket. Push, never pull: the client sends nothing, so there is no
       * `webSocketMessage` handler and no per-connection state to serialise across hibernation.
       *
       * `acceptWebSocket` and **not** `server.accept()`. That single choice is what lets the object
       * be evicted while the connections stay open — "Billable Duration (GB-s) charges do not
       * accrue during hibernation". With the standard API the object is held in memory for the
       * length of the game, which costs more than the polling this replaces. See docs/17 4d.
       */
      case '/connect': {
        if (this.options() === undefined) return json({ error: 'no such game' }, 404)
        if (request.headers.get('upgrade') !== 'websocket') {
          return json({ error: 'expected a websocket upgrade' }, 426)
        }
        const pair = new WebSocketPair()
        this.state.acceptWebSocket(pair[1])
        return new Response(null, { status: 101, webSocket: pair[0] })
      }

      case '/read': {
        const options = this.options()
        if (options === undefined) return json(undefined, 404)
        const length = this.length()
        const since = Math.max(0, Math.min(Number(url.searchParams.get('since') ?? 0), length))
        const entries = this.sql
          .exec<{ action: string }>('SELECT action FROM journal WHERE idx >= ? ORDER BY idx', since)
          .toArray()
          .map((r) => r.action)
        /*
         * The token rides in a header rather than the query string. It is the credential, and a
         * query string is the one part of a URL that ends up in access logs and referrers by
         * default. Same reason the client sends it that way — see `client.ts`.
         */
        const presented = request.headers.get('x-seat-token')
        const seat = this.seats().find((s) => s.seatToken === presented)
        const tail: GameTail = {
          options,
          entries,
          length,
          ...(seat === undefined ? {} : { yourFaction: seat.faction }),
        }
        return json(tail)
      }

      case '/append': {
        if (this.options() === undefined) return json({ ok: false, reason: 'no-such-game' }, 404)
        const body = (await request.json()) as {
          seatToken: string
          expectedLength: number
          action: string
        }
        const seat = this.seats().find((s) => s.seatToken === body.seatToken)
        if (seat === undefined) return json({ ok: false, reason: 'bad-seat' }, 403)
        // An identity check, not a rules check — see `actorOf`. Silent on actions with no actor.
        const actor = actorOf(body.action)
        if (actor !== undefined && actor !== seat.faction) {
          return json({ ok: false, reason: 'wrong-faction' }, 403)
        }
        // The compare-and-set. See the note at the top on why it is written out.
        const length = this.length()
        if (body.expectedLength !== length) {
          const conflict: AppendResult = { ok: false, reason: 'conflict', length }
          return json(conflict, 409)
        }
        this.sql.exec('INSERT INTO journal (idx, action) VALUES (?, ?)', length, body.action)
        // After the write, so a client told of an entry can always read it back.
        this.broadcast({ from: length, entries: [body.action] })
        const ok: AppendResult = { ok: true, length: length + 1 }
        return json(ok)
      }

      default:
        return json({ error: 'not found' }, 404)
    }
  }

  /**
   * A socket closing. Nothing to clean up — the object holds no per-connection state — but the
   * handler has to exist for the runtime to deliver the close rather than treating it as an error.
   */
  webSocketClose(ws: WebSocketLike, code: number, reason: string, wasClean: boolean): void {
    void code
    void reason
    void wasClean
    try {
      ws.close()
    } catch {
      /* already gone */
    }
  }
}
