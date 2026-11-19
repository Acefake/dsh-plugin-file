import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { classifyUrl } from '../src/install.js'

test('a repository link resolves to its default branch archive', () => {
  assert.deepEqual(classifyUrl('https://github.com/Acefake/s-skills'), {
    kind: 'github-repo',
    owner: 'Acefake',
    repo: 's-skills',
  })
})

test('a trailing slash and a .git suffix are tolerated', () => {
  assert.deepEqual(classifyUrl('https://github.com/Acefake/s-skills/'), {
    kind: 'github-repo',
    owner: 'Acefake',
    repo: 's-skills',
  })
})

test('a tree link carries its branch and subdirectory', () => {
  assert.deepEqual(classifyUrl('https://github.com/Acefake/s-skills/tree/main/plugins/wukong'), {
    kind: 'github-tree',
    owner: 'Acefake',
    repo: 's-skills',
    ref: 'main',
    subpath: 'plugins/wukong',
  })
})

test('a tree link without a subdirectory is still a tree link', () => {
  assert.deepEqual(classifyUrl('https://github.com/Acefake/s-skills/tree/main'), {
    kind: 'github-tree',
    owner: 'Acefake',
    repo: 's-skills',
    ref: 'main',
    subpath: '',
  })
})

test('a zip link is taken as-is', () => {
  assert.deepEqual(classifyUrl('https://example.com/plugin.zip'), {
    kind: 'zip-url',
    url: 'https://example.com/plugin.zip',
  })
})

test('unsupported hosts and malformed input are refused with a reason', () => {
  assert.equal(classifyUrl('https://gitlab.com/a/b').kind, 'error')
  assert.equal(classifyUrl('not a url').kind, 'error')
  assert.equal(classifyUrl('ftp://x/y').kind, 'error')
  assert.equal(classifyUrl('https://github.com/onlyowner').kind, 'error')
  assert.equal(classifyUrl('https://github.com/a/b/tree').kind, 'error')
})

test('a file URL is refused', () => {
  const result = classifyUrl('file:///C:/tmp/plugin.zip')
  assert.equal(result.kind, 'error')
})
