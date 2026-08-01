/**
 * Build a URL for a file in `public/`, honouring the deployment's base path.
 *
 * **Vite rewrites asset URLs in CSS and in imports; it cannot rewrite a string built at runtime.**
 * So `url('/game-assets/x.webp')` in a stylesheet is corrected at build time, while
 * `` `/game-assets/court/${id}.webp` `` in a component is emitted exactly as written and resolves
 * against the domain root.
 *
 * That difference is invisible in development, where the base path *is* `/` — and it is why the
 * first GitHub Pages deploy served a correct background over an app whose every card, figure, die
 * and setup image 404'd. The site is served from `/open-arcs/`, and only the CSS knew.
 *
 * `import.meta.env.BASE_URL` is whatever the build was configured with, so this is correct in dev,
 * on a project site, and on a host serving from the root.
 */
export function asset(path: string): string {
  // BASE_URL always ends in a slash, so the leading one here would double it.
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
