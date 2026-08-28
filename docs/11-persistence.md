# Arcs Digital — Undo, Save & Load

Status: implemented in the engine (`packages/engine/src/index.ts`) and wired into the UI
(`apps/web`). Verified in-browser and by 12 engine tests.
Date: 2026-07-23

## 1. One idea does all three

A game is its **options plus the ordered list of external (player-chosen) actions**. Because
the engine is deterministic — all randomness is the seeded RNG carried in state — replaying
that list from a fresh game reproduces the exact state, byte for byte. That single fact
gives undo, save and load with almost no new code. This is the journal design from docs 01
and 02 finally cashed in.

- **Undo** = replay the journal minus its last entry.
- **Save** = write out `{ version, options, journal }` as JSON.
- **Load** = read that back and replay it.

There is no separate serializer for game state, no snapshot stack, no reducer history. The
state is never serialized — only the tiny action list is.

## 2. Engine API

```ts
applyExternal(result, action, registry) -> RuleResult   // advance + record in journal
replayGame(options, journal, registry)  -> RuleResult   // rebuild from scratch
undo(options, result, registry)         -> RuleResult   // replay minus last entry
serializeGame(options, result)          -> string        // JSON save
loadGame(json, registry)   -> { options, result }        // parse + replay
```

`applyExternal` is the recording counterpart to `advance`: it runs the action and appends
its canonical encoding (`encodeAction`, which drops the UI-only `label`) to `state.journal`.
Everything the UI and the arena do goes through it, so the journal is always authoritative.
`startGame` leaves the journal empty — setup is internal, forced, and reconstructed on
replay rather than recorded.

Saves are versioned (`SAVE_VERSION`); `loadGame` rejects a wrong version or malformed JSON
with a clear message rather than replaying garbage.

## 3. Cost

Replay-per-undo is O(journal length) — a fresh game plus N action applications. At the
scale of a board game (a few hundred actions, ~microseconds each) this is imperceptible, and
it keeps the model dead simple: there is exactly one way to reach any state, so undo can
never diverge from normal play. A save is a few kilobytes — the test asserts under 8 KB for
a 30-move game, because it stores the journal, not the state.

If replay ever shows up as slow (it won't at this scale), the escape hatch is memoizing
snapshots every K actions and replaying only the tail — without changing the API.

## 4. UI

The store keeps the game `options`, drives the engine through `applyExternal`, and defers
undo/save/load to the engine functions above. The toolbar has **Undo** (disabled at the
start of a game), **Save** (downloads a JSON file), and **Load** (file picker; Load is also
offered on the new-game screen). A bad file surfaces the engine's error message in an alert.

## 5. Verified

Engine (`packages/engine/test/persistence.test.ts`, 12 tests):

- One journal entry per external action; `startGame` records none.
- **Golden replay**: replaying a 40-move game reproduces an identical figure digest, power
  map and log.
- Undo steps back exactly one action and lands on the prior state's digest and log; repeated
  undo walks all the way back to the start; undo at the start is a no-op.
- Save/load round-trips to an identical state; the save is under 8 KB; wrong version and
  malformed JSON are rejected; a loaded game continues identically to one never saved.

In-browser: led a card, pressed Undo, and returned to the exact lead menu with the log
reverted; Save downloaded a file with no error; the Load control is wired on both screens.

## 6. Not yet

- **Redo** — trivial to add (keep the truncated tail), not built.
- ~~**Autosave / localStorage**~~ — built (`apps/web/src/persist.ts`): every local mutation
  writes the save string to `localStorage` under `arcs:autosave`, boot restores it when the
  address bar carries no game link, and New game discards it. Local games only — a joined
  game is the server's to keep. localStorage over IndexedDB deliberately: universal support,
  a full game is under 100KB, and Safari's storage eviction hits both alike.
- **Undo across a full game with bots** — once bots drive some seats, "undo" needs to decide
  whether it steps back one decision or one full player turn. A product question for later.
