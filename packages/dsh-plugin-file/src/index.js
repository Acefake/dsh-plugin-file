/**
 * File-plugin loader for the DeepSeek Harness.
 *
 * Scans `~/.dsh/plugins/<name>/` for directories that carry a `plugin.json`,
 * and turns their Markdown and JSON into the registrations the Host already
 * understands:
 *
 * - `skills/` and `commands/` become skills on `ctx.skills`, because the `/`
 *   gesture reads user-invocable skills. They must NOT become host commands:
 *   a host command claims the name first and cannot carry a prompt to the
 *   model, so the entry would silently stop working.
 * - `agents/` become agent presets on `ctx.agentPresets`.
 * - `hooks/hooks.json` is left for the Claude Code hooks bridge.
 *
 * @module dsh-plugin-file
 */

import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { discoverPlugins } from './discover.js'
import { parseMarkdown } from './parse.js'

export const name = 'plugin-file'
export const inject = ['skills']

/**
 * @typedef {object} Config
 * @property {string | undefined} pluginRoot Overrides the default scan root.
 * @property {boolean | undefined} watch Re-scan when files change. Defaults to true.
 */

const DEFAULTS = {
  pluginRoot: undefined,
  watch: true,
}

/**
 * Read-only view of what the loader discovered, for the sidebar panel.
 *
 * A plain object published through `ctx.provide` rather than a `Service`
 * subclass: this package holds no Cordis import, so it stays installable and
 * testable without resolving the Host's framework copy.
 *
 * @param {FilePluginLoader} loader
 * @returns {{ inventory: () => Promise<object> }}
 */
function inventoryService(loader) {
  return {
    /**
     * Re-read the plugin root and describe every plugin it holds.
     *
     * @returns {Promise<{ root: string, plugins: Array<{
     *   name: string, dir: string, description?: string,
     *   skills: number, agents: number, hasHooks: boolean,
     *   skillsNamed: string[], agentsNamed: string[]
     * }> }>}
     */
    async inventory() {
      await loader.refresh()
      return { root: loader.root, plugins: loader.inventory() }
    },
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Config} config
 */
export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const root =
    settings.pluginRoot !== undefined && settings.pluginRoot !== ''
      ? resolve(settings.pluginRoot)
      : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'plugins')

  const loader = new FilePluginLoader(ctx, root, settings)
  ctx.skills.registerProvider((control) => loader.createProvider(control))
  const inventory = inventoryService(loader)
  ctx.provide('pluginFile', inventory)
  registerInventoryRoute(ctx, inventory)

  ctx.effect(function* () {
    yield async () => {
      await loader.dispose()
    }
  }, 'plugin-file loader')
}

/**
 * Serve the inventory to the sidebar panel.
 *
 * Registered only when a web server is mounted, so a headless composition
 * carrying this bundle keeps working.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ inventory: () => Promise<object> }} inventory
 */
function registerInventoryRoute(ctx, inventory) {
  // A composition without a web server simply has no panel to serve; the
  // lookup must not be able to fail plugin activation.
  let webServer
  try {
    webServer = ctx.get('webServer')
  } catch (error) {
    ctx.logger.warn(`plugin-file: web server lookup failed: ${describe(error)}`)
    return
  }
  if (webServer === undefined) return

  // Register eagerly and hand the returned disposer to the effect: the route
  // must exist as soon as the plugin activates, not on teardown.
  const disposeRoute = webServer.register({
    kind: 'exact',
    path: '/api/plugin-file/inventory',
    resource: async () => {
      try {
        return Response.json(await inventory.inventory())
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        )
      }
    },
  })

  ctx.effect(() => disposeRoute, 'plugin-file inventory route')
}

/**
 * Owns discovery state and the registrations derived from it.
 *
 * Skills and commands are served through one registry provider; agents are
 * registered directly on the preset registry and reconciled when their files
 * change.
 */
class FilePluginLoader {
  /** @type {Map<string, object>} */
  #plugins = new Map()
  /** @type {Map<string, { entry: object, disposer: () => Promise<void> }>} */
  #agents = new Map()
  /** @type {import('node:fs').FSWatcher | undefined} */
  #watcher
  /** @type {import('@deepseek-ai/dsh-skill').SkillProviderControl | undefined} */
  #control
  #disposed = false
  #invalidating = false

  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {string} root
   * @param {typeof DEFAULTS} settings
   */
  constructor(ctx, root, settings) {
    this.ctx = ctx
    this.root = root
    this.settings = settings

    if (settings.watch) this.#startWatching()
  }

  /**
   * Build the single registry provider this loader contributes.
   *
   * One provider covers every plugin directory: the registry merges all of them
   * into one catalog anyway, and the control it hands over is the one channel
   * through which a file change can invalidate that merged catalog.
   *
   * @param {import('@deepseek-ai/dsh-skill').SkillProviderControl} control
   * @returns {import('@deepseek-ai/dsh-skill').SkillProvider}
   */
  createProvider(control) {
    const loader = this

    // The registration owns this loader's invalidation channel. A watcher
    // event must reach it, and disposal must detach it, so it lives on the
    // loader rather than inside the returned provider object.
    this.#control = control
    control.signal.addEventListener('abort', () => { void loader.dispose() }, { once: true })

    return {
      name: 'plugin-file',
      async list(options) {
        try {
          const complete = await loader.refresh()
          return complete
            ? loader.candidates()
            : { candidates: loader.candidates(), complete: false }
        } catch (error) {
          // The registry treats a throwing provider as failed discovery and
          // drops the whole catalog, including every other provider's skills.
          // A loader defect must cost only this provider's entries.
          loader.ctx.logger.warn(`plugin-file: discovery failed: ${describe(error)}`)
          return loader.candidates()
        }
      },
      async get(candidate, options) {
        const locator = candidate.locator
        if (locator === undefined) return undefined

        options.signal?.throwIfAborted()
        const text = await readFile(locator.path, 'utf8').catch(() => undefined)
        if (text === undefined) return undefined

        const parsed = parseMarkdown(text, locator.path)
        if (parsed === undefined) return undefined

        return {
          name: candidate.name,
          description: candidate.description,
          ...(candidate.whenToUse === undefined ? {} : { whenToUse: candidate.whenToUse }),
          invocation: candidate.invocation,
          source: candidate.source,
          provider: 'plugin-file',
          resourceBase: { kind: 'directory', path: locator.directory },
          path: locator.path,
          content: parsed.body,
        }
      },
    }
  }

  /**
   * Re-scan and reconcile agent registrations.
   *
   * @returns {Promise<boolean>} whether discovery completed without warnings.
   */
  async refresh() {
    if (this.#disposed) return true

    /** @type {string[]} */
    const warnings = []
    const report = await discoverPlugins(this.root, (message) => warnings.push(message))

    for (const warning of warnings) {
      this.ctx.logger.warn(`plugin-file: ${warning}`)
    }

    this.#plugins = new Map(report.plugins.map((plugin) => [plugin.name, plugin]))

    try {
      await this.#reconcileAgents(report.plugins)
    } catch (error) {
      // Preset registration is a separate surface: a failure there must not
      // hide the skills this loader already discovered.
      this.ctx.logger.warn(`plugin-file: agent presets could not be reconciled: ${describe(error)}`)
    }

    return warnings.length === 0
  }

  /**
   * Describe the plugins the last refresh found, for display.
   *
   * Shapes only what a reader needs to recognize a plugin; the full entry list
   * stays internal so a panel cannot become a second source of truth.
   *
   * @returns {Array<{ name: string, dir: string, description?: string,
   *   skills: number, agents: number, hasHooks: boolean,
   *   skillsNamed: string[], agentsNamed: string[] }>}
   */
  inventory() {
    return [...this.#plugins.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((plugin) => ({
        name: plugin.name,
        dir: plugin.dir,
        ...(plugin.manifest.description === undefined
          ? {}
          : { description: plugin.manifest.description }),
        skills: plugin.skills.length,
        agents: plugin.agents.length,
        hasHooks: plugin.hooksPath !== undefined,
        skillsNamed: plugin.skills.map((entry) => entry.name),
        agentsNamed: plugin.agents.map((entry) => entry.name),
      }))
  }

  /**
   * @returns {import('@deepseek-ai/dsh-skill').SkillCandidate[]}
   */
  candidates() {
    /** @type {import('@deepseek-ai/dsh-skill').SkillCandidate[]} */
    const candidates = []

    for (const plugin of this.#plugins.values()) {
      for (const entry of plugin.skills) {
        candidates.push({
          name: entry.name,
          description: entry.description,
          ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
          invocation: {
            modelInvocable: entry.modelInvocable,
            userInvocable: entry.userInvocable,
          },
          source: 'custom',
          provider: 'plugin-file',
          rank: 0,
          locator: { path: entry.path, directory: plugin.dir },
        })
      }
    }

    return candidates
  }

  /**
   * Register agent presets, replacing the ones whose files changed.
   *
   * A preset is activated once and shared by the sessions that select it, so a
   * changed definition reaches new sessions only. Existing sessions keep the
   * revision they started with; that is a Host property, not something this
   * loader can override.
   *
   * @param {object[]} plugins
   */
  async #reconcileAgents(plugins) {
    // The preset registry is optional: this plugin only injects `skills`, so a
    // direct property read would throw on a composition without presets. Every
    // other lookup in Cordis takes this same guarded form.
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return

    /** @type {Map<string, { entry: object, disposer: () => Promise<void> }>} */
    const previous = this.#agents
    /** @type {typeof previous} */
    const next = new Map()

    for (const plugin of plugins) {
      for (const entry of plugin.agents) {
        const id = presetId(plugin.name, entry.name)
        const existing = previous.get(id)

        // Re-registering an unchanged preset would churn the roster on every
        // catalog read, so keep the live registration when nothing changed.
        if (existing !== undefined && sameAgent(existing.entry, entry)) {
          next.set(id, existing)
          previous.delete(id)
          continue
        }

        if (existing !== undefined) {
          await dispose(existing.disposer)
          previous.delete(id)
        }

        try {
          const disposer = await presets.register({
            id,
            name: entry.name,
            description: entry.description,
            plugins: [
              {
                id: 'persona',
                name: '@deepseek-ai/dsh-persona',
                config: { prefix: entry.body },
              },
            ],
          })
          next.set(id, { entry, disposer })
        } catch (error) {
          this.ctx.logger.warn(
            `plugin-file: agent "${entry.name}" from "${plugin.name}" could not be registered: ${describe(error)}`,
          )
        }
      }
    }

    // Anything still held by the previous map lost its file (or its plugin was
    // removed) and must stop serving sessions.
    for (const stale of previous.values()) {
      await dispose(stale.disposer)
    }

    this.#agents = next
  }

  #startWatching() {
    try {
      this.#watcher = watch(this.root, { recursive: true }, () => {
        // Any change to the tree may alter any catalog; coalesce a burst of
        // events into one invalidation. The registry re-reads on next lookup,
        // so an eager scan here would only burn work that may be discarded.
        this.#scheduleInvalidate()
      })
      this.#watcher.on('error', (error) => {
        this.ctx.logger.warn(`plugin-file: watching ${this.root} failed: ${describe(error)}`)
      })
    } catch (error) {
      // A missing root is normal before the first plugin is written.
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        this.ctx.logger.warn(`plugin-file: cannot watch ${this.root}: ${describe(error)}`)
      }
    }
  }

  #scheduleInvalidate() {
    if (this.#invalidating) return
    this.#invalidating = true

    setTimeout(() => {
      this.#invalidating = false
      if (this.#disposed) return
      this.#control?.invalidate()
    }, 150).unref?.()
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true

    this.#watcher?.close()
    this.#watcher = undefined

    for (const held of this.#agents.values()) {
      await dispose(held.disposer)
    }
    this.#agents.clear()
  }
}

/**
 * @param {string} plugin
 * @param {string} agent
 * @returns {string}
 */
function presetId(plugin, agent) {
  return `file-${plugin}-${agent}`
}

/**
 * Decide whether a live preset already matches a discovered agent.
 *
 * Only the fields that shape the registered definition participate: a
 * touched file with an unchanged body must not churn the preset roster.
 *
 * @param {object} left
 * @param {object} right
 * @returns {boolean}
 */
function sameAgent(left, right) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.body === right.body
  )
}

/**
 * @param {() => unknown} disposer
 */
async function dispose(disposer) {
  try {
    await disposer()
  } catch {
    // A disposer that throws on teardown must not block the remaining ones.
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
