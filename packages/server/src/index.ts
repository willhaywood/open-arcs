/**
 * The multiplayer server: three endpoints over a four-method store.
 *
 * docs/17 section 4 for the design, 4b for the portability contract this package is shaped by.
 * Nothing here imports `@arcs/engine` — the server stores strings and never runs the rules.
 */

export { handle } from './api.js'
export { MemoryStore } from './memory.js'
export { randomId } from './ids.js'
export type {
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
