# Arcs Digital — Action Audit

Status: complete for the seven standard actions, as of 2026-07-23.
Prompted by two reported bugs (Starport building multiple Ships per turn; Tax blocked by
system rather than by City). This is the systematic sweep that followed.

## 1. The bug class

Both reported bugs were the same shape:

> **A per-piece rule enforced at the wrong granularity** — the option was offered, or the
> limit recorded, against a *location* when the rule is about an individual *piece*.

That collapses several distinct pieces into one, so the limit either over-restricts (Tax:
one City blocked the other on a 2-slot planet) or under-restricts (Build: one Starport could
produce a Ship per pip).

## 2. Ground truth: every per-turn limit HRF keeps

From `EndTurnAction` (`game-common.scala:2137-2145`), the complete set of per-turn state:

| HRF field | What it limits | Our status |
| --- | --- | --- |
| `taxed.cities` | each **City** taxed once per turn | **fixed** — now keyed by city figure id |
| `worked` | each **Starport** builds one Ship per turn | **fixed** — now keyed by starport figure id |
| `taxed.slots` | empty-slot taxing | n/a — campaign (Inspiring trait), not modelled |
| `secured` | a Guild card secured this turn can't also be used for its prelude | n/a — Secure is a placeholder; **noted for when it lands** |
| `anyBattle` | *enables* battle from a non-Aggression card | **implemented** — bought with a Weapon in the Prelude, cleared at end of turn |
| `used` | effects used this turn | n/a — guild/lore, campaign |

`countedMoves` (`game-movement.scala:146`) looked like a candidate but is a cascade-recursion
guard (`< 12`), not a game rule.

## 3. Per-action findings

| Action | Per-piece limit? | Verdict |
| --- | --- | --- |
| **Tax** | yes — per City | **was buggy, fixed** (keyed by system) |
| **Build** | yes — per Starport for Ships | **was buggy, fixed** (offered per system) |
| **Build** (City / Starport) | no | correct — one building per free slot; `freeSlots` recomputes between pips, so a 2-slot planet legitimately takes two buildings across two pips |
| **Move** | no | correct. No per-ship-per-turn limit exists in Arcs; the same ship may move again with another pip. (`fresh` in HRF means *undamaged*, not *unmoved* — worth knowing, it reads like a moved-flag but isn't.) |
| **Repair** | no | correct — offered per damaged figure already, and self-limiting: repairing clears the damage, so a piece cannot be repaired twice |
| **Battle** | no | correct — no per-system or per-turn battle cap; each pip may start a battle |
| **Influence / Secure** | Secure: yes (`secured`) | **implemented** (docs/13-court.md). HRF's per-card `secured` lock stops a Guild card secured this turn also being used for its prelude — not needed while card effects are unimplemented; **flagged** for when they land |

## 4. A different bug found during the sweep

Auditing Battle surfaced an unrelated defect in **hit application** (`dice.ts`, formerly
inline in `battle.ts`).

`applyHits` ran **two sequential passes** — finish already-damaged pieces, then damage fresh
ones — so it could never damage *and then* destroy within a single battle. Four hits against
two fresh ships damaged both and **silently discarded two hits** (they overflowed to
bombardment) when the correct result is both ships destroyed.

HRF models this as a health pool: `shipsN = sum(fresh ? 2 : 1)`, with hits beyond the pool
overflowing (`game-battle.scala:491-499`). A fresh piece absorbs two hits, a damaged piece
one.

**Fixed** by replacing the two passes with a single loop that repeatedly finishes a damaged
piece if there is one, else damages a fresh one — so the health pool is consumed fully and
hits are never wasted while targets remain. The function was extracted from `battle.ts` into
`dice.ts` as a pure, exported `applyHits(damaged, targets, count)` so it is directly
unit-testable rather than only reachable through a random roll.

This materially changes combat: battles were under-killing.

## 5. Tests

- `packages/engine/test/per-turn-limits.test.ts` — the two per-turn rules. Properties over a
  full game ("no two Ship builds share a (turn, starport) pair"; same for City taxes), plus a
  constructed two-Cities-on-one-planet position asserting the Tax menu lists one option per
  City, plus checks that both limits *clear* on a later turn rather than blocking forever.
- `packages/engine/test/hits.test.ts` — the health model: one hit damages, two destroy, a
  damaged piece dies to one, four hits kill two fresh ships, overflow only after the pool is
  spent, and purity of the input.

Each fix was verified by **re-introducing the old behaviour and confirming the new tests
fail**, then restoring the fix:

- starport → `starport red/Starport/1 built twice in turn c1r6:red`
- tax → `expected [...] to have a length of 2 but got 1`
- hits → 4 failures including `destroys two fresh pieces with four hits (the regression)`

## 6. Standing guidance

When a rule limits *a piece*, key the limit on the **figure id**, never the location. Two of
the eighteen planets' worth of slots (8 planets have two) make "one per system" and "one per
piece" differ in real play. The same applies to any future per-piece rule — Secure being the
next one due.

## Ruling counted damaged ships

Found in a scope audit, not from a report, and it had been wrong since ruling was written.

`ruleValue` counted every ship a colour had in a system. The rule is **fresh ships only**:
"you control a system and its contents if you have more fresh ships there than each Rival",
and a damaged ship is not fresh. So a wrecked fleet went on ruling a system it could no longer
hold — three damaged ships still beat two undamaged ones.

Buildings were already correctly excluded, and remain so: a city gives no claim on the space
around it, which is what lets a fleet sit on someone's world and tax it.

**It mattered widely**, because ruling gates eight separate things: taxing your own cities under
Callow, taxing a Rival's city, building, the two gate builds, the Gate Ports toll, the catapult's
"no rival rules this gate", Tool Priests, and one vox card. All of them consult `rules()`, so the
single fix corrected all eight.

**The whole suite passed before the fix and after it.** Nothing exercised ruling directly — it was
always reached through some other feature that happened not to involve damage. `control.test.ts`
now covers it: fresh counting, damaged exclusion, buildings excluded, ties ruling for nobody, and
two downstream checks that a wrecked fleet loses tax and build access. Three mutations —
counting damaged again, counting buildings, and letting ties rule — all fail it.

Verified against the rulebook rather than HRF alone, though HRF agrees exactly
(`l.diff(damaged).count(Ship)`, game.scala:943).
