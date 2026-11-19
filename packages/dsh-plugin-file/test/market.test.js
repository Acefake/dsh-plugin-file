import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeMarketUrl, parseMarketplace } from '../src/market.js'

const BASE = 'https://raw.githubusercontent.com/Acefake/s-skills/main/.claude-plugin/'

test('a Claude Code marketplace resolves a relative source to a tree link', () => {
  const document = {
    name: 's-skills',
    description: 'S 的中文 AI 技能',
    plugins: [
      { name: 'wukong', source: './plugins/wukong', description: '82 个中文技能' },
    ],
  }

  const parsed = parseMarketplace(document, BASE)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.document.name, 's-skills')
  assert.equal(parsed.document.description, 'S 的中文 AI 技能')
  assert.equal(parsed.plugins.length, 1)
  assert.equal(parsed.plugins[0].name, 'wukong')
  assert.equal(
    parsed.plugins[0].installUrl,
    'https://github.com/Acefake/s-skills/tree/main/plugins/wukong',
  )
})

test('an absolute source is kept as written', () => {
  const parsed = parseMarketplace(
    {
      name: 'mixed',
      plugins: [{ name: 'remote', source: 'https://github.com/other/repo' }],
    },
    BASE,
  )

  assert.equal(parsed.ok, true)
  assert.equal(parsed.plugins[0].installUrl, 'https://github.com/other/repo')
})

test('an object source names a repository and an optional path', () => {
  const parsed = parseMarketplace(
    {
      name: 'objects',
      plugins: [
        { name: 'a', source: { repo: 'owner/repo' } },
        { name: 'b', source: { repo: 'owner/repo', path: './plugins/b' } },
        { name: 'c', source: { url: 'https://github.com/owner/repo', path: 'plugins/c' } },
      ],
    },
    BASE,
  )

  assert.equal(parsed.ok, true)
  assert.equal(parsed.plugins[0].installUrl, 'https://github.com/owner/repo')
  assert.equal(parsed.plugins[1].installUrl, 'https://github.com/owner/repo/tree/HEAD/plugins/b')
  assert.equal(parsed.plugins[2].installUrl, 'https://github.com/owner/repo/tree/HEAD/plugins/c')
})

test('entries without a usable source are dropped, not fatal', () => {
  const parsed = parseMarketplace(
    {
      name: 'partial',
      plugins: [
        { name: 'good', source: './plugins/good' },
        { name: 'no-source' },
        { source: './plugins/nameless' },
        null,
        { name: 'bad-shape', source: 42 },
      ],
    },
    BASE,
  )

  assert.equal(parsed.ok, true)
  assert.deepEqual(
    parsed.plugins.map((entry) => entry.name),
    ['good'],
  )
})

test('a document without plugins is refused with a reason', () => {
  const parsed = parseMarketplace({ name: 'empty' }, BASE)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.error.code, 'invalid-marketplace')
})

test('a non-object document is refused', () => {
  assert.equal(parseMarketplace([], BASE).ok, false)
  assert.equal(parseMarketplace(null, BASE).ok, false)
})

test('market URLs must be http(s) and lose a trailing slash', () => {
  assert.deepEqual(normalizeMarketUrl('https://github.com/a/b/'), {
    ok: true,
    url: 'https://github.com/a/b',
  })
  assert.equal(normalizeMarketUrl('ftp://x/y').ok, false)
  assert.equal(normalizeMarketUrl('nope').ok, false)
})
