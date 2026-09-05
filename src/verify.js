// ---------------------------------------------------------------------------
// verify.js — "did you actually do it?" checks.
//
// Nothing here looks at a stored photograph, because nothing is stored. The
// checks are cheap, explainable heuristics over a *live* camera view: frame
// statistics (luminance, sky and green ratios) for "you are outside", a
// downsampled frame diff for "you moved", and GPS distance against the location
// the alarm was recorded at. Each returns a reason string that is shown to the
// user and written to the journal — a silent fail is worse than a crude rule.
// ---------------------------------------------------------------------------

const SKIN_RGB = [
  [95, 60, 20],
  [230, 180, 130],
]

/** Downsampled statistics for one captured frame. */
export function analyzeImageData(imageData) {
  const { data, width, height } = imageData
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 20000)))
  let n = 0
  let lumSum = 0
  let lumSq = 0
  let satSum = 0
  let sky = 0
  let green = 0
  let skin = 0
  let edge = 0
  let prev = null

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      lumSum += lum
      lumSq += lum * lum
      satSum += sat
      if (b > r + 18 && b > g + 8 && lum > 110) sky++
      if (g > r + 14 && g > b + 6) green++
      if (
        r > SKIN_RGB[0][0] && r < SKIN_RGB[1][0] &&
        g > SKIN_RGB[0][1] && g < SKIN_RGB[1][1] &&
        b > SKIN_RGB[0][2] && b < SKIN_RGB[1][2] &&
        r > g && g > b && r - b > 15
      )
        skin++
      if (prev != null) edge += Math.abs(lum - prev)
      prev = lum
      n++
    }
  }
  const mean = lumSum / Math.max(1, n)
  const variance = Math.max(0, lumSq / Math.max(1, n) - mean * mean)
  return {
    meanLum: mean,
    lumStd: Math.sqrt(variance),
    saturation: satSum / Math.max(1, n),
    skyRatio: sky / Math.max(1, n),
    greenRatio: green / Math.max(1, n),
    skinRatio: skin / Math.max(1, n),
    edgeEnergy: edge / Math.max(1, n),
    samples: n,
  }
}

/** Mean absolute difference between two frames — used for pose-hold + motion. */
export function frameDiff(a, b) {
  if (!a || !b) return 0
  const da = a.data
  const db = b.data
  const len = Math.min(da.length, db.length)
  const step = Math.max(4, Math.round(len / 12000)) & ~3
  let sum = 0
  let n = 0
  for (let i = 0; i < len; i += step) {
    sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
    n += 3
  }
  return n ? sum / n : 0
}

const isDaylightHour = (d = new Date()) => d.getHours() >= 5 && d.getHours() < 19

/**
 * "Are you outside?" — bright sky + vegetation, or a real GPS move away from
 * the registered sleeping spot. At night the light heuristic is disabled and
 * only GPS counts (or the user's declaration in test mode).
 */
export function verifyOutside({ stats, location, sleepLocation, testMode }) {
  const reasons = []
  // A denied camera or a half-initialised stream must produce a readable
  // rejection, never a TypeError inside the mission screen.
  const st = { meanLum: 0, skyRatio: 0, greenRatio: 0, edgeEnergy: 0, ...(stats ?? {}) }
  const bright = st.meanLum > 78
  const skyish = st.skyRatio > 0.09
  const vegetated = st.greenRatio > 0.08
  const daylight = isDaylightHour()
  const visual = daylight && bright && (skyish || vegetated)

  let geoMeters = null
  if (location && sleepLocation) geoMeters = geoDistance(location, sleepLocation)
  const movedFar = geoMeters != null && geoMeters > 25

  if (visual) reasons.push(`Daylight + sky/vegetation signature (sky ${(st.skyRatio * 100).toFixed(0)}%, lum ${st.meanLum.toFixed(0)})`)
  if (movedFar) reasons.push(`GPS moved ${Math.round(geoMeters)} m from your bed spot`)
  if (!visual && !movedFar) {
    if (!daylight) reasons.push('Night: brightness check skipped; no GPS proof of being outside')
    else if (!bright) reasons.push(`Frame too dark for outdoors (luminance ${st.meanLum.toFixed(0)} ≤ 78)`)
    else reasons.push(`No sky/vegetation signature (sky ${(st.skyRatio * 100).toFixed(0)}%, green ${(st.greenRatio * 100).toFixed(0)}%)`)
    if (geoMeters != null) reasons.push(`GPS says you are ${Math.round(geoMeters)} m from your bed (need > 25 m)`)
    if (geoMeters == null) reasons.push('No GPS fix — grant location or enable the light check by daylight')
  }

  return {
    ok: visual || movedFar || Boolean(testMode),
    label: 'Outside proof',
    reasons,
    score: Number(((visual ? 0.6 : 0) + (movedFar ? 0.4 : 0)).toFixed(2)),
  }
}

/** "You actually moved" — between the scenery hold and each spoken line. */
export function verifyMovementBetweenShots({ movement, tilt, required, testMode }) {
  if (testMode) return { ok: true, label: 'Movement', reasons: ['test mode: movement not required'], score: 1 }
  const ok = movement >= required || tilt >= 22
  const reasons = [
    ok
      ? `Movement integral ${movement.toFixed(0)} / tilt ${tilt.toFixed(0)}°`
      : `Only ${movement.toFixed(0)} of movement (need ${required}) and ${tilt.toFixed(
          0
        )}° of tilt (need 22°). Get up and walk — do not say the line from the pillow.`,
  ]
  return { ok, label: 'You got out of bed', reasons, score: Math.min(1, movement / required) }
}

// No pose verifier, no subject check, no frame comparison against a stored
// photograph: the mission holds a live camera view for a few seconds and then
// listens. The `PoseVerifier` seam that used to live here is documented in
// docs/NATIVE.md in case a keypoint model is ever wanted again.

function geoDistance(a, b) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

