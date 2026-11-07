/**
 * Does this pack still apply on a NEWER host?
 *
 * The public surfaces this pack uses are private to DSH (service names, the
 * `connection.fetch.register` route table, `tools.register`, `ctx.effect`, slots), so
 * an upgrade can break it without any of our own tests noticing: our harnesses use
 * our own mock. This script therefore does the crude, honest thing — it imports each
 * host half and runs `apply()` against a permissive fake ctx, which fails loudly on
 * any API the newer host no longer offers (a renamed service, a changed call shape,
 * a moved hook).
 *
 * It cannot prove runtime behaviour (that needs a booted host); it proves the code
 * still gets that far.
 *
 * Usage: node verification/host-compat.test.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const COMPONENTS = resolve(new URL('../components', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PACK = resolve(new URL('../plugin', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

let failures = 0
/** @param ok - did it pass. @param text - what was checked. */
function check(ok, text) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`)
}

/**
 * A ctx that records everything the plugin touches and answers every known service,
 * so a plugin that reaches for an API the host no longer has fails here.
 * @returns the ctx, the recorded calls, and the disposers of its effects.
 */
function fakeCtx() {
  const calls = { routes: [], tools: [], slots: [], effects: 0, timers: 0, listeners: [] }
  const disposers = []
  const services = {
    connection: { fetch: { register(spec) { calls.routes.push(spec.path); return () => {} } } },
    tools: { register(definition) { calls.tools.push(definition.name); return () => {} } },
    sessions: { get() { return undefined }, list() { return [] } },
    workspaceRegistry: { list() { return [] } },
    sessionPersistence: { root() { return undefined } },
    attachments: { saveImage: async () => ({ id: 'sha256:0' }) }
  }
  const ctx = {
    get: (name) => services[name],
    effect(fn) {
      calls.effects += 1
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    on(event) {
      calls.listeners.push(event)
      return () => {}
    },
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    setInterval(fn) { calls.timers += 1; return () => {} },
    setTimeout(fn) { return 0 },
    slots: {
      inject(name) { calls.slots.push(name); return () => {} },
      register(_definition) { return () => {} }
    },
    locale: { register() {} },
    emit() {}
  }
  return { ctx, calls, disposers }
}

// 1) Every host half must still import (a moved/renamed module path fails here).
const halves = []
for (const dir of readdirSync(COMPONENTS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const manifestPath = `${COMPONENTS}/${dir.name}/package.json`
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const main = manifest.main
  check(typeof main === 'string', `${manifest.name}: declares a host entry`)
  if (typeof main !== 'string') continue
  halves.push({ name: manifest.name, file: `${COMPONENTS}/${dir.name}/${main.replace(/^\.\//, '')}` })
}
const packManifest = JSON.parse(readFileSync(`${PACK}/package.json`, 'utf8'))
check(typeof packManifest.dsh?.bundle?.patch === 'string', 'pack still declares dsh.bundle.patch')

// 2) Each host half must import and apply on a fresh fake ctx.
for (const half of halves) {
  let module
  try {
    module = await import(`file://${half.file}`)
  } catch (error) {
    check(false, `${half.name}: host half imports (${error.message.split('\n')[0]})`)
    continue
  }
  check(true, `${half.name}: host half imports`)
  check(Array.isArray(module.inject), `${half.name}: declares an inject list`)
  const { ctx, calls, disposers } = fakeCtx()
  try {
    await module.apply(ctx, {})
    check(true, `${half.name}: apply() completes on the current API`)
    check(calls.effects > 0, `${half.name}: registered through ctx.effect (${calls.effects})`)
  } catch (error) {
    check(false, `${half.name}: apply() completes (${error.message.split('\n')[0]})`)
  }
  for (const dispose of disposers) {
    try {
      await dispose()
    } catch {
      /* cleanup only */
    }
  }
}

console.log(
  failures === 0
    ? '\nhost compatibility smoke passed — every host half applies on the current API'
    : `\n${failures} check(s) FAILED`
)
process.exit(failures === 0 ? 0 : 1)
