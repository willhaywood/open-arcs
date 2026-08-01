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

### What would actually be needed

One-shot regression on a fixed policy's trajectories is not policy iteration. Doing this properly
means some of:

1. **Iterating** — fit, play with the fitted weights, refit. One pass has no improvement loop at all.
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
