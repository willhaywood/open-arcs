/**
 * The pure half of the bot event surface: where an action lands, and what caption it carries.
 *
 * `derivePlacement` is a *generic field scan* rather than a per-type table, and this test is why
 * that is safe: the representative actions here pin what each family of fields must resolve to, so
 * a new action type that carries `system`/`from`/`to` gets on-board treatment for free and one
 * that renames a field fails here by name.
 */

import { describe, expect, it } from 'vitest'

import type { Action } from '@arcs/engine'

import {
  EVENT_LIFE_MS,
  ambitionFlash,
  caption,
  courtFlashSlot,
  derivePlacement,
  liveEvents,
  liveFlash,
  playedCardFlash,
} from '../src/bot-events.js'
import type { BotEvent } from '../src/bot-events.js'

function event(action: Action, lines: string[] = [], at = 0, id = 1): BotEvent {
  return { id, faction: 'red', action, lines, at }
}

describe('derivePlacement', () => {
  it('a build pulses its system', () => {
    const p = derivePlacement({ type: 'action/build', faction: 'red', system: '1-Hex' } as Action)
    expect(p).toEqual({ kind: 'pulse', system: '1-Hex' })
  })

  it('a move with both ends draws an arrow', () => {
    const p = derivePlacement({
      type: 'action/move-pick',
      faction: 'red',
      from: '1-Hex',
      to: '2-Arrow',
    } as Action)
    expect(p).toEqual({ kind: 'arrow', from: '1-Hex', to: '2-Arrow' })
  })

  it('battle-family actions pulse in battle colours', () => {
    const battle = derivePlacement({
      type: 'battle/system',
      faction: 'red',
      system: '3-Gate',
    } as Action)
    expect(battle).toEqual({ kind: 'battle', system: '3-Gate' })
    const rifles = derivePlacement({ type: 'rifles/roll', faction: 'red', at: '2-Hex' } as Action)
    expect(rifles).toEqual({ kind: 'battle', system: '2-Hex' })
  })

  it('taxes, gate picks and ship picks fall out of the field scan unnamed', () => {
    for (const a of [
      { type: 'action/tax-city', faction: 'red', system: '4-Crescent' },
      { type: 'turn/gates-place', faction: 'red', system: '1-Gate' },
      { type: 'turn/ships-place', faction: 'red', system: '5-Hex' },
    ]) {
      expect(derivePlacement(a as Action)).toEqual({ kind: 'pulse', system: a.system })
    }
  })

  it('off-board actions place nothing', () => {
    for (const a of [
      { type: 'turn/prelude-done', faction: 'red' },
      { type: 'action/influence', faction: 'red', slot: 2 },
      { type: 'turn/lead', faction: 'red', card: 'Aggression-3' },
      // `from` alone is not a map pair — a Union's take names a hand, not a system.
      { type: 'guild/union-take', faction: 'red', from: 'blue' },
    ]) {
      expect(derivePlacement(a as Action)).toBeNull()
    }
  })
})

describe('caption', () => {
  it('prefers the engine log line the action produced', () => {
    const e = event({ type: 'action/build', faction: 'red' } as Action, [
      'red built a Ship in 1-Hex',
    ])
    expect(caption(e)).toBe('red built a Ship in 1-Hex')
  })

  it('falls back to the action label, owned by the faction', () => {
    const e = event({ type: 'turn/lead', faction: 'red', label: 'Play Aggression-3' } as Action)
    expect(caption(e)).toBe('red: Play Aggression-3')
  })
})

describe('surface flashes', () => {
  it('court actions name their slot, everything else does not', () => {
    expect(courtFlashSlot({ type: 'action/influence', faction: 'red', slot: 3 } as Action)).toBe(3)
    expect(courtFlashSlot({ type: 'action/secure', faction: 'red', slot: 1 } as Action)).toBe(1)
    expect(courtFlashSlot({ type: 'action/build', faction: 'red', system: '1-Hex' } as Action)).toBeUndefined()
  })

  it('declarations name their ambition', () => {
    expect(
      ambitionFlash({ type: 'ambition/declare', faction: 'red', ambition: 'Tycoon' } as Action),
    ).toBe('Tycoon')
    expect(ambitionFlash({ type: 'turn/lead', faction: 'red', card: 'x' } as Action)).toBeUndefined()
  })

  it('card plays name their card', () => {
    for (const type of ['turn/lead', 'turn/surpass', 'turn/copy', 'turn/pivot']) {
      expect(playedCardFlash({ type, faction: 'red', card: 'Construction-2' } as Action)).toBe(
        'Construction-2',
      )
    }
    expect(playedCardFlash({ type: 'turn/pass', faction: 'red' } as Action)).toBeUndefined()
  })

  it('liveFlash returns the newest live match and its event id', () => {
    const events = [
      event({ type: 'action/influence', faction: 'red', slot: 1 } as Action, [], 0, 1),
      event({ type: 'action/build', faction: 'red', system: '1-Hex' } as Action, [], 100, 2),
      event({ type: 'action/influence', faction: 'red', slot: 4 } as Action, [], 200, 3),
    ]
    expect(liveFlash(events, 300, courtFlashSlot)).toEqual({ value: 4, id: 3 })
    // Once the slot-4 event has aged out, nothing older revives — it aged out too.
    expect(liveFlash(events, 200 + EVENT_LIFE_MS, courtFlashSlot)).toBeUndefined()
  })
})

describe('liveEvents', () => {
  it('keeps events younger than the life and drops the rest', () => {
    const events = [event({ type: 'x' } as Action, [], 0, 1), event({ type: 'x' } as Action, [], 1000, 2)]
    expect(liveEvents(events, EVENT_LIFE_MS + 1).map((e) => e.id)).toEqual([2])
  })
})
