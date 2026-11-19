import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { installFromUrl } from '../src/install.js'

/**
 * Build a zip-like tree and install it through the same code path the panel
 * uses, by serving the archive from a stub fetch.
 *
 * These tests exist because the layout rules are the fragile part: a
 * repository that groups plugins under `plugins/` is the Claude Code
 * convention, and a search that stops one level short silently reports that no
 * plugin exists.
 */

async function withRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dpf-install-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Serve a prebuilt archive for any fetch, so the test does not need network.
 *
 * @param {string} archive path to a .zip
 */
function staticFetch(archive) {
  return async () => {
    const { readFile } = await import('node:fs/promises')
    const body = await readFile(archive)
    return new Response(body, { status: 200, headers: { 'content-length': String(body.byteLength) } })
  }
}

/**
 * Zip a directory tree with the platform tool.
 *
 * @param {string} dir
 * @param {string} into
 */
async function zip(dir, into) {
  const { execFileSync } = await import('node:child_process')
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory([string]$env:DSH_ZIP_SRC, [string]$env:DSH_ZIP_DST)',
  ].join('; ')
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore',
    env: { ...process.env, DSH_ZIP_SRC: dir, DSH_ZIP_DST: into },
  })
}

/**
 * @param {string} root
 * @param {Record<string, string>} files path -> content
 */
async function makeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, ...relative.split('/'))
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content, 'utf8')
  }
}

test('a plugin grouped under plugins/ is found from the repository root', async () => {
  await withRoot(async (root) => {
    // A GitHub archive always nests everything under one wrapper folder; the
    // grouping directory then sits below it.
    const wrapped = join(root, 'wrapped')
    await makeTree(wrapped, {
      'repo-main/README.md': '# repo',
      'repo-main/plugins/wukong/plugin.json': JSON.stringify({ name: 'wukong' }),
      'repo-main/plugins/wukong/skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\nb\n',
    })

    const archive = join(root, 'repo.zip')
    await zip(wrapped, archive)

    const installRoot = join(root, 'plugins')
    const result = await installFromUrl('https://example.test/plugin.zip', {
      root: installRoot,
      fetchImpl: staticFetch(archive),
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.name, 'wukong')
    assert.equal(result.skills, 1)
  })
})

test('a repository holding several plugins is refused with their names', async () => {
  await withRoot(async (root) => {
    const wrapped = join(root, 'wrapped')
    await makeTree(wrapped, {
      'repo-main/plugins/alpha/plugin.json': JSON.stringify({ name: 'alpha' }),
      'repo-main/plugins/beta/plugin.json': JSON.stringify({ name: 'beta' }),
    })

    const archive = join(root, 'two.zip')
    await zip(wrapped, archive)

    const result = await installFromUrl('https://example.test/plugin.zip', {
      root: join(root, 'plugins'),
      fetchImpl: staticFetch(archive),
    })

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'multiple-plugins')
    assert.match(result.error.message, /alpha/u)
    assert.match(result.error.message, /beta/u)
  })
})

test('a repository with no manifest anywhere reports it plainly', async () => {
  await withRoot(async (root) => {
    const wrapped = join(root, 'wrapped')
    await makeTree(wrapped, { 'repo-main/README.md': '# nothing here' })

    const archive = join(root, 'none.zip')
    await zip(wrapped, archive)

    const result = await installFromUrl('https://example.test/plugin.zip', {
      root: join(root, 'plugins'),
      fetchImpl: staticFetch(archive),
    })

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'no-manifest')
  })
})

test('an archive that names the plugin manifest at its top level installs', async () => {
  await withRoot(async (root) => {
    const plain = join(root, 'plain')
    await makeTree(plain, {
      'plugin.json': JSON.stringify({ name: 'flat' }),
      'skills/s.md': '---\nname: s\ndescription: d\n---\nb\n',
    })

    const archive = join(root, 'flat.zip')
    await zip(plain, archive)

    const result = await installFromUrl('https://example.test/plugin.zip', {
      root: join(root, 'plugins'),
      fetchImpl: staticFetch(archive),
    })

    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.name, 'flat')
  })
})

test('a downloaded archive without a manifest name is refused', async () => {
  await withRoot(async (root) => {
    const plain = join(root, 'plain')
    await makeTree(plain, { 'plugin.json': JSON.stringify({ name: 'Not Kebab' }) })

    const archive = join(root, 'bad.zip')
    await zip(plain, archive)

    const result = await installFromUrl('https://example.test/plugin.zip', {
      root: join(root, 'plugins'),
      fetchImpl: staticFetch(archive),
    })

    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'invalid-manifest')
  })
})
