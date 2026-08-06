/**
 * The Cloudflare surface this adapter uses — written out rather than imported.
 *
 * `@cloudflare/workers-types` would do the same job. It is not used because **the value here is
 * knowing exactly how much platform we depend on**, and that turns out to be four interfaces and
 * six methods. docs/17 section 4b rule 5 says to avoid DO-only primitives; the cheapest way to keep
 * that honest is to make every one we *do* use appear in this file, where adding to it is a visible
 * act rather than an import that already covered it.
 *
 * It also keeps `@arcs/server` dependency-free, matching `@arcs/engine`.
 *
 * If this file grows past a screen, that is the signal to stop hand-writing it and take the
 * dependency — and also the signal that the pivot in rule 5 has got more expensive.
 */

export interface DurableObjectId {
  toString(): string
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>
}

export interface DurableObjectNamespace {
  /** Addressing by name is what lets a `gameId` string *be* the object's address. */
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

/** A cursor over `sql.exec`. Synchronous — the database is local to the object. */
export interface SqlStorageCursor<T> {
  toArray(): T[]
  one(): T
}

export interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>
}

/**
 * The SQL half of DO storage.
 *
 * **This was the key-value API, and the reason given for that was backwards.** It read:
 * *"Deliberately not the SQL API. Keys and values map onto a Postgres table without translation —
 * `j:000012` is a row."* The opposite is true, and the evidence is the padding in that very
 * example. `j:000012` is zero-padded only because KV keys sort lexicographically, and mutation
 * testing caught what happens without it: `j:10` sorts before `j:2` and every journal shuffles from
 * action ten. Porting that to Postgres means parsing an index back out of a padded string.
 *
 * An `idx INTEGER PRIMARY KEY` has no such failure mode and ports by *adding a column*. The four
 * statements this needs — create, insert, select-where-idx, count — are ordinary SQL that runs
 * unchanged on Postgres, so there is no second dialect either.
 *
 * The other thing it buys is legibility: KV writes land in the reserved `__cf_kv` table, which
 * Cloudflare excludes from the SQL API, so a deployed game could not be read at all. User tables
 * can.
 */
export interface DurableObjectStorage {
  readonly sql: SqlStorage
}

/** Only what the object does to a socket: it pushes, and it tidies up after one. */
export interface WebSocketLike {
  send(message: string): void
  close(code?: number, reason?: string): void
}

export interface DurableObjectState {
  readonly storage: DurableObjectStorage
  /**
   * Defers other requests until the promise settles. Used only to create the schema on first
   * touch — it is not the concurrency control. The compare-and-set is `expectedLength`, written
   * explicitly, per rule 3.
   */
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
  /**
   * Accept a socket **hibernatably**.
   *
   * The distinction that matters: `server.accept()` also works and pins the object in memory for
   * as long as the socket is open, which for a three-hour game costs more than the polling it
   * replaces. This one lets the object be evicted while clients stay connected. docs/17 section 4d.
   */
  acceptWebSocket(ws: WebSocketLike): void
  /** Every socket still attached, including across a hibernation cycle. */
  getWebSockets(): readonly WebSocketLike[]
}

/**
 * `new WebSocketPair()` — `[client, server]`. A global rather than an import, which is why it is
 * declared rather than exported.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface WebSocketPair {
    0: WebSocketLike
    1: WebSocketLike
  }
  var WebSocketPair: { new (): WebSocketPair }
}

/** `Response` gains a `webSocket` on the 101 that completes an upgrade. */
declare global {
  interface ResponseInit {
    webSocket?: WebSocketLike
  }
}

/** What `wrangler.toml` binds into the Worker. */
export interface Env {
  readonly GAMES: DurableObjectNamespace
}
