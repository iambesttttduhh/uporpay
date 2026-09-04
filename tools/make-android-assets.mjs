// Generates the Android launcher + splash artwork from the same source as the
// PWA icon, so the APK does not ship the Capacitor logo.
//
//   node tools/make-android-assets.mjs
//
// Everything is written into android/app/src/main/res. The adaptive-icon XMLs in
// mipmap-anydpi-v26 already reference @mipmap/ic_launcher_foreground and
// @color/ic_launcher_background, so we only have to supply those two.
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { renderIcon, renderLayer, encodePNG, downscale, ICON_BG } from './icon-art.mjs'

const RES = 'android/app/src/main/res'

// ic_launcher is 48dp; the foreground layer is 108dp. Densities: mdpi 1x …
// xxxhdpi 4x.
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
]

let files = 0
function write(path, buf) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, buf)
  files++
}

for (const [dpi, mul] of DENSITIES) {
  const edge = Math.round(48 * mul)
  const fg = Math.round(108 * mul)

  const big = renderIcon(Math.max(edge, 512))
  const launcher = edge >= 512 ? big : downscale(big, 512, edge)
  write(join(RES, `mipmap-${dpi}`, 'ic_launcher.png'), encodePNG(edge, edge, launcher))
  write(join(RES, `mipmap-${dpi}`, 'ic_launcher_round.png'), encodePNG(edge, edge, launcher))

  // The adaptive foreground: art at 66% of the canvas on full-bleed dark, so
  // whatever mask the launcher applies (circle, squircle, teardrop) still lands
  // on background colour rather than clipping the bells off the edge.
  write(join(RES, `mipmap-${dpi}`, 'ic_launcher_foreground.png'), encodePNG(fg, fg, renderLayer(fg, fg, { scale: 0.66, bleed: true })))
}

// Splash: one portrait and one landscape, on the density buckets that matter.
// (The template shipped ten; a flat dark card does not need five of them.)
const SPLASH = [
  ['drawable-port-mdpi', 480, 800],
  ['drawable-port-xhdpi', 720, 1280],
  ['drawable-port-xxxhdpi', 1440, 2560],
  ['drawable-land-mdpi', 800, 480],
  ['drawable-land-xhdpi', 1280, 720],
]
const keep = new Set(SPLASH.map(([dir]) => dir))
for (const [dir, w, h] of SPLASH) {
  write(join(RES, dir, 'splash.png'), encodePNG(w, h, renderLayer(w, h, { scale: 0.42, bleed: true })))
}
for (const [dir] of DENSITIES) {
  for (const kind of ['port', 'land']) {
    const d = `drawable-${kind}-${dir}`
    const p = join(RES, d, 'splash.png')
    if (!keep.has(d) && existsSync(p)) {
      rmSync(p)
      try {
        rmSync(join(RES, d), { recursive: true, force: true })
      } catch {}
    }
  }
}

// Adaptive-icon background colour, referenced by mipmap-anydpi-v26/*.xml
write(
  join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${ICON_BG}</color>
</resources>
`
)

// The template's vector foreground/background pair for pre-adaptive launchers;
// the PNG mipmaps cover those, and this stale Capacitor vector must not win.
for (const stale of [join(RES, 'drawable-v24', 'ic_launcher_foreground.xml'), join(RES, 'drawable', 'ic_launcher_background.xml')]) {
  if (existsSync(stale)) {
    rmSync(stale)
    try {
      const dir = stale.replace(/\/[^/]+$/, '')
      if (!existsSync(join(dir, 'splash.png')) && !existsSync(join(dir, 'ic_launcher_background.png'))) rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

// Notification small icon: Android tints it, so it must be white-on-transparent.
const SMALL = 96
const small = Buffer.alloc(SMALL * SMALL * 4)
{
  const art = renderIcon(512)
  const u = 512 / SMALL
  for (let y = 0; y < SMALL; y++) {
    for (let x = 0; x < SMALL; x++) {
      // sample the ring/hands strokes only — a status bar icon is a silhouette
      const sx = Math.round((x + 0.5) * u)
      const sy = Math.round((y + 0.5) * u)
      const i = (sy * 512 + sx) * 4
      const lum = (art[i] * 0.3 + art[i + 1] * 0.59 + art[i + 2] * 0.11) * (art[i + 3] / 255)
      const j = (y * SMALL + x) * 4
      const v = lum > 120 ? 255 : 0
      small[j] = v
      small[j + 1] = v
      small[j + 2] = v
      small[j + 3] = v
    }
  }
}
write(join(RES, 'drawable', 'ic_stat_notify.png'), encodePNG(SMALL, SMALL, small))

console.log(`android res/: ${files} files written`)
