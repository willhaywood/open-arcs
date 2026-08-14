# Arcs Digital — AI implementation plan

docs/03 is the *approach* and is still sound. This is the plan to build it, written against the
engine as it actually stands rather than as docs/03 anticipated it. Read docs/03 section 2 first —
the value/policy split it argues for is the spine of everything below — and section 9a for how bot
seats work alongside humans.

## 0. What has been tried — read this before proposing anything

A register of what was **built and measured**, so nothing here gets attempted twice. Each row links
to the section with the numbers. The short version: **V1 with hand-set weights is the strongest bot,
and four separate attempts to beat it have failed for one shared reason.**

### The bot as it stands

`heuristicBot` — a hand-tuned linear evaluator, chapter-goal weighting, one ply of lookahead with
sub-flows resolved, no opponent modelling. It is what `apps/web` plays (`store.ts`). Three-player
mirror mean power went **2.5 → 16.7 → 22.8 → 24.5 → ~26** over this work, and **every one of those
gains came from fixing something the evaluator could not see, never from re-tuning what it weighed.**

### Tried and rejected — do not repeat

| attempt | result | section |
| --- | --- | --- |
| V2 rollouts, 2-turn horizon, trivial playouts | indistinguishable from V1 | 3a |
| V2 rollouts, better playout policy | still indistinguishable; V1 ahead on power | 3d |
| V2 rollouts, chapter-end horizon | V1 ahead on power in 3/3 configurations | 3e |
| Greedy-on-`valueOf` playout policy | unaffordable — one game did not finish in 10 min | 3d |
| Fitting weights by regression on returns | 18% wins vs V1's 64% — learns correlations | 3f |
| Iterating the fit (policy iteration) | R² collapses 0.216 → 0.018; strength flat at the floor | 3g |
| Regularising the fit toward the hand weights | recovers monotonically toward the prior, never past it | 3h |
| Fitting from choices (interventional pairs) | correct design, zero signal — label noise ~20x effect | 3i |
| Slot armour (`resourcesGuarded`) | **no measurable effect** — the gap *was* the noise floor, at both 120 and 1000 games | 3j |
| Lore activation (`loreLive`/`loreArmed`) | **measurably worse** — 2-3 points behind against a 0-1 point floor, in two variants | 3k |
| Per-rival intent in `valueOf` | **no measurable effect** — +3 points one run, level the next, floor 2 points; the probed-state variant livelocked and measured worse | 6 |
| Own-turn beam search at the card play (V3) | **small, real: ~+3 points** — five of six seats ahead across four runs and 3,996 games, past the pooled floor; wider beams add nothing | 7 |
| Opponent replies over determinized hands (V4) | **large: +12 points at 3p, 67%-33% at 2p vs a zero floor** — the first idea since the goal layer to clear its own floor in a single run | 8 |
| The Weapon's battle option as a feature (`battleUnlocked`) | **no measurable strength** — 1 point on a 1-point floor. Large *behavioural* effect: Weapon spending 1% → 26% | 9 |
| The residual hand as features (`handPips`/`handTopCard`) | **measurably worse** — 5-7 points behind standard on a ~zero floor. Priced the option, not its expiry: the bot hoarded cards the chapter clock kills | 15 |
| Ladder cut to three rungs; replies at `1x1` vs `3x2` | **v3 beam dropped** — not stronger than normal. **Replies measure identical at 1x1 and 3x2** (63% vs 64%, zero floor) at *half* the wall time, so no intermediate rung exists and `hard` is now `r1x1` | 14 |
| Ladder re-baselined after #18/#19 | **brutal unchanged** (64%-36% at 2p on a zero floor, third consistent measurement); **hard's inversion shrank to 1-3 points** — section 11's 8-9 point twinned rout was largely the dice tie-break inside the beam | 13 |
| Per-rival intent, **re-measured** under the p14 trophy rule | **the null flipped sign** — 4 points *behind* standard on a 2-point floor, where section 6 had it 3 ahead. Does not ship | 12 |
| Re-baselining the ladder after #15/#16/section 9 | **brutal holds** (65%-35% at 2p on a zero floor); **hard has inverted** — 2-9 points *behind* standard against a 1-point floor, where section 7 had it ahead | 11 |
| Easy rebased on the shipped weights | **not a strength idea** — it is the ladder's bottom rung. Uncovered a livelock in easy that predated it: 49 of 240 arena games unfinished, now 0 | 10 |

### Why they all failed, in one sentence

**There is no cheap, low-variance way to say what one action is worth in this game.** Rollouts need
it and cannot afford a policy good enough to provide it; every fitting route needs it and the label
noise swamps the effect. The same wall, four times.

Supporting numbers worth not re-deriving: the engine runs at **0.049 ms/action**; a full game is
**~24ms** as one playout; a V1 decision costs **~4ms**; and a choice-labelling pair carries **~9.6
power of noise against a ~0.5 power effect**.

The arena's noise floor, measured directly by twinning a bot against itself:

| games | win-rate gap between identical bots | mean-power gap |
| --- | --- | --- |
| 30 | ~20 points | — |
| 120 | 16 points | 1.9 |
| 1000 | **2 points** | **0.5** |

**A thousand games is what it costs to resolve a 2-point difference**, and with `--jobs 12` that is
about 40 minutes rather than the hours it once implied. There is no longer an excuse for running a
comparison without its twin.

### Measurement traps already paid for

- **Always run a noise floor.** `npm run arena -- --noise` duplicates a seat's bot under a second
  name; any gap smaller than the twins' own is not a result (section 3c).
- **12-game runs rank nothing.** Several early conclusions in section 2 were drawn from samples that
  cannot resolve what they claimed; the behavioural counts (pass:lead, cancels, secures) stand, the
  power deltas do not.
- **The arena is provably fair** — three identical bots come out exactly symmetric, and that is now a
  test. Null results from it are real nulls (section 3c).
- **`npm run typecheck` does not cover `scripts/`.** A badly mangled script typechecked clean.

### What would actually move it

Not another search or fitting idea. Both remaining levers are engineering:

1. **A cheaper engine.** `Tracker` copies whole `Map`s per update (section 1). Structural sharing
   cuts the cost of every playout, and playout count is exactly what the variance arithmetic is
   short of. Contained behind one module, and the highest-leverage change left.
2. **A cheap-but-strong playout policy** — what section 3d could not afford. Makes each playout a
   better estimate rather than needing more of them.

### Known evaluator blind spots

The three this section originally listed — **income invisible**, **planet types never read**,
**card suits in hand never read** — were all closed by the goal layer (section 4: `incomeFor`,
`feasibility`, `declareReadiness`). This note was stale for a while and read as open work; the worked
example ("three cities on Material planets and two Administration cards will not push for Tycoon")
is exactly what `feasibility` and `declareReadiness` now see.

Still open, and cheap to describe:

- **Rivals are scored under your own intent** (`valueOf`) — the bot cannot see what an opponent is
  going for, so it cannot deny. Addressed by section 6.
- **Court cards are priced by suit and keys only** (`courtWorth`) — no card text is ever read, so a
  swingy card and a dull one with the same suit and keys are the same card to the bot.

## 1. The seven prerequisites, verified

docs/03 section 6 lists what the engine must provide. It was written before most of the engine
existed, so every item was checked rather than taken on trust. Five hold, two do not, and one of the
two matters less than feared.

| # | Prerequisite | Status |
| --- | --- | --- |
| 1 | Immutable state with structural sharing | **Half.** Immutable yes; shared no — see below |
| 2 | Seeded RNG carried in state | **Holds.** `state.rng`, advanced explicitly |
| 3 | Headless engine, no DOM | **Holds.** Enforced by tsconfig — `lib: ["ES2022"]`, `types: []` |
| 4 | `legalActions(state)` as a cheap call | **Absent — and not needed** |
| 5 | Explicit horizon markers | **Holds, in the continuation** |
| 6 | `observe(state, faction)` | **Exists, and is not yet usable by a bot** |
| 7 | Policy and value as injectable functions | **Absent.** Nothing bot-shaped exists yet |

### 1 — cloning is a copy, and that turns out to be fine

`Tracker` updates copy the whole `Map` (`new Map(tracker.at)`, and again for `contents` and
`rules`), so state is immutable but **not** structurally shared. docs/03 called cheap cloning "the
single biggest divergence from HRF and the reason to take it", which implied a persistent data
structure.

Measured instead of argued — 568 real actions applied through `applyExternal`:

```
0.044 ms per action
=> a 200-action rollout ~ 9 ms
=> 1000 rollouts ~ 8.8 s
```

So the copy costs about 44µs. For V1, which applies one action per candidate to score it, that is
free. For V2 it sets the exchange rate: **a rollout is ~9ms, so an interactive budget of ~1s buys
roughly 100 rollouts**, not the thousands a persistent structure would allow. That is enough to be
meaningfully better than a one-ply heuristic and not enough for a strong MCTS.

**Do not pre-emptively rewrite `Tracker`.** Fix it if and when V2 rollout counts are the measured
bottleneck — the number above is the trigger to watch, and a persistent map is a contained change
behind that one module.

### 4 — `legalActions` is absent because the engine is ask-driven

The engine never exposes "what could be done"; it *offers* — every decision arrives as
`Continue.ask` with the legal actions already enumerated, filtered by `canTake` so nothing useless
is offered. A bot reads `cont.actions`.

That is better than the prerequisite asked for: the list is already legality-checked, already capped
by the engine's own pruning, and cannot drift from what a human is offered. **Close this item as
satisfied by a different shape**, and delete the "cap or sample when combinatorially large" worry —
the one place that would have bitten, the dice gather's 56 pools, is already enumerated compactly.

### 5 — horizon markers live on the continuation, not the state

`Continue` has `gameOver` (with winners and a reason) and `milestone`; `state.act` gives the chapter.
A rollout drives the engine anyway, so it sees the continuation — this is satisfied *for rollouts*.
It is not satisfied for "score an arbitrary state", which V3 may want. Note it; do not act yet.

### 6 — `observe` omits your own hand, deliberately

`observe.ts` strips `rng` and `journal`, which is the point, but it also carries no `cards` at all —
its own comment says never to widen it. So today a bot cannot see **its own hand**, which makes it
unable to lead a card.

This is the one real blocker and it is small: `observe` needs to gain *your* hand while continuing
to omit everyone else's. The comment is right that widening carelessly is how a cheating bot gets
built by accident; the fix is a deliberate `self`-scoped field, not a relaxation.

### 7 — nothing bot-shaped exists

No `ValueFn`, `PolicyFn`, or bot registry. Expected — this plan builds them.

## 2. V1 — the heuristic bot, to a playable seat

The goal is a seat you can play against, not a strong opponent.

1. **`observe` gains your own hand.** `ObservedState` gets `hand: readonly string[]` populated for
   `self` only. Everything else stays omitted. This is first because everything else needs it.
2. **`options.bots`** — which seats are bots, recorded in options so a loaded save knows to compute
   rather than prompt (docs/03 section 9a). Journal and replay are unaffected.
3. **`ValueFn` and `PolicyFn`** as docs/03 section 2 defines them, in a new `packages/engine/src/ai/`
   — inside the engine because the arena and the Worker both need them, and the engine has no DOM.
4. **The value function**, per docs/03 sections 3.1–3.3: relative to opponents, positional terms,
   ambitions driving the weights — biased by the chapter intent of section 2b, without which the
   bot has no goals at all and simply drifts.
5. **`chooseAction`** — `maxBy(actions, a => value(advance(state, a), self))`. One ply, deterministic,
   no RNG. Deterministic matters beyond tidiness: it is what lets any client run a bot in
   multiplayer without the game forking (docs/03 section 9a).
6. **The hotseat loop** — when `cont.faction` is a bot seat, compute and `applyExternal`. This is the
   whole of "bots alongside humans" in the local game.
7. **UI**: bot turns need to be *watchable*, not instant. A short delay per action and the existing
   log are probably enough; the action tray already shows what is being chosen from.

**Done when:** you can start a 4-player game with three bots, play a full game against them, and the
journal replays.

## 2a. Watching the bot play

A bot that resolves its turn instantly is unreadable, and three bots resolving instantly means the
board simply changes while you blink. The 4X convention — Civilization's between-turns phase, Old
World's, Endless Space's — is worth copying almost exactly: **one action at a time, paced, on the
map, with a line saying what and why, and a way to skip.**

This is not polish to add at the end. It **constrains the V1 interface**, so it is decided here.

### It answers an open question in docs/03

docs/03 section 10 asks: *"Should the bot be observably explainable? HRF carries a `desc` string on
every `Evaluation`... worth deciding before the interfaces harden."*

**Decided: yes, and it is not optional.** If the player must be able to follow what the bot is doing,
the reason has to come from the thing that made the decision — reconstructing it afterwards from the
board is guesswork, and a narration that guesses will eventually lie. So `chooseAction` returns a
decision, not an action:

```ts
interface BotDecision {
  readonly action: Action
  /** One line, player-facing: "Taking 2-Arrow — it is the last Fuel I need for Tycoon." */
  readonly because: string
  /** Optional, for the debug view: the candidates and their scores. */
  readonly considered?: readonly { action: Action; score: number; note?: string }[]
}
```

`because` is written for a player, not a developer. `considered` is the tuning surface and stays out
of the normal UI. Both are free at V1 — the value function already computes the scores — and both are
expensive to retrofit once every call site expects a bare `Action`.

### The component

A **bot turn banner**, on the same terms as the Prelude tray and the action tray: across the bottom
of the map, map still visible, because what the bot is doing is *on the map*.

Per action it shows the faction, the action in plain language, and the `because`. It reuses what
already exists rather than inventing a second vocabulary:

- **The map highlights the systems involved** — `Reticle` and the curved routes already drawn for
  Move and Battle targeting.
- **`CardPill`** when a card drove the decision, so you can read the card that just hit you.
- **The dice tray** for a bot's battle, unchanged. A bot rolling should look like you rolling.

### Pacing

- **One action per beat**, ~700–900ms, with the map highlight leading the text slightly.
- **Battles slow down**, because they are the actions with consequences you need to see: dice land,
  hits are assigned visibly.
- **A speed control and a skip.** Anyone replaying a long game wants it faster; anyone who has seen
  enough wants it over. Both are settings, not per-turn prompts.
- **Pause on anything aimed at you** — a raid, a battle against your ships. The default should be
  that you never miss something that changed your position.

### Two things the pacing must not do

- **It must not enter the journal.** Delays are presentation. The journal records the bot's actions
  and nothing else, so a paced game and a skipped game produce identical saves — and `applyExternal`
  is still the only way a decision lands.
- **It must not break undo.** Undo replays the journal minus its last entry, so undoing into a bot
  turn means the bot's actions are simply there. Whether undo should step back *through* a bot's
  whole turn or one action at a time is a real question — one action is the honest default, since
  that is what the journal holds.

### Where it lands in the order

Between steps 2 and 3 of section 5: the pacing loop and the banner are built against the **trivial**
bot, before any evaluation exists. A bot that plays badly but visibly is the right thing to debug the
presentation against, and it keeps `because` honest from the first line of it — the trivial bot's
reason is "first legal action", which is exactly what it is doing.

## 2b. Does it have goals? Not as docs/03 proposes it — and it needs them

Worth stating plainly, because the answer is easy to miss: **V1 as docs/03 describes it has no
goals.** `chooseAction` is `maxBy(actions, a => value(advance(state, a), self))` — a stateless,
one-ply greedy maximiser. It re-derives what matters from scratch at every decision and remembers
nothing between them.

### Ambition-weighted is not the same as intentional

docs/03 section 3.3 gets close enough to be mistaken for goals. Resource worth scales with the
pending payout of the ambition it feeds, so a heavily-stacked Tycoon makes Material genuinely
precious. That is real and it should be built — but it is a *weighting*, not a plan. The difference
shows up as drift:

- It banks Material while Tycoon looks rich, then abandons it the moment the board shifts, having
  spent three turns on a position it no longer wants.
- It declares an ambition it is not set up to win, because declaring scores well *this instant*.
- It cannot reason "I declared Tycoon, so the next three turns are about holding Material" — the
  commitment is in the game state, but nothing carries the *consequence* forward.

docs/03 section 3.4 is honest that ambition declaration timing and the card economy are where a
one-ply bot is weak. What it does not say is that those are the same weakness twice: **no
representation of intent across a chapter.**

Arcs punishes this harder than most games would. An ambition declared is a commitment whose payout
lands at chapter end, and the whole shape of a good turn is "what am I building toward by then".

### Chapter intent, and the constraint that shapes it

The fix is small and belongs in V1: an explicit **chapter intent** — which ambitions this bot is
contesting and roughly how hard — that biases the value function rather than replacing it.

The constraint is the interesting part. **Intent must be a pure function of observed state, not
remembered.** It cannot be stored on the bot:

- The journal holds actions, not the bot's mind. Reload a save and remembered intent is gone, so the
  bot's plan would silently change mid-game.
- In multiplayer any client may run a bot (docs/03 section 9a). Two clients with different remembered
  intent choose different actions, and the game forks by who posted first.

So: `intentFor(observed, self) => ChapterIntent`, recomputed every decision, deterministic. It is
"read the board and work out what I am going for", not "recall what I decided". Stable across
recomputations by construction, because the inputs only move when the board does.

That also makes it *hysteretic* by design rather than by accident — if intent is derived from
declared markers, held resources and position, it stops flapping between turns because those inputs
do not flap. Where it should deliberately resist changing (having committed to an ambition), that is
a term in the derivation, not a stored flag.

### It is also what makes the narration worth reading

Section 2a wants a player-facing `because` on every decision. Without intent the best that can
honestly be said is "this scored highest" — true, useless, and identical every turn.

With intent the same machinery says *"Taking 2-Arrow — it is the last Fuel I need for Tycoon"*,
which is the sentence a player actually wants. The `because` and the goals are the same feature seen
from two ends, which is a good sign the abstraction is the right one.

### What it does not fix

Intent is a heuristic prior, not foresight. It will still misjudge *when* to declare and will not
reason about bluffing or the card economy. Those need rollouts, and V2 is still where they get
closed. Intent makes V1 coherent; it does not make it strong.

## 2c. Prior art worth reading

Four references, chosen because each answers a problem this plan actually has rather than because
they are famous.

### Civilization V — Grand Strategy AI (the closest match to section 2b)

**This is the chapter-intent design, shipped.** Civ V's AI scores each victory type for priority,
picks a grand strategy, and that choice then *modifies its personality flavors* — the weights every
subordinate decision already used. It does not bolt a planner on top of the evaluator; it biases the
evaluator. Which is precisely what section 2b proposes, with ambitions in place of victory types.

Read `CvGrandStrategyAI.cpp` — the Civ V DLL is public and browsable in
[DelnarErsike's fork](https://github.com/DelnarErsike/Civ5-Artificial-Unintelligence-DLL/blob/master/CvGameCoreDLL_Expansion2/CvGrandStrategyAI.cpp);
[the modding wiki](https://modiki.civfanatics.com/index.php?title=CIV5AIGrandStrategies) explains the
flavor mechanism around it.

Two things to take, one to leave:

- **Take: intent as a bias, not a branch.** One evaluator whose weights move, rather than separate
  code paths per plan. Keeps the value function the single long-lived asset (docs/03 section 2).
- **Take: re-evaluated periodically, not once.** Civ V recomputes rather than committing forever,
  with hysteresis so it does not flap. Our version is stronger — recomputed *every* decision, which
  it must be, since intent cannot be remembered (section 2b).
- **Leave: personality flavors.** Civ V's leaders have intrinsic biases so Gandhi plays unlike
  Alexander. Tempting, and wrong here — an Arcs faction's character comes from its leader card and
  its cards, which are already in the state the evaluator reads. Inventing a second personality layer
  would double-count it.

### haunt-roll-fail — `BotEOC`

Already our rules reference, and docs/03 section 2 dissects its central mistake: it scores actions
directly, so it cannot reuse that evaluator for rollouts and carries a second scalar `vp()` just for
playout results — two hand-maintained schemes that can disagree. Worth reading precisely because it
is Arcs, and because the trap is visible in it.

### Recommended, not re-verified for this plan

Named from general knowledge; check before relying on details.

- **0 A.D.'s Petra AI** — an RTS rather than 4X, but written in JavaScript and readable, with an
  explicit planning layer over queues of goals. Closest thing to a legible worked example in a
  language we can read at speed.
- **Freeciv's "want" system** — evaluation expressed as competing desires with magnitudes, which is
  a good shape for "how much do I want this Material" and maps well onto section 3.3's
  ambition-scaled resource values.
- **FreeCol's `Mission` objects** — goals attached to units. Instructive as the *opposite* choice to
  Civ V's: explicit goal objects rather than weight-biasing. Worth reading to be sure we prefer the
  Civ V shape, given section 2b's constraint that intent cannot be stored.

### What none of them solve for us

All four have a mutable world and a bot that may remember. **Ours may not** — intent has to be
recomputed from observed state every decision so that a reloaded save and another player's client
reach the same answer (section 2b). Borrow the *shape* of Civ V's grand strategy; do not borrow its
storage.

## 2d. The design, concretely

Everything above is shape. This is what gets built.

### 2d.1 The decisions a bot actually makes

The engine is ask-driven, so the bot's job is exactly: answer every `Continue.ask` addressed to it.
Grouped by how much thought each deserves — and they differ by an order of magnitude, which is where
the effort should go:

| Decision | Weight of thought |
| --- | --- |
| **Lead / surpass / copy / pivot / pass** | **Highest.** Sets the suit, the pips, and the whole turn |
| **Declare an ambition?** | **Highest.** A chapter-long commitment |
| Prelude spends | Medium — cheap resources for real actions |
| Which standard action per pip | Medium — but constrained by the suit already chosen |
| Where to move / build / tax | Low — mostly forced once the action is picked |
| Dice pool, hit assignment | Low — near-mechanical, and a bad choice is survivable |
| Raid purchases, court picks | Medium — these are card acquisition, which compounds |

**Implication for V1: spend the budget on the first two.** A bot that leads sensibly and declares
sensibly while placing ships greedily plays far better than the reverse, and it is also the version a
human notices is thinking.

### 2d.2 What is computed at the start of a bot's turn

One assessment, before the lead decision, reused by everything downstream. All of it derived, none
of it stored.

```ts
interface TurnAssessment {
  intent: ChapterIntent          // 2d.3
  standings: AmbitionStanding[]  // per ambition: my rank, the gap, the payout
  threats: Threat[]              // systems of mine a rival can reach and take
  reach: Opportunity[]           // systems I can take, and what they are worth
  clock: { chapterTurnsLeft: number; cardsInHand: number }
}
```

`clock` matters more in Arcs than it looks. An ambition is scored at chapter end, so the *same* board
is worth different amounts depending on whether there are four turns left to improve it or one turn
left to defend it. A bot with no clock over-invests late and under-commits early.

### 2d.3 Intent: inputs, output, and why it does not flap

```ts
interface ChapterIntent {
  /** Ambitions this bot is contesting, with how hard. 0..1, and they sum to about 1. */
  readonly pursuing: ReadonlyMap<Ambition, number>
  /** Where power is expected to come from — used for narration as much as weighting. */
  readonly summary: string
}
```

**Derived only from slow-moving inputs**, which is the trick that keeps it stable inside a turn
without any memory:

- Ambitions declared this chapter, and their marker values
- Ambitions still available to declare, and their best markers
- My *structural* standing — cities, starports, trophies, captives, systems ruled
- Chapter number and turns remaining
- Opponent standings in each ambition

**Deliberately not derived from what I am about to spend.** If intent read my Material directly, then
spending Material mid-turn could flip intent mid-turn and the bot would contradict itself between two
actions of the same turn. Resources feed the *value function* (2d.4), not the intent. That separation
is the whole reason this works without memory.

Rough derivation: for each ambition, `appetite = payout × myStructuralFitness × (1 − contest)`,
normalised. Committed ambitions get a bonus term so a declaration is sticky — the hysteresis Civ V
gets from re-evaluating periodically, we get from the input itself.

### 2d.4 The value function, in units of power

**Every term is expressed as expected power**, which is what makes them addable and what makes the
number mean something. docs/03 section 3.1 requires it to be *relative*, so:

```
value(state, self) = myPower(state) − max(opponentPower(state))
```

where `myPower` is realised power plus expected power, summed over:

| Term | Roughly | Notes |
| --- | --- | --- |
| Realised power | ×1.0 | Already scored. The only certain term |
| Ambition standing | payout × P(hold it to chapter end) | The dominant term mid-chapter |
| Resources held | ambition-scaled (docs/03 §3.3) | Worthless unless they feed a contested ambition |
| Cities / starports | ×~2 each, plus what they unlock | Also capacity, tax income, build sites |
| Ships | fresh ≫ damaged | Damaged rule nothing — see the catapult bug in docs/15 |
| Court cards held | ×~1 plus ability value | A guild's suit scores like a resource *and* its ability is live |
| Trophies / captives | payout-scaled | Only worth anything if Warlord/Tyrant is live |
| Initiative and hand | small, positive | Tempo; hard to price, easy to over-price |

**These multipliers are starting points to tune, not derived truth.** Section 5's arena exists to
move them, and any number written here that survives untouched to V2 should be treated as suspicious
rather than confirmed.

### 2d.5 How intent biases it — one multiplication, not a second code path

Following Civ V (2c): intent moves weights, it does not branch.

```ts
const weighted = (term: Term) =>
  term.base * (term.ambition === undefined ? 1 : 0.5 + 1.5 * intent.pursuing.get(term.ambition) ?? 0)
```

An ambition the bot is not pursuing keeps half weight — not zero, because a free Relic is still a
free Relic and a bot that ignores everything off-plan is exploitable. One pursued hard reaches 2×.
The value function stays one function; only the coefficients move.

### 2d.6 A worked turn

Chapter 2, Tycoon and Warlord declared. The bot holds four Material, two cities, an average fleet.

1. **Assess.** Tycoon payout is high and it is second by one Material — `intent.pursuing` comes out
   Tycoon 0.6, Warlord 0.25, rest 0.15. `summary` = "holding Material for Tycoon".
2. **Lead.** Candidate cards scored by one-ply value with those weights. Material-securing lines
   score up; a Warlord-chasing battle scores at 0.25 weight and loses. It leads Construction.
3. **Declare?** Tycoon is already declared, so the question is whether to add another. Declaring
   Empath scores badly — no psionics, no structural fitness — so it declines.
4. **Prelude.** Spends a Weapon it is not using. Keeps Material: the resource term is at 2× weight.
5. **Pips.** Build in a system that gains a Material slot; tax a city for Material.
6. **Narrate.** Each action carries `because` from the same numbers: *"Building at 3-Arrow — one
   more Material slot for Tycoon."*

The narration is not a separate story about the turn. It is the top term of the decision that was
actually made, which is why it cannot drift from the behaviour.

### 2d.7 What gets tuned, and how you know

Never by eye. `ValueFn` is swappable (docs/03 section 6.7), so the arena plays weight-set A against
weight-set B over many seeded games and reports a win rate. That is the whole method, and it is why
the arena is sequenced *before* V2 in section 5 — without it, "the bot feels better" is the only
available evidence, and it is worthless.

The first three things worth tuning, in order: the ambition-standing term (dominant), the resource
scaling (docs/03 §3.3's floor and multiplier), and the intent bias range (the `0.5`/`1.5` above).

## 2e. The diagnostic panel, and taking the wheel

Section 2a is for the player: one line, paced, in the game's own voice. **This is for us**, and it is
a different tool with different rules. Building the bot without it means tuning weights by watching
a game and guessing — which is how you end up with a value function nobody understands.

### Three modes

| Mode | What it does |
| --- | --- |
| **Run** | Bot plays its turn at the section 2a pacing. The normal experience |
| **Step** | Pause *before* each bot action. Show what it is about to do and why. Advance on a keypress |
| **Take over** | Play the bot's decision yourself, from the ordinary UI |

**Take over is the one that earns its keep.** Being told the bot scored `Build at 3-Arrow` highest is
weak evidence; discovering you would have done something else, and then reading why it disagreed, is
how a bad weight gets found. It is the fastest route from "the bot feels wrong" to "the ambition term
is over-weighted relative to tempo".

### What the panel shows

Everything behind the decision, from the same computation that made it:

- **The assessment** (2d.2) — intent with its per-ambition appetites, standings, threats, reach, and
  the clock. The inputs, so a wrong decision can be traced to a wrong reading of the board.
- **The candidates** — every action considered, its score, and the term breakdown of each. This is
  `BotDecision.considered` from 2a, which exists for exactly this.
- **The chosen action's terms**, itemised in power. "Ambition standing +3.1, resources +0.8, tempo
  −0.4" is a debuggable sentence; "score 3.5" is not.
- **The `because` line**, shown next to the numbers that produced it — so a narration that has
  drifted from the arithmetic is visible immediately.
- **A diff against the runner-up.** Usually the interesting question is not why it chose X but why it
  chose X *over* Y, and the term-level difference answers that directly.

### Two rules the panel must obey

**It must show the decision, not a re-run.** Compute once, display what was computed. Recomputing for
the panel means debugging a function that is not the one playing — and if the bot is ever
non-deterministic by accident, a re-run hides exactly the bug you needed to see.

**An overridden turn must be marked, and must never become tuning evidence.** This is the trap: the
journal records actions, not who chose them (docs/03 section 9a), so a game where you took over half
the bot's turns is indistinguishable afterwards from one it played alone. Tune against that and you
are tuning against yourself. So the session marks overridden decisions, the panel shows a count, and
**the arena refuses any game containing an override** as a strength measurement.

### Where it lives

Dev-only, behind a flag, not in the shipped build. It reads `BotDecision` and the assessment — both
already needed by the bot itself — so it is a *view*, and adds nothing to the engine. The strength of
this design is that the panel cannot alter play: everything it shows is a by-product of the decision
already made.

### When to build it

**With the trivial bot, before any evaluation exists** — same slot as the banner in section 5. The
panel is what makes the first real value function tractable to develop, so having it working
beforehand against a bot whose reasoning is "first legal action" means the harness is proven when the
interesting part starts. Building it after V1 means writing V1 blind.

## 2f. Where this got to — handover

Steps 1–5 of section 5 are built. What follows is the state, and the findings that should change
what happens next.

### Built and tested

| | |
| --- | --- |
| `observe` | Carries every public zone plus **your own** hand and public hand sizes. Hidden: `rng`, `journal`, rivals' hands, `unusedLore`. |
| `options.bots` | Which seats a bot plays, in options so a *load* knows to compute rather than stall. |
| `Bot` / `BotDecision` / `Lookahead` | A bot takes `ObservedState` and returns a decision carrying a player-facing `because`. |
| `trivialBot` | First legal action. Proves plumbing; the arena's control. |
| `isBotSeat` / `botToAct` / `stepBot` / `stepBots` / `runBots` | One loop for hotseat, arena and multiplayer. |
| `BotPanel` | Run / step / take-over, paced narration, diagnostics table, override counter. |
| `intentFor` | Chapter goals, derived from observed state, never remembered. |
| `valueOf` / `termsFor` | Position worth in expected power, relative to the best opponent, intent-biased. |
| `heuristicBot` | One-ply search over the above. **Plays worse than the trivial bot** — see below. |

### The finding that should shape V2

`heuristicBot` **passes immediately**. Four decisions, chapter over, nobody scores. The diagnostics
say exactly why:

```
red — offered 7
    -0.15  Pass
    -0.30  Lead Mobilization-7
    -0.30  Lead Aggression-2
```

Every option is negative and the gap is one card of tempo. **Not a weighting error.** One-ply
lookahead after "lead a card" lands *mid-turn* — on the declare prompt or the Prelude — where the
board has not moved. The cost of the card is visible; the payoff, several decisions later when the
pips are spent, is not. Zeroing the tempo term does not help: Pass and Lead then tie at 0.00 and
offer order decides.

This is docs/03 section 3.4 confirmed empirically — *"lead/surpass/pass pay off over a whole round;
a static evaluator sees only the immediate board"* — and it lands on the **highest-weight decision in
the game** (section 2d.1), which makes it fatal rather than a rough edge.

Three ways out, in the order I would try them:

1. **The arena first.** Section 5 already sequences it before further tuning, and this is the case
   that proves why: three plausible fixes and no way to rank them by eye. The trivial bot is the
   baseline, and "does it still pass on turn one" is the first measured question.
2. **Look past the lead.** Advance through the Prelude to the first pip before scoring the lead
   decision. Targeted and cheap — and honestly no longer one-ply, which is worth admitting rather
   than describing as V1.
3. **Straight to V2 rollouts.** The designed answer. At ~9ms a rollout a lead decision affords ~100,
   and rollouts see the payoff by construction.

Option 2 is a smaller step than it looks and may be enough to make V1 playable; option 3 is the
plan. Do not simply re-tune the weights — the information is not present at one ply, so no weight
fixes it.

### Traps found along the way, worth not repeating

- **A leak test that could not fail.** `observe`'s test scanned `JSON.stringify(view)` for rival
  card ids — but the zones are `Tracker`s built on `Map`, and `JSON.stringify(new Map())` is `{}`.
  A projection leaking every hand passed clean. Anything asserting over engine state must walk Maps
  by hand.
- **Intent flapped through `contest`.** It read my own metric, so *spending* Material lowered my
  appetite for the Tycoon I was spending it on, between two actions of one turn. The rule is sharper
  than "do not read resources": intent must not move across **my own** actions, so rivals' positions
  are safe to read and mine are not.
- **A React store that emitted without changing.** `setBotMode` updated state and emitted, but
  `getSnapshot` returned the unchanged `result`, so `useSyncExternalStore` reused the render and
  take-over silently did nothing. Presentation state needs its own primitive snapshot.
- **One weight is knowingly untested.** The "already declared is stickier" multiplier fails no test
  when removed, because declaring also moves the payout term. An isolating test was written, passed
  for an unrelated reason, and was deleted rather than kept — it is flagged in the source.

## 2g. The arena, and what it measured

Step 6 of section 5, built before V2 exactly as sequenced. `packages/engine/src/ai/arena.ts` plus
`npm run arena`; the fast seeded properties live in `test/arena.test.ts`.

```bash
npm run arena -- --games 40 --seats heuristic,trivial,trivial,trivial
```

Per bot it reports **wins**, **outright wins**, **mean rank** and **mean power**, aggregated across
the seats that bot played. Four numbers rather than one because a win rate at four seats is thin,
and because two of them exist to stop the report lying:

- **Seats rotate between games.** Seat order matters in Arcs, so a fixed assignment measures the
  seat. A game count that is not a multiple of the seat count is reported as unbalanced rather than
  quietly averaged.
- **Outright wins are separated from tie-break wins.** `performCheckWin` reduces over
  `state.factions` keeping the first on equality, so when nobody scores the first seat "wins" every
  game. Without that split, four bots doing nothing would read as one bot at 100%.

### It found a livelock on its first real run

`heuristicBot` never finished a game: twenty thousand actions, still in chapter one, swapping two
resources back and forth. `valueOf` prices resources by type and never by slot, so every swap scored
*exactly* what `Done` scored, and the first-offered tie-break picked a swap. Forever.

**No pure position-scoring bot can escape that** — identical position, identical choice, by
definition of purity. So the fix could not be a weight; it had to be information, and the only thing
distinguishing a swap from `Done` is that one leaves you facing the same question. The harness holds
the continuation and the bot does not, so `Lookahead` now returns a `Probe` carrying `repeats`, and a
repeating action must **strictly improve** the position to be eligible at all. Termination is then a
property rather than a hope: every repeat raises a bounded quantity.

Three attempts at that were wrong, and each is worth not repeating:

1. **Tie-breaking toward progress.** Not enough. The options that *did* make progress placed the
   arriving token by discarding something, so they scored strictly lower — the swaps were not tied
   for best, they were best.
2. **"Have I seen this question before?"** Over-fires. `Done` returns to the Prelude, which has also
   been asked, so it condemned the only way out as hard as the loop. Both re-enter; only one goes
   backwards. Comparing *positions in the turn* separates them — unwinding to an earlier question is
   how a sub-decision ends.
3. **Resetting the history when the acting seat changes.** Not a turn boundary. A faction whose turn
   ends a round then *leads* the next, so two of its turns run back to back with nobody asked in
   between. `stepBot` now derives the boundary from the state itself, so no caller can get it wrong
   — which two of them, including a throwaway probe, already had.

A livelock presents as **slowness, not failure**: deleting the fix and re-running the tests did not
fail them, it hung for ten minutes. Hence `stuckAfter`, and hence the tests carry an explicit bound.

### The measurements

40 games each, seats rotated. Four equal seats would win 25%.

| matchup | bot | wins | outright | rank | power |
| --- | --- | --- | --- | --- | --- |
| heuristic v 3 trivial | heuristic-v1 | 73% | 73% | 1.35 | 28.3 |
| | trivial | 9% | 9% | 2.81 | 8.6 |
| 2 heuristic v 2 trivial | heuristic-v1 | 38% | 38% | 1.90 | 21.3 |
| | trivial | 13% | 10% | 2.96 | 11.1 |
| mirror (4 heuristic) | heuristic-v1 | 25% | **9%** | 1.69 | **2.2** |

**V1 beats the trivial bot convincingly**, which section 2f set as the bar it had to clear.

### The passing bug is not fixed — it was hidden

The mirror row is the finding. Four heuristic bots produce **89 decisions per game against ~720**,
**2.2 mean power**, and wins that are 91% faction-order tie-breaks. Counting what they actually
choose settles the mechanism:

```
74 decisions:  32 turn/pass   4 turn/lead   8 action/take   ...
```

**Eight passes for every lead.** The bot barely ever leads; it follows other people's cards and
plays those pips competently, which is why it looks strong against a trivial bot that keeps leading
and why the 1v3 number is flattering. Put four of them together and nobody starts a round.

This is section 2f's diagnosis confirmed rather than removed: one-ply lookahead after "lead a card"
lands mid-turn, before the board has moved, so the card's cost is visible and its payoff is not. The
loop-breaking made games *finish*; it did not give the evaluator sight of a lead's payoff.

It also settles the ranking that 2f could not do by eye:

- **Option 1, the arena.** Done. It is the only reason we know the 73% was flattering.
- **Option 2, look past the lead.** Now the cheap thing to try, and cheap to *judge* — the mirror
  match is a direct read of whether the bot will lead, and the pass:lead ratio is the metric.
- **Option 3, V2 rollouts.** Still the designed answer, and now measurable against a baseline
  instead of against an impression.

### Worth knowing before the next change

- **Run the mirror, not just 1v3.** A bot that free-rides on opponents who play scores well against
  a bot that plays badly. Only the mirror exposes a strategy that cannot start a game.
- **Mean power is the honest number.** Wins and rank both looked respectable in the mirror (25%,
  1.69) for four bots that did almost nothing.
- **The browser still runs `trivialBot`.** `store.ts` was never switched to the heuristic bot, so
  the panel demonstrates plumbing rather than play.
- **Games are cheap**: ~25ms for a trivial game, ~600ms with one heuristic seat. Hundreds of games
  per run is affordable, so no result here needs to rest on a small sample.

## 2h. Fixing the lead decision

Section 5 step 7, and the fix section 2g's mirror match made measurable.

### The bug was a blind spot, not a weight

Leading a card costs a card — which `valueOf` charges 0.15 of tempo for — and buys three actions,
which **nothing counted**. Pips are not in the state; they live on the continuation (section 1.5),
so `valueOf` structurally cannot see them. Every card therefore scored below `Pass`.

Two changes, and the first is useless without the second:

1. **`settle`** advances a probed position past the optional steps between choosing a card and
   spending its pips — declining the declare prompt and the Prelude — so every candidate is scored
   at the same point in the turn. Candidates were previously compared *at different moments*:
   `Pass` after your turn, a card three decisions before yours had happened.
2. **`Probe.actionsAhead`** reports the pips waiting at that horizon, and `heuristicBot` prices them
   at `PIP_VALUE = 0.5`.

Settling alone changed nothing at all — measured, not assumed. The board has not moved at the pip
ask either, so the position looks identical until the pips themselves are priced.

**This is honestly no longer one-ply.** It is one decision evaluated at a comparable horizon, which
is what section 2f option 2 proposed; calling it one-ply would be a fiction.

### What it did

Three-player Frontiers, 12 games, and the four-player runs beside them:

| | before | after |
| --- | --- | --- |
| 3 heuristic — mean power | 2.5 | **16.7** |
| 3 heuristic — decisions/game | 86 | **836** |
| 3 heuristic — outright wins | 8% | **31%** |
| 1 heuristic v 2 trivial — wins | 58% | **100%** |
| 1 heuristic v 2 trivial — mean power | 24.2 | **33.9** |
| 4 heuristic — mean power | 2.2 | **13.3** |
| pass : lead in a mirror | 32 : 4 | **72 : 71** |

The mirror now out-scores three trivial bots (16.7 against 10.7), which is the comparison that
matters — a bot that free-rides on opponents who lead can beat the trivial bot without being able to
play a game.

### The trap, worth not repeating

Pricing pips **brought the livelock straight back**, because the progress gate compared the
pip-inclusive score against `here`, which has no pip term. Every candidate then looked like an
improvement and the gate never fired. The gate asks "did that achieve anything", so it must compare
board value with board value — pips still to spend are potential, not achievement. It is gated on
`gained` and ranked on `score`, and the mutation that conflates them is covered.

A second, milder one: fixing the lead changed which sub-decisions the bot enters, and the unwind
test stopped finding its case on seed 1. Its own "did this test verify anything" guard caught that
rather than the test quietly passing — it now sweeps seeds.

### Still open

- `PIP_VALUE` is a flat rate, and a pip is worth what you do with it. Build and Move are not the
  same thing. This is the cheap answer; the honest one is a rollout.
- `settle` declines optional steps rather than playing them, so a card whose value is the *declare*
  it enables is still undervalued.
- The browser still runs `trivialBot` — switching `store.ts` is now worth doing.

## 2i. A decision is final

Watching a game in the browser raised a question the arena had not asked: the fleets were huge and
almost nothing was fighting. Counted rather than guessed, across one three-player game:

| | battles started | dice rolled | cancels |
| --- | --- | --- | --- |
| heuristic | 19 | **4** | **31** |
| trivial | 28 | 28 | 0 |

**The pip term was paying the bot to run away.** An action landing mid-battle has no pip ask to
read, so `actionsAhead` reported 0 for every roll, while the `Cancel` beside it returned to the pip
ask and reported 1 — half a pip for abandoning the fight. `actionsAhead` of zero means "cannot
tell" as often as it means "nothing left", and nothing distinguished the two.

**Rollbacks are now excluded from the candidate set before anything is weighed.** Cancel exists for
a human who clicked into the battle screen and changed their mind; it is an interface affordance,
not a move.

Keyed on the **label**, because the type cannot tell them apart: `action/skip` is `Cancel` when it
abandons an action and `Done` or `Stop here` when it completes one, and a leader's exit is `Cancel`
before it places anything and `Done` after. The label is the distinction the engine actually draws.

**Pricing them differently was tried first and was measurably worse** — zeroing the pip credit on any
action that unwinds cost 3 mean power a game (19.6 against 22.8), because the same adjustment docked
the legitimate `Done` that ends a sub-decision and returns to spend pips. Excluding the affordance
is both simpler and stronger, so the `unwinds` flag was removed rather than kept.

| three-player, 12 games | trivial | heuristic |
| --- | --- | --- |
| mean power | 10.7 | **22.8** |
| power scored by everyone | 32.0 | **68.3** |
| battles started : rolled | 28 : 28 | **20 : 20** |
| v two trivial — wins / power | — | **100% / 33.7** |

## 2j. Choosing which action to take

The court work (section 2i's successor) went in and the bot still secured nothing — offered Secure
15 times a game, taken 0. Reading the scores rather than reasoning about them found why:

```
8.267  Battle
8.267  Move
8.267  Secure
7.267  End turn (forfeit 2)
CHOSE Battle
```

**Identical, to three decimal places.** Every standard action leads to a *sub-ask* — which system,
which ships, which card — where the board has not moved. So they tie, and offer order decides. The
bot battled because Battle is listed first, and never secured because Secure never is.

The same blind spot for the fourth time, and the one that could not take another targeted term:

| blind spot | symptom | fix |
| --- | --- | --- |
| pips a card buys | never led | priced pips |
| a battle in progress | cancelled 31 of 35 | excluded rollbacks |
| agents toward securing | never played the court | priced claims |
| **which action to take** | **offer order decided** | **resolve the sub-flow** |

### The fix

`settle` now **resolves** a sub-flow instead of stopping at it, using `bot.decide` one ply deep. The
distinction it draws is between two things that both look like "another ask":

- **Optional steps are still declined** — the declare prompt, the Prelude. The bot will be asked
  those for real and can evaluate them then, so choosing here would pre-empt a decision with a guess.
- **Sub-flows are resolved.** "Battle — choose a system" is not a separate decision, it is the rest
  of the one being scored.

Reusing `bot.decide` keeps the two consistent — a bot that would choose this target for real chooses
it here — and costs no new interface. The inner lookahead deliberately does **not** settle again:
otherwise scoring one candidate resolves a sub-flow whose every candidate resolves a sub-flow, and
the work compounds.

### What it did

| three-player, 12 games | before | after |
| --- | --- | --- |
| v two trivial — mean power | 33.7 | **38.3** |
| mirror — mean power | 24.4 | 24.5 |
| secures per game | 0 | 2 |
| influences per game | 11 | 16 |
| runtime, mirror | 12.7s | 44.4s |

**Head-to-head it is a clear gain; the mirror barely moves.** Worth stating plainly rather than
quoting the good number alone: when every seat plays the same way, better action selection cancels
out. The honest read is that the bot now converts an advantage it already had.

The cost is ~3.5x per decision. Acceptable for the arena and invisible at UI pacing, but it is the
budget V2's rollouts would want, so the two will have to be sized against each other.

## 2k. The bot could see the dice

Asked what V2 would add over V1, checking the answer turned up something worse than a gap: **the
lookahead could see the roll that was about to happen.**

```
[Battle blue in 1-Arrow — choose dice]
   Roll 1S 1A 0R  -> 2 hits, 0 self   <- CHOSE
   Roll 3S 0A 0R  -> 1 hits, 0 self
```

It took two dice over three. More dice is strictly more expected hits, so no honest evaluator does
that — it picked the pool whose *particular* roll came up better.

### Why, and why it is not sloppiness

`state.rng` is a seeded generator carried in the state, which is what makes the journal replayable
and gives undo, save and load for free (docs/01). `advance` is pure, so it returns a new state with
the generator moved and leaves the original alone. Every candidate was therefore probed from the
**same** generator and returned exactly what that choice would produce — and committing it
reproduced the roll, because the real generator had never moved.

Nothing reached into hidden state. `ObservedState` correctly hides rivals' hands and strips `rng`.
The bot just asked a deterministic engine what would happen, and it was told the truth about the
future. **The hidden-information side was closed and the randomness side was open** — the same trap
docs/03 flags in HRF, arriving through the other door.

It was also worse than choosing dice well: `settle` resolves battles while scoring other candidates,
so the bot chose **whether to attack at all** knowing how the fight would go.

### The fix

Probes run on a **derived generator**, seeded from the journal rather than from `state.rng` — so it
is reproducible on any client holding the same journal, which multiplayer needs, and independent of
the roll that will really happen. Where randomness is actually consumed (detected by the generator
having moved, not by guessing from the action type) the harness takes **five samples** and the bot
averages over them.

One sample would have removed the cheating and replaced it with noise: choosing a pool off a single
imaginary roll is worse than a human choosing by odds. Averaging is what turns it back into a
judgement about odds. Every candidate is sampled with the *same* salts — common random numbers — so
a real difference between options shows through the noise.

### What it cost

| three-player, 12 games | oracle | honest |
| --- | --- | --- |
| mirror — mean power | 24.5 | **22.6** |
| v two trivial — mean power | 38.3 | **36.7** |
| runtime, mirror | 44s | 120s |

**Strength drops, and that is the number becoming true rather than the bot getting worse.** Every
figure recorded before this section was inflated in battle-heavy play; the ones here are the first
that mean anything.

The cost is real: sampling multiplies the already-3.5x sub-flow resolution wherever dice are
involved. That is now the binding constraint on V2's rollout budget, and section 3's re-measurement
should be done against these numbers rather than the original 0.044ms.

## 3. V2 — rollouts

**Built.** `rollout.ts` plus the playout driver in `play.ts`. What follows is the plan as written;
section 3a records what it actually does and what the arena says about it.

Extends V1's loop rather than replacing it, exactly as docs/03 section 2 promises.

- `chooseAction` gains a rollout evaluator: from each candidate, play to a horizon with `PolicyFn`
  on both sides, score with `ValueFn`, average.
- **Budget by time, not by count.** At ~9ms a rollout the affordable number varies by machine and by
  how deep the game is; a wall-clock budget degrades gracefully where a fixed count does not.
- **Randomness must come from a journal-derived stream**, never `Math.random()` — the multiplayer
  determinism constraint (docs/03 section 9a), and much cheaper to adopt now than to retrofit.
- Copy what docs/03 section 4.2 says HRF got right; the divergences in 4.3 stand.

**Re-measure before starting.** The 9ms figure is from today's `Tracker`. If it has not moved, V2 is
worth doing at ~100 rollouts; if the copy cost has grown, fix `Tracker` first.

## 3a. V2 as built, and what it is worth

### Re-measured first, as section 3 requires

```
engine        0.049 ms/action   (was 0.044 — Tracker has not regressed)
full game     ~24 ms as one playout
V1 decision   4.05 ms           (settle + sub-flow resolution + dice sampling)
```

A game is ~700 decisions, so rolling out *every* decision is minutes per game. The original plan's
"~100 rollouts per decision" was costed before `settle`, sub-flow resolution and dice sampling
existed, and it is no longer affordable.

### So it rolls out one decision, not all of them

**Only the card play** — lead, pivot, copy, surpass, pass. That is the highest-weight decision in the
game (section 2d.1) and the last one V1 still settles with a flat `PIP_VALUE`. Everything downstream
V1 already resolves by playing it out a ply (section 2j), so a rollout adds far less there. ~70 of a
game's ~700 decisions, and the cost lands where the plan wanted it.

Everything else delegates to `heuristicBot` — the shape docs/03 section 2 argues for: search where
it pays, evaluate where it does not.

`Rollout` is the V2 counterpart of `Lookahead` and is split for the same reason: a playout has to
*drive the engine*, and only the harness holds the full state. The harness plays, the bot judges.

### The honest weakness

Playouts run on **`trivialBot`** — first legal action — because a stronger policy costs a lookahead
per step and multiplies the playout by the branching factor. `trivialBot` is not merely weak, it is
**biased**: it takes whatever the engine offers first.

That bias is measurable and it is not subtle. At `lookaheadTurns: 0` the bot **passes**, because
passing ends the turn immediately and is scored at once, while leading hands the pips to `trivialBot`
to waste. Deeper horizons dilute it — every seat's turn is played equally badly — and at 2 turns the
same position is played rather than passed. **A rollout is only as good as the policy inside it**,
and this one is poor.

### Two traps found in the building

- **The options were decorative.** `stepBot` hardcoded `DEFAULT_ROLLOUT` and ignored what
  `rolloutBot(...)` was constructed with, so every configuration played identically — and an arena
  match between "depth 0" and "depth 2" was two copies of the same bot. Fixed by passing the options
  through `Rollout`, where they belong: how deep to look is a bot's policy, not the harness's.
- **A guard that could not fail.** The harness also tested `isCardPlay` before calling the bot, which
  made the bot's own guard unreachable — a mutation deleting it passed every test. The harness now
  offers rollouts at every ask and the bot decides where to spend them, which is both better layering
  and a live check.

### What the arena says — and the measurement lesson

The first comparison looked decisive:

| 3-player, 12 games | wins | rank | power |
| --- | --- | --- | --- |
| rollout-v2 | 50% | 1.58 | 26.8 |
| heuristic-v1 (x2 seats) | 25% | 2.17 | 21.9 |

On a 33% baseline that reads as a clear win for V2. **It is not yet evidence.**

The run that showed why was meant to compare horizons: `depth 2` against `depth 0` against V1. It
came back with depth-2 on **0% wins** and depth-0 on 42% — a colossal gap. Except the options were
being ignored at the time, so *both rollout bots were byte-identical configurations*. Two copies of
the same bot, over 12 games with seats rotated, scored 0% and 42%.

**That is the noise floor, and it is enormous.** Run deliberately at 30 games — two identical
configurations under different names, seats rotated, plus V1:

| 3-player, 30 games | wins | outright | rank | power |
| --- | --- | --- | --- | --- |
| heuristic-v1 | 47% | 47% | 1.63 | 27.0 |
| rollout-twin | 37% | 33% | 1.90 | 25.5 |
| rollout-v2 *(identical to the twin)* | 17% | 13% | 2.40 | 16.6 |

**The bottom two rows are the same bot.** Thirty games apart them by 20 points of win rate and 9
points of mean power — so a 20-point gap between two *different* bots means nothing at this sample
size, and the 10-point gap by which V1 leads here means nothing either.

Note also that this run and the 12-game run above disagree about whether V2 beats V1. That is not a
puzzle to resolve; it is what two draws from a distribution this wide look like.

Every figure in this document from a 12-game run — the 50/25 above, and the comparisons in sections
2h through 2j — is a sample far too small for the confidence its presentation implies. They may all
be right. None of them is *shown*.

Two things follow, and they are more valuable than the V2 result itself:

1. **Report a noise floor beside every comparison.** A bot against a copy of itself, and the spread
   between them, is what a difference has to exceed before it means anything. It costs one extra
   arena run. Nothing in section 2 did it, which is why section 2's numbers have to be treated as
   provisional rather than as results.
2. **Games have to get much cheaper before any tuning can proceed.** The run above took **10
   minutes** for 30 games, and 30 is demonstrably not enough. Hundreds are needed, and weight tuning
   needs many such runs — which is hours per question at the current speed.

   Arena games are completely independent, and the engine already promises it runs in a Worker
   (`index.ts`). **Parallelising arena games across worker threads is now the highest-value change
   available** — higher than any weight, than V3, and than further work on V2, because it is what
   makes every other question answerable. The per-game inputs and outputs are tiny (`{board,
   factions, seed, seats}` in, a `GameOutcome` out), so it needs no engine changes and no state
   serialization. The other half of the same problem is `Tracker` copying whole `Map`s on update
   (section 1): threads multiply throughput, structural sharing would divide the cost.

The accurate summary of V2 today: **built, honest, and of unproven value.** It is not that V2 failed
— it is that the instrument cannot yet measure it.

## 3c. The arena, parallelised — and what the noise floor actually is

### Parallel

`npm run arena -- --games 120 --jobs 12`. Games are independent and nothing large crosses a process
boundary, so shards pick games **by index** using the same `seatsForGame`/`seedForGame` as the serial
path. Outcomes land in a slot per index, so a report never depends on which shard finished first —
a serial and a parallel run of the same seed produce identical tables, verified directly.

**120 games in 228s against ~19s a game serially: about 8x on twelve cores.** A 38-minute run is now
four minutes.

Bots cross as **specs** (`{kind:'rollout', samples, …}`) rather than closures, with ids sent
explicitly — the first version derived ids in the shard and gave both noise-floor twins the same
name, printing one row with zero games beside another that silently double-counted.

### The instrument is fair; the game is just loud

Two runs of identical rollout configurations finished 12 and 14 points of win rate apart, twice in
the same direction, which looked like harness bias. The decisive test is exact rather than
statistical: **with every seat playing the same bot and the seed held across a rotation, the games of
one rotation are permutations of a single game** — relabelling who sits where cannot change what
happens — so the aggregate must be identical to the last digit.

| 120 games, three identical bots | wins | rank | power |
| --- | --- | --- | --- |
| heuristic-v1 | 33% | 1.98 | 23.7 |
| heuristic-v1 [twin] | 33% | 1.98 | 23.7 |

**The arena is unbiased.** The earlier gaps were the variance of Arcs itself, showing through a
three-player game where one of the three seats differed. That symmetry is now a test, so any
deviation is a bug in rotation, seeding or aggregation rather than a bad sample.

Also fixed on the way: seeds now **hold across a rotation** instead of advancing with it. Advancing
together confounds them — each bot plays each seat equally often but always on a *different* set of
boards, so setup luck never cancels.

### What this means for every number in this document

A three-player Arcs game is high-variance, and 120 games still leaves a floor of roughly **±12 points
of win rate** when a genuine difference exists in the field. So:

- **V2 is indistinguishable from V1.** 120 games: V1 38% / 25.0 power, V2 37% / 24.9. Not "V2 is
  worse" — genuinely no measurable difference.
- Every 12-game figure in section 2 remains provisional. The **behavioural** counts stand on their
  own — 32:4 to 72:71 pass:lead, 31 cancels to 0, 0 secures to 2 — because those are direct counts
  of what the bot does, not win rates. The **power deltas** are not established.
- Detecting a small edge needs many hundreds of games. At ~2s a game parallel that is now minutes
  rather than hours, which is exactly what the parallelism was for.

## 3d. Fixing the playout policy — and what it did not fix

V2's playouts ran on `trivialBot`: first legal action. Not merely weak but **biased** — it never
taxes deliberately, never builds toward anything, and passes whenever passing is offered first. A
rollout therefore scored the position an arbitrary continuation reaches, which was the leading
explanation for V2 being indistinguishable from V1.

### The obvious fix is unaffordable, measured

Greedy on `valueOf` — the same function the bot decides with — was written first. It needs an
`advance` and a full evaluation **per candidate per step**, roughly twenty thousand of each per card
play. **A single three-player game did not finish in ten minutes.**

That is the standard trap with playout policies: they run tens of thousands of times per decision,
so they must be cheap in a way a decision procedure need not be.

### What replaced it

`playoutChoice` — an ordered preference over action *types*, needing no lookahead at all: build and
tax first, finish battles already started, ordinary board play, and play a card rather than pass.
Crude, but it encodes the two things `trivialBot` got wrong.

Cost with it: 24s a game at `(samples 4, turns 2)`, against ~14s before — about 1.6x.

### It did not make V2 better

| 3-player, 120 games | wins | rank | power |
| --- | --- | --- | --- |
| rollout-v2(4x2) | 43% | 1.78 | 25.6 |
| heuristic-v1 | 35% | 1.86 | 25.4 |
| rollout-v2(4x2) **[twin]** | 22% | 2.26 | 19.8 |

The twins are the same bot: **21 points apart**, against the 8 points by which V2 leads V1. Averaging
the two identical instances — the best estimate of V2's true strength — gives 32.5% and 22.7 power
against V1's 35% and 25.4. **No measurable difference, again.**

### The diagnosis this points at

A rollout adds information only if the playout reveals something the evaluator cannot already see.
Ours runs **two turns** and is then scored by **the same `valueOf`** the bot would have used
directly — so it is largely a noisy re-measurement of the evaluator rather than new evidence.
Averaging four samples reduces that noise; it does not add information.

Two candidates follow, and the arena can now settle them:

1. **Much longer horizons** — to chapter end, where ambitions actually score. That is where the
   payoff a static evaluator cannot see genuinely lives. Expensive, and the reason `maxSteps` and
   the cost measurements exist.
2. **Rollouts are the wrong lever for this game** and the evaluator is what needs the work — in
   which case the honest next step is learning its weights rather than arguing them.

What is *not* worth doing is another round of hand-tuning against 120-game samples that cannot
resolve 8 points.

## 3e. The chapter-end horizon, and the verdict on rollouts

Section 3d's diagnosis was that a two-turn playout scored by the same `valueOf` is a noisy
re-measurement of the evaluator rather than new evidence. The obvious test is to play to **chapter
end**, where the ambitions have actually scored and `power` is realised — the one thing a static
evaluator can only guess at through its standing term.

Cheaper than expected: 14s a game at four samples, against 24s for the two-turn horizon, because a
playout that ends at the chapter boundary often ends sooner than two full turns.

| 3-player, 120 games | wins | rank | power |
| --- | --- | --- | --- |
| heuristic-v1 | 39% | 1.80 | **26.1** |
| rollout-v2(4xchapter) | 37% | 1.93 | 22.7 |
| rollout-v2(4xchapter) **[twin]** | 24% | 2.23 | 19.4 |

Twins 13 points apart; V1 leads the better twin by 2. **Still inside the noise on win rate.**

### The signal that does survive three runs

Win rate is too noisy to rank these bots, but **mean power is steadier**, and the same pattern shows
up in every configuration tried:

| 120 games, V1 vs the average of two identical rollout instances | V1 power | rollout power |
| --- | --- | --- |
| 2 turns, `trivialBot` playouts | 25.0 | 22.9 |
| 2 turns, `playoutChoice` | 25.4 | 22.7 |
| chapter end, `playoutChoice` | 26.1 | 21.1 |

**Three independent runs, three different rollout configurations, and V1 scores more power in all
of them.** The gap at chapter end (5.0) is larger than the twins' own power gap (3.3), which is the
only place any of this clears its noise floor — and it points the wrong way for V2.

### The verdict

Rollouts as constructed here are **not better than the one-ply heuristic, and are probably slightly
worse.** Three horizons and two playout policies did not change that.

The likeliest reason is that a crude playout policy makes the simulated future *biased*, not merely
noisy — and a biased estimate can be worse than evaluating the position directly. V1 meanwhile
already looks one action ahead using the **real** bot's judgement (`settle` and sub-flow resolution,
section 2j). Put plainly: **short lookahead with a good policy beats long lookahead with a bad one**,
and the budget does not allow a good policy inside a playout — that was measured, not assumed
(section 3d: greedy-on-`valueOf` playouts could not finish one game in ten minutes).

So the honest conclusion is that section 3d's second candidate is the live one: **rollouts are the
wrong lever for this game at this budget, and the evaluator is what needs the work.** The code stays
— it is tested, it is honest, and `--seats rollout:4:chapter` makes it a one-line experiment if the
evaluator or the playout budget ever changes — but it should not be the next place effort goes.

What that leaves, in order: the evaluator's blind spots are known and cheap to describe (income is
invisible, planet types are unread, card suits are unread — section 2's worked examples), and its
weights have never been fitted to anything. **Learning them from self-play is the step that replaces
arguing about them**, and it is now possible because the arena is fair, sharded and fast.

## 3f. Fitting the weights from self-play — and why it failed

Section 3e concluded the evaluator, not the search, was what needed work: every weight was chosen by
argument, and the arena's noise floor makes "change a weight, run the arena" hopeless at one bit of
signal per game.

### What was built

- **`valueOf` split into features and weights.** It is now explicitly a dot product: `featuresOf`
  returns the sixteen quantities a position presents, `WEIGHTS` holds the scales. Behaviour-preserving
  (the whole suite passes unchanged), and it is what makes fitting possible at all.
- **`npm run fit`** — self-play collection, sharded like the arena, then ridge regression.
- **`heuristicBotWith(weights)`** and `--seats heuristic:fitted`, so a fitted set can be played
  against the hand-set one in the same match.

The target is **final power**, which is exactly what `valueOf`'s docstring claims each term measures.
Every sampled position of every faction is a row, so 150 games gave 28,488 — against one bit per game
from a win-rate comparison.

### It fits, weakly

| 150 games, 28,488 rows | RMSE |
| --- | --- |
| held-out | 10.64 |
| predicting the mean | 11.84 |

About 19% of variance explained. Real, but weak.

### And the resulting bot is far worse

| 120 games | wins | rank | power |
| --- | --- | --- | --- |
| heuristic-v1 (hand-set) | **64%** | 1.48 | **29.8** |
| heuristic-fitted | 18% | 2.20 | 19.2 |
| heuristic-fitted **[twin]** | 18% | 2.25 | 20.0 |

The twins agree to the point (18% and 18%, 19.2 and 20.0), so the noise floor here is near zero and
the 46-point gap is real. **The hand-set weights are dramatically better than the fitted ones.**

### Why, and it is not a bug

The regression learned **correlations, not action values**. Look at what it produced:

| feature | hand | fitted |
| --- | --- | --- |
| weapons | 0.25 | **−1.59** |
| trophies | 0.30 | **−0.26** |
| courtSecured | 1.00 | **−0.20** |
| cities | 2.00 | 0.31 |

Holding weapons predicts losing — because the players holding weapons are the ones in trouble.
Trophies predict losing because having trophies means having fought. Cities barely predict anything
because in self-play *everyone* builds them, so they do not separate winners from losers. Fitted
greedily, the bot then throws weapons away and avoids the court.

This is the standard confound of regression on observational data from a single policy: with a lossy
feature projection the coefficients absorb "this is a marker of being behind" rather than "this
causes winning". A quantity can be an excellent predictor of the outcome and a terrible guide to
action, and choosing actions is the only thing the evaluator is for.

### Iterating does not rescue it — tried, section 3g

The first item below was the obvious candidate and was tested. It does not help.

### What would actually be needed

One-shot regression on a fixed policy's trajectories is not policy iteration. Doing this properly
means some of:

1. ~~**Iterating** — fit, play with the fitted weights, refit.~~ **Tried; see section 3g.**
2. **Learning from choices rather than states** — an advantage or TD target, so a weight answers
   "does taking this help" instead of "do winners tend to have this".
3. **Regularising toward the hand-set weights** rather than toward zero, so evidence has to overcome
   a prior rather than start from nothing.
4. **Sign constraints** on features where the game's rules settle the direction: a city is not bad.

### The one unambiguous win

This is the **first arena result all session decisively outside the noise floor** — 46 points, with
identical twins agreeing exactly. That matters beyond the experiment: it shows the arena *can* detect
a real difference when one exists, so the earlier "no measurable difference" verdicts on V2 were
genuine null results rather than an instrument failing to resolve anything.

The tooling stays. It is tested, sharded and reproducible, and every route above builds on it.

## 3g. Iterating the fit

`--iterations n` turns the single regression into policy iteration: each round's self-play games are
played with the previous round's weights, so round two learns from the positions round one's bot
actually reaches. That is the textbook loop — evaluate the policy, act greedily on the estimate,
repeat.

Three rounds, 90 games each:

| round | played with | rows | held-out R² |
| --- | --- | --- | --- |
| 1 | hand-set weights | 17,004 | 0.216 |
| 2 | round 1 weights | 19,236 | 0.189 |
| 3 | round 2 weights | 17,955 | **0.018** |

**The value estimate degrades toward nothing.** Each round trains on games played by a worse policy,
so the data gets less informative rather than more — the classic divergence of naive policy iteration
with function approximation and no improvement guarantee.

And the play does not recover:

| 90 games, vs hand-set | fitted wins | twin | hand-set wins |
| --- | --- | --- | --- |
| round 1 weights | 18% | 14% | **68%** |
| round 3 weights | 18% | 17% | **66%** |

**Flat at the floor.** Iterating changed the value estimate a great deal and the playing strength not
at all, because the strength was already at the bottom after one greedy step.

So the failure is not "too few iterations". It is the one section 3f named: regression on
observational features learns what *correlates* with winning under the policy that generated the
data, and iterating on a policy built from those correlations only produces worse data. The
remaining three routes — learning from choices rather than states, regularising toward the hand
weights rather than zero, and sign constraints where the rules settle the direction — all attack
that, and none of them is iteration.

Of those, **regularising toward the hand-set weights is the cheapest to try**: it is one line (ridge
toward a prior instead of toward zero), and it directly answers the failure mode, since evidence
would then have to overcome a working prior rather than build a policy from scratch out of
correlations.

## 3h. Regularising toward the hand-set weights

Section 3g's leftover: shrink the fit toward `WEIGHTS` rather than toward zero, so evidence has to
overcome a working prior instead of building a policy out of whatever correlations survive.

### A bug found on the way in

**Every fit in sections 3f and 3g was effectively unregularised.** The normal equations accumulate a
term per row, so against seventeen thousand rows a bare `ridge = 1` on the diagonal is a rounding
error. The strength is now expressed as a *fraction of the row count*, so `1` means "the prior counts
for as much as the data" and the number is comparable across runs of different sizes.

### The sweep

One collection, many fits — the games are the expensive part and the solve is instant, so every
strength is fitted from the same 22,650 rows and the comparison carries no extra sampling noise.

| ridge | held-out R² | cities | weapons | courtSecured |
| --- | --- | --- | --- | --- |
| 0 | **0.340** | 0.29 | −1.32 | −0.32 |
| 0.3 | 0.321 | 0.53 | −1.14 | −0.09 |
| 1 | 0.258 | 0.86 | −0.77 | 0.15 |
| 3 | 0.123 | 1.30 | −0.34 | 0.45 |
| ∞ | — | 2.00 | 0.25 | 1.00 |

It behaves exactly as designed: the dial runs continuously from the pure fit to the hand-set weights.
**R² prefers ridge 0** — unsurprising, since the prior is not the best predictor.

### What the arena says

| ridge | fitted | twin | hand-set | noise floor (twin gap) |
| --- | --- | --- | --- | --- |
| 0 (pure fit) | 18% | 14% | **68%** | 4 |
| 1 | 30% | 29% | **41%** | 1 |
| 3 | 26% | 40% | 34% | 14 |
| ∞ | — | — | — | *is* the hand weights |

**Strength recovers monotonically as the prior takes over, and never exceeds it.** At ridge 1 the
twins agree to a point and the hand-set weights still win by 11 — that gap is real. At ridge 3 the
twins are 14 apart and nothing is resolvable, which is the honest reading: indistinguishable from the
prior it has been shrunk into.

### The conclusion

Regularising limits the damage; it does not extract value. Together with sections 3f and 3g:

- **Prediction and action are different problems here.** The best predictor of final power (ridge 0,
  R² 0.34) is the *worst* player of the five configurations measured. That is the whole finding.
- The fitted signal is real — a third of the variance in final power — and it is nonetheless
  **useless for choosing moves**, because it is loaded with markers of being behind rather than
  causes of getting ahead.
- Three of the four routes from section 3f have now been tried: iterating (3g), regularising toward
  the prior (3h), and the plain fit (3f). None beats hand-set weights.

**What is left is the one that changes the target rather than the fit**: learn from *choices* — an
advantage or TD signal, where a weight answers "does taking this action help" rather than "do winners
tend to have this". That is the only remaining route that attacks the confound rather than damping
it, and it needs the collector to record decisions and counterfactuals rather than positions and
outcomes.

Worth saying plainly: **the hand-set weights have now survived four measured attempts to beat them.**
That is a stronger endorsement than they had before this work, and the tooling to challenge them
again is in place.

## 3i. Learning from choices — the right idea, blocked by variance

The last route from section 3f, and the only one that attacks the confound rather than damping it.
`fit-choices-collect.ts` **intervenes** instead of observing: at a decision, take two candidate
actions from the *same* position, play each to the end of the game, and label the pair by the
difference in final relative power.

That design is correct, and the reason is worth keeping. Everything about the position — who is
ahead, how the chapter is going, which markers are out — is identical in both branches, so it
**cancels in the difference**. A feature that merely marks being behind contributes equally to both
and drops out; only a feature that changes the outcome survives. This is exactly the confound that
made weapons fit at −1.59 in section 3f, and differencing removes it by construction.

### It produced no signal at all

| rows | held-out R² |
| --- | --- |
| 1,617 | −0.030 |
| 10,029 | **−0.002** |

Zero, and not for want of data — ten thousand interventions moved it from "slightly worse than
predicting the mean" to "exactly the mean".

And the arena agrees the weights are noise: 27% and 16% for two identical fitted instances against
the hand-set weights' 58%.

### Why: the label is far noisier than the effect

`R² ≈ 0` with `RMSE 9.62` means the label's own spread is about **9.6 power**. The effect being
measured — what one action is worth — is of order **half a power**. So each pair is a measurement
with roughly twenty times more noise than signal.

**Common random numbers did not save it, and the reason is instructive.** Both branches start from
the same generator, but two different actions consume draws at different rates, so the streams
desynchronise immediately and the branches are effectively independent after a few steps. CRN only
reduces variance while the draws stay aligned, and here they cannot.

Averaging playouts per branch would fix it, and the arithmetic says how much: to get the label's
noise down near the effect size needs `(9.6 / 0.5)² ≈ 370` playouts **per branch**. That is ~700 per
pair against two today — turning a five-minute collection into roughly thirty hours.

### Where this leaves the evaluator

Four routes tried, four measured, none beating hand-set weights:

| route | outcome |
| --- | --- |
| plain regression on returns (3f) | 18% vs 64% — learns correlations |
| iterating the fit (3g) | R² collapses 0.216 → 0.018; strength flat at the floor |
| regularising toward the prior (3h) | recovers monotonically toward the prior, never past it |
| learning from choices (3i) | correct design, no signal — label noise ~20x the effect |

The common thread is not the fitting. **Every route needs to say what an action was worth, and
nothing available can say it**: the playout policy is too weak to be a credible simulator of
consequences (section 3d), the game's own variance is enormous (section 3c — 12–21 points of win
rate at 120 games), and the effect of one action is small against both.

That is also why V2's rollouts failed (section 3e). It is one problem wearing different hats:
**there is no cheap, low-variance way to evaluate a candidate action in this game.**

### What would actually move it

Not more fitting. The two things that would change the picture:

1. **A much cheaper engine.** `Tracker` copies whole `Map`s per update (section 1). Structural
   sharing would cut the cost of every playout, and playout count is exactly what the variance
   arithmetic above is short of. This is the single highest-leverage change left, and it is a
   contained one behind one module.
2. **A stronger playout policy that is still cheap** — the thing section 3d could not afford. It
   makes each playout a better estimate rather than needing more of them.

Both attack the same bottleneck from opposite sides, and both are engineering rather than tuning.
Until one lands, **the hand-set weights stand, having now survived four measured attempts.**

### 3j. Slot armour — a widening that did *not* pay

The first thing to widen the evaluator's view and produce **no measurable gain**, which makes it the
most useful entry in this register: it is the counter-example to "widening always works".

**The idea, and it is sound.** A resource slot's printed key cost is what a Rival must spend to steal
from it — `offerRaid` prices each steal at `slotKeys(slot)` and skips any the raider cannot afford.
The board is uneven on purpose (`CITY_SLOT_KEYS` is `[3, 1, 1, 2, 1, 3]`, plus Ancient Holdings at
four), so the same token is far safer in one slot than another, and the best row puts what is worth
most where it is dearest to take. Nothing read the arrangement at all before this.

`resourcesGuarded` prices placement only — each held token's ambition-scaled worth times
`slotKeys - 1`, so the cheapest slot contributes nothing and holding more is not double-counted.
Switched on by `guardBot` (`GUARD_WEIGHTS`, 0.3); weight **0** in `WEIGHTS`, so the baseline is
untouched.

**The measurement, on expansion games (`--lore 3`), three players, seats rotated:**

| games | `guard` vs `baseline` | `guard` vs **its own twin** |
| --- | --- | --- |
| 120 | 16 points, 1.9 power | **16 points, 1.9 power** |
| 1000 | 2 points, 0.6 power | **2 points, 0.5 power** |

The effect equals the noise floor exactly, on both metrics, at both game counts. **There was never a
signal.** The sharpest illustration is inside the 120-game twin run, where the two *identical* bots
finished at 41% and 25% — straddling the opponent at 34%. Whichever twin you looked at, you could
have concluded the feature was a clear win or a clear loss.

**Kept anyway, at weight 0**, and the reason is worth stating precisely so it is not overclaimed
later. What is proven is narrow and does not need an arena: before this, *every ordering of a row
scored identically*, so the evaluator could not prefer a good arrangement — a blind spot, now closed
and pinned by `guard.test.ts`. What is **not** proven is that seeing it wins more games. Promoting
the weight needs evidence this run did not produce.

**The trap this entry exists to record.** The 120-game result was reported as favourable *before* its
twin was run — precisely the mistake the "always run a noise floor" rule at the top of this document
already warned about. Run the control in the same batch as the comparison, not after it looks good.

**One loose thread.** Games that fail to finish rose with the number of `guard` seats — 4/1000 with
one seat, 15/1000 with two. Suggestive rather than proven, since the seat rotation also changes which
games are played, but it hints that `guardBot` still reaches a cycle the arrange cap does not cover.
Seeds 247, 50, 218, 147 and 275 reproduce it.

### 3k. Lore activation — a widening that made the bot *worse*

Stronger than section 3j's null, and more useful: this one has a sign. Two variants, four runs of 999
games each with a matched twin control, and the feature loses every time.

**The idea.** The expansion's ten ambition-paired lore cards (lore19-28) do nothing until the
ambition they name is declared, by anyone (`loreActive`). Holding Tycoon's Ambition while nobody has
declared Tycoon is a card face-down. Two features rather than one — `loreArmed` for held-but-dormant,
`loreLive` for switched-on — because the bot values a declaration by valuing the position it leads
to, and declaring is exactly what converts armed to live. So `loreLive - loreArmed` is the pull
toward declaring what your lore wants, with no rule saying so. The mechanism works and is tested.

**The numbers**, `lore` vs two `contest` bots, expansion games, seats rotated:

| variant | vs `contest` | twin floor |
| --- | --- | --- |
| flat count (0.6 / 0.2) | −2 points, −0.6 to −1.0 power | 1 point, 0.2 power |
| scaled by `bias` | −2 to −3 points, −0.8 to −0.9 power | **0 points, 0.1 power** |

**The hypothesis that failed.** The flat version was thought to lose because a constant pull argues
with `feasibility` — the signal that judges whether an ambition is worth declaring, which these bots
already carry. Scaling each card by `bias(intent, itsAmbition)` should have made the card *amplify*
that judgement rather than override it. It changed nothing: the scaled variant lost by the same
margin, against the tightest floor yet measured. **The shape of the pull is not the problem.**

**What is left to suspect**, for anyone tempted to rebuild this:

  - **The weights are too large.** `loreLive` at 0.6 sits near a fresh ship. If a paired card is
    worth much less, the feature is mostly injecting error into an evaluator whose other terms are
    tuned. A weight sweep would test it — and is exactly the tuning this register says has never
    paid off here.
  - **The card is already priced, through its effects.** More likely, and the more interesting
    possibility. A live card's benefit reaches the evaluator anyway — as ships on the board, as
    actions taken more cheaply, as resources gained. Counting the card *as well* double-prices what
    is already visible. That would explain why no shape of the term helps: the information is not
    new, and the same lesson appears elsewhere in this register.

**Kept at weight 0**, inert, with the mechanism pinned by `lore-activation.test.ts`. What is proven
is only that the evaluator *can* distinguish a live card from a dormant one, which it could not
before. That it should *act* on the distinction is now measured false twice.

## 4. The goal layer — playing *toward* an ambition

Sections 3a-3i establish the direction by elimination: **every gain came from widening what the
evaluator can see, and every attempt to get strength from more search or better-fitted weights
failed.** This is a representation change, which is the side that has been paying.

### What the bot cannot currently represent

| requirement | what is missing |
| --- | --- |
| pick an ambition it *can work toward* | **Capacity.** `metric('Tycoon')` is Material+Fuel *held now*; nothing projects income. |
| act to advance it | `intent` biases weights, but nothing knows *which actions generate the resource*. |
| deny rivals theirs | Implicit only, through `mine − best`. No notion of "blue is 2 Relics from locking Keeper". |
| decide whether to win initiative in order to declare | Not representable: initiative, lead-card strength and declare-enabling cards are invisible. |

The worked examples in section 2 make the first concrete: a bot with three cities on Material planets
and two Administration cards will not push for Tycoon, because **nothing it looks at can see either
fact**. `planetResource(state, system)` supplies the first and the hand supplies the second; neither
is read anywhere in `ai/`.

### The constraint that shapes all of it

**Goals must be derived, never remembered** (section 2b). A remembered plan dies on reload, and in
multiplayer two clients holding different plans fork the game by who posted first.

That is less limiting than it sounds: **the journal is shared**, so a plan derived from
`(state, journal)` is deterministic, reproducible on any client and survives reload. What is
forbidden is bot-local memory, not richness.

The second half of 2b still binds too: intent must not move *within* a turn, or the bot argues with
itself between two of its own actions. Reading **capacity** (cities, planet types, hand suits)
rather than **holdings** respects that, because capacity barely moves inside a turn — which is
precisely why the original design read structure instead of resources.

### The order

1. **Income projection.** `planetResource` for my cities plus hand suits, into expected resources per
   ambition by chapter end. Smallest change, fixes the worked example, unblocks the rest.
2. **Feasibility replaces `fitness` in `intentFor`** — "what can I actually get by chapter end
   against what rivals can" instead of today's structural proxy.
3. **Declare-readiness as a visible term** — initiative, lead strength, enabling cards. This is what
   makes "is winning initiative worth it?" answerable at all.
4. **Explicit denial** — rival proximity to locking an ambition, as its own term rather than only
   through the relative subtraction.

### Step 1 done: income projection — built, safe, and barely moves anything

`incomeFor` counts **cities standing on planets that produce the resource an ambition scores**, and
`planetResource` was widened to take the narrowest thing that answers the question so the AI reads
the rules rather than re-implementing them.

**Structure only, deliberately.** Holding Administration is exactly what lets you tax, and reading
card suits is therefore the tempting version — but a hand changes *during* a turn, so that estimate
would fall the moment a card was played and the bot would contradict itself between two of its own
actions (section 2b). Cities and planets barely move within a turn. There is a test for it.

Carried as two features at **weight zero**, so `heuristicBot` — the frozen baseline — is byte
identical and the golden game still passes. `goalBot` differs from it by exactly two numbers.

| 120 games | wins | rank | power |
| --- | --- | --- | --- |
| goal-income | 36% | 1.93 | 22.8 |
| baseline | 33% | 1.98 | 22.2 |
| goal-income **[twin]** | 32% | 2.03 | 22.2 |

Twins 4 points apart — an unusually tight floor, because all three bots are nearly the same — and
the goal bot's average is 34% against 33%. **No measurable difference.** Notably, also no harm:
unlike every fitted weight set, this does not make the bot worse.

The behavioural check is more informative than the match, as expected:

| bot | declares matching its top-income ambition |
| --- | --- |
| baseline | 38% |
| income at 0.9 | 41% |
| income at 3.0 | 44% |
| income at 10 | 43% |

**It works, and it saturates almost immediately.** Ten times the weight buys nothing over three, so
this is not a tuning problem — the signal is reaching the decision and the decision barely depends
on it.

The reason is collinearity: **income is nearly a restatement of `cities`**, which already carries a
weight of 2.0. A city on a Material planet was always counted as a city; the only *new* information
is which planet it sits on, and that is a refinement rather than a new dimension. The declare
decision meanwhile is dominated by the `standing` term, and the worked example in section 2 showed
it turning on margins of 0.01.

**What this says about steps 2-4.** The remaining three are worth more than this one precisely
because they add information the evaluator has *no* proxy for: declare-readiness (initiative, lead
strength, enabling cards) and rival proximity to locking an ambition are not restatements of any
existing feature. Income was the cheapest step, not the biggest, and it is now available for
feasibility in step 2 — where it is an input to *whether an ambition is winnable*, rather than
another term competing with `cities`.

### Step 2 done: feasibility — a real improvement in *judgement*, not yet in *strength*

`structuralFitness` answers Tycoon with "how many cities and starports do I have", counting every
city the same whether it stands on Material or on Psionic. So a faction whose territory is entirely
Relic rates its Tycoon prospects exactly as highly as one sitting on the Material belt.

`feasibility` answers with the planets actually underneath — cities on planets that produce what the
ambition scores. `intentFor` is now parameterised on its fitness function, so the frozen baseline
keeps `structuralFitness` and nothing about it moves; the golden game still passes.

The improvement in judgement is real and is pinned by tests: the same city on Material and on Relic
produces *different* Tycoon prospects, and `structuralFitness` provably cannot tell them apart. It
also still obeys the flap rule — it reads the planets under its cities, never the resources those
cities have produced.

**But it does not show up as strength, and one run nearly said it did.**

| 120 games | feasible (twin-averaged) | baseline | twin gap = the floor |
| --- | --- | --- | --- |
| seed 1 | 24.5 power | 22.9 | 0.8 |
| seed 900 | 22.7 power | 22.6 | **1.7** |

The first run's 1.6-point power gap cleared its floor of 0.8 and looked like the first positive
result of this section. **It did not replicate.** Pooled over 240 games the gap is ~0.85 power
against a floor averaging ~1.25 — nothing. Reporting the first run alone would have been wrong, and
the only reason it was not is that a second run on independent seeds was cheap enough to insist on.

That is worth stating as a rule rather than an anecdote: **at this noise floor, a single arena run is
a hypothesis, not a result.** Replicate on independent seeds before believing anything, including —
especially — a result you were hoping for.

### Where steps 1 and 2 leave the goal layer

Both are built, both are correct, both are measurably better at the thing they were meant to fix, and
neither moves the needle:

| step | judgement | strength |
| --- | --- | --- |
| 1 income | declares matching top income 38% → 44% | none |
| 2 feasibility | tells Material cities from Relic ones; structural fitness cannot | none |

The common explanation is the one step 1 already found: **these are refinements of information the
evaluator already had a proxy for.** Cities were always counted; knowing *which* planet is a
sharpening, not a new dimension. And both feed `intent`, which only *biases weights* — it never
changes what the bot is able to see about a position.

Steps 3 and 4 are different in kind, and that is now the reason to expect more from them.
**Declare-readiness** (initiative, lead-card strength, cards that permit declaring) and **rival
proximity to locking an ambition** have *no* existing proxy anywhere in `featuresOf` — they are
things the bot currently cannot represent at all, rather than things it represents coarsely.

### Step 3 done: declare-readiness — the first replicated gain, and it ships

The first of these additions with **no existing proxy**. Nothing in `featuresOf` knew what was in the
hand, whose turn it was to lead, or whether a marker remained. Three rules have to line up and the
bot could see none of them:

- **Only the lead player may declare** — `CheckDeclare` follows a lead and nothing else, so it takes
  initiative, not merely a good position.
- **The card's strength picks the ambition** — a 2 declares Tycoon, a 5 Keeper, a 7 anything.
- **A marker must still be free** this chapter.

`declareReadiness` prices the best single opportunity: the marker's value, scaled by how much the
faction wants that ambition and by its chance of leading. It reads the hand, which is allowed
*here* — the anti-flap rule governs `intentFor`, and a value that falls when you spend the card you
were going to declare with is the truth rather than a flap. Rivals' hands are hidden, so it reads
zero for everyone but `self`; scoring a rival's readiness would be the dice oracle of section 2k
arriving through another door, and there is a test for it.

**A rules detail worth keeping:** at three players the strength-1 and strength-7 cards are removed,
so every remaining card is a 2 to a 6. Every card declares *something* and the wildcard does not
exist — which is why the tests run at four players, where both edge cases are reachable.

#### It replicates, and it isolates

| 120 games vs baseline | declare (twin-averaged) | baseline | floor |
| --- | --- | --- | --- |
| seed 1 | 36% wins, 21.6 power | 28%, 20.8 | 6 pts / 0.1 |
| seed 900 | 38% wins, 23.0 power | 24%, 19.5 | 10 pts / 2.2 |

Both runs, both metrics, gaps clear their floors — unlike section 4 step 2, which looked good once
and evaporated on replication.

Because `declareBot` stacks all three steps, one more run attributes it:

| 120 games | wins | power |
| --- | --- | --- |
| goal-declare (twin-averaged) | **36.5%** | 21.6 |
| goal-feasible (steps 1+2 only) | 28% | 20.3 |
| twin gap = floor | 1 pt | 1.0 |

**8.5 points against a 1-point floor.** The gain is declare-readiness, not the stack beneath it.

#### Why this one worked when steps 1 and 2 did not

Steps 1 and 2 sharpened information the evaluator already had a coarse proxy for — cities were always
counted; knowing *which planet* is a refinement. Both fed `intent`, which only biases weights.

This one adds a **dimension the bot could not represent at all**, and it changes what the bot *does*
rather than how it weighs what it already saw. That is the pattern the whole document keeps
returning to: every gain in section 2 came from widening what the evaluator can see, and every
attempt to get strength from search (3a-3e) or from re-fitting weights (3f-3i) failed.

**Shipped.** `apps/web` plays `declareBot`; `baselineBot` stays frozen as the measurement reference.
Step 4 — rival proximity to locking an ambition — is the remaining one with no proxy, and is now the
best candidate for the same reason this one was.

### Step 4 done: contestedness — no gain, and the prediction behind it was wrong

`standing` scales a marker by a step function over {0, 0.2, 0.5, 1}, so leading 10-1 and leading 3-2
are the same number to it, and so are being one behind and eight behind. `standingContested` adds the
margin: `marker x bias / (1 + |mine - best|)`, peaking when the margin is nothing and decaying as an
ambition settles. It values defending a fragile lead and attacking a fragile deficit — the same
situation from two sides — and there are tests showing `standing` provably cannot express either.

| 120 games, contest vs declare | contest (twin-averaged) | declare | floor |
| --- | --- | --- | --- |
| seed 1 | 33% wins, 20.05 power | 34%, 20.1 | 4 pts / 0.5 |
| seed 900 | 33.5% wins, 20.95 power | 33%, 20.3 | 5 pts / 1.5 |

**Nothing, in either run, on either metric.**

#### The prediction was wrong, and why is the useful part

Step 3 was expected to work because it added a dimension with no proxy, and it did. Step 4 was
predicted to be "the remaining one with no proxy" — **that was a mistake, and the reason is in
`valueOf`'s own definition.**

`valueOf` is **relative**: mine minus the best opponent's, and a rival's score includes *their*
`standing`. So a rival close to locking Keeper already lowers this bot's value, and the bot already
prefers actions that pull it back. **Denial was priced from the beginning** — the relative
subtraction is the proxy, and it was there before any of section 4.

What contestedness adds is only *margin sensitivity* on top of that. Which puts it with steps 1 and
2 — a refinement of information the evaluator already expressed — rather than with step 3.

#### The pattern across all four steps

| step | kind of change | result |
| --- | --- | --- |
| 1 income | refines `cities` | none |
| 2 feasibility | refines `fitness` | none (one run looked good, did not replicate) |
| 3 declare-readiness | **new dimension** — hand, initiative, markers | **replicated gain, isolated** |
| 4 contestedness | refines the relative subtraction | none |

Three refinements, three nulls; one genuinely new dimension, one gain. That is the same shape as
sections 2 and 3 — **widening what the evaluator can see pays; sharpening what it already sees does
not** — and it is now the test to apply before building anything else: *is there any existing term,
however coarse, that already moves with this?* If yes, expect nothing.

The code stays: tested, carried at weight zero, and `--seats contest` makes it a one-line experiment
if the weights around it change. **`apps/web` continues to play `declareBot`**, which remains the
measured best.

### How this gets validated — not with win rates

The arena's floor is 12-21 points and these effects will be smaller. Use what actually worked:

- **Behavioural counts.** Every reliable signal in this document was a direct count — pass:lead
  32:4 → 72:71, cancels 31 → 0, secures 0 → 2. The equivalent here is *"does it declare the ambition
  it has the most projected income for?"*, which needs no statistics.
- **Scenario saves.** `saves/` already parks reachable positions for exactly this kind of question.
  A position with cities on Material planets and Administration in hand, asserting the bot declares
  Tycoon, fails for a comprehensible reason rather than a statistical one.

### Always keep a snapshot to test against

**`baselineBot` is the frozen current best**, and the rule is simple: **never change it.** A change
that would alter its behaviour is a *new* bot, not an edit to this one.

Without that, the baseline drifts with the thing under test and no comparison means anything —
`heuristicBot` today is far stronger than `heuristicBot` at the start of section 2, and if the goal
layer edits the same code path there is nothing left to measure against.

Drift is caught rather than trusted: **a golden-game test** plays fixed seeds with `baselineBot` and
asserts exact outcomes, so any accidental change to the shared code path fails loudly and names
itself. `--seats baseline` puts it in the arena.

## 4a. V3 — information-set search

docs/03 section 5 is aspirational and this plan does not schedule it. Two things it needs that do
not exist:

- **Scoring an arbitrary state** without driving the engine to a continuation (section 1.5 above).
- **Honest determinization**, which needs `observe` to be genuinely complete — every hidden thing
  actually hidden. Today's `observe` is close but has never been audited against a real hidden-
  information model, because nothing has needed it.

Both are prerequisites to *plan* V3, not to build V1 or V2. Revisit once V2 has a measured strength
score (docs/03 section 7).

## 5. Order, and what each step unblocks

1. `observe` gains own-hand — blocks everything.
2. `options.bots` + the hotseat loop with a **trivial** bot (first legal action). Proves the seat
   plumbing end to end before any evaluation exists, and gives the arena something to run.
3. **The bot turn banner and pacing loop** (section 2a), plus the **diagnostic panel with step and
   take-over** (section 2e), against the trivial bot. Both presentation and the tuning harness proven
   before there is any evaluation to blame them on — writing the value function without the panel
   means writing it blind.
4. `intentFor` (section 2b) — chapter goals, derived from observed state, never remembered.
5. `ValueFn` + `chooseAction` returning a `BotDecision` — the real V1, biased by intent.
6. Arena and strength measurement (docs/03 section 7) — needed *before* V2, or there is no way to
   tell whether rollouts helped. **Done — section 2g**, and it earned its place immediately: it
   found a livelock that had gone unnoticed, and it showed that V1's win rate against the trivial
   bot was flattering a strategy that cannot start a game.
7. **Fix leading** — **done, section 2h.** Pass:lead went from 32:4 to 72:71 and mirror-match power
   from 2.5 to 16.7, so V2 now starts from a bot that plays a whole game.
8. **Fix action selection** — **done, section 2j.**
9. V2 rollouts.
10. Difficulty ladder (docs/03 section 8) — cheapest once there are two strengths to interpolate
   between.

Steps 1 and 2 are small and unblock the rest; step 4 is the one most likely to be skipped and most
expensive to skip.

## 6. Per-rival intent — a null, and a livelock worth remembering

The blind spot (section 0): `valueOf` scored every rival under *your* intent, so the bot could not
see what an opponent was going for and could not deny. The fix looked obvious — score each rival
under `intentFor(observed, rival, feasibility)`, public state only, one extra intent computation
per rival per evaluation. `rivalBot` carries it; `heuristicBotWith` grew the option.

### The first version was wrong in a way the arena caught and an argument did not

Rival intents were recomputed on each **probed** state, on the reasoning that my candidate action
can change a rival's position and their intent should follow it. Two failures, one loud:

- **Candidates could move the measuring stick.** A rival's `contest()` reads *my* holdings — the
  anti-flap rule (section 2b) violated from the rival's side — so the bot found +0.018 in
  discarding its own Material: real resources spent to twitch an imputed number.
- **The strictly-improving-repeat gate stopped terminating.** Its argument requires `valueOf` to be
  one fixed function per decision; with intents shifting under each candidate it was not. Arena
  seed 245 cycled Prelude → arrange → swap → Done for 20,000 actions — 1 unfinished game in 999,
  reproduced first try, now pinned as a test (`rival-intent.test.ts`).

Fixed by computing rival intents **once per decision from the pre-action state** and holding them
fixed across candidates. Nothing a candidate does can then shift the yardstick, and the gate's
bounded quantity is real again.

### Measured, fixed version, 999 games x2 with twin

| run | rival-intent | standard | twin floor |
| --- | --- | --- | --- |
| vs standard x2 | 35% wins, 18.8 power | 32%, 18.5 | — |
| vs standard, twinned | 34% wins, 18.8 power | 34%, 18.7 | 2 points, 0.4 power |

Three points ahead once, dead level on the rerun: **the floor talking, not a result.** The shipped
bot keeps one intent for everyone; the option stays for later work to measure in combination
(section 7's search takes it as a flag, off by default, for exactly that reason).

The section 0 lesson holds its streak: this is the fourth plausible evaluator idea in a row —
guard, lore, declare-cost-as-strength, now rival intent — to measure as nothing or worse. The
register, not the argument, is the arbiter.

## 7. V3 — the own-turn beam search

The card play was still priced by `PIP_VALUE x pips` — the crudest number in the bot at the
highest-weight decision in the game, and the thing every failed rollout attempt (3a, 3d, 3e) was
trying to replace. Those failed on **variance**: playouts under a weak policy are noisy re-measurements
of the evaluator. A deterministic beam does not pay that tax — the only randomness is dice inside a
line, sampled under derived generators like every probe.

`search.ts`: at a card-play ask, each candidate root gets its own beam over the whole turn it opens
— card, declare, prelude, pips, sub-flows — scored by `valueOf` where the turn actually left the
board. Pass terminates at depth one and scores the position after passing, so it needs no special
case. Every other ask delegates to the V1 machinery with the same weights, so an arena gap is
attributable to the search alone. The harness capability is `Explore` (`play.ts`): apply a whole
hypothetical line, prefix-cached so extension costs one advance per node.

### Two regressions found on the way, both of them old friends

- **A shared beam starved roots.** Pruning on intermediate value culled just-led cards — pure cost
  until their pips are spent, the exact state `settle()` exists to skip — and the bot chose Pass on
  turn one, section 2h's pathology back from the dead. Per-root beams fix it: width decides how well
  each root's turn is played, never whether a root gets to finish.
- **Lines drowned in the arrange sub-flow.** Value-neutral swaps filled every beam to its depth cap,
  so pips were never reached, every card scored as "played, bought nothing", and Pass won 35:48
  against standard's 1:82. The per-line cycle gate is the strictly-improving-repeat rule applied
  inside hypothetical lines, where `stepBot`'s turn history cannot see. Pass:play settled at 4:79.

Cost: median 0.13s, max 0.26s per searched decision at 6x16 on an uncontended machine (~10 searched
decisions per seat per game). Determinism pinned by test; five mutations caught, including a
prefix-cache poisoning that first appeared to survive because the mutation script's needle had
drifted and the mutation was silently a no-op — assert replacement counts in mutation scripts.

### Measured — 999 games x2 with twin, width 3 depth 14

| run | search 3x14 | standard | twin floor |
| --- | --- | --- | --- |
| vs standard x2 | **37%** wins, 20.7 power, rank 1.92 | 32%, 20.2, 2.01 | — |
| vs standard, twinned | 36% wins, 22.5 power | 33%, 22.5 | **5 points, 1.2 power** |

+5 points in the head-to-head — and then the noise run's twins spread 5 points between byte-identical
bots, two and a half times the floor section 3c measured for V1-family matchups. On that run alone:
suggestive, not a result.

### The 6x16 configuration, and what pooling four runs says

| run | search | standard | twin floor |
| --- | --- | --- | --- |
| 6x16 vs standard x2 | 35% wins, 20.4 power | 32%, 20.2 | — |
| 6x16 vs standard, twinned | 37% / 33% wins | 30%, 21.7 | 4 points, 0.6 power |

Doubling the beam width did not grow the edge — **the binding constraint is what the evaluator can
see, not search effort** — but the second pair of runs did something more useful than growing it:
it replicated it. Across all four runs (3,996 games), six search seats were measured against
standard, five came out ahead, mean **+3.2 points** — against a pooled floor of roughly 1.2 points
at that volume. No single run clears its own floor; the pooled, replicated effect does, clearly.

So the honest verdict is an upgrade on "suggestive": **a small, real edge of about +3 points**,
consistent across two configurations, and 3x14 is the one to ship (same effect, a third the cost).
The pooled analysis was not pre-registered, which is why it is stated as +3 with replication rather
than dressed up with a significance claim.

Worth noting for whoever reads the next table: games with a search seat run shorter (718-754 mean
decisions against 776-781 in the rival runs) at higher mean power for everyone, which is what
sharper play accelerating the whole game looks like.

## 8. V4 — the rivals' replies, over determinized hands

The one capability docs/03 always said a static evaluator cannot have: seeing what happens *after*
your turn. Tier 1's beam scores a turn at its own rosy end; the class of mistake a human feels and
punishes — the Relic left in a 1-key slot beside a fleet, the city built where it invites a siege,
the declaration the next player flips — lives entirely on the far side of that horizon.

### The hidden-hand problem, and the honest answer

Simulating a rival's reply means giving the reply bot an observation for that rival, and building
it from the true state hands the model their real cards — section 2k's oracle wearing cards instead
of dice. `Foresee` (`play.ts`) determinizes instead: each rival is dealt a hand from the unseen
pool — deck, rivals' hands and discard together, which is exactly the deciding faction's
information set — under a journal-derived generator, sizes preserved, self's hand untouched.
Replies are then driven by `standardBot`, the measured opponent model, until the ask returns to
self.

Two things the property tests caught while building it, both worth remembering:

- **The pool must be canonicalized before shuffling.** Pooled in zone order, the truth leaks
  through the indices — a shuffle is order-sensitive, so observer-identical worlds dealt different
  hands. The no-cheat test (two states differing only in hidden contents must foresee byte-identical
  replies) failed on exactly this, and sorting the pool is the fix.
- **The swap must happen before the line is replayed, not after.** The engine builds a rival's ask
  from their hand, so swapping after landing leaves a pending ask that lists their true cards.

`search-v4` re-ranks the top 3 tier-1 lines by mean value over 2 deals of foreseen replies, winner
chosen among the reply-checked only (tier-1 and tier-2 values sit at different horizons — replies
systematically deflate — and letting an unchecked line win at its rosy price flipped 7 of 12 card
plays before the guard was pinned). Cost: median 0.87s per card play.

### Measured — 999 games per run, both protocols, twins

| protocol | v4 | standard | twin floor |
| --- | --- | --- | --- |
| 3p, vs standard x2 | **43%** wins, 22.2 power, rank 1.85 | 29%, 19.1, 2.04 | — |
| 3p, twinned | 41% / 33% wins | 26%, 19.8 | 8 points |
| 2p, head-to-head | **67%** wins, 31.5 power | 33%, 22.3 | — |
| 2p, twinned | 50% / 50%, 29.5 / 29.5 power | — | **~0 points** |

Every v4 seat measured beats standard by +7 to +15 (mean +12) at three players — the worst copy
clears the twin spread on its own. At two players the result needs no statistics: two to one, on a
floor of zero. **This is the first idea since the goal layer to clear its own floor in a single
run**, and it did so by an order of magnitude, which is what "the evaluator's blindness was the
binding constraint" predicted if replies were the biggest blind spot left.

The ladder ships it as **brutal** (`levels.ts`); the gate this section set for it is passed in
both protocols. Games with a v4 seat also run *much* shorter at two players (413-462 mean decisions
against ~700) — punishment compounds fastest head-to-head, which is exactly where the group this
was built for actually plays.

## 9. The Weapon's battle option — a behavioural fix with no strength in it

Reported from play: the bots hoard Weapons and rarely spend resources at all. Measured over eight
three-player games — 705 Prelude menus, 161 spends (23%), and of the 274 menus offering a Weapon
option, **3 taken**. One per cent.

The cause was a genuine blind spot rather than a weight. Spending a Weapon grants no action; it adds
Battle to the played card's pips for the turn (rulebook p17, `state.anyBattle`), and **no feature
read that flag**. The evaluator saw a Weapon leave the board for nothing measurable, so it declined
271 offers out of 274. Exactly the shape of section 2g, where leading a card scored as pure cost
before pips were priced.

`battleUnlocked` is binary — pips live on the continuation, so `valueOf` cannot scale by them — and
doubly gated: on the engine's own `canBattle`, so it never prices an option the engine would not
offer, and on `self === current`.

**That second gate was a bug the tests caught, and it is the transferable lesson.** `anyBattle` is
one flag on the state, not a per-faction fact: it says the card *currently in play* may battle.
Scored without the check, every faction reads it as their own, and because `valueOf` is relative the
term largely cancels against itself. It appeared to work — spending rose 1% → 8% — purely because
rivals usually have no battle available, so the cancellation was partial. **Any future feature
derived from a global flag has this failure mode**, and a behavioural measurement alone will not
reveal it; the test that caught it asserts the weights genuinely move the value.

### Measured — 999 games x2 with twin

| run | weapon-option | standard | twin floor |
| --- | --- | --- | --- |
| vs standard x2 | 34% wins, 18.1 power, rank 1.97 | 33%, 17.8, 1.97 | — |
| vs standard, twinned | 34% / 33% wins, 17.8 / 18.2 power | 33%, 17.4 | **1 point, 0.4 power** |

One point against a one-point floor, and identical mean rank. **A null** — the fifth in a row for
evaluator ideas (3j, 3k, 6, the overflow weights, this).

### What it does buy, and the precedent for that mattering

The behavioural change is large and is what was actually reported:

| | standard | weapon-option |
| --- | --- | --- |
| Weapon spends offered → taken | 3 / 274 (1.1%) | 50 / 192 (**26%**) |
| Prelude spending overall | 23% | 29% |
| mean Weapons held | 0.69 | 0.32 |

Section 4's `leadZeroed` shipped on exactly these terms: no measurable strength, but declarations on
unscoreable ambitions went to zero, and "a bot burning its played card on an Empath nobody holds a
Psionic for looks broken". A bot sitting on four Weapons it will never spend looks broken in the
same way, and to the player who reported it, it did.

So this is a **shipping decision on opponent quality, not a strength claim** — and it is only
defensible while stated that way.

## 10. Easy: rebased on the shipped weights, and the livelock that found

Two changes to the ladder's bottom rung, one intended and one that the first change made visible.

### The rebase

`easyBot` ran `BASELINE_WEIGHTS` with `structuralFitness` — chosen as "the weakest configuration that
still plays a coherent game". That reasoning was wrong. `BASELINE_WEIGHTS` is not normal-but-weaker;
it is the evaluator from *before the entire goal layer*, with `incomeDeclared`, `declareReady`,
`standingContested`, `leadZeroed` and `battleUnlocked` all at 0. Easy was therefore not playing
worse, it was **blind to rules the other three levels can see**: it declared ambitions nobody could
score — the behaviour section 4 shipped `leadZeroed` to stop — and never once spent a Weapon.

Those are the tells that read as *broken* rather than *beatable*. Easy now runs `STANDARD_WEIGHTS`
with `feasibility` — normal's evaluator exactly — and differs from normal only by `SLACK`.

Measured take-up of the battle option, driven games: easy 0% before, and afterwards it ranks the
option **top** at the position section 9 pins, with the fumble then shrugging to a peer.

### The livelock

Adding an `easy` spec to the arena — the first time the level had ever been run at volume — showed
one game in five never finishing:

| seats | finished | wall clock |
| --- | --- | --- |
| `easy,standard,standard` | **191 / 240** | 30m43s |
| `standard,standard,standard` (control) | 240 / 240 | 9m02s |

The cycle, from the driven game: yellow alternating "Arrange your resource slots" → "Done" for
20,000 actions at log 201, chapter 3, round 5 — the same shape as the arrange/swap livelock in
section 2's gate note, and the same one that came back under probed-state rival intents (section 6).

**Cause: easy re-admitted what the gate excluded.** `heuristic.ts` refuses a repeated action that
does not strictly improve the position, and that gate is the reason a turn terminates. But it
decides the inner bot's *pick*, while `considered` reports every candidate including the ineligible
ones — and easy's whole job is to discard the pick and re-rank that list. Neither cycling action
writes to the log, and `publicHash` reads only public state, so the hash never moved and the same
"random" choice came up forever.

**Not a property of the weights.** The pre-rebase easy, reconstructed and run on the same games, hung
*more*: 12 of 40, against the rebased bot's 8 of 40. This has been in every shipped easy game since
the level existed. It did not present as a crash, because the app steps bots on a timer rather than
through `runBots` — it presented as a game that never handed the turn back.

**Fix:** `Considered` carries `eligible`, set where the gate is already computed, and easy fumbles
within the gate's pool with the same fallback the inner bot uses. No new termination argument — it
inherits the existing one.

| | before | after |
| --- | --- | --- |
| stuck, 40-game sample | 8 / 40 | **0 / 40** |
| arena, 240 games | 191 finished, 30m43s | **240 finished, 7m11s** |
| easy wins vs standard | 4% | 5% |
| easy mean power | 5.8 | 7.0 |

Strength is unchanged, which is the point: easy is still comfortably the easiest rung (5% wins
against normal's 48%, power 7.0 against 21.8), and is now weak by *fumbling close calls* rather than
by being blind to the game or by hanging.

### For the register

The lesson generalizes past this bot. Any caller that re-ranks `considered` is re-deciding without
the gate, and the gate is load-bearing for termination. That is why `eligible` is reported rather
than the ineligible candidates being dropped: the diagnostic panel still shows everything weighed,
and the next re-ranker has something to respect.

## 11. Re-baselining the ladder — brutal holds, hard has inverted

Sections 7 and 8 were measured before three engine changes landed: the tax filter (#15), the rule
that a follower must play a card (#16), and the Weapon's battle option shipping into
`STANDARD_WEIGHTS` (section 9). All three move the legal action set or what the shared evaluator
prices, so every number in those sections was stale. Re-run at the same 999 games per run, same
specs, same twin protocol.

**Sections 7 and 8 are left as they were written.** They record what was true when measured, and the
register only works if it is not rewritten in hindsight. This section supersedes them.

### Brutal — unchanged, and still the largest effect in the register

| protocol | v4 (brutal) | standard | twin floor |
| --- | --- | --- | --- |
| 2p, head-to-head | **65%** wins, 31.6 power | 35%, 24.9 | — |
| 2p, twinned | 50% / 50%, 30.5 / 30.5 | — | **~0 points** |
| *section 8, for comparison* | *67%, 31.5* | *33%, 22.3* | *~0* |

A 30-point gap on a zero floor, within 2 points of the original. Brutal's claim survives intact.

### Hard — no longer ahead, and now measurably behind

| run | search-v3(3x14) | standard | twin floor |
| --- | --- | --- | --- |
| 3p, vs standard x2 | 32% wins, 19.0 power, rank 2.01 | **34%**, 19.8, 1.95 | — |
| 3p, twinned | 31% / 30%, 20.5 / 20.6 | **39%**, 23.0, 1.87 | **1 point, 0.1 power** |
| *section 7, for comparison* | *37%, 20.7, 1.92* | *32%, 20.2, 2.01* | *5 points* |

The sign has flipped. Standard leads in both runs — by 2 points in the head-to-head and by 8-9 in
the twinned run — against a twin floor of **1 point**, the tightest this arena has ever measured at
999 games. Both gaps clear it, and the power gaps (+0.8 and +2.4) clear the 0.1 power floor by more.

This is not the familiar "the edge was inside the floor all along" null of sections 3j and 6.
Section 7's +3.2 was pooled across four runs against a ~1.2-point floor, so it was always a modest
claim — but a modest claim of the *opposite sign* is a different thing, and **the ladder's middle
rung is currently easier than the rung below it.**

### What to suspect, in order

Not yet investigated — recorded so the next session does not start from scratch.

1. **The follower-pass fix (#16).** Section 7's beam has history here: it chose Pass on turn one when
   a shared beam starved roots, and drowned in the arrange sub-flow until the per-line cycle gate
   landed. `search.ts` treats Pass as a root that terminates at depth one, and #16 removed Pass from
   the follow menu entirely. A beam whose root set changed shape is the first place to look.
2. **The Weapon option inside searched lines.** Section 9 measured `battleUnlocked` as a null *for
   the heuristic bot* and shipped it on behaviour. `search.ts` builds its delegate from
   `STANDARD_WEIGHTS`, so it inherited the term without ever being measured with it — and a feature
   worth nothing to a one-ply evaluator is not automatically worth nothing to a beam that spends
   fourteen plies of budget on the lines it opens.
3. **Depth 14 against a longer turn.** If #15 and #16 changed the mean actions in a turn, a fixed
   depth budget buys a different fraction of it than it did when 3x14 was chosen.

Until one of these is understood, **`hard` should not be described as stronger than `normal`** in
`levels.ts` or in the UI.

## 12. Per-rival intent, re-measured — the null did not survive as a null

Section 6 measured per-rival intent and recorded no effect. That measurement was taken when an
attacker's destroyed ships went home to reserve, so the only way to feed a rival's Warlord was to
lose while **defending** — which a bot never chooses. PR #18 fixed the rule (rulebook p14: the
defender takes destroyed attacking pieces as Trophies), so every battle the bot initiates and takes
interception on now feeds the defender. The mechanism's surface area grew; the measurement had not
followed it.

That is the whole argument for re-testing a recorded null, and it is worth stating plainly because
the prior was against it: section 0's register had four consecutive re-pricings measuring nothing or
worse, and this is a re-pricing.

### Measured — section 6's protocol exactly, 999 games per run

| run | rival-intent | standard | twin floor |
| --- | --- | --- | --- |
| vs standard x2 | 31% wins, 17.4 power, rank 2.02 | **35%**, 18.0, 1.95 | — |
| twinned | 33% / 31%, 17.8 / 17.5 | **36%**, 18.3, 1.93 | **2 points, 0.3 power** |
| *section 6, for comparison* | *35%, 18.8* | *32%, 18.5* | *2 points, 0.4* |

All 1,998 games finished, none stalled.

**The sign flipped.** Standard now leads both runs — by 4 points head-to-head and 3-5 twinned —
where section 6 had rival-intent 3 ahead.

**Read against this project's own bar, not a friendlier one.** Section 6 dismissed +3 on a 2-point
floor as "the floor talking, not a result". Consistency requires the same caution in reverse: -4 on
a 2-point floor is roughly twice the floor, which is suggestive rather than decisive. The honest
verdict is **still not better, and probably slightly worse**. Either way it does not ship, and the
shipped bot keeps one intent for everyone.

### Two caveats that belong with the number

- **The attribution is not clean.** This sits downstream of *two* changes since section 6 — the p14
  trophy fix and the dice-selection fix (#19) — and both act through the same channel, how often
  ships are lost. "The trophy rule killed rival intent" would be an overclaim; all that can be said
  is that the idea does not measure better under the current rules.
- **`rivalIntent` stays in the tree**, as section 6 left it: an option on `heuristicBotWith` and a
  flag on `searchBot`, off by default. It costs nothing switched off, and the next idea that wants
  to measure *in combination* with it should not have to rebuild it.

### The pattern worth more than this result

Two pre-#18 measurements have now been re-run, and **both flipped sign**: `hard` went from +5 to -2
(section 11), rival intent from +3 to -4. Two is not a trend, but the direction is consistent, and
the implication is uncomfortable in a useful way — the register's older entries were measured
against an engine that has since changed underneath them, and some of them are probably no longer
true. The entries record what was measured when, which is exactly why they are not rewritten; but
their *shelf life* is shorter than it looks, and any of them being leaned on for a decision today
deserves a re-run first.

## 13. The ladder re-baselined again — hard's inversion was mostly an artifact

Section 11 was measured after the follower-pass fix but **before** the p14 trophy fix (#18) and the
dice-selection fix (#19). The second of those is the reason to re-run rather than a general worry
about staleness: the beam's prune keeps offer order on equal lines, which is exactly the tie-break
#19 fixed, so `hard` and `brutal` were collecting undersized dice pools *inside every searched line*,
not merely at the real ask. If that was distorting the beam's evaluation of its own lines, the fix
should move the search bots more than it moves standard. It did.

### Hard — still behind, but not by what section 11 reported

| run | search-v3(3x14) | standard | twin gap |
| --- | --- | --- | --- |
| 3p, vs standard x2 | 31% wins, 19.8 power, rank 1.99 | **34%**, 19.5, 1.97 | — |
| 3p, twinned | 33% / 33%, 21.7 / 20.8 | 34%, 21.8, 1.96 | **0 points, 0.9 power** |
| *section 11, pre-#18/#19* | *32%, 19.0 / 31%+30%* | *34% / **39%*** | *1 point, 0.1 power* |

**The damning number does not reproduce.** Section 11's twinned run had standard at 39% against
31%/30% — an 8-9 point rout, and the strongest evidence for the inversion. It is now 34% against
33%/33%, a **1-point** gap.

**Power says nothing at all here.** The twins differ by 0.9 power, which swamps the 0.3 that
separates the bots. Any power reading at this volume is the floor talking.

**On win rate hard is still behind**, by 3 points in the head-to-head and 1 twinned, against a
0-point twin gap. So the finding stands in direction and collapses in magnitude: hard is *marginally*
behind normal, not the clearly-weaker rung section 11 described. Section 11's own hedge — "a modest
claim of the opposite sign is a different thing" — was right to be modest and still overstated it.

`levels.ts` is corrected accordingly: hard is **not stronger than normal**, which remains the honest
thing to tell a player, but "misnamed" and "easier than the rung below it" go too far and are gone.

### Brutal — a third measurement, in the same place

| protocol | v4 (brutal) | standard | twin floor |
| --- | --- | --- | --- |
| 2p, head-to-head | **64%** wins, 32.1 power | 36%, 25.0 | — |
| 2p, twinned | 50% / 50%, 30.8 / 30.7 | — | **~0 points** |
| *section 11* | *65%, 31.6* | *35%, 24.9* | *~0* |
| *section 8* | *67%, 31.5* | *33%, 22.3* | *~0* |

Three measurements, three engine states — the follower-pass fix, the trophy fix, the dice fix — and
the result moves by 3 points across all of it, always on a zero floor. **Brutal is the most robust
entry in this register**, and the only idea that has ever cleared its floor by an order of magnitude.

### What this says about the register

Section 12 closed on the observation that two re-run measurements had both flipped sign, and
suggested the older entries have a short shelf life. This run sharpens that into something more
useful:

- **Large effects survive engine changes.** Brutal has been re-measured three times across three
  sets of rules changes and has not moved.
- **Small effects do not, and their *magnitudes* are the first thing to go.** Hard's direction held
  across the re-run; its size did not, and section 11's most quotable number turned out to be
  measuring a bug that has since been fixed.

The practical rule: a register entry near its floor should be treated as a direction, never as a
magnitude, and re-run before it is used to justify anything.

## 14. The ladder cut to three — and replies are one deal, not six

Section 13 left the ladder with four rungs and only three distinct strengths. This resolves that,
and answers a second question on the way.

### The v3 beam is not a rung

It was `hard` for as long as it measured ~+3 points over normal (section 7). Re-measured after the
trophy and dice fixes it sits 1-3 points *behind* normal on win rate with power inside the floor
(section 13). A configuration that costs a beam search at every card play and does not beat the bot
below it is not a difficulty setting, so it comes off the ladder. `searchBot` is untouched — the new
`hard` is the same function with replies switched on — so this removes an entry, not code.

### How many replies? One is as good as six

The reply search shipped at `roots: 3, deals: 2`. The obvious use for that parameter was a rung
*between* normal and the reply search, so it was measured at `1 x 1`:

| config | vs standard, 2p | twin floor | wall clock, 999 games |
| --- | --- | --- | --- |
| `reply:1:1` | **63%** wins, 32.3 power | 50/50, 31.2/31.2 — **~0** | **11m21s** |
| `reply:3:2` | 64% wins, 32.1 power | 50/50, 30.8/30.7 — ~0 | 23m24s |

**Indistinguishable in strength, and 3 x 2 costs twice the wall time.** So there is no intermediate
rung to be had from this dial — and the shipped configuration was paying double for nothing. `hard`
is now `reply:1:1`.

That the *sixfold* difference in sampled rival hands changes nothing is the interesting part. One
sample of what the rivals might do is enough to fix the blind spot; refining that sample further
only sharpens a number that was already good enough to decide on.

### The pattern this completes

Three independent attempts to buy strength with more search effort, three nulls:

| more of what | result | section |
| --- | --- | --- |
| beam width and depth, 3x14 -> 6x16 | nothing | 7 |
| determinized deals, 1x1 -> 3x2 | nothing | 14 |
| rival intents recomputed per rival | nothing, then worse | 6, 12 |

Against which every idea that *did* move strength let the evaluator see something it structurally
could not see before: the rivals replying at all (section 8), the Weapon's battle option (section 9),
an unscoreable declaration's cost (section 4). Section 0 has said this from the start; it now has
three separate confirmations from the search side alone.

**So there is no rung above `hard`, and that is a measured position rather than unfinished work.** A
fourth rung needs either that kind of discovery — which the register says arrives rarely and cannot
be scheduled — or a rule handicap in the style of SUPERCAT's optional modifiers, which is a design
decision about what the game is rather than an engineering one.

### The ladder as it stands

| rung | bot | measured against normal |
| --- | --- | --- |
| easy | `easyBot` | 5% wins to normal's 48% |
| normal | `standardBot` | the reference |
| hard | `search-v4(3x14,r1x1)` | **63%-37%** at 2p, zero twin floor |

Levels no longer promise a saved game keeps the opponent it started against: a game saved against
the old `hard` now loads against the new one. That promise is worth less than a correct ladder.

## 15. Hand quality — measurably worse, and the lesson is about expiry

The largest piece of legal, unpriced information left: `observed.hand` carries suit, strength and
pips, and the evaluator read only a count (`tempo`) plus a declare gate. Two features, priced as one
idea — the residual hand priced by its cards:

- `handPips` — Σ pips over the hand: remaining action potential.
- `handTopCard` — max strength: the standing option to surpass, seize initiative, or declare late.

Deliberately opposed, because the deck trades pips against strength. Guarded to self like
`declareReady`. Weight 0 in `WEIGHTS` and `BASELINE_WEIGHTS`; `hand.ts` switches them on at
0.1/pip and 0.08/strength, sized against measured card-play margins.

The behavioural gate looked *right*: 15 divergences in ~800 driven steps, every one a Lead or
Pivot, all in the intended direction — lead the middling card, keep the 4-pip workhorses and the
top card.

### Measured — section 6's protocol, 999 games per run

| run | hand-quality | standard | twin floor |
| --- | --- | --- | --- |
| vs standard x2 | 30% wins, 17.1 power, rank 2.02 | **35%**, 18.2, 1.96 | — |
| twinned | 31% / 31%, 16.9 / 17.1 | **38%**, 19.1, 1.86 | **~0 points, 0.2 power** |

**Measurably worse: 5-7 points behind on a floor of zero.** The cleanest negative result in this
register — larger than the lore result (3k) and on a tighter floor. Does not ship; the features stay
at weight 0 and `handBot` stays in the tree so the measurement can be reproduced, as `rivalBot` did.

### Why a sensible-looking idea lost points

The divergences the gate showed were "hoard the good cards" in every case, and that is the bug, not
the feature working: **a hand is not a store of value, because the chapter clock expires it.** Cards
kept for their pips or their surpass option die worthless when the chapter ends; leading the 2 now
is worth more than banking the 4, because "now" is the only time a card is guaranteed to have. The
features priced the option and not its expiry, so the bot paid real tempo — the initiative fights
and pip-turns it declined — for options it frequently never exercised.

This refines section 0's dictum rather than contradicting it. The wins (goal layer, replies) let the
evaluator see something *about the world*; this let it see an asset and mispriced the asset's decay.
New information is not automatically neutral-or-better: attached to the wrong price, it is a bias
with good intentions.

An honest follow-up would price the hand *relative to the chapter's remaining rounds* — a card in a
six-round chapter is an option, the same card one round from scoring is nearly dead weight. That is
a new experiment with its own twin run, not a re-tune of this one; nothing here licenses it beyond
noting the shape.

### The register at this point

Six consecutive evaluator ideas measured null or worse: guard (3j), lore (3k), rival intent (6,
re-confirmed worse 12), the Weapon option (9, null on strength, shipped on behaviour), and now hand
quality — against two ideas that ever cleared a floor: the goal layer and the replies. The bar for
the next idea is not "plausible and unpriced"; it is "explains a loss the bot actually suffers".
