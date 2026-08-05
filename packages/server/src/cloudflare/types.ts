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

/**
 * The key-value half of DO storage.
 *
 * Deliberately not the SQL API. Keys and values map onto a Postgres table without translation —
 * `j:000012` is a row — where SQL against a DO's embedded SQLite would be a second dialect to port.
 */
export interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
  list<T>(options?: { prefix?: string; start?: string; limit?: number }): Promise<Map<string, T>>
}

export interface DurableObjectState {
  readonly storage: DurableObjectStorage
  /**
   * Defers other requests until the promise settles. Used only to load state on first touch, which
   * every store has to do somehow — it is not the concurrency control. The compare-and-set is
   * `expectedLength`, written explicitly, per rule 3.
   */
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>
}

/** What `wrangler.toml` binds into the Worker. */
export interface Env {
  readonly GAMES: DurableObjectNamespace
}
