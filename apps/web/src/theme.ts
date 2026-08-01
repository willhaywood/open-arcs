import type { ColorId } from '@arcs/engine'
import { asset } from './assets.js'

export const FACTION_COLOR: Record<string, string> = {
  red: '#d94b3f',
  yellow: '#e0a92e',
  blue: '#3f7fd9',
  white: '#e8e8ea',
  empire: '#8a6bd6',
  blights: '#5b8a44',
  free: '#8a8f98',
}

export function colorOf(color: ColorId | string): string {
  return FACTION_COLOR[color] ?? '#8a8f98'
}

/** Readable text color against a faction swatch. */
export function textOn(color: ColorId | string): string {
  return color === 'white' ? '#111' : '#fff'
}

/** Asset filename prefix for a color's component art (`figure/<prefix>-city.webp`). */
const COLOR_LETTER: Record<string, string> = {
  red: 'r',
  yellow: 'y',
  blue: 'b',
  white: 'w',
  free: 'free',
  empire: 'imperial',
}

export function figureArt(color: string, piece: string, damaged = false): string | null {
  const letter = COLOR_LETTER[color]
  if (letter === undefined) return null
  return asset(`game-assets/figure/${letter}-${piece}${damaged ? '-damaged' : ''}.webp`)
}

/* The resource abbreviation and color tables that lived here were only ever read by the
   status panel. The player boards use the real token art instead, so both are gone. */
