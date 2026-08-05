# Arcs Digital — Multiplayer options

Ordered by effort, with the honest problem stated up front.

**Decided so far:** option 1 (shared journal, dumb server) on Cloudflare Durable Objects, written
behind a four-method store interface so a move to a small Node + Postgres box stays a swap rather
than a rewrite. Section 4b is the contract that keeps that true; sections 1-3 and 5-7 are still a
brainstorm.

## 1. Why this is easier than it looks

Three properties the engine already has do most of the work:

- **A game *is* its journal.** `{ version, options, journal }` — an ordered list of compact
  action strings (docs/11). Replaying it reproduces state byte for byte. A server never needs to
  store or understand game state; it stores **an append-only list of strings**.
- **The journal is small.** Measured on a real 466-action game: entries average **136 characters**
  and the whole game is **73 KB** of compact JSON — the whole game, not a delta. (This entry
  previously said 49 characters and 14 KB, which was roughly a third of the truth. The conclusion
  survives comfortably; the figure did not.)
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
`journal`. It is the right place to build a player view, and **two things this entry used to say
about it are no longer true**:

- It is not "used only in tests". It is core to the AI and reaches production through `store.ts`
  and `Board.tsx`.
- It no longer "omits `cards` entirely, so it would need *widening*". `ObservedState` now carries
  `hand` — your own card ids, never anyone else's — plus public `handSizes`. **That widening was
  the work option 2 was costed against, and it is already done**, which makes section 5 materially
  cheaper than it reads.

**Two honest positions:**

- **Trust the table.** You are playing with friends. Tabletop Simulator has the same property and
  nobody minds. Say so in the UI and move on. This is what makes v1 a weekend rather than a month.
- **Don't trust the table.** Needs section 5.

Pick deliberately. Everything in sections 3–4 assumes the first.

### 2a. What the seat boundary actually enforces

"Trust the table" was chosen, and then implemented — but the two halves of it are enforced very
differently, and conflating them would be the way to believe something false about this system.

| | Holds against | Where |
| --- | --- | --- |
| **Acting as another faction** | a tampered client | server: `actorOf` reads the `faction` off the encoded action and refuses a seat that does not match |
| **Seeing another hand** | a mis-click, a shoulder | client: `Hand` renders your own seat's cards, never the current player's |
| **Seeing future dice** | nothing | not addressed — every client holds the seed |

**Only the first row is a guarantee.** The server check needs no engine: an encoded action carries
`faction="…"`, so refusing a forgery is an identity check on a string, not a rules check. Whose turn
it is is still not checked, and still would need the engine — the distinction is drawn in `store.ts`.

The second row is hygiene, not security. It closes the leak that mattered in practice — every client
was rendering *whoever was currently being asked*, so on blue's turn red's browser showed blue's
hand — but a player who opens devtools can still replay the journal and read everything, because
`options.seed` has to be in every client for replay to work at all. That is the boundary above, and
it is unchanged.

The third row is the one that would need section 5. Nothing about it got better.

**A note on the check being silent rather than strict.** The server stores an action whose faction it
cannot read, rather than refusing it. Refusing would couple the server to the engine's encoding —
rule 4 in the other direction — and buys nothing, because the engine routes on `faction` and an
action without one does not replay as a legal move for anybody. The duplication of the encoding rule
in `actorOf` is real, and is pinned by a test that runs it over thousands of actions from the actual
encoder rather than over hand-written strings.

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
| **Cloudflare Workers + Durable Objects** | **Best** | One Durable Object *per game* is exactly this shape: single-threaded per game, so the compare-and-set is free, and it holds the journal in memory with storage behind it. Serves the static client from the same Worker, so there is one origin and one deploy (4c). |
| **Supabase** | Very good | A `games` table with `journal jsonb[]`, plus Realtime for push. Least code of all — possibly no server code at all, just RLS policies. |
| Cloudflare Workers + D1/KV | Fine | Needs the compare-and-set done by hand. |
| Firebase | Fine | Same shape as Supabase. |
| Node + SQLite on a VPS | Most control | Also the most ops. Only if you want the box for other reasons. |

**Effort:** a weekend. The client change is small — `store.ts` already funnels everything through
`applyExternal`, so "also POST it" and "replay tail on poll" are two hooks in one file.

## 4a. What it costs

Prices checked **5 August 2026**, and both vendors change them — re-check before committing spend.
The workload below is measured from a real game, not assumed.

### The shape: you are buying requests, not bandwidth

A 466-action game is 73 KB of journal. Polling is what dominates — three players at one poll every
2.5 seconds over a three-hour game is **12,960 reads against 466 writes, a ratio of 28:1**. Because
`?since=N` returns only the tail, those reads are almost empty. **Request count is the bill;
bandwidth is a rounding error.**

That single fact decides most of what follows.

### Monthly cost, by scale

| games / month | Cloudflare (Workers + DO) | Supabase Pro |
| --- | --- | --- |
| 10 — friends | **$0** (free tier) | **$0** (free tier) |
| 500 — small community | **$5** | $25 |
| 5,000 — busy | $32 | **$25** |
| 50,000 — big | $309 | **$129** |

Rates used: Workers $5/mo with 10M requests then $0.30/M; Durable Objects 1M requests then $0.15/M
and 400k GB-s then $12.50/M (duration assumed at ~10 ms per request — **worth measuring rather than
trusting**). Supabase Pro $25/mo with 5M Realtime messages then $2.50/M.

### Free-tier headroom, and the ceiling that actually bites

- **Cloudflare free**: 100k requests/day — about **7 games/day**, ~223/month.
- **Supabase free**: 2M Realtime messages/month — about **2,145 games/month**, but only **200
  concurrent connections, so 66 simultaneous games**.
- **Supabase Pro**: 500 concurrent — **166 simultaneous games**, then $10 per 1000.

The concurrency cap is a harder limit than any per-unit rate, because it is about *peak* rather than
volume. A quiet month with one busy evening can hit it while every other number stays green.

### The biggest lever is not the vendor

**Swapping polling for push divides the request count by about ten**, at every scale — 6.7M requests
a month becomes 0.70M at 500 games; 67M becomes 7M at 5,000. That is why section 4 lists it as step
2 rather than a nicety: it moves the crossover between these two columns further out than choosing
either vendor does.

### Which to pick, and why price is the least of it

At the scale this project is, **both are free**, so the decision should be made on fit and on what
the next project needs.

- **Cloudflare** — one Durable Object *per game* is exactly this problem's shape: single-threaded
  per game, so the compare-and-set in section 4 is free rather than something to engineer. docs/16
  already points at Cloudflare for the static site, and a Worker can serve that itself — so the
  whole thing lands in one account, one origin, one deploy. The bet is on edge compute and
  stateless APIs.
- **Supabase** — Postgres plus auth, storage, Realtime and edge functions: a general-purpose
  backend. If future projects need **accounts, user data or relational queries**, this is the
  stronger foundation, and paying $25 buys something this project alone does not need.

**Lock-in matters more than the money here.** Durable Objects are a proprietary primitive with no
direct equivalent elsewhere — though the pattern in section 4 is roughly fifty lines and portable by
hand. Supabase is Postgres underneath and self-hostable, so leaving is a migration rather than a
rewrite; only Realtime is really Supabase-shaped.

## 4b. Decision, and the portability contract

**Cloudflare Durable Objects for v1** (section 4a has the reasoning: it is free at this scale, one
object per game is exactly the shape, and docs/16 already points at Cloudflare).

**And it must stay possible to move to a small Node + Postgres box without a redesign.** That is a
constraint on how the server is written, not a promise to write it twice — so this section states
what has to hold. If a future change breaks one of these rules, the pivot stops being a swap and
becomes a rewrite.

### What actually creates lock-in — and what does not

Durable Objects give exactly **one** thing that is hard to reproduce: they are single-threaded per
object, so the compare-and-set in section 4 is free. Everything else — routing, storage, even push —
has a plain equivalent.

| Concern | Cloudflare | Node + Postgres |
| --- | --- | --- |
| Compare-and-set on append | Free: the object is single-threaded | `UPDATE … WHERE array_length(journal,1) = $expected`, then check the row count |
| Push to other players | WebSocket or SSE from the object | `LISTEN`/`NOTIFY`, payload "game X is at length N" |
| Storage | DO storage | a `games` table |
| Fan-out | The object holds its own subscribers | Postgres delivers to every listening session |

Postgres's `NOTIFY` is worth knowing precisely because it is *better* than the in-memory version:
it fires **only on commit**, so a rolled-back append can never notify anyone. Payloads cap at 8000
bytes, which is irrelevant here — the notification carries a length, and the client fetches the tail.

### The five rules

1. **The journal is the only thing persisted.** A list of strings plus `options`. The moment the
   server stores derived state — a cached board, a materialised score — portability is gone, because
   that state has to be rebuilt identically on the other side. It also is not needed: replay is the
   design (docs/11).
2. **The HTTP surface in section 4 is the contract.** Three endpoints. Both platforms serve exactly
   those routes with exactly those semantics, so **the client cannot tell which is behind it** and
   is never part of the migration.
3. **`expectedLength` is passed explicitly and checked explicitly** — never left implicit in "the
   object is single-threaded". Free on Durable Objects and a `WHERE` clause on Postgres, but only if
   the check is written down rather than assumed.
4. **No Cloudflare types outside the adapter.** The store is an interface — roughly `create`,
   `readSince`, `append`, `subscribe` — and the Durable Object is one implementation of it. Nothing
   above that layer imports a Workers type.
5. **No DO-only primitives.** Alarms, WebSocket hibernation and the transactional storage API have
   no plain equivalent. If one of them ever looks necessary, that is the moment to decide
   deliberately rather than discover it during a migration.

### What the pivot then costs

A second implementation of a four-method interface, and a DNS change. The engine is untouched — it
is pure TypeScript with no I/O and already runs in both places. The client is untouched, because of
rule 2. That is the whole point of writing the rules down before the code exists rather than after.

## 4c. One Worker, one origin

The client and the API are deployed together, as a single Worker: `wrangler.toml` declares
`apps/web/dist` as its assets, and asset routing serves a file when the path matches one and falls
through to the Worker when it does not. `run_worker_first = ["/games", "/games/*"]` pins the API
routes so that fall-through is a guarantee rather than a coincidence.

The earlier assumption was two origins — a static host for the client, a Worker for the API — and
that assumption is what produced the CORS header, the preflight on every append, and
`VITE_MULTIPLAYER_URL`. Same-origin deletes all three rather than configuring around them:

- **No preflight.** A cross-origin `POST` with a JSON content-type costs an `OPTIONS` round trip
  before the real one. Every append paid it. Same-origin requests do not.
- **Nothing to configure.** The API base is the empty string, so there is no hostname baked into the
  bundle at build time and no second name to get wrong or to renew a certificate for.
- **One deploy.** The client and the server version together, so the protocol cannot skew between
  them — which for a design where every client replays the same journal is the failure that matters.

`access-control-allow-origin: *` stays on the API. It costs one header, it keeps the two-terminal
dev loop working (vite on 5173, Worker on 8787), and it keeps rule 2 honest: a Node deployment on a
separate host still serves the same contract. Nothing in production depends on it.

**This does not weaken the portability contract.** Assets are static file serving — the one
capability every host has. The Node + Postgres pivot in 4b serves `dist` from `express.static` or a
CDN in front of it, and rule 2 is untouched either way, because the client asks for `/games/...`
without an opinion about who answers.

### Unset, empty, and set

`VITE_MULTIPLAYER_URL` has three states, and the distinction that matters is unset versus empty:

| Value | Meaning | Where |
| --- | --- | --- |
| unset | multiplayer off; hotseat only | GitHub Pages |
| `""` | same origin | Cloudflare |
| an absolute URL | a server elsewhere | the two-terminal dev loop |

Vite folds this to a literal, so the check is on `typeof`, not on truthiness — the two off-looking
values mean opposite things. GitHub Pages is kept as a hotseat-only fallback rather than retired: it
has no server behind it and never will, but that is the entire game minus the links.

## 5. Option 2 — server-authoritative *(if you don't trust the table)*

The server runs the engine — it can, the engine is pure TypeScript with no I/O and the same
package runs in a Worker.

- The **seed never leaves the server**. Clients receive a view, not the options.
- Randomness enters the journal as **outcomes appended by the server**, not values derived from a
  shared seed. This is the real engine change: `battle/roll` currently computes dice from
  `state.rng`, so it would have to carry its result instead.
- Each client is sent `observe(state, myFaction)`. **This part is already built** — `ObservedState`
  carries `hand` and `handSizes` (see section 2), so the widening this entry once listed as work is
  done, and what remains is the randomness change alone.

The engine's determinism survives this — an action carrying its dice replays exactly as well as one
that derives them. Still a bigger job than option 1, and it touches battle, the court shuffle and
the draft — but a smaller one than it was, now that the player view exists.

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

1. **Option 1 on Cloudflare Durable Objects** — decided, see section 4b — with per-player GUID
   links, 2-second polling, and trusting the table, plus a line in the UI saying the client can see
   everything so nobody is misled. **Free at this scale** (section 4a): the free tier covers about 7
   games a day, and the paid plan is $5/month well beyond anything this project will see.
   Written behind the four-method store interface of section 4b from the first commit, because that
   is cheap now and a rewrite later.
2. **Swap polling for push** — and treat it as the real second step rather than a nicety. It divides
   request count by about ten at every scale, which moves the cost crossover further than picking a
   different vendor does.
3. Revisit option 2 only if the game leaves the circle of people you know. Cheaper than it was: the
   player view is built, so only the randomness change remains.

**Reconsider the vendor, not the design, if a future project needs accounts or stored user data.**
Nothing in sections 3-4 is Cloudflare-shaped — it is an append-only list with a compare-and-set, and
Supabase does the same job in roughly the same amount of code. Section 4a has the comparison.
