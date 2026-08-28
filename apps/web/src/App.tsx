import { isWaiting } from '@arcs/engine'
import { useEffect, useRef, useState } from 'react'

import { AskStrip } from './components/AskStrip.js'
import { AmbitionTrack } from './components/AmbitionTrack.js'
import { Attribution } from './components/Attribution.js'
import { Battle } from './components/Battle.js'
import { ChapterInterlude } from './components/ChapterInterlude.js'
import { GameOverScreen } from './components/GameOverScreen.js'
import { Board } from './components/Board.js'
import { CourtPanel } from './components/CourtPanel.js'
import { DraftScreen } from './components/DraftScreen.js'
import { LearnedScreen } from './components/LearnedScreen.js'
import { ActionTray } from './components/ActionTray.js'
import { PreludeScreen } from './components/PreludeScreen.js'
import { SlotBoard } from './components/SlotBoard.js'
import { CardShelf } from './components/CardShelf.js'
import { RaidModal } from './components/RaidModal.js'
import { Hand } from './components/Hand.js'
import { LogPanel } from './components/LogPanel.js'
import { NewGame } from './components/NewGame.js'
import { PlayedCards } from './components/PlayedCards.js'
import { PlayerBoards } from './components/PlayerBoards.js'
import { SeatBadge } from './components/SeatBadge.js'
import { Watching } from './components/Watching.js'
import { canAct, viewFor } from './multiplayer/seat.js'
import { setupLabel } from './setups.js'
import { store, useGame } from './store.js'

export function App(): JSX.Element {
  const result = useGame()
  const fileInput = useRef<HTMLInputElement>(null)
  /*
   * The log drawer. Local state, deliberately: nothing else reads it, and it must not entangle
   * with saves or undo. No backdrop either — the point of the drawer is reading the log while
   * the game stays playable behind it.
   */
  const [logOpen, setLogOpen] = useState(false)
  useEffect(() => {
    if (!logOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLogOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [logOpen])

  function saveGame(): void {
    const json = store.toJSON()
    if (json === null) return
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `arcs-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function loadGame(file: File | undefined): Promise<void> {
    if (file === undefined) return
    try {
      store.load(await file.text())
    } catch (e) {
      alert(`Could not load: ${(e as Error).message}`)
    }
  }

  const loadControl = (
    <>
      <button className="ghost" onClick={() => fileInput.current?.click()}>
        Load
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          void loadGame(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )

  if (result === null) {
    return (
      <div className="newgame-wrap">
        <NewGame />
        <div className="newgame-load">{loadControl}or load a saved game</div>
        <Attribution />
      </div>
    )
  }

  const { state, continue: engineCont } = result
  /*
   * `current` is read from the engine's own answer, before the seat filter — it drives the board
   * highlight and the "waiting for" badge, both of which have to keep naming whoever is genuinely
   * acting. Whose turn it is has never been secret; only their cards are.
   */
  const current =
    engineCont.kind === 'ask'
      ? engineCont.faction
      : isWaiting(engineCont)
        ? undefined
        : state.current
  const seatView = store.seatView()
  const cont = viewFor(engineCont, seatView)
  /*
   * Whether the controls work. Separate from what is *drawn* — a watcher sees the dice and the
   * court decisions, grayed and inert, and only the two private surfaces are withheld outright.
   */
  const acting = canAct(engineCont, seatView)

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Arcs</span>
        <span className="board-name">{setupLabel(state.board.name)}</span>
        {/* Was the status panel's heading; the panel itself is gone, the player boards
            along the bottom carry everything else it showed. */}
        <span className="turn-meta">
          Act {state.act} · Chapter {state.chapter} · Round {state.round}
        </span>
        <SeatBadge view={seatView} current={current} />
        <div className="toolbar">
          <button className="ghost" onClick={() => store.undo()} disabled={!store.canUndo()}>
            Undo
          </button>
          <button className="ghost" onClick={saveGame}>
            Save
          </button>
          <button className="ghost" onClick={() => setLogOpen((v) => !v)}>
            Log
          </button>
          {loadControl}
          <button className="ghost" onClick={() => store.reset()}>
            New game
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="board-col">
          <CourtPanel state={state} />
          <PlayedCards state={state} />
          <div className="board-cell">
            {/*
              * Every click on the map dispatches an action, so it is gated like any other surface.
              * Nothing is dimmed: the dimming rule targets controls, and the map has none — a
              * watcher gets the board at full strength and simply cannot move anything on it.
              */}
            <Watching canAct={acting}>
              <Board state={state} cont={cont} highlight={current} />
            </Watching>
          </div>
          <AmbitionTrack state={state} cont={cont} />
          {/*
            * The decision surfaces. Wrapped so a watcher sees them and cannot touch them —
            * `Watching` is `display: contents`, so `.hand-row` and its siblings stay grid items of
            * `.board-col` exactly as before.
            */}
          {/*
            * A finished game has no actions to guard, and the strip's game-over band (New game,
            * View summary) must work for every seat and for spectators — `canAct` is false for a
            * gameOver continue, so inside `Watching` those buttons would be inert in joined games.
            */}
          {cont.kind === 'gameOver' ? (
            <AskStrip cont={cont} onNewGame={() => store.reset()} />
          ) : (
            <Watching canAct={acting}>
              <div className="hand-row">
                <Hand state={state} cont={cont} />
              </div>
              {/* Shares the hand's grid area, as a sibling: `.hand-row` clips its own children. */}
              <PreludeScreen state={state} cont={cont} />
              {/* The action phase, on the same terms as the Prelude: over the hand, map still visible. */}
              <ActionTray state={state} cont={cont} />
              {/* Every decision without a bespoke surface, in the same band — see AskStrip. */}
              <AskStrip cont={cont} onNewGame={() => store.reset()} />
            </Watching>
          )}
          <PlayerBoards state={state} current={current} />
        </section>
        {logOpen ? (
          <div className="log-drawer" role="complementary" aria-label="Game log">
            <div className="log-drawer-head">
              <span>Log</span>
              <button className="ghost" onClick={() => setLogOpen(false)}>
                ✕
              </button>
            </div>
            <LogPanel log={state.log} />
          </div>
        ) : null}
      </main>

      {/*
        * The interludes: chapter scoring and the game's end. Presentation, not decisions — every
        * seat and spectator sees them and dismisses their own — so they live outside `Watching`.
        */}
      <ChapterInterlude />
      <GameOverScreen state={state} cont={cont} />

      <Watching canAct={acting}>
        {/*
          * The battle window, with the dice. It used to be rendered from inside `Board` — harmless,
          * since it is a fixed-position modal, but it put the one surface a watcher most wants
          * outside the wrapper that governs them. Every decision surface is now in this file, which
          * is what makes one wrapper enough.
          */}
        <Battle state={state} cont={cont} />

        {/* The draft is its own screen, over the board it is about to populate. */}
        <DraftScreen state={state} cont={cont} />

        {/* The Archivist's post-setup draw, on the same terms as the draft it follows. */}
        <LearnedScreen cont={cont} />

        {/* Choosing what to keep when the slots are full. */}
        <SlotBoard state={state} cont={cont} />

        {/* Spending raid keys after a battle. */}
        <RaidModal cont={cont} />

        {/* Influence, Secure and Ransack — the court decisions, as the cards themselves. */}
        <CardShelf state={state} cont={cont} />
      </Watching>
    </div>
  )
}
