# The Court Audit — every base-court card against text, rulings and HRF

Date: 2026-08-19. Trigger: the Cartel finding (docs/13, PR #27) was the third rules bug caught by
checking a card against its printed text, and all three shared one failure shape — the engine and
its HRF reading agreeing with each other while the card said otherwise. This audit swept all 31
base-court cards systematically.

## Authorities

1. **Printed text**: ArcsDB transcriptions (arcs-db.fly.dev/core/court), pulled per card.
2. **Official rulings**: the Buried Giant studio's card data (`buriedgiantstudios/cards` on GitHub
   — `content/faq/arcs/en-US.yml`), the machine-readable source behind the card-library site.
3. **Interaction rules**: the Buried Giant Rules Library (rules.buriedgiant.com).
4. **HRF** (haunt-roll-fail): cross-check only — the Cartel lesson is that HRF readings mislead.

The verbatim card texts as pulled are the audit's fixture; where a transcription looked garbled it
is noted rather than trusted.

## Findings — defects

Severity **A** = changes game outcomes; **B** = observable divergence, limited reach.

### A1. Gatekeepers (bc08) — the gate-battle dice bonus is missing
Card: "When you battle in a gate, you may collect 2 more dice." Engine: `offerGather`
(rules/battle.ts) has no Gatekeepers term — only the Prelude ships-at-gates clause is implemented.
A held Gatekeepers changes every gate battle's ceiling from `ships` to `ships + 2`; the engine
never offers those pools. Repro: secure bc08, battle in any gate with a full fleet — the menu caps
at ship count.

### A2. Mining Interest (bc02) / Shipping Interest (bc09) — the Build riders are missing
Cards: "Manufacture (Build): Gain 1 Material." / "Synthesize (Build): Gain 1 Fuel." Engine: no
implementation anywhere (the Prelude fill-and-steal clause is correct, including stealing once the
supply empties). Every Build action taken while holding an Interest should bank a resource.

### A3. Farseers (bc17) — the Prelude is wrong three ways, and a whole clause is missing
Card: "When you declare an ambition, look at a Rival's hand. You may swap 1 card with them.
Prelude: You may discard this and any number of cards from your hand. Draw the same number of
cards (including Farseers) from the bottom of the action discard pile."
Engine (rules/turn.ts `case 'farseers'`): discards the **whole hand** (card says any number),
redraws from the **deck top** (card says bottom of the action discard), and draws hand-size
(card says +1, counting Farseers itself — **officially confirmed**: "discarded 2 cards plus
Farseers → draw 3"). The declare-time look-and-swap clause is absent entirely. The FAQ adds a
discard-order ruling (shuffle the discarded cards before placing) that matters once the source is
the discard's bottom.

### A4. Relic Fence (bc24) — a reusable engine implemented as a one-shot
Card: "Prelude: Once per turn, you may discard 1 resource to gain 1 Relic." The card never
discards itself. Engine: the guild-prelude `spent` helper (rules/turn.ts) moves the used card to
the court discard for *every* ability, Relic Fence included — so a permanent once-per-turn engine
costs the card. docs/13's claim that all thirteen Prelude abilities "share a cost — the card
itself" is wrong for this card. The once-per-turn limiter is also unimplemented (it was never
needed while the card burned itself).

### A5. Call to Action (bc31) — draws from the wrong pile
Card: "Draw 1 action card from the bottom of the action discard pile." Engine (rules/vox.ts
`callToAction`): draws the **deck top**. The difference is strategic — the discard's bottom is
knowable (oldest discard), the deck is random. Same family as Farseers' wrong source.

### B1. The four Unions (bc04/05/10/11) — collected immediately instead of at round end
Card: "When the round ends, draw that card into your hand." Official FAQ: "At the end of the
round, after all players have finished their turns." Engine (rules/turn.ts `take-played`): straight
to hand, with a comment arguing equivalence because the card cannot be replayed this round. The
argument misses three observables: the card can fund a seize-by-discard this round, it inflates
public hand counts, and a whole-hand effect (Farseers as implemented) would sweep it.

### B2. Sworn Guardians (bc22) — over-blocks
Card: "Rivals cannot steal your resources and **other** Guild cards. If this card is stolen, bury
it. (In battle, rivals can steal this card first before spending keys.)" Engine: the raid path
(rules/battle.ts:1051) returns early for a victim holding SG — nothing can be raided, **including
SG itself**, which the card explicitly permits (steal it first, then continue spending keys). The
Silver Tongues offer likewise skips SG holders entirely. And "bury it" (bottom of the court deck)
has no implementation on the steal path. Self-consistent, and wrong at the edge the card writes
out longhand.

## Findings — confirmed correct (with the citation that proves it)

| card(s) | verdict |
| --- | --- |
| Material/Fuel Cartel (bc03/06) | all three clauses correct post-#27; the "every scoring" timing decision is **officially confirmed** by the FAQ ("Do rivals discard even if Tycoon wasn't scored? Yes.") |
| the five Loyal cards (bc01/07/15/19/21) | outrage-keep (outrage.ts), spend-as + outrage-bypass (prelude.ts:150, mirroring HRF's `(r.is(X) && !outraged(X)) || hasGuild(LoyalX)` exactly); Loyal Marines' extra 3-ships Prelude present |
| Skirmishers (bc13) | reroll limited to `min(skirmish rolled, weaponReach)` — battle.ts:691 |
| Court Enforcers (bc14) | Abduct via `abductableSlots` (strictly-fewer rule), reach = tokens + Weapon-suit cards |
| Prison Wardens (bc12) | Pressgang and Execute both present (guild-actions.ts:153/162) |
| Elder Broker (bc23) | Trade on Tax (standard-actions.ts:2277); **not** blocked by Sworn Guardians, matching the FAQ ("Trade is not stealing") |
| Silver Tongues (bc20) | both steal modes (card and resource) offered |
| Secret Order (bc18) | Keeper/Empath declare without zeroing (ambitions.ts:337) |
| Lattice Spies (bc16) | burn-instead-of-card seize (turn.ts:545), discarded on use |
| Galactic Bards (bc25) | Surpass/Pivot declare with `usedThisTurn` limiter, no zero marker |
| Mass Uprising (bc26) | one-per-system reading, with a documented deliberate divergence *from HRF toward the card text* (vox.ts) — the direction this audit exists to enforce |
| Populist Demands (bc27), Outrage Spreads (bc28), Song of Freedom (bc29, bury + reshuffle), Guild Struggle (bc30, steal + discard-recycle), | vox.ts, each matching its text |
| Interests' Prelude (bc02/09) | fill-open-slots with steal-on-empty-supply — the *Prelude* half is right; only the Build riders (A2) are missing |

Card identity (suit/keys/loyal flags, court.ts) matches everywhere the transcriptions showed those
fields; ArcsDB's text views omit keys on some cards, so identity is spot-checked rather than
exhaustively confirmed.

## Official FAQ entries now on file

The audit corpus (studio FAQ YAML) carries base-court rulings for the four Unions, Elder Broker,
Farseers, both Cartels, Galactic Bards and Song of Freedom; the ones that bear on the engine are
cited inline above. Two worth recording for future work: Cartel-held supply "cannot be discarded
for Relic Fence or be stolen", and a played Union card "cannot be stolen once played but not
resolved".

## Triage

Suggested fix order, outcome-impact first: **A1 Gatekeepers**, **A4 Relic Fence**, **A2 Interest
Build riders**, **A3 Farseers** (largest, four sub-fixes), **A5 Call to Action**, then **B1
Unions** and **B2 Sworn Guardians**. Each is its own branch with the card text as its test's
docstring, per the Cartel precedent. The golden baseline will move for any fix the baseline games
touch — the documented rules-fix exception applies.
