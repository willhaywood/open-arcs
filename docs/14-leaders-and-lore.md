# Leaders and Lore — card classification

Status: **phase 2 done, with its UI** — the variant deals, drafts on its own screen, and seats.
Leaders change the opening position; their trait effects and the lore effects are phase 3
(section 5).

This records what the cards *are*, so the base/expansion split does not have to be re-derived
from images later.

Sources: haunt-roll-fail `arcs/game-leaders.scala` and `arcs/game-lore.scala` for the data model
and effects; the arcs_tts mod (`src/BaseGame.lua`) for the deck split; the card art in
`assets/images/leader` and `assets/images/lore` for the printed text.

**The TTS mod cannot arbitrate effects.** It is a components-only implementation: its lore and
leader cards are plain `Card` objects with empty descriptions, and the only Lua touching them
(`BaseGame.lore_visibility`) toggles whether a deck is visible. It was a genuine second source for
board topology and the base/expansion split, and it is not one for what a card *does*. That leaves
two sources for effects — the printed card, which is authoritative, and HRF, which is one person's
reading and is wrong often enough to be checked rather than transcribed. Where the two disagree or
the card is ambiguous, the disagreement is recorded rather than silently resolved.

## 1. Where the expansion boundary falls

Every Leaders & Lore card carries the set code **`L`** in its bottom-left corner, and nothing on
the card distinguishes the base game from the *Leaders & Lore Pack* expansion. That is worth
stating plainly, because the code is otherwise a reliable set marker — court cards use `BC` for
the base deck and `CC` for the campaign one, and comparing those was how the marker's meaning was
confirmed. It simply is not used to separate these two sets.

The split is therefore taken from the box contents, by card number:

| | Base game | Expansion | Unofficial |
| --- | --- | --- | --- |
| Leaders | `leader01`–`leader08` (8) | `leader09`–`leader16` (8) | — |
| Lore | `lore01`–`lore14` (14) | `lore15`–`lore28` (14) | `lore29`–`lore30` (2) |

Two independent things corroborate it:

- **Leaders.** Both three-trait leaders (Noble, Anarchist) are in 09–16, as are the traits that
  reach furthest into other subsystems — `Learned` rewrites the draft itself, `Hated` and
  `Decentralized` scrap pieces during setup, and `Mythic` makes a planet's type mutable.
- **Lore.** All five cards HRF has *not* implemented (`def done` in `game-lore.scala` lists 25 of
  30) fall inside 15–28, and the ten ambition-paired cards — Empath's, Keeper's, Warlord's,
  Tyrant's, Tycoon's, two each — run 19–28 without interruption.

`lore29` Guild Loyalty and `lore30` Catapult Overdrive are HRF's own `UnofficialLore`: fan cards,
not printed in either box. They should be a separate opt-in, never bundled into "expansion".

## 2. Leaders

Traits, then the two starting resources. Setup pieces per position (A/B/C) are in HRF's table and
are **not** the board's default City+3 / Starport+3 / 2-per-fleet — see section 4.

### Base (01–08)

| # | Name | Traits | Resources |
| ---: | --- | --- | --- |
| 01 | Elder | Beloved, Just | Relic, Material |
| 02 | Mystic | Attuned, Cryptic | Psionic, Relic |
| 03 | Fuel Drinker | Insatiable, Lavish | Fuel, Fuel |
| 04 | Upstart | Ambitious, Callow | Psionic, Material |
| 05 | Rebel | Committed, Disorganized | Material, Weapon |
| 06 | Warrior | Tactical, Violent | Weapon, Material |
| 07 | Feastbringer | Charismatic, Generous | Relic, Material |
| 08 | Demagogue | Bold, Paranoid | Psionic, Weapon |

### Expansion (09–16)

| # | Name | Traits | Resources |
| ---: | --- | --- | --- |
| 09 | Archivist | Learned, Academic | Relic, Relic | *(both traits implemented)*
| 10 | Overseer | Ruthless, Hated | Fuel, Material |
| 11 | Corsair | Tricky, Wary | Fuel, Weapon |
| 12 | Noble | Connected, Influential, Proud | Psionic, Psionic |
| 13 | Anarchist | Decentralized, Inspiring, Principled | Relic, Weapon |
| 14 | Shaper | Mythic, Ancient | Relic, Material |
| 15 | Agitator | Firebrand, Irregular | Fuel, Material |
| 16 | Quartermaster | Resilient, Greedy | Fuel, Weapon |

**A/B/C, not A/B/C/D.** The TTS mod defines four leader setup markers per colour, but its `D`
image is byte-identical to its `C`, and every leader card prints exactly three positions. Our
board topology's `[city, starport, fleets[]]` shape is sufficient; no fourth position is needed.

## 3. Lore

Marked where HRF has no implementation, which is a fair proxy for difficulty.

### Base (01–14)

Tool Priests, Galactic Rifles, Sprinter Drives, Mirror Plating, Hidden Harbors, Signal Breaker,
Repair Drones, Gate Ports, Cloud Cities, Living Structures, Gate Stations, Railgun Arrays,
Ancient Holdings, Seeker Torpedoes.

All 14 are implemented in HRF.

### Expansion (15–28)

| # | Name | HRF |
| ---: | --- | --- |
| 15 | Predictive Sensors | done |
| 16 | Force Beams | done |
| 17 | Raider Exosuits | done |
| 18 | Survival Overrides | done |
| 19 | Empath's Vision | done |
| 20 | Empath's Bond | **not implemented** |
| 21 | Keeper's Trust | done |
| 22 | Keeper's Solidarity | **not implemented** |
| 23 | Warlord's Cruelty | done |
| 24 | Warlord's Terror | **not implemented** |
| 25 | Tyrant's Ego | done |
| 26 | Tyrant's Authority | **not implemented** |
| 27 | Tycoon's Ambition | **not implemented** |
| 28 | Tycoon's Charm | done |

The unimplemented five are all ambition-manipulating, and all are the *second* card of their
ambition pair. The first of each pair (Vision, Trust, Cruelty, Ego, Charm) is a reroll or an
outrage-clear; the second changes how an ambition scores. That is the hard category.

## 4. What the classification implies

**Deck sizes bound the draft.** HRF deals `factions + 1` leaders, and
`factions + 1 + extra × factions` lore, where `extra` is 0–4 for the ×1–×5 lore options
(`DoubleLore`…`PentaLore`, mutually exclusive, all requiring `LeadersAndLore`).

| Players | Leaders needed | Lore needed at ×1 / ×2 / ×3 / ×4 / ×5 |
| ---: | ---: | --- |
| 3 | 4 | 4 / 7 / 10 / 13 / **16** |
| 4 | 5 | 5 / 9 / 13 / **17** / **21** |

Base-only supplies **8 leaders and 14 lore**, so the higher lore multipliers overrun a base-only
deck: 3p needs 16 at ×5, and 4p needs 17 at ×4 and 21 at ×5. The UI must cap the lore multiplier
against the selected pool rather than offering a combination that cannot be dealt. With the
expansion (28 lore) every combination fits; the two unofficial cards are not needed to make the
numbers work.

**Base-only is a genuinely lighter rules surface**, not merely fewer cards: it excludes the
draft-rewriting `Learned`, the setup-scrapping `Hated` and `Decentralized`, and all ten
ambition-paired lore. That makes "base only" the natural first implementation target.

## 5. Implementation status

**Phase 1 — data and options. Done.**

- `packages/engine/src/leaders.ts` — all 16 leaders: traits, starting resources, and the A/B/C
  setup lists that replace the board's standard placement. `LeaderTrait` is a closed union, so a
  mistyped trait is a compile error rather than an effect that silently never fires.
- `packages/engine/src/lore.ts` — all 30 lore cards with their set, plus the draft sizing helpers
  (`leadersNeeded`, `loreNeeded`, `maxLorePerPlayer`).
- `NewGameOptions.leadersAndLore` — absent for a base game, so the option's absence is what turns
  the variant off. Verified to survive save/load, which the draft in phase 2 will rely on.
- The start screen offers the variant, the expansion, the fan-made cards, and lore-per-player.

The lore-per-player buttons are **capped against the selected pool** rather than offering a deal
that would run the deck dry, and the cap clamps a selection downward when the pool shrinks —
choosing x5 with the expansion on and then disabling it leaves you on x3, not on an impossible
x5. Disabled rather than hidden, so it reads that the expansion is what unlocks the higher
settings.

Tests are in `packages/engine/test/leaders-lore.test.ts`. They are transcription tests: what can
go wrong here is a wrong number or a missing card, not logic. The one guarding a real crash is
"no leader can outspend a faction supply" — a leader whose setup asked for more ships than a
faction owns would throw during setup in phase 2. Both it and the set classification were
confirmed to fail when the data is deliberately broken.

**Phase 2 — the draft and the setup override. Done.**

`packages/engine/src/rules/leaders.ts`, prepended to the rule chain when the variant is on. It
sees `setup/seat` before the base setup module and seats factions itself — the interception
docs/04 section 2.4 designed the chain for. Base setup is not forked; it is simply not reached.

1. **Deal** from the seeded generator, so a replay deals the same cards.
2. **Draft** one card per turn — a leader while you have none, then lore up to your quota.
3. **Seat** each faction with its leader's own pieces and its two printed resources.

> **The draft order is a repeating reverse cycle, not a snake.** An earlier sketch of this plan
> said snake, which was wrong. HRF starts at `factions.last` and each step takes the *previous*
> faction in seating order (`DraftNextAction`), so four players go white, blue, yellow, red, and
> then round again. The deal sizes work out exactly: every player takes one leader and their lore
> quota, leaving precisely the one leader and one lore the draft terminates on.

**Setup is shared, not duplicated.** `seatFaction` in `rules/setup.ts` takes a `SeatPlacement`
and an optional resource list; the base game passes `STANDARD_PLACEMENT` and lets the starting
systems decide the resources, a leader passes its own lists. The base opening turns out to be
exactly the shape of a leader card — City+3 / Starport+3 / 2-per-fleet — so there is one
implementation and a leader can only differ in the lists. The setup log now names the pieces
actually placed, since "placed a City in X" is wrong for a leader that places a Starport there.

Tests are in `packages/engine/test/leaders-draft.test.ts`, covering the draft order at 3 and 4
players, the lore quota at x1/x2/x3, no card dealt twice, the expansion setting being respected,
and journal replay and save/load through the draft.

The test that carries the weight is *"places exactly what each of the 16 leaders prints"*: a
leader that quietly placed the standard opening would pass every other test, because the draft
would still look right. It sweeps seeds until all 16 have actually been drafted and asserts that
coverage — an earlier version silently checked only the five that seed 5 happened to offer, which
is the failure mode worth guarding against. Breaking the override to always place the standard
opening fails it on Upstart's extra ship.

**The draft has its own screen** (`DraftScreen.tsx`), not a list of buttons in the action panel.

**It deals.** Entering the screen turns every card over, staggered left to right — the leader and
lore decks' own backs flipping to their faces, with the box piles standing still beside them. The
flip turns the inner element while the front image stays **in flow** and the back is overlaid on
it, so the animation changed nothing about how a card is sized.

A card turns over **once**, tracked in a module-level `revealed` set, or the whole table would flip
again after every pick. The set is keyed `<game>:<card>`, and the game number comes from
`store.generation` — a counter the store increments on `start`. That counter has to exist because
two games from the same seed are *identical in state*, right down to the card ids: nothing the
engine holds separates them, so a set keyed on the id alone opened the second game with every card
already face up. The same number is in the React key, which is what remounts the cards — clearing a
set does not reset a mounted component's own state, which is the trap this went through on the way.
It is the problem `Dice3D` already solves with `instance` in a roll's signature.

A draft is a reading exercise before it is a choosing one: what makes a leader worth taking is
its printed text, and what makes it worth taking *now* is what everyone else has already got. So
the screen shows the whole dealt pool at once and **keeps taken cards in place, tagged with their
owner**, rather than removing them as they go — the table can see what has gone, read it, and
plan against it.

Two details that carry that intent:

- The owner ribbon rides at the **top** of a card, over the illustration. Both card types print
  their rules in the lower half, and a banner across the bottom hid exactly the text a rival most
  needs to read, which would have defeated the point of leaving the card there at all. Taken
  cards are dimmed only lightly, for the same reason.
- **Clicking reads; taking is a second click** from inside the reader. Studying a rival's leader
  should not be able to draft it by accident.

`state.draft` holds only what is *left*, so the taken cards are recovered from where they went
(`state.leaders` / `state.lores`) and the row is sorted by id — a stable order, so a card does not
move as its neighbours are taken.

**The drafted cards also appear on the player boards** (`Drafted` in `PlayerBoards.tsx`), named
and clickable, sharing the same reader. Without that they vanished the moment the draft screen
closed: a player would choose a leader and then have no way to recall which one, let alone read
what it does. The leader is gold-edged to separate it from lore and from secured guilds.

**The leader also appears on the player boards**, in two treatments, because the two boards are
read differently.

The acting player's board carries a **portrait panel** down its right edge; the rival boards wash
the same art faintly behind their contents. The wash was tried on both first and was the worst of
both on the acting board: its content spans the full width, so the art never got to show, and
every part that did show competed with a number someone was reading. A column of its own lets the
portrait be shown nearly unscrimmed without costing legibility anywhere.

Both crops have the same thing to avoid. A leader card's **lower half is a white panel of rules
text** — the art ends at about 51% of the card's height — so any crop reaching past that puts
printed body text and the card's own name behind the readout. The first attempt did exactly that,
and it is worth recording how, because the constraint is not obvious:

- **Rivals, bounded by width.** Under `cover` the art scales to the board's *width*, so how far
  down the card it is safe to pan depends on how wide the board is: the full board (378px) sees a
  quarter of the card and could pan to 35%, a mini (~200px) sees nearly half and can pan to 6%. A
  single value for both dragged the card's name band up into the minis' tallies. They are pinned
  to the top, which is safe at any width.
- **The acting player, bounded by height.** `background-size: auto 196%` scales the card so its
  top 51% is exactly the panel's height (1 / 0.51), and `center top` shows precisely that. This
  holds at any panel height, so unlike the width-driven crop it cannot drift if the board is
  resized. The panel is narrower than the art and centre-crops horizontally, which is where these
  illustrations put their subject.

**Rivals get the panel too once the row can pay for it**, falling back to the wash when it cannot.
The switch is a **container query on `.player-boards`**, not a media query, because the viewport is
not a usable proxy: the side column is `clamp(220px, 21vw, 300px)`, so the width left for the
boards is not a fixed offset from the window (measured 324px of chrome at a 1600px viewport and
297px at 1300px). The row's own inline size answers the question directly. Containment is safe
here — the `boards` grid area is sized by the grid's `1fr` track, never by the boards' contents.
(The row still spans the full track even though the boards are now centred within it, which is
what the query wants to know: how much room is available, not how much is currently used.)

The thresholds are measured, not guessed. With every portrait shown the row needs 1002px at three
players and 1272px at four; the queries sit at 1040px and 1310px, leaving headroom for a long lore
name widening a board. Two thresholds are needed because a fourth player adds a whole board rather
than just a panel, hence the `p3` / `p4` class on the row.

**The panel carries no caption.** It had one at first, and it truncated: the longest leader names
("Feastbringer" needs 101px in a 75px panel, "Quartermaster" more) are single words with no break
opportunity, so they either clip or hyphenate mid-word, and shrinking type to fit lands well below
legible. On the rival boards it was also printing the name twice, once on the panel and once on
the chip beside it. The gold leader chip in the drafted row names it on every board instead, which
keeps the naming identical whether or not the panel is showing.

`.pb-frame` needed an explicit `z-index`: the panel follows it in the DOM and both are positioned
with `z-index: auto`, so the panel was painting over the board's top-right corner bracket.

The panel widens the acting board from 378px to 452px. The board row already overflows below about
1100px of viewport — by 504px at 800px wide, against the panel's 74px — so this makes an existing
narrow-viewport problem slightly worse rather than causing one. Neither is handled yet; the rival
panels do not contribute, since below their threshold they are not shown.

### Skipping the draft

The draft header carries a **Randomize rest** button that fills every remaining pick at random.
It exists to get to the board quickly while the rest of the variant is being built, and it is
styled quietly for that reason — it skips the part of the game the screen exists for.

Each pick is dispatched as an ordinary `leaders/take`, so the journal, undo, save and replay are
exactly as if the cards had been clicked; undo steps back one card at a time and re-opens the
draft. `Math.random` is safe here because it only chooses *which action to send* — the action
itself is recorded, so replaying the resulting journal is still deterministic, and engine
randomness stays on the seeded generator.

`LeaderCardReader` is shared by both surfaces and portals to `body`, for the same reason
`CardZoom` does: opened from a player board it would otherwise be trapped in `.player-boards`,
which is its own stacking context, and would paint under the header.

**Phase 3 — base-game trait effects. All sixteen done.**

The sixteen traits on leaders 01-08, and where each landed:

| Trait | Leader | Effect | Status |
| --- | --- | --- | --- |
| Cryptic | Mystic | Starts outraged on Material and Fuel | done — `rules/leaders.ts` |
| Committed | Rebel | Two extra battle dice | done — `rules/battle.ts` |
| Disorganized | Rebel | Never move more than 2 ships at once | done — `rules/standard-actions.ts` |
| Insatiable | Fuel Drinker | +1 Fuel when a Copy/Pivot taxes | done — `rules/standard-actions.ts` |
| Attuned | Mystic | +1 Psionic when a Copy/Pivot taxes | done — `rules/standard-actions.ts` |
| Paranoid | Demagogue | No securing a Guild card held by one agent | done — `rules/standard-actions.ts` |
| Just | Elder | Tyrant: first pays `low`, second pays 0 | done — `rules/ambitions.ts` |
| Violent | Warrior | Empath: same | done — `rules/ambitions.ts` |
| Lavish | Fuel Drinker | Discard all Fuel when Tycoon scores | done — `rules/ambitions.ts` |
| Ambitious | Upstart | Gain any resource on declaring | done — `rules/leaders.ts` |
| Callow | Upstart | Tax Loyal cities only where you rule | done — `rules/standard-actions.ts` |
| Beloved | Elder | Influence after defending; no Ransack against you | done |
| Bold | Demagogue | Influence any number of court cards on declaring | done — `rules/leaders.ts` |
| Generous | Feastbringer | Give a Guild card to the weakest Rival to declare | done — `rules/leaders.ts` |
| Tactical | Warrior | Move before or after a Copy/Pivot battle | done — `rules/turn.ts` |
| Charismatic | Feastbringer | Influence before or after a Copy/Pivot secure | done — `rules/turn.ts` |

**Traits are read where the decision is made, not by interception.** `hasTrait(state, faction,
trait)` in `leaders.ts` is the whole mechanism, and it returns false whenever `state.leaders` is
empty — so a base game is untouched and a trait check costs nothing. Only two effects live in the
leaders module: Cryptic, which fires inside the seating that module already performs, and
Ambitious, whose ask it owns. The rest are single decisions buried inside base computations — a
dice limit, a fleet size, a scoring line — and intercepting those would mean restating the whole
computation in the expansion, which is how the two copies drift apart.

`hasTrait` takes its state parameter *structurally* rather than as `GameState`: `state.ts` imports
this module for `LeadersAndLoreOptions`, so importing `GameState` back would close a cycle.

**"When you Copy or Pivot" is derived, not stored.** Four traits key off it, and HRF spells it
`f.copy || f.pivot` (game-common.scala:766). Each faction plays exactly one card per round, so its
last entry in `roundPlays` is this turn's play — `copiedOrPivoted` in `observe.ts` reads that. No
new state to keep in sync, and it survives undo and replay for free.

### The Archivist (leader09) — the first expansion leader wired up

Both its traits are done, ahead of the rest of the expansion set, because its lore draw was
reported not working.

**Learned: "After setup, gain 2 extra lore cards — draw 5 lore, keep 2, and scrap the other 3
(returning them to the box)."**

The five come off the top of what the deal left over, so the deal now *keeps* that remainder:
`state.unusedLore` holds the shuffled cards nobody was dealt, plus the single card the draft
terminates on, which was never taken either. Previously the remainder was computed and thrown
away, which is why there was nothing to draw from.

It fires **after every faction is seated**, not after the Archivist's own seating — the card says
"after setup", and the official note on leader setup steps names this card as the example of one
performed after drafting everything. It continues straight to the chapter rather than back through
the seating loop, which would offer it again.

All five drawn cards leave the box whichever two are kept; the other three are scrapped, not
returned. A box with fewer than five left is not an error — it offers what it has, which nothing in
the base deck can reach but a large expansion draft comes close to.

**Academic** is the Tycoon twin of Just and Violent — word-for-word the same text on the card — so
it is one more line in the shared `demotesFirst` predicate rather than its own rule.

**It has its own screen** (`LearnedScreen.tsx`), sharing the draft's card presentation. It was
briefly a list of the ten possible pairs, which is the same problem the draft screen exists to
solve: these are lore cards, and a pair of names in a button says nothing about what either does.

One thing is deliberately different from the draft. **Clicking a card keeps or unkeeps it**, rather
than opening the reader with taking as a second click. That rule exists in the draft because taking
is irreversible and a mis-click steals from a rival; here nothing is committed until *Keep these*,
so a direct toggle is safe and saves four clicks. Each card keeps a small magnifier that opens the
same reader when the printed text is what matters.

The screen invents no choice: the engine offers one action per legal pair, and the screen finds the
one matching what was selected. Selecting a third card is ignored rather than replacing an earlier
pick, and the confirm button counts down (*Choose 2 more* → *Choose 1 more* → *Keep these*).

### Ransack the Court — a base-game rule that was missing

Beloved was blocked on Ransack, and Ransack turned out to be missing from the **base game**, not
from the variant: it is what happens alongside outrage when you raze a city, and the engine only
did the outrage half.

The rulebook: *when you destroy a city you first Provoke Outrage*, then Ransack the Court — secure
a court card that has at least one of the **defender's** agents on it, and take every rival agent
on that card as **Trophies, not Captives**. Exactly one card, and a defender with no agents in
court gives up nothing. The designer clarification is explicit that "take any card" is singular and
that "at least one" agent is the requirement.

It reuses `performSecure` with an `asTrophies` flag, since taking the card is otherwise identical
to securing it — only where the agents end up differs. The action is handled in
`rules/standard-actions.ts` even though `rules/battle.ts` offers it, so the existing
standard-actions → battle import stays one-directional.

With that in place **Beloved works in full**:

- *"Rivals cannot Ransack the Court when they battle you"* — the offer is withheld against an
  Elder, and says so in the log.
- *"After defending in battle, you may influence if the attacker took any Trophies"* — a free
  influence handed to the **defender**, which is why it is a step of its own: every other decision
  in a battle belongs to the attacker. It runs after the ransack, so the Elder acts on the board as
  the battle left it. "Took any Trophies" means the attacker destroyed something *of the
  defender's* — its own losses go home to reserve and do not count, and there are tests for both.

**Paranoid's "Ignore this if you Ransack the Court" needed no wiring** — it holds by construction,
and that is worth stating rather than leaving as an accident. The restriction lives in `canSecure`,
which only the pip-action Secure offer consults; `offerRansack` builds its own list from the cards
the *defender* has agents on and never asks whether the attacker could secure them. So a Demagogue
that cannot secure a lightly-held Guild card may still ransack it.

An earlier note here said the clause was unwired. That was wrong, and the correction came from
testing rather than reading: a Demagogue holding one agent on a Guild card is offered nothing by
Secure and is offered that same card by Ransack. Adding a `canSecure` filter to the ransack path
makes the test fail, so the behaviour is pinned rather than incidental.

### Callow, and a misreading worth recording

Callow was written off earlier in this build as "dead code until rival-city taxing exists", on the
reasoning that Tax only ever offers your own cities so the restriction had nothing to bite on.
**That was wrong, and the error was reading "Loyal" as belonging to someone else.** In Arcs a
Loyal piece is *your own*. The card — "You can only tax Loyal cities if you control them" —
restricts by **ruling**, not by ownership.

HRF settles it: `loyal` is built as `systems./~(s => f.at(s).cities)` (game-common.scala:681),
your own cities everywhere with no ruling test, and Callow narrows it with `loyal.%>(f.rules)`.
So the base rule is that a Loyal city is taxable wherever it stands, and Callow is a genuine cost:
an Upstart outnumbered on a world it has a city on cannot collect from it. The engine never
checked ruling on Tax, so the trait bit immediately once implemented.

The filter sits in `taxableAt`, which both the ordinary Tax offer and the Gate Stations gate-city
offer go through, so a gate city is covered too.

*Taxing rival cities* is still missing — HRF gates it on `f.rules(s) || f.isLordIn(s.cluster)` —
but that is a base-game feature, not a Callow dependency.

### What is not done, and why

### The declare-time traits

Declaring is the only moment three traits hang off, and they split by *when*.

**Bold and Ambitious are consequences**, so they sit after the marker is taken, in
`leaders/after-declare`. That is a **loop** carrying a `used` list, not a single prompt — HRF's
`AmbitionDeclaredAction` (game-common.scala:1436) offers every eligible effect, each recursing
back with itself added to `used`. The base game's two carriers are different leaders, so nothing
today takes both; the loop is still the right shape, because it is what makes the menu composable
as more of these arrive, and it costs nothing to build that way now.

Bold itself is a second loop over the court: each card once (`influenced` remembers which), no pip
spent, stopping when the agents run out. Placement reuses the base `action/influence`, so an agent
is spent exactly as normal — only the pip is free. Backing out before placing anything is a
**cancel** and leaves the trait unspent; stopping after placing at least one is **done** and spends
it. That is HRF's `cancelIf(influenced.none)` / `doneIf(influenced.any)` pair, and it matters: a
player who opens the menu and changes their mind has not used their once-per-declaration ability.

**Generous is a cost**, so it is taken *before* the marker. The leaders module is prepended to the
chain, so it sees `ambition/declare` ahead of the base rules, offers the gift, and re-issues the
same action carrying `generous: 'paid'` — the flag is what stops the interception repeating, and
removing it in a mutation test hangs the declaration, which is why it is tested.

Paying first is what lets the whole thing be declined. **Forfeit declaring** is a real option
(HRF's `withExtras(then.as("Forfeit declaring", a))`) and it is the *only* one when you hold no
Guild cards — which is how the card's "must" is enforced, without the declare path needing a
failure mode of its own. The recipient is every rival tied for the least Power, so the giver
chooses among them.

The gift is a plain transfer between secured piles. It does not re-run any on-secure effect, since
no agents are captured and no court slot is refilled; that matches how secured cards are modelled
elsewhere.
### The second action on a pip

Tactical and Charismatic each attach a second action to a single pip. The earlier plan assumed
this needed a new concept in the pip loop. It does not, and that was the useful thing to find:
what they change is the action's **continuation**, and `then` already is exactly that. HRF says
the same thing by passing a `MayMove` / `MustSecure` step as the action's `then`
(game-common.scala:2041-2078). `performTurn` is untouched; only what a chosen action returns to
changes.

"Before or after" then falls out of offering **two menu entries** rather than prompting about
ordering mid-action:

| | after | before |
| --- | --- | --- |
| Tactical | Battle, then may Move | Move, then may Battle |
| Charismatic | Secure, then may Influence | Influence, then must Secure |

The "before" entry's follow-up is a **must**, because the pip was bought for the primary action —
Influence-then-Secure must not quietly become a free Influence. `Move, then must Battle` is
offered only when the suit does not already grant Move (HRF's `if (canMove.not)`); with both in
the suit the may-pair already covers that ordering. Battle counts even when a spent Weapon is what
granted it, which the Warrior's card calls out explicitly and which falls out of reading the same
`available` list the menu is built from.

**Whether the follow-up is possible is decided after the primary action resolves**, in
`offerFollow`. That is the whole point of the "before" orderings: moving into a contested system
is what makes a battle available, so testing beforehand would refuse the very case the card exists
for. A `must` that cannot be met is not a rules violation — you may move somewhere with nothing to
fight — so it logs and the turn carries on.

The action constructors live in `rules/turn.ts` and the handler in `rules/leaders.ts`, with the
type strings written out on both sides. `rules/leaders.ts` reaches `rules/turn.ts` through
`rules/setup.ts`, so importing it back would close a cycle — the same reason `ambition/declare`
builds `leaders/after-declare` inline.

### Tests

`packages/engine/test/leader-traits.test.ts`, 50 tests. Every trait is tested **against the same
situation without the leader**, which is the point: a trait that silently did nothing would pass a
one-sided assertion, and with the variant off a missing trait is indistinguishable from a base
game. Traits are injected onto `state.leaders` rather than drafted, since the deal is seeded and
driving it to hand a chosen leader to a chosen faction would test the shuffle instead.

Cryptic is the exception — it fires during seating, so it cannot be injected afterwards, and its
test sweeps seeds until red is actually offered the Mystic.

All fourteen were confirmed non-vacuous by breaking each implementation in turn and checking the
right tests fail: Committed 1, Disorganized 1, tax bonuses 2, Paranoid 1, Cryptic 1, Just 3,
Violent 1, Lavish 2, first-place demotion 3, second-place zeroing 1, Ambitious 2, Tactical 3,
Charismatic 2, the copy/pivot gate 2, each "before" entry 1-2, must-becomes-may 1, the
impossible-follow-up guard 1, Bold 4, influence-once 1, Bold's cancel-vs-done 1, Generous 4, the
poorest-rival filter 2, the transfer itself 1, and the `paid` re-entry guard 1.

## 6. Base-game lore effects

All fourteen base lore cards are implemented. `hasLore(state, faction, id)` in `lore.ts` is the counterpart of `hasTrait` and
works the same way: false for everyone with the variant off, typed structurally to avoid a cycle
back through `state.ts`. Lore is read from `state.lores`, not through `hasGuild`, because it is
held from the draft rather than secured from the court.

| # | Card | Effect | Status |
| ---: | --- | --- | --- |
| 04 | Mirror Plating | Defending, +1 Intercept against a roll containing assault dice | done |
| 05 | Hidden Harbors | Defending, denies raid dice while a defending starport is fresh | done (second clause) |
| 06 | Signal Breaker | Attacking from an all-fresh fleet, ignores 1 Intercept | done |
| 07 | Repair Drones | Repairs 1 attacking ship after battling | done |
| 01 | Tool Priests | Build a ship at any city you control, once per turn | done |
| 02 | Galactic Rifles | Ranged attack into an adjacent system | done |
| 03 | Sprinter Drives | Move fresh ships one more time | done |
| 08 | Gate Ports | Starports on gates; capture an agent on rival entry | done |
| 09 | Cloud Cities | Cities outside building slots, for a resource | done |
| 10 | Living Structures | Build: tax a city. Repair: swap city/starport | done |
| 11 | Gate Stations | Cities on gates, typed by their cluster | done |
| 12 | Railgun Arrays | Defending, the attacker takes 1 hit before collecting dice | done |
| 13 | Ancient Holdings | An extra resource slot on the card itself | done |
| 14 | Seeker Torpedoes | Reroll assault dice | done |

**Mirror Plating and Signal Breaker are one number.** HRF applies them as a pair of adjustments to
the same Intercept count (game-battle.scala:325-333) — one side adds, the other cancels — so they
are computed together and clamped at zero rather than short-circuiting on either. Held against
each other they cancel exactly, which is tested.

**Hidden Harbors' first clause is a genuine no-op**, not an omission: "you always build ships
fresh" has nothing to override, because this engine builds every ship fresh already. Recorded here
so it is not re-investigated later.

**Repair Drones is applied without asking.** HRF prompts, but its repair step is shared with cards
where the target matters; here the ships in a system are interchangeable, so which damaged ship is
repaired cannot change anything downstream.

### Two pieces of shared machinery

Three of the seven needed infrastructure rather than a predicate, and both pieces are now in
place.

**The lore-alt table.** `altsFor` was a single `GUILD_ALTS` list keyed on `hasGuild`. Lore is held
from the draft rather than secured, so it cannot use that lookup. `LORE_ALTS` is a second table of
the same shape with `source: 'lore'`, and the two are unioned at lookup — an action's menu shows
both without either table knowing about the other. Keeping them separate rather than merging into
one list is deliberate: only one of the two decks is part of the variant, and the split keeps that
visible. Living Structures is its first user, contributing Nurture to Build and Prune to Repair.

**`state.loreUsedThisTurn`.** A per-turn list of spent lore, cleared alongside `taxedThisTurn` and
`workedThisTurn` at end of turn. It mirrors HRF's split between `f.used` (effects) and `f.worked`
(the things they act on) — which is why Tool Priests does *not* use it: HRF gates that card on
`f.worked.cities.none`, so it rides on the existing `workedThisTurn` by passing the city as the
building that was worked. Same mechanism as a starport spending itself on a ship, no new state.

Saves store the action journal, not a state snapshot, so the new field is rebuilt by replay and
needs no save-version bump. There is a test asserting that.

**Nurture reuses the Tax offer** rather than restating which cities are taxable — it is a Tax
bought with a Build pip. **Prune** is a swap, not a build: the standing building returns to reserve
and its opposite comes out, so it needs one of the other kind in reserve to be possible.

**Sprinter Drives moves only the fresh ships** of the group that just moved, which the card is
explicit about, and it resolves *after* the catapult chain has finished — also stated on the card,
and the reason it is offered where the catapult loop declines to continue. Declining does not spend
the card.

**Railgun Arrays fires before the dice are collected**, and that ordering is the whole card. The
hit can destroy an attacking ship, and the dice pool is capped by the ships still standing when it
is gathered, so landing the hit afterwards would let the attacker roll for a ship the volley had
already killed. There is a test that measures exactly this: three attacking ships give a pool of
three, and two once the volley destroys one.

The attacker chooses which of their ships takes it, so it reuses the battle's own assignment flow
rather than picking a target itself — HRF splices in an `AssignHitsAction` for a single self-hit
ahead of `BattleStartAction` the same way (game-battle.scala:139). A `railgun` flag on the
resolution context marks it as the pre-battle volley: `performFinish` sees it and opens the dice
menu instead of closing a battle that has not been fought, so no raid, outrage or Repair Drones
run. Every route into the dice menu — a sole target and a chosen one — goes through `openBattle`,
so both are gated.

### Gates as build sites

Gates carry no building slots at all — `freeSlots` reads `buildingSlots ?? 0` — so nothing can be
placed on one by default. Gate Stations (lore11) opens gates to cities and Gate Ports (lore08) to
starports, through one shared path in `offerBuild`.

Two details are easy to get wrong and are both taken from HRF (game-common.scala:847-851):

- **"Max 1 per gate" means one of *yours*.** The gate is not consumed — `f.at(_).cities.none` and
  `f.at(_).starports.none` are per faction, so two factions may each hold a building on the same
  gate. A rival's building is no obstacle.
- **Presence is enough; ruling is not required.** HRF uses `present`, not `present.%(f.rules)`,
  unlike an ordinary slotted build. That is what makes these cards a way *into* a contested gate
  rather than a reward for already holding it.

**Gate Ports' toll is charged before the fleet lands.** "When Rival ships take a move into a gate
you control with a fresh Loyal starport, capture 1 agent of that Rival" does not say when "you
control" is judged, and it matters: a fleet big enough to take the gate would escape the toll if
the check ran after arrival, which is exactly the case the card exists for. HRF checks ahead of
`l --> d` (game-movement.scala:127) and that is the better reading, so it is what we do — the
agent comes from the mover's reserve into the holder's captives, and a mover with no agents simply
loses nothing. Every leg of a move charges it, catapult continuations and Sprinter Drives
included, since all three go through the same primitive.

**Gate Stations types a gate city by its cluster.** A gate carries no resource, so without the card
a city standing on one is untaxable and provokes no outrage. With it, `gateCityTypes` in
`control.ts` gives the city the resource of every *planet* in its cluster that currently holds a
city, and two places read it: the Tax offer, which lists one option per type, and the razing
outrage, which provokes all of them at once.

**The effect is global while the card is in play, not the holder's alone.** The card says
"*Players* may tax it" and "if it is destroyed" without naming an owner, so it changes how gate
cities work rather than granting their owner a privilege — a rival's gate city is taxable by its
own owner too. That reading comes from the card itself; the closest official note found says the
same of Cloud Cities, and applying it to Gate Stations is inference, so it is worth confirming.

`gateCityTypes` returns empty for a non-gate and empty when nobody holds the card, so callers ask
unconditionally and a base game is untouched.

> **Unresolved: what "max 1 per gate" limits.** The card does not say *per player*, and the plain
> reading is one building on that gate full stop. HRF reads it per faction
> (`f.at(_).starports.none`), which is what we follow. The distinction is normally invisible,
> because a lore card is unique and no rival can build on a gate at all — but it *is* reachable:
> Gate Stations builds a gate city and Living Structures' Prune converts it to a starport, so a
> faction without Gate Ports can come to hold one. Verified reachable in the engine. Worth a
> ruling before it matters.

### Cities outside the slots

Cloud Cities needed a concept the engine did not have: a building that stands on a planet without
occupying one of its slots. `state.unslotted` holds the ids of those cities, and `freeSlots`
skips them, so capacity is untouched. They are ordinary cities in every other respect — they rule,
they raze, they come off your player board.

The offer deliberately consults **neither `freeSlots` nor `rules`**. That is the card: it is the
one way to put a city on a planet whose slots are full, or one you do not rule. HRF gates it on
presence alone (game-common.scala:829). What it does require is a held resource matching the
planet's printed type, which is spent on building.

**"Max 1 per planet" counts cloud cities, not cities, and not per faction.** A planet with an
ordinary slotted city may still take one, and once one stands there nobody may add a second. That
follows the official ruling that a card's "max 1" counts only what that card placed — and here
HRF agrees, because it tracks the same `unslotted` set. Worth noting that HRF is *inconsistent*
about this: for Gate Ports it uses a per-faction test instead, which is the divergence recorded
above.

A cloud city that is razed or pruned drops out of `unslotted`, so the planet can take another and
no stale id can make a later city unslotted by accident. Both paths are covered.

### A resource slot that is not on the player board

Ancient Holdings needed a change to the resource model rather than a rule on top of it, and it is
the largest structural change the variant has required.

**The problem was that a capacity *number* cannot express it.** Every query — gaining, spending,
counting for an ambition, raiding — took `(faction, capacity)` and rebuilt the slot list as "city
slots 0 to capacity-1". A card slot is not the seventh city slot: a faction with two city slots
and the card has three slots in total, but must not be handed city slot index 2. No integer says
that.

So `openSlots`, `heldTokens`, `countResource` and `gain` now take the **resolved slot list**, and
`slotsOf(state, faction)` in `control.ts` is the single producer — city slots by capacity, plus the
card slot when the faction holds lore13. Because every consumer asks the same producer, the card
slot cannot be visible to scoring and invisible to spending.

Changing the signatures was deliberate: it made the compiler point at all 24 call sites rather
than leaving them silently reading a stale shape. That is the whole reason the change was safe —
the pre-existing suite passed unchanged afterwards.

**Raid cost is per slot.** `slotKeys(slot)` returns the six values printed on the player board, or
four for the card slot, so Ancient Holdings is the most expensive thing on the table to raid and a
raider spending keys cheapest-first empties the board slots before touching it. That behaviour is
tested directly.

### A strike that is not a battle

Galactic Rifles sits on the Battle slot through `LORE_ALTS`, but everything after that is its own
path: pick a system holding fresh Loyal ships, pick an adjacent system with an enemy in it, roll
one skirmish die per fresh ship capped at six (HRF's `min(f.at(s).ships.fresh.num, 6)`,
game-lore.scala:284), and deal a hit per hit rolled.

**The official ruling is that it is not a battle**, so defence-triggered abilities must not fire.
Most of that falls out of the shape rather than needing a guard: it never enters `offerGather` or
`performRoll`, so Mirror Plating, Signal Breaker, Hidden Harbors and Railgun Arrays are simply not
on the path. The one that *would* have leaked is Repair Drones, which hangs off `performFinish`;
a `rifles` flag on the resolution context stops it, and there is a test that fails without it.

What it does borrow is the hit assignment, which is what "hit ships before buildings" asks for —
hits land on ships and overflow to buildings exactly as a battle's do. Skirmish dice carry no
self, intercept or key faces, so the firer risks nothing and steals nothing.

### Why the last card is not done

They are not variations on a predicate — each needs an engine capability that does not exist yet:

- **Rerolls** (Seeker Torpedoes) — phase 4, below.

## 7. Audit against the printed text and official rulings

Done 2026-07-26, after it became clear the TTS mod cannot corroborate effects and HRF is one
person's reading. Each implemented card was re-read against its card art and checked for an
official clarification.

**Where authority now lives.** Arcs moved publisher: Cole Wehrle and Kyle Ferrin left Leder Games
and took Arcs and Oath to **Buried Giant Studios**. Leder-era material (the Leder card library,
the 2024 FAQ/errata PDFs) is still the best available text but is the previous publisher's.

### Confirmed correct

- **Just / Violent.** The card itself says "gain no Power for second place, and gain Power for
  second place if you get first place. *(Don't get bonus city Power.)*" — first takes `low` with no
  city bonus, second takes 0. That is a direct reading, not an inference from HRF.
- **Lavish.** The card says "if the Tycoon ambition **was scored**"; HRF tests
  `game.declared.contains(Tycoon)`. These are the same moment — declared ambitions are exactly the
  ones scored at a chapter end — so following HRF is right here.
- **Living Structures / Prune.** Ruling: a replacement must remove *and* place simultaneously, and
  if the replacement cannot be placed the existing building cannot be removed. Already the
  behaviour: the option is withheld unless the opposite piece is in reserve.
- **Copy/Pivot modifiers reach "new actions".** The FAQ states that a new action containing a
  standard action triggers that action's Copy/Pivot modifiers (its example: Nurture contains
  Build). Tactical and Charismatic pair on the *slot*, and alt actions live in that slot's menu
  with the same continuation, so they inherit the follow-up by construction. Now tested rather
  than assumed. The same reasoning covers Insatiable/Attuned firing on a Nurture tax, since the
  bonus is gated at the moment of taxing rather than on which pip bought it.

### Corrected by this audit

- **Sprinter Drives — each ship may reach its own destination.** It was implemented as one group
  move to one system. The errata is explicit that ships fan out, so it is now a loop: after each
  leg the remaining fresh ships are offered again from the same system, and the card is spent only
  when the player stops. Stopping without moving anything does not spend it.
- **Sprinter Drives — the errata also rewrites the trigger** to "when you move fresh Loyal ships,
  **except using Sprinter Drives**", closing a sprint triggering another sprint. Nothing re-offers
  on the sprint's own arrival, so that was already the behaviour — but it is now the *stated*
  reason, rather than resting on HRF's per-turn `used` flag.

### Mass Uprising (bc26) — corrected against HRF

The card: *"Choose a cluster on the map. **You place 1 ship in each system of that cluster.**
Discard this card."*

HRF enumerates every combination of systems in the cluster, as though four ships were a budget to
spend wherever you liked, and this engine copied that reading. Two things wrong with it:

- **It allows stacking.** Two ships into one system and none into another is a legal outcome of a
  budget and an illegal outcome of "1 ship in each system".
- **It asks a question the card never asks.** With a full reserve there is no decision at all — the
  cluster is simply filled.

Now: one ship per system, every system, no prompt. The single genuine decision is when the reserve
cannot fill the cluster, which the card does not cover — there the player picks which systems get
one, still capped at one each.

**Found by a player, not a test.** The prompt had just been moved onto the map, and seeing the
cluster light up made "why am I choosing systems?" obvious in a way the old button list never did.
That is the second card where HRF's reading diverged from the printed text — Force Beams was the
first — and it is the argument for docs/18's saves: some bugs are only visible in a running game.

### Known divergence, not yet implemented

- **"Max 1 per gate" counts only buildings placed *by that card*.** The ruling says the limit does
  not apply to buildings that arrived through other effects. We follow HRF's per-faction test
  (`f.at(_).starports.none`), which is stricter: a faction that got a gate starport by another route
  — Gate Stations builds a gate city, Living Structures' Prune converts it — is wrongly blocked
  from also building one with Gate Ports. Implementing the ruling needs per-building provenance,
  which is a real state change for an exotic case. Recorded rather than done.

### Notes for cards not yet built

- **Galactic Rifles is not a battle.** It mimics one, so defence-triggered abilities — Mirror
  Plating, Railgun Arrays, Hidden Harbors — must *not* fire. Worth having before it is written.
- **Gate Stations' cluster typing applies to every gate city**, not only the holder's, for as long
  as the card is in play.
- **Seeker Torpedoes:** each reroll ability triggers separately, but all rerolls from one ability
  happen at once. Relevant to the phase 4 design.

**Phase 4 — rerolls. Done.**

A reroll needed two things the dice module did not have, and both are now there:

- `tallyOf(rolls)` — what a set of already-rolled dice adds up to. It was previously computed only
  inside `rollPoolDetailed` as the dice fell, so nothing could re-read a pool whose faces had
  changed underneath it. `rollPoolDetailed` now defers to it, so there is one definition of what a
  face means.
- `rerollAt(rng, rolls, indices)` — re-roll the chosen dice and keep the rest exactly as they fell.

The battle roll is split accordingly: `performRoll` rolls, `offerReroll` is the hop where dice may
change, and `resolveRoll` reads whatever they finally say and hands off to assignment. Everything
that reads a face — including the Mirror Plating and Signal Breaker adjustments — happens once, in
`resolveRoll`, on the final dice.

**Seeker Torpedoes (lore14)** is the only base-game user: attacking, after rolling, reroll up to
one assault die per fresh Loyal attacking ship. The choice is a **set**, taken at once, which the
official ruling requires — rerolls from a single ability happen simultaneously, not one die at a
time with a look between. Options are de-duplicated by the faces they discard, since two assault
dice showing the same face are the same choice.

The reroll is a journalled action, so undo and replay work on it like any other decision, and the
result is a pure function of the seed and the chosen set.

`state.lastRoll` was tightened from `{ die: string }` to `DieRoll` while doing this; it had been
losing the die type, which the reroll needs.

**Phase 5 — expansion trait effects (leaders 10-16). All sixteen done.**

Leader 09 (Archivist) landed with phase 3. The remaining seven leaders carry sixteen traits
between them, transcribed from the card art in `assets/images/leader`:

| Trait | Leader | Effect | Where |
| --- | --- | --- | --- |
| Ruthless | Overseer | Once/turn, hit a building to tax or build with it again | `rules/standard-actions.ts` |
| Hated | Overseer | Setup: scrap 2 ships and 3 agents | `rules/leaders.ts` |
| Tricky | Corsair | Reroll raid dice up to your *different* resource types | `rules/battle.ts` |
| Wary | Corsair | Attacking, no more assault dice than skirmish dice | `rules/battle.ts` |
| Connected | Noble | Declaring a fresh ambition draws and secures a court card | `rules/ambitions.ts` |
| Influential | Noble | A Copy/Pivot into Influence influences twice | `rules/standard-actions.ts` |
| Proud | Noble | Power only for an outright first place, never a tie | `rules/ambitions.ts` |
| Decentralized | Anarchist | Setup: scrap 2 cities, uncovering two resource slots | `rules/leaders.ts` |
| Inspiring | Anarchist | Tax Rival cities and empty slots where you have ships | `rules/standard-actions.ts` |
| Principled | Anarchist | Cannot tax your own cities | `rules/standard-actions.ts` |
| Mythic | Shaper | After taxing, place a resource to change a planet's type | `rules/standard-actions.ts` |
| Ancient | Shaper | Catapult from gates instead of from starports | `rules/standard-actions.ts` |
| Firebrand | Agitator | +1 Weapon when a Copy/Pivot taxes | `rules/standard-actions.ts` |
| Irregular | Agitator | Intercept strikes with Weapon icons, not fresh ships | `rules/battle.ts` |
| Resilient | Quartermaster | Repair 1 ship per starport you control, after any battle | `rules/battle.ts` |
| Greedy | Quartermaster | Setup: starts outraged on Material | `rules/leaders.ts` |

Most slotted into hooks phase 3 had already cut. Firebrand joined `taxBonusResources` beside
Insatiable and Attuned; Tricky joined `rerollSources` beside Skirmishers and Seeker Torpedoes;
Resilient sits beside Repair Drones in `performSettle`; the three setup traits joined Cryptic in
`applySetupTraits`. Two needed more.

**Mythic made planet type mutable**, which it had never been. `state.planetTypes` overrides the
board's printed icon, and every rule that asks what a planet produces now goes through
`planetResource(state, s)` rather than reading `system(id).resource` — taxing, the guild cards
that count planet types, and the outrage a razed city provokes. Setup's initial seeding is the
one deliberate exception, since it runs before any leader could have acted. The override map
doubles as the record of which planets have already been reshaped, so "cannot be changed again
with *Mythic*" needs no second field.

**Ruthless reaches into two actions at once.** It hangs off both `performTaxCity` and
`performBuild`, and the card's phrasing settles a question the engine already had an answer for:
"you may **hit** the building… **if** you destroy a Loyal city" only parses if a hit does not
always destroy, which is exactly this engine's two-stage damage model. A destroyed building goes
home to its owner's reserve rather than to the Overseer's trophies — the card grants no trophy,
and taking one would quietly feed Tyrant scoring off an action that never mentions it.

Two readings worth recording, since both change what the trait is worth:

- **Inspiring's "empty building slots"** have no figure to track a once-per-turn limit by, so they
  are offered as synthetic `emptyslot:<system>:<n>` ids that exist for `taxedThisTurn` and nothing
  else. They capture no agent, because nobody owns an empty slot.
- **Proud** costs the Noble on ties *and* on second place. A tie is explicitly "not first", and
  ties are the common outcome, which is what pays for Connected and Influential.

Tests are in `packages/engine/test/leader-traits-expansion.test.ts`, following phase 3's
discipline: every trait paired with the same situation without the leader, and each one
mutation-tested. The four setup traits are drafted for real by sweeping seeds, because they fire
during seating and there is no "after the fact" to inject at.

One line is deliberately guarded but unreachable in a dealt game: Mythic refuses to fire off
Inspiring's empty slots, which cannot co-occur since a faction has one leader. Its test dispatches
the tax directly and says so.

## 8. Expansion lore effects (15–28)

All fourteen are now implemented. Of the two fan-made cards outside that range, Guild Loyalty
(lore29) is implemented in `outrage.ts`; **Catapult Overdrive (lore30) is deliberately skipped** —
fan-made, in neither box, and out of scope. They arrived in two batches, and the split is not the one the
backlog predicted.

### The ambition-paired ten (19–28)

One batch, because they share one gate. Every card prints **"While *&lt;Ambition&gt;* is
declared"**, so the condition is a single helper — `loreActive(state, faction, loreId)` — that is
true when the faction holds the card *and* that ambition sits in `state.declared`. Who declared it
does not matter; the card says "is declared", not "you declared".

Five of them also print "**Prelude:** You may discard this to clear your *&lt;resource&gt;*
Outrage". That half is deliberately **not** gated: the card prints only "Prelude" there, with no
ambition clause, so the discard works whether or not the ambition is out. `LORE_CLEARS_OUTRAGE`
holds the resource each one clears, and the Prelude offers it only when there is outrage to clear.

**Tycoon's Ambition's "Do not place the zero marker" is about the played card, not the ambition
marker.** Declaring normally zeroes the card you led for surpass purposes — `performDeclare` sets
`lead.zeroed` — and the card skips exactly that step while still taking a marker like any other
declaration. So it calls `takeAmbitionMarker` and does not zero. `performBardsDeclare` (Galactic
Bards) already had the same shape, which is corroboration rather than coincidence: both are free
declarations that leave the lead card at its printed strength.

### The remaining four (15–18)

**These are not a group.** The backlog had them down as "the battle-dice cards, to do together in
`rules/battle.ts`". Reading the card art, only one of them is:

| # | Name | Where it lives |
| ---: | --- | --- |
| 15 | Predictive Sensors | `rules/battle.ts` — a defender's interrupt before dice collection |
| 16 | Force Beams | `guild-actions.ts` + `rules/standard-actions.ts` — a Move alt |
| 17 | Raider Exosuits | `rules/battle.ts` — one line in the dice gather |
| 18 | Survival Overrides | `guild-actions.ts` + `rules/standard-actions.ts` — a Move alt |

**Raider Exosuits opens exactly one case.** The base rule allows raid dice only against defending
buildings; the card allows one die when there are *none*. The "buildings present" case keeps its
six. Its parenthetical — "This is not an extra die. Follow the limit of 1 die per ship" — needs no
code, because the pool enumeration already bounds every combination by the attacking fleet, so a
raid die taken here displaces a skirmish or assault die rather than adding to the count. Hidden
Harbors cannot collide with it: that card needs a fresh defending *starport*, which is a building,
so the two conditions are mutually exclusive by construction.

**Predictive Sensors is asked of the defender, and asked first.** "Before the attacker collects
dice" is the whole window, so it runs ahead of Railgun Arrays too — reinforcements pulled in should
be standing there for the volley as well as for the dice. `belovedThen` was the precedent for
handing an ask to someone who is not taking the turn. `openBattle` is split in two for it:
`openBattle` offers the window, `openBattleArmed` is everything from Railgun onwards, and the
resume path re-enters the second. Re-entering the first would re-offer the window on every decline,
forever.

It is not a move, so nothing that triggers on moving fires — no catapult, no Sprinter Drives, no
Gate Ports toll. And like the other defence-triggered cards it stays off the Galactic Rifles path
for free, because a rifles strike never enters `openBattle`.

**Force Beams moves ships that are not yours.** "Move any number of *any* ships (*even if not
Loyal*)" is keyed on the starport, not on the fleet: a rival's ships next to your fresh Loyal
starport can be pushed away or dragged in. `guideLanes` enumerates lanes from the starport and runs
each both ways, which is the card's "or vice versa".

**"Ignoring move modifiers in play areas" — resolved by the publisher's FAQ.** This was recorded
here as a divergence to check; `cards.buriedgiant.com/card/ARCS-L16` rules on it directly, and the
implementation was right for one wrong reason:

> Q: Does this trigger Gate Ports? **A: No, since this ignores move modifiers.**
>
> Q: Can you use Force Beams to do a Catapult Move? **A: No, Force Beams is strictly to an adjacent
> system. It cannot start a Catapult move.**

The two are off for **different reasons**. The Gate Ports toll is a move modifier — so the clause
does reach a trigger on a lore card, not only an arithmetic cap. The catapult is off because Guide
is *strictly one leg to an adjacent system*, which is a reach limit rather than a modifier. Both
end up suppressed, which is what this engine already did, but the distinction is load-bearing: a
future card granting extra reach would be stopped by "strictly adjacent", not by the modifier
clause.

**Disorganized (Rebel) is the modifier the clause is really for.** The leader card sits in a play
area and caps a Move at two ships; lifting that cap is the card's best-known use in play. This
engine gets it right only because Guide does not call `movableCount`, so it is now asserted by a
test rather than left to the next person to edit that function.

**One Guide carries a mixed group — and this engine had it wrong.** "Move any number of *any*
ships" is not "any number of ships of one colour". The first implementation asked for a colour and
a count and then ended the action, so pulling some of your ships and some of a rival's into the
same system — the card's headline use — would have cost two Move pips instead of one. It is a loop
along a fixed lane now: pick a colour and a count, get asked again, stop when you say so. The lane
itself is chosen once, because "or vice versa" is a choice of direction and not something to
re-decide per ship.

**Errata:** "in play areas" was added to this card in the second printing. The art in
`assets/images/lore/lore16.webp` carries the phrase, so this engine implements the second-printing
text.

The FAQ's third question is about Passages and the Twisted Passage — campaign content, out of scope
by docs/04, and not implemented.

**Survival Overrides asymmetrically disposes of two ships.** The martyr goes back to your reserve
and the victim goes to your trophy pile — which is the card's "(*Your Loyal ship does not become a
Trophy.*)" and matches how a battle already settles: your own losses go home, an enemy's become
trophies. "Destroy" is unconditional on both sides, so a damaged victim is destroyed outright
rather than repaired-then-hit, and a fresh one does not merely become damaged. It is not a battle
hit. The victim must stand in the **martyr's own system** — "1 ship that is not Loyal *in its
system*".

### Tests

`test/lore-ambition.test.ts` (39) and `test/lore-expansion-15-18.test.ts` (24). Both were
mutation-tested card by card — 31 mutations, every one caught by the test that names the behavior.

Two test bugs found that way and worth not repeating:

- **A default parameter fires on an explicit `undefined`.** A `staged(lore = 'lore15')` helper
  called as `staged(undefined)` to mean "without the card" quietly passed *with* it, so three
  "only with the card" assertions were testing nothing. Helpers take an explicit boolean now.
- **The starting board satisfies these cards by accident.** Cards keyed on "a system with a fresh
  Loyal starport" or "a ship that is not Loyal" are met by the setup pieces scattered across the
  map, so clearing only the system under test leaves a negative assertion passing for the wrong
  reason. The 15–18 tests sweep the whole board first and place only what they name.
