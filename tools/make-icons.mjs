// Pure-node PNG icon generator — the sandbox has no SVG rasteriser, and a PWA
// that only ships an SVG icon is a coin flip on older Android browsers.
//
//   node tools/make-icons.mjs   →  icons/app-192.png, icons/app-512.png
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const S = 512
const px = new Uint8Array(S * S * 4)

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const HOT_TOP = hex('#ff6b5e')
const HOT_BOT = hex('#b8160d')
const BG_TOP = hex('#1d0d0d')
const BG_BOT = hex('#06070b')

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
const setPx = (x, y, rgb, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return
  const i = (y * S + x) * 4
  px[i] = rgb[0]
  px[i + 1] = rgb[1]
  px[i + 2] = rgb[2]
  px[i + 3] = a
}

const sdRoundRect = (x, y, w, h, r) => {
  const qx = Math.abs(x - w / 2) - (w / 2 - r)
  const qy = Math.abs(y - h / 2) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdSegment = (x, y, ax, ay, bx, by) => {
  const abx = bx - ax
  const aby = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby || 1)))
  return Math.hypot(x - (ax + abx * t), y - (ay + aby * t))
}

const AA = 1.6 // antialiasing band, in px
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / AA))

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const t = y / S
    // body
    const dBody = sdRoundRect(x, y, S, S, 112)
    const aBody = cov(dBody)
    if (aBody <= 0) continue
    let col = mix(BG_TOP, BG_BOT, t)

    // alarm bells (two arcs, top-left and top-right)
    for (const cx of [150, 362]) {
      const d = Math.abs(Math.hypot(x - cx, y - 118) - 96) - 15
      if (x > cx - 110 && x < cx + 110 && y < 130) col = mix(col, HOT_TOP, Math.max(0, Math.min(1, -d / AA)))
    }

    // clock ring
    const dRing = Math.abs(Math.hypot(x - 256, y - 282) - 148) - 15
    col = mix(col, mix(HOT_TOP, HOT_BOT, t), cov(dRing))

    // hands: 12 o'clock + 3 o'clock
    col = mix(col, [255, 240, 236], cov(sdSegment(x, y, 256, 282, 256, 200) - 13))
    col = mix(col, [255, 240, 236], cov(sdSegment(x, y, 256, 282, 330, 282) - 13))

    // padlock body over the lower clock face
    const dLock = sdRoundRect(x - 204, y - 318, 104, 84, 18)
    col = mix(col, mix(HOT_TOP, HOT_BOT, 0.4), cov(dLock))
    const dShackle = Math.abs(Math.hypot(x - 256, y - 320) - 30) - 9
    if (y < 322) col = mix(col, HOT_TOP, cov(dShackle))
    const dKey = sdRoundRect(x - 250, y - 350, 12, 26, 6)
    col = mix(col, BG_BOT, cov(dKey))

    setPx(x, y, col.map((c) => Math.round(c)), Math.round(aBody * 255))
  }
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync('icons', { recursive: true })
const src = Buffer.from(px.buffer)
writeFileSync('icons/app-512.png', encodePNG(S, S, src))

// nearest-neighbour downscale is fine for an icon this simple
const small = Buffer.alloc(192 * 192 * 4)
for (let y = 0; y < 192; y++) {
  for (let x = 0; x < 192; x++) {
    const sx = Math.round((x * S) / 192)
    const sy = Math.round((y * S) / 192)
    src.copy(small, (y * 192 + x) * 4, (sy * S + sx) * 4, (sy * S + sx) * 4 + 4)
  }
}
writeFileSync('icons/app-192.png', encodePNG(192, 192, small))
console.log('wrote icons/app-512.png and icons/app-192.png')
