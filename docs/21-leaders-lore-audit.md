# 21. The Leaders & Lore audit — every trait and lore card against text, rulings and HRF

The docs/20 court audit's method, applied to the other card set: **16 leaders (34 traits) and the
28 official lore cards**, every clause validated against the printed card, the official FAQ, the
Rules Library, and HRF as cross-check. This is a re-validation on top of docs/14's own §7 audit —
that audit predates the systematic FAQ corpus, and several of its conclusions moved.

## Authorities

1. **Printed text** — the studio's card-data YAMLs (`buriedgiantstudios/cards`:
   `arcsbasegame.yml` for base lore L01–14 and leaders 01–08, `leaders-lore.yml` for the pack),
   which carry the verbatim text with bold/italic markup intact; the **card art in
   `assets/images/leader`** for the setup boxes and starting resources (read directly); ArcsDB as
   transcription cross-check.
2. **Official FAQ** — `content/faq/arcs/en-US.yml`; 29 of the 44 cards carry entries.
3. **Rules Library** (rules.buriedgiant.com) — §7 standard actions, §8.1/8.2/8.3 (Preludes / New
   Actions / Modifiers), §11 Leaders & Lore.
4. **HRF** — cross-check only.

## Method: grammar first, then the matching channel

The docs/20 A2 retraction (the Interests' rider) is structural here: every clause is classified by
rulebook grammar, and the implementation must be found in the matching channel — §8.2 "Name
(Action):" clauses in `GUILD_ALTS`/`LORE_ALTS` (guild-actions.ts) or a dedicated action flow, §8.3
bold modifiers as inline `hasTrait`/`hasLore`/`loreActive` at the decision point, §8.1 Preludes in
`lorePreludes`/the Prelude menu, passives in scoring/setup. The sweep covered rules/*.ts,
guild-actions.ts, prelude.ts, lore.ts, leaders.ts, control.ts, outrage.ts and observe.ts — never
rules/ alone.

**Channel result: clean.** All five LORE_ALTS entries sit on the printed action (Fire Rifles →
Battle, Nurture → Build, Prune → Repair, Guide → Move, Martyr → Move); Tool Priests' Summon rides
the Build menu, which §8.3.1 makes outcome-equivalent; no clause is implemented in the wrong
channel.

## Findings — defects

Severity **A** = changes game outcomes; **B** = observable divergence, limited reach.

### A1. Building in a controlled system does not place the piece damaged (base rule §7.2.2)
Rules Library §7.2.2 **Control**: "When you build **anything** in a system that is controlled by
anyone other than you, place the piece damaged." The engine damages built pieces only under
Empath's Bond, whose parenthetical *(Build ships damaged in Rival-controlled systems)* is a
reminder of this rule, not its source — the Bond FAQ errata ("Build ships damaged in systems
controlled by anyone else") confirms. HRF damages every built city, starport and ship when
`f.rivals.exists(_.rules(s))` (game-common.scala:944, 987, 1012). Consequences:
- ordinary Builds in rival-controlled systems come out fresh (wrong);
- **Hidden Harbors' first clause — "You always build ships fresh" — is currently a no-op**
  (docs/14 §6 records it as one), but it is the ship-only exemption from §7.2.2: HRF gates the
  damaged flag on `f.hasLore(HiddenHarbors).not` (game-common.scala:1013). Fixing the base rule
  un-no-ops the card;
- the Bond's `contested` gate in `performBuild` becomes the general rule and should stop being
  Bond-scoped.
Repro: build a ship at your starport in a system a rival rules — it must arrive damaged.

### A2. Building eligibility requires ruling; the rule requires presence (§7.2.1)
§7.2.1 Building: "in a system **with a Loyal piece**" — presence. Engine `offerBuild` requires
`rules(state, faction, s)` for cities and starports, with a docblock recording the phase-1
simplification. HRF's build menu is presence-based (`f.present(s)`). Together with A1 this is the
whole contested-build play the engine currently forbids: building into a system a rival controls,
arriving damaged. (Gate builds already use presence — gateBuilds' docblock says so — making the
slotted case inconsistent with the engine's own gate case.)

### A3. The homeless-defender raid rule is missing (§7.6 Step 3)
"You can only collect raid dice if there are defending buildings **or if the defender has no
Loyal buildings in any systems on the map**." The second clause is unimplemented — `offerGather`
opens raid dice only on defending buildings in the battle system (Raider Exosuits aside). HRF
implements it (`systems.forall(e.at(_).buildings.none)` → 6 raid dice, game-battle.scala:177).
The Anarchist's own card reminds players of exactly this rule ("if you have no buildings on the
map, Rivals can raid your ships!") — and an Anarchist *starts* with no buildings, so the variant
this audit covers is where the gap bites hardest. Repro: raid a faction whose buildings are all
destroyed — no raid dice are offered.

### A4. Tycoon's Ambition is refused at zero Material and Fuel
Official FAQ: "You can use its ability even if you have zero Material and Fuel." Engine
(rules/turn.ts, the `tycoon` offer): gated on `fuelish > 0`, so the free declaration is denied to
a player holding neither resource. Drop the gate; "discard all" of nothing is a legal cost.

## Findings — B

### B1. Tactical / Charismatic: an unmeetable "must" keeps the primary action
FAQ (Warrior): the Tactical move requires "a legal Battle action after moving... **Otherwise the
move must be undone**"; FAQ (Feastbringer): same for Influence-then-Secure. Engine `offerFollow`
with `required` and no legal follow-up logs "had no X to take" and lets the move/influence stand.
The correct shape is to withhold the before-pair when the follow-up cannot be met — the engine
already computes `canTake` before the *primary* action, but the follow-up's legality is only known
after it resolves, which is why the FAQ says undo. (An offer-time conservative check — only offer
"Move, then must Battle" toward destinations that create a battle — covers nearly every case
without journal-unfriendly undo machinery; the finding leaves the design open.)

### B2. Generous is not charged on Populist Demands or Tycoon's Ambition declares
FAQ (Feastbringer): "Giving away a Guild is a mandatory cost for **all** declares", explicitly
including Populist Demands, with no-cards meaning no declare. The engine's interception covers
only `ambition/declare` — `vox/populist` and `turn/prelude-tycoon` call `takeAmbitionMarker`
directly and bypass the cost.

### B3. Committed's two extra dice are optional in the engine; the ruling makes them mandatory
FAQ (Rebel): "collecting these two dice is mandatory." Engine treats Committed as a cap raise
(`ships + 2`) over a freely chosen total, so pools without the two extras — including a single
die — are offered. Per the ruling the legal totals are 2..ships+2 with the two extras always
included. HRF has the same divergence (combinations from 1); the FAQ postdates it.

### B4. Connected securing Farseers triggers the Farseers peek on the same declaration
FAQ (Noble): Farseers drawn by Connected "does not see the timing window" for its look-and-swap on
that declaration. Engine: `connected()` secures inside `takeAmbitionMarker`, and
`afterDeclarePeek` then reads the post-secure state — the just-drawn Farseers offers its peek.
Gate the peek on holding Farseers *before* the marker was taken. (The FAQ also confirms Populist
Demands drawn by Connected *does* re-trigger Connected when later declared with — the engine gets
that right, since the trigger lives in `takeAmbitionMarker`.)

### B5. "Max 1 per gate" is a total, not one-of-yours
FAQ (Gate Ports, Gate Stations, and Cloud Cities alike): "a maximum of one **total**." Cloud
Cities is implemented correctly (any cloud city blocks). The gate builds check `!mine(piece)`, so
a second faction's piece does not block. Unreachable in base+pack play except via Tyrant's
Authority annexing the holder's gate building — after which the holder is wrongly offered a second
one. docs/14 §7's "per-card provenance" version of this ruling does not match the current FAQ text
and is superseded by this finding.

### B6. A typeless Gate Stations city cannot be taxed at all
FAQ (Gate Stations): a gate city in a cluster with no other city "can still be taxed" — yielding
nothing, but a tax it is (captives off a rival's, tax-triggered effects). Engine builds gate-city
tax options per cluster type, so zero types means no option.

### B7. Beloved's ransack shield covers Ruthless, which is not a battle
Card: "Rivals cannot Ransack the Court **when they battle you**." `offerRuthlessRansack`
(standard-actions.ts) also honors the shield, but a Ruthless demolition is not a battle, so the
Elder is shielded where the card does not reach. (The battle-path shield in battle.ts is correct.)

## Confirmed correct (with the citation that proves it)

**Identity & setup (group A/B).** All 16 leaders' names, trait lists, two starting resources and
A/B/C setup boxes verify against the card art; all 44 names match the YAML (two cosmetic hyphens:
Tool-Priests, Fuel-Drinker); lore set membership matches which box's YAML holds the card. Draft
flow verifies against §11.1.1–11.1.6: rows of players+1 (`leadersNeeded`/`loreNeeded`, the Extra
Lore arithmetic included), reverse-cycle order from the last seat (§11.1.2's counterclockwise),
one-leader-one-lore gating, leader pieces replacing standard placement, resources into the
leftmost slots in printed order (`seatFaction`), setup traits per-seat in turn order (§11.1.6).

| card / trait | verdict |
| --- | --- |
| Beloved (battle half) | defender-owned free influence, gated on `ctx.tookTrophies` (battle.ts `belovedThen`); ransack shield correct on the battle path |
| Just / Violent / Academic | one predicate (`demotesFirst`), first place takes the low and no city bonus, second place zeroed — word-identical cards share it |
| Attuned / Insatiable / Firebrand | Copy-or-Pivot gate (`taxBonusResources`); FAQ "tax an empty stack for the bonus" holds — `taxGainsNothing` keeps the option when a bonus is in supply |
| Cryptic / Greedy | outrage slots at setup (`applySetupTraits`); note: implemented via full `provokeOutrage`, whose discard step is unreachable with the printed starting resources |
| Lavish | fires whenever Tycoon was scored, all holders (`applyLavish`) |
| Ambitious | post-declare any-resource gain, supply-gated, once (`offerAfterDeclare`) |
| Callow | own cities need control — matches the FAQ's rephrase; Empath's Bond correctly does **not** bypass it (the "any = non-Loyal" ruling): `taxableAt` keeps Bond on the rival branch |
| Disorganized | 2-ship cap per move (`movableCount`); FAQ: applies to Predictive Sensors (per adjacent system) — sensors move in system-sized asks; Force Beams ignores it (its own text) |
| Tactical / Charismatic | pip continuations, both orders, must-pair only when the suit lacks the action; Weapon-granted battles count (FAQ: different ships allowed — nothing binds them; catapult moves allowed — the continuation is a full Move) |
| Bold | per-card once, cancel-before-first-placement unspent, agent spent normally; FAQ "up to one agent on each card" |
| Generous | cost-before-declare with forfeit, poorest-rival choice — on the `ambition/declare` path (see B2) |
| Paranoid | guild cards need >1 own agent, Vox exempt; the ransack path bypasses it (`action/ransack` never consults `canSecure`), which is the card's "ignore this if you Ransack" — the code comment claiming ransack is unmodelled is stale |
| Learned | after all seating; draw 5 off the shuffled remainder, keep 2, scrap 3; short-box tolerated |
| Hated / Decentralized | scrap from reserve back; Decentralized's slot-uncovering falls out of `slotCapacity` |
| Ruthless | once per turn (`loreUsedThisTurn`), tax-or-build not both (FAQ), no pip (FAQ), yield-free hits allowed (FAQ), outrage-then-tax order (FAQ), destroyed pieces home not trophies, ransack on rival city (but see B7) |
| Tricky / Wary | reroll per distinct resource type, once (FAQ); assault ≤ skirmish enforced at collection |
| Connected | fresh-ambition gate, top-of-deck secure, fires off every `takeAmbitionMarker` path incl. Populist Demands (FAQ) — see B4 for the Farseers edge |
| Influential | Copy/Pivot gate, second influence offered not forced, no chaining |
| Proud | zeroed on second place and on ties ("not tied" printed) |
| Inspiring / Principled | rival cities via presence; empty slots as synthetic once-per-turn ids; Principled forbids own-city tax |
| Mythic | post-tax reshape, permanent, once per planet, gates and reshaped planets excluded |
| Ancient | catapult launch swapped from starports to gates, destination rules untouched |
| Irregular | intercept strikes = defender's Weapon icons, one Weapon discarded per intercepted battle, fires with no ships left |
| Resilient | repairs per starport in systems the holder rules, any color (the card's "Even Rival ones!"), battle system only, both sides of any battle, not off Rifles |
| Tool Priests (l01) | Summon in the Build menu, any color's city in a ruled system, once per turn via `workedThisTurn` |
| Galactic Rifles (l02) | LORE_ALTS on Battle; not a battle — no battle triggers fire (`ctx.rifles` guard) |
| Sprinter Drives (l03) | post-move fresh-ship continuation, damaged excluded, after catapults (lore-effects tests pin the ordering) |
| Mirror Plating (l04) | +1 intercept against assault-carrying rolls, defender-held |
| Hidden Harbors (l05) | clause 2 correct (fresh defending starport blocks raid dice); clause 1 — see A1 |
| Signal Breaker (l06) | −1 intercept for an all-fresh attacking fleet; net vs Mirror Plating on one count |
| Repair Drones (l07) | attacker-only, one ship, not off Rifles |
| Gate Ports (l08) | starports on gates via presence; move-in capture on the pre-arrival state, every leg incl. catapult and sprint; agent from mover's reserve (see B5 for max-1) |
| Cloud Cities (l09) | outside slots, pays the planet type (FAQ: outrage does not block the payment — `paying` is not a Prelude spend), max 1 **total** per planet, unslotted tracked |
| Living Structures (l10) | Nurture on Build, Prune on Repair, both LORE_ALTS |
| Gate Stations (l11) | cities on gates; cluster typing on `control.ts`; razing provokes all cluster types; taxing offers each type (see B6 for zero types) |
| Railgun Arrays (l12) | 1 hit before dice are collected, fresh Loyal defenders required |
| Ancient Holdings (l13) | a card slot with raid cost 4, seat-time registration, counts in ambitions, spendable |
| Seeker Torpedoes (l14) | assault rerolls ≤ fresh Loyal attacking ships |
| Predictive Sensors (l15) | defender, pre-collection, fresh Loyal ships from adjacent systems, looped per neighbor (Disorganized caps each hop, per FAQ) |
| Force Beams (l16) | Guide on Move; mixed groups by repeated picks; lane fixed; Disorganized ignored ("move modifiers in play areas") |
| Raider Exosuits (l17) | opens exactly the no-buildings case at 1 raid die, inside the fleet bound |
| Survival Overrides (l18) | Martyr on Move; fresh Loyal ship destroyed (not a trophy), target taken as trophy |
| Empath's Vision (l19) | any-dice reroll while Empath declared, once, whole-roll limit |
| Empath's Bond (l20) | any starports for build/catapult, any cities taxed captive-free, rival-controlled Bond builds damaged; "any = non-Loyal" ruling honored via the rival-branch placement |
| Keeper's Trust / Solidarity (l21/22) | raider-holdings block / suit-matching card block, both `loreActive` |
| Warlord's Cruelty (l23) | re-tax while Warlord declared (drops the `taxedThisTurn` filter) |
| Warlord's Terror / Tyrant's Ego (l24/25) | spend trophies/captives in Prelude, returned to their owner's reserve, one free Influence/Secure each, repeatable via the Prelude loop |
| Tyrant's Authority (l26) | Annex in the Build menu while Tyrant declared, rival building you control swapped for your own, returned to its owner's board |
| Tycoon's Ambition (l27) | undeclared ambitions only, discards all M+F, no zero marker on the lead (Secret Order's reading), Prelude placement (see A4 for the zero-resource gate) |
| Tycoon's Charm (l28) | M/F → any resource, one journalled swap at a time |
| The five outrage-clearers | `LORE_CLEARS_OUTRAGE` matches every printed pairing (Charm clears both Material and Fuel); offered only when outraged — a deliberate UX gate |
| `loreActive` | anyone's declaration arms a "While X is declared" card, holder-only effect |
| `loreUsedThisTurn` | reset in `performEndTurn` (checked against the docs/20 usedThisTurn precedent) |
| Lore's nature | never in `courtCards`, so unstealable and outside suit effects structurally; no ambition icons except Ancient Holdings' held resource, which counts via its slot |

## FAQ notes for future work

Campaign-scoped rulings skipped: Knowledge Set Free transfers (resources stay on the card),
Caretaker scrapping, frozen resources, the Empire as non-Rival. The Tycoon's Ambition/Cartel
ruling (card-held supply untouched by "discard all") is worth a test when someone wires that
interaction; the engine's Cartel supply lives on the card and is not slot-held, so it should
already hold.

## docs/14 §7 reconciliation

- "Gate Ports max-1 counts only that card's buildings" — superseded: the current FAQ says one
  **total** (B5).
- "Hidden Harbors' first clause is a genuine no-op" — wrong, via the §7.2.2 finding (A1).
- The Callow misreading record, the Rifles-is-not-a-battle rule, Gate Stations cluster typing and
  the Seeker Torpedoes reroll design notes all re-verify.
- The stated test counts in §5 are stale against the actual suites (79/35/28 vs 50/39/24) — a doc
  nit only.

## Out of scope

Blighted Reach / campaign content and Fates; lore29 Guild Loyalty (implemented, retired from the
UI) and lore30 Catapult Overdrive (fan-made, deliberately unimplemented) — acknowledged, not
audited; AI valuation of lore (docs/19).

## Triage

Outcome-impact first: **A1+A2 together** (one Build rework: presence eligibility + §7.2.2 damaged
placement + Hidden Harbors un-no-op), **A3** (homeless-defender raid), **A4** (Tycoon's Ambition
zero gate — a one-line fix), then **B2** (Generous on all declares), **B1** (must-follow), **B3**
(Committed mandatory), **B4** (Connected/Farseers timing), **B5/B6** (gate edges), **B7** (Beloved
vs Ruthless). Per the docs/20 precedent: one PR branch, one commit per finding, card text as the
test docstring, mutation batteries, stale tests inverted with comments naming the finding. Any new
ask goes on the board surfaces, not the action pane.
