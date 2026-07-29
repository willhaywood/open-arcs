# Arcs Digital — Board Topology

Status: analysis complete. Data lives with the code that consumes it, at
[`packages/engine/src/data/board-topology.json`](../packages/engine/src/data/board-topology.json).
Date: 2026-07-22
Regenerate:
`python3 scripts/build_board_topology.py <region-analysis.json> packages/engine/src/data/board-topology.json`

## 1. Headline: the topology is in the code, not the bitmap

The main thing this analysis settled — we do **not** need to reverse-engineer the board from
images. Adjacency, resources, building slots and board variants are all plain data in
`arcs/game.scala` and `arcs/game-base.scala`, which are MIT licensed. They are now transcribed
into `packages/engine/src/data/board-topology.json` and verified.

The region bitmaps are needed for exactly two jobs, both presentational:

1. **Pointer hit-testing** — which system is under the cursor.
2. **Random point-in-region** — scattering ship sprites inside a system without overlap.

That is a much smaller dependency than it first appeared.

## 2. The board

24 systems: 6 clusters × {Gate, Arrow, Crescent, Hex}. Plus one fate-only system (section 5).

### Adjacency

```
Gate(i)     <-> Gate(next(i)), Gate(prev(i)), Arrow(i), Crescent(i), Hex(i)
Crescent(i) <-> Gate(i), Arrow(i), Hex(i)
Arrow(i)    <-> Gate(i), Crescent(i)
Hex(i)      <-> Gate(i), Crescent(i)
```

Plus two special cross-cluster planet links, conditional on both clusters being in play:

```
Arrow(6) <-> Hex(5)
Arrow(3) <-> Hex(2)
```

Two properties worth internalising:

- **Arrow and Hex are not directly connected within a cluster.** Travel between them goes via
  Crescent or the Gate. Easy to assume otherwise from the board art.
- **`next`/`prev` skip clusters that are out of play**, so the gate ring always closes into a
  cycle regardless of how many clusters are in use. This is the mechanism that makes a 4-cluster
  board work with the same rules as a 6-cluster one.

Verified symmetric by the generator — every edge exists in both directions.

### Per-system data

| Cluster | Arrow | Crescent | Hex |
| --- | --- | --- | --- |
| 1 | Weapon (2) | Fuel (1) | Material (2) |
| 2 | Psionic (1) | Weapon (1) | Relic (2) |
| 3 | Material (1) | Fuel (1) | Weapon (2) |
| 4 | Relic (2) | Fuel (2) | Material (1) |
| 5 | Weapon (1) | Relic (1) | Psionic (2) |
| 6 | Material (1) | Fuel (1) | Psionic (1) |

Resource, with building slots in parentheses. Gates have no resource and no slots.

### Board variants

| Board | Players | Clusters | Systems | Source |
| --- | ---: | --- | ---: | --- |
| Board3MixUp | 3 | 2,3,5,6 | 16 | HRF |
| Board3Frontiers | 3 | 1,4,5,6 | 16 | HRF |
| Board3Homelands | 3 | 1,2,3,4 | 16 | arcs_tts |
| Board3CoreConflict | 3 | 1,2,4,5 | 16 | HRF |
| Board4MixUp1 | 4 | 1,2,4,5,6 | 20 | HRF |
| Board4MixUp2 | 4 | 1,2,3,5,6 | 20 | HRF |
| Board4Frontiers | 4 | 1,2,3,4,6 | 20 | arcs_tts |
| Board4MixUp3 | 4 | 1,2,3,4,5 | 20 | arcs_tts |
| BoardFull | — | 1–6 | 24 | HRF |

**The full 6-cluster board is campaign-only.** Three players use four clusters, four players use
five. There is no "standard" layout — every base-game layout is a named setup, and the board
selector in `arcs/game.scala:1373` has **no default case**, so a game started without a setup
option selected would throw a `MatchError`. Our implementation makes the layout a required
parameter rather than reproducing that.

### The three ported from the TTS mod

HRF implements only five of these: its `SetupCardOption` covers 3-4 players and offers exactly
`Setup3PMixUp`, `Setup3PFrontiers`, `Setup3PCoreConflict`, `Setup4PMixUp1`, `Setup4PMixUp2`
(`meta.scala:288-289`). The printed game has **four setups per player count**, so three 3p/4p
boards had art but no topology. They come from arcs_tts instead, which carries the whole deck as
data:

- **out-of-play clusters** — `src/BaseGame.lua`, `BaseGame.chooseSetupCard`
- **starting positions** — `src/Global.lua`, `starting_locations[<card>_GUID][seat][A..D]`

The mod keys each seat's placements by the letters printed on the card, and what goes on each
letter comes from `starting_pieces` (`src/Global.lua`): **A = city + 3 ships, B = starport +
3 ships, C/D = 2 ships**. Its system letters are `a`/`b`/`c` = Arrow/Crescent/Hex.

That reading was validated against the five boards HRF *does* define before being used for the
new ones: **16 of their 17 seats match the mod exactly** — systems, gates and all.

> **One known disagreement between the references.** On `Board3MixUp` seat 2, HRF places the city
> at 2-Arrow and the starport at 5-Hex (`game-base.scala:53`); arcs_tts has them the other way
> round. The systems and the gate agree; only which building goes where differs. HRF's version is
> kept, since that is where the rest of our data came from and a single swapped pair among 17
> seats reads as a transcription slip in one source or the other. Worth settling against a
> physical card before it matters — a City and a Starport are not interchangeable.

## 3. Region bitmap findings

Both bitmaps are 2528×1776, lossless WebP.

**The technique works cleanly.** All 25 declared anchor points resolve to distinct colours in both
images — no collisions. Colours are ordinary-looking RGB values (`#e46000`, `#ffd117`, …) rather
than a packed index, but that is irrelevant to the lookup.

**Anchors are not centroids.** HRF's declared points are hand-picked interior points, and several
sit well away from the region's centre of mass — `1-Crescent` is declared at (1320,130) but its
centroid is (1417,224). The only requirement is that the point lies inside the region. If we
generate our own map, pick interior points deliberately; don't compute centroids and assume they
land inside a concave region.

**Boundaries are anti-aliased.** Beyond the 25 region colours plus black, both images contain a
handful of stray near-miss colours (`#dbb209` next to `#d1ad05`, and similar) totalling a few
dozen pixels along region edges. HRF's lookup returns "no region" for these. Harmless for clicks,
but it means an exact-match lookup will occasionally miss on a boundary pixel — worth a
nearest-colour fallback or a one-pixel search if it ever feels unresponsive.

**The two bitmaps are not colour-identical.** `5-Gate` is `#9d9d9d` in `map-regions` but `#848484`
in `map-regions-select`. Any implementation must key off each image separately rather than
assuming one shared palette.

## 4. A latent bug in HRF worth not copying

In `map-regions-select`, the anchor for `System(7, Gate)` at (1250,894) sits on **black — the
image background**, not on a distinct region.

HRF's `regionAt` reads the colour under the cursor, then scans the anchor table for an anchor
whose colour matches. Since `7-Gate`'s anchor colour is black, **every click on empty background
resolves to `System(7, Gate)`** — 781,669 sampled pixels of it, the entire image margin.

In `map-regions` the same system is a proper distinct grey region (`#808080`, 490×490, centred).
So the placement bitmap is correct and the selection bitmap is not.

Our lookup should treat the background colour as an explicit "no region" sentinel before scanning
anchors, rather than letting it match by coincidence.

## 5. System(7, Gate)

Not a normal system. It is `Passage`, introduced by the **Gate Wraith** fate
(`arcs/fate-gate-wraith.scala:51`), and it sits at the exact centre of the map. It appears in no
board's cluster list, so `board.systems` never contains it — it is added by fate rules at runtime.

Phase 2 content, flagged `fateOnly: true` in the data file. Its existence is a good concrete
example of why the rule-module chain has to live in game state
([04](04-scope-and-phasing.md), section 2.2): a fate introduces a *new board region* mid-game.

## 6. Gate markers

`arcs/ui.scala:450-469` maps each of the 18 non-gate systems to one or two pixel positions where
the gate-link marker is drawn. That is exactly the count of the
`map-broken-gate-{1..6}-{arrow,crescent,hex}` assets in the manifest, so these are the anchor
points for the broken-gate overlays.

Captured in the data file as `render.gateMarkers`.

## 7. Implementation note

HRF builds a full `Array.tabulate(width, height)` of packed integers on load — 4.5M entries for a
2528×1776 image. In JS that is an 18 MB `Uint32Array` per bitmap, materialised eagerly.

Cheaper: keep the decoded `ImageData` and build only a `Map<packedRGB, systemId>` from the 25
anchors at load, then look up per query. One small map, no second full-size buffer, same result.

Whatever the storage, the render layer should address systems by id from
the engine board module and treat the bitmap purely as a coordinate→id oracle.
