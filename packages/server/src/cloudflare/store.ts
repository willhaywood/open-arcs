/**
 * `GameStore` over Durable Objects — the adapter, and the only place that knows what a stub is.
 *
 * Everything above this file (`api.ts`, `store.ts`) is platform-neutral by rule 4. This is the seam:
 * swap this class for a Postgres one and the endpoints, their tests and the client are untouched.
 */

import { randomId } from '../ids.js'
import type {
  AppendResult,
  CreatedGame,
  GameId,
  GameStore,
  GameTail,
  SeatToken,
} from '../store.js'
import type { DurableObjectNamespace } from './types.js'

export class DurableObjectStore implements GameStore {
  constructor(private readonly games: DurableObjectNamespace) {}

  /** A game id *is* the object's name, so no id mapping has to be stored anywhere. */
  private object(gameId: GameId) {
    return this.games.get(this.games.idFromName(gameId))
  }

  private static readonly BASE = 'https://do'

  async create(options: unknown, factions: readonly string[]): Promise<CreatedGame> {
    const gameId = randomId()
    const seats = factions.map((faction) => ({ faction, seatToken: randomId() }))
    const res = await this.object(gameId).fetch(
      new Request(`${DurableObjectStore.BASE}/create`, {
        method: 'POST',
        body: JSON.stringify({ options, seats }),
      }),
    )
    // A fresh UUID colliding with an existing object is not a case worth handling gracefully; it is
    // a case worth failing loudly, because it would mean the id source is broken.
    if (!res.ok) throw new Error(`game id collision for ${gameId}`)
    return { gameId, seats }
  }

  /**
   * Hand a WebSocket upgrade to the object that owns the game.
   *
   * **Not on `GameStore`.** That interface is the portable contract and returns data; this returns a
   * 101 carrying a Cloudflare `webSocket`, which is exactly the kind of platform shape rule 4 keeps
   * out of `api.ts`. It lives on the adapter, and a Node server would grow its own equivalent —
   * the client-facing URL is what stays the same, not this method.
   *
   * The upgrade has to reach the *object*: a Worker is stateless and per-request, so a socket it
   * accepted itself would have nothing behind it. The object is where the appends are serialised
   * and where the sockets can survive hibernation.
   */
  connect(gameId: GameId, request: Request): Promise<Response> {
    return this.object(gameId).fetch(
      new Request(`${DurableObjectStore.BASE}/connect`, { headers: request.headers }),
    )
  }

  async read(gameId: GameId, since: number, seatToken?: SeatToken): Promise<GameTail | undefined> {
    const res = await this.object(gameId).fetch(
      new Request(`${DurableObjectStore.BASE}/read?since=${since}`, {
        // Header rather than query string: the token is the credential, and query strings are what
        // ends up in logs. This hop is internal, but the habit is the point.
        ...(seatToken === undefined ? {} : { headers: { 'x-seat-token': seatToken } }),
      }),
    )
    if (res.status === 404) return undefined
    return (await res.json()) as GameTail
  }

  async append(
    gameId: GameId,
    seatToken: SeatToken,
    expectedLength: number,
    action: string,
  ): Promise<AppendResult> {
    const res = await this.object(gameId).fetch(
      new Request(`${DurableObjectStore.BASE}/append`, {
        method: 'POST',
        body: JSON.stringify({ seatToken, expectedLength, action }),
      }),
    )
    return (await res.json()) as AppendResult
  }

  /*
   * `subscribe` is intentionally **not implemented**. v1 polls (docs/17 section 4), and a Worker is
   * stateless and per-request so there is nowhere to keep a listener. The interface makes it
   * optional rather than letting this class return a no-op that satisfies the type and fails the
   * behaviour — the contract suite caught exactly that when it was written the other way.
   *
   * Push (section 8 step 2, the change that divides request count by ten) belongs inside
   * `GameObject`, which is stateful and already serialises every append. `OnAppend` carries a length
   * and never entries so that the same signature is satisfiable there and by Postgres
   * `LISTEN`/`NOTIFY`.
   */
}
