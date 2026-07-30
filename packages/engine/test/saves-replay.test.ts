/**
 * Every checked-in save still replays.
 *
 * A save is options plus a journal of encoded actions (docs/11), so it is only as durable as the
 * action names and argument shapes it encodes. Rename an action type, drop a field, or change what
 * an action means partway through a flow, and every save written before that silently stops
 * loading — including the interaction saves under `saves/lore`, which exist to be loaded by hand
 * and would otherwise fail at the moment someone reached for one.
 *
 * This is the cheapest possible guard on that: replay each save and require it to land on a live
 * Ask with something to choose. It does not check the position is still *interesting* — only that
 * the journal is still legal and the game is still playable from it. That is the part a rename
 * breaks.
 *
 * If this fails after an intentional action-shape change, regenerate with `npm run saves:build`
 * and check the scenarios still stop where their README claims.
 *
 * **This file is excluded from the engine's tsc project** (see `packages/engine/tsconfig.json`).
 * It needs Node's types to read files, and adding those to that project would also let `src`
 * import `node:fs` and compile — undoing the isolation docs/02 relies on. It runs under vitest,
 * which does not typecheck, so treat it as unchecked code and keep it simple.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultRegistry, loadGame } from '../src/index.js'

const registry = defaultRegistry()
const ROOT = join(import.meta.dirname, '..', '..', '..')

/** Every save file in the repo, by path relative to the root. */
function saveFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.json')) out.push(rel)
    }
  }
  walk('saves')
  return out.sort()
}

describe('checked-in saves', () => {
  const files = saveFiles()

  it('there are some — an empty sweep would pass vacuously', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  for (const file of files) {
    it(`${file} replays to a playable position`, () => {
      const { options, result } = loadGame(readFileSync(join(ROOT, file), 'utf8'), registry)
      expect(options.factions.length).toBeGreaterThan(1)

      // The journal must have been consumed, not silently truncated on a bad entry.
      const saved = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { journal: string[] }
      expect(result.state.journal).toEqual(saved.journal)

      /*
       * `follow-demo.json` is a three-action fixture that ends a turn, so it lands mid-round
       * rather than on a decision. Everything under `saves/lore` is parked on an Ask on purpose
       * — that is what makes it loadable and immediately testable by hand.
       */
      if (file.startsWith('saves/lore/')) {
        expect(result.continue.kind).toBe('ask')
        if (result.continue.kind === 'ask') {
          expect(result.continue.actions.length).toBeGreaterThan(0)
        }
      } else {
        expect(['ask', 'then', 'milestone', 'log', 'gameOver']).toContain(result.continue.kind)
      }
    })
  }
})
