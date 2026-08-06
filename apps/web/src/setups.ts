import { asset } from './assets.js'
/**
 * The setup cards, keyed by the engine's board id.
 *
 * The engine names boards by identity (`Board3CoreConflict`) because that is what a save file
 * and a topology lookup need. Players know them by the names printed on the cards — "Core
 * Conflict", "Mix Up 1" — and the player count is already obvious from the table, so the id's
 * `Board3`/`Board4` prefix is noise everywhere it is shown.
 *
 * Shared so the start screen and the header cannot drift apart on what a board is called.
 */
export interface SetupCard {
  label: string
  art: string
  note?: string
}

export const SETUP_CARDS: Record<string, SetupCard> = {
  Board2Frontiers: {
    label: 'Frontiers',
    art: asset('game-assets/setup/setup-2p-01.webp'),
    note: 'For experienced players',
  },
  Board2MixUp1: { label: 'Mix Up 1', art: asset('game-assets/setup/setup-2p-02.webp') },
  Board2Homelands: { label: 'Homelands', art: asset('game-assets/setup/setup-2p-03.webp') },
  Board2MixUp2: { label: 'Mix Up 2', art: asset('game-assets/setup/setup-2p-04.webp') },
  Board3MixUp: { label: 'Mix Up', art: asset('game-assets/setup/setup-3p-01.webp') },
  Board3Frontiers: { label: 'Frontiers', art: asset('game-assets/setup/setup-3p-02.webp') },
  Board3Homelands: { label: 'Homelands', art: asset('game-assets/setup/setup-3p-03.webp') },
  Board3CoreConflict: {
    label: 'Core Conflict',
    art: asset('game-assets/setup/setup-3p-04.webp'),
    note: 'For experienced players',
  },
  Board4MixUp1: { label: 'Mix Up 1', art: asset('game-assets/setup/setup-4p-01.webp') },
  Board4MixUp2: { label: 'Mix Up 2', art: asset('game-assets/setup/setup-4p-02.webp') },
  Board4Frontiers: { label: 'Frontiers', art: asset('game-assets/setup/setup-4p-03.webp') },
  Board4MixUp3: { label: 'Mix Up 3', art: asset('game-assets/setup/setup-4p-04.webp') },
}

/**
 * What to call a board on screen. Falls back to the engine id, so a board added to the topology
 * without a card entry still shows something rather than a blank.
 */
export function setupLabel(board: string): string {
  return SETUP_CARDS[board]?.label ?? board
}
