import { isWaiting } from '@arcs/engine'
import { useRef } from 'react'

import { ActionPanel } from './components/ActionPanel.js'
import { AmbitionTrack } from './components/AmbitionTrack.js'
import { Board } from './components/Board.js'
import { CourtPanel } from './components/CourtPanel.js'
import { DraftScreen } from './components/DraftScreen.js'
import { LearnedScreen } from './components/LearnedScreen.js'
import { ActionTray } from './components/ActionTray.js'
import { PreludeScreen } from './components/PreludeScreen.js'
import { SlotBoard } from './components/SlotBoard.js'
import { RaidModal } from './components/RaidModal.js'
import { Hand } from './components/Hand.js'
import { LogPanel } from './components/LogPanel.js'
import { NewGame } from './components/NewGame.js'
import { PlayedCards } from './components/PlayedCards.js'
import { PlayerBoards } from './components/PlayerBoards.js'
import { setupLabel } from './setups.js'
import { store, useGame } from './store.js'

export function App(): JSX.Element {
  const result = useGame()
  const fileInput = useRef<HTMLInputElement>(null)

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
      </div>
    )
  }

  const { state, continue: cont } = result
  const current =
    cont.kind === 'ask' ? cont.faction : isWaiting(cont) ? undefined : state.current

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
        <div className="toolbar">
          <button className="ghost" onClick={() => store.undo()} disabled={!store.canUndo()}>
            Undo
          </button>
          <button className="ghost" onClick={saveGame}>
            Save
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
            <Board state={state} cont={cont} highlight={current} />
          </div>
          <AmbitionTrack state={state} />
          <div className="hand-row">
            <Hand state={state} cont={cont} />
          </div>
          {/* Shares the hand's grid area, as a sibling: `.hand-row` clips its own children. */}
          <PreludeScreen state={state} cont={cont} />
          {/* The action phase, on the same terms as the Prelude: over the hand, map still visible. */}
          <ActionTray state={state} cont={cont} />
          <PlayerBoards state={state} current={current} />
        </section>
        <aside className="side-col">
          <ActionPanel cont={cont} onNewGame={() => store.reset()} />
          <LogPanel log={state.log} />
        </aside>
      </main>

      {/* The draft is its own screen, over the board it is about to populate. */}
      <DraftScreen state={state} cont={cont} />

      {/* The Archivist's post-setup draw, on the same terms as the draft it follows. */}
      <LearnedScreen cont={cont} />

      {/* Choosing what to keep when the slots are full. */}
      <SlotBoard state={state} cont={cont} />

      {/* Spending raid keys after a battle. */}
      <RaidModal cont={cont} />
    </div>
  )
}
