# Lore interaction test saves

**Generated — do not edit.** Rebuild with `npm run saves:build`.

Each file is a real game played into the moment the interaction becomes testable, so every
position here is one the rules can actually reach. Load one with **Load** on the start screen
(or the Load button in the top bar), and the game resumes on the decision described.

These exist because every lore bug found so far has been an interaction the unit tests could
not see — a valid Ask no UI would draw, or a decision shown without the thing it was about.
Those need eyes. What they do not need is twenty minutes of setup first.

14 of 14 scenarios built.

## Coverage by card

17 of 28 implemented lore cards have a save.

| Card | | Saves |
| ---: | --- | --- |
| `lore01` | Tool Priests | — |
| `lore02` | Galactic Rifles | — |
| `lore03` | Sprinter Drives | [lore16-force-beams--vs-sprinter-drives](lore16-force-beams--vs-sprinter-drives.json) |
| `lore04` | Mirror Plating | [lore04-mirror-plating--vs-signal-breaker](lore04-mirror-plating--vs-signal-breaker.json) |
| `lore05` | Hidden Harbors | [lore05-hidden-harbors--vs-raider-exosuits](lore05-hidden-harbors--vs-raider-exosuits.json) |
| `lore06` | Signal Breaker | [lore04-mirror-plating--vs-signal-breaker](lore04-mirror-plating--vs-signal-breaker.json) |
| `lore07` | Repair Drones | — |
| `lore08` | Gate Ports | [lore08-gate-ports--with-gate-stations](lore08-gate-ports--with-gate-stations.json) |
| `lore09` | Cloud Cities | — |
| `lore10` | Living Structures | — |
| `lore11` | Gate Stations | [lore08-gate-ports--with-gate-stations](lore08-gate-ports--with-gate-stations.json) |
| `lore12` | Railgun Arrays | [lore12-railgun-arrays--volley](lore12-railgun-arrays--volley.json)<br>[lore15-predictive-sensors--then-railgun-arrays](lore15-predictive-sensors--then-railgun-arrays.json) |
| `lore13` | Ancient Holdings | — |
| `lore14` | Seeker Torpedoes | [lore14-seeker-torpedoes--with-empaths-vision](lore14-seeker-torpedoes--with-empaths-vision.json)<br>[lore14-seeker-torpedoes--reroll-tray](lore14-seeker-torpedoes--reroll-tray.json) |
| `lore15` | Predictive Sensors | [lore15-predictive-sensors--then-railgun-arrays](lore15-predictive-sensors--then-railgun-arrays.json) |
| `lore16` | Force Beams | [lore16-force-beams--guide-mixed-group](lore16-force-beams--guide-mixed-group.json)<br>[lore16-force-beams--vs-sprinter-drives](lore16-force-beams--vs-sprinter-drives.json) |
| `lore17` | Raider Exosuits | [lore05-hidden-harbors--vs-raider-exosuits](lore05-hidden-harbors--vs-raider-exosuits.json) |
| `lore18` | Survival Overrides | [lore18-survival-overrides--martyr](lore18-survival-overrides--martyr.json) |
| `lore19` | Empath's Vision | [lore14-seeker-torpedoes--with-empaths-vision](lore14-seeker-torpedoes--with-empaths-vision.json) |
| `lore20` | Empath's Bond | [lore20-empaths-bond--tax-build-catapult](lore20-empaths-bond--tax-build-catapult.json) |
| `lore21` | Keeper's Trust | — |
| `lore22` | Keeper's Solidarity | — |
| `lore23` | Warlord's Cruelty | [lore23-warlords-cruelty--outrage-clear](lore23-warlords-cruelty--outrage-clear.json) |
| `lore24` | Warlord's Terror | — |
| `lore25` | Tyrant's Ego | — |
| `lore26` | Tyrant's Authority | [lore26-tyrants-authority--annex](lore26-tyrants-authority--annex.json) |
| `lore27` | Tycoon's Ambition | [lore27-tycoons-ambition--declare-without-zeroing](lore27-tycoons-ambition--declare-without-zeroing.json) |
| `lore28` | Tycoon's Charm | — |

**No save yet:** Tool Priests (`lore01`), Galactic Rifles (`lore02`), Repair Drones (`lore07`), Cloud Cities (`lore09`), Living Structures (`lore10`), Ancient Holdings (`lore13`), Keeper's Trust (`lore21`), Keeper's Solidarity (`lore22`), Warlord's Terror (`lore24`), Tyrant's Ego (`lore25`), Tycoon's Charm (`lore28`).

Not a claim that these are broken — a claim that nobody has watched them run. Add a scenario
to `scripts/build-test-saves.ts` to close one.

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

## Ambition-gated

### Empath’s Bond — tax, build and catapult all rewritten at once

`saves/lore/lore20-empaths-bond--tax-build-catapult.json` — seed 1, 414 actions in.

**You are here:** red — Tax

**➜ Do this first:** Take Tax and look for a rival's city in the list.

**Then check:**

- With Empath declared, tax a RIVAL city: it should work and take NO captive.
- Build a ship at a rival starport; in a rival-ruled system it should arrive damaged.
- Catapult out of a rival starport.
- Undeclare (next chapter) and confirm all three revert.

**Why it is worth checking:** The most invasive card in the set: it changes three different action offers, and its build clause makes ships arrive damaged in rival-controlled systems. Three surfaces, one gate — a good candidate for one of them being missed.

Cards: lore20=blue
