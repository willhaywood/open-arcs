import { parseCardId } from '@arcs/engine'
import type { Suit } from '@arcs/engine'
import { useState } from 'react'
import { asset } from '../assets.js'

const SUIT_COLOR: Record<Suit, string> = {
  Administration: '#3f6fd0',
  Aggression: '#d0443a',
  Construction: '#d69a2e',
  Mobilization: '#4f9a52',
}

const SUIT_ABBR: Record<Suit, string> = {
  Administration: 'ADM',
  Aggression: 'AGR',
  Construction: 'CON',
  Mobilization: 'MOB',
}

/**
 * A single action card. Uses the real component art from the local asset mirror when it
 * loads, and falls back to a clean drawn card (suit color, number, pips) otherwise — so the
 * hand is legible with or without the artwork present.
 */
export function CardFace({ cardId }: { cardId: string }): JSX.Element {
  const card = parseCardId(cardId)
  const [broken, setBroken] = useState(false)
  const src = asset(`game-assets/action/${card.suit.toLowerCase()}-${card.strength}.webp`)

  if (broken) {
    return (
      <div className="cardface fallback" style={{ background: SUIT_COLOR[card.suit] }}>
        <div className="cf-suit">{SUIT_ABBR[card.suit]}</div>
        <div className="cf-strength">{card.strength}</div>
        <div className="cf-pips">{'•'.repeat(card.pips)}</div>
      </div>
    )
  }

  return (
    <img
      className="cardface"
      src={src}
      alt={cardId}
      draggable={false}
      onError={() => setBroken(true)}
    />
  )
}
