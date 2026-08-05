/**
 * Ids for games and seats.
 *
 * `crypto.randomUUID` rather than anything hand-rolled, because a seat token **is** the credential —
 * docs/17 section 3: no accounts, no login, the link is the proof. A guessable token is a way to
 * play someone else's turn.
 *
 * `crypto` is a web standard available in Workers, in Node 19+ and in browsers, so this file needs
 * no platform types and stays inside rule 4.
 */

export function randomId(): string {
  return crypto.randomUUID()
}
