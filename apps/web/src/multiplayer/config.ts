/**
 * Where the multiplayer server lives.
 *
 * Set at build time by `VITE_MULTIPLAYER_URL`, and the distinction that matters is **unset versus
 * empty**, not empty versus filled:
 *
 *   - **unset** — multiplayer is off. The whole surface hides itself, hotseat carries on exactly as
 *     before, and nothing in the app has to know why. This is the GitHub Pages build: a static host
 *     with no server behind it. docs/17 section 7 is explicit that hotseat stays — it is how the
 *     rules are tested and the fastest way to try one.
 *   - **empty** — same origin. The API is served by the same Worker that served this page, so every
 *     request is a bare `/games/...` path. This is the Cloudflare build (docs/17 section 4c).
 *   - **an absolute URL** — a server on a different origin, which is the two-terminal dev loop.
 *
 * Same origin is worth the small amount of care in the encoding above, because it deletes a whole
 * category of problem rather than configuring around it: no CORS, no preflight on every append, no
 * origin baked into the bundle at build time, and no second hostname to get wrong. The API still
 * sends `access-control-allow-origin: *` so the cross-origin arrangement keeps working, but nothing
 * in production depends on it.
 *
 * Vite folds this to a literal, so an unset variable becomes `undefined` and an empty one becomes
 * `''` — the `typeof` check below survives that folding, a truthiness check would not.
 *
 * Locally, `npm run serve` builds the site and serves it *and* the API on 8787, which is the
 * same-origin arrangement end to end. For the faster loop — vite on 5173, Worker on 8787 — point a
 * dev build at the Worker instead:
 *
 *     VITE_MULTIPLAYER_URL=http://localhost:8787 npm run dev -w apps/web
 */

const configured = import.meta.env.VITE_MULTIPLAYER_URL

/**
 * The API base, or `null` when this build has no server.
 *
 * Never has a trailing slash, so `''` is the same-origin case and callers can concatenate a path
 * onto it without branching.
 */
export const MULTIPLAYER_URL: string | null =
  typeof configured === 'string' ? configured.replace(/\/+$/, '') : null

export const multiplayerEnabled = (): boolean => MULTIPLAYER_URL !== null
