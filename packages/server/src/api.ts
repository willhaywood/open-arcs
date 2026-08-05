/**
 * The three endpoints, as one handler over a `GameStore`.
 *
 *   POST /games                  -> { gameId, seats: [{ faction, seatToken }] }
 *   GET  /games/:id?since=N      -> { options, entries, length }
 *   POST /games/:id/actions      -> { ok, length }        body: { seatToken, expectedLength, action }
 *
 * docs/17 section 4 is the specification and section 4b rule 2 is why this file is the contract:
 * **both platforms serve exactly these routes with exactly these semantics, so the client cannot
 * tell what is behind it** and is never part of a migration.
 *
 * ## Why `Request`/`Response` and not a framework
 *
 * They are web standards, present in Workers, in Node 18+ and in browsers. Writing the handler
 * against them means the Cloudflare adapter is `fetch(req) { return handle(req, store) }` and the
 * Node adapter is the same call behind `createServer`. A framework would put its own types in this
 * file and make that no longer true.
 *
 * ## What this deliberately does not do
 *
 * It never runs the engine, so it cannot and does not check **whose turn it is**. Turns are strictly
 * sequential, so a client cannot produce a legal action out of turn; an illegal one fails on every
 * client's replay rather than corrupting anything. Keeping the rules out of here is what makes the
 * server portable and small, and it means the engine can change without redeploying it.
 */

import type { GameStore } from './store.js'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      /*
       * Production is same-origin — one Worker serves the client and these routes (docs/17 section
       * 4c) — so nothing deployed needs this header. It stays for the arrangements that do: the
       * two-terminal dev loop (vite on 5173, this on 8787), and any host that serves `dist`
       * separately from the API, which rule 2 says must keep working.
       *
       * Wide open is right for v1: every endpoint is already capability-secured by an unguessable
       * id, so an origin check would add no security while breaking both of those.
       */
      'access-control-allow-origin': '*',
    },
  })

const bad = (status: number, error: string): Response => json({ error }, status)

/** Body of `POST /games`. `options` is opaque — the server stores it and never reads it. */
interface CreateBody {
  options?: unknown
  factions?: unknown
}

/** Body of `POST /games/:id/actions`. */
interface AppendBody {
  seatToken?: unknown
  expectedLength?: unknown
  action?: unknown
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

export async function handle(request: Request, store: GameStore): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')

  // Preflight. Browsers send this before any POST carrying a JSON content-type.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    })
  }

  // --- POST /games ---------------------------------------------------------
  if (path === '/games' && request.method === 'POST') {
    let body: CreateBody
    try {
      body = (await request.json()) as CreateBody
    } catch {
      return bad(400, 'body must be JSON')
    }
    if (!isStringArray(body.factions) || body.factions.length === 0) {
      return bad(400, 'factions must be a non-empty array of strings')
    }
    if (body.options === undefined) return bad(400, 'options is required')
    const created = await store.create(body.options, body.factions)
    return json(created, 201)
  }

  const game = /^\/games\/([^/]+)$/.exec(path)
  const actions = /^\/games\/([^/]+)\/actions$/.exec(path)

  // --- GET /games/:id?since=N ---------------------------------------------
  if (game !== null && request.method === 'GET') {
    const sinceRaw = url.searchParams.get('since')
    const since = sinceRaw === null ? 0 : Number(sinceRaw)
    if (!Number.isInteger(since) || since < 0) return bad(400, 'since must be a non-negative integer')
    const tail = await store.read(decodeURIComponent(game[1]!), since)
    if (tail === undefined) return bad(404, 'no such game')
    return json(tail)
  }

  // --- POST /games/:id/actions --------------------------------------------
  if (actions !== null && request.method === 'POST') {
    let body: AppendBody
    try {
      body = (await request.json()) as AppendBody
    } catch {
      return bad(400, 'body must be JSON')
    }
    if (typeof body.seatToken !== 'string') return bad(400, 'seatToken is required')
    if (typeof body.action !== 'string') return bad(400, 'action is required')
    if (!Number.isInteger(body.expectedLength) || (body.expectedLength as number) < 0) {
      return bad(400, 'expectedLength must be a non-negative integer')
    }

    const result = await store.append(
      decodeURIComponent(actions[1]!),
      body.seatToken,
      body.expectedLength as number,
      body.action,
    )

    if (result.ok) return json(result)
    if (result.reason === 'no-such-game') return bad(404, 'no such game')
    if (result.reason === 'bad-seat') return bad(403, 'seat token does not belong to this game')
    /*
     * 409 rather than an error, and the current length comes back with it. A conflict is the
     * ordinary outcome of two clients racing or a stale tab retrying — the caller re-reads from
     * `length` and carries on, which is exactly what makes a double-tap a no-op.
     */
    return json({ error: 'conflict', length: result.length }, 409)
  }

  return bad(404, 'not found')
}
