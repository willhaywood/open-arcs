import { DICE, FACES } from '@arcs/engine'
import { describe, expect, it } from 'vitest'

import { ART_FACES, FACE_ART, dieArt } from '../src/dice-art.js'

describe('die face art matches the face it is meant to show', () => {
  it('is a permutation of the six faces', () => {
    expect([...FACE_ART].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  // The one that matters: the art drawn for a rolled face must carry that face's symbols.
  // Indexing art by the engine's face number instead drew blanks for hits — see dice-art.ts.
  for (const die of DICE) {
    it(`${die}: every rolled face draws art with the same symbols`, () => {
      for (let face = 1; face <= 6; face++) {
        const rolled = FACES[die][face - 1]
        const art = ART_FACES[die][FACE_ART[face - 1]! - 1]
        expect({ face, ...art }).toEqual({ face, ...rolled })
      }
    })
  }

  it('the art set as a whole is the same six faces as the engine rolls', () => {
    const sig = (t: (typeof FACES)['Skirmish'][number]) =>
      `${t.hits}/${t.buildings}/${t.self}/${t.intercept}/${t.keys}`
    for (const die of DICE) {
      expect([...ART_FACES[die]].map(sig).sort()).toEqual([...FACES[die]].map(sig).sort())
    }
  })

  it('builds the expected paths, with face 0 as the blank idle art', () => {
    expect(dieArt('Assault', 0)).toBe('/game-assets/icon/assault-die.webp')
    // Engine Assault face 1 is "2 hits + self", which is art file 4 — not file 1 (blank).
    expect(dieArt('Assault', 1)).toBe('/game-assets/icon/assault-die-4.webp')
    expect(dieArt('Raid', 2)).toBe('/game-assets/icon/raid-die-1.webp')
  })
})
