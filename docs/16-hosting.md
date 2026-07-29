# Arcs Digital — Hosting

## 1. The short version

A **static single-page app**: no backend, no database, no API keys, no server-side state. Any
static host serves it, and the free tier of any of them is enough.

The artwork ships with it. There is precedent — the Arcs Tabletop Simulator mod hosts the same art
with the creators' approval, and this is the same kind of project. So the decision is an ordinary
technical one: how much to upload, how it caches, and what you want the URL to be.

**The one number that matters:** the full art library is 72 MB, but the base game only needs about
**16 MB** of it, and a whole play session only *transfers* about **4 MB**. Section 3 is about not
uploading the other 56 MB for no reason.

## 2. What has to be served

| | |
| --- | --- |
| Shape | Static SPA — `index.html`, one JS bundle, one CSS file |
| Backend | **None.** `apps/` contains only `web` |
| Network calls | **None.** No `fetch`, no env vars, no auth |
| Persistence | Save = a JSON blob the browser downloads; Load = a file input |
| Multiplayer | Hotseat only — every player shares one browser |
| Code | 323 KB JS + 55 KB CSS |
| Fonts | 940 KB (FM Bolyar Pro, 10 files) |
| Artwork | 72 MB across 918 files as built today; **~16 MB** is base-game |

The engine is a pure `(state, action) => result` library with 554 tests and no I/O, so it puts no
constraint on hosting either. This stays true through the roadmap: the AI (docs/03) runs in the
browser and 2-player changes rules, not architecture. Only *online* multiplayer would need a
server — see section 7.

## 3. Trim the build before you deploy it

`npm run -w apps/web build` dereferences the `public/game-assets` symlink and copies **everything**
into `dist/`, giving a 73 MB deploy. Most of it is art the base game never loads.

| | size | needed? |
| --- | ---: | --- |
| Fate / campaign art (`f01`–`f24`, `fate`, `empire`) | **48.6 MB** | **No** — campaign is out of scope (docs/04) |
| `arcs-bg.png` | 2.8 MB | **No** — `arcs-bg.webp` (275 KB) is what the CSS loads |
| `court` | 5.6 MB | yes |
| `lore` | 3.8 MB | yes |
| `action` | 3.5 MB | yes |
| `leader` | 2.1 MB | yes |
| `setup`, `icon`, `figure`, `ambition`, map plates | ~2 MB | yes |

Excluding the fate folders and the dead PNG takes the deploy from **73 MB to roughly 17 MB** with
no visible change to a base game. That is the single highest-value thing to do before any host is
chosen, and it makes every host's limits a non-question.

**Measured session transfer** (built app, cold cache, 4-player game to the board):

| | transferred | requests |
| --- | ---: | ---: |
| Start screen | 1.4 MB (866 KB art, 370 KB code, 151 KB fonts) | 10 |
| Through to the board | 3.8 MB total (3.2 MB art) | 57 |

So bandwidth per player-session is ~4 MB cold and near zero warm, once caching is set up
(section 5). Even a busy month is trivial on a free tier.

## 4. Options

| Host | Fit | Notes |
| --- | --- | --- |
| **Cloudflare Pages** | **Best** | Free tier is generous on bandwidth, and unmetered requests. Limits to respect: 20,000 files and 25 MiB per file — trimmed, this build is ~900 files with a 605 KB largest file, comfortably inside. Free custom domain, good cache control. |
| **Netlify** | Good | Simplest drag-and-drop or git deploy. Free tier has a monthly bandwidth cap — fine at ~4 MB a session, worth watching if it ever gets popular. |
| **Vercel** | Good | Equivalent DX. Free tier is **non-commercial only** — fine here, but read the terms if that ever changes. |
| **GitHub Pages** | Workable | Free and simple, *but* it serves from a repo, so the 17 MB of art has to be committed. Git handles binaries poorly and they are forever in history. Prefer a host that takes an upload. |
| **Cloudflare R2 / S3 + CDN** | Overkill | Full control, but you would be hand-rolling what Pages gives you. |
| **Tailscale / LAN** | Still useful | `tailscale serve` on `dist/` — no public URL, no accounts, good for testing a build with friends before it is public. |

### On access control

Nothing here needs a login. If you want one anyway — an early build you would rather not have
indexed — **Cloudflare Access** in front of Pages gates by email one-time-code and is free for a
small number of users. Netlify and Vercel both put site-wide passwords behind paid plans.

## 5. Things to set up once deployed

- **Cache headers.** The JS and CSS have content-hashed filenames and can be `immutable`,
  one-year. The art under `game-assets/` has stable names, so give it a long `max-age` too and
  bust it by renaming if art ever changes. This is what turns a 4 MB first visit into a ~0 KB
  second visit.
- **Compression.** Text assets (JS/CSS) should be Brotli — all three hosts do this automatically.
  The art is already WebP; do not let a host try to re-encode it.
- **SPA fallback.** The app is a single route today, so this is only insurance: serve
  `index.html` for unknown paths.
- **Fonts.** FM Bolyar Pro is a commercial face from a type foundry — a different rightsholder
  from the game's art, and desktop licences often exclude webfont serving. Worth a five-minute
  check of the licence you bought; the fallback stack (`ui-serif, Georgia, …`) already exists if
  the answer is no.

## 6. Recommendation

1. **Trim the build** (section 3) — 73 MB → ~17 MB, no visible change.
2. **Cloudflare Pages**, connected to the repo or uploaded from CI. Free, fast, no limits you will
   come near, and it is the easiest place to set cache headers properly.
3. **Cloudflare Access** in front of it *only if* you want it unlisted while it is rough.
4. Keep **Tailscale** in your pocket for showing someone a build without deploying it.

## 7. What would change this

- **Online multiplayer** — would need a server holding the journal and pushing updates, turning
  static hosting into a running service. Options are brainstormed in **docs/17**; the smallest of
  them (a Cloudflare Durable Object per game) sits alongside Pages rather than replacing it, so
  the hosting choice here does not need to change to allow for it.
- **Cloud saves** — same. Today a save is a file the browser downloads.
- **The campaign** — would bring the 48.6 MB of fate art back into the deploy. Still fine on
  Cloudflare, worth re-checking the per-file limit on whatever host is in use by then.

## 8. First concrete step

Add a deploy-oriented build that excludes what section 3 lists, so the trimmed build is the one
that ships by default rather than something to remember. That is a small script change and belongs
with whichever host is chosen.
