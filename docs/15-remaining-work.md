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
- **Trophy return at cleanup** (section 4) is the other way capacity will shrink. It needs no new
  machinery; the next gain settles the row.

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
| S4 | `DiceTray` | extend `Dice3D` | pick which dice to reroll |
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

### S4 — `DiceTray`: rerolls

Three abilities reroll — Skirmishers (bc13), Seeker Torpedoes (lore14), Tricky (leader11) — and
all three are offered as text: `Reroll 2 raid dice (2 keys, building)`. The dice are *right
there*, drawn by `Dice3D` with the real face art. The reroll should be picking dice off the tray,
with the rest greyed, since the choice is a **set** taken at once.

### ~~S5~~ — `SlotBoard`: rearranging — **built**

Your slots as the row, key plate above each, tokens dragged between wells; swap on a full slot,
eject when an *arriving* token lands on one. Forced when the row is illegal, optional from the
Prelude. Pointer-based so it works under touch, with click-to-lift as the accessible path.

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
3. **S1.** Largest group, and `RaidModal` has already proven the pattern.
4. **S4**, then **S3**, then **S6**, plus the small token picker S2 left behind.

---

## 3. Content still missing

- **Expansion lore 19-28** — **done.** The ten ambition-paired cards, all gated on `loreActive`
  (the card *and* its ambition declared, by anyone). Tests in `test/lore-ambition.test.ts`.
- **Expansion lore 15-18** — **done.** Not the single group this list assumed: only Raider
  Exosuits touches the dice. Predictive Sensors is a defender's interrupt before dice collection,
  and Force Beams and Survival Overrides are Move alts in `guild-actions.ts`. Tests in
  `test/lore-expansion-15-18.test.ts`.
- Base lore 01-14 are done.
- **lore30** (Catapult Overdrive) — data only, and **deliberately not being implemented.** It is
  fan-made, printed in neither box, and out of scope for finishing the local game.

  Its sibling **lore29** (Guild Loyalty) *is* implemented — it keeps your secured guilds through an
  outrage, in `outrage.ts`. So the fan-made pair is one card done and one skipped, not two open.

  Both are opt-in separately from the expansion (`unofficialLore`, off by default), so nothing
  deals lore30 unless it is asked for. **But the New Game checkbox does not say that one of the two
  does nothing** — ticking "Fan-made lore" can deal a card with no effect and no indication. Either
  label it or drop lore30 from the pool before anyone plays with the box ticked.
- Leaders 01-16: **complete** (docs/14 phases 3 and 5).

## 4. Systems not started

- **AI.** docs/03 is a locked plan; no code exists.
- **Multiplayer.** Options brainstormed in docs/17 — the journal design makes it small (a server
  that appends strings to a list), but note the hidden-information catch: every client can
  currently derive all hands and all future rolls from `options.seed`.
- **2-player.** Deferred; HRF excludes it entirely, so the rules need sourcing elsewhere.
- **Campaign / Blighted Reach.** Out of scope by docs/04.
- **Trophy return at cleanup** — the other way capacity shrinks; see section 1. The row-settling
  machinery is already there, so this is about returning the pieces, not about resources.

## 5. Smaller known items

- **Gate Ports "max 1 per gate"** — provenance divergence recorded in docs/14 and unresolved:
  Cloud Cities counts card-placed cities, Gate Ports uses a per-faction count.
- **`multiAsk` is a placeholder** — summits will need a real simultaneous-decision UI.
- **Piece badges overlap** in busy systems.
- **`assets/images/arcs-bg.png`** (2.8 MB) is unused in the served directory.
- **FM Bolyar Pro** fonts are commercial — a type foundry, a different rightsholder from the
  game's art — and desktop licences often exclude webfont serving. Worth a licence check before a
  public build; see docs/16 section 5.
- **The build ships 56 MB it does not need.** `npm run -w apps/web build` copies the whole art
  library into `dist/` (73 MB), including 48.6 MB of fate/campaign art the base game never loads
  and a dead 2.8 MB `arcs-bg.png`. A trimmed deploy build is ~17 MB — docs/16 section 3.
