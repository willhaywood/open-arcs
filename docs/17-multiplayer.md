# Arcs Digital — Multiplayer options

A brainstorm, not a decision. Ordered by effort, with the honest problem stated up front.

## 1. Why this is easier than it looks

Three properties the engine already has do most of the work:

- **A game *is* its journal.** `{ version, options, journal }` — an ordered list of compact
  action strings (docs/11). Replaying it reproduces state byte for byte. A server never needs to
  store or understand game state; it stores **an append-only list of strings**.
- **The journal is tiny.** Entries average 49 characters. A 300-action game is about **14 KB** of
  JSON — the whole game, not a delta.
- **Turns are strictly sequential.** `state.current` names the one faction that may act. Nothing
  simultaneous exists in the base game — `multiAsk` is a placeholder that nothing emits. So there
  is no concurrent input to reconcile, no conflict resolution, no lockstep. Just "is it your turn".

Put together: multiplayer is *append a string to a list, tell the others*. That is the whole
mechanic.

## 2. The honest problem: hidden information

**Every client that can replay the game can see everything, including the future.**

All randomness comes from `options.seed`, carried in state and advanced deterministically. A
client needs `options` to replay the journal — so any client can compute **every hand and every
future die roll and shuffle**. Not just "peek at hands": you could check what you are about to roll
before deciding whether to battle.

This is a known boundary, not a discovery — `observe.ts` says so in its own header:

> Phase 1 models little hidden information, but the boundary exists and already redacts one real
> leak: the RNG seed. A bot holding the seed can predict every future die roll.

`observe(state, faction)` already exists and returns an `ObservedState` that omits `rng` and
`journal`. It was built for the AI (docs/03) and is currently used only in tests. It is the right
place to build a player view — though note it currently omits `cards` entirely, so it would need
*widening* to include your own hand, not just narrowing.

**Two honest positions:**

- **Trust the table.** You are playing with friends. Tabletop Simulator has the same property and
  nobody minds. Say so in the UI and move on. This is what makes v1 a weekend rather than a month.
- **Don't trust the table.** Needs section 5.

Pick deliberately. Everything in sections 3–4 assumes the first.

## 3. The GUID link, concretely

Two ids, and they do different jobs:

```
gameId    a GUID  — which game. Unlisted; anyone with it can watch.
seatToken a GUID  — which player you are. Secret; proves you may act as that faction.
```

**Simplest shape — one link per player.** At creation the server mints one game and N seats and
hands back N links. You send each friend theirs:

```
https://arcs.example/#/g/3f2a…/s/9c81…      ← red's link
https://arcs.example/#/g/3f2a…/s/be40…      ← yellow's link
```

No accounts, no email, no login. The link *is* the credential. Paste it in the group chat and
everyone is in. Losing the link is the failure mode, so the app should stash it in `localStorage`
on first visit and offer "copy my link".

A spectator link is then just the game without a seat: `#/g/3f2a…`.

**Alternative — one join link, claim a seat.** Everyone gets the same URL and takes the first free
faction. Fewer links to distribute, but you need to handle two people claiming at once and a
cleared cache locking someone out. Per-player links avoid both. Start there.

## 4. Option 1 — shared journal, dumb server *(the recommended v1)*

The server never runs the engine. Its entire API:

```
POST /games                     -> { gameId, seats: [{ faction, seatToken }] }
GET  /games/:id                 -> { options, journal }            # or ?since=N for the tail
POST /games/:id/actions         -> appends one action
     { seatToken, expectedLength, action }
```

The one piece of logic that matters is the append:

1. Look up the game.
2. Reject unless `expectedLength === journal.length` — optimistic concurrency, and it makes a
   double-tap or a stale tab a no-op instead of a duplicated action.
3. Reject unless the seat's faction is the one allowed to act.
4. Append the string. Notify subscribers.

Step 3 is the only rule the server needs to know, and even that is optional in v1 — with sequential
turns, a client simply cannot produce a legal action out of turn.

**Sync:** poll `GET ?since=N` every 2–3 seconds and replay the tail. For a game where a turn takes
a minute, polling is completely adequate and is a fraction of the code of a socket. Upgrade to
SSE or WebSockets later if it feels sluggish.

**Where to run it**

| | Fit | Why |
| --- | --- | --- |
| **Cloudflare Workers + Durable Objects** | **Best** | One Durable Object *per game* is exactly this shape: single-threaded per game, so the compare-and-set is free, and it holds the journal in memory with storage behind it. Pairs with Cloudflare Pages, which docs/16 already recommends. |
| **Supabase** | Very good | A `games` table with `journal jsonb[]`, plus Realtime for push. Least code of all — possibly no server code at all, just RLS policies. |
| Cloudflare Workers + D1/KV | Fine | Needs the compare-and-set done by hand. |
| Firebase | Fine | Same shape as Supabase. |
| Node + SQLite on a VPS | Most control | Also the most ops. Only if you want the box for other reasons. |

**Effort:** a weekend. The client change is small — `store.ts` already funnels everything through
`applyExternal`, so "also POST it" and "replay tail on poll" are two hooks in one file.

## 5. Option 2 — server-authoritative *(if you don't trust the table)*

The server runs the engine — it can, the engine is pure TypeScript with no I/O and the same
package runs in a Worker.

- The **seed never leaves the server**. Clients receive a view, not the options.
- Randomness enters the journal as **outcomes appended by the server**, not values derived from a
  shared seed. This is the real engine change: `battle/roll` currently computes dice from
  `state.rng`, so it would have to carry its result instead.
- Each client is sent `observe(state, myFaction)`, widened to include its own hand.

The engine's determinism survives this — an action carrying its dice replays exactly as well as one
that derives them. But it is a substantially bigger job than option 1, and it touches battle, the
court shuffle and the draft.

**Do this only if you actually want competitive play with strangers.** For friends it is cost with
no benefit.

## 6. Option 0 — do nothing *(available today)*

Save → send the JSON → they Load → play their turn → send it back. Play-by-email, works right now,
zero infrastructure. For a game this slow it is not as silly as it sounds, and it is a genuine
fallback if a server ever goes down.

## 6a. Bots alongside humans

Fully in **docs/03 section 9a**, written after this document. The short version:

- A bot seat needs no new machinery — the journal records actions, not who chose them, so a bot's
  game replays as a human's would.
- **Whichever client notices it is a bot's turn computes and posts.** That keeps the server dumb,
  and the `expectedLength` check in section 4 already makes two clients racing harmless.
- The price is that **the bot must be deterministic** given observed state and a journal-derived
  seed, or two clients disagree and the game forks by who posted first. Free for a v1 evaluator;
  a real constraint on v2 rollouts.

## 7. Things to decide that aren't the transport

- **Undo becomes a negotiation.** Today undo replays the journal minus its last entry. In
  multiplayer that could rewind someone else's turn. Simplest rule: you may undo only your own
  actions, and only until the next player acts. The server enforces it by refusing to truncate
  past another seat's entry.
- **Disconnects just block.** With sequential turns, an absent player stalls the game rather than
  corrupting it. Show whose turn it is and how long it has been; add a nudge later.
- **The hotseat mode should stay.** It is how the game is tested and the fastest way to try a rule.
  Multiplayer is a second mode, not a replacement.
- **Spectators are free.** A game link without a seat token already gives a read-only replay.

## 8. Suggested path

1. **Option 1 on Cloudflare Durable Objects**, per-player GUID links, 2-second polling, trusting
   the table — with a line in the UI saying the client can see everything, so nobody is misled.
2. Swap polling for push if it feels slow.
3. Revisit option 2 only if the game leaves the circle of people you know.
