/**
 * V3: the card play chosen by searching the whole turn it buys.
 *
 * ## Why search, when docs/19 section 0 says search failed
 *
 * Every failed attempt in the register was a **sampled rollout**: play the position out under a
 * weak policy, several times, and average. The wall those hit — "no cheap, low-variance way to say
 * what one action is worth" — is a *variance* wall: a playout's answer is noisy, and the noise
 * swamped every effect being measured. A deterministic beam does not pay that tax. Every line is
 * this bot's own best play, judged by the same evaluator it decides with, and the only randomness
 * is the dice inside a line — handled the way probes already handle dice, by sampling under derived
 * generators and averaging.
 *
 * What the beam buys concretely is the retirement of `PIP_VALUE` at the decision it distorted
 * most. V1 scores a card at the moment the pips are *about* to be spent, plus 0.5 a pip — a flat
 * rate for actions whose worth runs from a wasted Move to a chapter-winning Build. The beam plays
 * the pips and scores what they actually bought. `turn/pass` needs no special case: it ends the
 * turn at depth one and scores the position after passing, which is exactly what it is worth.
 *
 * ## Where the budget goes
 *
 * Only the card-play ask is searched (`isCardPlay`, the same trigger V2 used): it is the
 * highest-weight decision in the game (section 2d.1), ~10 per seat per game, and everything
 * downstream V1 already resolves acceptably (section 2j). Delegated asks go to the V1 machinery
 * with the same weights, so this bot differs from `rivalBot` by exactly the search and nothing
 * else — the arena attribution rule, once more.
 *
 * ## Determinism
 *
 * Two clients running this bot on the same position must agree (docs/03 section 9a). Expansion
 * follows offer order, pruning is a stable sort, and ties keep the earliest candidate — V1's own
 * seedless tie-break, applied to lines instead of actions. No wall clock, no `Math.random()`.
 *
 * ## Horizon
 *
 * A line ends where the turn leaves this faction's hands: the ask passes to a rival, the game
 * ends, or the depth cap cuts it. A line reaching a rival's ask is scored there, reply unmodelled —
 * seeing the reply is Tier 2, deliberately not attempted here.
 */

import { feasibility } from './feasibility.js'
import { heuristicBotWith } from './heuristic.js'
import { refuses } from './heuristic.js'
import { STANDARD_WEIGHTS } from './goal.js'
import { intentFor } from './intent.js'
import { isCardPlay } from './rollout.js'
import { valueOf } from './value.js'
import type { Action } from '../action.js'
import type { ObservedState } from '../observe.js'
import type { Bot, BotDecision, Considered, Explore, Lookahead, PathProbe, Rollout } from './bot.js'
import type { RivalIntent } from './value.js'

export interface SearchOptions {
  /**
   * Lines kept alive per depth level, **per root**. The accuracy-against-cost dial.
   *
   * Per root, not shared, and the first version got this wrong in an instructive way. A single
   * beam pruned on *intermediate* value — and a just-led card is exactly the state `settle()`
   * exists to skip past: the card has left the hand and bought nothing yet, so it scores as pure
   * cost until its pips are spent. Five of seven roots were culled mid-flight before their pips
   * could justify them, and the bot chose Pass on turn one — the precise pathology section 2h
   * fixed in V1. Giving each root its own beam guarantees every candidate is judged at the settled
   * horizon; the width only decides how well each root's turn is played, never whether a root gets
   * to finish at all.
   */
  readonly width: number
  /** Longest line considered, in asks answered. A real turn is card + declare + prelude + pips. */
  readonly depth: number
  /**
   * Score rivals under their own intent while searching.
   *
   * **Off by default, because it was measured**: `rivalBot` came out level-to-slightly-behind
   * `standard` over two 999-game runs against a 1-point twin floor. The argument for it ("a search
   * that cannot see what a rival is winning optimises lines that hand them the game politely") was
   * plausible and did not survive contact with the arena — docs/19 section 0's recurring lesson.
   * The option stays so the combination can be measured on top of the search rather than assumed
   * either way.
   */
  readonly rivalIntent?: boolean
}

export const DEFAULT_SEARCH: SearchOptions = { width: 3, depth: 14 }

/** One line under consideration: the actions taken and where they landed. */
interface Line {
  readonly path: readonly Action[]
  readonly probe: PathProbe
  /** `score()` of the landing position, cached — read by pruning and by the cycle gate. */
  readonly v: number
  /**
   * The prompts this line has faced, in first-seen order, and where it stands among them.
   *
   * The per-line copy of `stepBot`'s `AskedThisTurn`, and it exists because hypothetical lines
   * never touch the real game's history. Without it the arrange sub-flow's value-neutral swaps
   * filled every beam to its depth cap — the exact livelock `settle()` and the `repeats` gate
   * already fought, back again inside the search. The rule is theirs too: landing on an *earlier*
   * question is how a sub-decision ends (Done, back to the Prelude); landing on the same or a
   * deeper question without strictly improving the position is going in circles, and the extension
   * is discarded.
   */
  readonly seen: ReadonlyMap<string, number>
  /** Index of the prompt the line currently stands at, within `seen`. */
  readonly at: number
}

export function searchBot(options: SearchOptions = DEFAULT_SEARCH): Bot {
  const useRival = options.rivalIntent === true
  const id = `search-v3(${options.width}x${options.depth}${useRival ? ',rival' : ''})`
  /*
   * Everything that is not the card play. Same weights, same fitness, same rival scoring — so an
   * arena gap between this bot and `rivalBot` is attributable to the search alone.
   */
  const delegate = heuristicBotWith(STANDARD_WEIGHTS, id, feasibility, {
    rivalIntent: useRival,
  })

  return {
    id,
    decide(
      observed: ObservedState,
      actions: readonly Action[],
      lookahead?: Lookahead,
      rollout?: Rollout,
      explore?: Explore,
    ): BotDecision {
      // Not the searched decision, or no way to search it: a weaker bot, not a broken game.
      if (explore === undefined || !isCardPlay(actions)) {
        return delegate.decide(observed, actions, lookahead, rollout)
      }

      const self = observed.self
      const intent = intentFor(observed, self, feasibility)
      /*
       * Fixed per decision, from the pre-action state — the same rule `heuristic.ts` settled on
       * after probed-state recomputation let candidates shift a rival's imputed intent and broke
       * the livelock gate's termination argument. A beam is even more exposed: its cycle gate
       * compares line values, and values that move under each step make a swap "gain" both ways.
       */
      const rivalIntent: RivalIntent | undefined = useRival
        ? (() => {
            const views = new Map(
              observed.factions
                .filter((f) => f !== self)
                .map((f) => [f, intentFor(observed, f, feasibility)] as const),
            )
            return ((_probed, rival) => views.get(rival) ?? intent) as RivalIntent
          })()
        : undefined
      const score = (obs: ObservedState): number =>
        valueOf(obs, self, intent, STANDARD_WEIGHTS, rivalIntent)
      /** A terminal line's worth: the mean over its dice samples — odds, not one imaginary roll. */
      const settledScore = (probe: PathProbe): number =>
        probe.samples.reduce((n, s) => n + score(s), 0) / probe.samples.length

      /*
       * Rollbacks are never candidates, at the root or anywhere down a line — the same `refuses`
       * rule V1 earned the hard way (31 battles cancelled for every 4 rolled).
       */
      const live = (offer: readonly Action[]): readonly Action[] => offer.filter((a) => !refuses(a))

      const roots = live(actions)
      const pool = roots.length > 0 ? roots : actions

      /**
       * One root's turn, played out under its own beam: the best terminal reached, or `undefined`
       * when every explore down this root failed. Terminals are compared only against terminals
       * from the same root here; roots meet each other solely at the settled horizon below.
       */
      /** Wrap a probe as a line node, applying the cycle gate. `undefined` = discarded. */
      const extend = (parent: Line | undefined, path: readonly Action[]): Line | undefined => {
        const probe = explore(path)
        if (probe === undefined) return undefined
        const v = score(probe.observed)
        const seen = parent?.seen ?? new Map<string, number>()
        const at = parent?.at ?? 0
        const p = probe.prompt
        // Unprompted asks abstain, exactly as the `repeats` gate does: nothing to compare.
        if (p === undefined) return { path, probe, v, seen, at }
        const j = seen.get(p)
        if (j === undefined) {
          return { path, probe, v, seen: new Map([...seen, [p, seen.size]]), at: seen.size }
        }
        if (j < at) return { path, probe, v, seen, at: j } // unwinding out of a sub-decision
        // Same question, same or deeper: a repeat must strictly improve or it is a circle.
        if (parent !== undefined && v <= parent.v) return undefined
        return { path, probe, v, seen, at: j }
      }

      const searchRoot = (root: Action): { line: Line; value: number } | undefined => {
        const first = extend(undefined, [root])
        if (first === undefined) return undefined
        let best: { line: Line; value: number } | undefined
        const note = (line: Line): void => {
          const value = settledScore(line.probe)
          // Strictly greater, so the earliest of equal lines wins — the stable, seedless tie-break.
          if (best === undefined || value > best.value) best = { line, value }
        }

        let frontier: Line[] = [first]
        for (let depth = 1; depth <= options.depth && frontier.length > 0; depth++) {
          /*
           * Prune before extending, so a level's cost is bounded by `width x branching` rather
           * than by how bushy the previous level was. Stable sort: equal scores keep offer order.
           * Within one root every line shares a prefix, so intermediate values are comparable in a
           * way they were not across roots.
           */
          frontier = frontier
            .map((line, i) => ({ line, i }))
            .sort((a, b) => b.line.v - a.line.v || a.i - b.i)
            .slice(0, options.width)
            .map((x) => x.line)

          const next: Line[] = []
          for (const line of frontier) {
            const offer = live(line.probe.actions)
            // The line has left this faction's hands, or the cap is here: it is a terminal.
            if (!line.probe.mine || offer.length === 0 || depth === options.depth) {
              note(line)
              continue
            }
            let extended = false
            for (const action of offer) {
              const child = extend(line, [...line.path, action])
              if (child === undefined) continue
              extended = true
              next.push(child)
            }
            /*
             * Every extension was gated off — nothing but circles from here. The line itself is
             * still a position the turn could stop at only if the engine offers a way out, which a
             * gated-off node does not have; score it where it stands rather than losing the root.
             */
            if (!extended) note(line)
          }
          frontier = next
        }
        // Lines still open when the loop ends were cut by the cap, and a cut line is a terminal too.
        for (const line of frontier) note(line)
        return best
      }

      const results = pool.map((root) => searchRoot(root))

      // Nothing searched — the explores all failed. Fall back rather than invent a ranking.
      if (results.every((r) => r === undefined)) {
        return delegate.decide(observed, actions, lookahead, rollout)
      }

      // Strictly greater keeps the earliest root of a tie — offer order, like everything else.
      let bestAt = -1
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r !== undefined && (bestAt === -1 || r.value > results[bestAt]!.value)) bestAt = i
      }
      const bestTerminal = results[bestAt]!

      const considered: Considered[] = pool
        .map((action, i) => ({ action, r: results[i] }))
        .filter((x): x is { action: Action; r: { line: Line; value: number } } => x.r !== undefined)
        .map((x) => ({
          action: x.action,
          score: x.r.value,
          note: `best of a ${x.r.line.path.length}-step line`,
        }))

      const chosen = bestTerminal.line
      const others = results.filter((r, i) => r !== undefined && i !== bestAt)
      const runnerUp = others.length === 0 ? undefined : Math.max(...others.map((r) => r!.value))
      const margin = runnerUp === undefined ? undefined : bestTerminal.value - runnerUp

      return {
        action: chosen.path[0]!,
        because:
          `${intent.summary} — ${String(chosen.path[0]!['label'] ?? chosen.path[0]!.type)}` +
          ` (searched ${chosen.path.length}-step line` +
          (margin === undefined ? ')' : `, +${margin.toFixed(1)})`),
        considered,
      }
    },
  }
}
