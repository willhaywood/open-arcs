/**
 * Who owns what, on the one screen everybody sees before they play.
 *
 * `THIRD-PARTY-NOTICES.md` has said since it was written that this is an unofficial fan
 * implementation, not affiliated with or endorsed by the publisher — but it said it in a file in a
 * repository, which is not where a person arriving from a shared link is looking. Now that the game
 * is deployed and the link is passed around, the disclaimer belongs on the page.
 *
 * The line is short on purpose and the detail is one click away. Two links, because they answer two
 * different questions:
 *
 *   - **Notices & credits** — what is *not* covered by this repository's MIT licence. Arcs, its
 *     artwork, its card text and its name belong to Buried Giant Studios, and the notices file is
 *     explicit that including the artwork is a posture rather than a permission, with a standing
 *     offer to the rights holder.
 *   - **Source on GitHub** — the code, which *is* MIT, and the place to raise anything about the
 *     above.
 *
 * ## Brand
 *
 * Deliberately the quietest thing on the screen (docs/10 section 2ab): body sans rather than the
 * display face, `--muted`, and sized below the load row it sits under. It is a footnote and should
 * read as one — the wordmark and the setup cards are what the screen is for.
 *
 * Gold on hover rather than `--accent`, following `.newgame-load .ghost` immediately above it.
 * docs/10 reserves the blue for what is live in the game itself.
 */

const REPO = 'https://github.com/willhaywood/open-arcs'
const NOTICES = `${REPO}/blob/main/THIRD-PARTY-NOTICES.md`

/**
 * GitHub's own mark, inline.
 *
 * Inline SVG rather than a shields.io badge or a remote PNG, for three reasons: it costs no network
 * request on a screen that already loads the banner and four card faces; it leaks no referrer to a
 * third party just for rendering a footer; and `currentColor` means it inherits the muted-to-gold
 * hover with the text instead of needing a second asset for the hover state.
 *
 * `aria-hidden`, because the link's own text already says "Source on GitHub" — announcing the mark
 * as well would read the destination twice.
 */
function GitHubMark(): JSX.Element {
  return (
    <svg
      className="ng-gh-mark"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

export function Attribution(): JSX.Element {
  return (
    <footer className="ng-attrib">
      <p className="ng-attrib-note">
        An unofficial fan implementation. Not affiliated with, endorsed by, or sponsored by the
        publisher or designers of Arcs.
      </p>
      <p className="ng-attrib-links">
        {/*
          * `noreferrer` as well as `noopener`: these leave the site, and there is no reason to tell
          * GitHub which page someone came from.
          */}
        <a href={NOTICES} target="_blank" rel="noreferrer noopener">
          Notices &amp; credits
        </a>
        <span className="ng-attrib-sep" aria-hidden="true">
          ·
        </span>
        <a href={REPO} target="_blank" rel="noreferrer noopener">
          <GitHubMark />
          Source on GitHub
        </a>
      </p>
    </footer>
  )
}
