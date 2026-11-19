/**
 * Directory discovery for file plugins.
 *
 * Reads `plugin.json` (or `.claude-plugin/plugin.json`) under each plugin
 * directory and collects the Markdown entries it declares. Registration is a
 * separate concern; everything here is plain node:fs.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { normalizeManifest, parseMarkdown, toAgentEntry, toSkillEntry } from './parse.js'

/** Where a plugin's inventory is declared, in resolution order. */
const MANIFEST_CANDIDATES = ['plugin.json', '.claude-plugin/plugin.json']

/**
 * @typedef {object} DiscoveredPlugin
 * @property {string} name
 * @property {string} dir
 * @property {import('./parse.js').FilePluginManifest} manifest
 * @property {object[]} skills Skill and command entries.
 * @property {object[]} agents
 * @property {string | undefined} hooksPath
 */

/**
 * @typedef {object} DiscoveryReport
 * @property {DiscoveredPlugin[]} plugins
 * @property {string[]} warnings
 */

/**
 * Discover every plugin under a root directory.
 *
 * A malformed or unreadable plugin is reported as a warning and skipped; one
 * bad directory never hides its siblings.
 *
 * @param {string} root
 * @param {(message: string) => void} [warn]
 * @returns {Promise<DiscoveryReport>}
 */
export async function discoverPlugins(root, warn = () => {}) {
  /** @type {DiscoveredPlugin[]} */
  const plugins = []
  /** @type {string[]} */
  const warnings = []

  const report = (message) => {
    warnings.push(message)
    warn(message)
  }

  /** @type {string[]} */
  let dirNames
  try {
    const entries = await readdir(root, { withFileTypes: true })
    dirNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    // A missing root is a normal empty state, not a failure.
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      report(`cannot read plugin root ${root}: ${describe(error)}`)
    }
    return { plugins, warnings }
  }

  for (const dirName of dirNames.sort()) {
    const dir = join(root, dirName)
    // The format is defined by the manifest; a directory without one is not a
    // file plugin, and reporting it would flag every unrelated folder.
    const manifestPath = await findManifest(dir)
    if (manifestPath === undefined) continue

    try {
      const plugin = await readPlugin(dir, dirName, manifestPath, report)
      if (plugin !== undefined) plugins.push(plugin)
    } catch (error) {
      report(`plugin "${dirName}" could not be read: ${describe(error)}`)
    }
  }

  return { plugins, warnings }
}

/**
 * @param {string} dir
 * @returns {Promise<string | undefined>}
 */
async function findManifest(dir) {
  for (const candidate of MANIFEST_CANDIDATES) {
    const path = join(dir, candidate)
    try {
      const info = await stat(path)
      if (info.isFile()) return path
    } catch {
      continue
    }
  }
  return undefined
}

/**
 * @param {string} dir
 * @param {string} dirName
 * @param {string} manifestPath
 * @param {(message: string) => void} report
 * @returns {Promise<DiscoveredPlugin | undefined>}
 */
async function readPlugin(dir, dirName, manifestPath, report) {
  /** @type {Record<string, unknown>} */
  let raw
  try {
    raw = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    report(`plugin "${dirName}": invalid manifest at ${manifestPath}: ${describe(error)}`)
    return undefined
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    report(`plugin "${dirName}": manifest at ${manifestPath} is not an object`)
    return undefined
  }

  const manifest = normalizeManifest(raw, dirName)
  if (manifest === undefined) {
    report(`plugin "${dirName}": unusable name; the directory name must be kebab-case`)
    return undefined
  }

  const declaredName = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (declaredName !== '' && declaredName !== manifest.name) {
    report(
      `plugin "${dirName}": manifest declares name "${declaredName}"; using the directory name`,
    )
  }

  const skills = [
    ...(await collectMarkdown(join(dir, manifest.skills), dirName, 'skill', report)),
    ...(await collectMarkdown(join(dir, manifest.commands), dirName, 'command', report)),
  ]
  const agents = await collectMarkdown(join(dir, manifest.agents), dirName, 'agent', report)
  const hooksPath = await existingFile(join(dir, manifest.hooks))

  return { name: manifest.name, dir, manifest, skills, agents, hooksPath }
}

/**
 * Collect entries from one directory.
 *
 * Two shapes are accepted, matching the bundled filesystem skill provider:
 * a directory bundle `<name>/SKILL.md`, and a flat `<name>.md`.
 *
 * @param {string} dir
 * @param {string} pluginName
 * @param {'skill' | 'command' | 'agent'} kind
 * @param {(message: string) => void} report
 * @returns {Promise<object[]>}
 */
async function collectMarkdown(dir, pluginName, kind, report) {
  /** @type {object[]} */
  const entries = []

  /** @type {import('node:fs').Dirent[]} */
  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
      report(`plugin "${pluginName}": cannot read ${dir}: ${describe(error)}`)
    }
    return entries
  }

  for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
    if (kind === 'agent') {
      if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue
      const path = join(dir, dirent.name)
      addEntry(await readEntry(path, dirent.name.slice(0, -3), 'agent', report), entries)
      continue
    }

    if (dirent.isDirectory()) {
      const path = join(dir, dirent.name, 'SKILL.md')
      const text = await existingText(path)
      if (text === undefined) continue
      addEntry(buildEntry(text, path, dirent.name, kind, report), entries)
      continue
    }

    if (dirent.isFile() && dirent.name.endsWith('.md')) {
      const path = join(dir, dirent.name)
      const text = await existingText(path)
      if (text === undefined) continue
      addEntry(buildEntry(text, path, dirent.name.slice(0, -3), kind, report), entries)
    }
  }

  return entries
}

/**
 * @param {object | undefined} entry
 * @param {object[]} entries
 */
function addEntry(entry, entries) {
  if (entry !== undefined) entries.push(entry)
}

/**
 * @param {string} path
 * @param {string} fallbackName
 * @param {'agent'} kind
 * @param {(message: string) => void} report
 * @returns {Promise<object | undefined>}
 */
async function readEntry(path, fallbackName, kind, report) {
  const text = await existingText(path)
  if (text === undefined) return undefined
  return buildEntry(text, path, fallbackName, kind, report)
}

/**
 * @param {string} text
 * @param {string} path
 * @param {string} fallbackName
 * @param {'skill' | 'command' | 'agent'} kind
 * @param {(message: string) => void} report
 * @returns {object | undefined}
 */
function buildEntry(text, path, fallbackName, kind, report) {
  const parsed = parseMarkdown(text, path)
  if (parsed === undefined) {
    report(`${kind} at ${path} has no frontmatter`)
    return undefined
  }

  // Both `skills/` and `commands/` become skills: the `/` gesture reads
  // user-invocable skills, so a command never needs the host command registry,
  // which could not carry its prompt to the model. Neither directory implies
  // anything about invocation, so the registry's own default applies.
  const result =
    kind === 'agent'
      ? toAgentEntry(parsed, fallbackName)
      : toSkillEntry(parsed, fallbackName, { userInvocableDefault: true })

  if ('error' in result) {
    report(`${kind} at ${path}: ${result.error}`)
    return undefined
  }

  return result.entry
}

/**
 * @param {string} path
 * @returns {Promise<string | undefined>}
 */
async function existingText(path) {
  try {
    const info = await stat(path)
    if (!info.isFile()) return undefined
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * @param {string} path
 * @returns {Promise<string | undefined>}
 */
async function existingFile(path) {
  try {
    const info = await stat(path)
    return info.isFile() ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
