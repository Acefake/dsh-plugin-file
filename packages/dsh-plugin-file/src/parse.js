/**
 * Frontmatter and manifest parsing for file plugins.
 *
 * This module is deliberately free of Cordis and filesystem access: every
 * function here takes text or plain data and returns plain data. That keeps the
 * format rules testable without a Host.
 *
 * @typedef {object} ParsedMarkdown
 * @property {Record<string, string | boolean>} frontmatter Raw key/value pairs.
 * @property {string} body Everything after the closing delimiter.
 * @property {string} path Absolute path the entry was read from.
 *
 * @typedef {object} FilePluginManifest
 * @property {string} name
 * @property {string | undefined} description
 * @property {string | undefined} version
 * @property {string} skills
 * @property {string} commands
 * @property {string} agents
 * @property {string} hooks
 */

/** Names must be kebab-case; this mirrors the skill registry's own rule. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const FRONTMATTER_DELIMITER = '---'

/**
 * @param {string} value
 * @returns {boolean}
 */
export function isKebabCase(value) {
  return KEBAB_CASE.test(value)
}

/**
 * Split YAML frontmatter from a Markdown body.
 *
 * The parser is intentionally a subset: `key: value` pairs, optional quoting,
 * and YAML booleans. Nested structures are not supported because no entry type
 * in this plugin needs them; a future entry type that does should bring its own
 * parser rather than growing this one.
 *
 * @param {string} text
 * @param {string} path
 * @returns {ParsedMarkdown | undefined}
 */
export function parseMarkdown(text, path) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) return undefined

  const closing = lines.indexOf(FRONTMATTER_DELIMITER, 1)
  if (closing === -1) return undefined

  /** @type {Record<string, string | boolean>} */
  const frontmatter = {}
  for (const line of lines.slice(1, closing)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const separator = trimmed.indexOf(':')
    if (separator <= 0) continue

    const key = trimmed.slice(0, separator).trim()
    const rawValue = trimmed.slice(separator + 1).trim()
    if (key === '') continue

    frontmatter[key] = coerceScalar(rawValue)
  }

  return {
    frontmatter,
    body: lines.slice(closing + 1).join('\n').replace(/^\n/, ''),
    path,
  }
}

/**
 * Strip matching quotes, then map the YAML boolean spellings.
 *
 * An unrecognized spelling stays a string so a later reader can reject it
 * loudly instead of silently taking a truthy-looking value as `true`.
 *
 * @param {string} raw
 * @returns {string | boolean}
 */
function coerceScalar(raw) {
  const quoted =
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  const unquoted = quoted ? raw.slice(1, -1) : raw

  const lowered = unquoted.toLowerCase()
  if (lowered === 'true' || lowered === 'yes' || lowered === 'on' || lowered === '1') return true
  if (lowered === 'false' || lowered === 'no' || lowered === 'off' || lowered === '0') return false
  return unquoted
}

/**
 * Read a boolean invocation key.
 *
 * `undefined` means the key was absent, so the caller applies its own default.
 * `null` means the key was present but unusable; the caller drops the entry
 * rather than guessing, matching how the bundled filesystem provider behaves.
 *
 * @param {string | boolean | undefined} value
 * @returns {boolean | undefined | null}
 */
export function readBoolean(value) {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return null
}

/**
 * Interpret the manifest's directory fields, defaulting the ones it omits.
 *
 * @param {Record<string, unknown>} raw
 * @param {string} directoryName
 * @returns {FilePluginManifest | undefined}
 */
export function normalizeManifest(raw, directoryName) {
  const declared = typeof raw.name === 'string' ? raw.name.trim() : ''

  // The directory name wins so a copied directory cannot claim another
  // plugin's identity, but a mismatched declaration is reported by the caller.
  const name = isKebabCase(directoryName) ? directoryName : declared
  if (!isKebabCase(name)) return undefined

  return {
    name,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    skills: readPathField(raw.skills, 'skills'),
    commands: readPathField(raw.commands, 'commands'),
    agents: readPathField(raw.agents, 'agents'),
    hooks: readPathField(raw.hooks, 'hooks/hooks.json'),
  }
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function readPathField(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/**
 * Build a skill entry from a parsed file, or explain why it was dropped.
 *
 * @param {ParsedMarkdown} parsed
 * @param {string} fallbackName
 * @param {{ userInvocableDefault: boolean }} options
 * @returns {{ entry: object } | { error: string }}
 */
export function toSkillEntry(parsed, fallbackName, options) {
  const declaredName =
    typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : ''
  const name = declaredName !== '' ? declaredName : fallbackName

  if (!isKebabCase(name)) return { error: `invalid skill name "${name}"` }

  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : ''
  if (description === '') return { error: `skill "${name}" has no description` }

  const disableModelInvocation = readBoolean(parsed.frontmatter['disable-model-invocation'])
  if (disableModelInvocation === null) {
    return { error: `skill "${name}" has an unusable disable-model-invocation` }
  }

  const userInvocable = readBoolean(parsed.frontmatter['user-invocable'])
  if (userInvocable === null) {
    return { error: `skill "${name}" has an unusable user-invocable` }
  }

  const whenToUse =
    typeof parsed.frontmatter.whenToUse === 'string'
      ? parsed.frontmatter.whenToUse.trim()
      : undefined

  return {
    entry: {
      kind: 'skill',
      name,
      description,
      whenToUse: whenToUse === '' ? undefined : whenToUse,
      // `disable-model-invocation: true` removes the skill from model surfaces.
      modelInvocable: disableModelInvocation === undefined ? true : !disableModelInvocation,
      userInvocable: userInvocable === undefined ? options.userInvocableDefault : userInvocable,
      body: parsed.body,
      path: parsed.path,
    },
  }
}

/**
 * Build an agent entry, or explain why it was dropped.
 *
 * @param {ParsedMarkdown} parsed
 * @param {string} fallbackName
 * @returns {{ entry: object } | { error: string }}
 */
export function toAgentEntry(parsed, fallbackName) {
  const declaredName =
    typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : ''
  const name = declaredName !== '' ? declaredName : fallbackName

  if (!isKebabCase(name)) return { error: `invalid agent name "${name}"` }

  const description =
    typeof parsed.frontmatter.description === 'string'
      ? parsed.frontmatter.description.trim()
      : ''
  if (description === '') return { error: `agent "${name}" has no description` }
  if (parsed.body.trim() === '') return { error: `agent "${name}" has no body` }

  return {
    entry: {
      kind: 'agent',
      name,
      description,
      body: parsed.body,
      tools: readToolList(parsed.frontmatter.tools),
      path: parsed.path,
    },
  }
}

/**
 * Read a `tools` declaration.
 *
 * Both the YAML list spelling (`[read, grep]`) and a comma-separated string are
 * accepted, because Claude Code's `allowed-tools` is the latter.
 *
 * @param {string | boolean | undefined} value
 * @returns {string[]}
 */
function readToolList(value) {
  if (typeof value !== 'string') return []

  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter((part) => part !== '')
}
