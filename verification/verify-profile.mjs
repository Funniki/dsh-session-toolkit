/**
 * Post-install verification for one DSH profile.
 *
 * Answers the three questions an installer must be able to answer, from the
 * profile's own point of view (which is where the loader resolves bundle rows):
 *
 *   1. does the profile record the pack as a dependency and register it as a
 *      bundle? (the five components arrive as the pack's own dependencies, and
 *      point 2 below is what actually proves they landed)
 *   2. does every row's host half actually import from the profile root — the
 *      exact place the loader resolves it, and the exact place a missing
 *      component shows up as `ERR_MODULE_NOT_FOUND`?
 *   3. did the install drag any third-party package into the profile (the 2.3.x
 *      releases bundled a copy of the Harness core; two cores in one process is
 *      what killed every tool call)?
 *
 * Usage:
 *   node verification/verify-profile.mjs [--profile <name>]   (default: desktop)
 *
 * Exit code 0 means the install is sound; 1 lists every problem found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACK = '@funniki/dsh-session-toolkit'
const COMPONENTS = [
  `${PACK}-archived-session-delete`,
  `${PACK}-session-move`,
  `${PACK}-unsent-content-guard`,
  `${PACK}-session-history-search`,
  `${PACK}-auto-paste`
]

const argumentIndex = process.argv.indexOf('--profile')
const profileName = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : 'desktop'
const dshHome = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)

let failures = 0
/** Report one check. @param ok - did it pass. @param text - what was checked. */
function check(ok, text) {
	if (!ok) failures += 1
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`)
}

if (!existsSync(join(profileDir, 'package.json'))) {
	console.error(`profile "${profileName}" does not exist (${profileDir})`)
	process.exit(1)
}
const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
const dependencies = Object.keys(manifest.dependencies ?? {})
const bundles = manifest.dsh?.profile?.bundles ?? []
const expected = [PACK, ...COMPONENTS]

console.log(`profile: ${profileName} (${profileDir})`)
check(dependencies.includes(PACK), `records ${PACK} as a dependency`)
check(bundles.includes(PACK), `${PACK} is registered as a bundle`)

const require = createRequire(`${profileDir.replace(/\\/g, '/')}/`)
for (const name of expected) {
	try {
		const entry = require.resolve(name)
		const manifestPath = require.resolve(`${name}/package.json`)
		const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version
		const host = await import(pathToFileURL(entry))
		const shapeOk = name === PACK || (typeof host.apply === 'function' && typeof host.name === 'string')
		check(shapeOk, `${name}@${version} resolves and imports from the profile`)
	} catch (error) {
		check(false, `${name} failed to import: ${error.code ?? ''} ${String(error.message).split('\n')[0]}`)
	}
}

const declaredDirectly = COMPONENTS.filter((name) => dependencies.includes(name))
if (declaredDirectly.length < COMPONENTS.length) {
	console.log(
		`     components declared as profile dependencies: ${declaredDirectly.length}/5 — the rest arrive through the pack`
	)
}

const nodeModules = join(profileDir, 'node_modules')
// List what else lives at the profile root, understanding scope directories:
// a scoped component sits at node_modules/@scope/name, not node_modules/name.
const stray = []
if (existsSync(nodeModules)) {
	for (const entry of readdirSync(nodeModules)) {
		if (entry.startsWith('.')) continue
		if (entry.startsWith('@')) {
			for (const child of readdirSync(join(nodeModules, entry))) {
				const name = entry + '/' + child
				if (!expected.includes(name)) stray.push(name)
			}
			continue
		}
		if (!expected.includes(entry)) stray.push(entry)
	}
}
// Informational only: a real user's profile carries other plugins, and those are
// not this package's business. A FRESH profile that shows nothing here is the
// interesting case, and the duplicate-core check below is the hard requirement.
console.log(`     other packages in this profile: ${stray.join(', ') || 'none'}`)
check(
	!existsSync(join(nodeModules, '@deepseek-ai', 'dsh-tools')),
	'no duplicate Harness core in the profile'
)

console.log(failures === 0 ? '\ninstall verified' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
