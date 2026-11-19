import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isKebabCase,
  normalizeManifest,
  parseMarkdown,
  readBoolean,
  toAgentEntry,
  toSkillEntry,
} from '../src/parse.js'

const KEBAB = 'ke-bab'

test('parseMarkdown splits frontmatter from body', () => {
  const parsed = parseMarkdown(
    ['---', 'name: hello', 'description: Says hello', '---', '', '# Body', '', 'text'].join('\n'),
    '/p/hello.md',
  )

  assert.equal(parsed.frontmatter.name, 'hello')
  assert.equal(parsed.frontmatter.description, 'Says hello')
  assert.equal(parsed.body, '# Body\n\ntext')
  assert.equal(parsed.path, '/p/hello.md')
})

test('parseMarkdown handles CRLF and a BOM', () => {
  const parsed = parseMarkdown('\uFEFF---\r\nname: hello\r\n---\r\nbody\r\n', '/p/x.md')

  assert.equal(parsed.frontmatter.name, 'hello')
  assert.equal(parsed.body, 'body\n')
})

test('parseMarkdown returns undefined without frontmatter', () => {
  assert.equal(parseMarkdown('# no frontmatter\n', '/p/x.md'), undefined)
  assert.equal(parseMarkdown('---\nname: x\n', '/p/x.md'), undefined)
})

test('parseMarkdown strips matching quotes and reads YAML booleans', () => {
  const parsed = parseMarkdown(
    ['---', 'a: "quoted"', "b: 'single'", 'c: true', 'd: off', 'e: 1', '---', ''].join('\n'),
    '/p/x.md',
  )

  assert.equal(parsed.frontmatter.a, 'quoted')
  assert.equal(parsed.frontmatter.b, 'single')
  assert.equal(parsed.frontmatter.c, true)
  assert.equal(parsed.frontmatter.d, false)
  assert.equal(parsed.frontmatter.e, true)
})

test('readBoolean distinguishes absent, usable, and unusable', () => {
  assert.equal(readBoolean(undefined), undefined)
  assert.equal(readBoolean(true), true)
  assert.equal(readBoolean(false), false)
  assert.equal(readBoolean('maybe'), null)
})

test('isKebabCase accepts lowercase slugs only', () => {
  assert.equal(isKebabCase(KEBAB), true)
  assert.equal(isKebabCase('abc123'), true)
  assert.equal(isKebabCase('Bad'), false)
  assert.equal(isKebabCase('a b'), false)
  assert.equal(isKebabCase('-lead'), false)
  assert.equal(isKebabCase('trail-'), false)
})

test('normalizeManifest defaults directory fields', () => {
  const manifest = normalizeManifest({ description: 'x' }, 'my-plugin')

  assert.equal(manifest.name, 'my-plugin')
  assert.equal(manifest.skills, 'skills')
  assert.equal(manifest.agents, 'agents')
  assert.equal(manifest.hooks, 'hooks/hooks.json')
})

test('normalizeManifest honours declared directories and rejects a bad name', () => {
  const manifest = normalizeManifest({ skills: 'extra/skills' }, 'my-plugin')
  assert.equal(manifest.skills, 'extra/skills')

  assert.equal(normalizeManifest({}, 'Not Kebab'), undefined)
})

test('toSkillEntry maps disable-model-invocation onto modelInvocable', () => {
  const parsed = parseMarkdown(
    ['---', 'name: my-skill', 'description: does things', 'disable-model-invocation: true', '---', 'body'].join('\n'),
    '/p/s.md',
  )
  const result = toSkillEntry(parsed, 'fallback', { userInvocableDefault: true })

  assert.ok('entry' in result)
  assert.equal(result.entry.kind, 'skill')
  assert.equal(result.entry.modelInvocable, false)
  assert.equal(result.entry.userInvocable, true)
})

test('toSkillEntry applies the caller default for user-invocable', () => {
  const parsed = parseMarkdown(['---', 'name: my-skill', 'description: d', '---', ''].join('\n'), '/p/s.md')

  const asCommand = toSkillEntry(parsed, 'fallback', { userInvocableDefault: true })
  const asSkill = toSkillEntry(parsed, 'fallback', { userInvocableDefault: false })

  assert.ok('entry' in asCommand && 'entry' in asSkill)
  assert.equal(asCommand.entry.userInvocable, true)
  assert.equal(asSkill.entry.userInvocable, false)
})

test('toSkillEntry rejects missing description and unusable booleans', () => {
  const noDescription = parseMarkdown(['---', 'name: my-skill', '---', ''].join('\n'), '/p/s.md')
  const badBoolean = parseMarkdown(
    ['---', 'name: my-skill', 'description: d', 'user-invocable: sometimes', '---', ''].join('\n'),
    '/p/s.md',
  )

  assert.ok('error' in toSkillEntry(noDescription, 'fallback', { userInvocableDefault: true }))
  assert.ok('error' in toSkillEntry(badBoolean, 'fallback', { userInvocableDefault: true }))
})

test('toSkillEntry falls back to the file name', () => {
  const parsed = parseMarkdown(['---', 'description: d', '---', ''].join('\n'), '/p/from-file.md')
  const result = toSkillEntry(parsed, 'from-file', { userInvocableDefault: true })

  assert.ok('entry' in result)
  assert.equal(result.entry.name, 'from-file')
})

test('toAgentEntry reads a comma-separated tool list', () => {
  const parsed = parseMarkdown(
    ['---', 'name: my-agent', 'description: d', 'tools: read, grep, "glob"', '---', 'You review code.'].join('\n'),
    '/p/a.md',
  )
  const result = toAgentEntry(parsed, 'fallback')

  assert.ok('entry' in result)
  assert.equal(result.entry.kind, 'agent')
  assert.deepEqual(result.entry.tools, ['read', 'grep', 'glob'])
})

test('toAgentEntry reads a bracketed tool list', () => {
  const parsed = parseMarkdown(
    ['---', 'name: my-agent', 'description: d', 'tools: [read, grep]', '---', 'body'].join('\n'),
    '/p/a.md',
  )
  const result = toAgentEntry(parsed, 'fallback')

  assert.ok('entry' in result)
  assert.deepEqual(result.entry.tools, ['read', 'grep'])
})

test('toAgentEntry rejects an empty body', () => {
  const parsed = parseMarkdown(['---', 'name: my-agent', 'description: d', '---', '   '].join('\n'), '/p/a.md')

  assert.ok('error' in toAgentEntry(parsed, 'fallback'))
})
