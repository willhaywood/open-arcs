/**
 * The link *is* the credential — docs/17 section 3.
 *
 * No accounts, no login, no email. At creation the server mints one game and N seats, and each
 * player gets their own URL:
 *
 *   https://arcs.example/#/g/3f2a…/s/9c81…      <- red's link
 *   https://arcs.example/#/g/3f2a…              <- a spectator: game, no seat
 *
 * Everything lives in the hash so this works on a static host with no server-side routing, which is
 * what GitHub Pages and Cloudflare Pages both are.
 *
 * **Losing the link is the failure mode**, so `remember` stashes it under the game id on first
 * visit. Keyed by game rather than a single "current" slot, because a player may reasonably have
 * two games open — overwriting one with the other is precisely the way to lose a seat.
 */

export interface GameLink {
  readonly gameId: string
  /** Absent for a spectator, who may watch and may not act. */
  readonly seatToken?: string
}

const KEY = (gameId: string): string => `arcs:seat:${gameId}`

/** Parse `#/g/<gameId>[/s/<seatToken>]`, or `undefined` for an ordinary local game. */
export function parseLink(hash: string): GameLink | undefined {
  const withSeat = /^#\/g\/([^/]+)\/s\/([^/]+)\/?$/.exec(hash)
  if (withSeat !== null) {
    return { gameId: decodeURIComponent(withSeat[1]!), seatToken: decodeURIComponent(withSeat[2]!) }
  }
  const spectator = /^#\/g\/([^/]+)\/?$/.exec(hash)
  if (spectator !== null) return { gameId: decodeURIComponent(spectator[1]!) }
  return undefined
}

export function linkFor(origin: string, gameId: string, seatToken?: string): string {
  const seat = seatToken === undefined ? '' : `/s/${encodeURIComponent(seatToken)}`
  return `${origin}/#/g/${encodeURIComponent(gameId)}${seat}`
}

/**
 * Remember a seat token, so a reload does not cost the player their turn.
 *
 * Storage failures are swallowed: private browsing and a full quota both throw, and neither is a
 * reason to fail a game that is otherwise working. The link in the address bar remains the source
 * of truth; this is a convenience over it, not a replacement for it.
 */
export function remember(link: GameLink): void {
  if (link.seatToken === undefined) return
  try {
    localStorage.setItem(KEY(link.gameId), link.seatToken)
  } catch {
    /* no storage, no problem — the URL still has it */
  }
}

/** A previously stashed seat for this game, if the URL has lost it. */
export function recall(gameId: string): string | undefined {
  try {
    return localStorage.getItem(KEY(gameId)) ?? undefined
  } catch {
    return undefined
  }
}
