/**
 * A joined game: publishes what you do, and replays what everyone else did.
 *
 * docs/17 section 4 calls this "two hooks in one file" — post it, and replay the tail on poll. The
 * only real decision is what happens when those two disagree.
 *
 * ## Optimistic, with replay as the fix
 *
 * A move is applied locally **immediately** and published in the background, rather than waiting for
 * the round trip. The alternative — post first, apply on success — is simpler to reason about but
 * puts a network hop between clicking a card and seeing it move, on every single action.
 *
 * Optimism normally costs you rollback machinery. It does not here, and that is the journal design
 * paying off (docs/11): when the server says someone got there first, there is nothing to unwind
 * because the authoritative journal can simply be **replayed**. `resync` throws away local state and
 * rebuilds from `{ options, journal }`, which reproduces the game byte for byte. A 466-action game
 * replays in about 23 ms at the engine's measured 0.049 ms per action, so the expensive-sounding
 * option is the cheap one.
 *
 * Conflicts are rare regardless: turns are strictly sequential, so the realistic causes are a
 * double-tap and a stale tab rather than genuine contention.
 *
 * ## What it does not do
 *
 * It does not check whose turn it is. The engine already will not offer an action to a seat that may
 * not take it, and the server deliberately does not know the rules (docs/17 section 4). What it does
 * check is that this client *holds a seat* — a spectator publishes nothing.
 */

import { decodeAction, encodeAction, replayGame } from '@arcs/engine'
import type { Action, NewGameOptions, RuleResult } from '@arcs/engine'

import { MultiplayerClient } from './client.js'
import type { GameLink } from './link.js'

/** How often to ask for the tail. docs/17 section 4: adequate for a game where a turn takes a minute. */
export const POLL_MS = 2500

/**
 * How long to wait before trying the socket again after it drops.
 *
 * Longer than a poll on purpose: while it is down the game is still working over HTTP, so there is
 * nothing to rush, and a tight reconnect loop against an origin that is refusing sockets would cost
 * more than the polling it is trying to escape.
 */
export const RETRY_MS = 5000

export interface SessionHost {
  /** The game as this client currently has it, or `null` before it has loaded. */
  current(): RuleResult | null
  /** Replace the game wholesale — used by the initial load and by `resync`. */
  adopt(options: NewGameOptions, result: RuleResult): void
  /** Apply one action that arrived from elsewhere. Must not re-publish it. */
  applyRemote(action: Action): void
}

export class Session {
  private readonly client: MultiplayerClient
  private timer: ReturnType<typeof setInterval> | null = null
  private options: NewGameOptions | null = null
  /** Guards against a poll overlapping itself on a slow connection. */
  private busy = false
  /**
   * Which faction this client's seat token belongs to, as told by the server on join.
   *
   * `null` until the first read completes, and for a spectator. Only the server can answer this —
   * a seat token is opaque — and it is what lets the UI say who you are, hide rivals' hands and
   * refuse to act for anyone else.
   */
  private seatFaction: string | null = null
  /** The live socket, or `null` while falling back to polling. */
  private socket: WebSocket | null = null
  private retry: ReturnType<typeof setTimeout> | null = null

  constructor(
    baseUrl: string,
    readonly link: GameLink,
    private readonly host: SessionHost,
  ) {
    this.client = new MultiplayerClient(baseUrl)
  }

  get isSpectator(): boolean {
    return this.link.seatToken === undefined
  }

  /** Which faction you are, or `null` if you are watching (or have not loaded yet). */
  get faction(): string | null {
    return this.seatFaction
  }

  /** Load the game, then listen for what everyone else does. */
  async join(): Promise<void> {
    await this.resync()
    this.openSocket()
  }

  leave(): void {
    this.stopPolling()
    if (this.retry !== null) clearTimeout(this.retry)
    this.retry = null
    const ws = this.socket
    this.socket = null
    try {
      ws?.close()
    } catch {
      /* already gone */
    }
  }

  // --- push -----------------------------------------------------------------

  /**
   * Open the live socket, and fall back to polling if it will not.
   *
   * Failure is not exceptional: a proxy that blocks WebSockets, an origin that has not deployed the
   * route, a `WebSocket` that does not exist in whatever is running this. Every one of those ends in
   * `onclose`, and every one of them is survivable — polling is slower and dearer, not broken. The
   * game must never depend on the socket, which is why `poll` stays.
   */
  private openSocket(): void {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') {
      this.startPolling()
      return
    }
    let ws: WebSocket
    try {
      ws = new WebSocket(this.client.liveUrl(this.link.gameId, location.href))
    } catch {
      this.startPolling()
      return
    }
    this.socket = ws

    ws.onopen = () => {
      if (this.socket !== ws) return
      /*
       * One catch-up read, then stop paying for the timer. This covers the gap between the join
       * read and the socket being live, and — on a reconnect — everything missed while it was down.
       */
      void this.poll().then(() => {
        if (this.socket === ws) this.stopPolling()
      })
    }
    ws.onmessage = (event: MessageEvent) => {
      if (this.socket === ws) this.applyPush(String(event.data))
    }
    ws.onclose = () => {
      if (this.socket !== ws) return
      this.socket = null
      /*
       * Keep the game working first, then try to get the cheap path back. A blip on a three-hour
       * game should not cost the socket for the rest of it, and a reopen that succeeds stops the
       * polling again in `onopen`.
       */
      this.startPolling()
      this.retry = setTimeout(() => this.openSocket(), RETRY_MS)
    }
  }

  /**
   * Apply what the server pushed.
   *
   * The payload is `{ from, entries }` — the entries themselves, not a nudge to go and fetch them,
   * which would put an HTTP request back on every action and give away most of the saving.
   *
   * `from` is what makes it safe to apply blind. Three cases, and the middle one is the common one:
   * a gap means something was missed and replay is the only honest answer; entries we already hold
   * are our own move coming back, since publishing is optimistic and applied locally first.
   */
  private applyPush(raw: string): void {
    let push: { from?: unknown; entries?: unknown }
    try {
      push = JSON.parse(raw) as { from?: unknown; entries?: unknown }
    } catch {
      return
    }
    const from = push.from
    const entries = push.entries
    if (typeof from !== 'number' || !Array.isArray(entries)) return

    const have = this.host.current()?.state.journal.length ?? 0
    if (from > have) {
      void this.resync()
      return
    }
    const already = have - from
    if (already >= entries.length) return
    for (const entry of entries.slice(already)) {
      this.host.applyRemote(decodeAction(String(entry)))
    }
  }

  private startPolling(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.poll()
    }, POLL_MS)
  }

  private stopPolling(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * Rebuild from the authoritative journal.
   *
   * The whole recovery story, and the reason optimism is affordable. Used on join, and whenever a
   * publish conflicts — replay is exact, so there is no partial state to reconcile.
   */
  async resync(): Promise<void> {
    const tail = await this.client.read(this.link.gameId, 0, this.link.seatToken)
    const options = tail.options as NewGameOptions
    this.options = options
    this.seatFaction = tail.yourFaction ?? null
    this.host.adopt(options, replayGame(options, [...tail.entries]))
  }

  /** Ask for anything new and apply it. Called on a timer; safe to call by hand. */
  async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const have = this.host.current()?.state.journal.length ?? 0
      const tail = await this.client.read(this.link.gameId, have)
      /*
       * Shorter than we are is not possible on an append-only list, so it means we are looking at a
       * different game than we think — a reset, or a bug. Replay rather than guess.
       */
      if (tail.length < have) {
        await this.resync()
        return
      }
      for (const entry of tail.entries) this.host.applyRemote(decodeAction(entry))
    } finally {
      this.busy = false
    }
  }

  /**
   * Publish a move already applied locally.
   *
   * `expectedLength` is the journal length **before** the action, which is what makes a double-tap a
   * no-op server-side. Deliberately not awaited by callers: the move is already on screen, and the
   * only outcome that needs handling is a conflict, which resolves itself by replaying.
   */
  async publish(action: Action, expectedLength: number): Promise<void> {
    if (this.link.seatToken === undefined) return
    const outcome = await this.client.append(
      this.link.gameId,
      this.link.seatToken,
      expectedLength,
      encodeAction(action),
    )
    if (!outcome.ok) await this.resync()
  }
}
