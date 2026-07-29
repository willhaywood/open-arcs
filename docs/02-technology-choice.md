# Arcs Digital — Technology Choice

Status: **Locked.** TypeScript, Vite SPA, separate engine package, Hono server.
Date: 2026-07-22
Related: [01 — reference implementation](01-reference-implementation-hrf.md),
[03 — AI approach](03-ai-approach.md), [04 — scope and phasing](04-scope-and-phasing.md)

## 1. Why TypeScript

Considered: TypeScript, F#/Fable, Rust+WASM, staying on Scala.js, C#/Blazor.

The workload decides it. Four things this app actually does:

| Work | Cost |
| --- | --- |
| Replay a journal (2–5k actions through ~10 rule modules) | Tens of ms. Not a problem in any candidate |
| Render (~few hundred sprites, static between actions) | Trivial |
| Bot rollouts | The only real CPU sink — and it goes in a Worker |
| Ship ~20–40 MB of art | **The actual performance story** |

Since the engine is not the bottleneck, the choice comes down to porting friction and ecosystem.

**TypeScript wins on one decisive property: the same engine runs in the browser, in Node, and in
a Web Worker.** That gives us the headless arena for bot testing (see 03, section 7), Worker-based
rollouts, and the option of server-authoritative rules later — HRF has none, and its client is
fully trusted.

**F#/Fable was the serious alternative** and maps almost 1:1 onto Scala's sealed traits and case
classes, which would have made the port mechanical. Rejected for ecosystem size, tooling friction
and contributor pool, not on technical merit. Revisit only if the port stalls.

**Rust+WASM stays parked** until bot strength demands it. If it ever does, the boundary is already
obvious — keep state in WASM, pass journal action strings across.

**Blazor WASM rejected outright.** Tempting from a .NET seat, wrong here: startup payload and
canvas interop are both poor fits for a graphics-heavy board game.

### 1.1 The one real porting friction

Scala's case-class structural equality is load-bearing in HRF — the identity trackers use entities
as map keys. TypeScript has reference equality only.

The fix is already written for us: HRF's serializer canonicalizes every value object to a string,
which is also the journal encoding. Key maps by that and get interning and serialization from one
function.

```ts
const key = (f: Figure) => `${f.color}/${f.piece}/${f.index}`  // "red/Ship/3"
```

Exhaustiveness matters less than expected. The rule-module chain is *deliberately* non-exhaustive
— an unhandled action falls through to the next module — so Scala's sealed-match checking was not
doing much here either. Use a `never` assertion where a match genuinely should be total.

## 2. Why not Next.js

The game is one stateful client screen: a canvas, a rules engine in memory, and a panel of
buttons driven by whatever the engine asks. Next's core value is server rendering, and none of it
applies.

- **SSR/RSC buy nothing.** First paint is a canvas that cannot draw until assets load. Everything
  ends up `'use client'` with a hydration boundary to work around.
- **`next/image` is irrelevant.** Art goes through the Cache API into canvas draws, never `<img>`.
- **Routing is four routes** — landing, lobby, game, replay.
- **Persistent connections don't suit the default serverless deploy**, so the server is a separate
  service regardless.

Next would be right if this were a content site with a game embedded. It isn't. Same objection
applies to Remix / React Router framework mode / TanStack Start.

If a marketing or rules-reference site is ever wanted, build it separately — Astro suits that far
better than either option.

## 3. The stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | **TypeScript**, `strict` + `noUncheckedIndexedAccess` | Section 1 |
| Build | **Vite** | ESM-native, fast HMR, near-zero config for an SPA |
| UI | **React + React Router** | Routing barely needed; React for ecosystem depth |
| Rendering | **Canvas 2D** | Section 5 |
| Engine | **Own package, zero deps, no DOM** | Section 4 |
| Bots | **Web Worker** | Removes HRF's cooperative-yielding machinery entirely |
| Server | **Hono on Node** | HRF needs ~330 lines; Web-standard, portable |
| Sync | **SSE** | "Journal gained an entry" is one-directional |
| Persistence | **SQLite** | The journal is append-only text |
| Tests | **Vitest** | |
| Workspace | **npm workspaces** | See note below |

**Workspace deviation (2026-07-22):** this document originally specified pnpm. pnpm is not
installed on the dev machine and npm is, so the scaffold uses npm workspaces rather than modifying
the global toolchain. The one pnpm advantage that mattered here — strict `node_modules` preventing
the engine from accidentally importing a hoisted dependency — is covered instead by the engine's
`lib: ["ES2022"]` / `types: []` config and an empty `dependencies` block, both verified by the
typecheck. Switching later is `corepack enable pnpm` plus a lockfile regeneration.

## 4. Repo layout

```
packages/
  engine/          # rules, state, serialization. Zero deps. No DOM. The crown jewel.
  bots/            # policy + value functions, rollout driver. Depends on engine only.
  assets/          # asset manifest + loader + build-time image pipeline
apps/
  web/             # Vite + React SPA
  server/          # Hono + SQLite journal service
  arena/           # headless bot-vs-bot harness (Node)
```

### 4.1 The engine package contract

Non-negotiable, because everything else depends on it:

- **Zero runtime dependencies.**
- **`tsconfig` `lib: ["ES2022"]` with no `"DOM"`.** Reaching for a browser API becomes a compile
  error rather than a subtle coupling discovered when the arena won't run.
- **No global randomness.** RNG is seeded and carried in state — required by both the journal
  design and rollouts.
- **Immutable state with structural sharing.** The single biggest divergence from HRF, and the
  thing that makes bot lookahead and undo cheap. HRF's hand-maintained `cloned()` is a standing
  bug source; a forgotten field is a silent error.
- **Pure**: `(state, action) => Continue`. No I/O, no logging side effects, no clock.

**Correction (2026-07-22):** an earlier draft of this section recommended both "zero runtime
dependencies" and "Immer for developer velocity". Those contradict — Immer is a runtime
dependency. Resolved in favour of **zero dependencies**: state updates use plain spread-copy
structural sharing.

The trackers copy a `Map` of a few hundred entries per move, which is microseconds and irrelevant
at phase-1 scale. If the arena later shows cloning is hot under rollouts, the escape hatch is a
persistent map behind the existing `Tracker` interface — no call-site changes. Measure before
reaching for it.

The structural constraints from [04](04-scope-and-phasing.md) — `Color` distinct from `Faction`,
the rule-module chain living in game state, open location unions, a multi-ask variant in
`Continue` — are all engine-package concerns and apply from the first commit.

## 5. Rendering

**Canvas 2D, not PixiJS.** The scene is static between actions, redrawn only on state change or
pan/zoom, so WebGL batching buys nothing. Revisit only if tweened piece movement becomes a design
goal.

Two techniques worth lifting directly from HRF:

- **Colour-indexed region bitmap** for map hit-testing. A lossless image with a flat unique RGB
  per system; read the pixel under the cursor via `getImageData` on an offscreen canvas and map it
  back to a system. No polygon data. The same bitmap supplies random in-region points for piece
  placement.
- **Penalty-based piece placement.** Scatter ships within a system by sampling candidate positions
  and minimising overlap, keeping the previous position when it is still acceptable so pieces do
  not jitter between renders.

## 6. State management — there isn't any

**The engine is the store.** Wire it to React with a single `useSyncExternalStore` and let the
engine's current `Ask(faction, actions)` drive the render. The UI holds no rules knowledge; it
renders a list of offered actions.

Introducing Redux or similar for game state would create a second source of truth beside the one
that already exists. Zustand is fine for UI preferences (difficulty selection, board settings,
pane layout) — that is genuinely separate state.

## 7. Server

Deliberately dumb, following HRF: append-only journal entries plus access control. Tables are
users, journals, entries `(journalId, index, userId, text)`, access rights.

Phase 1 is local/hotseat and needs no server at all. When multiplayer lands:

- **SSE over WebSockets** — clients need "the journal grew", which is one-directional.
- **SQLite first.** Postgres only when multi-instance hosting demands it.
- **Server-side rules validation is optional but available**, because the engine runs in Node.
  HRF cannot do this. Decide when multiplayer is actually built.

## 8. Asset pipeline — where the performance actually is

Roughly 910 assets in HRF's manifest; the map alone is 605 KB. This dominates perceived
performance far more than any framework choice.

- **Sharp** at build time, replacing HRF's ImageMagick script.
- **AVIF for large art** (map, cards) — but tune quality carefully, since card faces carry text
  and AVIF smears text at aggressive settings. **Lossless WebP or atlas entries for small icons
  and figures**, which is the conclusion HRF reached independently.
- **Sprite-atlas the ~200 small images** (icons, figures, resource tokens) into one request. Cards
  stay individual and lazy — they are large and mostly unseen in a given game.
- **Three-tier laziness**, copying HRF: immediate / later / on-demand per asset.
- **Conditional manifest entries** so phase 1 never downloads campaign art (see
  [04](04-scope-and-phasing.md), section 3).
- **Service worker, cache-first** on the asset prefix; content-hashed filenames with immutable
  cache headers.

## 9. Testing

The architecture hands us a strong test story nearly free:

- **Golden replay tests.** A save is a journal, so a test is "replay this file, assert the final
  state hash". Rules regressions surface immediately.
- **Determinism as a property test.** Same seed and same journal must produce an identical state
  hash.
- **Headless arena** (`apps/arena`) for bot strength — see [03](03-ai-approach.md), section 7.
- **Unit tests** on the engine package, which needs no DOM and no mocking.

## 10. Deployment

- **Web**: static build on any CDN — Cloudflare Pages, Netlify, S3.
- **Assets**: CDN with immutable headers, content-hashed.
- **Server**: small container (Fly.io, Railway) or Cloudflare Workers, since Hono is Web-standard.
- Phase 1 needs only the first two.
