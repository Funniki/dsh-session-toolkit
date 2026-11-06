/**
 * Behavioral test for the zero-dependency rewrite of dsh-auto-paste.
 *
 * Not a Harness test: it imports the Host module directly and hands it a fake
 * plugin context, so the whole contract (route envelopes, file layout, threshold
 * persistence, tool schema) is checked without starting DSH.
 *
 * Run: node verification/auto-paste-zero-dep.test.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'auto-paste-home-'))
const WORKSPACE = mkdtempSync(join(tmpdir(), 'auto-paste-ws-'))
const OTHER_WORKSPACE = mkdtempSync(join(tmpdir(), 'auto-paste-ws2-'))
process.env.DSH_HOME = HOME

const modulePath = new URL(
  '../components/dsh-auto-paste/lib/host.js',
  import.meta.url
)
const host = await import(modulePath)
const source = readFileSync(new URL(modulePath), 'utf8')

let failures = 0
const checks = []

async function check(label, fn) {
  try {
    await fn()
    checks.push(`ok   ${label}`)
  } catch (error) {
    failures += 1
    checks.push(`FAIL ${label}\n       ${error.message}`)
  }
}

// ---- fake plugin context ---------------------------------------------------

const routes = new Map()
const tools = new Map()
const disposers = []

const sessions = {
  get(id) {
    if (id === 's1') return { header: { cwd: WORKSPACE } }
    if (id === 's2') return { header: { cwd: OTHER_WORKSPACE } }
    return undefined
  }
}

const ctx = {
  logger: { warn() {}, info() {}, error: console.error },
  get(service) {
    if (service === 'connection') {
      return {
        fetch: {
          register(spec) {
            routes.set(spec.path, spec)
            return () => routes.delete(spec.path)
          }
        }
      }
    }
    if (service === 'tools') {
      return {
        register(definition) {
          tools.set(definition.name, definition)
          return () => tools.delete(definition.name)
        },
        get(name) {
          return tools.get(name)
        }
      }
    }
    if (service === 'sessions') return sessions
    if (service === 'workspaceRegistry') {
      return {
        list: () => [
          { path: WORKSPACE, sessionIds: ['s1'], id: 'ws1' },
          { path: OTHER_WORKSPACE, sessionIds: ['s2'], id: 'ws2' }
        ]
      }
    }
    return undefined
  },
  effect(fn) {
    const disposer = fn()
    disposers.push(disposer)
  }
}

const config = { minChars: 4, maxBytes: 4096 }
host.apply(ctx, config)

function post(path, body) {
  const route = routes.get(path)
  assert.ok(route !== undefined, `route ${path} is not registered`)
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')
  return route.fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }))
}

// ---- verification ----------------------------------------------------------

await check('zero package imports in the host half', () => {
  const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gmu)].map((m) => m[1])
  assert.ok(imports.length > 0, 'expected node: imports')
  for (const specifier of imports) {
    assert.ok(specifier.startsWith('node:'), `non-builtin import: ${specifier}`)
  }
  assert.equal(/require\s*\(/u.test(source), false, 'host half must not require anything')
})

const clientSource = readFileSync(
  new URL('../components/dsh-auto-paste/dist/client.js', import.meta.url),
  'utf8'
)

await check('client half requires react and nothing else', () => {
  const requires = [...clientSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu)].map((m) => m[1])
  assert.deepEqual([...new Set(requires)], ['react'])
  assert.equal(/^\s*import\s/mu.test(clientSource), false, 'client half must not use static imports')
})

await check('plugin name and injects', () => {
  assert.equal(host.name, 'dsh-auto-paste')
  assert.deepEqual(host.inject, ['connection', 'tools', 'sessions'])
})

await check('three routes registered', () => {
  assert.deepEqual([...routes.keys()].sort(), [
    '/api/auto-paste.config',
    '/api/auto-paste.save',
    '/api/auto-paste.threshold'
  ])
})

await check('save writes a Markdown paste into pastes/', async () => {
  const response = await post('/api/auto-paste.save', { text: '# 标题\n\n正文内容', sessionId: 's1' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.path, 'pastes/标题.md')
  assert.equal(body.chars, 10)
  assert.ok(body.bytes > 0)
  const written = readFileSync(join(WORKSPACE, body.path), 'utf8')
  assert.equal(written, '# 标题\n\n正文内容')
  // Windows has no POSIX permission bits: the 0o600 request is honoured only where
  // the platform has them, so the assertion is platform-scoped rather than dropped.
  if (process.platform !== 'win32') {
    const mode = statSync(join(WORKSPACE, body.path)).mode & 0o777
    assert.equal(mode.toString(8), '600', `file mode ${mode.toString(8)}`)
  }
})

await check('plain prose lands as .txt', async () => {
  const response = await post('/api/auto-paste.save', { text: 'just a sentence about nothing', sessionId: 's1' })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.ok(body.path.endsWith('.txt'), body.path)
})

await check('a name collision is renamed, never overwritten', async () => {
  const first = await (await post('/api/auto-paste.save', { text: 'duplicate body text', sessionId: 's1' })).json()
  const second = await (await post('/api/auto-paste.save', { text: 'duplicate body text', sessionId: 's1' })).json()
  assert.equal(first.path, 'pastes/duplicate-body-text.txt')
  assert.equal(second.path, 'pastes/duplicate-body-text-1.txt')
  assert.equal(readFileSync(join(WORKSPACE, first.path), 'utf8'), 'duplicate body text')
})

await check('the session workspace directory wins over the registry guess', async () => {
  const response = await post('/api/auto-paste.save', { text: 'other workspace note', sessionId: 's2' })
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.ok(
    readdirSync(join(OTHER_WORKSPACE, 'pastes')).includes(body.path.replace('pastes/', '')),
    `expected the paste under ${OTHER_WORKSPACE}`
  )
})

await check('an unknown session is refused with 409 and writes nothing', async () => {
  const response = await post('/api/auto-paste.save', { text: 'orphan paste text', sessionId: 'nope' })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.error, 'no-workspace')
})

await check('a paste above maxBytes is refused, not truncated', async () => {
  const response = await post('/api/auto-paste.save', { text: 'x'.repeat(5000), sessionId: 's1' })
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.match(body.message, /exceeds the 4096-byte limit/u)
})

await check('a body that is not JSON is a 400', async () => {
  const route = routes.get('/api/auto-paste.save')
  const response = await route.fetch(new Request('http://local/api/auto-paste.save', {
    method: 'POST',
    body: 'not json'
  }))
  assert.equal(response.status, 400)
})

await check('config reports the deployment default', async () => {
  const response = await post('/api/auto-paste.config', {})
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body, {
    minChars: 4,
    maxBytes: 4096,
    minCharsSource: 'deployment',
    deploymentMinChars: 4,
    canConfigure: true
  })
})

await check('threshold writes persist to $DSH_HOME/auto-paste/user-config.json', async () => {
  const response = await post('/api/auto-paste.threshold', { value: 12 })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.minChars, 12)
  assert.equal(body.minCharsSource, 'user')
  const stored = JSON.parse(readFileSync(join(HOME, 'auto-paste', 'user-config.json'), 'utf8'))
  assert.deepEqual(stored, { minChars: 12 })
})

await check('a stored threshold survives a fresh module instance', async () => {
  const fresh = await import(new URL(`${modulePath.href}?fresh=1`))
  const listed = await new Promise((done) => {
    const localRoutes = new Map()
    fresh.apply({
      logger: { warn() {} },
      get(service) {
        if (service === 'connection') return { fetch: { register: (spec) => (localRoutes.set(spec.path, spec), () => {}) } }
        if (service === 'tools') return { register: () => () => {}, get: () => undefined }
        if (service === 'sessions') return sessions
        if (service === 'workspaceRegistry') return { list: () => [] }
        return undefined
      },
      effect(fn) {
        fn()
      }
    }, config)
    localRoutes.get('/api/auto-paste.config').fetch(new Request('http://local/x', { method: 'POST', body: '{}' }))
      .then((response) => response.json())
      .then(done)
  })
  assert.equal(listed.minChars, 12)
  assert.equal(listed.minCharsSource, 'user')
})

await check('clearing the threshold restores the deployment default', async () => {
  const response = await post('/api/auto-paste.threshold', { value: null })
  const body = await response.json()
  assert.equal(body.minChars, 4)
  assert.equal(body.minCharsSource, 'deployment')
  const stored = JSON.parse(readFileSync(join(HOME, 'auto-paste', 'user-config.json'), 'utf8'))
  assert.deepEqual(stored, {})
})

await check('an invalid threshold is refused and stores nothing', async () => {
  for (const value of [0, -3, 1.5, '9', true]) {
    const response = await post('/api/auto-paste.threshold', { value })
    assert.equal(response.status, 400, `value ${JSON.stringify(value)} should be refused`)
  }
})

await check('save_paste is registered with the tool contract the registry expects', () => {
  const tool = tools.get('save_paste')
  assert.ok(tool !== undefined, 'save_paste is not registered')
  assert.equal(tool.parameters.type, 'object')
  assert.deepEqual(tool.parameters.required, ['text'])
  assert.equal(tool.parameters.properties.label.type, 'string')
  assert.equal(tool.output.schema.additionalProperties, false)
  assert.deepEqual(tool.output.schema.required, ['path', 'bytes', 'chars'])
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.execute, 'function')
  const rendered = tool.output.render({}, { path: 'pastes/a.md', bytes: 12, chars: 10 })
  assert.equal(rendered[0].type, 'text')
  assert.match(rendered[0].text, /pastes\/a\.md/u)
})

await check('save_paste writes through the calling session workspace', async () => {
  const tool = tools.get('save_paste')
  const value = await tool.execute(
    { text: '- one\n- two', label: 'list' },
    { agent: { session: { header: { cwd: WORKSPACE } } } }
  )
  assert.equal(value.path, 'pastes/one-list.md')
  assert.equal(readFileSync(join(WORKSPACE, value.path), 'utf8'), '- one\n- two')
  assert.equal('absolutePath' in value, false, 'the model-facing value must not leak the absolute path')
})

await check('save_paste refuses an invalid label', async () => {
  const tool = tools.get('save_paste')
  await assert.rejects(
    () => tool.execute({ text: 'body', label: 'bad label!' }, { agent: { session: { header: { cwd: WORKSPACE } } } }),
    /label/u
  )
})

await check('save_paste refuses a directory outside the registry', async () => {
  const stray = mkdtempSync(join(tmpdir(), 'auto-paste-stray-'))
  const tool = tools.get('save_paste')
  await assert.rejects(
    () => tool.execute({ text: 'stray', label: 'x' }, { agent: { session: { header: { cwd: stray } } } }),
    /outside a registered workspace/u
  )
})

await check('helpers keep their documented behaviour', () => {
  assert.equal(host.looksMarkdown('# h'), true)
  assert.equal(host.looksMarkdown('plain words'), false)
  assert.equal(host.looksMarkdown('```js\ncode\n```'), true)
  assert.equal(host.pasteFilename('Hello World', 'txt'), 'Hello-World.txt')
  assert.equal(host.pasteFilename('', 'txt'), 'paste.txt')
  assert.equal(host.effectiveMinChars(undefined, 300).source, 'deployment')
  assert.equal(host.effectiveMinChars(700, 300).minChars, 700)
  assert.equal(host.resolveMinChars(undefined), 500)
  assert.throws(() => host.resolveMaxBytes(host.MAX_PASTE_BYTES_CAP + 1))
  assert.throws(() => host.sanitizeLabel('a'.repeat(33)))
})

await check('every route disposer runs without throwing', () => {
  for (const dispose of disposers) if (typeof dispose === 'function') dispose()
})

// ---- report ----------------------------------------------------------------

for (const line of checks) console.log(line)
console.log(failures === 0 ? `\n${checks.length} checks passed` : `\n${failures} check(s) FAILED`)

rmSync(HOME, { recursive: true, force: true })
rmSync(WORKSPACE, { recursive: true, force: true })
rmSync(OTHER_WORKSPACE, { recursive: true, force: true })
process.exit(failures === 0 ? 0 : 1)
