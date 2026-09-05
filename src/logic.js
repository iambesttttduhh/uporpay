// ---------------------------------------------------------------------------
// logic.js — pure rules engine. No DOM, no storage. Unit-tested in tests/.
// Everything about *when* things happen and *what* the punishment is lives
// here so it can be reasoned about (and tested) without a browser.
// ---------------------------------------------------------------------------

/**
 * The lines the app makes you say. Spoken proof replaces photographs: nothing is
 * captured, stored or uploaded — recognition runs, the words are compared, and
 * only the score survives (in the journal, as a number).
 *
 * Deliberately varied phonetically, and all of them are things you would not
 * say while half asleep, which is the actual filter.
 */
export const LINES = [
  { id: 'l01', text: 'The sun is up and I am making coffee right now' },
  { id: 'l02', text: 'Today I will be on time and nobody can stop me' },
  { id: 'l03', text: 'One two three four five, my brain is awake' },
  { id: 'l04', text: 'Left foot on the floor, right foot on the floor' },
  { id: 'l05', text: 'I promised myself I would actually get up' },
  { id: 'l06', text: 'The quick brown fox jumps over the lazy dog' },
  { id: 'l07', text: 'Kitchen window, cold glass, grey sky outside' },
  { id: 'l08', text: 'Nine times eight is seventy two, check the maths' },
  { id: 'l09', text: 'I am standing up in the room where I slept' },
  { id: 'l10', text: 'Shower, teeth, shirt, shoes, keys, out the door' },
  { id: 'l11', text: 'This alarm cost me my phone for the morning' },
  { id: 'l12', text: 'Yellow bus at the corner turning twice' },
  { id: 'l13', text: 'My name is written in the sky and it is early' },
  { id: 'l14', text: 'Give me twenty minutes and I will be dressed' },
  { id: 'l15', text: 'The floor is cold and that is the point' },
  { id: 'l16', text: 'Repeat after me: I am awake and I mean it' },
  { id: 'l17', text: 'Six sheep jumped over the wooden gate' },
  { id: 'l18', text: 'Every failed morning costs me another hour' },
  { id: 'l19', text: 'Open the curtain and count three cars outside' },
  { id: 'l20', text: 'I will not negotiate with myself at this hour' },
  { id: 'l21', text: 'Red cup, blue spoon, one plate on the table' },
  { id: 'l22', text: 'Twenty twenty six, the fifth of September, morning' },
  { id: 'l23', text: 'Say it loud: the phone stays locked until I finish' },
  { id: 'l24', text: 'Boots by the door, bag on the chair, keys in my hand' },
]

/** Word-count floor for a line to be recognisable as "spoken on purpose". */
export const MIN_LINE_WORDS = 5

export function normalizeWords(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Transcript scoring, pure so it can be unit tested: how much of the required
 * line did the recognition actually hear, and how much junk did it hear.
 *
 * Subsequence-first rather than set-overlap: reading the line out loud in order
 * passes, while mumbling the individual words in a random order does not.
 */
export function scoreTranscript(required, spoken) {
  const want = normalizeWords(required)
  const got = normalizeWords(spoken)
  if (!want.length) return { score: 0, matched: [], missing: [], extra: 0, words: 0 }
  // longest common subsequence over the word lists
  let prev = new Array(got.length + 1).fill(0)
  for (let i = 1; i <= want.length; i++) {
    const cur = new Array(got.length + 1).fill(0)
    for (let j = 1; j <= got.length; j++) {
      cur[j] = want[i - 1] === got[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    prev = cur
  }
  const hits = prev[got.length]
  const matchedSet = new Set()
  // which required words were found at all (for the "you skipped X" copy)
  const gotSet = new Set(got)
  const missing = want.filter((w) => (gotSet.has(w) ? (matchedSet.add(w), false) : w))
  return {
    score: want.length ? hits / want.length : 0,
    matched: want.filter((w) => gotSet.has(w)),
    missing,
    extra: Math.max(0, got.length - hits),
    words: got.length,
  }
}

export const DEFAULT_SETTINGS = {
  // --- alarm behaviour -----------------------------------------------------
  soundOn: true,
  vibrateOn: true,
  maxVolume: true,

  // --- the rules -----------------------------------------------------------
  ringMinutes: 5,            // how long it buzzes continuously, no way to dismiss
  // Twenty minutes from the first buzz to "prove you are up". The number is the
  // rule you asked for: blow it and the lockout is the 20-hour one.
  missionWindowMinutes: 20,

  // --- the proofs (no photographs anywhere in this app) --------------------
  insideLines: 3,            // IN: say N lines
  insideLineGapMinutes: 1,   // ...with a minute between each one
  outsideSceneSeconds: 12,   // OUT: hold the camera on your surroundings
  outsideLines: 2,           // ...then say N lines
  sceneMotionMin: 25,        // the scene must actually move (you walking, not a photo of a wall)
  micLevelMin: 0.03,         // peak mic level while speaking: kills "silence recognised as words"
  speechMatch: 0.6,          // fraction of the required words the recogniser must hear
  lineEcho: true,            // show the transcript back while you speak

  // --- the punishment ------------------------------------------------------
  // Hours locked, indexed by consecutive failed wake-ups (strike 1, 2, 3...).
  // Ten strikes, one hour each: the tenth failed morning costs 10 hours.
  lockHoursCurve: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  maxLockHours: 20,
  // You never even tapped "I'M AWAKE" inside the window: asleep through it.
  neverWokeLockHours: 20,
  // After a lockout expires, the same alarm is re-armed for the next morning —
  // the debt does not get written off because you served the time.
  reArmAfterLockout: true,
  chargeEscapes: true,       // leaving the lockout costs time (browser + APK)
  escapePenaltyMinutes: 15,  // each detected unpin/force-stop attempt adds this
  escapePenaltyCapMinutes: 240,
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
  // Keeps the screen painted on the lockout and re-pins from the notification
  // shade/recents. Only meaningful in the APK; harmless in a browser.
  lockShadeGuard: true,

  // --- native (APK) behaviour ----------------------------------------------
  // An alarm that fired while the app was closed still costs you the lockout.
  // Turn this off if you would rather a missed-but-unwitnessed alarm be forgiven.
  lockOnMissedWhileClosed: true,

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

/** Gap required between two consecutive proofs (default 1 minute). */
export function spacingMs(settings) {
  return effectiveMinutes(settings.insideLineGapMinutes ?? settings.insideSpacingMinutes ?? 1, settings) * MIN
}

/** How long the surroundings must be held to the camera. */
export function sceneHoldMs(settings) {
  const secs = settings.outsideSceneSeconds ?? 12
  return (settings.demoTiming ? secs / DEMO_DIVISOR : secs) * 1000
}

export function missionTitle(mode, settings) {
  return mode === 'outside'
    ? `Show where you are for ${settings.outsideSceneSeconds ?? 12} s, then say ${(settings.outsideLines ?? 2)} lines`
    : `Say ${settings.insideLines ?? 3} lines, ${(settings.insideLineGapMinutes ?? 1)} min apart`
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
  const needed = ((settings.insideLines ?? 3) - 1) * spacingMs(settings)
  return episode.missionDeadlineAt - nowMs >= needed
}

/** Why inside mode is locked, for the UI copy. */
export function insideMissionBlockedReason(nowMs, episode, settings) {
  const needed = ((settings.insideLines ?? 3) - 1) * spacingMs(settings)
  return `Too late for that one — ${(settings.insideLines ?? 3)} lines ${(settings.insideLineGapMinutes ?? 1)} min apart need ${formatDuration(needed)} and you have ${formatDuration(episode.missionDeadlineAt - nowMs)} left. Go outside instead.`
}

/** Required steps for the chosen mode, in order. */
export function missionSteps(mode, settings) {
  const lines = (n, first) =>
    Array.from({ length: Math.max(1, n) }, (_, i) => ({
      kind: 'voice',
      label: `Line ${i + 1} of ${Math.max(1, n)}`,
      gap: i === 0 && first ? false : true,
    }))
  if (mode === 'outside') {
    // Scene first: it is the proof that the walk happened. The lines come after,
    // with no gap between them — by then you are up and moving.
    return [{ kind: 'scene', label: 'Show me where you are', gap: false }, ...lines(settings.outsideLines ?? 2, true)]
  }
  return lines(settings.insideLines ?? 3, true)
}

/** Which step needs the spacing wait before it can be attempted. */
export function stepNeedsGap(step, index) {
  if (!step) return false
  return index > 0 && (step.gap ?? true)
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

/** Legacy name kept for the settings/tests: how long a proof is "held". */
export const POSE_HOLD_MS = 1500

/**
 * Stable identity for an episode's randomness. Derived from fire time + alarm
 * id so a page reload cannot reroll a pose you were hoping to avoid.
 */
export function episodeSeed(episode) {
  return `${episode?.alarmId ?? 'manual'}@${episode?.firedAt ?? 0}`
}

/**
 * Deterministic line pick: seeded from the episode + step index, so reloading
 * the app cannot reroll a sentence you would rather not say. This is the same
 * trick the photo missions used, minus the camera.
 */
export function lineForStep(seed, stepIndex) {
  const rng = mulberry32(hashString(`${seed}#line#${stepIndex}`))
  return LINES[Math.floor(rng() * LINES.length)]
}

/** @deprecated pose era kept so old journal rows still render a label. */
export function poseForStep(seed, stepIndex) {
  return lineForStep(seed, stepIndex)
}

/** Minimum wait after the previous shot before the next one counts. */
export function earliestNextCaptureAt(episode, settings) {
  const caps = episode?.captures ?? []
  const steps = missionSteps(episode?.mode, settings)
  const next = steps[caps.length]
  if (!next || !stepNeedsGap(next, caps.length)) return 0
  if (caps.length === 0) return episode.startedMissionAt ?? episode.firedAt
  return caps[caps.length - 1].at + spacingMs(settings)
}

// ---------------------------------------------------------------------------
// the punishment ladder
// ---------------------------------------------------------------------------

/**
 * strike (1-based) ⇒ MINUTES locked. The curve is 1 h per strike up to the tenth
 * failed morning, and there is one rule above the ladder: if you never even
 * tapped "I'M AWAKE" inside the window, you were asleep through the whole thing,
 * and that costs `neverWokeLockHours` (20 h) regardless of your strike count.
 */
export function lockMinutesFor(strike, settings, { neverWoke = false } = {}) {
  if (neverWoke) {
    const h = Math.min(settings.neverWokeLockHours ?? 20, settings.maxLockHours ?? 24)
    // Compressed exactly like the ladder, otherwise a demo build would really
    // lock the phone for twenty hours after one overslept morning.
    if (settings.testMode) return Math.max(1, Math.round(h))
    if (settings.demoTiming) return (h * 60) / DEMO_DIVISOR
    return h * 60
  }
  const curve = settings.lockHoursCurve?.length ? settings.lockHoursCurve : [1]
  const hours = curve[Math.min(Math.max(strike, 1), curve.length) - 1] ?? curve.at(-1)
  const capped = Math.min(hours, settings.maxLockHours ?? hours)
  if (settings.testMode) return Math.max(1, Math.round(capped)) // hours → minutes
  if (settings.demoTiming) return (capped * 60) / DEMO_DIVISOR // hours → seconds-ish
  return capped * 60
}

/** Escape penalty: an unpin or a force-stop during a lockout costs more time. */
export function escapePenaltyMs(settings) {
  const mins = settings.escapePenaltyMinutes ?? 15
  const cap = settings.escapePenaltyCapMinutes ?? 240
  return Math.min(mins, cap) * MIN
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
/**
 * Consecutive `locked` events since the last reset. Two things clear the ladder:
 * a real `woke`, and an explicit `strike_reset` (the admin console forgives
 * strikes that way, so a test run does not have to pretend it was a win).
 */
export function strikesFromEvents(events) {
  let n = 0
  for (const e of [...events].reverse()) {
    if (e.type === 'locked') n++
    else if (e.type === 'woke' || e.type === 'strike_reset') break
  }
  return n
}
