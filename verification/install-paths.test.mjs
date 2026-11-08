/**
 * Do the INSTALLERS put a workable plugin on disk?
 *
 * The artifact checks (`verify-release --local`, `--install`) inspect tarballs and a
 * single `add`, so two failures slipped through to users:
 *
 *   - a `link:` install does not pull the linked package's dependencies, so the zip
 *     install produced a profile with the pack and ZERO components (all rows dead);
 *   - `dsh plugin add` records an EXACT version, so upgrading only the pack left the
 *     five components on the old version.
 *
 * This test therefore drives the real installers against throwaway profiles and asserts
 * the resulting tree, which is the only thing that proves an install works:
 *
 *   1. zip channel, fresh profile  → six packages at the target version;
 *   2. zip channel, profile pinned at an older version → healed to the target version;
 *   3. registry channel, fresh profile → six packages at the target version;
 *   4. every client half registers its own package name and every host half imports.
 *
 * It needs `dsh` on PATH (or DSH_BIN) and a built zip in dist/; it never touches the
 * user's own profile.
 *
 * Usage: node verification/install-paths.test.mjs [--version <v>]
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PACK = '@funniki/dsh-session-toolkit'
const COMPONENTS = [
  `${PACK}-archived-session-delete`,
  `${PACK}-session-move`,
  `${PACK}-unsent-content-guard`,
  `${PACK}-session-history-search`,
  `${PACK}-auto-paste`
]
const ALL = [PACK, ...COMPONENTS]

const args = process.argv.slice(2)
const versionFlag = args.indexOf('--version')
const VERSION = versionFlag >= 0 ? args[versionFlag + 1] : JSON.parse(readFileSync(`${ROOT}/plugin/package.json`, 'utf8')).version

let failures = 0
/** @param ok - did it pass. @param text - what was checked. */
function check(ok, text) {
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`)
}

const dshBin = process.env.DSH_BIN ?? 'dsh'
const isCmdShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(dshBin)

/** @param command - executable. @param args - its arguments. @param options - spawn options. */
function run(command, commandArgs, options = {}) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    return execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/c', command, ...commandArgs], options)
  }
  return execFileSync(command, commandArgs, options)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-install-paths-'))
const homeEnv = { ...process.env, DSH_HOME: home }

/** @param profile - profile name. @returns its directory. */
function profileDir(profile) {
  return join(home, 'profiles', profile)
}

/** @param name - package name. @param profile - profile name. @returns installed version, or undefined. */
function installedVersion(name, profile) {
  const manifestPath = join(profileDir(profile), 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(manifestPath)) return undefined
  return JSON.parse(readFileSync(manifestPath, 'utf8')).version
}

/** @param name - package name. @param profile - profile name. @param range - version or range. */
function addPackage(name, profile, range) {
  run(dshBin, ['plugin', '--profile', profile, 'add', `${name}@${range}`], { env: homeEnv, stdio: 'ignore' })
}

/**
 * Assert a finished profile: all six present at the target, client ids correct, host halves import.
 * @param profile - profile name.
 * @param label - what this scenario is, for the report.
 */
async function assertInstalled(profile, label) {
  for (const name of ALL) {
    const got = installedVersion(name, profile)
    check(got === VERSION, `${label}: ${name} is at ${VERSION} (got ${got ?? 'absent'})`)
  }
  for (const component of COMPONENTS) {
    const base = join(profileDir(profile), 'node_modules', ...component.split('/'))
    const manifest = existsSync(join(base, 'package.json')) ? JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) : undefined
    if (manifest === undefined) continue
    const clientRel = manifest.exports?.['./client']
    if (typeof clientRel === 'string' && existsSync(join(base, clientRel))) {
      const source = readFileSync(join(base, clientRel), 'utf8')
      const id = /__ModuleLoader__\.load\(\{\s*\n\s*id:\s*['"]([^'"]+)['"]/.exec(source)?.[1]
      check(id === component, `${label}: ${component} client id equals its package name (got ${id})`)
    }
    try {
      await import(pathToFileURL(join(base, manifest.main.replace(/^\.\//, ''))).href)
      check(true, `${label}: ${component} host half imports`)
    } catch (error) {
      check(false, `${label}: ${component} host half imports (${error.message.split('\n')[0]})`)
    }
  }
}

/** @param label - scenario label. @returns the extracted zip directory. */
function extractZip(label) {
  const zip = join(ROOT, 'dist', `dsh-session-toolkit-${VERSION}.zip`)
  if (!existsSync(zip)) {
    check(false, `${label}: dist/dsh-session-toolkit-${VERSION}.zip exists (run tools/build-release.cjs)`)
    return undefined
  }
  const dir = join(home, 'zip')
  mkdirSync(dir, { recursive: true })
  run('C:/Windows/System32/tar.exe', ['-xf', zip.replace(/\//g, '\\'), '-C', dir.replace(/\//g, '\\')])
  return dir
}

/**
 * Run one installer against a throwaway profile.
 * @param zipDir - extracted zip directory.
 * @param profile - profile name.
 * @param shell - "sh" or "ps1".
 */
function install(zipDir, profile, shell) {
  const env = { ...homeEnv, DSH_BIN: dshBin, DSH_PROFILE: profile }
  try {
  if (shell === 'ps1') {
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(zipDir, 'install.ps1'), '-Profile', profile], {
      env,
      stdio: 'ignore'
    })
  } else {
    run(process.env.SH ?? 'sh', [join(zipDir, 'install.sh')], { env, stdio: 'ignore' })
  }
  } catch (error) {
    // A non-zero exit is a result, not a crash: report it so the remaining checks still run.
    check(false, `${profile}/${shell}: the installer exited non-zero`)
    return false
  }
  return true
}

try {
  // 1. zip channel on a fresh profile — the case that used to install zero components.
  const zipDir = extractZip('zip')
  if (zipDir !== undefined) {
    // Both script flavours are exercised: the two installers share one contract but are
    // separate files, and breaking only the PowerShell one must still fail here.
    install(zipDir, 'fresh', 'ps1')
    await assertInstalled('fresh', 'zip/fresh/ps1')
    install(zipDir, 'fresh-sh', 'sh')
    await assertInstalled('fresh-sh', 'zip/fresh/sh')
  }

  // 2. zip channel over a profile pinned at an older version — the upgrade trap.
  const older = process.env.OLDER_VERSION ?? '0.1.3'
  const pinned = 'pinned'
  check(older !== VERSION, `baseline ${older} differs from the version under test ${VERSION}`)
  if (zipDir !== undefined) {
    for (const shell of ['ps1', 'sh']) {
      const profile = `pinned-${shell}`
      addPackage(PACK, profile, VERSION)
      for (const name of COMPONENTS) addPackage(name, profile, older)
      install(zipDir, profile, shell)
      await assertInstalled(profile, `zip/upgrade/${shell}`)
    }
  }

  // 3. registry channel on a fresh profile (the installer's registry branch).
  const registry = 'registry'
  const zipForRegistry = extractZip('registry')
  if (zipForRegistry !== undefined) {
    // The script needs its own package.json for the target version, but NOT cordis.patch.yml:
    // without that file it takes the registry branch instead of installing this folder.
    const alone = join(home, 'registry-only')
    mkdirSync(alone, { recursive: true })
    copyFileSync(join(zipForRegistry, 'package.json'), join(alone, 'package.json'))
    const scriptName = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
    copyFileSync(join(zipForRegistry, scriptName), join(alone, scriptName))
    try {
      if (process.platform === 'win32') { run('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File', join(alone, 'install.ps1'), '-Profile', registry, '-FromRegistry', '-Version', VERSION], { env: { ...homeEnv, DSH_BIN: dshBin }, stdio: 'ignore' }) } else { run(process.env.SH ?? 'sh', [join(alone, 'install.sh')], { env: { ...homeEnv, DSH_BIN: dshBin, DSH_FROM_REGISTRY: '1', DSH_VERSION: VERSION }, stdio: 'ignore' }) }
      await assertInstalled(registry, 'registry/fresh')
    } catch (error) {
      check(false, `registry/fresh: installer failed (${error.message.split('\n')[0]})`)
    }
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(failures === 0 ? '\ninstall paths verified' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
