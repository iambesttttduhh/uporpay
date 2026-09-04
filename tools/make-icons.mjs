// Pure-node PNG icon generator — the sandbox has no SVG rasteriser, and a PWA
// that only ships an SVG icon is a coin flip on older Android browsers.
//
//   node tools/make-icons.mjs   →  icons/app-192.png, icons/app-512.png
//
// The artwork itself lives in tools/icon-art.mjs so the Android launcher icon is
// literally the same drawing, not a reimplementation.
import { writeFileSync, mkdirSync } from 'node:fs'
import { renderIcon, encodePNG, downscale } from './icon-art.mjs'

const S = 512
const src = renderIcon(S)
mkdirSync('icons', { recursive: true })
writeFileSync('icons/app-512.png', encodePNG(S, S, src))
writeFileSync('icons/app-192.png', encodePNG(192, 192, downscale(src, S, 192)))
console.log('wrote icons/app-512.png and icons/app-192.png')
