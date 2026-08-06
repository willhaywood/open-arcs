/**
 * The Worker entry point.
 *
 * `handle` is the same function the contract tests exercise against `MemoryStore` and the same one
 * that ran under `node:http`. Choosing which `GameStore` is behind it is all this file did, which is
 * exactly what rule 2 asks of a platform adapter: the client cannot tell it is here.
 *
 * One route now goes around it. A WebSocket upgrade cannot: completing one means returning a `101`
 * whose body is a Cloudflare `webSocket`, and `api.ts` is written against web standards that have no
 * such thing (rule 4). So the upgrade is forwarded straight to the Durable Object, and `handle`
 * stays platform-neutral and still serves the three endpoints that *are* the portable contract.
 *
 * That split is deliberate rather than a workaround. The **client-facing** protocol — a socket at
 * `/games/:id/live` that pushes journal entries — is portable, and a Node server would serve it with
 * `ws` and `LISTEN`/`NOTIFY`. What is not portable is how a socket is accepted here, which is why
 * that part sits in the adapter with the rest of the Cloudflare-shaped code.
 */

import { handle } from '../api.js'
import { DurableObjectStore } from './store.js'
import type { Env } from './types.js'

export { GameObject } from './game-object.js'

/** `/games/:id/live` — the only route that does not go through `handle`. */
const LIVE = /^\/games\/([^/]+)\/live$/

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const store = new DurableObjectStore(env.GAMES)
    const path = new URL(request.url).pathname.replace(/\/+$/, '')
    const live = LIVE.exec(path)
    /*
     * The upgrade header is part of the match, so a plain GET to this path falls through to
     * `handle` and 404s like any other unknown route — rather than half-answering with an object
     * protocol error.
     */
    if (live !== null && request.headers.get('upgrade') === 'websocket') {
      return store.connect(decodeURIComponent(live[1]!), request)
    }
    return handle(request, store)
  },
}
