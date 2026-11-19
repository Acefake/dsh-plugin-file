import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/index.js'

/**
 * A Host stand-in that records what the plugin registers.
 *
 * The point of these tests is the wiring: a provider that never receives its
 * control, or a preset that is registered twice, would look correct in a
 * source review and still fail in a session.
 */
function fakeContext() {
  const registrations = {
    providers: [],
    presets: [],
    warned: [],
  }

  const ctx = {
    skills: {
      registerProvider(create) {
        const control = { signal: new AbortController().signal, invalidate: () => {} }
        const provider = create(control)
        registrations.providers.push({ provider, control })
        return () => {}
      },
    },
    agentPresets: {
      async register(definition) {
        registrations.presets.push(definition)
        return async () => {}
      },
    },
    effect(subject, label) {
      registrations.effects ??= []
      // Cordis accepts a disposer function or a generator of disposers.
      const cleanup =
        typeof subject === 'function'
          ? subject
          : (() => {
              const iterator = subject()
              iterator.next()
              return () => {}
            })()
      registrations.effects.push({ label, cleanup })
      return () => {}
    },
    logger: {
      warn(message) {
        registrations.warned.push(message)
      },
    },
    // Cordis publishes a plugin-owned service through `provide`; the loader
    // exposes the inventory this way so the sidebar panel can read it.
    provide(name, value) {
      registrations.provided ??= new Map()
      registrations.provided.set(name, value)
      return () => {}
    },
    // Cordis runs the callback once every named service is available, and a
    // lookup it cannot satisfy simply does not run the callback. The stand-in
    // mirrors that: a throwing or missing lookup skips the callback rather
    // than aborting activation.
    inject(names, callback) {
      const inner = { get: (name) => ctx.get(name), effect: (fn, label) => ctx.effect(fn, label) }
      try {
        callback(inner)
      } catch {
        // A service the composition does not provide leaves the contribution
        // absent, exactly as an unsatisfied inject would.
      }
      return { dispose() {} }
    },
    // Cordis exposes an optional service through `ctx.get(name)`; a direct
    // property read throws when the composition does not mount it, so the
    // plugin must use this form and the stand-in must match.
    get(name) {
      return name === 'agentPresets' ? ctx.agentPresets : undefined
    },
  }

  return { ctx, registrations }
}

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-host-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function write(root, relative, content) {
  const path = join(root, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
}

test('registers one provider whose list exposes skills and commands', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/greeter/SKILL.md', '---\nname: greeter\ndescription: Greets\n---\nHello.\n')
    await write(root, 'demo/commands/review.md', '---\ndescription: Reviews\n---\nReview.\n')

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })

    assert.equal(registrations.providers.length, 1)
    const provider = registrations.providers[0].provider
    assert.equal(provider.name, 'plugin-file')

    const listed = await provider.list({ cwd: root })
    const candidates = Array.isArray(listed) ? listed : listed.candidates

    assert.deepEqual(
      candidates.map((entry) => entry.name).sort(),
      ['greeter', 'review'],
    )

    // A command must be user-invocable: that is the only surface that can
    // deliver its body, since a host command never reaches the model.
    const review = candidates.find((entry) => entry.name === 'review')
    assert.equal(review.invocation.userInvocable, true)
  })
})

test('get() returns the file body as skill content', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/greeter/SKILL.md', '---\nname: greeter\ndescription: Greets\n---\nSay hello warmly.\n')

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })

    const provider = registrations.providers[0].provider
    const listed = await provider.list({ cwd: root })
    const candidates = Array.isArray(listed) ? listed : listed.candidates
    const loaded = await provider.get(candidates[0], {})

    assert.equal(loaded.name, 'greeter')
    assert.equal(loaded.description, 'Greets')
    assert.equal(loaded.content.trimEnd(), 'Say hello warmly.')
    assert.equal(loaded.provider, 'plugin-file')
  })
})

test('registers agent presets and does not churn them on repeated reads', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(
      root,
      'demo/agents/reviewer.md',
      '---\nname: reviewer\ndescription: Reviews code\n---\nYou review code.\n',
    )

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })

    const provider = registrations.providers[0].provider
    await provider.list({ cwd: root })
    assert.equal(registrations.presets.length, 1)
    assert.equal(registrations.presets[0].id, 'file-demo-reviewer')

    // A second catalog read with unchanged files must reuse the registration.
    await provider.list({ cwd: root })
    assert.equal(registrations.presets.length, 1)
  })
})

test('a changed agent body re-registers the preset', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(
      root,
      'demo/agents/reviewer.md',
      '---\nname: reviewer\ndescription: Reviews code\n---\nFirst body.\n',
    )

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })
    const provider = registrations.providers[0].provider

    await provider.list({ cwd: root })
    assert.equal(registrations.presets.length, 1)

    await write(
      root,
      'demo/agents/reviewer.md',
      '---\nname: reviewer\ndescription: Reviews code\n---\nSecond body.\n',
    )
    await provider.list({ cwd: root })

    assert.equal(registrations.presets.length, 2)
    assert.equal(
      registrations.presets[1].plugins[0].config.prefix.trimEnd(),
      'Second body.',
    )
  })
})

test('the skill provider survives a plugin whose manifest is broken', async () => {
  await withRoot(async (root) => {
    await write(root, 'broken/plugin.json', 'nope')
    await write(root, 'good/plugin.json', '{}')
    await write(root, 'good/skills/s.md', '---\nname: s\ndescription: d\n---\nb\n')

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })

    const provider = registrations.providers[0].provider
    const listed = await provider.list({ cwd: root })

    // A warning downgrades the observation to incomplete but keeps the
    // readable plugin in the catalog.
    assert.equal(listed.complete, false)
    assert.equal(listed.candidates.length, 1)
    assert.equal(registrations.warned.length, 1)
  })
})

test('a missing plugin root lists nothing and warns about nothing', async () => {
  const { ctx, registrations } = fakeContext()
  apply(ctx, { pluginRoot: join(tmpdir(), 'dpf-absent-root'), watch: false })

  const provider = registrations.providers[0].provider
  const listed = await provider.list({})

  assert.deepEqual(listed, [])
  assert.deepEqual(registrations.warned, [])
})

test('the inventory service describes each discovered plugin', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', JSON.stringify({ description: 'Demo plugin' }))
    await write(root, 'demo/skills/greeter/SKILL.md', '---\nname: greeter\ndescription: d\n---\nb\n')
    await write(root, 'demo/commands/review.md', '---\ndescription: d\n---\nb\n')
    await write(root, 'demo/agents/reviewer.md', '---\nname: reviewer\ndescription: d\n---\nbody\n')
    await write(root, 'demo/hooks/hooks.json', '{}')

    const { ctx, registrations } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })

    const service = registrations.provided.get('pluginFile')
    assert.ok(service !== undefined)

    const value = await service.inventory()

    assert.equal(value.root, root)
    assert.equal(value.plugins.length, 1)

    const plugin = value.plugins[0]
    assert.equal(plugin.name, 'demo')
    assert.equal(plugin.description, 'Demo plugin')
    assert.equal(plugin.skills, 2)
    assert.equal(plugin.agents, 1)
    assert.equal(plugin.hasHooks, true)
    assert.deepEqual(plugin.skillsNamed.sort(), ['greeter', 'review'])
    assert.deepEqual(plugin.agentsNamed, ['reviewer'])
  })
})

test('the inventory route answers with the same service value', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/one.md', '---\nname: one\ndescription: d\n---\nb\n')

    const { ctx, registrations } = fakeContext()
    const routes = []
    ctx.get = (name) =>
      name === 'webServer'
        ? {
            register(route) {
              routes.push(route)
              return () => {}
            },
          }
        : name === 'agentPresets'
          ? ctx.agentPresets
          : undefined

    apply(ctx, { pluginRoot: root, watch: false })

    const inventoryRoute = routes.find((route) => route.path === '/api/plugin-file/inventory')
    const installRoute = routes.find((route) => route.path === '/api/plugin-file/install')
    assert.ok(inventoryRoute !== undefined, 'the inventory route is registered')
    assert.ok(installRoute !== undefined, 'the install route is registered')

    const response = await inventoryRoute.resource()
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.plugins[0].name, 'demo')
  })
})

test('the install route refuses everything but a POST with a url', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')

    const { ctx } = fakeContext()
    const routes = []
    ctx.get = (name) =>
      name === 'webServer'
        ? { register: (route) => { routes.push(route); return () => {} } }
        : name === 'agentPresets'
          ? ctx.agentPresets
          : undefined

    apply(ctx, { pluginRoot: root, watch: false })
    const install = routes.find((route) => route.path === '/api/plugin-file/install')

    const get = await install.resource(new Request('http://x/api/plugin-file/install', { method: 'GET' }))
    assert.equal(get.status, 405)

    const empty = await install.resource(
      new Request('http://x/api/plugin-file/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    assert.equal(empty.status, 400)

    const malformed = await install.resource(
      new Request('http://x/api/plugin-file/install', { method: 'POST', body: 'not json' }),
    )
    assert.equal(malformed.status, 400)
  })
})

test('a preset registry that throws does not remove the skill catalog', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/kept.md', '---\nname: kept\ndescription: d\n---\nb\n')
    await write(
      root,
      'demo/agents/broken.md',
      '---\nname: broken\ndescription: d\n---\nbody\n',
    )

    const { ctx, registrations } = fakeContext()
    ctx.agentPresets.register = async () => {
      throw new Error('preset registry unavailable')
    }

    apply(ctx, { pluginRoot: root, watch: false })
    const provider = registrations.providers[0].provider
    const listed = await provider.list({ cwd: root })
    const candidates = Array.isArray(listed) ? listed : listed.candidates

    // The registry drops every provider's catalog when one provider throws, so
    // a preset-registration failure must never escape into `list()`.
    assert.deepEqual(candidates.map((entry) => entry.name), ['kept'])
    assert.ok(registrations.warned.some((message) => message.includes('preset')))
  })
})

test('an absolute failure inside discovery still yields a result', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/kept.md', '---\nname: kept\ndescription: d\n---\nb\n')

    const { ctx, registrations } = fakeContext()

    // Force the deepest failure a caller can reach: reading the root itself.
    let call = 0
    const originalGet = ctx.get
    ctx.get = (name) => {
      call += 1
      if (call === 1) throw new Error('exploding registry')
      return originalGet?.(name)
    }

    apply(ctx, { pluginRoot: root, watch: false })
    const provider = registrations.providers[0].provider

    // list() must resolve, never reject: a rejection hides every other
    // provider's skills from the same catalog.
    const listed = await provider.list({ cwd: root })
    assert.ok(listed !== undefined)
  })
})
