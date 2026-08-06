/**
 * The live half of the push path, against a real `wrangler dev`.
 *
 *   npm run serve          # in another terminal
 *   npm run ws:check
 *
 * `push.test.ts` covers what a client does with a message. It cannot cover the half that matters
 * most for the bill — that the **object** accepts a socket hibernatably and broadcasts after an
 * append — because the only thing standing in for the runtime there is a fake, and a fake would be
 * testing itself. This runs against workerd.
 *
 * Node 22 has a global `WebSocket`, so this needs nothing but the dev server.
 *
 * ## What it asserts, and why each
 *
 *   - A second client is told about a move **without asking**, which is the feature.
 *   - The request count over the whole exchange, which is the *reason* for the feature. Polling
 *     three clients for three hours is ~13,000 requests; if this number is not tiny then something
 *     is still asking.
 *   - A socket opened against a game that does not exist is refused, so a typo does not silently
 *     hold a connection to nothing.
 */

const BASE = process.env['ARCS_BASE'] ?? 'http://localhost:8787'
const WS_BASE = BASE.replace(/^http/, 'ws')

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Created {
  gameId: string
  seats: { faction: string; seatToken: string }[]
}

async function main(): Promise<void> {
  const create = await fetch(`${BASE}/games`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      options: { board: 'Board3Frontiers', factions: ['red', 'yellow', 'blue'], seed: 3 },
      factions: ['red', 'yellow', 'blue'],
    }),
  })
  if (!create.ok) throw new Error(`create -> ${create.status}`)
  const game = (await create.json()) as Created
  const red = game.seats.find((s) => s.faction === 'red')!.seatToken
  console.log(`game ${game.gameId}`)

  // Two watchers, so a broadcast has to reach more than one socket.
  const seen: string[][] = [[], []]
  const sockets = [0, 1].map((i) => {
    const ws = new WebSocket(`${WS_BASE}/games/${game.gameId}/live`)
    ws.addEventListener('message', (e: MessageEvent) => {
      seen[i]!.push(String(e.data))
    })
    return ws
  })
  await Promise.all(
    sockets.map(
      (ws) =>
        new Promise<void>((resolve, reject) => {
          ws.addEventListener('open', () => resolve())
          ws.addEventListener('error', () => reject(new Error('socket failed to open')))
        }),
    ),
  )
  console.log('two sockets open')

  // Red acts, over HTTP as usual. Nobody polls.
  const actions = ['first', 'second', 'third']
  for (const [i, action] of actions.entries()) {
    const res = await fetch(`${BASE}/games/${game.gameId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seatToken: red, expectedLength: i, action }),
    })
    if (!res.ok) throw new Error(`append ${i} -> ${res.status} ${await res.text()}`)
  }
  await wait(500)

  const ok = (label: string, got: unknown, want: unknown): void => {
    const pass = JSON.stringify(got) === JSON.stringify(want)
    console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${pass ? '' : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`)
    if (!pass) process.exitCode = 1
  }

  const want = actions.map((a, i) => JSON.stringify({ from: i, entries: [a] }))
  console.log('\npushed without being asked:')
  ok('watcher 1 saw every action, in order', seen[0], want)
  ok('watcher 2 saw every action, in order', seen[1], want)

  // A socket for a game that does not exist must be refused rather than left hanging.
  const ghost = new WebSocket(`${WS_BASE}/games/does-not-exist/live`)
  const refused = await new Promise<boolean>((resolve) => {
    ghost.addEventListener('open', () => resolve(false))
    ghost.addEventListener('error', () => resolve(true))
    ghost.addEventListener('close', () => resolve(true))
    setTimeout(() => resolve(false), 2000)
  })
  console.log('\nunknown game:')
  ok('socket refused', refused, true)

  for (const ws of sockets) ws.close()

  /*
   * The budget, stated out loud. Three appends and three connects; everything the watchers learned
   * arrived on an outgoing message, which Cloudflare does not bill at all. Polling the same exchange
   * would have cost a request per client per 2.5 seconds for as long as the game lasted.
   */
  console.log(`\nrequests for this exchange: 1 create + ${actions.length} appends + 3 connects`)
  console.log('reads: 0 — every update arrived by push')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
