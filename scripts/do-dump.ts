/**
 * Read a local Durable Object's storage, as text.
 *
 *   npm run do:dump                    # list every local game
 *   npm run do:dump -- <gameId>        # dump one game's journal (a unique prefix will do)
 *
 * ## Why this is needed at all
 *
 * `SELECT * FROM GAMES` is the natural first attempt and it cannot work: `GAMES` is the *binding*
 * name for the Durable Object namespace, not a table. There is no table by that name anywhere.
 *
 * A SQLite-backed Durable Object using the key-value storage API — `storage.get`/`put`/`list`, which
 * is all `game-object.ts` uses — keeps everything in one hidden reserved table instead. Cloudflare
 * calls it `__cf_kv` and says of it: you can see it when listing tables, but **not read it through
 * the SQL API**. So in production there is no query that returns this data. That is not a gap to
 * work around; it is the storage API being honest that SQL is not its interface.
 *
 * Values are **V8-serialized** as well, not JSON or UTF-8 — `SELECT value` would hand back bytes
 * with an `FF 0F` header. `v8.deserialize` is the decoder, and no amount of SQL substitutes for it.
 *
 * ## So this script is local only, and production has a different answer
 *
 * `wrangler dev` writes `.wrangler/state`, where miniflare emulates the same storage in a table it
 * spells `_cf_KV` and does *not* block from SQL — which is the only reason reading it here works.
 * Do not carry that inference to the deployed objects.
 *
 * For a deployed game, the API it already has is the interface:
 *
 *     curl https://<worker>/games/<gameId>?since=0
 *
 * which returns the same journal this prints. That is the only interface the design promises
 * (docs/17 rule 2), and wanting more than it in production is a sign to write a debug endpoint
 * deliberately rather than to reach through the storage layer.
 *
 * ## Layout
 *
 * One object per game (docs/17 section 4b), so one `.sqlite` file per game — named by object id
 * rather than by game id, with miniflare keeping the mapping in its own `__miniflare_do_name` table.
 * A file with no KV table is an object that was addressed but never written to, which is an ordinary
 * state: reading a game that does not exist still instantiates an object for that name. It is listed
 * as empty rather than treated as an error.
 */

import { deserialize } from 'node:v8'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const DIR = 'packages/server/.wrangler/state/v3/do/arcs-multiplayer-GameObject'

/**
 * One `sqlite3` query, as rows of columns.
 *
 * Tab-separated rather than the default `|`, which is safe for every column read here: keys are
 * `meta` or `j:NNNNNN`, names are UUIDs, and values are always asked for as `hex()`. Shelling out
 * rather than taking a SQLite dependency, for a script that exists to look at a directory by hand.
 */
function query(file: string, sql: string): string[][] {
  const out = execFileSync('sqlite3', ['-separator', '\t', file, sql], { encoding: 'utf8' })
  return out
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'))
}

const cell = (file: string, sql: string): string | undefined => query(file, sql)[0]?.[0]

/**
 * Whether a table exists, asked before every query that assumes one.
 *
 * The directory holds more than game objects — miniflare keeps its own `metadata.sqlite` alongside
 * them — and an object that was addressed but never written has no `_cf_KV`. Both are ordinary
 * states, so they are filtered rather than allowed to throw.
 */
const hasTable = (file: string, table: string): boolean =>
  cell(file, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='${table}'`) === '1'

/** Decode one stored value: strings come back as strings, `meta` as an object. */
const decode = (hex: string): unknown => deserialize(Buffer.from(hex, 'hex'))

if (!existsSync(DIR)) {
  console.error(`No local Durable Object state at ${DIR}`)
  console.error('Run `npm run serve` and play a game first.')
  process.exit(1)
}

const games = readdirSync(DIR)
  .filter((f) => f.endsWith('.sqlite'))
  .map((f) => join(DIR, f))
  .filter((file) => hasTable(file, '__miniflare_do_name'))
  .map((file) => {
    const name = cell(file, 'SELECT name FROM __miniflare_do_name') ?? '(unnamed)'
    // -1 marks an object that was addressed but never written, which is not the same as empty.
    const count = hasTable(file, '_cf_KV')
      ? Number(cell(file, "SELECT count(*) FROM _cf_KV WHERE key LIKE 'j:%'") ?? 0)
      : -1
    return { file, name, count }
  })

const wanted = process.argv[2]

if (wanted === undefined) {
  const live = games.filter((g) => g.count >= 0)
  console.log(`${games.length} local object(s), ${live.length} with storage — ${DIR}\n`)
  for (const g of games.sort((a, b) => b.count - a.count)) {
    console.log(`  ${g.name}  ${g.count < 0 ? '   (empty)' : `${String(g.count).padStart(4)} actions`}`)
  }
  console.log('\nPass a game id (or a unique prefix) to dump its journal.')
} else {
  const match = games.filter((g) => g.name.startsWith(wanted) && g.count >= 0)
  if (match.length !== 1) {
    console.error(`${match.length === 0 ? 'No' : `${match.length} ambiguous`} games match "${wanted}"`)
    process.exit(1)
  }
  const { file, name, count } = match[0]!
  console.log(`game    ${name}`)
  console.log(`actions ${count}`)

  const meta = cell(file, "SELECT hex(value) FROM _cf_KV WHERE key='meta'")
  if (meta !== undefined) {
    const m = decode(meta) as { options: unknown; seats: readonly { faction: string }[] }
    console.log(`options ${JSON.stringify(m.options)}`)
    // Seat tokens are deliberately not printed: they are the credential (docs/17 section 3).
    console.log(`seats   ${m.seats.map((s) => s.faction).join(', ')}  (tokens withheld)`)
  }
  console.log()

  const rows = query(file, "SELECT key, hex(value) FROM _cf_KV WHERE key LIKE 'j:%' ORDER BY key")
  for (const [key, hex] of rows) {
    console.log(`${key!.slice(2)}  ${String(decode(hex!))}`)
  }
}
