// ---------------------------------------------------------------------------
// Wake or Lock — static server. No dependencies, no build step.
//
//   node serve.js                    http://localhost:5173
//   node serve.js --https            self-signed https, for testing on a phone
//   node serve.js --port 8080        different port
//
// Why --https exists: getUserMedia, geolocation, wake lock and the service
// worker are all restricted to secure contexts. http://localhost is secure, so
// a laptop is fine — but http://192.168.1.20:5173 on your phone is NOT, and the
// camera silently dies. Self-signed https makes the phone behave.
// ---------------------------------------------------------------------------
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import { normalize, join } from 'node:path'
import { createHash } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = new URL('.', import.meta.url).pathname
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true
}
const USE_HTTPS = Boolean(flag('https', false))
// Accept `--port 8080` and the bare `node serve.js 8080`, because everyone
// types the second one at least once and a silently-ignored port is confusing.
const positionalPort = argv.find((a) => /^\d{2,5}$/.test(a))
const PORT = Number(flag('port', positionalPort ?? process.env.PORT ?? 5173))
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('that is not a port number')
  process.exit(1)
}
const HOST = String(flag('host', '0.0.0.0'))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pem': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  // An APK served as text/plain is a broken "link"; phones want the package
  // mime type plus an explicit download disposition.
  '.apk': 'application/vnd.android.package-archive',
}

// Camera + geolocation need an explicit permissions policy; without this an
// embedding parent (or a strict browser default) silently denies both.
const HEADERS = {
  'Permissions-Policy':
    'camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), fullscreen=(self), wake-lock=(self)',
  'Cache-Control': 'no-cache',
  'Access-Control-Allow-Origin': '*',
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/index.html'
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('outside the root')
      return
    }
    let body
    let type = MIME[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream'
    try {
      const info = await stat(file)
      if (info.isDirectory()) throw new Error('dir')
      body = await readFile(file)
    } catch {
      body = await readFile(join(ROOT, 'index.html')) // SPA fallback
      type = MIME['.html']
    }
    const hash = createHash('sha1').update(body).digest('hex').slice(0, 16)
    if (req.headers['if-none-match'] === `"${hash}"`) {
      res.writeHead(304, HEADERS).end()
      return
    }
    const heads = { ...HEADERS, 'Content-Type': type, ETag: `"${hash}"`, 'Content-Length': body.length }
    // Archives and packages are served as downloads; without this some browsers
    // try to open the zip inline, or the phone refuses to offer "install".
    if (path.endsWith('.zip') || path.endsWith('.apk')) {
      // basename only: a download named "builds/x.apk" or "dist/app.zip" is how a
      // phone ends up with a file nobody's installer will open.
      const leaf = path.split('/').filter(Boolean).pop() ?? 'download'
      heads['Content-Disposition'] = `attachment; filename="${leaf.replace(/"[^"]*$/, '')}"`
    }
    res.writeHead(200, heads)
    res.end(body)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err?.message ?? err))
  }
}

function ensureCerts() {
  const dir = join(ROOT, 'certs')
  const key = join(dir, 'key.pem')
  const crt = join(dir, 'cert.pem')
  if (existsSync(key) && existsSync(crt)) return { key, crt }
  mkdirSync(dir, { recursive: true })
  const out = spawnSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', crt, '-days', '825',
      '-subj', '/CN=wake-or-lock.local',
      '-addext', 'subjectAltName=DNS:localhost,DNS:wake-or-lock.local,IP:127.0.0.1,IP:::1',
    ],
    { encoding: 'utf8' }
  )
  if (out.status !== 0 || !existsSync(crt)) {
    console.error('\n✗ Could not mint a certificate (openssl missing?).')
    console.error('  Either:')
    console.error('    · on the phone, use `adb reverse tcp:%d tcp:%d` and open http://localhost:%d', PORT, PORT, PORT)
    console.error('    · or install mkcert and point me at certs/key.pem + certs/cert.pem\n')
    process.exit(1)
  }
  console.log('· minted a self-signed cert in ./certs (valid 825 days)')
  return { key, crt }
}

function lanUrls(scheme) {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`${scheme}://${net.address}:${PORT}`)
    }
  }
  return out
}

async function start() {
  let server
  if (USE_HTTPS) {
    const { key, crt } = ensureCerts()
    const { createServer: createSecure } = await import('node:https')
    server = createSecure(
      { key: await readFile(key), cert: await readFile(crt) },
      handler
    )
  } else {
    server = createServer(handler)
  }
  server.listen(PORT, HOST, () => {
    const scheme = USE_HTTPS ? 'https' : 'http'
    console.log(`\n  Wake or Lock`)
    console.log(`  ─────`)
    console.log(`  this device   ${scheme}://localhost:${PORT}`)
    for (const u of lanUrls(scheme)) console.log(`  phone (same wifi) ${u}`)
    if (!USE_HTTPS) {
      console.log(`\n  plain http: camera/GPS/wake-lock work on localhost only.`)
      console.log(`  on a phone over the LAN address the camera will be blocked —`)
      console.log(`  use  node serve.js --https   or   adb reverse tcp:${PORT} tcp:${PORT}`)
    } else {
      console.log(`\n  self-signed: the phone will warn you. Tap through it`)
      console.log(`  (Chrome: "Advanced" → "Proceed"). Camera permissions still work.`)
    }
    console.log('')
  })
}

start()
