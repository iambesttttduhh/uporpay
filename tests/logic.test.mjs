import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as L from '../src/logic.js'

const real = { ...L.DEFAULT_SETTINGS, demoTiming: false, testMode: false }
const demo = { ...L.DEFAULT_SETTINGS, demoTiming: true }

// The two numbers the user picked and refuses to have "smoothed": ten failed
// mornings is a ten-hour lock, and never tapping awake at all is a 20-hour lock.
test('lock ladder escalates with consecutive failures and caps out', () => {
  assert.equal(L.lockMinutesFor(1, real), 60) // 1 h
  assert.equal(L.lockMinutesFor(2, real), 120) // 2 h
  assert.equal(L.lockMinutesFor(9, real), 9 * 60)
  assert.equal(L.lockMinutesFor(10, real), 10 * 60) // ten strikes = ten hours
  assert.equal(L.lockMinutesFor(14, real), 10 * 60) // past the list → last rung
  assert.equal(L.lockMinutesFor(0, real), 60) // clamped to first rung
  assert.equal(L.lockMinutesFor(4, { ...real, maxLockHours: 3 }), 180) // user cap wins
})

test('never tapping awake is its own, much bigger rule', () => {
  // Strike 1 would normally be an hour; asleep through the whole window is 20.
  assert.equal(L.lockMinutesFor(1, real, { neverWoke: true }), 20 * 60)
  assert.equal(L.lockMinutesFor(7, real, { neverWoke: true }), 20 * 60)
  // …and the user cap still applies, so the copy can promise it.
  assert.equal(L.lockMinutesFor(1, { ...real, maxLockHours: 6 }, { neverWoke: true }), 6 * 60)
})

test('escape attempts are priced, not forbidden', () => {
  assert.equal(L.escapePenaltyMs(real), 15 * 60_000)
  // A silly penalty setting can never exceed the cap.
  assert.equal(L.escapePenaltyMs({ ...real, escapePenaltyMinutes: 600 }), 240 * 60_000)
  assert.equal(L.DEFAULT_SETTINGS.reArmAfterLockout, true) // the alarm comes back
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
  const episode = { firedAt: 0, missionDeadlineAt: 30 * 60_000, startedMissionAt: 0 }
  // 3 lines a minute apart need 2 minutes of gaps. 30 minutes left → possible.
  assert.equal(L.insideMissionPossible(0, episode, real), true)
  // 2 minutes left is exactly enough; 1 minute is not.
  assert.equal(L.insideMissionPossible(28 * 60_000, episode, real), true)
  assert.equal(L.insideMissionPossible(29 * 60_000, episode, real), false)
  assert.match(L.insideMissionBlockedReason(29 * 60_000, episode, real), /need 2 m 0 s/)
  // Fewer lines → the option stays open longer.
  assert.equal(L.insideMissionPossible(29 * 60_000, episode, { ...real, insideLines: 2 }), true)
})

test('line spacing is enforced from the previous accepted line', () => {
  const prev = 1000
  const inside = { mode: 'inside', firedAt: 0, startedMissionAt: 0, captures: [{ at: prev }] }
  assert.equal(L.earliestNextCaptureAt(inside, real), prev + 60_000) // one minute
  // Outside: the scenery hold has no wait before it, and neither does the first
  // line after it — you are already up and walking by then.
  const outside = { mode: 'outside', firedAt: 0, startedMissionAt: 0, captures: [] }
  assert.equal(L.earliestNextCaptureAt(outside, real), 0)
  assert.equal(L.earliestNextCaptureAt({ ...outside, captures: [{ at: prev }] }, real), 0)
  // The second line does wait.
  assert.equal(
    L.earliestNextCaptureAt({ ...outside, captures: [{ at: prev }, { at: prev + 500 }] }, real),
    prev + 500 + 60_000
  )
})

test('mission steps are generated per mode — and none of them is a photo', () => {
  assert.deepEqual(L.missionSteps('inside', real).map((s) => s.kind), ['voice', 'voice', 'voice'])
  assert.deepEqual(L.missionSteps('inside', real).map((s) => s.gap), [false, true, true])
  assert.deepEqual(L.missionSteps('outside', real).map((s) => s.kind), ['scene', 'voice', 'voice'])
  assert.equal(L.missionSteps('outside', real)[0].gap, false)
  assert.deepEqual(
    L.missionSteps('inside', { ...real, insideLines: 5 }).map((s) => s.kind),
    ['voice', 'voice', 'voice', 'voice', 'voice']
  )
  assert.ok(!JSON.stringify(L.missionSteps('outside', real)).includes('photo'))
})

test('line selection is deterministic per episode but differs across episodes', () => {
  const a = L.lineForStep(L.episodeSeed({ alarmId: 'x', firedAt: 1 }), 0)
  const aAgain = L.lineForStep(L.episodeSeed({ alarmId: 'x', firedAt: 1 }), 0)
  assert.deepEqual(a, aAgain) // a refresh must not reroll an easier sentence
  const spread = new Set(
    Array.from({ length: 200 }, (_, i) => L.lineForStep(L.episodeSeed({ alarmId: 'x', firedAt: i }), 0).id)
  )
  assert.ok(spread.size >= 8, `expected a spread of lines, got ${spread.size}`)
  // Consecutive steps in one episode are different sentences.
  const seed = L.episodeSeed({ alarmId: 'y', firedAt: 7 })
  assert.notEqual(L.lineForStep(seed, 0).id, L.lineForStep(seed, 1).id)
})

test('a line only counts if most of the words are there', () => {
  const want = 'I am standing up and I said the sentence out loud'
  assert.equal(L.scoreTranscript(want, want).score, 1)
  assert.deepEqual(L.scoreTranscript(want, want).missing, [])
  assert.ok(L.scoreTranscript(want, 'standing up said sentence out loud').score > 0.5)
  assert.equal(L.scoreTranscript(want, '').score, 0)
  assert.equal(L.scoreTranscript(want, 'the').score, 1 / L.normalizeWords(want).length)
  // words read out of order must not pass: subsequence, not bag-of-words
  const backwards = want.split(' ').reverse().join(' ')
  assert.ok(L.scoreTranscript(want, backwards).score < 0.6, backwards)
  // and it tells you which words you skipped, for the failure copy
  assert.deepEqual(L.scoreTranscript('alpha beta gamma delta epsilon', 'alpha gamma epsilon').missing, ['beta', 'delta'])
  assert.ok(L.MIN_LINE_WORDS >= 5) // nothing you can mumble in one word
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
  assert.equal(L.ringMs(demo), 5_000) // 5 min → 5 s
  assert.equal(L.missionWindowMs(demo), 20_000) // 20 min → 20 s
  assert.equal(L.spacingMs(demo), 1_000) // 1 min → 1 s
  assert.equal(L.sceneHoldMs(demo), 200) // 12 s → 200 ms
  assert.equal(L.ringMs(real), 5 * 60_000)
  assert.equal(L.missionWindowMs(real), 20 * 60_000)
  assert.equal(L.spacingMs(real), 60_000)
  assert.equal(L.sceneHoldMs(real), 12_000)
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

test('the clock is checked against time, not against the clock', () => {
  const nothing = L.clockSkew({})
  assert.equal(nothing.jumped, false, 'no previous stamp means nothing to compare')

  // half an hour into the past: exactly the trick a lockout has to survive
  const back = L.clockSkew({ prevWall: 1_000_000 + 30 * 60_000, wall: 1_000_000 })
  assert.equal(back.back, 30 * 60_000)
  assert.equal(back.forward, 0)
  assert.ok(back.jumped)
  assert.equal(back.gained, 30 * 60_000)

  // a forward jump is only provable against the monotonic timer, inside one session
  const small = L.clockSkew({ prevWall: 1_000_000, wall: 1_060_000, prevMono: 1_000, mono: 11_000, sameBoot: true })
  assert.equal(small.forward, 50_000)
  assert.equal(small.jumped, false, 'NTP corrections and a laggy timer are not tampering')
  const big = L.clockSkew({ prevWall: 1_000_000, wall: 1_660_000, prevMono: 1_000, mono: 11_000, sameBoot: true })
  assert.equal(big.forward, 650_000)
  assert.ok(big.jumped)

  // after a reboot the monotonic clock restarts, so a long absence is not a jump
  const reboot = L.clockSkew({ prevWall: 1_000_000, wall: 1_000_000 + 8 * 3_600_000, prevMono: 900_000, mono: 4_000, sameBoot: false })
  assert.equal(reboot.forward, 0)
  assert.equal(reboot.jumped, false)

  // timezones and DST move the calendar, never the epoch: nothing to report
  assert.equal(L.clockSkew({ prevWall: 5_000_000, wall: 5_001_000 }).jumped, false)
})
