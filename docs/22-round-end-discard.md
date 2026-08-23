# 22. Played cards, the discard pile, and the Unions

A playtest report — "the Union cards let me take a card from any hand at any time" — that turned
out to sit on a missing **base** rule rather than a court-card bug. Recorded here because the fix
touched the card flow of every round and re-dealt every recorded game.

## What was wrong

1. **Played cards were never discarded.** Rules Library §5.4.1: "Discard all played action cards,
   and any action card used to seize the initiative, into the action discard pile on the map face
   down." `performEndRound` never touched the played piles, so `CardLocation.played(f)` held every
   card a player had played since the chapter began, returning to the deck only at the next
   chapter. Two consequences: a Union could take any card anyone had played in any earlier round
   of the chapter (the report), and the action discard pile was nearly empty all chapter — only
   seize-discards and Farseers' discards ever reached it — so the docs/20 fixes that draw from
   the discard's bottom (Farseers, Call to Action) were drawing from a pile the real game keeps
   full.
2. **A pass did not end the round.** §5.1.2: passing hands the initiative on "then immediately
   end[s] the round". `performPass` restarted the lead directly, skipping both the discard above
   and the Unions' "when the round ends" delivery.
3. **Face-down Copies were targetable.** The Unions read "a **face-up** played X card"; §5.2.2:
   "Copy. Play any action card face down." The offer read the played pile alone, never the play
   record that already said how each card was played.
4. **The chapter's undealt cards stayed in the deck.** Setup and chapter reset: "Discard all
   action cards not in players' hands into the action discard pile on the map face down, then
   shuffle it." Nothing ever drew from the deck remainder; the discard's bottom should have been
   those cards from the chapter's first turn.

The docs/20 Union audit (B1) caught the *delivery* timing but took "played" at face value; the
staleness of the played pile is the base-rule gap underneath it.

## The fix

- `endRoundHousekeeping` (rules/turn.ts): discard every faction's played pile, then deliver the
  Unions' pending cards. Called from `performEndRound` and from `performPass`.
- The Union offer (prelude.ts) requires a `roundPlays` entry for the card that is not a `copy`.
- `performStartChapter` moves the shuffled remainder to the discard after dealing; the 2-player
  mulligan now shuffles and redraws from that pile, since the deck is empty.
- **The chapter reshuffle runs from the deck's canonical order** (`deckFor`), not from the
  order the cards arrived in. A Fisher-Yates over the arrival order meant a change to *which pile*
  a card sat in — a refactor, not a rule — re-dealt every later chapter for the same seed and broke
  every recorded journal. Chapter 1 is seeded in that order already, so first-chapter deals are
  byte-identical; from here on, pile refactors cannot move a deal.

## What moved, and was re-derived

Every chapter-2+ deal changed, and the reply-foresight's unseen pool now takes in each round's
discards (it treats the discard as hidden, which §22.8's face-down rule supports). Under the
rules-fix exception: the golden baseline re-recorded on all three seeds; the scenario journals
under `saves/lore` rebuilt with `npm run saves:build` and the two under `saves/vox` re-swept; the
rival-intent, search-v4 and hand-quality sweep pins re-found (each test's docstring names its new
step and shape); the search-rounds oracle pin re-adjudicated.
