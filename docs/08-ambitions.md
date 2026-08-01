# Arcs Digital — Ambitions & Scoring

Status: implemented in `packages/engine/src/rules/ambitions.ts`. This replaces the
fixed-five-chapter stub with the real win condition.
Date: 2026-07-23
References: haunt-roll-fail (`arcs/game.scala`, `game-common.scala`) for the procedure;
Quinnsicle/arcs_tts (`src/AmbitionMarkers.lua`) cross-checked for the component values.

## 1. Two references now, and why it mattered

From this feature on we cross-check rules against **two** independent implementations:

- **haunt-roll-fail** (Scala) — a full procedural implementation. Authoritative for *how*
  scoring runs.
- **arcs_tts** (Lua, Tabletop Simulator) — automates setup and score-keeping on the real
  components. Authoritative for the *component values and hard constraints*.

They agreed on everything load-bearing here, which is the point of checking: the marker
values, and that a strength-1 card cannot declare, are confirmed by both. Where the TTS mod
leaves a step to the physical player (the teal/yellow marker flip), HRF's procedure fills
it in, and I took HRF's model — noted as a simplification in section 5.

## 2. The five ambitions

Each is keyed to a card strength and scored by a metric (`game.scala:1152`):

| Ambition | Card strength | Metric (base game) |
| --- | --- | --- |
| Tycoon | 2 | Material + Fuel tokens held |
| Tyrant | 3 | captives held |
| Warlord | 4 | trophies held |
| Keeper | 5 | Relic tokens held |
| Empath | 6 | Psionic tokens held |

A strength-7 card declares any ambition; a strength-1 card declares none.

## 3. Markers

Three physical markers, each double-sided. Confirmed against the TTS component data:

| Marker | Low face (high/low) | High face |
| --- | --- | --- |
| small | 2 / 0 | 4 / 2 |
| medium | 3 / 2 | 6 / 3 |
| large | 5 / 3 | 9 / 4 |

"High" is the power to first place, "low" to second. HRF models the low/high escalation as
a **sliding window** over a flat marker list (`game.scala:1363`): a chapter's three
available markers are `MARKERS.slice(chapter-1, chapter-1+3)`, so later chapters draw larger
values. `chapterAmbitionable(chapter)` implements this.

## 4. Flow

```
lead a card
  -> ambition/check-declare   (may declare an ambition matching the card strength)
       declare -> take the highest available marker, place it, ZERO the card
       skip    -> straight to pips
  -> pip loop (turn)
...
chapter ends (all pass)
  -> ambition/score           award power for every declared ambition,
                              then return trophies / captives if their ambition scored
  -> ambition/check-win       end the game, or start the next chapter
```

**Chapter-end cleanup** (rulebook 6.2.2 step 1): *"If Warlord was scored, return all Trophies. If
Tyrant was scored, return all Captives."* This runs at the tail of `performScore` rather than as its
own action, because it is fully determined — there is nothing to ask anyone. Three details it is
easy to get wrong, all pinned by tests:

- The trigger is the ambition being **scored**, not won, so it fires even when the Qualifying rule
  left nobody with any power.
- **Every** faction empties the pile, not just whoever placed — a faction that came third still
  returns its trophies.
- Figures go back to their **own** colour's reserve, not the holder's; the owner is parsed off the
  figure id, the same way Press Gang releases a captive.

Only the pile the ambition counts is cleared: scoring Warlord never touches captives.
**Resources are not part of this step** and are never returned at chapter end — the only resource
discards in the game are capacity and outrage (docs/07).

Omitting this made both piles accumulate for the whole game, so a lead in either was permanent and
those two ambitions compounded for whoever got there first. Restoring it visibly narrows the spread
of final scores.

**Declaring zeroes the card**: the played card counts as strength 0, so any same-suit card
surpasses it. This is wired through `Lead.zeroed` and honoured in the follow options.

**Scoring** (`game-common.scala:2335`), per declared ambition:

- `high` / `low` = the summed high / low of the markers on that ambition.
- Rank factions by the metric, counting only positive values.
- A **unique leader** takes `high` plus a city bonus; a **unique runner-up** takes `low`.
- A **tie for first** awards each tied leader `low`, and no `high`.

The **city bonus** on first place (`game-common.scala:2392`): `+2` if the winner has fewer
than two cities in reserve, `+3` more if fewer than one — i.e. building your cities out is
worth up to `+5` power on an ambition win.

**Win condition** (`game-base.scala`, via `game.scala:303`): after scoring, the game ends
if any faction's power reaches `39 - 3 * playerCount` (30 at three players, 27 at four), or
if five chapters have been played. The highest power wins. This is the real end of the game,
replacing the earlier chapter-count stub.

A scripted three-player game confirms the shape: a faction reached exactly 30 power at
chapter 4 and won, with stacked Keeper markers scoring 8 (5+3) and second place taking the
low values — all as expected.

## 5. Scope and simplifications

- **Declaration is lead-only — and that is the rule, not a simplification.** This entry
  previously read as though follower declaration were deferred work. It is not: only the player
  who leads may declare, and that includes surpassing. A follower who surpasses takes the
  initiative but declares nothing. HRF agrees structurally — its `CheckAmbitionAction` is reached
  from exactly one place, immediately after the lead is played.

  The base-game exceptions are *cards*, not the turn structure, and both are implemented:

  | Card | When | Implemented in |
  | --- | --- | --- |
  | **Galactic Bards** (bc25, guild) | from any play, before anyone else has declared, once a turn | `performBardsDeclare`, in the seize path |
  | **Populist Demands** (bc27, vox) | on securing it, free | `populistDemands` in `rules/vox.ts` |

  Neither zeroes a played card. Zeroing is a consequence of declaring *off your action card*, not
  of declaring as such, so a free declaration leaves the lead's strength intact — which matters,
  because it means these cards do not cost their holder the initiative.

  Both are tested from a **non-lead** position specifically (red having copied yellow's lead), so
  the exception is pinned rather than incidental.

  The expansion's ambition-paired lore (Tycoon's Ambition, Empath's Bond and the rest of that set)
  also touches declaring and scoring; none of lore 15-28 is implemented yet.

  `ambitions.test.ts` now pins this: across several rounds, every declare offered goes to the
  faction that led that round, and the check asserts declares actually occurred so it cannot pass
  vacuously. Routing a copy into the declare check fails it. (The card exceptions above use their
  own action types, so they do not muddy that assertion.)

  One guard on Galactic Bards — its once-per-turn `usedThisTurn` flag — is **redundant** and cannot
  be tested from outside: the same offer is already blocked by `declared.length === 0`, since
  taking it declares. Left in place as defence, noted here so its lack of coverage is not read as
  a gap.
- **The teal/yellow flip is abstracted** into HRF's per-chapter window rather than modelled
  as a physical flip on re-contest. The values are identical; what differs is that a marker
  cannot be flipped to its high face mid-chapter by a second declaration of the same
  ambition. Worth revisiting against the rulebook if it turns out to matter competitively.
- **Warlord now scores; Tyrant does not yet.** Trophies come from Battle (docs/09), which is
  now implemented, so Warlord is live. Captives come from securing a court card off rivals
  (docs/13-court.md), so **Tyrant is live too** — all five ambitions now score. Before the
  court landed the scoring log showed "No one scored
  Tyrant" as a visible reminder.
- **Power comes only from ambitions**, which is correct for the base game.
- **Conspiring / hidden ambitions, and the many fate objectives** that hook into scoring are
  campaign content and deferred.
- **Traits and lore** that alter an award (Academic, Just, Violent, and the various lores)
  are campaign and omitted.

## 6. Tests

`packages/engine/test/ambitions.test.ts`:

- Marker values cross-checked against the TTS faces; strength→ambition mapping including the
  1 (none) and 7 (any) edge cases; the per-chapter escalation window.
- Declaration offered to the lead player, taking the highest marker, consuming it, and
  zeroing the card.
- Metrics for resources, captives and trophies.
- **A full game driven to a power win**, asserting the winner holds the most power and that
  power was actually scored — plus determinism under a fixed seed.
