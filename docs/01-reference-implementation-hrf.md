# Arcs Digital — Reference Implementation Notes (haunt-roll-fail)

Status: research notes on the reference implementation. Decisions taken from this analysis live in
[02](02-technology-choice.md), [03](03-ai-approach.md) and [04](04-scope-and-phasing.md).
Date: 2026-07-22

## 1. What HRF is

`hrf.im/play/arcs` is served by the **haunt-roll-fail** project
(<https://github.com/haunt-roll-fail/haunt-roll-fail>). It is a multi-game boardgame engine
written in **Scala 2.13, compiled to JS via Scala.js**, hosting Root, Vast, Oath, Cthulhu Wars,
Coup, Arcs and others from one codebase.

The clone is ~9 MB. Three sbt projects:

| Project | Purpose |
| --- | --- |
| `haunt-roll-fail/` | The client: engine + all game implementations, compiled with `sbt fastOptJS` |
| `good-game/` | Server: akka-http + Slick, ~330 LOC, stores game journals in a DB |
| `scala-js-dom-reduced/` | Vendored, trimmed scala-js-dom |

Licence on the repo is **MIT** — but that covers the code only. See section 5.

## 2. Arcs coverage in the repo

Everything Arcs lives in `haunt-roll-fail/arcs/`: **46 files, ~21,600 lines of Scala**. That is
the whole game, including expansions:

| Area | File | LOC |
| --- | --- | --- |
| Core rules / turn structure / state | `game.scala` | 1,873 |
| Shared action handlers (the bulk of the rules) | `game-common.scala` | 2,696 |
| Blighted Reach campaign | `game-blight.scala` | 2,425 |
| Rendering / interaction | `ui.scala` | 2,116 |
| Metadata, options, asset manifest | `meta.scala` | 1,518 |
| Summits (campaign negotiation) | `game-summit.scala` | 975 |
| Battle resolution | `game-battle.scala` | 747 |
| Lore, leaders, guilds, movement, setup | `game-lore/-leaders/-guilds/-movement/-base` | ~1,600 combined |
| **24 Fate modules** | `fate-*.scala` | ~4,900 combined |
| Bots | `bot-new.scala`, `bot-end-of-chapter.scala`, `bot-old.scala`, `bot-random.scala` | ~770 |

So the reference covers: base game (3–4p, with the alternate 3p/4p setups — Mix Up, Frontiers,
Core Conflict), Leaders & Lore, and The Blighted Reach campaign with all 24 fates. Production
currently restricts the campaign to Act I (`MetaBR.label` → `"Arcs: The Blighted Reach (Act I Only)"`,
with `Act1Only` forced as a mandatory option outside dev builds).

Bot difficulty offered to players is only `"Easy"` (`getBots` returns a single entry); `"Normal"`
exists in code but is commented out of the list.

## 3. Engine architecture

This is the part worth stealing conceptually, regardless of what language we build in.

### 3.1 Everything is an Action

`base.scala` defines `Gaming`, with a sealed `Action` hierarchy split into:

- `ForcedAction` — engine-internal steps
- `UserAction` / `Choice` — things a player picks (plus `Back`, `Cancel`)
- `ExternalAction` — actions that get written into the journal

Executing an action returns a `Continue`, which is a small closed vocabulary:

```
Ask(faction, actions)      // present choices to a player
MultiAsk(asks, policy)     // simultaneous choices
Then(action)               // chain to the next action
Force(action)              // re-dispatch
Roll / Roll2 / Roll3       // request dice from the randomness source
Shuffle / Random           // request other randomness
Log(message, kind, cont)   // emit a log line
Milestone(action)          // a save/checkpoint boundary
GameOver(winners, ...)
UnknownContinue            // "not my rule" — try the next expansion
TryAgain
```

The key property: **rules never mutate state and return a value; they return the next step.**
Randomness is never taken inline — it is requested via `Roll`/`Shuffle`/`Random`, which is what
makes replay deterministic (section 3.4).

### 3.2 Rules are a chain of partial functions ("Expansions")

`trait Expansion { def perform(a : Action, soft : Void)(implicit game : Game) : Continue }`

A `Game` holds an ordered list, assembled from the chosen options
(`arcs/game.scala:1295`):

```
campaign  -> FatesCommon, Summit, Blight, Lore
landl     -> Leaders, Lore
!campaign -> Base
always    -> Guilds, Battle, Movement, Common
```

`internalPerform` walks the list, and the first expansion that does not return `UnknownContinue`
wins (`arcs/game.scala:1785`). Each expansion is a big `match` on action type. This is how
expansion content overrides base content without base code knowing about it — the campaign
expansion sits *earlier* in the chain and intercepts.

Each of the 24 fates is its own expansion module, pushed onto the front of the chain when the
fate is assigned mid-campaign (`game-blight.scala:479`).

**Implication for us:** this is a clean, very extensible design and it is why the file count is
manageable for a game this fiddly. The cost is that the rule set is not statically checkable —
a missing case falls through to `throw new Error("unknown continue on " + action)`.

### 3.3 State: identity trackers, not a state tree

`Game` is a mutable object. Piece locations are held in four `IdentityTracker[Key, Thing]`
instances (`new-new-new-tracker.scala`) — essentially bidirectional maps from a location key to a
list of entities, with per-key validity rules:

| Tracker | Key | Entity |
| --- | --- | --- |
| `figures` | `Region` (`System(cluster, symbol)`, `Reserve(f)`, `Trophies(f)`, `Captives(f)`, …) | `Figure(color, piece, index)` |
| `cards` | `DeckCardLocation` (`Hand(f)`, `Played(f)`, `Deck`, …) | `ActionCard` / `EventCard` |
| `courtiers` | `CourtLocation` (`Market(n)`, `Loyal(f)`, `CourtDeck`, `FateDeck(fate)`, …) | `GuildCard` / `VoxCard` |
| `resources` | `ResourceSlot` (`CityResourceSlot(f, i, keys)`, `Supply(r)`, `Overflow(f)`, …) | `ResourceToken(resource, index)` |

Movement reads as `f.reserve --> Ship.of(f) --> city` via implicit operators — nice to read,
and it enforces that the piece was actually where you claimed.

Board topology is minimal: a `System` is just `(cluster: Int, symbol: Symbol)` where symbol ∈
{Arrow, Hex, Crescent, Gate}. Adjacency/connection rules live in `game-movement.scala`, not in a
graph structure. Boards are defined by which clusters are in play plus starting positions
(`game-base.scala:22-81`).

`Game.cloned()` does a shallow-ish structural copy of every field — used by the bots to look
ahead, and it's a maintenance hazard (a new `var` on `Game` that isn't added to `cloned()` is a
silent bug).

### 3.4 Persistence = a journal of action strings

There is no serialized game state. A game is **the ordered list of external actions**, each
written as a text expression by `Serialize` (`arcs/serialize.scala` + `hrf/serialize.scala`,
parsed with fastparse). Examples of the encoding: a figure is `red/Ship/3`, a resource is
`Fuel#2`.

`clonedRerun()` literally replays every recorded action from a fresh `Game` to rebuild state.
Dice results and shuffles are recorded as actions too, which is why this works.

The server (`good-game`) is correspondingly dumb: tables are `Users`, `Journals`, `Entries`
(journalId, index, userId, text), `AccessRights`, `Play`. It appends text lines and enforces
permissions. **All rules run client-side.** No server-side validation, no hidden-information
enforcement beyond what the client chooses to render.

**Implication for us:** replay-from-log is excellent for debugging, undo, and bug reports, and
it means save files are tiny and diffable. It is bad for anything that needs authoritative
hidden information or anti-cheat, and rules changes break old journals unless versioned
(`StartAction(version)` is the first entry, so they at least know which build recorded it).

### 3.5 UI

Two layers:

1. **Canvas scene graph** (`sprites.scala`, `grey-map.scala`): `Sprite`s made of `ImageRect`s
   with hitboxes, arranged into `Layer`s, composited by a `Scene` that handles zoom/pan and
   letterboxing. A `FitLayer` does automatic non-overlapping placement of pieces within a region
   with a penalty function and up to 80 random tries — that is how ships scatter inside a system
   without stacking.
2. **DOM panes** (`elem.scala`, `html.scala`, `panes.scala`): faction status panels, logs,
   choice buttons. Choices are rendered from the `Ask(...)` returned by the engine, so the UI
   never needs to know the rules — it renders whatever list of `UserAction`s it is handed.

**Region hit-testing is done with a colour-indexed bitmap**: `map-regions.webp` is a lossless
image where each system is a flat unique RGB value; `IndexedImageRegions` reads the pixel under
the cursor and maps it back to a system (`sprites.scala:288`). Same trick supplies random points
inside a region for piece placement. Cheap and effective — no polygon data needed.

### 3.6 Bots

See [03 — AI approach](03-ai-approach.md) for the full breakdown and what we do differently.

**Shipped: one bot, one ply.** `getBots` returns only `"Easy"` = `BotNew(f, noise = true)`.
`EvalBot` enumerates legal actions via `game.explode(...)`, scores each with 164 hand-written
`Evaluation(weight, desc)` rules in `GameEvaluationNew`, and picks the best. No lookahead, no
simulation, no learning. `noise` adds a single random `Evaluation(-1..-8)` as a tie-break jitter.

**Ranking is lexicographic, not a weighted sum.** `EvalBot.compare` (`bot.scala:25-38`) sorts each
action's weights by descending absolute value and compares the lists element by element, so the
largest-magnitude concern decides and the rest only break ties. Porting this as `weights.sum`
would change behaviour.

**`BotEOC` is a rollout evaluator, not lookahead**, and is commented out of the menu. It takes the
top 24 actions by heuristic, clones the game per candidate and plays forward — every faction
driven by the heuristic bot — to end of chapter, then scores with a separate scalar function
`vp()`. Deterministic first pass (expected dice, fixed deck cut), stochastic second pass only for
ties. No tree, no backpropagation. Two further bots exist and are unreachable: `BotOld` (same
evaluator, no noise) and `BotRandom` (no `getBot` case at all).

Two things to know before copying any of it. The rollout bot **cheats**: it calls
`game.cloned().cleanFor(faction)`, but `cleanFor` is `def cleanFor(f : Faction) = this` — the
information-hiding hook is a no-op, so rollouts see every hand. And in campaign mode the terminal
check is guarded by `campaign.not`, so the horizon collapses to end-of-game; plausibly why it ships
disabled.

Everything runs inside a `Compute`/`Heavy` monad that yields cooperatively so it doesn't block the
browser main thread. A Web Worker removes the need for that machinery entirely.

## 4. Where the assets come from

**There are no image assets in the repository.** Zero `.png`/`.jpg`/`.webp`/`.svg` files. The
repo contains only an *asset manifest*.

### 4.1 The manifest

`arcs/meta.scala` declares **910 `ImageAsset` entries** grouped by `ConditionalAssetsList`:

| Group | Count | Contents |
| --- | --- | --- |
| (root) | 53 | map, region index maps, broken-gate overlays, chapter/act markers, ambition boxes |
| `icon` | 67 | resources, suits, UI glyphs |
| `action` | 121 | the action card deck |
| `court` | 46 | guild + vox cards |
| `setup` | 12 | setup cards |
| `leader` / `lore` | 16 / 30 | Leaders & Lore |
| `empire` / `fate` | 25 / 25 | campaign boards |
| `f01`–`f24` | ~370 | per-fate card sets |
| `ambition` | 11 | |
| `figure` | ~110 | ships, cities, starports, agents, per colour |

Each entry carries a scale factor and a lossless flag. `convert-images.scala` is a JVM-side tool
that shells out to ImageMagick to convert a local `arcs/images/**` tree into
`webp2/arcs/images/**` at quality 82, `webp:method=6`, lossless for small or flagged images.
The `arcs/images/**` source tree is never published.

### 4.2 Where the live site serves them from

Confirmed by request (2026-07-22):

```
https://hrf.im/hrf/webp2/arcs/images/map-no-slots.webp      200  image/webp  605 KB
https://hrf.im/hrf/webp2/arcs/images/map-regions.webp       200  image/webp   25 KB
https://hrf.im/hrf/webp2/arcs/images/icon/material.webp     200  image/webp    4 KB
```

Pattern: `https://hrf.im/hrf/webp2/<game>/images/<path>/<name>.webp`. The client fetches these
through the Cache API (`CachedImageLoader` in `loader.scala`), with `Laziness` per asset —
`Immediate`, `Later`, or `OnDemand` — so the initial load only pulls what's needed.

### 4.3 What that means

The artwork is **the physical game's art** — component scans/exports of Arcs, art by Kyle Ferrin.
Arcs is owned by **Buried Giant Studios**; Cole Wehrle and Kyle Ferrin left Leder Games and took it
with them. The card *text* and the fate/lore content are likewise the publisher's. Game *rules*
(systems, procedures) are not copyrightable; their specific expression is.

### 4.4 The decision taken

The options were, in rough order of risk:

1. **Original art + original wording.** Rules-compatible, everything drawn/written by us. Highest
   effort, lowest risk.
2. **Placeholder art now, decision later.** Defers the problem rather than solving it.
3. **Personal-use-only build, never published.** Fine privately, closes off release.
4. **Reuse the published assets.**

**Option 4 was chosen, knowingly**, and the artwork is tracked in this repository rather than being
uploaded separately at deploy time. What that does and does not mean:

- It is **not a licence**. Nothing here grants rights in Buried Giant Studios' artwork, card text, or
  the Arcs name. `LICENSE` covers this repository's source code and says so explicitly.
- It is a **fan-project posture with take-down on request**, stated in `THIRD-PARTY-NOTICES.md`. The
  Arcs Tabletop Simulator mod operates on similar ground; that is a precedent, not a permission, and
  the distinction is worth keeping in view.
- It is **effectively permanent**. Git carries 71 MB across 918 binaries in history forever, so
  reversing this needs a history rewrite rather than a delete.
- **Git LFS is not used**, deliberately: GitHub Pages does not resolve LFS pointers, so LFS-tracked
  art would deploy as text files instead of images.

The lower-risk options above remain open and are what to reach for if the posture ever needs to
change — original art is the only one that removes the question rather than managing it.

## 5. Licence summary

| Thing | Status |
| --- | --- |
| HRF engine + Arcs rules code | MIT — reusable, including as a reference or a direct port, with attribution |
| Arcs artwork | Buried Giant Studios IP, **not licensed**, tracked in this repo by choice — see 4.4 |
| Arcs card/fate/lore text | Buried Giant Studios IP |
| Arcs rules and procedures | Not copyrightable as such |

If we port structure or read the code closely while writing our own, we are in MIT territory
and must keep the copyright notice. That is a genuinely useful position — the hard part of this
project is the rules, and the rules code is legitimately available.

## 6. Things worth carrying over

Independent of stack:

- **Action → `Continue` state machine.** Rules return the next step instead of mutating and
  falling through. Makes the whole engine testable without a UI.
- **Journal-of-actions as the save format**, with all randomness recorded as actions. Free undo,
  free replay, tiny saves, reproducible bug reports.
- **Expansion chain** for optional content, so the base rules never branch on "is the campaign
  on".
- **UI renders `Ask(...)`**, so the presentation layer holds no rules knowledge.
- **Colour-indexed region bitmap** for map hit-testing and in-region piece placement.
- **Identity trackers** keyed by location, with validity rules — catches a large class of
  "piece in two places" bugs at the point of the move.

Things I would not carry over:

- Mutable `Game` + hand-maintained `cloned()`. An immutable state value would make the bots and
  lookahead free and remove a whole bug class.
- No server-side rules. Fine for their trust model, not for anything competitive.
- `$`/`|`/`@@`/`?`/`??` custom operator soup (`colmat.scala`) — dense and unreadable to anyone
  who hasn't lived in it.

## 7. Open decisions (need answers before design)

1. **Art and text**: which of the four options in section 4.3? This determines whether this is a
   private hobby build or something publishable.
2. **Scope**: base game only, or base + Leaders & Lore, or the Blighted Reach campaign too?
   The campaign roughly triples the rules surface (24 fates + summits + blight).
3. **Stack**: what are we building in, and does it need to run in a browser?
4. **Multiplayer model**: hotseat / local only, async play-by-post like HRF, or real-time?
   Server-authoritative or client-authoritative?
5. **Bots**: needed at v1? HRF's are heuristic-only and acknowledged as "Easy".
6. **Relationship to HRF**: clean-room from the rulebook, or an acknowledged MIT-derived port?

## 8. Sources

- Repo: <https://github.com/haunt-roll-fail/haunt-roll-fail> (clone inspected 2026-07-22)
- Live: <https://hrf.im/play/arcs>
- Campaign rulebook (linked from HRF's own external links):
  <https://cdn.shopify.com/s/files/1/0106/0162/7706/files/Arcs_Campaign_Rulebook_for_web.pdf>
- Arcs Fates reference (linked from HRF): <https://cmckenz87.github.io/ArcsFates/>
