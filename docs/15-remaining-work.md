# Arcs Digital — Remaining Work

The single backlog. Per-doc status sections (docs/14 phases, docs/13's card table) stay where they
are; this is the list of what is *not* done, why it matters, and what it costs.

Ordered by "would a player notice, and would they be right to complain".

---

## 1. Rearranging resources when they land — **done**

Both clauses of *"when you take or are given a resource you may rearrange any resources in your
resource slots, but you must discard resources you cannot hold"* are now implemented, as one step
(`offerArrange` in `rules/standard-actions.ts`) behind one screen (`SlotBoard`). See docs/07
§ Overflow and docs/10 § Decisions get screens.

Kept here because two findings from it are worth not losing:

- **The slots are not interchangeable**, and the old code's justification for skipping the
  rearrange said they were. `CITY_SLOT_KEYS` is `[3, 1, 1, 2, 1, 3]` and `offerRaid` enumerates one
  option **per occupied slot at that slot's price** — so where a token sits decides how cheaply a
  rival can steal it, and arrival order was making that decision for the player.
- **1a. Capacity can shrink**, which docs/07 used to deny. Ruthless (leader10) sends a destroyed
  building home to its owner's reserve, raising cities-in-reserve and lowering `slotCapacity`. A
  token in a now-unusable slot is stranded — invisible to `slotsOf`, so uncountable, unspendable
  and unraidable. `strandedTokens` makes the row illegal until it is settled.

Still open, and deliberately not built:

- **Rearranging outside a gain.** The forced case runs itself; the optional case is a door in the
  **Prelude** menu (`turn/prelude-arrange`), which returns you to the Prelude having spent nothing.
  Offering it after every gain instead was tried and reverted: it puts a modal between every tax
  and everything downstream, and reorders every trait that hangs off taxing. Truly free-form
  rearranging — at any moment on your own turn — needs a `Continue` variant meaning "state changed,
  keep waiting", which is a wider change than it is worth today.
- **Trophy return at cleanup — done** (section 4). It was also the other way capacity shrinks, and
  needed no new machinery: the next gain settles the row.

## 2. Screens

The house rule is already written down in docs/10: *decisions get screens, not buttons*. Five
surfaces exist; the rest of the game's decisions are still rendered as a list of labelled buttons
in `ActionPanel`, including several where the label cannot carry the decision at all.

**The decisions do not need one screen each.** They fall into six shapes, four of which are
already built and generalise:

| # | Surface | Status | Shape |
| --- | --- | --- | --- |
| S1 | `CardShelf` | generalise from `RaidModal` | pick a card, with its text readable |
| ~~S2~~ | `PreludeScreen` | **done** for the Prelude | pick a resource token |
| S3 | Map targeting | extend existing click-the-map | pick a system or a piece |
| ~~S4~~ | `DiceTray` | **done** | pick which dice to reroll |
| ~~S5~~ | `SlotBoard` | **done** | arrange tokens across your slots |
| S6 | Confirm strip | new, small | a genuine yes/no |

### S1 — `CardShelf`: every court-card decision

`RaidModal` already is this screen: a shelf of cards at readable size, a magnifier opening
`CardZoom`, and a price or cost badge. Generalising it costs little and retires the largest group
of button-list decisions in the game.

| Decision | Action | Notes |
| --- | --- | --- |
| Influence | `action/influence` | the most-used court decision in the game |
| Influential's second influence | `action/influence` + `again` | leader12 |
| Secure | `action/secure` | needs the agent counts on each card |
| Ransack after a razed city | `action/ransack` | battle's and Ruthless's, same action |
| Bold — influence any number, once each | `leaders/bold` | **multi-select** variant |
| Generous — give a Guild card away | `leaders/generous-give` | picks from *your* secured pile |
| Beloved — influence after defending | `leaders/beloved` | |
| Galactic Bards | `turn/bards-declare` | |
| Populist Demands — declare | vox | ambition markers, not cards — may want its own |

Securing and influencing both need **agents-on-card** rendered, which `CourtPanel` already draws;
the shelf should reuse that rather than inventing a second representation.

### S2 — token decisions: **the Prelude is done**

`PreludeScreen` is the pattern — a tile per resource type, what it buys as chips beside it — and it
is a **tray across the bottom of the map**, not a modal, because the Prelude is decided while
looking at the board. See docs/10.

What is left of this shape, and still in the button list:

| Decision | Action | Notes |
| --- | --- | --- |
| Outrage Spreads — choose a resource | vox | |
| Mythic — which held resource reshapes the planet | `leaders/mythic-place` | leader14 |
| Elder Broker, trade swaps | guild alts | gains that overflow |

All three are one-off picks rather than a phase, so they want the *tile* from `PreludeScreen`
lifted into a small shared picker — not another tray.

### S3 — Map targeting

Move and Battle already resolve by clicking the map (docs/10 §"Moving by clicking the map",
§"Battling on the map"). The rest of the spatial decisions do not, and should:

- Battle: choose a system, choose a target
- Galactic Rifles: "from where?" then "at whom?"
- Song of Freedom: free a city
- Mass Uprising: choose a cluster — wants cluster highlighting, which nothing draws yet
- Catapult continuation, Sprinter Drives, "how many ships?"

### ~~S4~~ — `DiceTray`: rerolls — **built**

Four abilities reroll — Skirmishers (bc13), Seeker Torpedoes (lore14), Tricky (leader11) and
Empath's Vision (lore19). All four were offered as text in the action panel while the battle
window drew *nothing*: a reroll ask carries no `battle/hit` or `battle/finish`, so `ctx` was
undefined and every branch of `Battle.tsx` fell through. You picked "Reroll 2 dice (3, 5)" from a
list with the dice themselves nowhere on screen, and never saw what came back.

`RerollTray` draws the rolled dice and lets them be clicked, with dice the source may not touch
shown locked rather than hidden — Seeker Torpedoes rerolls assault dice only, and the greyed
skirmish dice beside them are what makes that legible.

One thing worth knowing before touching it: **the engine enumerates reroll options by the faces
they take, not by which physical die.** `offerReroll` dedupes on the sorted face list, so the tray
maps a selection to an action by matching faces. Clicking either of two 4s reaches the same
action, which is correct rather than a shortcut. The eligible set and the limit are both read off
the offered options rather than re-derived from the card, so the tray cannot disagree with the
engine about what is allowed.

### ~~S5~~ — `SlotBoard`: rearranging — **built**

Your slots as the row, key plate above each, tokens dragged between wells; swap on a full slot,
eject when an *arriving* token lands on one. Forced when the row is illegal, optional from the
Prelude. Pointer-based so it works under touch, with click-to-lift as the accessible path.

It drew six city slots and no card slot until Ancient Holdings' seventh was added — the row is
built from `CITY_SLOT_KEYS` for the board's own slots and from `slotsOf` for anything a card grants.
See section 5.

### S6 — Confirm strip: two-option trait prompts

Not everything deserves a screen. These are genuine yes/no and only need to stop reading as
*actions*:

Ruthless squeeze, Ambitious gain, Tactical / Charismatic ordering, catapult continue, Sprinter
Drives, "ransack nothing", the Mythic decline.

A slim prompt strip above the action panel — question, two buttons — is enough, and it keeps the
panel meaning "the ordinary things you may do on your turn".

### Sequencing

1. ~~S5 + the section 1 engine work.~~ **Done.**
2. ~~S2 for the Prelude.~~ **Done** — and it carries the arrange door, so the two landed together.
3. ~~S4 — the reroll tray.~~ **Done.**
4. **S1.** Largest group, and `RaidModal` has already proven the pattern.
5. **S3**, then **S6**, plus the small token picker S2 left behind.

---

## 3. Content still missing

- **Expansion lore 19-28** — **done.** The ten ambition-paired cards, all gated on `loreActive`
  (the card *and* its ambition declared, by anyone). Tests in `test/lore-ambition.test.ts`.
- **Expansion lore 15-18** — **done.** Not the single group this list assumed: only Raider
  Exosuits touches the dice. Predictive Sensors is a defender's interrupt before dice collection,
  and Force Beams and Survival Overrides are Move alts in `guild-actions.ts`. Tests in
  `test/lore-expansion-15-18.test.ts`.
- Base lore 01-14 are done.
- **The two fan-made cards are out of scope, and no longer reachable.** lore30 (Catapult Overdrive)
  was never implemented; lore29 (Guild Loyalty) *is* implemented, in `outrage.ts`. The New Game
  screen's "Fan-made lore" checkbox has been removed rather than labelled, because a box that can
  deal a card doing nothing is worse than no box.

  **This retires lore29 along with lore30** — it works, but it is a card printed in neither box and
  there is no way to ask for one without the other. Its implementation and tests stay in place.

  The engine keeps `unofficialLore` and the `unofficial` set on both cards, so a save written while
  the box existed still replays exactly. Nothing sets the flag now. Reinstating the option means
  implementing lore30 and putting the checkbox back.
- Leaders 01-16: **complete** (docs/14 phases 3 and 5).

## 3a. Testing card interactions

Every lore bug that reached the screen was an interaction the unit tests could not see — a valid
Ask no UI would draw, or a decision shown without the thing it was about. `saves/lore/` now holds a
game per interaction, parked on the decision and **named after the cards it exercises**, with
`npm run saves:build` to regenerate and `saves/lore/README.md` as the index — whose coverage table
lists every implemented lore card against its saves. **28 of 28 implemented lore cards now have a
save, across 25 scenarios.** **docs/18** has the approach, the two traps found building it, and the
one invariant still worth adding.

## 4. Systems not started

- **AI — built.** docs/03 is no longer a plan waiting on code: `packages/engine/src/ai/` holds the
  evaluator, the bots and the measurement arena, and the web app plays `declareBot`. docs/19 is the
  implementation record, including a register of measured dead ends so they are not retried.

  What is genuinely left here is narrower than "AI": the token-pricing feature in `ai/value.ts`
  counts resource *tokens* only and ignores Guild-card icons, while `courtSecured` counts the cards
  separately. The `standing` feature already goes through `metric` and so does see them. Aligning
  the token term is bot tuning that needs an arena run to justify, not a correctness fix.
- **Multiplayer.** Options brainstormed in docs/17 — the journal design makes it small (a server
  that appends strings to a list), but note the hidden-information catch: every client can
  currently derive all hands and all future rolls from `options.seed`.
- **2-player.** Deferred; HRF excludes it entirely, so the rules need sourcing elsewhere.
- **Campaign / Blighted Reach.** Out of scope by docs/04.
- **Trophy return at cleanup — done.** Rulebook 6.2.2 step 1: scoring Warlord returns all trophies,
  scoring Tyrant all captives, for *every* faction and not just the scorer. Omitting it let both
  piles accumulate all game, so a lead in either was permanent. See docs/08 § Chapter-end cleanup.
  Resources are **not** part of that step and are never returned at chapter end — the only resource
  discards remain capacity and outrage.

## 4a. The catapult stopping rule — fixed

**Reported from play: ships catapulted through a gate holding two fresh enemy ships.** The FAQ:
a catapult must stop at "any planet (regardless of control)" and at "a gate controlled by a Rival
**(counted just before your ships move in)**".

That parenthetical was the whole bug. `performMoveMoreGo` tested control on the board *after* the
ships landed, so the arriving ships counted toward ruling — move three into a gate a rival holds
with two and you rule it, so nothing appears to be blocking and the chain runs on. It now reads the
pre-move board, which is also what `canCatapult` uses for the opening leg, so both ends of the chain
agree about when control is counted.

Tests in `test/control.test.ts`; mutation-verified against the original off-by-one-state.

Two things worth not re-investigating:

- **Passing a gate with only damaged enemy ships is correct.** `ruleValue` counts fresh ships, so a
  damaged ship rules nothing. There is a test pinning this so a later fix cannot overshoot into
  "any enemy ship stops you".
- **`offerMoveMore` offering every adjacent system is correct.** You may *move* onward to a planet;
  you simply stop on arrival. The stopping is enforced where the move resolves, not by hiding the
  option.

**Checked, and correct — this item is closed.** `ruleValue` counting **ships only** was flagged here
as an assumption worth verifying, because it decides Build, Tax, Annex and ambition scoring. The
rulebook (4.6.3 Control): *"You control a system and its contents if you have more fresh ships there
than each Rival (other player). On a tie, no one controls the system."* Ships only, fresh only — and
`rules()` requiring a strict majority is the tie clause. Buildings are correctly ignored.

## 5. Smaller known items

- **Ancient Holdings' resource slot — fixed.** Kept here because the shape of the bug is worth
  remembering: the engine had the slot all along (`control.ts` adds a `cardslot:<faction>:lore13`,
  `slotKeys` prices it at four keys, `slotsOf` returns it) and the UI never drew it, because
  `slotRow` iterated `CITY_SLOT_KEYS` — six entries, no concept of a seventh. A token there could
  not be seen, dragged or spent, and capacity read one low. Nothing failed; the row just looked
  ordinary.

  `slotRow` now appends whatever `slotsOf` reports outside the board, priced by `slotKeys`. The card
  slot is appended rather than folded in, because the two halves mean different things: the city
  slots include the ones still **covered by unbuilt cities**, which is the physical idea the row
  exists to show and precisely what `slotsOf` omits. The card slot is never covered.

  `apps/web/test/slots.test.ts` locks in the invariant — every usable slot the engine reports has a
  well drawn for it, and nothing extra — stated against `slotsOf` rather than a count, so a future
  card granting a slot is covered without touching the test. Mutation-verified: restoring the old
  row fails four of its five cases.
- **Two ambition-procedure deviations, both known and both left alone.** Found while verifying the
  chapter-end rules, neither reported from play:
  - **Marker flip.** The rulebook returns all markers to the available spaces and flips the lowest
    unflipped marker to its higher face each chapter (6.2.2 steps 2-3). We model the escalation as
    HRF's sliding window in `chapterAmbitionable` — similar curve, different mechanism.
  - **Win tie-break.** 6.2.3 gives a tie to "the tied player earliest in turn order";
    `performCheckWin` reduces over `state.factions`, which is seating order, not `initiativeOrder`.
- **Gate Ports "max 1 per gate"** — provenance divergence recorded in docs/14 and unresolved:
  Cloud Cities counts card-placed cities, Gate Ports uses a per-faction count.
- **`multiAsk` is a placeholder** — summits will need a real simultaneous-decision UI.
- **Piece badges overlap** in busy systems.
- **`assets/images/arcs-bg.png`** (2.8 MB) is unused. The deploy strips it, so it costs the live
  site nothing; it is still copied by a local `npm run build`.
- **FM Bolyar Pro font licensing — resolved.** Settled by the project owner; the fonts ship as they
  are. Recorded here as closed so it is not raised again.
- **The build ships 56 MB it does not need — solved for the deploy only.** `npm run -w apps/web
  build` still copies the whole art library into `dist/` (~75 MB), including the fate/campaign art
  the base game never loads. The Pages workflow trims it to roughly 17 MB in a step after the build,
  deliberately kept there so a local build still produces the complete asset set — docs/16 section 3.
  Nothing further is needed unless the local build's size starts to hurt.
