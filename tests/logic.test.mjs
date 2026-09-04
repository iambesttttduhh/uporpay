import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as L from '../src/logic.js'

const real = { ...L.DEFAULT_SETTINGS, demoTiming: false, testMode: false }
const demo = { ...L.DEFAULT_SETTINGS, demoTiming: true }

test('lock ladder escalates with consecutive failures and caps out', () => {
  assert.equal(L.lockMinutesFor(1, real), 60) // 1 h
  assert.equal(L.lockMinutesFor(2, real), 120) // 2 h
  assert.equal(L.lockMinutesFor(3, real), 240) // 4 h
  assert.equal(L.lockMinutesFor(9, real), 24 * 60) // curve exhausted → 24 h cap
  assert.equal(L.lockMinutesFor(0, real), 60) // clamped to first rung
  assert.equal(L.lockMinutesFor(4, { ...real, maxLockHours: 3 }), 180) // user cap wins
})

test('demo timing compresses the ladder by 60x', () => {
  assert.equal(L.lockMinutesFor(1, demo), 1) // 1 h → 1 min
  assert.equal(L.lockMinutesFor(2, demo), 2)
})

test('nextAlarmAt picks the next matching day', () => {
  const wedNoon = new Date(2026, 8, 9, 12, 0, 0).getTime() // Wed 2026-09-09
  const alarm = { time: '07:00', days: [1, 2, 3, 4, 5], enabled: true }
  const next = L.nextAlarmAt(alarm, wedNoon)
  const d = new Date(next)
  assert.equal(d.getDay(), 4) // Thu
  assert.equal(d.getHours(), 7)
  assert.ok(next > wedNoon)
})

test('disabled alarms never fire', () => {
  assert.equal(L.nextAlarmAt({ time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: false }, Date.now()), null)
})

test('dueAlarm fires inside the lookback window and not twice', () => {
  const firedAt = new Date(2026, 8, 9, 7, 0, 0).getTime()
  const alarm = { id: 'a', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true, lastFiredAt: null }
  assert.equal(L.dueAlarm([alarm], firedAt + 1000).firedAt, firedAt)
  // already handled for this fire time → nothing due
  assert.equal(L.dueAlarm([{ ...alarm, lastFiredAt: firedAt }], firedAt + 1000), null)
})

test('inside mission becomes impossible if you start it too late', () => {
  const firedAt = 0
  const episode = { firedAt, missionDeadlineAt: 30 * 60_000, startedMissionAt: 0 }
  // 3 photos need 2 gaps of 10 min = 20 min. 30 left → possible.
  assert.equal(L.insideMissionPossible(0, episode, real), true)
  // 9 minutes left → cannot fit 20 minutes of spacing
  assert.equal(L.insideMissionPossible(21 * 60_000, episode, real), false)
  assert.match(L.insideMissionBlockedReason(21 * 60_000, episode, real), /need 20 m 0 s/)
})

test('capture spacing is enforced from the previous accepted shot', () => {
  const prev = 1000
  const episode = { mode: 'inside', firedAt: 0, captures: [{ at: prev }] }
  assert.equal(L.earliestNextCaptureAt(episode, real), prev + 10 * 60_000)
  // outside mode has no spacing requirement between its two shots
  assert.equal(L.earliestNextCaptureAt({ ...episode, mode: 'outside' }, real), 0)
})

test('mission steps are generated per mode', () => {
  assert.deepEqual(
    L.missionSteps('inside', real).map((s) => s.kind),
    ['pose-selfie', 'pose-selfie', 'pose-selfie']
  )
  assert.deepEqual(
    L.missionSteps('outside', real).map((s) => s.kind),
    ['outside-scenery', 'pose-selfie']
  )
})

test('pose selection is deterministic per episode but differs across episodes', () => {
  const a = L.poseForStep(L.episodeSeed({ alarmId: 'x', firedAt: 1 }), 0).id
  const aAgain = L.poseForStep(L.episodeSeed({ alarmId: 'x', firedAt: 1 }), 0).id
  assert.equal(a, aAgain)
  const spread = new Set(
    Array.from({ length: 200 }, (_, i) => L.poseForStep(L.episodeSeed({ alarmId: 'x', firedAt: i }), 0).id)
  )
  assert.ok(spread.size >= 8, `expected a spread of poses, got ${spread.size}`)
})

test('strikes reset on a successful wake, accumulate on failures', () => {
  const events = [
    { type: 'locked', at: 1 },
    { type: 'locked', at: 2 },
    { type: 'woke', at: 3 },
  ]
  assert.equal(L.strikesFromEvents(events), 0)
  assert.equal(L.strikesFromEvents([...events, { type: 'locked', at: 4 }]), 1)
  assert.equal(L.strikesFromEvents([{ type: 'locked', at: 1 }, { type: 'locked', at: 2 }]), 2)
})

test('event summary rolls up streak and locked time', () => {
  const stats = L.summarizeEvents([
    { type: 'woke', at: 1, completionMs: 60_000 },
    { type: 'woke', at: 2, completionMs: 120_000 },
    { type: 'locked', at: 3, lockMinutes: 60 },
  ])
  assert.equal(stats.woke, 2)
  assert.equal(stats.failed, 1)
  assert.equal(stats.lockedMs, 60 * 60_000)
  assert.equal(stats.streak, 0)
  assert.equal(stats.avgCompletionMs, 90_000)
})

test('demo divisor compresses every time rule consistently', () => {
  assert.equal(L.ringMs(demo), 5_000)
  assert.equal(L.missionWindowMs(demo), 30_000)
  assert.equal(L.spacingMs(demo), 10_000)
  assert.equal(L.ringMs(real), 5 * 60_000)
})

test('countdown formatting stays readable across scales', () => {
  assert.equal(L.formatCountdown(0), '00:00')
  assert.equal(L.formatCountdown(65_000), '01:05')
  assert.equal(L.formatCountdown(3_725_000), '01:02:05')
})

test('geo distance is sane at city scale', () => {
  const km = L.geoDistanceMeters({ lat: 28.6139, lon: 77.209 }, { lat: 28.5355, lon: 77.391 }) / 1000
  assert.ok(km > 18 && km < 22, `delhi→noida should be ~20km, got ${km.toFixed(1)}`)
  assert.equal(L.geoDistanceMeters(null, { lat: 1, lon: 1 }), null)
})

test('evaluateStep fails closed when any check fails', () => {
  assert.equal(L.evaluateStep([{ ok: true }, { ok: true }]).ok, true)
  const bad = L.evaluateStep([{ ok: true }, { ok: false, label: 'GPS' }])
  assert.equal(bad.ok, false)
  assert.deepEqual(bad.failures, ['GPS'])
})
