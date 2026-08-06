# Arcs Digital — Turn Structure

Status: implemented in `packages/engine/src/rules/turn.ts`, `cards.ts` and
`rules/standard-actions.ts`. Transcribed from haunt-roll-fail's `arcs/game-common.scala`
and `arcs/game.scala`.
Date: 2026-07-22

## 1. The deck

28 action cards: four suits (Administration, Aggression, Construction, Mobilization) x
strengths 1–7. Each card carries a **pip count** — the number of actions it grants — which
is per-card data, not derivable from strength (`cards.ts`, verified against
`game.scala:289-320`).

At **three players the strength-1 and strength-7 cards are removed**, leaving 20; four
players use all 28 (`game.scala:1330-1331`). Each chapter, the deck is shuffled and every
faction is dealt **six** cards.

## 2. The flow

```
chapter/start   shuffle deck, deal 6 each, reset round state
round/start     initiative holder leads
  lead          play a card face-up, declare its suit; pips drive the lead player's turn
  follow (each other faction, in initiative order):
        surpass   same suit, strength > lead         -> full pips, lead suit
        copy      *any* card, face down              -> 1 pip,   lead suit
        pivot     different suit, face up            -> 1 pip,   new suit
        pass
  seize         a strength-7 surpass auto-seizes; otherwise a follower may discard a
                card to seize initiative for the next round (one seize per round)
  prelude       spend any resources for free actions, before any pip is spent
  turn          spend pips one at a time on standard actions
round ends when everyone still holding cards has passed -> chapter ends
```

This maps directly onto the action types in `turn.ts` (`turn/lead`, `turn/surpass`,
`turn/copy`, `turn/pivot`, `turn/check-seize`, `turn/pips`, `turn/end`, `round/end`,
`chapter/check-end`).

**Copy takes any card, not a same-suit one.** The rule is "play any card face down and take
one action of the lead" — its own suit is irrelevant (`game-common.scala:1474` puts no
condition on Copy). The engine originally attached Copy only to same-suit cards, so a follower
holding nothing of the lead suit saw **Pivot alone** and could not copy at all. Only Surpass
(same suit, strictly stronger) and Pivot (a *different* suit) are conditional. `turn.test.ts`
now asserts one Copy per card in hand, including off-suit cards.

**Surpass is strictly greater**, and the code used to say `>=`. It made no observable
difference: `(suit, strength)` is unique across the deck, so a same-suit card of equal
strength *is* the lead card, which sits in the leader's played pile rather than a follower's
hand. Confirmed by walking 1000 games — 58,764 follow decisions, 37,149 surpass options, and
not one follower holding a same-suit card at exactly the lead's strength. It was corrected
anyway, because the loose comparison stated the wrong rule and would turn into a real bug the
moment a duplicate card exists. `turn.test.ts` now pins the deck-uniqueness assumption that
makes `>` safe, so a phase-2 campaign card that breaks it fails there first.

## 3. Pips and the suit→action map

The played card's suit determines which of the seven standard actions its pips may buy.
Verified against `game-common.scala:2082-2111`:

| Suit | Actions per pip |
| --- | --- |
| Construction | Build, Repair |
| Administration | Tax, Repair, Influence |
| Mobilization | Move, Influence |
| Aggression | Battle, Move, Secure |

Zeal and Wisdom (the Faithful campaign suit, played as one or the other) add more
combinations and are deferred to phase 2. The map lives in `SUIT_ACTIONS` in `cards.ts`.

Each pip buys exactly one action from the played suit's set. Lead and surpass grant the
card's full pips; copy and pivot grant one.

## 4. The Prelude

Implemented in `prelude.ts` (the table and eligibility) and `rules/turn.ts` (the flow).
Between playing your card and spending its first pip you may spend **any** resources, each
for one free action. It is a loop — every spend returns to the menu — so there is no limit
beyond what you hold. Transcribed from `game-common.scala:1632-1775`.

| Resource | Buys |
| --- | --- |
| Material | Build, Repair |
| Fuel | Move |
| Relic | Secure |
| Weapon | *no action* — adds a **Battle option** to a card whose suit cannot battle |
| Psionic | whatever the **lead card's** suit buys |

The tempting shortcut is to reuse the suit→action map for all of them, and it is wrong:
Mobilization buys Move *and* Influence, but Fuel buys only Move. Only Psionic really is the
suit map, keyed off the **lead** card — a follower who pivoted into another suit still copies
the lead, which is why `state.lead.suit` is passed separately from the suit being acted in.

The Weapon option is bought at most once (`state.anyBattle`), is not offered on an Aggression
card that can already battle, and is cleared at end of turn with the other per-turn flags.

**This is where outrage finally bites.** An outraged resource offers no actions; it can still
be discarded for the slot. Verified across 20 games: 266 Prelude menus, 192 actions bought,
60 Battle options, and **zero** offers for an outraged type.

Not implemented: HRF's `PreludeHold`, which parks spent tokens until the phase ends so they
can be un-spent — ours go straight back to supply, and undo covers the same ground.

## 4b. No elimination

Rulebook p22: *Rarely, a player will have no starports or ships on the map. If this happens, they
place 3 fresh ships in any gate at the end of their turn.* Arcs cannot eliminate a player, and this
is the rule that makes that true — someone swept off the board is back on their next turn rather
than watching a leader run away with the game.

Three details worth stating, because each is easy to get wrong from the summary:

- **Cities do not count.** The condition is "no starports **or ships**", so a faction reduced to
  cities alone still comes back. That is the case that matters: a bare city with no fleet around it
  is exactly the position losing a fleet leaves you in.
- **"Any gate" means any gate in play**, not one they control or can reach. A swept faction controls
  nothing, so a reachability test would have nothing to work from.
- **Three, or as many as remain.** The fine print's general rule applies — if you must place more
  pieces than possible, place the maximum possible — which bites when the ships are held as
  someone else's trophies.

Checked at the end of the turn, before the hand-off, since the pieces have to be back before the
next faction acts into the space they left. It is genuinely rare: it fires in none of the recorded
baseline games and in none of 18 full bot games across 2, 3 and 4 players, so `turn.test.ts` is its
only real coverage.

## 5. Scope: what is implemented vs deferred

This is the honest boundary, per the collaboration rules — nothing here is guessed at.

**Implemented end to end:**

- The complete card-play and initiative structure above: deal, lead, follow (surpass /
  copy / pivot / pass), the seize rules, the pip loop, initiative passing, round and
  chapter transitions.
- **Move** — a **fleet** of any size along one connection, plus the **catapult**.
- **Influence** and **Secure** — the court deck (docs/13-court.md). Card *effects* are not
  implemented; the loop around them is.
- **Tax** and **Build** — see docs/07. Tax gains a planet resource from a taxed city; Build
  places a City, Starport or Ship from reserve.

**Deferred, and marked in code where they attach:**

| Thing | Why deferred | Attaches at |
| --- | --- | --- |
| Event cards | phase 2 (campaign) | not dealt |
| Faithful / Zeal / Wisdom | phase 2 | absent from `SUIT_ACTIONS` |
| Chapter / game-end **scoring** | needs ambitions and the power track | `performCheckChapterEnd`, a stub |

All seven standard actions are implemented; the `NOT IMPLEMENTED` placeholder that once
covered six of them is now an unreachable default branch, kept only until it is cleared out.

**Chapter/game end is now real.** Chapter end hands off to ambition scoring, which awards
power and ends the game at the power threshold (`39 - factionCount * 3`) or after five
chapters. See docs/08-ambitions.md. (Earlier this was a fixed five-chapter stub; that is
gone.)

## 5a. Actions that could do nothing are not offered

A pip spent on Repair with nothing damaged, or Tax with every city already taxed, used to
**vanish** — the offer found no options and handed straight on to the next pip. The menu now
hides any action that could not act (`canTake` in `standard-actions.ts`).

Measured across 25 driven games, this is how often the old menu offered a dead end:

| Action | Offered | Dead ends |
| --- | --- | --- |
| Repair | 2559 | **1588 (62%)** |
| Secure | 1121 | **1121 (100%)** |
| Build | 1312 | 573 (44%) |
| Battle | 1121 | 311 (28%) |
| Tax | 1247 | 214 (17%) |
| Move, Influence | — | 0 |

Secure at 100% is the striking one: it needs a **strict** majority of agents on a court card,
which that policy never built, so every Secure ever offered was a trap.

`canTake` answers the question by **building the real offer** and checking whether it contains
anything but an escape, rather than by a second set of predicates that could drift from what
the action goes on to do. Battle is the one special case — its offer is a hand-off rather than
a menu, so it consults `canBattle` directly.

Two consequences worth stating:

- **The Prelude is guarded the same way, and it matters more there.** A Prelude spend pays the
  **token** before handing to the action, so a dead end costs a resource rather than a pip.
  Discards stay on offer — emptying a slot is the whole point of them.
- **A card whose whole suit can buy nothing ends the turn** rather than stalling on a menu
  whose only option is to leave, and says so in the log: *"has no Aggression action available
  (3 pip(s) lost)"*.

HRF instead shows such options disabled with a printed reason (`.!(cond, "why")`). Hiding them
needs no new concept in the `Ask` model; the cost is that a player cannot see *why* an action
is missing, which is worth revisiting if it proves confusing in play.

## 6. Simplifications still in Move

Fleet sizing and the catapult are now implemented (section 9). What remains:

- **Which ships go** — auto-resolved fresh-first; HRF lets you choose to send damaged ships.
- **Transport** — ships carrying other pieces.
- **Fresh vs moved** tracking, and per-action move limits.
- **Move-then-battle** (Aggression and Mobilization let a move end in a battle).
- Moving pieces other than a faction's own ships (Empire ships under a regent, etc. —
  campaign).

These are listed at `offerMove` in `standard-actions.ts`. None of them change the turn
structure; they enrich one action.

## 7. Tests

`packages/engine/test/turn.test.ts`:

- Deck composition and pip counts, per player count.
- The suit→action map.
- Dealing, leading (card moves hand→played, lead recorded with suit and pips), and that the
  lead player is offered the correct suit's actions.
- Move relocating a ship along a connection while conserving ship count.
- **A full game driven by a policy to game-over**, deterministic under a fixed seed — the
  real proof that the round/chapter loop terminates rather than stalling.


## 8. Initiative

Two bugs lived here until the post-court review, both found by diffing against
`game-common.scala` rather than by playing:

**Initiative does not stay with the lead player.** It goes to whoever played the
highest-strength card **of the lead suit** (`:2162`), and only face-up plays count:

- **lead** and **surpass** qualify — both land in HRF's `f.displayed` in the lead suit.
- **copy** never does. The card is played face down (`f.blind`, `:1515`), so copying buys
  secrecy at the cost of any claim on the initiative.
- **pivot** never does. It is displayed as its *new* suit, which is by definition not the lead
  suit.

A lead player who **declared an ambition is excluded**, because declaring zeroes the card.
That is what makes declaring cost you the initiative rather than being free — and it was the
single most consequential thing missing.

**A pass does not discard a seize.** HRF's pass hands the initiative on and restarts the lead
but touches neither `seized` nor the played cards (`:1338-1348`). Ours cleared the claim, so a
rival seizing and *anyone* passing afterwards lost the seize outright — 1419 claims across 40
driven games once a policy was written that both follows and passes. `seized` is now cleared
only where it is consumed, at end of round.

Worth noting how nearly this was missed: the first two probes reported **zero** occurrences,
because a policy that prefers following never passes, and one that prefers passing never
reaches the seize decision (a seize is only offered *after* a follow). It needs a policy that
does both — follow until someone seizes, then pass.

**Initiative carries across chapters.** HRF sets the faction order once at setup (`:282`) and
thereafter only rotates it on a transfer (`:2238`); a new chapter never resets it. Ours reset
to seating order every chapter.

Measured before and after over 20 driven games — the first bug alone had red leading 330 times
against ~90 each for the others; afterwards 146/152/166/136. A probe comparing every round
boundary against HRF's rule went from **311 mismatches in 625** to **0 in 633**.

## 9. Move: fleets and the catapult

Move was the thinnest rule in the build: one ship, one hop. Both halves of the real rule are
now in (`game-movement.scala:70-118`).

**Fleets.** Any number of ships move together. Asked as two steps — where to, then how many —
which keeps the menu small; the largest single ask across 25 driven games was 12 options.

**The catapult.** Leaving a system where you have a **Starport**, into a **gate** that no rival
**rules**, lets the same fleet keep going. It chains: HRF re-enters with `cascade = true`, so a
fleet launched from a starport can run the gate ring until it stops at a planet or a gate a
rival holds. Verified in play — a fleet moved `1-Arrow → 1-Gate` and continued on.

**Ships can be dropped off along the way.** Each leg of a catapult re-asks how many carry on,
so a fleet can leave a ship at every gate it passes — HRF re-enumerates its ship combinations
at every leg (`game-movement.scala:97-115`), and this is the same choice. Only the ships that
carried on may continue again.

*Simplification:* *which* ships go is auto-resolved fresh-first. HRF enumerates fresh/damaged
combinations, so choosing to send damaged ships forward is a real decision that is not offered
yet — the same class of simplification as auto-allocated battle hits.
