/**
 * A `GameStore` that keeps everything in memory.
 *
 * Two jobs, and neither is production: it is what the endpoint tests run against, and it is what
 * `npm run serve` uses for local development so a second player can be tried without a Cloudflare
 * account.
 *
 * It is also the cheapest possible check on docs/17 rule 4. If `api.ts` ever reaches for something
 * only a Durable Object has, the tests here stop compiling — which is a better alarm than noticing
 * during a migration.
 */

import { randomId } from './ids.js'
import type {
  AppendResult,
  CreatedGame,
  GameId,
  GameStore,
  GameTail,
  OnAppend,
  Seat,
  SeatToken,
  Unsubscribe,
} from './store.js'

interface Game {
  readonly options: unknown
  readonly seats: readonly Seat[]
  readonly journal: string[]
  readonly watchers: Set<OnAppend>
}

export class MemoryStore implements GameStore {
  private readonly games = new Map<GameId, Game>()

  async create(options: unknown, factions: readonly string[]): Promise<CreatedGame> {
    const gameId = randomId()
    const seats = factions.map((faction) => ({ faction, seatToken: randomId() }))
    this.games.set(gameId, { options, seats, journal: [], watchers: new Set() })
    return { gameId, seats }
  }

  async read(gameId: GameId, since: number): Promise<GameTail | undefined> {
    const game = this.games.get(gameId)
    if (game === undefined) return undefined
    // A negative or oversized `since` is a caller bug, not a reason to fail: clamp and answer.
    const from = Math.max(0, Math.min(since, game.journal.length))
    return { options: game.options, entries: game.journal.slice(from), length: game.journal.length }
  }

  async append(
    gameId: GameId,
    seatToken: SeatToken,
    expectedLength: number,
    action: string,
  ): Promise<AppendResult> {
    const game = this.games.get(gameId)
    if (game === undefined) return { ok: false, reason: 'no-such-game' }
    if (!game.seats.some((s) => s.seatToken === seatToken)) {
      return { ok: false, reason: 'bad-seat' }
    }
    /*
     * The compare-and-set. Free here because JavaScript is single-threaded, exactly as it is free on
     * a Durable Object — which is why it is written out rather than assumed. On Postgres this same
     * line is a `WHERE array_length(journal, 1) = $expected` and a row-count check.
     */
    if (expectedLength !== game.journal.length) {
      return { ok: false, reason: 'conflict', length: game.journal.length }
    }
    game.journal.push(action)
    const length = game.journal.length
    // Notified after the append, so a watcher that immediately reads sees the entry it was told of.
    for (const watcher of game.watchers) watcher(length)
    return { ok: true, length }
  }

  subscribe(gameId: GameId, onAppend: OnAppend): Unsubscribe {
    const game = this.games.get(gameId)
    if (game === undefined) return () => {}
    game.watchers.add(onAppend)
    return () => game.watchers.delete(onAppend)
  }
}
