# Lore interaction test saves

**Generated — do not edit.** Rebuild with `npm run saves:build`.

Each file is a real game played into the moment the interaction becomes testable, so every
position here is one the rules can actually reach. Load one with **Load** on the start screen
(or the Load button in the top bar), and the game resumes on the decision described.

These exist because every lore bug found so far has been an interaction the unit tests could
not see — a valid Ask no UI would draw, or a decision shown without the thing it was about.
Those need eyes. What they do not need is twenty minutes of setup first.

25 of 25 scenarios built.

## Coverage by card

28 of 28 implemented lore cards have a save.

| Card | | Saves |
| ---: | --- | --- |
| `lore01` | Tool Priests | [lore01-tool-priests--summon-at-a-city](lore01-tool-priests--summon-at-a-city.json) |
| `lore02` | Galactic Rifles | [lore02-galactic-rifles--fire-rifles](lore02-galactic-rifles--fire-rifles.json) |
| `lore03` | Sprinter Drives | [lore16-force-beams--vs-sprinter-drives](lore16-force-beams--vs-sprinter-drives.json) |
| `lore04` | Mirror Plating | [lore04-mirror-plating--vs-signal-breaker](lore04-mirror-plating--vs-signal-breaker.json) |
| `lore05` | Hidden Harbors | [lore05-hidden-harbors--vs-raider-exosuits](lore05-hidden-harbors--vs-raider-exosuits.json) |
| `lore06` | Signal Breaker | [lore04-mirror-plating--vs-signal-breaker](lore04-mirror-plating--vs-signal-breaker.json) |
| `lore07` | Repair Drones | [lore07-repair-drones--repair-after-the-battle](lore07-repair-drones--repair-after-the-battle.json) |
| `lore08` | Gate Ports | [lore08-gate-ports--with-gate-stations](lore08-gate-ports--with-gate-stations.json) |
| `lore09` | Cloud Cities | [lore09-cloud-cities--city-outside-the-slots](lore09-cloud-cities--city-outside-the-slots.json) |
| `lore10` | Living Structures | [lore10-living-structures--nurture-and-prune](lore10-living-structures--nurture-and-prune.json) |
| `lore11` | Gate Stations | [lore08-gate-ports--with-gate-stations](lore08-gate-ports--with-gate-stations.json) |
| `lore12` | Railgun Arrays | [lore12-railgun-arrays--volley](lore12-railgun-arrays--volley.json)<br>[lore15-predictive-sensors--then-railgun-arrays](lore15-predictive-sensors--then-railgun-arrays.json) |
| `lore13` | Ancient Holdings | [lore13-ancient-holdings--the-extra-slot](lore13-ancient-holdings--the-extra-slot.json) |
| `lore14` | Seeker Torpedoes | [lore14-seeker-torpedoes--with-empaths-vision](lore14-seeker-torpedoes--with-empaths-vision.json)<br>[lore14-seeker-torpedoes--reroll-tray](lore14-seeker-torpedoes--reroll-tray.json) |
| `lore15` | Predictive Sensors | [lore15-predictive-sensors--then-railgun-arrays](lore15-predictive-sensors--then-railgun-arrays.json) |
| `lore16` | Force Beams | [lore16-force-beams--guide-mixed-group](lore16-force-beams--guide-mixed-group.json)<br>[lore16-force-beams--vs-sprinter-drives](lore16-force-beams--vs-sprinter-drives.json) |
| `lore17` | Raider Exosuits | [lore05-hidden-harbors--vs-raider-exosuits](lore05-hidden-harbors--vs-raider-exosuits.json) |
| `lore18` | Survival Overrides | [lore18-survival-overrides--martyr](lore18-survival-overrides--martyr.json) |
| `lore19` | Empath's Vision | [lore14-seeker-torpedoes--with-empaths-vision](lore14-seeker-torpedoes--with-empaths-vision.json) |
| `lore20` | Empath's Bond | [lore20-empaths-bond--tax-build-catapult](lore20-empaths-bond--tax-build-catapult.json) |
| `lore21` | Keeper's Trust | [lore21-keepers-trust--raid-a-guild-card](lore21-keepers-trust--raid-a-guild-card.json) |
| `lore22` | Keeper's Solidarity | [lore22-keepers-solidarity--take-a-card-of-any-suit](lore22-keepers-solidarity--take-a-card-of-any-suit.json) |
| `lore23` | Warlord's Cruelty | [lore23-warlords-cruelty--outrage-clear](lore23-warlords-cruelty--outrage-clear.json) |
| `lore24` | Warlord's Terror | [lore24-warlords-terror--trophy-for-an-influence](lore24-warlords-terror--trophy-for-an-influence.json) |
| `lore25` | Tyrant's Ego | [lore25-tyrants-ego--captive-for-a-secure](lore25-tyrants-ego--captive-for-a-secure.json) |
| `lore26` | Tyrant's Authority | [lore26-tyrants-authority--annex](lore26-tyrants-authority--annex.json) |
| `lore27` | Tycoon's Ambition | [lore27-tycoons-ambition--declare-without-zeroing](lore27-tycoons-ambition--declare-without-zeroing.json) |
| `lore28` | Tycoon's Charm | [lore28-tycoons-charm--trade-material-for-anything](lore28-tycoons-charm--trade-material-for-anything.json) |

## Battle interrupts

### Railgun Arrays — the hit before the dice

`saves/lore/lore12-railgun-arrays--volley.json` — seed 5, 172 actions in.

**You are here:** red — assign 1 self-hit(s)

**➜ Do this first:** Click one of your own ships to take the railgun hit, then Confirm.

**Then check:**

- There should be NO dice tray, and a line naming Railgun Arrays as the reason.
- Assign the hit, confirm, and check it hands off to the dice gather.
- Undo back out and confirm it does not strand you.

**Why it is worth checking:** The only hit assignment in the game with no dice on the table. It deadlocked the UI once already: the window would not draw an assignment without a roll, and the panel hides battle/hit because the window owns it.

Cards: lore12=blue

### Predictive Sensors then Railgun Arrays — two defender interrupts, one battle

`saves/lore/lore15-predictive-sensors--then-railgun-arrays.json` — seed 13, 299 actions in.

**You are here:** blue — Predictive Sensors: reinforce 3-Arrow before red collects dice

**➜ Do this first:** You are the defender: pick a neighbouring system and bring ships into the battle.

**Then check:**

- The ask belongs to the DEFENDER, not the attacker whose turn it is.
- Bring ships in, then confirm the Railgun volley fires after that, not before.
- Decline instead (bring in no ships) and check the volley still fires.
- Watch for the turn passing to the wrong player between the two.

**Why it is worth checking:** Both fire for the defender before the attacker collects dice, and the order matters: ships pulled in by Sensors should be standing there for the Railgun volley. Two interrupts in sequence is also the case most likely to strand the flow.

Cards: lore15=blue, lore12=blue

### Galactic Rifles — a strike that is not a battle

`saves/lore/lore02-galactic-rifles--fire-rifles.json` — seed 3, 166 actions in.

**You are here:** blue — Fire Rifles — from where?

**➜ Do this first:** Take Battle, then "Fire Rifles", and pick a system to fire from.

**Then check:**

- One skirmish die per fresh ship in the firing system, capped at six.
- Hits land on ships before buildings, as in a battle.
- No raid, no outrage, no post-battle repair should happen.
- If the target holds Railgun Arrays or Mirror Plating, neither should trigger.

**Why it is worth checking:** The official ruling is that this is NOT a battle, so no defence-triggered ability may fire. That currently falls out of the shape rather than a guard — it never enters `openBattle`, so Mirror Plating, Hidden Harbors, Railgun Arrays and Predictive Sensors are simply off the path. Worth confirming by eye, because nothing enforces it.

Cards: lore02=blue

## Rerolls

### Seeker Torpedoes + Empath’s Vision — two reroll sources in one roll

`saves/lore/lore14-seeker-torpedoes--with-empaths-vision.json` — seed 1, 256 actions in.

**You are here:** blue — Seeker Torpedoes: reroll up to 1 assault die?

**➜ Do this first:** Click assault dice to reroll them, then Reroll — a second source should ask next.

**Then check:**

- Reroll from the first source and check you are then asked again by the SECOND source.
- The dice shown the second time must be the NEW faces, not the originals.
- Decline the first and confirm the second is still offered.
- Empath’s Vision takes any dice; Seeker Torpedoes only assault. Check the locked dice differ.

**Why it is worth checking:** offerReroll recurses through sources carrying a `used` list. One source is the tested path; two in a single roll is where an exhausted source could be re-offered, or the second silently skipped. Empath’s Vision also needs Empath declared, so its gate is live.

Cards: lore14=blue, lore19=blue

### Seeker Torpedoes — the plain reroll

`saves/lore/lore14-seeker-torpedoes--reroll-tray.json` — seed 1, 40 actions in.

**You are here:** blue — Seeker Torpedoes: reroll up to 4 assault dice?

**➜ Do this first:** Click an assault die and press Reroll.

**Then check:**

- The rolled dice should be visible and clickable.
- Skirmish dice should be locked and greyed; assault dice selectable.
- Selecting none should read "Keep these dice" rather than looking like a dead end.
- Reroll and confirm the new faces are shown before hits are assigned.

**Why it is worth checking:** The baseline for the reroll tray: one source, assault dice only, skirmish dice locked.

Cards: lore14=blue

## Battle dice

### Hidden Harbors + Raider Exosuits — both rewrite the raid-dice limit

`saves/lore/lore05-hidden-harbors--vs-raider-exosuits.json` — seed 2, 28 actions in.

**You are here:** red — Battle yellow in 2-Arrow — choose dice

**➜ Do this first:** Read the raid column, then set a pool with 1 raid die and Roll.

**Then check:**

- Open a battle and read the raid column in the gather.
- Against no buildings, the Exosuits holder should be offered exactly 1 raid die.
- Against a fresh defending starport, raid dice should be 0 regardless.
- Against a damaged starport, the ordinary 6 should be back.

**Why it is worth checking:** One opens the no-buildings case to a single raid die, the other shuts raid dice off while a defending starport is fresh. They should never both apply — a starport is a building — so this is the check that the two conditions really are exclusive in play.

Cards: lore05=yellow, lore17=blue

### Mirror Plating + Signal Breaker — the intercept that cancels itself

`saves/lore/lore04-mirror-plating--vs-signal-breaker.json` — seed 3, 45 actions in.

**You are here:** yellow — Battle blue in 2-Crescent — choose dice

**➜ Do this first:** Set an assault-heavy pool and Roll, then read the Intercepted note.

**Then check:**

- With both cards in the battle the intercept should come out at zero, not negative.
- Check the self-hit count matches what the note claims.

**Why it is worth checking:** These are computed as one number, clamped at zero. Held against each other they should cancel exactly. The interesting case is one on each side of the same battle.

Cards: lore04=blue, lore06=yellow

### Repair Drones — the effect with no prompt

`saves/lore/lore07-repair-drones--repair-after-the-battle.json` — seed 1, 38 actions in.

**You are here:** blue — Battle yellow in 2-Crescent — choose dice

**➜ Do this first:** Pick an assault-heavy pool and Roll, then resolve the battle to the end.

**Then check:**

- Take a self-hit so one of your attacking ships is damaged.
- Finish the battle. One damaged attacking ship should come back fresh.
- The log should say so — that is the only feedback the card gives.
- It must NOT repair after a Galactic Rifles strike, which is not a battle.

**Why it is worth checking:** Applied without asking: HRF prompts, we do not, because the ships in a system are interchangeable. That makes it the one card here with **no Ask of its own** — nothing can park on it, so this save parks just before the battle resolves. An effect with no prompt is also an effect nobody notices failing.

Cards: lore07=blue

## Move alts

### Force Beams — Guide a mixed group

`saves/lore/lore16-force-beams--guide-mixed-group.json` — seed 7, 44 actions in.

**You are here:** blue — Move

**➜ Do this first:** Take the Guide option, pick a lane, move some of one colour — then look for the second ask.

**Then check:**

- You should be asked AGAIN on the same lane — take a different colour.
- Guide into a gate a rival holds with a fresh starport: no agent should be captured.
- Guide into a gate and confirm no "and further" catapult continuation is offered.

**Why it is worth checking:** One Guide may carry your ships and a rival’s together; it used to end after one colour. It must also ignore the Gate Ports toll and refuse to start a catapult.

Cards: lore16=blue

### Force Beams + Sprinter Drives — a move modifier that must not fire

`saves/lore/lore16-force-beams--vs-sprinter-drives.json` — seed 22, 42 actions in.

**You are here:** blue — Move

**➜ Do this first:** Move ships normally first and note the sprint offer; then Guide the same ships.

**Then check:**

- Move ships normally and confirm the Sprinter Drives leg is offered.
- Now Guide the same ships along a lane: no sprint leg should appear.
- Check the log distinguishes "guided" from "moved".

**Why it is worth checking:** Sprinter Drives hangs off moving fresh Loyal ships. Guide is not a move, so no sprint leg should follow it — but a plain Move of the same ships SHOULD offer one. Both in one game is the only way to see the difference by eye.

Cards: lore16=blue, lore03=blue

### Survival Overrides — Martyr’s asymmetric disposal

`saves/lore/lore18-survival-overrides--martyr.json` — seed 4, 56 actions in.

**You are here:** blue — Move

**➜ Do this first:** Take the Martyr option and note your trophy count before you confirm.

**Then check:**

- Compare your trophy count before and after.
- Your ship must NOT become a trophy; theirs must.
- Try it on a damaged rival ship: it should be destroyed outright, not repaired.
- Check your ship comes back into reserve and can be rebuilt.

**Why it is worth checking:** Two ships leave the board to different places: yours home to reserve, theirs to your trophy pile. Getting that backwards is invisible until someone counts trophies.

Cards: lore18=blue

## Build alts

### Tyrant’s Authority — Annex, and the slot it frees

`saves/lore/lore26-tyrants-authority--annex.json` — seed 5, 263 actions in.

**You are here:** blue — Build

**➜ Do this first:** Take Build, then the Annex option on a rival building.

**Then check:**

- Their city should return to THEIR player board, not the box.
- Watch their resource slots: a returned city can shrink capacity.
- Annex a starport and confirm you get a starport, not a city.

**Why it is worth checking:** Annex replaces a rival building in place, so the replaced piece must leave before yours lands — no free slot is needed. A returned city also re-covers a resource slot on its owner’s board, which can shrink their capacity and strand a token.

Cards: lore26=blue

### Gate Ports + Gate Stations — two cards building on gates

`saves/lore/lore08-gate-ports--with-gate-stations.json` — seed 4, 39 actions in.

**You are here:** blue — Build

**➜ Do this first:** Take Build and look for a gate in the target list.

**Then check:**

- Build a city on a gate (Gate Stations), then try a starport on the same gate (Gate Ports).
- The ruling allows it; we may wrongly refuse. Note which happens.
- Check the gate city takes its cluster’s resource types.

**Why it is worth checking:** Both open gates as build sites with a "max 1 per gate" limit, and docs/14 records a known divergence: our per-faction test is stricter than the ruling. Holding both is where that wrongly blocks a legal build.

Cards: lore08=blue, lore11=blue

### Tool Priests — build a ship at a city, once a turn

`saves/lore/lore01-tool-priests--summon-at-a-city.json` — seed 16, 58 actions in.

**You are here:** blue — Build

**➜ Do this first:** Take Build and look for a "Summon Ship" option.

**Then check:**

- Summon a ship, then take another Build in the same turn: no second Summon should be offered.
- Check a rival's city in a system you rule is offered, not just your own.
- A city in a system you do NOT rule must not be offered.

**Why it is worth checking:** The card says "yes, even Rival cities you control!", so any colour's city in a system you rule is a shipyard. Once per turn across all of them, not once per city — the limit is the part most likely to be wrong.

Cards: lore01=blue

### Cloud Cities — a city where there is no building slot

`saves/lore/lore09-cloud-cities--city-outside-the-slots.json` — seed 10, 27 actions in.

**You are here:** blue — Build

**➜ Do this first:** Take Build and pick the "Build Cloud City" option, noting what it charges.

**Then check:**

- The cost should match the planet's printed resource, and you must hold it.
- It should be offered on a planet whose building slots are all full.
- Raze it later and check your capacity and slot count come back correct.

**Why it is worth checking:** The only city that does not occupy a building slot, paid for with the planet's own resource. It is tracked in `state.unslotted`, and a stale id there would make the *next* city built from that piece wrongly unslotted — capacity bugs are silent and cumulative.

Cards: lore09=blue

### Living Structures — a Build that taxes, a Repair that rebuilds

`saves/lore/lore10-living-structures--nurture-and-prune.json` — seed 1, 206 actions in.

**You are here:** blue — Build

**➜ Do this first:** Take Build and use "Nurture" to tax one of your own cities.

**Then check:**

- Nurture should gain the resource and fire any tax-triggered traits you hold.
- Then take Repair and use "Prune" to swap a city for a starport.
- A pruned city returning to your board should re-cover a resource slot.

**Why it is worth checking:** Two alts on one card, on different actions. Nurture is a Tax bought with a Build pip, so it must trigger everything a tax triggers — the FAQ is explicit that a "new action" containing a standard action fires that action's modifiers. Prune converts a building in place, which touches slots.

Cards: lore10=blue

## Prelude

### The outrage-clearing discards — ungated by ambition

`saves/lore/lore23-warlords-cruelty--outrage-clear.json` — seed 2, 142 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** The Prelude tray is already open and the outrage already provoked — take the discard-to-clear option.

**Then check:**

- The discard should be offered whether or not the ambition is declared.
- Confirm it clears the right resource and the card leaves play.
- With no outrage, it should not be offered at all.

**Why it is worth checking:** Five ambition-paired cards print a Prelude discard that clears your outrage, and that half is deliberately NOT gated on the ambition. Easy to over-gate by accident.

Cards: lore23=blue

### Tycoon’s Ambition — a declaration that does not zero the card

`saves/lore/lore27-tycoons-ambition--declare-without-zeroing.json` — seed 11, 174 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** The Prelude tray is already open, Tycoon is declared and the resources are held — take the Tycoon's Ambition option.

**Then check:**

- Use the Ambition option and check ALL Material and Fuel are discarded.
- The played card must keep its strength — check the lead card in the play area.
- Confirm a rival can still surpass it as if it were unzeroed.

**Why it is worth checking:** Takes an ambition marker while leaving the played card at its printed strength. If the card gets zeroed anyway, surpass maths goes wrong later in the round and nothing near the card will point at it.

Cards: lore27=blue

### Ancient Holdings — a resource slot that is not on the player board

`saves/lore/lore13-ancient-holdings--the-extra-slot.json` — seed 4, 35 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** Open the arrange screen from the Prelude and look at the extra slot on the card.

**Then check:**

- The card slot should appear alongside the six city slots, and hold a token.
- Capacity should be one higher than the cities on your board imply.
- A rival raiding it should be charged 4 keys, not 1-3 — not reachable from this save, so check it against lore21-keepers-trust--raid-a-guild-card.
- Drag a token in and out and confirm it is spendable from there.

**Why it is worth checking:** An extra slot living on the card, raided for four keys — dearer than any city slot. It widens capacity from outside `CITY_SLOT_KEYS`, so anything counting slots by index can miss it, and a token stranded there is invisible to `slotsOf`.

Cards: lore13=blue

### Warlord's Terror — spend a trophy on an action

`saves/lore/lore24-warlords-terror--trophy-for-an-influence.json` — seed 7, 287 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** Take the Warlord's Terror option to trade a trophy for an Influence.

**Then check:**

- The returned piece must go to its OWNER's reserve, not yours and not the box.
- Your trophy count should drop by one.
- The Influence that follows should behave like any other Influence.
- With an empty trophy pile the option should not appear.

**Why it is worth checking:** Returns a captured piece to *its owner's* reserve and buys an action with it. Returning it to the wrong reserve is the obvious failure and is invisible unless someone counts pieces; it also lowers your trophy count, which is Warlord scoring.

Cards: lore24=blue

### Tyrant's Ego — spend a captive on an action

`saves/lore/lore25-tyrants-ego--captive-for-a-secure.json` — seed 2, 159 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** Take the Tyrant's Ego option to trade a captive for a Secure.

**Then check:**

- The agent must return to its OWNER's reserve.
- Your captive count should drop by one.
- The Secure that follows should offer the ordinary court choices.
- With no captives the option should not appear.

**Why it is worth checking:** The captive twin of Terror, and the same failure applies: the agent must go home to its owner. Captives are Tyrant scoring, so a miscount moves the ambition.

Cards: lore25=blue

### Tycoon's Charm — swap Material or Fuel for anything

`saves/lore/lore28-tycoons-charm--trade-material-for-anything.json` — seed 1, 438 actions in.

**You are here:** blue — Prelude

**➜ Do this first:** Take a Tycoon's Charm trade and watch the slots as the swap lands.

**Then check:**

- The traded-away resource should leave and the new one arrive in a legal slot.
- Take the option again — it should still be there while you hold Material or Fuel.
- Trade into a full row and confirm you are made to rearrange or discard.
- The option should vanish once you hold neither Material nor Fuel.

**Why it is worth checking:** One swap at a time because the Prelude loops, so "any number" is taking it repeatedly. Each swap is a *gain*, which means it can overflow your slots — the interesting case is trading into a full row and being made to settle it.

Cards: lore28=blue

## Ambition-gated

### Empath’s Bond — tax, build and catapult all rewritten at once

`saves/lore/lore20-empaths-bond--tax-build-catapult.json` — seed 1, 427 actions in.

**You are here:** blue — Tax

**➜ Do this first:** Take Tax and look for a rival's city in the list.

**Then check:**

- With Empath declared, tax a RIVAL city: it should work and take NO captive.
- Build a ship at a rival starport; in a rival-ruled system it should arrive damaged.
- Catapult out of a rival starport.
- Undeclare (next chapter) and confirm all three revert.

**Why it is worth checking:** The most invasive card in the set: it changes three different action offers, and its build clause makes ships arrive damaged in rival-controlled systems. Three surfaces, one gate — a good candidate for one of them being missed.

Cards: lore20=blue

## Raiding

### Keeper's Trust — what a raid may take from you

`saves/lore/lore21-keepers-trust--raid-a-guild-card.json` — seed 6, 308 actions in.

**You are here:** red raids yellow — 1 key(s) to spend

**➜ Do this first:** Spend the keys — take a resource or a card, and watch what the price is.

**Then check:**

- Each purchase should be priced by the slot the token sits in, not a flat rate.
- Check what Trust protects, and that it protects it from every raider.
- Stop raiding partway and confirm unspent keys are simply lost.

**Why it is worth checking:** Trust and Solidarity both rewrite the raid menu from the *victim's* side, which is unusual enough to be worth watching: most cards change what their holder may do. The raid menu is also priced per slot, so the wrong slot means the wrong price.

Cards: lore21=blue

### Keeper's Solidarity — a card whose suit you do not hold

`saves/lore/lore22-keepers-solidarity--take-a-card-of-any-suit.json` — seed 54, 194 actions in.

**You are here:** red raids blue — 2 key(s) to spend

**➜ Do this first:** Spend keys on a court card and check which suits are on offer.

**Then check:**

- Cards of suits you hold none of should be takeable.
- Compare against the same raid without the card, if you can reach one.
- The key cost should be unchanged — Solidarity widens choice, not price.

**Why it is worth checking:** Normally a raided card must match a suit you hold. Solidarity lifts that, so the menu should be wider than the base game allows — a change that looks like nothing if the base restriction was never implemented in the first place.

Cards: lore22=blue
