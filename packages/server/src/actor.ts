/**
 * Who an encoded action says it is by.
 *
 * The server needs this to refuse an action published from the wrong seat, and it has to get there
 * **without importing the engine** (docs/17 section 4b rule 4). The journal encoding is
 * `type(key=json,key=json,…)` with keys sorted, and every player-chosen action carries `faction`.
 * That is enough to read the actor off the string.
 *
 * ## Why a scanner and not a regex
 *
 * `/faction="([^"]*)"/` passes every test that was written against it, and it is wrong. It survives
 * on two coincidences: keys are sorted, so the real `faction=` is usually the first thing matching;
 * and a nested action serialises as JSON, so its faction reads `"faction":` with a colon and slips
 * past. Neither holds for a field whose *name ends in* `faction` and sorts ahead of it —
 *
 *     t(attackerfaction="blue",faction="red")
 *
 * — where the regex reports the defender as the actor. Once a battle action names both sides that
 * is not a hypothetical, and the failure is the bad kind: legal moves refused, forged ones accepted.
 *
 * So this splits the fields properly, tracking string and bracket depth, and matches the field
 * *name* rather than a shape in the text.
 *
 * ## It fails open, on purpose
 *
 * Anything unparseable returns `undefined`, and the caller treats that as "no claim about who acted"
 * and stores the string unchanged. The server's whole value is that it holds opaque strings
 * (`store.ts`), and an action with no readable actor is not a useful attack: the engine routes on
 * `faction`, so a stripped one does not replay as a legal move for anybody.
 *
 * This duplicates the field-splitting rule in the engine's `decodeAction`, which is a real drift
 * risk — so `apps/web/test/seat-enforcement.test.ts` runs this over thousands of actions generated
 * by the actual encoder rather than over hand-written strings.
 */

/** The `faction` field of an encoded action, or `undefined` if it does not carry a readable one. */
export function actorOf(encoded: string): string | undefined {
  const open = encoded.indexOf('(')
  const close = encoded.lastIndexOf(')')
  if (open === -1 || close < open) return undefined

  for (const field of topLevelFields(encoded.slice(open + 1, close))) {
    const eq = field.indexOf('=')
    if (eq === -1 || field.slice(0, eq) !== 'faction') continue
    try {
      const value: unknown = JSON.parse(field.slice(eq + 1))
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Split on commas that are not inside a JSON string or a bracketed value. */
function topLevelFields(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let inString = false
  let escaped = false
  let start = 0

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!
    if (escaped) {
      escaped = false
    } else if (ch === '\\') {
      escaped = true
    } else if (ch === '"') {
      inString = !inString
    } else if (!inString) {
      if (ch === '[' || ch === '{') depth++
      else if (ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) {
        out.push(body.slice(start, i))
        start = i + 1
      }
    }
  }
  out.push(body.slice(start))
  return out
}
