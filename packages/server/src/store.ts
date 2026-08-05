/**
 * The store: everything the multiplayer server needs to keep, as four methods.
 *
 * docs/17 section 4b is the contract this file exists to satisfy — Cloudflare Durable Objects for
 * v1, and a move to a small Node + Postgres box must stay a swap rather than a rewrite. That is a
 * property of how this is written, so two things are deliberately absent here:
 *
 *   - **No platform types.** Nothing in this file or in `api.ts` imports anything Cloudflare-shaped.
 *     A Durable Object is one implementation of `GameStore`; `MemoryStore` is another; Postgres
 *     would be a third. (Rule 4.)
 *   - **No engine types.** The server never runs the engine, so a journal entry is a string and
 *     `options` is opaque JSON it stores and hands back. That is what keeps the server a few hundred
 *     lines instead of a second copy of the rules — and it means the engine can change freely
 *     without redeploying the server.
 *
 * ## Why the journal is the only thing persisted
 *
 * Rule 1, and the one most likely to be broken by a well-meaning optimisation. A game *is* its
 * journal (docs/11): replaying `{ options, journal }` reproduces the state byte for byte. The moment
 * this stores something derived — a cached board, a materialised score, whose turn it is — that
 * derived thing has to be rebuilt identically by whatever runs next, and the pivot stops being a
 * swap. It is also unnecessary: replay is the design, and a 466-action game is 73 KB.
 *
 * ## Why `expectedLength` is a parameter rather than an assumption
 *
 * Rule 3. Durable Objects are single-threaded per object, so a compare-and-set is free there and it
 * is tempting to let "the object is single-threaded" *be* the concurrency control. Postgres has no
 * such property; it needs `WHERE array_length(journal, 1) = $expected` and a row-count check. Making
 * the caller state the length it expects is what lets both honour the same rule, and it is why a
 * double-tap or a stale tab is a no-op rather than a duplicated action.
 */

/** Which game. Unlisted rather than secret — anyone with it may watch. */
export type GameId = string

/** Which player. Secret: it is the only proof that a caller may act as its faction. */
export type SeatToken = string

/**
 * A seat handed out at creation.
 *
 * `faction` is a plain string here on purpose. The engine's `FactionId` is the authority on what
 * factions exist, and importing it would make the server depend on the rules it is meant not to
 * know.
 */
export interface Seat {
  readonly faction: string
  readonly seatToken: SeatToken
}

export interface CreatedGame {
  readonly gameId: GameId
  readonly seats: readonly Seat[]
}

/** What a reader gets back. `length` is the *full* journal length, not the length of `entries`. */
export interface GameTail {
  readonly options: unknown
  /** Journal entries from the requested offset onward. */
  readonly entries: readonly string[]
  /** Total entries in the game, so the caller knows what to pass as `expectedLength` next. */
  readonly length: number
}

/**
 * Why an append was refused, as data rather than an exception.
 *
 * `conflict` is the ordinary case, not an error: two clients raced, or a tab was stale, or someone
 * double-tapped. The caller re-reads the tail and carries on.
 */
export type AppendResult =
  | { readonly ok: true; readonly length: number }
  | { readonly ok: false; readonly reason: 'conflict'; readonly length: number }
  | { readonly ok: false; readonly reason: 'no-such-game' }
  | { readonly ok: false; readonly reason: 'bad-seat' }

/** Called when a game gains entries. The payload is deliberately tiny — see `subscribe`. */
export type OnAppend = (length: number) => void

export type Unsubscribe = () => void

export interface GameStore {
  /**
   * Mint a game and its seats. `options` is stored verbatim and never inspected.
   */
  create(options: unknown, factions: readonly string[]): Promise<CreatedGame>

  /**
   * The journal from `since` onward, or `undefined` if there is no such game.
   *
   * Polling calls this with the length it already has, so the usual response is empty. That is what
   * makes polling cheap in bandwidth even though it is expensive in requests (docs/17 section 4a).
   */
  read(gameId: GameId, since: number): Promise<GameTail | undefined>

  /**
   * Append one action, if `expectedLength` still matches. See the note above on why it is a
   * parameter.
   *
   * The seat is checked to belong to this game; **whose turn it is, is not checked**, because that
   * would require running the engine. docs/17 section 4 makes the case: turns are strictly
   * sequential, so a client cannot produce a legal action out of turn, and an illegal one fails on
   * every client's replay rather than corrupting the journal.
   */
  append(
    gameId: GameId,
    seatToken: SeatToken,
    expectedLength: number,
    action: string,
  ): Promise<AppendResult>

  /**
   * Watch a game for appends. Returns a function that stops watching.
   *
   * **Optional, and absent on the v1 Cloudflare path — deliberately.** docs/17 section 4 says v1
   * polls; push is step 2. A Worker is stateless and per-request, so there is nowhere to keep a
   * listener, and a `DurableObjectStore.subscribe` that silently returned a no-op would satisfy the
   * type while failing the behaviour. Optionality says which stores can push instead of pretending
   * they all can. `MemoryStore` implements it because local development benefits and it costs a Set.
   *
   * When push lands it belongs **inside the Durable Object**, which is stateful and already
   * serialises every append.
   *
   * **The callback carries a length, never the entries.** Two reasons, and the second is the one
   * that matters: it keeps the payload trivial, and it maps onto Postgres `LISTEN`/`NOTIFY`, whose
   * payload caps at 8000 bytes. A listener that received entries directly would work on Durable
   * Objects and then need redesigning on Postgres — precisely the coupling rule 5 exists to prevent.
   */
  subscribe?(gameId: GameId, onAppend: OnAppend): Unsubscribe
}
