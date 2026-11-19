import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CLIENT = join(import.meta.dirname, '..', 'client.js')

/**
 * These are source-level assertions on purpose.
 *
 * The Client half runs in the browser against a restricted context, and the
 * failures this guards against are silent: a call the context does not have
 * throws inside `apply`, which leaves the panel registered but permanently on
 * its English fallback. Nothing in the Host test surface can observe that.
 */
test('the client half does not use ctx.inject', async () => {
  const source = await readFile(CLIENT, 'utf8')

  // The restricted Client context exposes only get/on/provide/effect. A call
  // to `inject` throws and takes the whole apply with it.
  assert.equal(
    /ctx\.inject\s*\(/u.test(source),
    false,
    'the Client context has no inject(); use ctx.get with an undefined check',
  )
  assert.equal(
    /ctx\s*\.\s*inject\s*\(/u.test(source),
    false,
    'the Client context has no inject(); use ctx.get with an undefined check',
  )
})

test('the locale binding survives a context without the service', async () => {
  const source = await readFile(CLIENT, 'utf8')

  // A guard is what keeps a Headless or pre-locale mount from throwing.
  assert.ok(source.includes("ctx.get('locale')"), 'the locale service is read through ctx.get')
  assert.ok(source.includes('locale/change'), 'a late-activating locale service is picked up')
})

test('both baseline dictionaries are registered', async () => {
  const source = await readFile(CLIENT, 'utf8')

  assert.ok(source.includes("'entry.label': 'File plugins'"), 'the English dictionary is present')
  assert.ok(source.includes("'entry.label': '文件插件'"), 'the Chinese dictionary is present')
})
