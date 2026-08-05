/**
 * Where the multiplayer server lives.
 *
 * Set at build time by `VITE_MULTIPLAYER_URL`, because the client and the API are on different
 * origins by design — the game is a static site (GitHub Pages today, Cloudflare Pages eventually)
 * and the server is a Worker. That is also why the API sends `access-control-allow-origin: *`.
 *
 * **Absent means multiplayer is off**, and that is the default rather than a failure. The whole
 * multiplayer surface hides itself, hotseat carries on exactly as before, and nothing in the app
 * has to know why. docs/17 section 7 is explicit that hotseat stays: it is how the rules are tested
 * and the fastest way to try one.
 *
 * Locally, `npm run serve` puts the Worker on 8787, so a dev build wanting multiplayer is:
 *
 *     VITE_MULTIPLAYER_URL=http://localhost:8787 npm run dev -w apps/web
 */

const configured = import.meta.env.VITE_MULTIPLAYER_URL

/** The API base, with no trailing slash, or `null` when this build has no server. */
export const MULTIPLAYER_URL: string | null =
  typeof configured === 'string' && configured.length > 0 ? configured.replace(/\/+$/, '') : null

export const multiplayerEnabled = (): boolean => MULTIPLAYER_URL !== null
