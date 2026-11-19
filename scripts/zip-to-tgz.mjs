/**
 * Turn a plugin .zip into the .tgz DSH can install.
 *
 * DSH accepts a registry name, a local directory, a git spec, and a tarball.
 * `.zip` is not among them, so a zip has to be repacked first. Repacking is
 * the whole job: the installer already knows how to consume a tarball.
 *
 * Usage: node scripts/zip-to-tgz.mjs <plugin.zip> [outDir]
 *
 * The zip must hold `package.json` at its root or inside one top-level folder,
 * which is what a GitHub "Download ZIP" produces. Prints the tarball path.
 */

import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const [zipPath, outDirArg] = process.argv.slice(2)
if (zipPath === undefined) {
  console.error('usage: node scripts/zip-to-tgz.mjs <plugin.zip> [outDir]')
  process.exit(2)
}

if (!(await isFile(zipPath))) {
  console.error(`no such file: ${zipPath}`)
  process.exit(2)
}

const outDir = outDirArg ?? dirname(zipPath)
const work = await mkdtemp(join(tmpdir(), 'dsh-zip-'))

try {
  expand(zipPath, work)

  const root = await packageRoot(work)
  if (root === undefined) {
    console.error('the archive has no package.json at its root or one level down')
    process.exit(1)
  }

  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    console.error('package.json is missing name or version')
    process.exit(1)
  }
  if (manifest.dsh?.bundle?.patch === undefined) {
    console.error(`${manifest.name} declares no dsh.bundle.patch, so DSH cannot load it as a bundle`)
    process.exit(1)
  }

  await mkdir(outDir, { recursive: true })
  const wanted = join(outDir, `${manifest.name.replace(/^@/u, '').replace('/', '-')}-${manifest.version}.tgz`)

  // npm names the tarball itself; let it, then move the result to the name
  // this script promises. Repacking by hand would mean reimplementing the
  // `files` rules, which is where a hand-rolled tarball usually goes wrong.
  const produced = pack(root, outDir)
  await rename(produced, wanted)

  console.log(wanted)
} finally {
  await rm(work, { recursive: true, force: true })
}

/**
 * Expand the archive with the platform tool.
 *
 * On Windows this shells out to the .NET zip API rather than Expand-Archive:
 * that cmdlet has shifted its parameter binding across PowerShell versions and
 * rejects a plain two-argument call on some of them.
 *
 * @param {string} zip
 * @param {string} into
 */
function expand(zip, into) {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '[System.IO.Compression.ZipFile]::ExtractToDirectory([string]$env:DSH_ZIP_SRC, [string]$env:DSH_ZIP_DST)',
    ].join('; ')
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'inherit',
      env: { ...process.env, DSH_ZIP_SRC: zip, DSH_ZIP_DST: into },
    })
    return
  }
  execFileSync('unzip', ['-q', '-o', zip, '-d', into], { stdio: 'inherit' })
}

/**
 * @param {string} work
 * @returns {Promise<string | undefined>}
 */
async function packageRoot(work) {
  if (await isFile(join(work, 'package.json'))) return work

  for (const entry of await readdir(work, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(work, entry.name)
    if (await isFile(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * Pack with pnpm and report the tarball it wrote.
 *
 * pnpm is preferred over npm here because the npm shim resolves its own
 * `node_modules` relative to the working directory and breaks when packing
 * from a temporary directory. When pnpm is absent this falls back to npm run
 * with the CLI's own entry point, which does not depend on that resolution.
 *
 * @param {string} root
 * @param {string} destination
 * @returns {string}
 */
function pack(root, destination) {
  const absolute = resolve(destination)
  const candidates = []

  if (process.env.DSH_NODE_EXECUTABLE !== undefined && process.env.DSH_PNPM_CLI !== undefined) {
    candidates.push([process.env.DSH_NODE_EXECUTABLE, [process.env.DSH_PNPM_CLI, 'pack', '--pack-destination', absolute]])
  }
  candidates.push([process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--pack-destination', absolute]])

  let lastError
  for (const [command, args] of candidates) {
    try {
      const output = execFileSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: command.endsWith('.cmd'),
      })
      const name = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith('.tgz'))
        .pop()
      if (name !== undefined) return join(absolute, basename(name))
      lastError = new Error(`${command} produced no tarball name: ${output}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('no packer available')
}
