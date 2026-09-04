// ---------------------------------------------------------------------------
// logic.js — pure rules engine. No DOM, no storage. Unit-tested in tests/.
// Everything about *when* things happen and *what* the punishment is lives
// here so it can be reasoned about (and tested) without a browser.
// ---------------------------------------------------------------------------

/** The pose library. App picks one per required photo; you must perform it. */
export const POSES = [
  { id: 'hands-on-head', emoji: '🙌', label: 'Hands flat on top of your head, elbows out' },
  { id: 'superhero', emoji: '🦸', label: 'Fists on hips, chest puffed, chin up' },
  { id: 'trex', emoji: '🦖', label: 'T-rex arms: elbows tucked, clawed fingers at your chest' },
  { id: 'cheek-frame', emoji: '🪞', label: 'One hand on your cheek, fingers spread wide' },
  { id: 'duck-face', emoji: '🐥', label: 'Maximum pout, head tilted ~20 degrees' },
  { id: 'deep-think', emoji: '🤔', label: 'Index finger on chin, brow furrowed, head down' },
  { id: 'wide-eyes', emoji: '😳', label: 'Eyes as wide as they physically go, mouth shut' },
  { id: 'double-flex', emoji: '💪', label: 'Double bicep flex, both arms up and squeezed' },
  { id: 'zombie', emoji: '🧟', label: 'Both arms straight forward, jaw completely slack' },
  { id: 'point', emoji: '👉', label: 'Index finger extended straight at the camera' },
  { id: 'peace-eye', emoji: '✌️', label: 'Peace sign covering exactly one eye' },
  { id: 'shrug', emoji: '🤷', label: 'Shoulders shoved up to your ears, palms open' },
  { id: 'heart-above', emoji: '🫶', label: 'Hands clasped into a heart above your head' },
  { id: 'salute', emoji: '🫡', label: 'Fingertips snapped to your eyebrow, palm down' },
  { id: 'rooster', emoji: '🐓', label: 'Hands on hips, one knee lifted off the floor' },
  { id: 'ghost', emoji: '👻', label: 'Arms high, fingers splayed, mouth open in a silent scream' },
  { id: 'polite-yawn', emoji: '🥱', label: 'One hand over your mouth, the other over your eyes' },
  { id: 'trophy', emoji: '🏆', label: 'Both fists punched to the ceiling like you just won' },
]

export const DEFAULT_SETTINGS = {
  // --- alarm behaviour -----------------------------------------------------
  soundOn: true,
  vibrateOn: true,
  maxVolume: true,

  // --- the rules -----------------------------------------------------------
  ringMinutes: 5,            // how long it buzzes continuously, no way to dismiss
  missionWindowMinutes: 30,  // hard deadline: mission done, or you lose the phone
  insidePhotos: 3,           // INSIDE mission: N shots, spaced apart, each a new pose
  insideSpacingMinutes: 10,  // minimum gap between those shots
  outsidePoseSelfies: 1,     // OUTSIDE mission: 1 scenery shot + N pose selfies

  // --- the punishment ------------------------------------------------------
  // Hours locked, indexed by consecutive failed wake-ups (strike 1, 2, 3...).
  lockHoursCurve: [1, 2, 4, 6, 9, 12, 18, 24],
  maxLockHours: 24,
  escalationNagAfterRing: true, // after ringMinutes, nag in bursts until deadline
  strikeGraceResetsAfterSuccess: true,

  // --- admin / test account (a session lease, not a permanent off switch) --
  adminPin: '0000',
  adminUnlockedAt: null,      // epoch ms of the last PIN unlock
  adminLeaseMinutes: 240,     // auto re-arms itself; 0 = stay unlocked (loud warning)
  adminGodMode: true,         // never lock out — the headline switch
  adminAutoPass: false,       // accept any capture, checks recorded but non-binding
  adminInstantSpacing: false, // no 10-minute wait between indoor shots
  adminQuietRing: false,      // ring silently while testing the flow

  // --- escape hatches (see README: a real hard lock needs care) ------------
  panicReleaseEnabled: false, // hold-to-release button on the lock screen
  panicReleaseCostsStrike: true,

  // --- demo mode: divide every mission timer by 60 so you can try the loop
  demoTiming: true,
  testMode: false, // short lock durations (minutes instead of hours)
}

/** Demo mode compresses every time-based rule by this factor. */
export const DEMO_DIVISOR = 60

const MIN = 60_000

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------

export const msToMinutes = (ms) => ms / MIN

/** Applies demo compression to a "minutes" setting. Pure. */
export function effectiveMinutes(minutes, settings) {
  return settings?.demoTiming ? minutes / DEMO_DIVISOR : minutes
}

export function ringMs(settings) {
  return effectiveMinutes(settings.ringMinutes, settings) * MIN
}

export function missionWindowMs(settings) {
  return effectiveMinutes(settings.missionWindowMinutes, settings) * MIN
}

export function spacingMs(settings) {
  return effectiveMinutes(settings.insideSpacingMinutes, settings) * MIN
}

/** HH:MM:SS (or MM:SS) countdown text. */
export function formatCountdown(ms) {
  if (ms <= 0) return '00:00'
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Human duration, e.g. "1 h 24 m" / "38 s". */
export function formatDuration(ms) {
  if (ms <= 0) return '0 s'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${h} h ${m} m`
  if (m) return `${m} m ${s} s`
  return `${s} s`
}

export function formatAlarmTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatClockAt(ms) {
  const d = new Date(ms)
  return formatAlarmTime(
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  )
}

export function formatDayShort(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeDays(days) {
  if (!days || days.length === 0) return 'One time only'
  if (days.length === 7) return 'Every day'
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.join() === '1,2,3,4,5') return 'Weekdays'
  if (sorted.join() === '0,6') return 'Weekends'
  return sorted.map((d) => DAY_NAMES[d]).join(' · ')
}

// ---------------------------------------------------------------------------
// scheduling
// ---------------------------------------------------------------------------

/**
 * Next fire time (ms) for an alarm, or null if disabled/never.
 * `days` empty ⇒ fires once, soonest next occurrence of that clock time.
 */
export function nextAlarmAt(alarm, nowMs) {
  if (!alarm || alarm.enabled === false) return null
  const [h, m] = String(alarm.time).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null

  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(nowMs)
    d.setDate(d.getDate() + offset)
    d.setHours(h, m, 0, 0)
    const t = d.getTime()
    if (t <= nowMs) continue
    const days = alarm.days || []
    if (days.length && !days.includes(d.getDay())) continue
    return t
  }
  return null
}

/**
 * The alarm we should currently be ringing for, if any. `lastFiredAt` makes a
 * given fire time ring exactly once even across reloads.
 */
export function dueAlarm(alarms, nowMs, lookbackMs = 60_000) {
  for (const alarm of alarms) {
    if (!alarm.enabled) continue
    const next = nextAlarmAt({ ...alarm, enabled: true }, nowMs - lookbackMs)
    if (next === null) continue
    if (next > nowMs) continue
    if (alarm.lastFiredAt && alarm.lastFiredAt >= next) continue
    return { alarm, firedAt: next }
  }
  return null
}

/** Wall-clock minutes remaining before the mission deadline. */
export function minutesToDeadline(nowMs, episode) {
  return (episode.missionDeadlineAt - nowMs) / MIN
}

// ---------------------------------------------------------------------------
// mission shape
// ---------------------------------------------------------------------------

/**
 * Inside mode needs (photos-1) gaps of spacing *between* shots, so accepting it
 * too late makes it mathematically impossible. That's the whole point: you have
 * to get up *and* start immediately.
 */
export function insideMissionPossible(nowMs, episode, settings) {
  const needed = (settings.insidePhotos - 1) * spacingMs(settings)
  return episode.missionDeadlineAt - nowMs >= needed
}

/** Why inside mode is locked, for the UI copy. */
export function insideMissionBlockedReason(nowMs, episode, settings) {
  const needed = (settings.insidePhotos - 1) * spacingMs(settings)
  const short = needed - (episode.missionDeadlineAt - nowMs)
  return `You started too late — ${settings.insidePhotos} photos spaced ${settings.insideSpacingMinutes} min apart need ${formatDuration(needed)}, and you only have ${formatDuration(episode.missionDeadlineAt - nowMs)} left. Outside mission only.`
}

/** Required steps for the chosen mode, in order. */
export function missionSteps(mode, settings) {
  if (mode === 'outside') {
    const steps = [{ kind: 'outside-scenery', label: 'Proof you are outside', poseId: null }]
    for (let i = 0; i < Math.max(1, settings.outsidePoseSelfies); i++) {
      steps.push({ kind: 'pose-selfie', label: `Pose selfie ${i + 1}`, poseId: null })
    }
    return steps
  }
  return Array.from({ length: settings.insidePhotos }, (_, i) => ({
    kind: 'pose-selfie',
    label: `Indoor proof ${i + 1} of ${settings.insidePhotos}`,
    poseId: null,
  }))
}

/** Which step index is still outstanding. */
export function currentStepIndex(episode) {
  return (episode?.captures?.length ?? 0)
}

// ---------------------------------------------------------------------------
// admin console — the tester's lease
// ---------------------------------------------------------------------------

/** True while an admin session is live (PIN verified, lease unexpired). */
export function adminActive(settings, nowMs = Date.now()) {
  if (!settings?.adminUnlockedAt) return false
  const ttl = settings.adminLeaseMinutes
  if (!ttl) return true // "stay unlocked" — deliberate, and flagged everywhere
  return nowMs - settings.adminUnlockedAt < ttl * MIN
}

/** How much of the lease is left, for the header badge. */
export function adminLeaseLeft(settings, nowMs = Date.now()) {
  if (!settings?.adminUnlockedAt) return null
  if (!settings.adminLeaseMinutes) return Infinity
  return Math.max(0, settings.adminUnlockedAt + settings.adminLeaseMinutes * MIN - nowMs)
}

/** Which overrides are currently in force, as short labels. */
export function adminActiveFlags(settings) {
  if (!adminActive(settings)) return []
  const flags = []
  if (settings.adminGodMode) flags.push('no lockout')
  if (settings.adminAutoPass) flags.push('auto-pass')
  if (settings.adminInstantSpacing) flags.push('no spacing')
  if (settings.adminQuietRing) flags.push('silent')
  return flags
}

/** A PIN is 4 digits or empty-rejected; nothing more fancy, it is not security. */
export function normalizePin(input) {
  const digits = String(input ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(0, 8) : null
}

/** How long each pose must be held while the shutter counts down. */
export const POSE_HOLD_MS = 1500

/**
 * Stable identity for an episode's randomness. Derived from fire time + alarm
 * id so a page reload cannot reroll a pose you were hoping to avoid.
 */
export function episodeSeed(episode) {
  return `${episode?.alarmId ?? 'manual'}@${episode?.firedAt ?? 0}`
}

/**
 * Deterministic pose pick: seeded from the episode + step index so a reload
 * can't be used to reroll a pose you don't want to do.
 */
export function poseForStep(seed, stepIndex) {
  const rng = mulberry32(hashString(`${seed}#${stepIndex}`))
  return POSES[Math.floor(rng() * POSES.length)]
}

/** Minimum wait after the previous shot before the next one counts. */
export function earliestNextCaptureAt(episode, settings) {
  const caps = episode?.captures ?? []
  if (episode?.mode !== 'inside') return 0
  if (caps.length === 0) return episode.startedMissionAt ?? episode.firedAt
  return caps[caps.length - 1].at + spacingMs(settings)
}

// ---------------------------------------------------------------------------
// the punishment ladder
// ---------------------------------------------------------------------------

/**
 * strike (1-based) ⇒ how many MINUTES the phone is locked.
 * testMode/demoTiming compress it so the loop is testable in seconds/minutes.
 */
export function lockMinutesFor(strike, settings) {
  const curve = settings.lockHoursCurve?.length ? settings.lockHoursCurve : [1]
  const hours = curve[Math.min(Math.max(strike, 1), curve.length) - 1] ?? curve.at(-1)
  const capped = Math.min(hours, settings.maxLockHours ?? hours)
  if (settings.testMode) return Math.max(1, Math.round(capped)) // hours → minutes
  if (settings.demoTiming) return capped * 60 / DEMO_DIVISOR // hours → seconds-ish
  return capped * 60
}

export function lockLabel(strike, settings) {
  const mins = lockMinutesFor(strike, settings)
  const suffix = settings.demoTiming ? ' (demo-compressed)' : settings.testMode ? ' (test mode: minutes not hours)' : ''
  return `${formatDuration(mins * MIN)}${suffix}`
}

export function describeLockCurve(settings) {
  return (settings.lockHoursCurve ?? [])
    .map((h, i) => `strike ${i + 1} → ${settings.testMode ? `${h} min` : `${h} h`}`)
    .join(', ')
}

/**
 * The one place that decides whether a blown mission becomes a lockout.
 * God mode returns false here, so the *state machine* — not just the UI — stops
 * punishing. Everything else (logging, the ring, the mission) still runs.
 */
export function shouldLockOut(settings, nowMs = Date.now()) {
  if (!adminActive(settings, nowMs)) return true
  return !settings.adminGodMode
}

/** What the next strike will cost — shown up front, no surprises. */
export function nextStrikeCost(strikes, settings) {
  return lockLabel(strikes + 1, settings)
}

// ---------------------------------------------------------------------------
// verification scoring
// ---------------------------------------------------------------------------

/**
 * Aggregate the per-shot checks into a pass/fail. Kept dumb and explicit so the
 * rules are auditable: every step must pass, and the *last* step is what
 * completes the mission.
 */
export function evaluateStep(checks) {
  const failures = checks.filter((c) => !c.ok).map((c) => c.label)
  return { ok: failures.length === 0, failures }
}

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

export function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Great-circle distance in metres; returns null if either point is unusable. */
export function geoDistanceMeters(a, b) {
  if (!a || !b) return null
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

/** History rollup for the stats screen. */
export function summarizeEvents(events) {
  const woke = events.filter((e) => e.type === 'woke')
  const failed = events.filter((e) => e.type === 'locked')
  const lockedMs = failed.reduce((sum, e) => sum + (e.lockMinutes ?? 0) * MIN, 0)
  const streak = (() => {
    let n = 0
    for (const e of [...events].reverse()) {
      if (e.type === 'woke') n++
      else if (e.type === 'locked') break
    }
    return n
  })()
  // consecutive failures counting forward from the last success
  const strikes = (() => {
    let n = 0
    for (const e of [...events].reverse()) {
      if (e.type === 'locked') n++
      else if (e.type === 'woke') break
    }
    return n
  })()
  const completionTimes = woke
    .filter((e) => e.completionMs != null)
    .map((e) => e.completionMs)
  return {
    total: events.length,
    woke: woke.length,
    failed: failed.length,
    lockedMs,
    streak,
    strikes,
    avgCompletionMs: completionTimes.length
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : null,
  }
}

/**
 * Strike count the app should use for the *next* lockout, derived from the log
 * so a storage reload can't reset your record by refreshing the page.
 */
export function strikesFromEvents(events) {
  let n = 0
  for (const e of [...events].reverse()) {
    if (e.type === 'locked') n++
    else if (e.type === 'woke') break
  }
  return n
}
