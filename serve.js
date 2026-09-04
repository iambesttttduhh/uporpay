// Tiny zero-dependency static server for local preview + the phone test page.
// Bind on 0.0.0.0 so a device on the same network (or a proxy) can reach it.
//
//   node serve.js [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = new URL('.', import.meta.url).pathname
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 5173)

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
}

// Camera + geolocation in a preview iframe need these explicit permissions.
const COEP_HEADERS = {
  'Permissions-Policy': 'camera=(self), geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), fullscreen=(self), wake-lock=(self)',
  'Cache-Control': 'no-cache',
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let path = decodeURIComponent(url.pathname)
    if (path === '/') path = '/index.html'

    const etag = req.headers['if-none-match']
    const file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('nope')
      return
    }
    let body
    let type = MIME[extname(file)] ?? 'application/octet-stream'
    try {
      const info = await stat(file)
      if (info.isDirectory()) throw new Error('dir')
      body = await readFile(file)
    } catch {
      // SPA fallback: unknown path → the shell
      body = await readFile(join(ROOT, 'index.html'))
      type = MIME['.html']
    }
    const hash = createHash('sha1').update(body).digest('hex').slice(0, 16)
    if (etag === `"${hash}"`) {
      res.writeHead(304, COEP_HEADERS).end()
      return
    }
    res.writeHead(200, { ...COEP_HEADERS, 'Content-Type': type, ETag: `"${hash}"`, 'Content-Length': body.length })
    res.end(body)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err?.message ?? err))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wake or Lock → http://0.0.0.0:${PORT}  (root: ${ROOT})`)
})
