/**
 * The player boards, along the bottom: a full one for whoever is acting, and a compact one
 * per rival to its right.
 *
 * Mirrors the physical board's functional parts, minus its printed prose:
 *   - six resource slots, each with its printed key cost, opened by building cities
 *   - the +2 / +3 "to won ambitions" shields the last two cities reveal
 *   - the five-resource outrage strip
 *   - trophies (from destroying others) and captives (from securing and taxing others)
 *
 * Everything is read straight off engine state — `CITY_SLOT_KEYS` and `slotCapacity` are the
 * same values the rules use, so the board cannot drift from what a raid or a score will do.
 */

import {
  AGENTS_PER_FACTION,
  Location,
  RESOURCES,
  SHIPS_PER_FACTION,
  citiesInReserve,
  contentsOf,
  courtCard,
  outragedResources,
  parseFigureId,
  securedCards,
  slotCapacity,
} from '@arcs/engine'
import { CITIES_PER_FACTION, groupSlots, slotRow } from '../slots.js'
import type { SlotGroupInfo, SlotInfo } from '../slots.js'
import type { FactionId, GameState, Resource } from '@arcs/engine'
import { useState } from 'react'

import { colorOf, figureArt } from '../theme.js'
import { CardZoom } from './CardZoom.js'
import { CardPill, LeaderCardReader, cardArt, cardName } from './LeaderCardReader.js'
import type { DraftKind } from './LeaderCardReader.js'
import { asset } from '../assets.js'

/**
 * The Prelude action each resource buys, as printed on the board. Reference text for the
 * player — the rules read the suit/action map in `cards.ts`, not this.
 */
const PRELUDE: Record<Resource, string> = {
  Material: 'Build or repair.',
  Fuel: 'Move.',
  Weapon: 'This turn, your action card lets you battle.',
  Relic: 'Secure.',
  Psionic: 'Take an action of the lead card.',
}

const iconFor = (r: Resource, outraged: boolean): string =>
  asset(`game-assets/icon/${r.toLowerCase()}${outraged ? '-outrage' : ''}.webp`)

interface FactionBoard {
  faction: FactionId
  /** Holds the initiative right now — leads the round. */
  hasInitiative: boolean
  /** Has seized this round, so takes the initiative when the round ends. */
  seizing: boolean
  power: number
  capacity: number
  reserve: number
  slots: SlotInfo[]
  /** Cities still on the player board, covering slots. */
  citiesLeft: number
  citiesTotal: number
  outraged: readonly Resource[]
  trophies: number
  captives: number
  /** Court cards this faction has secured and now holds — live abilities, not just score. */
  secured: readonly string[]
  /** Leaders and Lore: the drafted leader and lore, if the variant is on. */
  leader: string | undefined
  lore: readonly string[]
  /** Pieces still in the supply — what you have left to build or place. */
  shipsLeft: number
  agentsLeft: number
}

/** How many of a piece are still in a faction's supply, rather than on the board or taken. */
function inSupply(state: GameState, faction: FactionId, piece: string): number {
  return contentsOf(state.figures, Location.reserve(faction)).filter(
    (id) => parseFigureId(id).piece === piece,
  ).length
}

function read(state: GameState, faction: FactionId): FactionBoard {
  const reserve = citiesInReserve(state, faction)
  const capacity = slotCapacity(reserve)
  return {
    shipsLeft: inSupply(state, faction, 'Ship'),
    agentsLeft: inSupply(state, faction, 'Agent'),
    faction,
    // The marker sits with whoever leads now; a seize is a *claim* on the next round, so it
    // is shown separately rather than moving the marker early.
    hasInitiative: state.initiativeOrder[0] === faction,
    seizing: state.seized === faction,
    power: state.power[faction] ?? 0,
    capacity,
    reserve,
    slots: slotRow(state, faction),
    citiesLeft: reserve,
    citiesTotal: CITIES_PER_FACTION,
    outraged: outragedResources(state, faction),
    trophies: contentsOf(state.figures, Location.trophies(faction)).length,
    captives: contentsOf(state.figures, Location.captives(faction)).length,
    secured: securedCards(state, faction),
    leader: state.leaders[faction],
    lore: state.lores[faction] ?? [],
  }
}

export function PlayerBoards({
  state,
  current,
}: {
  state: GameState
  current: string | undefined
}): JSX.Element {
  // Whoever is acting gets the full board; everyone else keeps their seating order beside it.
  const active = state.factions.find((f) => f === current) ?? state.factions[0]!
  const others = state.factions.filter((f) => f !== active)

  return (
    <div className={`player-boards p${state.factions.length}`}>
      <FullBoard board={read(state, active)} />
      <div className="mini-boards">
        {others.map((f) => (
          <MiniBoard key={f} board={read(state, f)} />
        ))}
      </div>
    </div>
  )
}

function FullBoard({ board }: { board: FactionBoard }): JSX.Element {
  return (
    <section className={`pboard${board.leader === undefined ? '' : ' has-leader'}`} style={leaderBackdrop(board)}>
      <BoardFrame />
      <InitiativeMark board={board} />
      <div className="pb-body">
      <header className="pb-head">
        <NamePlate faction={board.faction} />
        <Supply board={board} />
        <span className="pb-power">
          <b>{board.power}</b> power
        </span>
      </header>

      <div className="pb-slots-row">
        <div className="pb-slots">
          {groupSlots(board.slots).map((g, gi) => (
            <SlotGroup
              key={gi}
              group={g}
              faction={board.faction}
              built={board.citiesTotal - board.citiesLeft}
            />
          ))}
        </div>
        <div className="pb-shields">
          <Shield
            value={2}
            active={board.reserve < 2}
            needs={4}
            faction={board.faction}
            built={board.citiesTotal - board.citiesLeft}
          />
          <Shield
            value={3}
            active={board.reserve < 1}
            needs={5}
            faction={board.faction}
            built={board.citiesTotal - board.citiesLeft}
          />
        </div>
      </div>

      <div className="pb-lower">
        <div className="pb-outrage" title="Outraged resources cannot be spent in your Prelude">
          {RESOURCES.map((r) => {
            const out = board.outraged.includes(r)
            return (
              <img
                key={r}
                className={`pb-res${out ? ' outraged' : ''}`}
                src={iconFor(r, out)}
                alt={r}
                title={out ? `${r} — OUTRAGED, cannot be spent` : `${r}: ${PRELUDE[r]}`}
              />
            )
          })}
        </div>
        <Tally label="Trophies" hint="from destroying others" n={board.trophies} />
        <Tally label="Captives" hint="from securing and taxing others" n={board.captives} />
      </div>

      <Drafted board={board} />
      <Secured board={board} />
      </div>
      <LeaderPortrait board={board} />
    </section>
  )
}

function MiniBoard({ board }: { board: FactionBoard }): JSX.Element {
  return (
    <section className={`pboard mini${board.leader === undefined ? '' : ' has-leader'}`} style={leaderBackdrop(board)}>
      <BoardFrame />
      <InitiativeMark board={board} mini />
      <div className="pb-body">
      <header className="pb-head">
        <NamePlate faction={board.faction} mini />
        <Supply board={board} mini />
        <span className="pb-power">
          <b>{board.power}</b>
        </span>
      </header>

      <div className="pb-slots mini">
        {groupSlots(board.slots).map((g, gi) => (
          <SlotGroup
            key={gi}
            group={g}
            faction={board.faction}
            built={board.citiesTotal - board.citiesLeft}
            mini
          />
        ))}
      </div>

      <div className="pb-mini-foot">
        {/* Spelled out and labelled: "T 0  C 0" ran together and read as "TO CO". */}
        <span className="pb-mini-tally" title="Trophies — from destroying others">
          <em>Troph</em>
          <b>{board.trophies}</b>
        </span>
        <span className="pb-mini-tally" title="Captives — from securing and taxing others">
          <em>Capt</em>
          <b>{board.captives}</b>
        </span>
        {/* Rivals show outrage only when there is some, so a clean board stays clean. */}
        {board.outraged.map((r) => (
          <img
            key={r}
            className="pb-res outraged mini"
            src={iconFor(r, true)}
            alt={`${r} outraged`}
            title={`${r} — OUTRAGED`}
          />
        ))}
      </div>

      <Drafted board={board} mini />
      <Secured board={board} mini />
      </div>
      <LeaderPortrait board={board} mini />
    </section>
  )
}

/**
 * One or more slots opened by the same city, with that city drawn **once** across them.
 *
 * A single-slot group is the ordinary case; the 3rd city covers two, so its token straddles
 * the pair exactly as the physical piece does.
 */
function SlotGroup({
  group,
  faction,
  built,
  mini = false,
}: {
  group: SlotGroupInfo
  faction: FactionId
  built: number
  mini?: boolean
}): JSX.Element {
  const city = figureArt(faction, 'city')
  const span = group.items.length
  const title =
    `Covered by one of your cities — build ${group.needs - built} more to open ` +
    `${span > 1 ? `these ${span} slots` : 'this slot'}`

  return (
    <div
      className={`pb-slot-group${group.locked ? ' locked' : ''}`}
      title={group.locked ? title : undefined}
    >
      {group.items.map((s, i) => (
        <Slot key={i} keys={s.keys} locked={s.locked} resource={s.resource} mini={mini} />
      ))}
      {group.locked && city !== null ? (
        <>
          <img className="pb-city" src={city} alt={`${faction} city`} />
        </>
      ) : null}
    </div>
  )
}

/**
 * The initiative marker — the real component art (`icon/initiative.webp`, 400x1100 with the
 * art filling the frame), standing hard against the **left edge** of the board it belongs to,
 * the way the physical piece sits beside a player's board. No plate or divider: it reads as a
 * piece resting there, not as another panel.
 *
 * A seize does **not** move the marker when it happens: it is a claim that settles at end of
 * round (`rules/turn.ts`, `nextInitiative`). So the holder and the seizer can both show at once.
 *
 * Holding it carries no caption — the piece is the game's own marker and says what it is. A
 * seize does keep a word, because a tint alone cannot distinguish "holds it" from "takes it next
 * round", and those are different things.
 */
function InitiativeMark({
  board,
  mini = false,
}: {
  board: FactionBoard
  mini?: boolean
}): JSX.Element | null {
  if (!board.hasInitiative && !board.seizing) return null
  const seized = board.seizing && !board.hasInitiative
  return (
    <div
      className={`pb-init${seized ? ' seized' : ''}`}
      title={
        seized
          ? `${board.faction} seized — takes the initiative next round`
          : `${board.faction} holds the initiative and leads this round`
      }
    >
      <img src={asset('game-assets/icon/initiative.webp')} alt="Initiative marker" />
      {seized && !mini ? <span className="pb-init-label">Seized</span> : null}
    </div>
  )
}

/** One resource slot: its printed key cost above, its token or empty well below. */
function Slot({
  keys,
  locked,
  resource,
  mini = false,
}: {
  keys: number
  locked: boolean
  resource: Resource | undefined
  mini?: boolean
}): JSX.Element {
  const title = locked
    ? undefined // the group carries the explanation
    : resource === undefined
      ? `Empty slot — costs ${keys} keys to raid`
      : `${resource} — costs ${keys} keys to raid`

  return (
    <div className={`pb-slot${locked ? ' locked' : ''}`} title={title}>
      {mini ? null : (
        <img className="pb-keys" src={asset(`game-assets/icon/keys-${keys}.webp`)} alt={`${keys} keys`} />
      )}
      <div className="pb-well">
        {resource === undefined ? null : (
          <img className="pb-token" src={iconFor(resource, false)} alt={resource} />
        )}
      </div>
    </div>
  )
}

/** The +2 / +3 ambition bonus the last two cities off your board reveal. */
function Shield({
  value,
  active,
  needs,
  faction,
  built,
}: {
  value: number
  active: boolean
  needs: number
  faction: FactionId
  built: number
}): JSX.Element {
  const city = figureArt(faction, 'city')
  return (
    <div
      className={`pb-shield${active ? ' active' : ''}`}
      title={
        active
          ? `+${value} to won ambitions — earned`
          : `Covered by one of your cities — build ${needs - built} more to earn +${value}`
      }
    >
      {!active && city !== null ? (
        <img className="pb-shield-city" src={city} alt={`${faction} city`} />
      ) : null}
      <b>+{value}</b>
      <span>
        to won
        <br />
        ambitions
      </span>
    </div>
  )
}

function Tally({ label, hint, n }: { label: string; hint: string; n: number }): JSX.Element {
  return (
    <div className="pb-tally" title={`${label} — ${hint}`}>
      <div className="pb-tally-label">{label}</div>
      <div className="pb-tally-n">{n}</div>
    </div>
  )
}

/**
 * The leader as a portrait panel down the right edge of the acting player's board.
 *
 * The rival boards wash the same art faintly behind their contents, which suits a glance. The
 * acting player's board is the one actually being read, and there a wash is the worst of both:
 * its content spans the full width, so the art never gets to show, and every bit of it that does
 * show is competing with a number someone is trying to read. Giving the portrait its own column
 * means it can be shown nearly unscrimmed without costing legibility anywhere.
 *
 * The crop is driven by *height*, not `cover`: at `auto 196%` the card is scaled so its top 51% —
 * the illustration, above the printed rules panel — is exactly the panel's height, whatever that
 * height happens to be. Unlike the width-driven crop the rival boards use, this cannot drift if
 * the board is resized. The panel is narrower than the art, so it centre-crops horizontally,
 * which is where these illustrations put their subject.
 *
 * The panel carries no caption. The longest names ("Feastbringer", "Quartermaster") are single
 * words with no break opportunity, so at this width they either clip or hyphenate mid-word, and
 * shrinking type to fit them lands well below legible. The gold leader chip in the drafted row
 * names it on every board instead — which also keeps the naming identical whether or not the
 * panel is showing. Clicking either opens the reader.
 */
function LeaderPortrait({
  board,
  mini = false,
}: {
  board: FactionBoard
  mini?: boolean
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (board.leader === undefined) return null
  const name = cardName(board.leader, 'leader')
  return (
    <>
      <button
        type="button"
        className={`pb-portrait${mini ? ' mini' : ''}`}
        style={leaderBackdrop(board)}
        title={`${name} — your leader, click to read`}
        onClick={() => setOpen(true)}
      />
      {open ? (
        <LeaderCardReader id={board.leader} kind="leader" onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

/**
 * The drafted leader's art, as the board's backdrop.
 *
 * Only the *illustration* is wanted, not the card: a leader card is tall and portrait with its
 * rules printed across the lower half, and a wide board laid over the whole of it would sit on a
 * panel of white body text. `background-position` pins the crop to the top so the board shows the
 * portrait band and nothing else, and the CSS lays a heavy scrim over it — this is decoration
 * behind a dense readout, and the readout has to win.
 */
function leaderBackdrop(board: FactionBoard): React.CSSProperties | undefined {
  if (board.leader === undefined) return undefined
  return { ['--leader-art']: `url('${cardArt(board.leader, 'leader')}')` } as React.CSSProperties
}

/**
 * The leader and lore this faction drafted.
 *
 * Without this the cards vanish the moment the draft screen closes: a player would choose a
 * leader and then have no way to recall which one, let alone read what it does. Named rather
 * than pictured for the same reason as the secured guilds — a thumbnail small enough to fit here
 * cannot be identified — and clicking opens the same reader the draft used.
 */
function Drafted({ board, mini = false }: { board: FactionBoard; mini?: boolean }): JSX.Element | null {
  if (board.leader === undefined && board.lore.length === 0) return null

  const rows: { id: string; kind: DraftKind }[] = [
    ...(board.leader === undefined ? [] : [{ id: board.leader, kind: 'leader' as const }]),
    ...board.lore.map((id) => ({ id, kind: 'lore' as const })),
  ]

  return (
    <div className={`pb-guilds${mini ? ' mini' : ''}`}>
      {rows.map(({ id, kind }) => (
        <CardPill key={id} id={id} kind={kind} owner={board.faction} />
      ))}
    </div>
  )
}

/**
 * The court cards this faction has secured, as thumbnails.
 *
 * These are not score — they are live abilities. A held guild card can add a Prelude option,
 * unlock an alternative action, block a raid outright (Sworn Guardians) or change what may be
 * declared (Secret Order), and they can be stolen from a rival. Until now nothing on screen said
 * who held what, so the only way to know was to remember it.
 *
 * Shown by **name**, not as a picture of the card. A thumbnail small enough to fit here was far
 * too small to identify — the art is 744x1039 and its name band is a few pixels tall — so it
 * carried no more information than a count did. The name identifies it, and the two numbers that
 * matter at a glance ride alongside:
 *
 *   - the **suit**, because a guild's resource is what its Prelude ability keys off;
 *   - the **key cost**, because that is what a raider pays to take the card off you in battle.
 *
 * The card's actual text still needs the readable copy, which is a click away.
 */
function Secured({
  board,
  mini = false,
}: {
  board: FactionBoard
  mini?: boolean
}): JSX.Element | null {
  const [open, setOpen] = useState<string | null>(null)
  if (board.secured.length === 0) return null

  return (
    <div className={`pb-guilds${mini ? ' mini' : ''}`}>
      {board.secured.map((cardId) => {
        const card = courtCard(cardId)
        return (
          <button
            key={cardId}
            type="button"
            className="pb-guild"
            title={
              `${card.name} — ${card.suit ?? card.kind}` +
              (card.keys === undefined ? '' : `, ${card.keys} keys to raid it away`) +
              '. Click to read.'
            }
            onClick={() => setOpen(cardId)}
          >
            {card.suit !== undefined ? (
              <img
                className="pb-guild-suit"
                src={asset(`game-assets/icon/${card.suit.toLowerCase()}.webp`)}
                alt={card.suit}
              />
            ) : null}
            <span className="pb-guild-name">{card.name}</span>
            {card.keys !== undefined ? (
              <img
                className="pb-guild-keys"
                src={asset(`game-assets/icon/keys-${card.keys}.webp`)}
                alt={`${card.keys} keys`}
              />
            ) : null}
          </button>
        )
      })}
      {open !== null ? <CardZoom cardId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

/**
 * Corner brackets, matching the frame around the map.
 *
 * The rails along the edges are the board's own `border-style: double` — two parallel lines is
 * exactly what that border style draws. The brackets need four corners and an element only has
 * two pseudo-elements, so this carries the other two.
 */
function BoardFrame(): JSX.Element {
  return <span className="pb-frame" aria-hidden="true" />
}

/**
 * What is left in the supply, as the pieces themselves plus a count.
 *
 * Not decoration: you cannot build a ship you do not have, and running the fleet down is a real
 * constraint that was invisible here — the board showed what is *placed*, never what is left to
 * place. Cities already show as the tokens covering the slots, so only ships and agents need
 * saying.
 */
function Supply({ board, mini = false }: { board: FactionBoard; mini?: boolean }): JSX.Element {
  const pieces = [
    { art: 'ship', n: board.shipsLeft, of: SHIPS_PER_FACTION, label: 'ships' },
    { art: 'agent', n: board.agentsLeft, of: AGENTS_PER_FACTION, label: 'agents' },
  ]
  return (
    <div className={`pb-supply${mini ? ' mini' : ''}`}>
      {pieces.map((p) => {
        const art = figureArt(board.faction, p.art)
        return (
          <span
            key={p.art}
            className={`pb-sup${p.n === 0 ? ' out' : ''}`}
            title={`${p.n} of ${p.of} ${p.label} left in your supply`}
          >
            {art !== null ? <img className={`pb-sup-art ${p.art}`} src={art} alt={p.label} /> : null}
            <b>{p.n}</b>
          </span>
        )
      })}
    </div>
  )
}

/**
 * The player's name as a printed plate rather than a coloured pill.
 *
 * The pill put a saturated block of faction colour on a board whose whole visual language is
 * dark card stock and gold rule — it read as a web badge dropped onto the table. Here the colour
 * is carried by the faction's own ship token and by the lettering, and the plate itself is the
 * same gold hairline as everything else, with the corner radii deliberately uneven so the edge
 * reads as cut by hand rather than by a border-radius.
 */
function NamePlate({ faction, mini = false }: { faction: FactionId; mini?: boolean }): JSX.Element {
  const ship = figureArt(faction, 'ship')
  return (
    <span
      className={`pb-name${mini ? ' mini' : ''}`}
      style={{ ['--faction']: colorOf(faction) } as React.CSSProperties}
    >
      {ship !== null ? <img className="pb-name-mark" src={ship} alt="" /> : null}
      <span className="pb-name-text">{faction}</span>
    </span>
  )
}
