import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../src/index.js'

/**
 * The panel removes plugins through the inventory service. These tests drive
 * that service directly, because the HTTP route is only a transport over it.
 */

function fakeContext() {
  let service
  const ctx = {
    skills: { registerProvider: () => () => {} },
    provide(name, value) {
      if (name === 'pluginFile') service = value
      return () => {}
    },
    logger: { warn() {}, info() {} },
    get(name) {
      if (name === 'agentPresets') return { register: async () => async () => {} }
      return undefined
    },
    effect() {
      return () => {}
    },
    // The Host context does have inject; the route registration uses it to
    // wait for the web server. This stand-in runs the callback immediately
    // against its own `get`, which returns no server, so no route is created.
    inject(names, callback) {
      callback({ get: (name) => ctx.get(name), effect: (fn) => ctx.effect(fn) })
      return { dispose() {} }
    },
  }
  return { ctx, service: () => service }
}

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-uninstall-'))
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

test('uninstall removes the plugin directory and drops it from the inventory', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'demo/skills/s.md', '---\nname: s\ndescription: d\n---\nb\n')

    const { ctx, service } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })
    const inventory = service()

    const before = await inventory.inventory()
    assert.equal(before.plugins.length, 1)

    const result = await inventory.uninstall('demo')
    assert.deepEqual(result, { ok: true })

    const after = await inventory.inventory()
    assert.equal(after.plugins.length, 0)

    const remaining = await readdir(root).catch(() => [])
    assert.deepEqual(remaining, [])
  })
})

test('uninstall refuses a name that is not an installed plugin', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')

    const { ctx, service } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })
    const inventory = service()

    const result = await inventory.uninstall('../../etc')
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'not-found')

    // The sibling is untouched.
    const after = await inventory.inventory()
    assert.equal(after.plugins.length, 1)
  })
})

test('removing a marketplace leaves its plugins installed', async () => {
  await withRoot(async (root) => {
    await write(root, 'demo/plugin.json', '{}')
    await write(root, 'marketplaces.json', JSON.stringify({ version: 1, sources: [] }))

    const { ctx, service } = fakeContext()
    apply(ctx, { pluginRoot: root, watch: false })
    const inventory = service()

    const removed = await inventory.removeMarket('https://example.test/market')
    assert.equal(removed.ok, false, 'no such source to remove')

    // The point of the test: a marketplace operation never touches plugins.
    const after = await inventory.inventory()
    assert.equal(after.plugins.length, 1)
  })
})
