// Post-build step: bake the real asset list and a content-derived version into
// out/sw.js, so the service worker precaches this exact build.
//
// Run by `npm run build` after `next build` (which static-exports to out/).

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'out')
const swPath = join(out, 'sw.js')

const walk = dir =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

const files = walk(out)
  .map(f => relative(out, f).split(/[\\/]/).join('/'))
  .filter(f => f !== 'sw.js')
  .sort()

// Everything except the worker itself is worth having offline; the build is
// small enough (icons + one JS/CSS pair) that precaching all of it is simplest.
const shell = ['./', ...files.map(f => `./${f}`)]

const hash = createHash('sha1')
for (const f of files) hash.update(f).update(readFileSync(join(out, f)))
const version = hash.digest('hex').slice(0, 12)

const sw = readFileSync(swPath, 'utf8')
  .replace(/const VERSION = '[^']*'/, `const VERSION = '${version}'`)
  .replace(/const SHELL = \[[\s\S]*?\n\]/, `const SHELL = ${JSON.stringify(shell, null, 2)}`)

writeFileSync(swPath, sw)
console.log(`sw.js: precaching ${shell.length} entries, version ${version}`)
