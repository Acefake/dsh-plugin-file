/**
 * Validate plugins-index.json with the rule set DSH reads it with.
 *
 * The validator cannot tell a real commit from 40 zeros, so this script also
 * requires that every git source pins the repository's current HEAD. A
 * placeholder that passes the schema still installs nothing.
 *
 * Runs under the DSH Electron runtime, which is the only Node that can read
 * packages from app.asar.
 *
 * Usage: node scripts/validate-index.mjs [--stamp]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const here = import.meta.dirname
const repoRoot = join(here, '..')
const indexPath = join(repoRoot, 'plugins-index.json')
const indexUrl =
  'https://raw.githubusercontent.com/dsh-plugin-file/dsh-plugin-file/main/plugins-index.json'

const installDir = process.env.DSH_INSTALL_DIR
if (installDir === undefined || installDir === '') {
  console.error('DSH_INSTALL_DIR is not set; run this through the DSH Electron runtime.')
  process.exit(2)
}

const require = createRequire(join(installDir, 'package.json'))
const { parseMarketIndex, marketInstallTarget } = require('@deepseek-ai/dsh-plugin-market-index')

const document = JSON.parse(await readFile(indexPath, 'utf8'))

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const head = headCommit()
const stamp = process.argv.includes('--stamp')

if (stamp && head !== undefined) {
  let changed = false
  for (const plugin of document.plugins) {
    for (const version of plugin.versions) {
      if (version.source?.type !== 'git') continue
      if (version.source.commit === head) continue
      version.source.commit = head
      changed = true
    }
  }
  if (changed) {
    await writeFile(indexPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    console.log(`stamped source.commit to ${head}`)
  }
}

let parsed
try {
  parsed = parseMarketIndex(document, indexUrl)
} catch (error) {
  console.error(`invalid index: ${error.path} ${error.reason}`)
  process.exit(1)
}

const plugins = parsed.plugins.length
const versions = parsed.plugins.reduce((total, plugin) => total + plugin.versions.length, 0)
console.log(`schema valid: ${plugins} plugin(s), ${versions} version(s)`)

let failure = false
for (const plugin of parsed.plugins) {
  for (const version of plugin.versions) {
    const { spec } = marketInstallTarget(plugin.name, version)
    const source = version.source
    if (source.type === 'git') {
      // A commit the repository does not contain installs nothing, and the
      // schema cannot see the difference.
      if (head !== undefined && source.commit !== head) {
        console.error(
          `  ${plugin.name}@${version.version}: pins ${source.commit}, repository HEAD is ${head} (rerun with --stamp)`,
        )
        failure = true
      }
      if (/^0+$/u.test(source.commit)) {
        console.error(`  ${plugin.name}@${version.version}: commit is a placeholder`)
        failure = true
      }
    }
    console.log(`  ${plugin.name}@${version.version} -> ${spec}`)
  }
}

process.exit(failure ? 1 : 0)
