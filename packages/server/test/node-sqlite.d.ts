/**
 * `node:sqlite`, declared rather than pulled in with `@types/node`.
 *
 * The package sets `"types": []` on purpose — docs/17 rule 4 made mechanical, so that a Node-only
 * or Workers-only API used outside an adapter is a compile error. Taking `@types/node` for one test
 * would open that door for every file. Two methods is the entire dependency, and writing them out
 * keeps it as visible as `cloudflare/types.ts` keeps the Cloudflare surface.
 *
 * Used by `cloudflare.test.ts` to give the fake Durable Object a real SQLite database, so the
 * object's SQL is genuinely executed rather than simulated.
 */
declare module 'node:module' {
  export function createRequire(path: string): (id: string) => unknown
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string)
    prepare(sql: string): { all(...params: unknown[]): unknown[] }
  }
}
