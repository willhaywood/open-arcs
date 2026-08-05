import React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { MULTIPLAYER_URL } from './multiplayer/config.js'
import { parseLink, recall } from './multiplayer/link.js'
import { store } from './store.js'
import './styles.css'

/*
 * A game link in the address bar joins that game before anything renders, so a player who follows
 * their link lands in the game rather than on the setup screen.
 *
 * `recall` covers the case the link design is most exposed to: a URL that has lost its seat token —
 * copied without the tail, or trimmed by a chat client — where this browser has played that game
 * before. It upgrades a would-be spectator back into their seat rather than silently demoting them,
 * which is the difference between "my game is broken" and nothing being noticed at all.
 */
const link = parseLink(window.location.hash)
if (link !== null && link !== undefined && MULTIPLAYER_URL !== null) {
  const seatToken = link.seatToken ?? recall(link.gameId)
  void store.joinSession(MULTIPLAYER_URL, seatToken === undefined ? link : { ...link, seatToken })
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
