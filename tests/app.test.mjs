// Headless integration test: jsdom + the real engine. This exercises the whole
// loop — fire → accept → capture → pass/fail → lock → release — without a
// browser, so the state machine and every view's render() stay honest.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toasts"></div></body></html>', {
  url: 'https://localhost/',
  pretendToBeVisual: true,
})

let logic, engine, views

before(async () => {
  const define = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    } catch {
      globalThis[key] = value
    }
  }
  define('window', dom.window)
  define('document', dom.window.document)
  define('navigator', dom.window.navigator)
  define('location', dom.window.location)
  define('history', dom.window.history)
  define('localStorage', dom.window.localStorage)
  define('requestAnimationFrame', (cb) => setTimeout(() => cb(0), 0))
  define('cancelAnimationFrame', clearTimeout)

  logic = await import('../src/logic.js')
  ;({ engine } = await import('../src/engine.js'))
  views = {
    home: await import('../views/home.js'),
    alarms: await import('../views/alarms.js'),
    mission: await import('../views/mission.js'),
    lock: await import('../views/lock.js'),
    journal: await import('../views/journal.js'),
    settings: await import('../views/settings.js'),
  }
  await engine.setSettings({ demoTiming: true, testMode: true, soundOn: false, vibrateOn: false })
})

/** A synthetic video frame: bright, textured, skin-toned → passes heuristics. */
function fakeFrame(w = 64, h = 48, { dark = false } = {}) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    // pseudo-random texture: real video frames are full of edges, a blank
    // wall is not, and the subject check is allowed to tell the difference.
    const n = ((i * 2654435761) % 199) - 99
    data[i * 4] = dark ? Math.max(0, 8 + n / 8) : Math.min(229, Math.max(96, 190 + n))
    data[i * 4 + 1] = dark ? Math.max(0, 8 + n / 9) : Math.min(179, Math.max(70, 145 + n * 0.6))
    data[i * 4 + 2] = dark ? Math.max(0, 10 + n / 10) : Math.min(129, Math.max(30, 105 + n * 0.4))
    data[i * 4 + 3] = 255
  }
  return { data, width: w, height: h }
}

/** Fast-forward any lingering celebration/lockout screen so a test can start clean. */
async function idle() {
  for (let i = 0; i < 16 && engine.episode; i++) {
    const ep = engine.episode
    // Walk the state machine to its end instead of poking internals: a live
    // mission is blown up into a lockout, and a lockout is run out.
    if (ep.phase === 'ringing' || ep.phase === 'mission') ep.missionDeadlineAt = Date.now() - 1
    else if (ep.phase === 'locked') ep.lockUntil = Date.now() - 1
    else if (ep.phase === 'success') ep.clearAt = Date.now() - 1
    else engine.episode = null
    await settle()
  }
  assert.equal(engine.episode, null, 'episode should have been cleared')
}

async function settle(times = 3) {
  for (let i = 0; i < times; i++) {
    engine.tick()
    await new Promise((r) => setImmediate(r))
  }
}

test('every screen renders without throwing, empty and loaded', () => {
  const state = engine.snapshot()
  for (const [name, view] of Object.entries(views)) {
    const html = view.render(state)
    assert.ok(typeof html === 'string' && html.length > 0, `${name} rendered empty`)
  }
})

test('the ring screen offers exactly one way out, and it is not a dismiss', () => {
  const html = views.mission.renderRing({ ...engine.snapshot(), episode: fakeEpisode() })
  assert.match(html, /I'M AWAKE — START MISSION/)
  assert.doesNotMatch(html, /data-snooze|data-dismiss|data-stop|data-skip/i)
  assert.ok(html.includes('data-awake'))
})

const fakeEpisode = () => ({
  label: 'Test',
  firedAt: Date.now(),
  ringDeadlineAt: Date.now() + 5000,
  missionDeadlineAt: Date.now() + 30_000,
  captures: [],
  mode: null,
  phase: 'ringing',
})

test('outside mission: scenery shot + pose selfie clears the episode', async () => {
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Outside test', missionMode: 'outside' })
  await settle()
  assert.equal(engine.episode.phase, 'ringing')

  await engine.acceptMission('outside')
  assert.equal(engine.episode.phase, 'mission')

  const first = await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,x',
    live: true,
    simulated: false,
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
    location: null,
    sleepLocation: null,
  })
  assert.equal(first.ok, true, JSON.stringify(first.checks?.map((c) => [c.label, c.ok])))
  assert.equal(first.done, false)
  assert.equal(engine.episode.captures.length, 1)

  const second = await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,y',
    live: true,
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
  })
  assert.equal(second.done, true)
  assert.equal(engine.episode.phase, 'success')
  assert.equal(engine.snapshot().strikes, 0, 'a success must clear the ladder')
})

test('indoor mission enforces the spacing between photos', async () => {
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Indoor test', missionMode: 'inside' })
  await settle()
  await engine.acceptMission('inside')
  const ep = engine.episode
  const s = engine.settings

  // one accepted...
  const r1 = await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,1',
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
  })
  assert.equal(r1.ok, true)
  assert.equal(ep.captures.length, 1)

  // ...immediately trying a second must be rejected for spacing
  const r2 = await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,2',
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
  })
  assert.equal(r2.ok, false, 'shots closer together than the spacing must not count')
  assert.equal(ep.captures.length, 1)
  const spacingCheck = r2.checks.find((c) => c.label.includes('since previous shot'))
  assert.equal(spacingCheck.ok, false)

  // demo skip rewinds the clock, then the remaining two go through
  await engine.rewindSpacingForDemo()
  await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,3',
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
  })
  await engine.rewindSpacingForDemo()
  await engine.submitCapture({
    imageData: fakeFrame(),
    dataUrl: 'data:image/jpeg;base64,4',
    holdDiff: 0,
    holdMs: logic.POSE_HOLD_MS,
    requiredHoldMs: logic.POSE_HOLD_MS,
  })
  assert.equal(engine.episode.phase, 'success')
  void s
})

test('a dark frame is rejected by the subject check even in test mode', async () => {
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Dark room', missionMode: 'inside' })
  await settle()
  await engine.acceptMission('inside')
  const { verifySubject, analyzeImageData } = await import('../src/verify.js')
  const stats = analyzeImageData(fakeFrame(64, 48, { dark: true }))
  assert.equal(verifySubject({ stats }).ok, false, 'a black frame should never pass as a selfie')
})

test('ignoring the alarm past the deadline locks the phone', async () => {
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Overslept', missionMode: 'inside' })
  await settle()
  assert.equal(engine.episode.phase, 'ringing')
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'locked')
  assert.ok(engine.episode.lockUntil > Date.now())
  assert.equal(engine.snapshot().strikes >= 1, true)
  // and the lock screen says so
  const html = views.lock.render(engine.snapshot())
  assert.match(html, /Phone locked/)
  assert.match(html, /Emergency call only/)
})

test('a lockout survives a reload and cannot be dismissed early', async () => {
  const ep = engine.episode
  assert.equal(ep.phase, 'locked')
  const before = ep.lockUntil
  // simulate boot: read the persisted episode and resume it
  engine._resumeEpisode()
  await settle()
  assert.equal(engine.episode.phase, 'locked', 'resuming must keep you locked')
  assert.equal(engine.episode.lockUntil, before)
})

test('when the lock timer runs out you are let go and the record shows it', async () => {
  engine.episode.lockUntil = Date.now() - 1
  await settle()
  assert.equal(engine.episode, null)
  const types = engine.events.slice(-2).map((e) => e.type)
  assert.ok(types.includes('released'), `expected a release event, got ${types.join(',')}`)
})

test('panic release is off by default and costs a strike when enabled', async () => {
  assert.equal(engine.settings.panicReleaseEnabled, false)
  await engine.recordManualLock(30)
  assert.equal(engine.episode.phase, 'locked')
  await engine.panicRelease()
  assert.equal(engine.episode.phase, 'locked', 'no panic button wired while the setting is off')
  await engine.setSettings({ panicReleaseEnabled: true })
  await engine.panicRelease()
  assert.equal(engine.episode, null)
  await engine.setSettings({ panicReleaseEnabled: false })
})

test('one-shot alarms disable themselves once survived, daily ones stay', async () => {
  const daily = await engine.upsertAlarm({ time: '06:30', label: 'Daily', days: [0, 1, 2, 3, 4, 5, 6] })
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'OneShot', missionMode: 'outside' })
  await settle()
  await engine.acceptMission('outside')
  for (const step of [0, 1]) {
    await engine.submitCapture({
      imageData: fakeFrame(),
      dataUrl: 'data:image/jpeg;base64,o',
      holdDiff: 0,
      holdMs: logic.POSE_HOLD_MS,
      requiredHoldMs: logic.POSE_HOLD_MS,
    })
  }
  engine.episode.clearAt = Date.now() - 1
  await settle()
  const oneShot = engine.alarms.find((a) => a.label === 'OneShot')
  assert.equal(oneShot.enabled, false, 'trial alarms must not keep firing')
  assert.equal(engine.alarms.find((a) => a.id === daily.id).enabled, true)
})

test('the settings screen exposes the escape-hatch switches it documents', () => {
  const html = views.settings.render(engine.snapshot())
  for (const needle of ['Demo timing', 'Panic release', 'Test mode', 'What this build cannot do']) {
    assert.ok(html.includes(needle), `missing "${needle}"`)
  }
})

// ---------------------------------------------------------------------------
// Invariants that must hold in the source, not just at runtime: the whole
// product rests on "there is no way out", so a regression here is a feature bug.
// ---------------------------------------------------------------------------

test('no file picker exists anywhere in the capture path (gallery upload is the obvious cheat)', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const file of ['views/mission.js', 'src/camera.js', 'src/engine.js']) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /type=["']file["']/, `${file} offers a file input`)
    assert.doesNotMatch(src, /showOpenFilePicker|webkitdirectory/, `${file} offers a picker`)
  }
})

test('the ring screen has no dismiss, skip, or cancel affordance', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../views/mission.js', import.meta.url), 'utf8')
  const ring = src.slice(src.indexOf('renderRing'), src.indexOf('export async function mountRing'))
  for (const bad of ['dismiss', 'snooze', 'cancel', 'stop', 'skip', 'close']) {
    assert.ok(!new RegExp(`data-[a-z-]*${bad}`, 'i').test(ring), `ring screen exposes "${bad}"`)
  }
})

test('the pose library is usable as-is: unique ids, instructions, 12+ options', () => {
  const ids = new Set(logic.POSES.map((p) => p.id))
  assert.equal(ids.size, logic.POSES.length, 'duplicate pose ids')
  assert.ok(logic.POSES.length >= 12, 'too few poses — a repeatable pose is a dodgeable pose')
  for (const p of logic.POSES) {
    assert.ok(p.label.length > 12, `${p.id} has no real instruction`)
    assert.match(p.emoji, /\S/)
  }
})

test('a delayed trial alarm is cancellable and does not linger in the list', async () => {
  await idle()
  const before = engine.alarms.length
  const test = await engine.forceFire({ minutesOut: 0.05, label: 'Cancellable trial' })
  assert.equal(engine.episode, null, 'a delayed trial must not start immediately')
  assert.equal(engine.alarms.length, before + 1)
  await engine.deleteAlarm(test.id)
  engine.tick()
  assert.equal(engine.episode, null, 'deleting the row must cancel the pending ring')
})

test('episodes are persisted before the transition takes effect', async () => {
  await engine.forceFire({ minutesOut: 0, label: 'Persist test', missionMode: 'inside' })
  await settle()
  const { get } = await import('../src/db.js')
  const stored = await get('episodes', 'active')
  assert.ok(stored, 'active episode must be readable from storage')
  assert.equal(stored.phase, 'ringing')
  assert.equal(stored.missionDeadlineAt > stored.firedAt, true)
  await idle()
})
