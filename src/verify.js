// ---------------------------------------------------------------------------
// verify.js — "did you actually do it?" checks.
//
// Honest framing: a browser can't run a real pose estimator offline without
// shipping a model, so the shipped checks are cheap, explainable heuristics
// (frame diff for pose-hold, luminance + sky ratio for "outside", motion and
// tilt for "you got out of bed"). Each check returns a reason string, and the
// `PoseVerifier` seam below is where a real MediaPipe/MoveNet model drops in —
// see docs/NATIVE.md.
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
  const bright = stats.meanLum > 78
  const skyish = stats.skyRatio > 0.09
  const vegetated = stats.greenRatio > 0.08
  const daylight = isDaylightHour()
  const visual = daylight && bright && (skyish || vegetated)

  let geoMeters = null
  if (location && sleepLocation) geoMeters = geoDistance(location, sleepLocation)
  const movedFar = geoMeters != null && geoMeters > 25

  if (visual) reasons.push(`Daylight + sky/vegetation signature (sky ${(stats.skyRatio * 100).toFixed(0)}%, lum ${stats.meanLum.toFixed(0)})`)
  if (movedFar) reasons.push(`GPS moved ${Math.round(geoMeters)} m from your bed spot`)
  if (!visual && !movedFar) {
    if (!daylight) reasons.push('Night: brightness check skipped; no GPS proof of being outside')
    else if (!bright) reasons.push(`Frame too dark for outdoors (luminance ${stats.meanLum.toFixed(0)} ≤ 78)`)
    else reasons.push(`No sky/vegetation signature (sky ${(stats.skyRatio * 100).toFixed(0)}%, green ${(stats.greenRatio * 100).toFixed(0)}%)`)
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

/**
 * "Is there a person in frame, facing the camera?" Crude but it rejects the
 * most common cheat: pointing the phone at a wall / the ceiling / the pillow.
 */
export function verifySubject({ stats }) {
  const reasons = []
  const ok = stats.skinRatio > 0.012 && stats.edgeEnergy > 6 && stats.meanLum > 22
  if (!ok) {
    if (stats.meanLum <= 22) reasons.push('Frame is essentially black — is the lens covered?')
    if (stats.skinRatio <= 0.012) reasons.push('No face/body signature found in frame (skin pixels too low)')
    if (stats.edgeEnergy <= 6) reasons.push('Frame is flat — a blank wall will not do')
  }
  return { ok, label: 'Subject in frame', reasons, score: Math.min(1, stats.skinRatio * 12 + stats.edgeEnergy / 60) }
}

/**
 * "Did you hold the pose?" — the app captures a start frame and the final frame
 * of a hold-down countdown. Steady = pose held. Wildly different = you were
 * walking around waving the phone.
 */
export function verifyPoseHold({ holdDiff, holdMs, requiredHoldMs, testMode }) {
  const steadyEnough = holdMs >= requiredHoldMs * 0.9
  const stable = holdDiff <= 26
  const reasons = []
  if (!steadyEnough) reasons.push(`Held ${(holdMs / 1000).toFixed(1)} s, needed ${(requiredHoldMs / 1000).toFixed(1)} s`)
  if (!stable) reasons.push(`Frame moved by ${holdDiff.toFixed(0)} during the hold — pose slipped`)
  return {
    ok: (steadyEnough && stable) || Boolean(testMode),
    label: 'Pose held steady',
    reasons,
    score: stable ? 1 : 0,
  }
}

/** "You moved between the indoor shots" — stops three back-to-back selfies. */
export function verifyMovementBetweenShots({ movement, tilt, required, testMode }) {
  if (testMode) return { ok: true, label: 'Movement between shots', reasons: ['test mode: movement not required'], score: 1 }
  const ok = movement >= required || tilt >= 22
  const reasons = [
    ok
      ? `Movement integral ${movement.toFixed(0)} / tilt ${tilt.toFixed(0)}°`
      : `Only ${movement.toFixed(0)} of movement detected (need ${required}) and ${tilt.toFixed(0)}° of tilt (need 22°). Walk to another room.`,
  ]
  return { ok, label: 'Movement between shots', reasons, score: Math.min(1, movement / required) }
}

function geoDistance(a, b) {
  const R = 6371000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// ---------------------------------------------------------------------------
// Pose verifier seam — swap in real ML here without touching the state machine.
// ---------------------------------------------------------------------------

/** Self-declared + heuristic (default, works offline, zero dependencies). */
export const heuristicPoseVerifier = {
  name: 'heuristic',
  async verify({ pose, stats, holdDiff, holdMs, requiredHoldMs, testMode }) {
    return [
      verifySubject({ stats }),
      verifyPoseHold({ holdDiff, holdMs, requiredHoldMs, testMode }),
      {
        ok: true,
        label: `Pose: ${pose.label}`,
        reasons: [`Self-declared — you confirmed "${pose.label}" in the ${formatHold(requiredHoldMs)} hold.`],
        score: 1,
      },
    ]
  },
}

/**
 * Verifier registry. `heuristicPoseVerifier` is the only implementation that
 * ships (offline, zero deps). To plug in real keypoints, register another
 * object with the same contract and flip `settings.poseVerifier`:
 *
 *   registerPoseVerifier({
 *     name: 'mediapipe',
 *     async verify({ pose, stats, imageData, holdDiff, holdMs, requiredHoldMs, testMode }) {
 *       //   → MediaPipe PoseLandmarker.detectForVideo(imageData), then compare
 *       //   the landmark topology against the pose definition in POSES.
 *       return [checkObjects]   // each: { ok, label, reasons: [], score }
 *     },
 *   })
 *
 * Keep it fail-open on model-load errors: a CDN outage must never leave an
 * alarm unable to release the user.
 */
const verifiers = new Map([['heuristic', heuristicPoseVerifier]])

export function registerPoseVerifier(verifier) {
  verifiers.set(verifier.name, verifier)
}

export function getPoseVerifier(name) {
  return verifiers.get(name) ?? heuristicPoseVerifier
}

export async function verifyShot({ verifier = 'heuristic', pose, imageData, stats, holdDiff, holdMs, requiredHoldMs, testMode }) {
  const impl = getPoseVerifier(verifier)
  const checks = await impl.verify({ pose, imageData, stats, holdDiff, holdMs, requiredHoldMs, testMode })
  return checks
}

const formatHold = (ms) => `${(ms / 1000).toFixed(1)}s`
