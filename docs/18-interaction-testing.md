# Arcs Digital — Testing card interactions

## 1. What the unit tests keep missing

The engine has 600+ tests, every lore card is mutation-tested, and the bugs that actually reached
the screen were none of these things:

| Bug | Why no test saw it |
| --- | --- |
| **Railgun Arrays deadlocked the game.** The battle window would not draw a hit assignment without a roll, and the action panel hides `battle/hit` because the window owns it. | The engine was *correct*. It produced a valid Ask. The defect was that no UI surface would draw that Ask, and nothing tests "every Ask is renderable". |
| **Rerolls were decided blind.** The dice were nowhere on screen while you chose which to reroll. | Same shape. The engine offered the right options with the right data attached; the UI never used it. |
| **One Guide moved one colour.** The card's headline use — pulling your ships and a rival's together — cost two pips instead of one. | The card tests asserted rival ships *can* move. Nothing asserted a **mixed** group in one action, because nothing said that was the point. It took reading a player discussion to find out. |

Two lessons, and they pull in different directions.

**The first two are a category, not bad luck.** Both are "the engine is right and the UI cannot
draw it". That category is invisible to engine tests by construction — the engine passes. It needs
either a human looking at a real game, or an invariant that spans both layers (section 4).

**The third is a knowledge gap, not a coverage gap.** No amount of testing finds a rule you have
misread. That one was caught by the publisher's FAQ and a player thread, which is why
docs/14 records provenance per card and why the card art is the authority.

## 2. The saves

`saves/lore/` holds a game per interaction, played into the moment that interaction becomes
testable. Load one with **Load** on the start screen; the game resumes on the decision described.
`saves/lore/README.md` is the generated index — what each one is parked on, why it is worth a look,
and what to try.

Rebuild them with:

```bash
npm run saves:build
```

Or a subset — by **card id**, scenario slug, or batch name:

```bash
npm run saves:build -- lore14      # everything touching Seeker Torpedoes
npm run saves:build -- reroll      # the Rerolls batch
```

**Saves are named `<id>-<card name>--<what it tests>`**, e.g.
`lore23-warlords-cruelty--outrage-clear.json`. The id leads so the directory sorts into card order;
the printed name is there because an id alone is unreadable — `lore23-outrage-clear` means nothing
unless you happen to know lore23 is Warlord's Cruelty, and a directory you have to decode is a
directory you do not use. Only the primary card is named, since a pair runs to eighty characters
otherwise; the second card reads as English in the scenario part (`--vs-signal-breaker`) and both
always appear in the coverage table.

That table at the top of `saves/lore/README.md` is the difference between a systematic approach and
a pile of fixtures. It lists every implemented lore card against the saves covering it, so **a card
with no save is visible as a card nobody has watched run** — which, given that every bug so far was
only visible in a running game, is the list that matters. Filtering works on ids regardless of
filename, so `saves:build -- lore19` still finds the save whose name does not carry it.

Each entry states **where the save resumes**, then a single **➜ Do this first** instruction, then
what to check. The instruction is separate on purpose: a list that opens with "the window should
show X" leaves you reading rather than doing, and these saves land mid-decision where the useful
thing to say is which button to press.

A full build owns the directory and prunes saves no scenario claims any more; a *filtered* build
deliberately does not, or rebuilding one card would delete the rest. An orphaned save is not
harmless: the replay test keeps validating it, so the suite stays green while the index no longer
mentions it and nobody knows what it was for.

Batches, chosen by *where the interaction lives* rather than by card number, because that is where
the bugs cluster:

| Batch | What it stresses |
| --- | --- |
| Battle interrupts | Asks that fire before dice exist — the Railgun category |
| Rerolls | The reroll tray, and two sources in one roll |
| Battle dice | Pool limits: raid dice, intercepts |
| Move alts | Actions that are *not* moves and must not trigger move modifiers |
| Build alts | Placement, replacement, and slot capacity |
| Prelude | Discards and declarations before the pips |
| Ambition-gated | Cards live only while an ambition is declared |

## 3. How a scenario is built, and the two traps in it

A save is `{ version, options, journal }` and nothing else. **A position cannot be fabricated** —
it has to be *played into*, or it would not be a position the rules can reach and nothing learned
from it could be trusted. So each scenario in `scripts/build-test-saves.ts` declares the cards it
needs and a predicate for the moment it wants, and the runner plays real games across many seeds
until an Ask satisfies the predicate.

Two things went wrong while building this, both worth keeping written down because both are silent.

**A scenario can stop somewhere that does not match what it claims.** The first cut of the reroll
scenario stopped at "any reroll Ask". Several cards reroll, and whichever asks first wins — so the
save titled *Seeker Torpedoes* handed over an *Empath's Vision* prompt. It built, it looked fine,
and it described itself wrongly. Predicates are now keyed on the source that is actually asking. A
save that misdescribes itself is worse than a missing one, because it gets believed.

**Where the cards land decides whether anything is tested at all.** The draft is a shared pool
picked round-robin, so the runner has to choose *which seat* takes a wanted card. The first version
gave wanted cards to whichever seat was asked next, which split pairs across factions at random.
For some pairs that is exactly wrong — two defender interrupts must be on one player. For others it
is exactly right: Hidden Harbors defends and Raider Exosuits attacks, so both on one player tests
nothing. Each scenario now says `hold: 'one' | 'split'`, and the index reports the holders it
actually ended up with rather than the ones it intended.

When the sweep cannot reach a scenario it is **listed as not built** rather than dropped. A missing
scenario is not the same as a passing one.

## 4. What is still not covered

**The saves are a manual aid, not a net.** They shorten the loop from twenty minutes of setup to
one file-open, which is what makes checking a card by hand realistic. They do not *catch* anything
on their own.

`packages/engine/test/saves-replay.test.ts` guards only their durability: every checked-in save
still replays to a playable position. That catches the one way they rot — an action rename or an
argument-shape change quietly invalidating every save written before it. Verified by mutation:
renaming `action/move-ships` in a journal fails the test.

**The gap worth closing next is the renderability invariant**, because it is the one that would
have caught two of the three bugs above automatically. The property is:

> For every Ask the engine can produce, at least one of its actions is reachable in the UI.

Today that is split across two files that do not know about each other: `ActionPanel` hides action
types it believes a window owns, and `Battle.tsx` decides whether that window draws. Railgun Arrays
fell into the space between them. Making it testable means extracting the decision into one
predicate — roughly `surfaceFor(ask, state)` returning which component claims an Ask, with
`undefined` meaning nobody — and asserting over many random games that it is never `undefined`.
That is a real refactor of the two components, not a test to bolt on, which is why it is recorded
here rather than done.

Until then: the saves plus the batches in section 2 are the coverage, and they need eyes.
