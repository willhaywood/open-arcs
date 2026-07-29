/**
 * The rolled dice, as real 3D cubes.
 *
 * Each die is a CSS cube carrying its type's six face arts. It starts tilted and, once `armed`,
 * transitions through several whole turns to rest on the rolled face — the ease-out reads as a
 * die decelerating to a stop, and one transition does the whole tumble with no animation loop.
 * The faces are already decided by the engine's seeded roll; this only stages the reveal.
 */

import type { DieType, GameState } from '@arcs/engine'
import { useEffect, useMemo, useState } from 'react'

import { dieArt } from '../dice-art.js'

/** How long the tumble runs. Matches the `.cube` transition in the stylesheet. */
export const ROLL_MS = 1000

/** The six cube faces, in the order die faces 1..6 are pasted onto them. */
const CUBE_FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const

/**
 * Each die's body colour, sampled as the dominant opaque pixel of its own face art.
 *
 * The art is a disc on a transparent field, covering about π/4 of the square, so a face showing
 * it at natural size leaves the four corners empty and the cube reads as floating discs. Filling
 * the face with the same colour the disc is painted in closes the corners — the earlier fix,
 * scaling the image past the inscribed-circle ratio, spilled it outside the face instead
 * (`overflow: hidden` does not clip inside a `preserve-3d` cube).
 *
 * **These are pixel-exact matches to the art**, sampled from the images themselves — the whole
 * point is that the corner fill and the disc are indistinguishable. The art is perfectly flat:
 * every opaque pixel of `skirmish-die-4` reads `78,125,132`, so an exact fill is achievable and
 * anything else shows a seam at the disc's edge.
 *
 * Tinting these to fake depth was tried in both directions and is the wrong lever — the cube's
 * shape comes from per-face `brightness()` in the stylesheet, which shades the fill and the art
 * together and so cannot pull them apart.
 */
const DIE_COLOR: Record<DieType, string> = {
  Skirmish: '#4e7d84',
  Assault: '#83271c',
  Raid: '#d07430',
}

/**
 * Cube rotation (degrees, [x, y]) that brings each die face to the camera. Derived from the
 * face transforms in the stylesheet — the inverse of where each face is glued on.
 */
const FACE_ROT: Record<number, readonly [number, number]> = {
  1: [0, 0],
  2: [0, 180],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  6: [90, 0],
}

export function Die3D({
  die,
  face,
  index,
  armed,
}: {
  die: DieType
  face: number
  index: number
  armed: boolean
}): JSX.Element {
  const [rx, ry] = FACE_ROT[face] ?? [0, 0]
  // Vary the tumble per die so a handful don't spin in lockstep; leave a small resting tilt so
  // the cube reads as solid rather than a flat square face-on.
  const turnsX = 2 + (index % 2)
  const turnsY = 3 + (index % 3)
  const start = 'rotateX(-24deg) rotateY(-18deg)'
  const end = `rotateX(${rx + 360 * turnsX - 8}deg) rotateY(${ry + 360 * turnsY + 12}deg)`
  return (
    <div className="die3d" style={{ ['--die-face']: DIE_COLOR[die] } as React.CSSProperties}>
      <div className="cube" style={{ transform: armed ? end : start }}>
        {CUBE_FACES.map((pos, i) => (
          <div className={`face ${pos}`} key={pos}>
            <img src={dieArt(die, i + 1)} alt="" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Rolls whose tumble has already been watched, for this page session.
 *
 * Undoing back into a battle remounts the tray, which would replay the reveal every time and
 * make stepping back through a combat feel like wading. A roll animates the first time it is
 * shown and is settled on sight after that.
 *
 * A roll is identified by *where it sits in the journal* as well as its faces. Faces alone are
 * far too weak: a single skirmish die has only six possible outcomes, so unrelated battles would
 * collide constantly and most rolls would never animate at all.
 *
 * Marked as watched when the motion *finishes*, not when it starts — under StrictMode the effect
 * is invoked twice on mount, and marking it up front would let the second pass suppress the very
 * animation the first pass was starting.
 */
const watched = new Set<string>()

/**
 * A whole roll. Returns the row plus whether it is still tumbling, so callers can hold back the
 * result until the dice have landed. `instance` distinguishes this roll from any other with the
 * same faces — see `watched`.
 */
export function useRoll(
  lastRoll: NonNullable<GameState['lastRoll']>,
  instance: string,
): { rolling: boolean; row: JSX.Element } {
  const dice = lastRoll.dice
  const signature = useMemo(
    () => `${instance}|${dice.map((d) => `${d.die}${d.face}`).join(',')}`,
    [dice, instance],
  )

  // Start settled for a roll already watched, so there is no frame of un-armed dice before the
  // effect can catch it. `armed` otherwise flips a frame after mount so the cubes transition
  // from their start tilt to the settled face; `rolling` clears when that motion ends.
  const [armed, setArmed] = useState(() => watched.has(signature))
  const [rolling, setRolling] = useState(() => !watched.has(signature))
  useEffect(() => {
    if (watched.has(signature)) {
      setArmed(true)
      setRolling(false)
      return
    }
    setArmed(false)
    setRolling(true)
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setArmed(true)))
    const stop = setTimeout(() => {
      watched.add(signature)
      setRolling(false)
    }, ROLL_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(stop)
    }
  }, [signature])

  const row = (
    <div className="bt-result three-d">
      {dice.map((d, i) => (
        <Die3D key={i} die={d.die as DieType} face={d.face} index={i} armed={armed} />
      ))}
    </div>
  )
  return { rolling, row }
}
