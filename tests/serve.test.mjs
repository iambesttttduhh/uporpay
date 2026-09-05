// ---------------------------------------------------------------------------
// serve.test.mjs — the file server, because "click a link and install the APK"
// is a feature of this project. Resume support is the part that is easy to
// forget: a 4.3 MB download over mobile data gets interrupted, and Android's
// download manager answers that with a Range request rather than starting again.
// ---------------------------------------------------------------------------
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseRange, handler } from '../serve.js'

const FILE = new URL('../manifest.webmanifest', import.meta.url)
const body = await readFile(FILE)

test('parseRange understands the three forms browsers send', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 })
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 })
  assert.deepEqual(parseRange('bytes=-50', 1000), { start: 950, end: 999 })
  assert.equal(parseRange(undefined, 1000), null, 'no header is not a range request')
  assert.equal(parseRange('bytes=0-1,4-5', 1000), null, 'multipart ranges fall back to a whole response')
  assert.deepEqual(parseRange('bytes=2000-3000', 1000), { unsatisfiable: true })
  assert.deepEqual(parseRange('bytes=9-2', 1000), { unsatisfiable: true })
})

function mockRes() {
  const res = {
    status: 0,
    heads: {},
    chunks: [],
    writeHead(status, heads) {
      res.status = status
      Object.assign(res.heads, heads ?? {})
      return res
    },
    end(chunk) {
      if (chunk) res.chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)))
      return res
    },
    get body() {
      return Buffer.concat(res.chunks)
    },
  }
  return res
}

async function get(headers = {}) {
  const res = mockRes()
  await handler({ method: 'GET', url: '/manifest.webmanifest', headers: { host: 'localhost', ...headers } }, res)
  return res
}

test('the whole file is advertised as resumable', async () => {
  const res = await get()
  assert.equal(res.status, 200)
  assert.equal(Number(res.heads['Content-Length']), body.length)
  assert.equal(res.heads['Accept-Ranges'], 'bytes')
  assert.deepEqual(res.body, body)
  assert.match(res.heads['Content-Type'], /manifest\+json/, 'web app manifests need their type')
})

test('a range gets its slice and nothing else', async () => {
  const res = await get({ range: `bytes=0-2` })
  assert.equal(res.status, 206)
  assert.equal(res.heads['Content-Range'], `bytes 0-2/${body.length}`)
  assert.deepEqual(res.body, body.subarray(0, 3))
  const tail = await get({ range: 'bytes=-4' })
  assert.deepEqual(tail.body, body.subarray(body.length - 4))
})

test('an impossible range is answered, not ignored', async () => {
  const res = await get({ range: `bytes=${body.length + 10}-${body.length + 20}` })
  assert.equal(res.status, 416)
  assert.equal(res.heads['Content-Range'], `bytes */${body.length}`)
})

test('an unmodified file costs nothing', async () => {
  const first = await get()
  const again = await get({ 'if-none-match': first.heads.ETag })
  assert.equal(again.status, 304)
  assert.equal(again.body.length, 0)
})
