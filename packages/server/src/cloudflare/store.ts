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

  async read(gameId: GameId, since: number): Promise<GameTail | undefined> {
    const res = await this.object(gameId).fetch(
      new Request(`${DurableObjectStore.BASE}/read?since=${since}`),
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
