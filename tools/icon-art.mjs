// Shared icon artwork, in one place, so the PWA icon and the Android launcher
// icon cannot drift apart. All coordinates are authored in a 512 grid and
// scaled — pure integer maths, no canvas, no ImageMagick, no network.
//
//   renderIcon(size) → Buffer(size*size*4, RGBA)
//   encodePNG(w, h, buffer) → PNG bytes
import { deflateSync } from 'node:zlib'

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const HOT_TOP = hex('#ff6b5e')
const HOT_BOT = hex('#b8160d')
const BG_TOP = hex('#1d0d0d')
const BG_BOT = hex('#06070b')

export const ICON_BG = '#0b0c11'

const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

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

/**
 * @param size  edge length in px
 * @param opts.bleed  draw the full-bleed body instead of a rounded tile
 */
export function renderIcon(size, { bleed = false } = {}) {
  const S = size
  const px = Buffer.alloc(S * S * 4)
  const u = S / 512
  const k = (v) => v * u
  const AA = 1.6 * u
  const cov = (d) => Math.max(0, Math.min(1, 0.5 - d / AA))
  const setPx = (x, y, rgb, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    px[i] = rgb[0]
    px[i + 1] = rgb[1]
    px[i + 2] = rgb[2]
    px[i + 3] = a
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const t = y / S
      const dBody = bleed ? 0 : sdRoundRect(x, y, S, S, k(112))
      const aBody = bleed ? 1 : cov(dBody)
      if (aBody <= 0) continue
      let col = mix(BG_TOP, BG_BOT, t)

      // alarm bells (two arcs, top-left and top-right)
      for (const cx of [150, 362]) {
        const d = Math.abs(Math.hypot(x - k(cx), y - k(118)) - k(96)) - k(15)
        if (x > k(cx - 110) && x < k(cx + 110) && y < k(130)) col = mix(col, HOT_TOP, Math.max(0, Math.min(1, -d / AA)))
      }

      // clock ring
      const dRing = Math.abs(Math.hypot(x - k(256), y - k(282)) - k(148)) - k(15)
      col = mix(col, mix(HOT_TOP, HOT_BOT, t), cov(dRing))

      // hands: 12 o'clock + 3 o'clock
      col = mix(col, [255, 240, 236], cov(sdSegment(x, y, k(256), k(282), k(256), k(200)) - k(13)))
      col = mix(col, [255, 240, 236], cov(sdSegment(x, y, k(256), k(282), k(330), k(282)) - k(13)))

      // padlock body over the lower clock face
      const dLock = sdRoundRect(x - k(204), y - k(318), k(104), k(84), k(18))
      col = mix(col, mix(HOT_TOP, HOT_BOT, 0.4), cov(dLock))
      const dShackle = Math.abs(Math.hypot(x - k(256), y - k(320)) - k(30)) - k(9)
      if (y < k(322)) col = mix(col, HOT_TOP, cov(dShackle))
      const dKey = sdRoundRect(x - k(250), y - k(350), k(12), k(26), k(6))
      col = mix(col, BG_BOT, cov(dKey))

      setPx(x, y, col.map((c) => Math.round(c)), Math.round(aBody * 255))
    }
  }
  return px
}

/** Flat dark background with the mark centred at `scale` of the shorter edge. */
export function renderLayer(width, height, { scale = 0.66, bleed = true } = {}) {
  const out = Buffer.alloc(width * height * 4)
  const bg = hex(ICON_BG)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = bg[0]
    out[i * 4 + 1] = bg[1]
    out[i * 4 + 2] = bg[2]
    out[i * 4 + 3] = bleed ? 255 : 0
  }
  const side = Math.round(Math.min(width, height) * scale)
  const art = renderIcon(side)
  const ox = Math.round((width - side) / 2)
  const oy = Math.round((height - side) / 2)
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const a = art[(y * side + x) * 4 + 3]
      if (!a) continue
      const di = ((oy + y) * width + (ox + x)) * 4
      const si = (y * side + x) * 4
      // source-over onto the flat colour, so the rounded tile blends instead of
      // showing a hard black square
      const alpha = a / 255
      for (let c = 0; c < 3; c++) out[di + c] = Math.round(art[si + c] * alpha + out[di + c] * (1 - alpha))
      out[di + 3] = 255
    }
  }
  return out
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

export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // copy() is view-aware, so a subarray is safe and we avoid a 10 MB clone
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset ?? 0, width * height * 4)
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    src.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Nearest-neighbour downscale — the artwork is crisp geometry, not gradients. */
export function downscale(rgba, from, to) {
  const out = Buffer.alloc(to * to * 4)
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const sx = Math.round((x * from) / to)
      const sy = Math.round((y * from) / to)
      rgba.copy(out, (y * to + x) * 4, (sy * from + sx) * 4, (sy * from + sx) * 4 + 4)
    }
  }
  return out
}
