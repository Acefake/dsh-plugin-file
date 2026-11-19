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
import { installFromUrl } from './install.js'
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

    /**
     * Install one plugin from a link, then re-read the catalog.
     *
     * The loader is invalidated inside this call rather than left to the file
     * watcher: a user who pasted a link and got a success result expects the
     * next catalog read to include it, and the watcher is debounced.
     *
     * @param {string} url
     * @returns {Promise<object>}
     */
    async install(url) {
      const result = await installFromUrl(url, { root: loader.root })
      if (result.ok) {
        await loader.refresh()
        loader.invalidate()
      }
      return result
    },
  }
}

/**
 * Give the agent the same install operation the panel uses.
 *
 * One operation, two callers: the tool and the route both end at
 * `inventory.install`, so a link pasted into the chat and one pasted into the
 * panel behave identically.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ install: (url: string) => Promise<object>, inventory: () => Promise<object> }} inventory
 */
function registerInstallTool(ctx, inventory) {
  ctx.inject(['tools'], (inner) => {
    const tools = inner.get('tools')
    if (tools === undefined) return

    inner.effect(() => tools.register({
      name: 'install_file_plugin',
      description:
        'Install a DeepSeek Harness file plugin from a link. Accepts a GitHub repository, a GitHub subdirectory (tree) link, or a direct .zip URL. Downloads, validates the plugin.json, and copies it into the plugin directory so its skills, commands, and subagents become available.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              'The link to install from, for example https://github.com/owner/repo, https://github.com/owner/repo/tree/main/plugins/name, or https://example.com/plugin.zip',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            name: { type: 'string' },
            dir: { type: 'string' },
            skills: { type: 'number' },
            agents: { type: 'number' },
            replaced: { type: 'boolean' },
            error: {
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' } },
              additionalProperties: false,
            },
          },
          required: ['ok'],
          additionalProperties: false,
        },
        render(_args, value) {
          const body = typeof value === 'string' ? value : JSON.stringify(value)
          return [{ type: 'text', text: body }]
        },
      },
      async execute(args) {
        const url = typeof args?.url === 'string' ? args.url : ''
        if (url === '') {
          return { ok: false, error: { code: 'invalid-url', message: 'url is required' } }
        }
        return inventory.install(url)
      },
    }), 'plugin-file install tool')

    ctx.logger.info('plugin-file: install_file_plugin tool registered')
  })
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
  registerInstallTool(ctx, inventory)

  ctx.effect(function* () {
    yield async () => {
      await loader.dispose()
    }
  }, 'plugin-file loader')
}

/**
 * Serve the inventory to the sidebar panel.
 *
 * Registered through `ctx.inject` so the callback runs only once a web server
 * is actually available. Reading `ctx.get('webServer')` during `apply` can
 * return undefined while the server row is still activating, which would leave
 * the route permanently unregistered and the panel answering 404.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ inventory: () => Promise<object> }} inventory
 */
function registerInventoryRoute(ctx, inventory) {
  ctx.inject(['webServer'], (inner) => {
    const webServer = inner.get('webServer')
    // A composition can declare the seat without binding a server. That is a
    // normal headless arrangement, not a defect worth a warning.
    if (webServer === undefined) return

    const disposeGet = webServer.register({
      kind: 'exact',
      path: '/api/plugin-file/inventory',
      resource: async () => {
        try {
          return Response.json(await inventory.inventory())
        } catch (error) {
          return Response.json({ error: describe(error) }, { status: 500 })
        }
      },
    })

    // Icons are served separately so the inventory payload stays small and a
    // plugin without one costs nothing. The path is a query rather than a
    // route parameter: the carrier accepts exact paths only.
    const disposeIcon = webServer.register({
      kind: 'prefix',
      path: '/api/plugin-file/icon/',
      resource: async (request) => {
        const name = new URL(request.url).pathname.slice('/api/plugin-file/icon/'.length)
        const found = await inventory.icon(decodeURIComponent(name))
        if (found === undefined) return new Response('not found', { status: 404 })
        return new Response(found.body, {
          headers: {
            'content-type': found.type,
            'cache-control': 'no-cache',
            'content-security-policy': "default-src 'none'",
            'x-content-type-options': 'nosniff',
          },
        })
      },
    })

    // A `resource` route answers 405 to anything but GET and HEAD, so the
    // install operation needs a `handler`: the carrier hands it the raw
    // request and response, and reading the body is the handler's job.
    const disposePost = webServer.register({
      kind: 'exact',
      path: '/api/plugin-file/install',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'method', message: 'use POST' } }))
          return
        }

        let url = ''
        try {
          const body = await readJsonBody(req)
          url = typeof body?.url === 'string' ? body.url : ''
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'invalid-body', message: describe(error) } }))
          return
        }

        if (url === '') {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: { code: 'invalid-body', message: 'url is required' } }))
          return
        }

        const result = await inventory.install(url)
        res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result))
      },
    })

    inner.effect(() => disposeGet, 'plugin-file inventory route')
    inner.effect(() => disposeIcon, 'plugin-file icon route')
    inner.effect(() => disposePost, 'plugin-file install route')
    ctx.logger.info('plugin-file: routes registered at /api/plugin-file/{inventory,icon,install}')
  })
}

/**
 * Read and parse a small JSON request body.
 *
 * Bounded on purpose: the only body this route accepts is `{ url }`, so a
 * larger payload is a mistake or an attack, not a use case.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16 * 1024) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
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
        hasIcon: plugin.iconPath !== undefined,
        skillsNamed: plugin.skills.map((entry) => entry.name),
        agentsNamed: plugin.agents.map((entry) => entry.name),
      }))
  }

  /**
   * Read one plugin's icon bytes, for the panel to draw.
   *
   * @param {string} name
   * @returns {Promise<{ body: Buffer, type: string } | undefined>}
   */
  async icon(name) {
    const plugin = this.#plugins.get(name)
    if (plugin?.iconPath === undefined) return undefined

    const body = await readFile(plugin.iconPath).catch(() => undefined)
    if (body === undefined) return undefined

    const extension = plugin.iconPath.slice(plugin.iconPath.lastIndexOf('.')).toLowerCase()
    const type =
      extension === '.svg'
        ? 'image/svg+xml'
        : extension === '.png'
          ? 'image/png'
          : extension === '.webp'
            ? 'image/webp'
            : 'image/jpeg'
    return { body, type }
  }

  /**
   * Ask the registry to re-read this provider's catalog.
   *
   * Used after an installation so the very next read sees the new plugin
   * instead of waiting for the watcher's debounce.
   */
  invalidate() {
    this.#control?.invalidate()
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
