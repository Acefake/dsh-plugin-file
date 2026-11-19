import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverPlugins } from '../src/discover.js'

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-'))
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

test('a missing root is an empty state, not a warning', async () => {
  const report = await discoverPlugins(join(tmpdir(), 'dpf-does-not-exist'))
  assert.deepEqual(report.plugins, [])
  assert.deepEqual(report.warnings, [])
})

test('a directory without a manifest is not a plugin', async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, 'not-a-plugin'), { recursive: true })
    const report = await discoverPlugins(root)
    assert.equal(report.plugins.length, 0)
    assert.deepEqual(report.warnings, [])
  })
})

test('discovers skills, commands, agents and hooks', async () => {
  await withRoot(async (root) => {
    await write(root, 'hello/plugin.json', JSON.stringify({ description: 'demo' }))
    await write(
      root,
      'hello/skills/greeter/SKILL.md',
      '---\nname: greeter\ndescription: Greets people\n---\nSay hello.\n',
    )
    await write(
      root,
      'hello/commands/review.md',
      '---\ndescription: Reviews a diff\n---\nReview this.\n',
    )
    await write(
      root,
      'hello/agents/reviewer.md',
      '---\nname: reviewer\ndescription: Reviews code\ntools: read, grep\n---\nYou review.\n',
    )
    await write(root, 'hello/hooks/hooks.json', JSON.stringify({ hooks: {} }))

    const report = await discoverPlugins(root)

    assert.deepEqual(report.warnings, [])
    assert.equal(report.plugins.length, 1)
    const plugin = report.plugins[0]

    assert.equal(plugin.name, 'hello')
    assert.equal(plugin.skills.length, 2)
    assert.equal(plugin.agents.length, 1)
    assert.ok(plugin.hooksPath?.endsWith('hooks.json'))

    const greeter = plugin.skills.find((entry) => entry.name === 'greeter')
    assert.equal(greeter.userInvocable, true)

    // A command becomes a user-invocable skill named after its file.
    const review = plugin.skills.find((entry) => entry.name === 'review')
    assert.equal(review.kind, 'skill')
    assert.equal(review.userInvocable, true)

    const agent = plugin.agents[0]
    assert.equal(agent.name, 'reviewer')
    assert.deepEqual(agent.tools, ['read', 'grep'])
  })
})

test('a skill in a skill directory defaults to user-invocable too', async () => {
  await withRoot(async (root) => {
    await write(root, 'p/plugin.json', '{}')
    await write(root, 'p/skills/plain.md', '---\nname: plain\ndescription: d\n---\nbody\n')

    const report = await discoverPlugins(root)
    const entry = report.plugins[0].skills[0]
    assert.equal(entry.userInvocable, true)
  })
})

test('reads the Claude Code manifest location', async () => {
  await withRoot(async (root) => {
    await write(root, 'legacy/.claude-plugin/plugin.json', JSON.stringify({ name: 'legacy' }))
    await write(root, 'legacy/skills/s.md', '---\nname: s\ndescription: d\n---\nb\n')

    const report = await discoverPlugins(root)
    assert.equal(report.plugins.length, 1)
    assert.equal(report.plugins[0].name, 'legacy')
  })
})

test('malformed plugins are skipped with a warning and do not hide siblings', async () => {
  await withRoot(async (root) => {
    await write(root, 'broken/plugin.json', '{ not json')
    await write(root, 'fine/plugin.json', '{}')
    await write(root, 'fine/skills/s.md', '---\nname: s\ndescription: d\n---\nb\n')

    const report = await discoverPlugins(root)

    assert.equal(report.plugins.length, 1)
    assert.equal(report.plugins[0].name, 'fine')
    assert.equal(report.warnings.length, 1)
    assert.match(report.warnings[0], /broken/)
  })
})

test('a file without frontmatter is dropped but its siblings survive', async () => {
  await withRoot(async (root) => {
    await write(root, 'p/plugin.json', '{}')
    await write(root, 'p/skills/nofm.md', 'just text\n')
    await write(root, 'p/skills/ok.md', '---\nname: ok\ndescription: d\n---\nb\n')

    const report = await discoverPlugins(root)

    assert.deepEqual(
      report.plugins[0].skills.map((entry) => entry.name),
      ['ok'],
    )
    assert.equal(report.warnings.length, 1)
    assert.match(report.warnings[0], /frontmatter/)
  })
})

test('declared directory names override the defaults', async () => {
  await withRoot(async (root) => {
    await write(root, 'p/plugin.json', JSON.stringify({ skills: 'extra/prompts' }))
    await write(root, 'p/extra/prompts/s.md', '---\nname: s\ndescription: d\n---\nb\n')

    const report = await discoverPlugins(root)
    assert.equal(report.plugins[0].skills.length, 1)
  })
})
