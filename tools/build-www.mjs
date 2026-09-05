// ---------------------------------------------------------------------------
// build-www.mjs — stage the web app into ./www for the Android wrapper.
//
// There is no bundler in this project, so "building" is a copy. The list is
// explicit instead of recursive-with-ignores: shipping node_modules or the
// Android project into the APK's assets would be a 60 MB mistake you only
// notice at install time.
//
//   node tools/build-www.mjs
// ---------------------------------------------------------------------------
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildStamp } from './build-stamp.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'www')

const FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js']
const DIRS = ['src', 'views', 'icons']

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

let bytes = 0
let count = 0
for (const f of FILES) {
  await cp(join(ROOT, f), join(OUT, f))
  bytes += (await stat(join(OUT, f))).size
  count++
}
for (const d of DIRS) {
  await cp(join(ROOT, d), join(OUT, d), { recursive: true })
  count++
}

// A tiny native marker the app reads at boot. Keeping it a file (rather than
// editing index.html during the copy) means the browser build is untouched.
// It also carries the commit this bundle was staged from, which is how an
// installed APK can answer "which build is this" from inside itself.
const stamp = buildStamp({ root: ROOT })
await writeFile(join(OUT, 'native.json'), JSON.stringify(stamp, null, 2))

const { readdir } = await import('node:fs/promises')
const walk = async (dir) => {
  let n = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? await walk(join(dir, e.name)) : 1
  }
  return n
}
console.log(`www/ staged: ${await walk(OUT)} files (${(bytes / 1024).toFixed(0)} KB core, +icons) from ${count} sources`)
