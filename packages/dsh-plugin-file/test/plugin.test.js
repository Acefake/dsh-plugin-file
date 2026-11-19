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
    effect(generator, label) {
      const iterator = generator()
      const first = iterator.next()
      registrations.effects ??= []
      registrations.effects.push({ label, cleanup: first.value })
      return () => {}
    },
    logger: {
      warn(message) {
        registrations.warned.push(message)
      },
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
