#!/usr/bin/env node
/**
 * Verify a RELEASE the way a user receives it.
 *
 * The failures that reached users were never visible in the working tree:
 *   0.1.2 shipped client bundles that still registered the PRE-RENAME module id,
 *   so every UI feature died while the host halves kept working. Building and
 *   auditing the repo does not catch that, because the artifact is what ships.
 *
 * This script therefore ignores the local tree: it downloads the six tarballs
 * from the registry, unpacks them, and checks the things that actually break:
 *
 *   1. the version exists, and (with --tag) that tag points at it;
 *   2. each package still declares its own name/version;
 *   3. the host half exists and imports Node builtins only;
 *   4. the browser half exists, registers a module id equal to the package name
 *      (the Host looks a row up by package name), and requires platform modules only;
 *   5. the pack depends on exactly the five components at the same version;
 *   6. with --install: a throwaway profile installs from the registry and every
 *      component is resolvable from the profile root with a correct client id.
 *
 * Usage:
 *   node verification/verify-release.mjs
 *   node verification/verify-release.mjs --version 0.1.2-alpha1 --tag alpha
 *   node verification/verify-release.mjs --version 0.1.2-alpha1 --install
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const PACK = '@funniki/dsh-session-toolkit'
const COMPONENTS = [
  `${PACK}-archived-session-delete`,
  `${PACK}-session-move`,
  `${PACK}-unsent-content-guard`,
  `${PACK}-session-history-search`,
  `${PACK}-auto-paste`
]
const REGISTRY = 'https://registry.npmjs.org'
const HOST_ALLOWED = /^node:/
const CLIENT_ALLOWED = /^(react|react\/jsx-runtime|@deepseek-ai\/dsh-client-[a-z-]+)$/

const args = process.argv.slice(2)
/** @param name - flag name. @returns its value or undefined. */
function flag(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const wantedVersion = flag('--version')
const wantedTag = flag('--tag')
const doInstall = args.includes('--install')
// --local packs the six directories in this repo and verifies THOSE tarballs, so a
// release can be judged before it is published (the user found 0.1.2 broken only
// after pulling it; verification has to happen on the artifact, before the push).
const localMode = args.includes('--local')
const pnpmBin = process.env.PNPM ?? 'pnpm'

/**
 * Run pnpm, accepting either a command on PATH or DSH's bundled pnpm.cjs.
 * @param args - pnpm arguments.
 * @param options - execFileSync options.
 * @returns the child's stdout.
 */
function runPnpm(args, options) {
  if (/\.(c|m)js$/.test(pnpmBin)) return execFileSync(process.execPath, [pnpmBin, ...args], options)
  return execFileSync(pnpmBin, args, options)
}

let failures = 0
/** @param ok - did it pass. @param text - what was checked. */
function check(ok, text) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`)
}

/**
 * Run the dsh CLI. On Windows the CLI is a .cmd shim, which execFileSync cannot
 * spawn directly, so it goes through the command interpreter instead.
 * @param args - arguments for the dsh CLI.
 */
function runDsh(args) {
  const command = process.env.DSH_BIN ?? 'dsh'
  const options = { stdio: 'inherit' }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/c', command, ...args], options)
    return
  }
  execFileSync(command, args, options)
}

/** @param name - package name. @returns its registry metadata. */
async function metadata(name) {
  const response = await fetch(`${REGISTRY}/${name.replace('/', '%2F')}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${name}: registry returned HTTP ${response.status}`)
  return response.json()
}

/**
 * Minimal tar reader: a release check must not depend on the platform's tar.
 * @param gzipped - the .tgz bytes.
 * @returns Map of relative path -> file bytes (the leading `package/` stripped).
 */
function untar(gzipped) {
  const buffer = gunzipSync(gzipped)
  const files = new Map()
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0
    const type = header[156]
    const body = buffer.subarray(offset + 512, offset + 512 + size)
    if (type === 0 || type === 48) files.set(rawName.replace(/^package\//, ''), Buffer.from(body))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

/** @param source - file text. @returns the text without comments. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n')
}

/** @param source - file text. @returns module specifiers it imports. */
function specifiersOf(source) {
  const found = new Set()
  const code = stripComments(source)
  for (const match of code.matchAll(/\bfrom\s+["']([^"']+)["']/g)) found.add(match[1])
  for (const match of code.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) found.add(match[1])
  return [...found]
}

/** @param files - tar entries. @param name - path. @returns text or undefined. */
function textOf(files, name) {
  const entry = files.get(name)
  return entry === undefined ? undefined : entry.toString('utf8')
}

const workDir = mkdtempSync(join(tmpdir(), 'dsh-release-check-'))
const resolved = {}
const packDir = join(workDir, 'packs')
const repoRoot = join(process.cwd())

/**
 * Produce one tarball for a package, from the registry or from this repo.
 * @param name - package name.
 * @returns {Promise<{files: Map<string, Buffer>, label: string, version: string}|null>}.
 */
async function fetchOrPack(name) {
  if (!localMode) {
    const entry = await metadata(name)
    const tags = entry['dist-tags'] ?? {}
    const version = wantedVersion ?? tags.latest
    const published = entry.versions?.[version]
    check(published !== undefined, `${name}: version ${version} exists on the registry`)
    if (wantedTag !== undefined) {
      check(tags[wantedTag] === version, `${name}: dist-tag "${wantedTag}" points at ${version} (is ${tags[wantedTag]})`)
    }
    if (published === undefined) return null
    const response = await fetch(published.dist.tarball, { cache: 'no-store' })
    check(response.ok, `${name}: tarball downloaded (${published.dist.tarball.split('/').pop()})`)
    if (!response.ok) return null
    return { files: untar(Buffer.from(await response.arrayBuffer())), label: 'tarball downloaded', version }
  }

  const dirName = name.replace(`${PACK}`, '').replace(/^-/, '')
  const dir = name === PACK ? join(repoRoot, 'plugin') : join(repoRoot, 'components', `dsh-${dirName}`)
  const output = runPnpm(['pack', '--pack-destination', packDir], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const tarball = output.trim().split('\n').pop().trim()
  const files = untar(readFileSync(tarball))
  const manifest = JSON.parse(textOf(files, 'package.json') ?? '{}')
  check(files.size > 0, `${name}: local tarball packed (${manifest.version})`)
  return { files, label: 'local tarball', version: manifest.version }
}

try {
  mkdirSync(packDir, { recursive: true })
  for (const name of [PACK, ...COMPONENTS]) {
    const packed = await fetchOrPack(name)
    if (packed === null) continue
    const { files, version } = packed

    resolved[name] = version
    check(![...files.keys()].some((path) => path.startsWith('node_modules/')), `${name}: tarball carries no node_modules`)
    const manifest = JSON.parse(textOf(files, 'package.json') ?? '{}')
    check(manifest.name === name, `${name}: package.json declares its own name`)
    check(manifest.version === version, `${name}: package.json version is ${version}`)
    check(manifest.license === 'MIT', `${name}: license is MIT`)

    // Host half: Node builtins only (a second copy of the Harness core broke tool
    // calls in 2.3.x, so this is the check that keeps that from creeping back).
    const main = manifest.main
    check(typeof main === 'string', `${name}: declares a main (host half)`)
    if (typeof main === 'string') {
      const source = textOf(files, main.replace(/^\.\//, ''))
      check(source !== undefined, `${name}: host half present at ${main}`)
      if (source !== undefined) {
        const bad = specifiersOf(source).filter((specifier) => !HOST_ALLOWED.test(specifier))
        check(bad.length === 0, `${name}: host half imports only node: builtins${bad.length > 0 ? ` (found ${bad.join(', ')})` : ''}`)
      }
    }

    // Browser half: the module id MUST equal the package name, because the Host
    // looks the row up by package name; a mismatch makes the loader retry and the
    // second execution throws "duplicate factory registration" (this shipped in 0.1.2).
    const clientRel = manifest.exports?.['./client']
    if (typeof clientRel === 'string') {
      const clientPath = clientRel.replace(/^\.\//, '')
      const source = textOf(files, clientPath)
      check(source !== undefined, `${name}: browser half present at ${clientRel}`)
      if (source !== undefined) {
        const id = /__ModuleLoader__\.load\(\{\s*\n\s*id:\s*['"]([^'"]+)['"]/.exec(source)?.[1]
        check(id === name, `${name}: browser half registers id "${id}" — must equal the package name`)
        const bad = specifiersOf(source).filter((specifier) => !CLIENT_ALLOWED.test(specifier))
        check(bad.length === 0, `${name}: browser half requires platform modules only${bad.length > 0 ? ` (found ${bad.join(', ')})` : ''}`)
      }
    }

    // Display metadata a row shows in the plugin page.
    for (const meta_ of ['icon.svg', 'locale/zh.json']) {
      check(files.has(meta_), `${name}: ships ${meta_}`)
    }

    if (name === PACK) {
      const dependencies = manifest.dependencies ?? {}
      const declared = Object.keys(dependencies).sort()
      check(
        declared.join('|') === [...COMPONENTS].sort().join('|'),
        `${PACK}: depends on exactly its five components (got ${declared.join(', ') || 'none'})`
      )
      for (const component of COMPONENTS) {
        const pinned = dependencies[component]
        check(
          pinned === version || pinned === `^${version}`,
          `${PACK}: pins ${component} at ${version} (got ${pinned})`
        )
      }
    }
  }

  if (doInstall) {
    const dshHome = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
    const profile = 'releasecheck'
    const profileDir = join(dshHome, 'profiles', profile)
    rmSync(profileDir, { recursive: true, force: true })
    const spec = wantedVersion === undefined ? PACK : `${PACK}@${wantedVersion}`
    console.log(`\ninstalling ${spec} into a throwaway profile "${profile}"`)
    runDsh(['plugin', '--profile', profile, 'add', spec])
    for (const component of [PACK, ...COMPONENTS]) {
      const dir = join(profileDir, 'node_modules', ...component.split('/'))
      check(existsSync(join(dir, 'package.json')), `${component}: installed at the profile root`)
      const manifest = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : {}
      const clientRel = manifest.exports?.['./client']
      if (typeof clientRel === 'string' && existsSync(join(dir, clientRel))) {
        const source = readFileSync(join(dir, clientRel), 'utf8')
        const id = /__ModuleLoader__\.load\(\{\s*\n\s*id:\s*['"]([^'"]+)['"]/.exec(source)?.[1]
        check(id === component, `${component}: installed browser half registers "${id}"`)
      }
    }
    rmSync(profileDir, { recursive: true, force: true })
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nrelease verified — this is what a user receives' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
