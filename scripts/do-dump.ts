/**
 * Read a local Durable Object's storage.
 *
 *   npm run do:dump                    # list every local game
 *   npm run do:dump -- <gameId>        # dump one game's journal (a unique prefix will do)
 *
 * ## This used to need explaining at length
 *
 * The object stored its journal through the key-value API, which lands in a reserved `__cf_kv`
 * table that Cloudflare excludes from SQL — so a deployed game could not be read at all, and even
 * locally the values came back V8-serialized rather than as text. This script existed largely to
 * work around that.
 *
 * The object now uses ordinary tables (`game`, `seat`, `journal`), so most of that is gone: the
 * values are text, the index is an integer, and **the same queries work against a deployed object
 * from the dashboard**. What is left here is convenience — finding which file is which game, and
 * printing a journal without typing SQL.
 *
 * Seat tokens are still withheld. They are the credential (docs/17 section 3), and a debug tool
 * printing everything it can see is exactly where they would leak by accident.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Named after the Worker in `wrangler.toml`; renaming that renames this directory. */
const DIR = 'packages/server/.wrangler/state/v3/do/open-arcs-GameObject'

/** One `sqlite3` query, tab-separated. Shelling out beats a dependency for a look-at-it script. */
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
 * The directory holds more than game objects — miniflare keeps its own `metadata.sqlite` — and an
 * object that was addressed but never written has no tables. Both are ordinary states.
 */
const hasTable = (file: string, table: string): boolean =>
  cell(file, `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='${table}'`) === '1'

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
    // -1 marks an object addressed but never written, which is not the same as an empty journal.
    const count = hasTable(file, 'journal')
      ? Number(cell(file, 'SELECT count(*) FROM journal') ?? 0)
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
  console.log(`options ${cell(file, 'SELECT options FROM game WHERE id = 1') ?? '(none)'}`)
  console.log(
    `seats   ${query(file, 'SELECT faction FROM seat ORDER BY ord')
      .map((r) => r[0])
      .join(', ')}  (tokens withheld)`,
  )
  console.log()
  for (const [idx, action] of query(file, 'SELECT idx, action FROM journal ORDER BY idx')) {
    console.log(`${String(idx).padStart(6, '0')}  ${action}`)
  }
}
