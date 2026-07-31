# Arcs Digital — AI implementation plan

docs/03 is the *approach* and is still sound. This is the plan to build it, written against the
engine as it actually stands rather than as docs/03 anticipated it. Read docs/03 section 2 first —
the value/policy split it argues for is the spine of everything below — and section 9a for how bot
seats work alongside humans.

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
| Court cards held | ×~1 plus ability value | Guild abilities are live effects, not score |
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

## 3. V2 — rollouts

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

## 4. V3 — information-set search

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
   tell whether rollouts helped.
7. V2 rollouts.
8. Difficulty ladder (docs/03 section 8) — cheapest once there are two strengths to interpolate
   between.

Steps 1 and 2 are small and unblock the rest; step 4 is the one most likely to be skipped and most
expensive to skip.
