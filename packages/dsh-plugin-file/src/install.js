/**
 * Install a file plugin from a URL.
 *
 * Turns a GitHub link, a GitHub subdirectory link, or a zip URL into a plugin
 * directory under the scan root. Everything here is plain Node: the caller
 * supplies the root and gets back a report, so the whole flow is testable
 * without a Host.
 *
 * The rule this module follows: never trust the archive. A downloaded plugin
 * runs code in the Host process, so the manifest is validated before anything
 * is copied into place, and the copy lands atomically or not at all.
 */

import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import fsp from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Largest archive accepted, in bytes. A plugin is text and assets, not a bundle of binaries. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

/** How long one download may take. */
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * @typedef {object} InstallResult
 * @property {boolean} ok
 * @property {string} [name]
 * @property {string} [dir]
 * @property {number} [skills]
 * @property {number} [agents]
 * @property {boolean} [replaced]
 * @property {{ code: string, message: string }} [error]
 */

/**
 * Describe what a URL points at, without fetching it.
 *
 * @param {string} input
 * @returns {{ kind: 'github-repo', owner: string, repo: string, ref?: string, subpath?: string }
 *   | { kind: 'github-tree', owner: string, repo: string, ref: string, subpath: string }
 *   | { kind: 'zip-url', url: string }
 *   | { kind: 'error', message: string }}
 */
export function classifyUrl(input) {
  let url
  try {
    url = new URL(String(input).trim())
  } catch {
    return { kind: 'error', message: 'not a valid URL' }
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { kind: 'error', message: 'only http and https links are supported' }
  }

  const host = url.hostname.toLowerCase()

  // A direct archive: easiest case, no repository walking needed.
  if (/\.zip$/i.test(url.pathname)) {
    return { kind: 'zip-url', url: url.href }
  }

  if (host !== 'github.com' && host !== 'www.github.com') {
    return { kind: 'error', message: `unsupported host ${host}; use github.com or a .zip link` }
  }

  const segments = url.pathname.split('/').filter((part) => part !== '')
  if (segments.length < 2) {
    return { kind: 'error', message: 'the link must name a repository, such as github.com/user/repo' }
  }

  const [owner, repo, marker, ...rest] = segments

  // github.com/user/repo/tree/<ref>/<path...>
  if (marker === 'tree') {
    const ref = rest[0]
    const subpath = rest.slice(1).join('/')
    if (ref === undefined || ref === '') {
      return { kind: 'error', message: 'the tree link names no branch' }
    }
    return { kind: 'github-tree', owner, repo, ref, subpath }
  }

  return { kind: 'github-repo', owner, repo }
}

/**
 * Install one plugin from a link.
 *
 * @param {string} input the URL the user pasted.
 * @param {{ root: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<InstallResult>}
 */
export async function installFromUrl(input, options) {
  const target = classifyUrl(input)
  if (target.kind === 'error') {
    return fail('invalid-url', target.message)
  }

  const work = await mkdtemp(join(tmpdir(), 'dsh-install-'))
  try {
    /** @type {string} */
    let archiveUrl
    /** @type {string | undefined} */
    let subpath

    if (target.kind === 'zip-url') {
      archiveUrl = target.url
    } else if (target.kind === 'github-repo') {
      // The archive URL needs the default branch, which only the API knows.
      archiveUrl = await defaultBranchArchive(target.owner, target.repo, options)
    } else {
      archiveUrl = `https://codeload.github.com/${target.owner}/${target.repo}/zip/refs/heads/${target.ref}`
      subpath = target.subpath === '' ? undefined : target.subpath
    }

    const archive = join(work, 'plugin.zip')
    const downloaded = await download(archiveUrl, archive, options)
    if (!downloaded.ok) return downloaded

    const unpacked = join(work, 'unpacked')
    await mkdir(unpacked, { recursive: true })
    expand(archive, unpacked)

    // A GitHub archive nests everything under one folder named after the repo
    // and ref; a subdirectory link then points deeper. Resolve to the
    // directory that actually holds the manifest.
    const located = await locateManifest(unpacked, subpath)

    if (located === undefined) {
      return fail(
        'no-manifest',
        subpath === undefined
          ? 'the repository has no plugin.json; if it holds several plugins, open the one you want and copy that link'
          : `the path ${subpath} has no plugin.json`,
      )
    }

    if (typeof located === 'object') {
      return fail(
        'multiple-plugins',
        `this repository holds several plugins (${located.multiple.join(', ')}); open the one you want and copy that link instead`,
      )
    }

    const pluginDir = located

    const manifest = await readManifest(pluginDir)
    if (!manifest.ok) return manifest

    const installed = await place(pluginDir, manifest.value.name, options.root)
    if (!installed.ok) return installed

    const counts = await countEntries(installed.dir)

    return {
      ok: true,
      name: manifest.value.name,
      dir: installed.dir,
      skills: counts.skills,
      agents: counts.agents,
      replaced: installed.replaced,
    }
  } catch (error) {
    return fail('install-failed', message(error))
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<string>}
 */
async function defaultBranchArchive(owner, repo, options) {
  const api = `https://api.github.com/repos/${owner}/${repo}`
  try {
    const response = await request(api, options)
    if (response.ok) {
      const body = await response.json()
      if (typeof body.default_branch === 'string' && body.default_branch !== '') {
        return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${body.default_branch}`
      }
    }
  } catch {
    // Fall through: a rate-limited or blocked API still leaves the archive
    // reachable when the repository uses the conventional branch name.
  }
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/main`
}

/**
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<Response>}
 */
function request(url, options) {
  const impl = options.fetchImpl ?? fetch
  return impl(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'dsh-plugin-file', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
  })
}

/**
 * Stream the archive to disk, enforcing the size cap as it goes.
 *
 * @param {string} url
 * @param {string} path
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<InstallResult>}
 */
async function download(url, path, options) {
  let response
  try {
    response = await request(url, options)
  } catch (error) {
    return fail('download-failed', `${url}: ${message(error)}`)
  }

  if (!response.ok) {
    return fail('download-failed', `${url} answered ${String(response.status)}`)
  }
  if (response.body === null) {
    return fail('download-failed', `${url} returned no body`)
  }

  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_ARCHIVE_BYTES) {
    return fail('too-large', `the archive is ${String(declared)} bytes, over the ${String(MAX_ARCHIVE_BYTES)} limit`)
  }

  let written = 0
  const counter = new TransformStream({
    transform(chunk, controller) {
      written += chunk.byteLength
      if (written > MAX_ARCHIVE_BYTES) {
        controller.error(new Error(`archive exceeds ${String(MAX_ARCHIVE_BYTES)} bytes`))
        return
      }
      controller.enqueue(chunk)
    },
  })

  try {
    await pipeline(Readable.fromWeb(response.body.pipeThrough(counter)), createWriteStream(path))
  } catch (error) {
    return fail('download-failed', message(error))
  }

  return { ok: true }
}

/**
 * Expand an archive with the platform tool.
 *
 * @param {string} archive
 * @param {string} into
 */
function expand(archive, into) {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '[System.IO.Compression.ZipFile]::ExtractToDirectory([string]$env:DSH_ZIP_SRC, [string]$env:DSH_ZIP_DST)',
    ].join('; ')
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      env: { ...process.env, DSH_ZIP_SRC: archive, DSH_ZIP_DST: into },
    })
    return
  }
  execFileSync('unzip', ['-q', '-o', archive, '-d', into], { stdio: 'ignore' })
}

/**
 * Find the directory holding the plugin manifest.
 *
 * @param {string} unpacked
 * @param {string | undefined} subpath
 * @returns {Promise<string | undefined>}
 */
async function locateManifest(unpacked, subpath) {
  const entries = await readdir(unpacked, { withFileTypes: true })
  const top = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

  /** @type {string[]} */
  const roots = []
  if (await isFile(join(unpacked, 'plugin.json'))) roots.push(unpacked)

  for (const name of top) {
    const base = join(unpacked, name)
    // The archive's own wrapper directory: either the repository root or, for
    // a subdirectory link, the ancestor of the requested path.
    if (await isFile(join(base, 'plugin.json'))) roots.push(base)
    if (subpath !== undefined) {
      const candidate = join(base, ...subpath.split('/').filter((part) => part !== ''))
      if (await isFile(join(candidate, 'plugin.json'))) roots.push(candidate)
    }
  }

  // A repository may keep its plugins under a grouping directory — `plugins/`
  // is the Claude Code convention — so a manifest below one grouping level is
  // still this archive's candidate. The walk descends exactly one extra level
  // and only through known grouping names, so an arbitrary repository cannot
  // make the installer traverse its tree.
  if (roots.length === 0) {
    for (const name of top) {
      const base = join(unpacked, name)

      if (GROUPING_DIRECTORIES.has(name)) {
        for (const nested of await subdirectories(base)) {
          if (SKIP_DIRECTORIES.has(nested)) continue
          const candidate = join(base, nested)
          if (await isFile(join(candidate, 'plugin.json'))) roots.push(candidate)
        }
        continue
      }

      if (SKIP_DIRECTORIES.has(name)) continue
      for (const nested of await subdirectories(base)) {
        if (!GROUPING_DIRECTORIES.has(nested)) continue
        for (const inner of await subdirectories(join(base, nested))) {
          const candidate = join(base, nested, inner)
          if (await isFile(join(candidate, 'plugin.json'))) roots.push(candidate)
        }
      }
    }
  }

  // Multiple manifests under a grouping directory mean the link named a
  // repository of plugins, not one plugin. Installing the first would silently
  // drop the rest, so this is reported and the caller is told what to pick.
  if (roots.length > 1 && subpath === undefined) {
    const names = []
    for (const root of roots) {
      const manifest = await readFile(join(root, 'plugin.json'), 'utf8').catch(() => undefined)
      if (manifest === undefined) continue
      try {
        const parsed = JSON.parse(manifest)
        if (typeof parsed?.name === 'string') names.push(parsed.name)
      } catch {
        // A malformed sibling does not change that this archive holds several.
      }
    }
    if (names.length > 1) {
      return { multiple: names }
    }
  }

  return roots[0] === undefined ? undefined : roots[0]
}

/** Directory names that group plugins rather than hold one. */
const GROUPING_DIRECTORIES = new Set(['plugins', 'extensions', 'addons'])

/** Directories never worth descending into when looking for a manifest. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  'dist',
  'build',
  'docs',
  'test',
  'tests',
  '__tests__',
  'examples',
  'assets',
])

/**
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function subdirectories(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * @param {string} dir
 * @returns {Promise<{ ok: true, value: { name: string } } | InstallResult>}
 */
async function readManifest(dir) {
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8'))
  } catch (error) {
    return fail('invalid-manifest', `plugin.json: ${message(error)}`)
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('invalid-manifest', 'plugin.json is not an object')
  }

  const name = /** @type {Record<string, unknown>} */ (raw).name
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
    return fail('invalid-manifest', 'plugin.json needs a kebab-case name')
  }

  return { ok: true, value: { name } }
}

/**
 * Copy the plugin into the scan root, replacing an existing copy.
 *
 * The copy is staged beside the destination and renamed, so a failed
 * installation never leaves a half-written plugin that the loader would read.
 *
 * @param {string} source
 * @param {string} name
 * @param {string} root
 * @returns {Promise<{ ok: true, dir: string, replaced: boolean } | InstallResult>}
 */
async function place(source, name, root) {
  const destination = resolve(root, name)

  // A manifest name is user-controlled input from the network; refuse anything
  // that would escape the root.
  const inside = relative(resolve(root), destination)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    return fail('invalid-manifest', `the name ${name} would install outside the plugin root`)
  }

  await mkdir(root, { recursive: true })

  const staging = `${destination}.incoming-${String(Date.now())}`
  await rm(staging, { recursive: true, force: true })
  await cp(source, staging)

  const replaced = await exists(destination)
  if (replaced) {
    const previous = `${destination}.previous-${String(Date.now())}`
    await rename(destination, previous)
    try {
      await rename(staging, destination)
    } catch (error) {
      await rename(previous, destination).catch(() => {})
      return fail('install-failed', message(error))
    }
    await rm(previous, { recursive: true, force: true })
    return { ok: true, dir: destination, replaced: true }
  }

  try {
    await rename(staging, destination)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    return fail('install-failed', message(error))
  }
  return { ok: true, dir: destination, replaced: false }
}

/**
 * Copy a directory tree, skipping any embedded repository metadata.
 *
 * @param {string} from
 * @param {string} to
 */
async function cp(from, to) {
  await fsp.cp(from, to, {
    recursive: true,
    force: true,
    filter: (path) => !path.includes(`${sep}.git${sep}`),
  })
}

/**
 * @param {string} dir
 * @returns {Promise<{ skills: number, agents: number }>}
 */
async function countEntries(dir) {
  const count = async (sub) => {
    try {
      const entries = await readdir(join(dir, sub), { withFileTypes: true })
      return entries.filter((entry) => entry.isDirectory() || entry.name.endsWith('.md')).length
    } catch {
      return 0
    }
  }
  return { skills: await count('skills'), agents: await count('agents') }
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
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} code
 * @param {string} text
 * @returns {InstallResult}
 */
function fail(code, text) {
  return { ok: false, error: { code, message: text } }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
