/**
 * The Worker entry point — nine lines of substance, which is the point.
 *
 * `handle` is the same function the contract tests exercise against `MemoryStore` and the same one
 * that ran under `node:http`. All this file does is choose which `GameStore` is behind it, which is
 * exactly what rule 2 asks of a platform adapter: the client cannot tell it is here.
 */

import { handle } from '../api.js'
import { DurableObjectStore } from './store.js'
import type { Env } from './types.js'

export { GameObject } from './game-object.js'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, new DurableObjectStore(env.GAMES))
  },
}
