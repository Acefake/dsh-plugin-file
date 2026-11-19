/**
 * GitHub marketplaces for file plugins.
 *
 * A marketplace is one JSON document listing plugins and where each one lives.
 * Two formats are read:
 *
 * - Claude Code's `.claude-plugin/marketplace.json`, whose entries carry a
 *   `source` that is either a relative path inside the same repository or a
 *   full URL.
 * - A plain `marketplace.json` holding the same `plugins` array, for a
 *   repository that is not laid out for Claude Code.
 *
 * Marketplaces are user data, not configuration: the list is persisted under
 * the plugin root so a profile reset does not silently drop the sources.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where a marketplace document is looked for, in order. */
const MARKETPLACE_CANDIDATES = ['.claude-plugin/marketplace.json', 'marketplace.json']

/** How long a fetched marketplace stays usable. */
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * @typedef {object} MarketSource
 * @property {string} id stable identity: the normalized URL.
 * @property {string} url
 * @property {string} name
 * @property {string} [description]
 * @property {string} [icon]
 * @property {number} addedAt
 */

/**
 * @typedef {object} MarketEntry
 * @property {string} name
 * @property {string} [description]
 * @property {string} [version]
 * @property {string} installUrl what to hand the installer
 * @property {string} [source] the raw source, for display
 * @property {boolean} installed
 */

/**
 * @typedef {object} MarketSnapshot
 * @property {MarketSource} source
 * @property {MarketEntry[]} plugins
 * @property {number} fetchedAt
 * @property {string} [error]
 */

/**
 * Owns the list of marketplaces and their cached documents.
 */
export class MarketplaceStore {
  /**
   * @param {string} root the plugin root that also holds `marketplaces.json`.
   * @param {{ fetchImpl?: typeof fetch, now?: () => number, ttlMs?: number }} [options]
   */
  constructor(root, options = {}) {
    this.root = root
    this.file = join(root, 'marketplaces.json')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS
    /** @type {Map<string, MarketSnapshot>} */
    this.cache = new Map()
  }

  /**
   * @returns {Promise<MarketSource[]>}
   */
  async list() {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      if (!Array.isArray(raw?.sources)) return []
      return raw.sources.filter((entry) => typeof entry?.url === 'string' && typeof entry?.id === 'string')
    } catch {
      return []
    }
  }

  /**
   * Add a marketplace and read it once, so a bad URL is reported immediately
   * rather than at the next refresh.
   *
   * @param {string} input
   * @returns {Promise<{ ok: boolean, source?: MarketSource, error?: { code: string, message: string } }>}
   */
  async add(input) {
    const normalized = normalizeMarketUrl(input)
    if (!normalized.ok) return normalized

    const sources = await this.list()
    if (sources.some((entry) => entry.id === normalized.url)) {
      return { ok: false, error: { code: 'already-added', message: 'this marketplace is already in the list' } }
    }

    const read = await this.#read(normalized.url)
    if (!read.ok) return read

    /** @type {MarketSource} */
    const source = {
      id: normalized.url,
      url: normalized.url,
      name: read.document.name,
      ...(read.document.description === undefined ? {} : { description: read.document.description }),
      ...(read.document.icon === undefined ? {} : { icon: read.document.icon }),
      addedAt: this.now(),
    }

    sources.push(source)
    await this.#save(sources)
    this.cache.set(source.id, read.snapshot)

    return { ok: true, source }
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async remove(id) {
    const sources = await this.list()
    const kept = sources.filter((entry) => entry.id !== id)
    if (kept.length === sources.length) return false
    await this.#save(kept)
    this.cache.delete(id)
    return true
  }

  /**
   * Read every marketplace, using the cache when it is still fresh.
   *
   * One failing source never hides the others: its snapshot carries the error
   * and an empty plugin list, which is what the panel renders.
   *
   * @param {{ refresh?: boolean }} [options]
   * @returns {Promise<MarketSnapshot[]>}
   */
  async snapshots(options = {}) {
    const sources = await this.list()
    const out = []

    for (const source of sources) {
      const cached = this.cache.get(source.id)
      if (!options.refresh && cached !== undefined && this.now() - cached.fetchedAt < this.ttlMs) {
        out.push(cached)
        continue
      }

      const read = await this.#read(source.url)
      const snapshot = read.ok
        ? { source, plugins: read.snapshot.plugins, fetchedAt: this.now() }
        : { source, plugins: [], fetchedAt: this.now(), error: read.error.message }

      this.cache.set(source.id, snapshot)
      out.push(snapshot)
    }

    return out
  }

  /**
   * Fetch and parse one marketplace document.
   *
   * @param {string} url
   * @returns {Promise<{ ok: true, document: { name: string, description?: string, icon?: string }, snapshot: MarketSnapshot }
   *   | { ok: false, error: { code: string, message: string } }>}
   */
  async #read(url) {
    const located = await this.#locateDocument(url)
    if (!located.ok) return located

    let document
    try {
      const response = await this.fetchImpl(located.documentUrl, {
        redirect: 'follow',
        headers: { 'user-agent': 'dsh-plugin-file', accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        return { ok: false, error: { code: 'fetch-failed', message: `${located.documentUrl} answered ${String(response.status)}` } }
      }
      document = await response.json()
    } catch (error) {
      return { ok: false, error: { code: 'fetch-failed', message: message(error) } }
    }

    const parsed = parseMarketplace(document, located.base)
    if (!parsed.ok) return parsed

    return {
      ok: true,
      document: parsed.document,
      snapshot: { source: { id: url, url, name: parsed.document.name, addedAt: this.now() }, plugins: parsed.plugins, fetchedAt: this.now() },
    }
  }

  /**
   * Resolve a user-supplied marketplace URL to the document that holds it.
   *
   * A repository link has no path to the document, so the conventional
   * locations are probed on the repository's default branch.
   *
   * @param {string} url
   * @returns {Promise<{ ok: true, documentUrl: string, base: string } | { ok: false, error: { code: string, message: string } }>}
   */
  async #locateDocument(url) {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter((part) => part !== '')

    // Already a document: a .json path or a raw content host.
    if (/\.json$/i.test(parsed.pathname) || parsed.hostname === 'raw.githubusercontent.com') {
      const base = parsed.href.slice(0, parsed.href.lastIndexOf('/') + 1)
      return { ok: true, documentUrl: parsed.href, base }
    }

    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return { ok: false, error: { code: 'invalid-url', message: 'use a github.com repository or a direct .json link' } }
    }
    if (segments.length < 2) {
      return { ok: false, error: { code: 'invalid-url', message: 'the link must name a repository' } }
    }

    const [owner, repo, marker, ...rest] = segments
    let branch
    let subpath = ''

    if (marker === 'tree') {
      branch = rest[0]
      subpath = rest.slice(1).join('/')
    } else {
      branch = await this.#defaultBranch(owner, repo)
    }
    if (branch === undefined) {
      return { ok: false, error: { code: 'fetch-failed', message: `cannot resolve the default branch of ${owner}/${repo}` } }
    }

    const prefix = subpath === '' ? '' : `${subpath.replace(/\/$/u, '')}/`
    for (const candidate of MARKETPLACE_CANDIDATES) {
      const documentUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${prefix}${candidate}`
      try {
        const head = await this.fetchImpl(documentUrl, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'user-agent': 'dsh-plugin-file', accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        })
        if (head.ok) {
          const base = documentUrl.slice(0, documentUrl.lastIndexOf('/') + 1)
          return { ok: true, documentUrl, base }
        }
      } catch {
        // Try the next candidate.
      }
    }

    return {
      ok: false,
      error: { code: 'no-marketplace', message: `no ${MARKETPLACE_CANDIDATES.join(' or ')} in ${owner}/${repo}` },
    }
  }

  /**
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<string | undefined>}
   */
  async #defaultBranch(owner, repo) {
    try {
      const response = await this.fetchImpl(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { 'user-agent': 'dsh-plugin-file', accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return 'main'
      const body = await response.json()
      return typeof body.default_branch === 'string' && body.default_branch !== '' ? body.default_branch : 'main'
    } catch {
      return 'main'
    }
  }

  /**
   * @param {MarketSource[]} sources
   */
  async #save(sources) {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.file, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`, 'utf8')
  }
}

/**
 * Reject anything that is not a GitHub repository or a JSON document link.
 *
 * @param {string} input
 * @returns {{ ok: true, url: string } | { ok: false, error: { code: string, message: string } }}
 */
export function normalizeMarketUrl(input) {
  let url
  try {
    url = new URL(String(input).trim())
  } catch {
    return { ok: false, error: { code: 'invalid-url', message: 'not a valid URL' } }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: { code: 'invalid-url', message: 'only http and https links are supported' } }
  }
  return { ok: true, url: url.href.replace(/\/$/u, '') }
}

/**
 * Parse a marketplace document into installable entries.
 *
 * @param {unknown} document
 * @param {string} base URL directory the document was read from, for relative sources.
 * @returns {{ ok: true, document: { name: string, description?: string, icon?: string }, plugins: MarketEntry[] }
 *   | { ok: false, error: { code: string, message: string } }}
 */
export function parseMarketplace(document, base) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, error: { code: 'invalid-marketplace', message: 'the document is not an object' } }
  }
  const root = /** @type {Record<string, any>} */ (document)
  if (!Array.isArray(root.plugins)) {
    return { ok: false, error: { code: 'invalid-marketplace', message: 'the document has no plugins array' } }
  }

  /** @type {MarketEntry[]} */
  const plugins = []
  for (const raw of root.plugins) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = /** @type {Record<string, any>} */ (raw)
    if (typeof entry.name !== 'string' || entry.name === '') continue

    const installUrl = resolveSource(entry.source, base)
    if (installUrl === undefined) continue

    plugins.push({
      name: entry.name,
      ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
      installUrl,
      installed: false,
    })
  }

  return {
    ok: true,
    document: {
      name: typeof root.name === 'string' && root.name !== '' ? root.name : 'marketplace',
      ...(typeof root.description === 'string' ? { description: root.description } : {}),
      ...(typeof root.icon === 'string' ? { icon: root.icon } : {}),
    },
    plugins,
  }
}

/**
 * Turn a marketplace entry's `source` into an install URL.
 *
 * Claude Code allows a relative path (inside the same repository), a remote
 * repository, or an object naming either. This module collapses all of them to
 * a URL the installer already understands.
 *
 * @param {unknown} source
 * @param {string} base
 * @returns {string | undefined}
 */
function resolveSource(source, base) {
  if (typeof source === 'string') {
    if (/^https?:\/\//iu.test(source)) return source
    // A relative path: the plugin sits in the same repository as the document.
    // `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` maps back to
    // the GitHub tree link the installer resolves.
    const match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//u.exec(base)
    if (match !== null) {
      const [, owner, repo, branch] = match
      const path = source.replace(/^\.\//u, '').replace(/\/$/u, '')
      return `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
    }
    return undefined
  }

  if (source !== null && typeof source === 'object') {
    const entry = /** @type {Record<string, any>} */ (source)
    if (typeof entry.url === 'string' && /^https?:\/\//iu.test(entry.url)) {
      // `source: { source: 'github', repo: 'owner/repo' }` appears in some
      // catalogs; treat the url form as authoritative when present.
      const path = typeof entry.path === 'string' ? entry.path.replace(/^\.\//u, '').replace(/\/$/u, '') : ''
      return path === '' ? entry.url : `${entry.url.replace(/\/$/u, '')}/tree/HEAD/${path}`
    }
    if (typeof entry.repo === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(entry.repo)) {
      const path = typeof entry.path === 'string' ? entry.path.replace(/^\.\//u, '').replace(/\/$/u, '') : ''
      return path === '' ? `https://github.com/${entry.repo}` : `https://github.com/${entry.repo}/tree/HEAD/${path}`
    }
  }

  return undefined
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function message(error) {
  return error instanceof Error ? error.message : String(error)
}
