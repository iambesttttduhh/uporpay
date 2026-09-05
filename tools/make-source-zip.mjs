#!/usr/bin/env node
// ---------------------------------------------------------------------------
// tools/make-source-zip.mjs — build wake-or-lock.zip next to the repo root.
//
// Why this exists instead of "download the branch zip from GitHub": the zip has
// to be installable-offline friendly and it has to contain the APK, so the whole
// thing is one file you can hand to a phone over a cable. Zero dependencies: a
// store/deflate zip is a central directory plus local headers, and node has
// zlib, so there is no reason to add a package for it.
//
//   node tools/make-source-zip.mjs [--with-apk]
// ---------------------------------------------------------------------------

import { readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { join, relative, posix } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const OUT = join(ROOT, 'wake-or-lock.zip')
const PREFIX = 'uporpay/'

// Tracked-and-wanted only. node_modules/.git/www are either huge or generated,
// and a generated www inside a zip is how someone ends up running stale code.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'www', 'dist', 'coverage', 'build', '.gradle', '.parcel-cache', '.next', '.tmp'])
const SKIP_FILES = new Set(['wake-or-lock.zip'])

const listTracked = () => {
  const r = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('git ls-files failed: ' + r.stderr)
  return r.stdout.split('\0').filter(Boolean)
}

const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// MS-DOS time/date, because that is what a zip header stores.
const dosTime = (d) => (((d.getHours() << 6) | d.getMinutes()) << 5) | (d.getSeconds() / 2)
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5)) | d.getDate()

async function collect() {
  let files = listTracked()
  const apk = 'builds/wake-or-lock-debug.apk'
  if (existsSync(join(ROOT, apk))) files = [...new Set([...files, apk])] // gitignored? no — committed by CI
  const out = []
  for (const rel of files) {
    if (SKIP_FILES.has(rel)) continue
    const top = rel.split('/')[0]
    if (SKIP_DIRS.has(top)) continue
    const abs = join(ROOT, rel)
    if (!existsSync(abs)) continue // deleted-but-still-indexed, or an ignored build output
    const info = await stat(abs)
    if (!info.isFile()) continue
    out.push({ rel, abs, mtime: info.mtime })
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

async function main() {
  const entries = await collect()
  const chunks = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const data = await readFile(e.abs)
    const deflated = deflateRawSync(data, { level: 9 })
    const useDeflate = deflated.length < data.length
    const body = useDeflate ? deflated : data
    const nameBuf = Buffer.from(PREFIX + posix.join(e.rel), 'utf8')
    const crc = crc32(data)
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 name flag
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime(e.mtime), 10)
    local.writeUInt16LE(dosDate(e.mtime), 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, body)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)
    cen.writeUInt16LE(20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(dosTime(e.mtime), 12)
    cen.writeUInt16LE(dosDate(e.mtime), 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(body.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt32LE(offset, 42)
    central.push(cen, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)

  const zip = Buffer.concat([...chunks, cd, end])
  await writeFile(OUT, zip)
  const mb = (zip.length / 1048576).toFixed(2)
  console.log(`wake-or-lock.zip: ${entries.length} files, ${mb} MB → ${relative(ROOT, OUT)}`)
  console.log(`  includes ${entries.some((e) => e.rel.endsWith('.apk')) ? 'the debug APK' : 'no APK (builds/ empty)'}`)
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(1)
})
