# Arcs Digital — AI / Bot Approach

Status:
- **Locked**: heuristic evaluator for v1. No search.
- **Locked**: bot difficulty is user-selectable. Mechanism ships in phase 1 (see section 8).
- **Committed, phase 1.5**: rollout evaluation (V2) — required to give the difficulty ladder real rungs.
- **Aspirational**: information-set search (V3).
- **Phase 2**: campaign / fate objectives (see section 9).

Date: 2026-07-22
Related: [01 — reference implementation](01-reference-implementation-hrf.md) section 3.6,
[02 — technology choice](02-technology-choice.md)

## 0. Terminology

"Bot" = an AI substitute for a human player. It is *not* the campaign's rules-driven pieces —
Empire, Blights and Free are `Color`, not `Faction`, and are resolved by the rules engine with no
AI involved. Keep that separation in our implementation too: NPC colours belong to the rules,
bots belong outside them.

## 1. The baseline we're beating

HRF ships exactly one bot, `BotNew(f, noise = true)`, offered as "Easy". It is a **one-ply static
evaluator**: expand legal actions, score each with 164 hand-written rules, pick the best. No
lookahead, no simulation, no learning. Three further bots exist in the repo (`BotOld`,
`BotRandom`, `BotEOC`) and none are reachable from the menu.

Two properties of it are worth knowing before we copy anything:

**It ranks lexicographically, not by sum.** `EvalBot.compare` sorts each action's weights by
descending absolute value and compares the lists element by element. The single largest-magnitude
concern decides; everything else is a tie-break. Porting this as `weights.sum` would change
behaviour materially.

**The rollout bot cheats.** `BotEOC` calls `game.cloned().cleanFor(faction)`, which reads as an
information-hiding step — but `cleanFor` is `def cleanFor(f : Faction) = this`. It returns the
same object. The hook exists and does nothing, so rollouts run with full visibility of every
hand. Worth remembering if HRF's harder bot ever felt uncannily well-informed.

We can clear this bar comfortably. The bar is low by choice: hand-tuned heuristics on a browser
main thread.

## 2. The one architectural decision that matters

HRF scores **actions** directly. That works for one-ply play and is a dead end for anything
stronger — you cannot average a lexicographic ranking, back it up a tree, or use it as a rollout
outcome. HRF hit this wall itself: `BotEOC` cannot reuse the action evaluator for scoring
playouts, so it carries a *second*, entirely separate scalar function (`vp()`) just for rollout
results. Two evaluation schemes, hand-maintained, that can disagree.

Do not repeat that. Split the two standard concerns from day one:

```ts
/** Scalar, relative to opponents. The long-lived asset. */
type ValueFn = (state: GameState, self: FactionId) => number

/** Fast ranking for move ordering and rollout play. May be crude. */
type PolicyFn = (state: GameState, actions: Action[], self: FactionId) => Action[]
```

Then v1's action choice is *already* a one-ply search using the value function:

```ts
function chooseAction(state, actions, self) {
  return maxBy(actions, a => value(advance(state, a, self), self))
}
```

`advance` applies the action and resolves any immediately-following engine prompts with the
policy, landing on a state we can score. Rollouts (V2) extend the horizon of that same loop.
Search (V3) reuses both functions unchanged. Each stage is an extension, not a rewrite.

The cost of this design is that v1 must apply actions to score them, which means **cheap state
cloning is a hard requirement** — see section 6.

## 3. V1 — heuristic evaluator (what ships)

### 3.1 The value function must be relative

Arcs does not score continuously. Power arrives in discrete, *contested* bursts at chapter end:
whether you rank first or second on an ambition is worth everything, and absolute material is
worth nothing on its own. An evaluator that maximises its own material in isolation will play
badly.

So the value function is a differential, as HRF's `vp()` correctly is:

```
value(state, self) = power(self) - max(power(opponent) for each opponent)
                   + positional terms
                   + (win threshold reached ? large bonus : 0)
```

Win threshold is `39 - factionCount * 3` — 27 at four players, 30 at three.

### 3.2 Positional terms

Starting weights, lifted from HRF's `vp()` as a calibrated-by-someone starting point rather than
as truth. Tune with the arena in section 7.

| Term | Weight | Note |
| --- | --- | --- |
| Lore held | +120 | |
| Loyal guild card | +60 | |
| Spendable resource | +30 | |
| Captive | +50 | only while Tyrant undeclared |
| Trophy | +40 | only while Warlord undeclared |
| City on board | +20 | |
| Starport on board | +15 | |
| Ship on board | +10 | |
| Outraged resource | **−160** | dominant negative — blocks a whole resource type |
| Damaged piece | −2 | |

Note the conditionals on captives and trophies: once an ambition is declared, the thing it counts
stops being speculative and starts being scored directly, so the speculative bonus must come off.
This kind of state-dependence is most of what makes an Arcs evaluator non-trivial.

### 3.3 Ambitions drive everything else

The single most important Arcs-specific behaviour: **the worth of a resource depends on which
ambitions are declared and how contested they are.** HRF's `appraiseResource` is the right shape —
resource value scales with the pending ambition payout that resource feeds:

```
Material / Fuel -> Tycoon
Relic           -> Keeper
Psionic         -> Empath
Weapon          -> flat (feeds battle, not an ambition)
```

with a floor value, and suppressed when the faction already holds the guild card that makes that
resource free. Multiply by the ambition's current payout — declared markers plus the best
still-available marker — so a heavily-stacked Tycoon makes material genuinely precious and an
undeclared Empath makes psionics near-worthless.

### 3.4 Where a hand-tuned bot will still be weak

Be honest about the ceiling so nobody is surprised:

- **Ambition declaration timing.** It's a commitment under uncertainty and one-ply cannot see the
  consequence.
- **Card economy and initiative.** Lead/surpass/pass and seizing initiative pay off over a whole
  round; a static evaluator sees only the immediate board.
- **Bluffing and hidden information.** Not modelled at all.

These are exactly the gaps rollouts close, which is why V2 is worth the effort.

## 4. V2 — rollout evaluation (the interesting one)

**This is the highest-value AI work on the roadmap and it should be designed for now even if it
isn't built for v1.** It is a large strength jump for a modest amount of code, and this
architecture suits it unusually well: the engine is already a deterministic
`(state, action) -> continue` machine with an explicit end-of-chapter marker to stop at.

### 4.1 Shape

For each candidate action: clone, play forward to a scoring horizon with cheap policies driving
every faction, evaluate the resulting state, keep the best average.

```
candidates = policy(state, legalActions)   // move ordering, keep top N
for each candidate:
    for each rollout budget:
        s = clone(state)
        s = apply(s, candidate)
        while not atHorizon(s): s = apply(s, policy(s, legalActions(s)))
        score += value(s, self)
pick argmax(mean score)
```

The horizon is **end of chapter**, not end of game. Arcs scores at chapter end, so that is the
natural place to stop — short enough to be cheap, long enough to capture the payoff of an
ambition plan.

### 4.2 What HRF's version got right — copy these

- **Two-phase evaluation.** A deterministic first pass (expected dice values, fixed deck cut),
  then a stochastic pass only over candidates that tied at the top. Most decisions resolve in the
  cheap pass.
- **Move ordering from the heuristic.** Only the top ~24 candidates get rolled out. With Arcs'
  branching factor this is not optional.
- **Deliberate opponent noise.** Opponents play with ~5% deviation so rollouts don't collapse
  into a single deterministic line.

### 4.3 What to do differently

| HRF | Problem | Our approach |
| --- | --- | --- |
| Main thread, `Compute`/`Heavy` cooperative yielding | Complexity that exists only to avoid blocking the UI | **Web Worker.** Deletes the machinery entirely |
| Budget is a rollout count (`24*(1+round)/ties`) | Unbounded wall-clock; janky on slow devices | **Time budget.** "Think for 400 ms", degrade gracefully |
| Campaign horizon collapses to end-of-game (`campaign.not` guard on the terminal check) | Rollouts become enormous in campaign mode — likely why it's disabled | Explicit chapter horizon for campaign too |
| `cleanFor` is a no-op — rollouts see all hands | Bot cheats; blocks honest hidden-info AI later | **Determinize**: sample a plausible opponent hand from unseen cards, roll out on that |
| Hand-maintained `cloned()` | Silent bugs when a field is added | Immutable state; clone is free |
| No reuse between candidates | Wasted work | Transposition cache keyed by state hash |

### 4.4 Expected cost

A chapter rollout is on the order of a few hundred engine actions. At ~1 µs per action in a warm
JIT, a rollout is well under a millisecond, so a 400 ms budget buys a few hundred rollouts across
~24 candidates. That is a rough estimate, not a measurement — the arena in section 7 settles it, and it
is the number that decides whether we ever need Rust.

## 5. V3 — information-set search (aspirational)

If rollouts prove insufficient, the correct next step for a game with hidden hands and dice is
**determinized MCTS / ISMCTS**: sample several full states consistent with what our faction has
actually observed, run MCTS on each, aggregate the statistics at the root.

Realistic caveats, stated up front so this doesn't get oversold:

- Arcs' branching is brutal in places. Some prompts enumerate combinations directly (placing *n*
  ships across a cluster is a `combinations` call), so raw expansion is not viable without
  progressive widening or action abstraction.
- High variance from dice and card draw means many simulations are needed before the tree means
  anything.
- A well-tuned rollout bot with a good policy frequently beats a poorly-tuned MCTS. Do not skip
  V2 to get here.

Neural evaluation is out of scope and probably always will be — it needs self-play infrastructure
far beyond this project's value.

## 6. What the engine must provide

These are decisions to make **now**, in the engine, because retrofitting them is expensive. This
is the concrete dependency the AI roadmap places on [02](02-technology-choice.md).

1. **Immutable state with structural sharing.** Everything above depends on cheap cloning. This is
   the single biggest divergence from HRF and the reason to take it.
2. **Seeded, explicit RNG carried in state.** Rollouts must be reproducible and branchable. Never
   call a global random inside a rule — the journal design already requires this.
3. **Headless engine, no DOM.** Already committed. Enables the Node arena and Worker execution.
4. **`legalActions(state)` as a first-class, cheap call**, with a way to cap or sample when the
   list is combinatorially large.
5. **Explicit horizon markers.** Chapter end and game end must be detectable from a state without
   pattern-matching on a continuation. HRF's `Milestone(CheckWinAction)` is the equivalent.
6. **An observed-state projection: `observe(state, faction) => ObservedState`.** Build it properly
   and make the bot take `ObservedState`, so a cheating bot is a type error rather than an
   oversight. This is HRF's no-op `cleanFor` done for real, and it is the prerequisite for honest
   determinization in V2/V3.
7. **Policy and value as separate injectable functions**, so bot versions are swappable in the
   arena.

## 7. Measuring whether a bot is actually better

Non-negotiable, and nearly free given the architecture: the engine is headless and a save is a
journal, so a **Node arena harness** that plays bots against each other and reports results is a
small amount of code.

- **Metric**: win rate and mean final power differential, plus ELO between bot versions.
- **Variance is the enemy.** Arcs has dice and card draw; small edges need hundreds of games to
  detect. Budget for that.
- **Use paired seeds (common random numbers).** Run both bot versions through the *same* seeded
  deals and dice, then compare. This removes most of the variance from the comparison and cuts the
  games needed by a large factor. It is the single highest-leverage trick here.
- **Regression suite**: golden journals — replay a recorded game, assert the final state hash.
  Catches rules changes silently altering bot behaviour.
- **Sanity opponent**: keep a random-action bot. Any change that loses to it has a bug, not a
  tuning problem.

## 8. Difficulty levels (decided: user-selectable)

### 8.1 The ladder

Two knobs produce all four levels, and both fall out of the architecture in section 2 rather than
needing bespoke code per level:

| Level | Policy deviation | Rollouts | Ships in |
| --- | --- | --- | --- |
| Easy | 25% | none | Phase 1 |
| Normal | 5% | none | Phase 1 |
| Hard | 0% | ~150 ms budget | Phase 1.5 (with V2) |
| Expert | 0% | ~600 ms budget, determinized hidden info | Phase 1.5 (with V2) |

**Deviation** is the probability of skipping the top-ranked action and taking the next one down
(HRF's `deviation` parameter, applied repeatedly). This is the right way to weaken a bot: it
occasionally takes the second- or third-best line, which reads as a plausible misjudgement.
Weakening by degrading the *evaluator* instead produces bots that hang pieces and feel broken.

### 8.2 Consequence for scope

Difficulty being user-facing **promotes rollouts from "next step" to a committed deliverable**.
Two heuristic levels alone is a thin ladder — Easy and Normal would differ only in how often the
bot fumbles, with no genuine increase in skill.

**Decided sequencing**, which preserves "heuristics are fine for v1":

- **Phase 1 ships the difficulty mechanism with Easy and Normal.** The selector, the persisted
  preference, the per-level config and the bot interface all exist and are exercised.
- **Hard and Expert are added with V2**, purely by populating two more config entries.

No UI change, no interface change, no migration. The mechanism is what phase 1 must get right,
not the number of rungs.

The load-bearing detail: the phase 1 difficulty config must already carry the rollout fields, set
to zero or absent, and the bot must branch on `budget > 0` rather than on a level name. If phase 1
types the config as `{ deviation: number }` and phase 2 widens it, that is a migration of
persisted user preferences for no reason.

```ts
interface DifficultyConfig {
  readonly label: string
  readonly deviation: number      // 0..1, probability of skipping the top-ranked action
  readonly rolloutBudgetMs: number // 0 in phase 1 — Easy and Normal never roll out
}
```

### 8.3 Implementation notes

- Difficulty is a per-seat setting, not per-game — mixed tables should be possible.
- Rollout levels **must** run in a Web Worker, and the time budget must be wall-clock, so a slow
  device produces a weaker move rather than a frozen tab.
- Show a thinking indicator for rollout levels. A bot that takes 600 ms silently reads as a bug.
- Add a floor on "thinking" time for the heuristic levels too. An instant response to a
  significant decision feels wrong even when it is correct.

## 9. Campaign support

Bots must eventually play the Blighted Reach campaign — deferred to phase 2 with the rest of it
(see [04 — scope and phasing](04-scope-and-phasing.md)), but with one consequence for phase 1.

Each of the 24 fates is an **alternate win condition**, so "maximise power differential" stops
being the objective. The value function therefore needs a per-fate override hook, and phase 1
must route all scoring through a single objective interface rather than hardcoding the power
differential as the only goal:

```ts
interface Objective {
  value(state: ObservedState, self: FactionId): number
  horizon(state: ObservedState): 'chapter' | 'act' | 'game'
}
```

Phase 1 has exactly one implementation. Phase 2 adds up to 24 more. Getting the indirection in
now costs almost nothing; adding it later means revisiting every heuristic.

## 10. Open questions

1. Should the bot be **observably explainable**? HRF carries a `desc` string on every
   `Evaluation` and has a debug UI for it. Cheap to keep and genuinely useful for tuning; worth
   deciding before the interfaces harden.
2. Do the difficulty labels need to be **calibrated against human play**, or is a self-play ELO
   ladder sufficient? Calibration needs playtesters and is the only way to know whether "Easy" is
   actually beatable by a new player.
