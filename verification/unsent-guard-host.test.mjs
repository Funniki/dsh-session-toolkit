/**
 * Host-level round-trip test for the unsent-content guard.
 *
 * The live symptom was: an image was backed up, the user switched Sessions, and
 * the restore died with a bare-text HTTP 400 from the HTTP layer. That leaves the
 * storage logic as the prime suspect, so this test drives the REAL route handlers
 * in-process — save-image → list → read-image → discard — against a throwaway
 * root, and fails loudly if the round trip cannot be reconstructed.
 *
 * It also pins the two contracts the client depends on:
 *   - list entries really carry `draftId` (the restore path posts it back),
 *   - every refusal carries a `message` (the client shows it instead of "HTTP n").
 *
 * Usage: node verification/unsent-guard-host.test.mjs
 */

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const HOST = require('node:path').resolve(
  new URL('../components/dsh-unsent-content-guard/lib/host-v106.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
)

let failures = 0
/** @param ok - did it pass. @param text - what was checked. */
function check(ok, text) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`)
}

const root = mkdtempSync(join(tmpdir(), 'unsent-guard-'))
const routes = new Map()

const connectionService = {
  fetch: {
    register(spec) {
      routes.set(spec.path, spec)
      return () => {}
    }
  }
}

const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get(name) {
    return name === 'connection' ? connectionService : undefined
  },
  on() {
    return () => {}
  },
  logger: { warn() {}, info() {}, debug() {} },
  connection: {
    fetch: {
      register(spec) {
        routes.set(spec.path, spec)
        return () => {}
      }
    }
  }
}

const { apply } = await import(`file://${HOST}`)
apply(ctx, { root, retainDays: 1 })

check(routes.size === 7, `registered 7 routes (got ${routes.size})`)

/** @param path - route path. @param body - JSON payload. @returns parsed response and status. */
async function post(path, body) {
  const spec = routes.get(path)
  if (spec === undefined) throw new Error(`route ${path} was not registered`)
  const response = await spec.fetch(
    new Request(`http://local${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = undefined
  }
  return { status: response.status, payload, text }
}

// A real 1x1 PNG, so media sniffing and size limits behave like production.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const DRAFT = 'draft-roundtrip-1'
const SESSION = 'session-roundtrip-1'

const saved = await post('/api/unsent-content/save-image', {
  sessionId: SESSION,
  draftId: DRAFT,
  name: 'pixel.png',
  mediaType: 'image/png',
  data: PNG.toString('base64')
})
check(saved.status === 200 && saved.payload?.ok === true, `save-image accepts the draft (${saved.status})`)

const listed = await post('/api/unsent-content/list', {})
check(listed.status === 200, `list answers (${listed.status})`)
const entries = Array.isArray(listed.payload?.entries) ? listed.payload.entries : []
const entry = entries.find((candidate) => candidate.kind === 'image' && candidate.draftId === DRAFT)
check(entry !== undefined, 'list returns the saved image entry')
check(entry?.draftId === DRAFT, `list entry carries draftId (got ${JSON.stringify(entry?.draftId)})`)
check(entry?.sessionId === SESSION, `list entry carries its sessionId (got ${JSON.stringify(entry?.sessionId)})`)

const read = await post('/api/unsent-content/read-image', { draftId: DRAFT })
check(read.status === 200 && read.payload?.ok === true, `read-image returns the bytes (${read.status})`)
check(
  typeof read.payload?.data === 'string' && Buffer.from(read.payload.data, 'base64').equals(PNG),
  'read-image bytes match what was saved'
)

// Every refusal the client can see must carry a message; a bare status is what
// made the live failure unreadable ("HTTP 400" with no clue which call failed).
const missing = await post('/api/unsent-content/read-image', { draftId: 'does-not-exist' })
check(missing.status === 404, `read-image 404s for an unknown draft (${missing.status})`)
check(typeof missing.payload?.message === 'string', 'refusals carry a message')

const malformed = await post('/api/unsent-content/read-image', { draftId: '' })
check(malformed.status === 400, `read-image 400s for an empty draftId (${malformed.status})`)
check(typeof malformed.payload?.message === 'string', 'the 400 carries a message too')

const discarded = await post('/api/unsent-content/discard', { draftIds: [DRAFT] })
check(discarded.status === 200 && discarded.payload?.ok === true, `discard accepts the draft (${discarded.status})`)
const after = await post('/api/unsent-content/list', {})
const leftovers = (after.payload?.entries ?? []).filter((candidate) => candidate.draftId === DRAFT)
check(leftovers.length === 0, 'the discarded draft is gone from list')

rmSync(root, { recursive: true, force: true })
console.log(failures === 0 ? '\nhost round trip verified' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
