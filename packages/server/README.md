# @arcs/server — multiplayer

Three endpoints over a four-method store. docs/17 section 4 is the design, section 4b the
portability contract, section 4a the costing.

The server **never runs the engine**. A journal entry is a string and `options` is opaque JSON it
stores and hands back, which is what keeps it a few hundred lines rather than a second copy of the
rules — and means the engine can change without redeploying it.

## Running it

Most work needs no Cloudflare tooling at all, which is deliberate: if the everyday loop required
`wrangler dev`, platform assumptions would leak into `api.ts` within a week because all the friction
would point that way.

```bash
npm test -- packages/server      # the contract, both implementations, milliseconds
npm run serve                    # wrangler dev on real workerd, port 8787
```

`wrangler dev` runs **locally** on `workerd` — the same runtime as production, not a simulation of
it. No Cloudflare account, no cloud dev environment, nothing to keep in sync. `--remote` exists for
genuinely network-specific behaviour and is much slower, since every change is an upload.

**Local Durable Object state persists between runs**, in `.wrangler/state` (gitignored). Worth
knowing because the docs imply otherwise: a game created before a restart is still there afterwards,
which is convenient when testing but means a stale journal can outlive the change that broke it.
Delete the directory to start clean.

## The endpoints

```
POST /games                  -> { gameId, seats: [{ faction, seatToken }] }
GET  /games/:id?since=N      -> { options, entries, length }
POST /games/:id/actions      -> { ok, length }
     { seatToken, expectedLength, action }
```

Verified end to end against `wrangler dev`:

```bash
GAME=$(curl -s -X POST localhost:8787/games -H 'content-type: application/json' \
  -d '{"options":{"seed":42},"factions":["red","yellow","blue"]}')
# -> {"gameId":"424a…","seats":[{"faction":"red","seatToken":"5a03…"}, …]}

curl -s -X POST localhost:8787/games/$ID/actions -H 'content-type: application/json' \
  -d '{"seatToken":"'$RED'","expectedLength":0,"action":"turn/lead(card=\"Mobilization-4\")"}'
# -> {"ok":true,"length":1}

# the same request again — a double-tap, a retried fetch, a stale tab
# -> {"error":"conflict","length":1}      409, and nothing was appended twice
```

## Two things that look like bugs and are not

**Turn order is not enforced.** Appending out of turn returns 200. Checking would mean running the
engine here, and turns are strictly sequential so a client cannot produce a *legal* action out of
turn — an illegal one fails on every client's replay rather than corrupting the journal. There is a
test pinning this so nobody fixes it.

**`subscribe` is unimplemented on Cloudflare.** v1 polls; push is step 2 (docs/17 section 8). A
Worker is stateless, so there is nowhere to keep a listener — the interface makes the method optional
rather than letting this path return a no-op that satisfies the type and fails the behaviour. When
push lands it belongs inside `GameObject`, which is stateful and already serialises every append.

## Layout, and why the boundary is a directory

```
src/store.ts          the GameStore interface — no platform types, no engine types
src/api.ts            the three endpoints, Request -> Response
src/memory.ts         in-memory store: tests, and local dev without Cloudflare
src/cloudflare/       everything platform-specific, and nothing else is
```

`tsconfig.json` sets `"types": []`, so there are no Node and no Cloudflare globals anywhere. A
Workers-only API outside `src/cloudflare/` is a compile error rather than something discovered during
a migration. `src/cloudflare/types.ts` hand-writes the platform surface — four interfaces, six
methods — so how much Cloudflare this depends on is visible in one file, and growing it is a
deliberate act.

## Deploying

```bash
npm run deploy --workspace @arcs/server
```

Needs a Cloudflare account and `wrangler login`. Not done yet.
