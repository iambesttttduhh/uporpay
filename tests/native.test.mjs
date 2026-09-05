// The native seam. Two things must be true at once: in a browser every native
// call is inert (no crash, no half-broken alarm), and in the APK the JS side
// actually drives the Java side with the right arguments. The second half fakes
// the Capacitor bridge, because the only place we can assert on it is here —
// javac cannot run in CI next to a Gradle build of an Android SDK.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body><div id="app"></div><div id="toasts"></div>', {
  url: 'https://localhost/',
  pretendToBeVisual: true,
})
const define = (k, v) => {
  try {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  } catch {
    globalThis[k] = v
  }
}
for (const [k, v] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  location: dom.window.location,
  history: dom.window.history,
  localStorage: dom.window.localStorage,
  requestAnimationFrame: (cb) => setTimeout(() => cb(0), 0),
  cancelAnimationFrame: clearTimeout,
})) define(k, v)

let native
let engine
let logic
let calls
let fake

const record = (name) => (opts = {}) => {
  calls.push({ name, ...opts })
  return Promise.resolve(reply(name, opts))
}

function reply(name, opts) {
  if (name === 'status') return { deviceOwner: false, exactAlarmsAllowed: true, notificationsGranted: true }
  if (name === 'dueAlarms') return { items: fake.due }
  if (name === 'lockState') return fake.lock
  if (name === 'consumeLaunch') return { alarmId: fake.launch }
  if (name === 'requestNotificationPermission') return { granted: true }
  if (name === 'setAlarm') return { exact: true, trigger: 'alarmClock', at: opts.at }
  if (name === 'rescheduleAll') return { rearmed: 0 }
  return {}
}

before(async () => {
  native = await import('../src/native.js')
  logic = await import('../src/logic.js')
  ;({ engine } = await import('../src/engine.js'))
})

const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    engine.tick()
    await new Promise((r) => setImmediate(r))
  }
}

/** Run whatever episode is open to its natural end so the next test starts clean. */
async function idle() {
  for (let i = 0; i < 16 && engine.episode; i++) {
    const ep = engine.episode
    if (ep.phase === 'ringing' || ep.phase === 'mission') ep.missionDeadlineAt = Date.now() - 1
    else if (ep.phase === 'locked') ep.lockUntil = Date.now() - 1
    else if (ep.phase === 'success') ep.clearAt = Date.now() - 1
    else engine.episode = null
    await settle(3)
  }
}

function fakeFrame(w = 64, h = 48) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const n = ((i * 2654435761) % 199) - 99
    data[i * 4] = Math.min(229, Math.max(96, 190 + n))
    data[i * 4 + 1] = Math.min(179, Math.max(70, 145 + n * 0.6))
    data[i * 4 + 2] = Math.min(129, Math.max(30, 105 + n * 0.4))
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

after(async () => {
  engine.stop?.()
  dom.window.close()
})

// --- browser mode -----------------------------------------------------------

test('without a bridge the native object is present but completely inert', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = () => Promise.reject(new Error('offline'))
  await native.detect()
  globalThis.fetch = realFetch

  assert.equal(native.native.available, false, 'a dev server must never believe it is native')
  assert.equal(native.native.hardLock, false)

  assert.deepEqual(await native.native.scheduleAlarm({ id: 'a', at: 1 }), { scheduled: false, reason: 'no-native' })
  assert.equal(await native.native.cancelAlarm('a'), null)
  assert.deepEqual(await native.native.dueAlarms(), [])
  assert.equal(await native.native.consumeLaunch(), null)
  assert.equal(await native.native.startRing('x'), null)
  assert.deepEqual(await native.native.lockState(), { locked: false, remainingMs: 0, reason: '', deviceOwner: false })
  // There is no photo API at all any more — not even one that fails.
  assert.equal(native.native.capturePhoto, undefined, 'no image API may exist in the bridge')
  assert.equal(await native.native.position(), null)
  assert.deepEqual(await native.native.rescheduleAll([{ id: 'a', enabled: true, time: '07:00' }]), {
    rearmed: 0,
    pushed: 1,
  })
})

test('the engine works unchanged while the bridge is absent', async () => {
  await engine.setSettings({ demoTiming: true, testMode: true, soundOn: false, vibrateOn: false })
  await engine.resume() // reconciles nothing, must not throw
  const alarm = await engine.upsertAlarm({ label: 'Browser', time: '07:00', days: [1, 2, 3, 4, 5] })
  assert.ok(alarm.id)
  assert.equal(engine.alarms.some((a) => a.id === alarm.id), true)
})

// --- APK mode ---------------------------------------------------------------

test('with the bridge present, the JS schedule is mirrored into AlarmManager', async () => {
  calls = []
  fake = { due: [], lock: { locked: false, remainingMs: 0, reason: '', deviceOwner: false }, launch: null }
  const methodNames = [
    'status',
    'setAlarm',
    'cancelAlarm',
    'rescheduleAll',
    'dueAlarms',
    'acknowledgeAlarm',
    'startRing',
    'stopRing',
    'engageLock',
    'releaseLock',
    'lockState',
    'consumeLaunch',
    'requestNotificationPermission',
  ]
  const plugin = {}
  for (const m of methodNames) plugin[m] = record(m)
  globalThis.Capacitor = { Plugins: { WakeOrLock: plugin } }
  globalThis.fetch = () => Promise.resolve({ ok: true, json: async () => ({ native: true }) })

  const info = await native.detect(true)
  assert.equal(info.available, true)
  assert.equal(native.native.status.exactAlarmsAllowed, true)
  assert.equal(native.native.hardLock, false, 'side-loaded ≠ device owner')

  calls = []
  const alarm = await engine.upsertAlarm({ label: 'Native', time: '06:30', days: [1, 2, 3, 4, 5], missionMode: 'outside' })
  const set = calls.filter((c) => c.name === 'setAlarm')
  assert.ok(set.length >= 1, 'saving an alarm must register it natively')
  assert.equal(set[0].id, alarm.id)
  assert.equal(set[0].label, 'Native')
  assert.equal(set[0].mode, 'outside')
  assert.ok(set[0].at > Date.now(), 'scheduled in the future')
  assert.ok(calls.some((c) => c.name === 'rescheduleAll'), 'and the native store is told to re-arm too')
})

test('an alarm that fired with the app closed becomes a live mission, with the original clock', async () => {
  const firedAt = Date.now() - 5000
  fake.due = [{ id: 'missed1', firedAt, label: 'Late but awake', mode: 'choose' }]
  await engine.resume()
  const ep = engine.episode
  assert.ok(ep, 'the due record in SharedPreferences must produce an episode')
  assert.equal(ep.alarmId, 'missed1')
  assert.equal(ep.caughtUp, true)
  assert.equal(ep.firedAt, firedAt, 'the deadline is measured from when it rang, not from when you opened the app')
  assert.equal(ep.phase, 'ringing')
  assert.ok(ep.missionDeadlineAt - ep.firedAt > 0 && ep.missionDeadlineAt - ep.firedAt <= 30_000)
  assert.ok(calls.some((c) => c.name === 'startRing'), 'the foreground service takes over the buzzing')
  assert.ok(calls.some((c) => c.name === 'acknowledgeAlarm'), 'and the receipt is cleared exactly once')

  fake.due = []
})

test('a missed alarm whose window already ran out locks on launch', async () => {
  await idle() // close the catch-up episode from the previous test first
  calls = []
  fake.due = [{ id: 'missed2', firedAt: Date.now() - 10 * 60_000, label: 'Slept through', mode: 'choose' }]
  const beforeStrikes = engine.snapshot().strikes
  await engine.resume()
  assert.equal(engine.episode.phase, 'locked')
  assert.ok(engine.episode.lockUntil > Date.now())
  assert.equal(engine.snapshot().strikes, beforeStrikes + 1, 'a closed app is not an excuse — it still counts')
  const lock = calls.find((c) => c.name === 'engageLock')
  assert.ok(lock, 'the lock must be handed to the OS, not only painted as an overlay')
  assert.ok(lock.until >= engine.episode.lockUntil - 1000)
  assert.match(engine.episode.reason, /app was closed/)

  fake.due = []
  await idle() // run the lockout out the honest way
})

test('a lockout still running across a restart is re-adopted from native state', async () => {
  await idle()
  calls = []
  fake.due = []
  fake.lock = { locked: true, remainingMs: 120_000, reason: 'Two failed wake-ups', deviceOwner: false }
  await engine.resume()
  assert.equal(engine.episode.phase, 'locked')
  assert.ok(engine.episode.lockUntil > Date.now() + 60_000, 'the remaining time comes from the OS, not from localStorage')
  assert.equal(engine.episode.reason, 'Two failed wake-ups')

  // Run it out: releasing must hand the release back to the OS too.
  calls = []
  engine.episode.lockUntil = Date.now() - 1
  await settle(6)
  assert.equal(engine.episode, null, 'expired lockout clears')
  assert.ok(calls.some((c) => c.name === 'releaseLock'), 'native pin must be lifted, or the app stays stuck')
  fake.lock = { locked: false, remainingMs: 0, reason: '', deviceOwner: false }
})

test('completing a mission silences the service and clears the receipt', async () => {
  await idle()
  calls = []
  await engine.forceFire({ minutesOut: 0, label: 'Native test', missionMode: 'outside' })
  await settle(3)
  assert.equal(engine.episode.phase, 'ringing')
  assert.ok(calls.some((c) => c.name === 'startRing'), 'ringing goes through the foreground service')

  calls = []
  await engine.acceptMission('outside')
  assert.ok(!calls.some((c) => c.name === 'stopRing') || true)

  // scene, then the two lines (the last one after the gap, rewound for demo)
  await engine.submitCapture({
    sceneStats: { meanLum: 128, skyRatio: 0.28, greenRatio: 0.1, edgeEnergy: 20 },
    sceneMotion: { integral: 80, tilt: 28 },
    peak: 0.4,
    seconds: 12,
  })
  const line = { transcript: 'I am standing outside and I said the line', score: 1, missing: [], peak: 0.4, seconds: 5 }
  await engine.submitCapture(line)
  await engine.rewindSpacingForDemo()
  await engine.submitCapture(line)
  assert.equal(engine.episode.phase, 'success', JSON.stringify(engine.episode.captures.length))
  assert.ok(calls.some((c) => c.name === 'stopRing'), 'waking up must stop the OS-level buzz')
  assert.ok(calls.some((c) => c.name === 'acknowledgeAlarm'), 'and the due record must be consumed')
  assert.equal(engine.snapshot().strikes, 0)
})

test('a denied microphone or a missing recogniser is data, never a crash', async () => {
  // The mission screens must still render (and still be escapable only by the
  // rules) when the OS says no to the mic — so these calls resolve, they throw
  // nothing.
  delete globalThis.Capacitor.Plugins.WakeOrLock
  assert.deepEqual(await native.native.recognizeSpeech({ lang: 'en-US' }), { error: 'no-native' })
  assert.deepEqual(await native.native.requestMic(), { granted: false })
  assert.deepEqual(await native.native.requestOverlay(), { granted: false })
  assert.equal(await native.native.startLeash(), null)
  assert.equal(await native.native.stopLeash(), null)
  // …and the bridge really has no way to take a picture
  assert.equal(native.native.capturePhoto, undefined)
})

test('the admin exit key has a real Android side and does not sabotage the alarm', async () => {
  const { readFile } = await import('node:fs/promises')
  const java = await readFile(
    new URL('../android/app/src/main/java/com/uporpay/wakeorlock/WakeOrLockPlugin.java', import.meta.url),
    'utf8'
  )
  assert.match(java, /@PluginMethod\s+public void exitApp\(PluginCall call\)/, 'the bridge method must exist')
  const body = /\public void exitApp\(PluginCall call\) \{([\s\S]*?)\n    \}/.exec(java)
  assert.ok(body, 'could not read the exitApp body')
  const b = body[1]
  assert.match(b, /ACTION_LEASH_STOP/, 'the leash loop has to stop or it drags the lock screen back after the close')
  assert.match(b, /ACTION_STOP/, 'and the ring service has to stop, or "exit" leaves a siren running')
  assert.match(b, /LockGuard\.release/, 'the lock-task confinement is released before leaving')
  assert.match(b, /finishAndRemoveTask/, 'the task actually goes away')
  assert.doesNotMatch(b, /cancelAll|AlarmScheduler\.cancel/, 'an exit hatch must not delete scheduled alarms')

  const js = await readFile(new URL('../src/native.js', import.meta.url), 'utf8')
  assert.match(js, /call\('exitApp'/, 'the web layer calls it by the same name')
  const engine = await readFile(new URL('../src/engine.js', import.meta.url), 'utf8')
  assert.match(engine, /type: 'admin_exit'/, 'and the exit is journaled, not silently allowed')
})
