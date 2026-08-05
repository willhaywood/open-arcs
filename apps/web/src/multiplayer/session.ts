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

  /** Load the game from the server and start polling. */
  async join(): Promise<void> {
    await this.resync()
    this.timer = setInterval(() => {
      void this.poll()
    }, POLL_MS)
  }

  leave(): void {
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
    const tail = await this.client.read(this.link.gameId, 0)
    const options = tail.options as NewGameOptions
    this.options = options
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
