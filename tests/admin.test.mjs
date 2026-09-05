// The admin lease must change what the ENGINE does, not just what a screen
// shows. Everything here runs through the state machine, with the UI off.
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><body><div id="app"></div><div id="toasts"></div>', { url: 'https://localhost/', pretendToBeVisual: true })
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

let logic, engine, admin

before(async () => {
  logic = await import('../src/logic.js')
  ;({ engine } = await import('../src/engine.js'))
  admin = await import('../views/admin.js')
  await engine.setSettings({ demoTiming: true, testMode: true, soundOn: false, vibrateOn: false })
  await engine.lockAdmin()
})

const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    engine.tick()
    await new Promise((r) => setImmediate(r))
  }
}

async function idle() {
  for (let i = 0; i < 16 && engine.episode; i++) {
    const ep = engine.episode
    if (ep.phase === 'ringing' || ep.phase === 'mission') ep.missionDeadlineAt = Date.now() - 1
    else if (ep.phase === 'locked') ep.lockUntil = Date.now() - 1
    else if (ep.phase === 'success') ep.clearAt = Date.now() - 1
    else engine.episode = null
    await settle()
  }
}

function frame(w = 48, h = 36) {
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

const darkFrame = (w = 48, h = 36) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })

test('no admin lease → the lockout is the default, and the gate is what renders', async () => {
  assert.equal(logic.adminActive(engine.settings), false)
  const html = admin.render(engine.snapshot())
  assert.match(html, /Admin access/)
  assert.match(html, /0000/) // factory PIN is printed until it is changed
  assert.doesNotMatch(html, /Overrides in force/)

  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'No admin', missionMode: 'inside' })
  await settle()
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'locked', 'without a lease the punishment stands')
  await idle()
})

test('wrong PIN does not open the lease; the right one does', async () => {
  assert.equal(await engine.unlockAdmin('1234'), false)
  assert.equal(logic.adminActive(engine.settings), false)
  assert.equal(await engine.unlockAdmin(engine.settings.adminPin), true)
  assert.equal(logic.adminActive(engine.settings), true)
})

test('with god mode on, blowing the deadline bypasses instead of locking', async () => {
  await engine.setSettings({ adminGodMode: true })
  await idle()
  const strikesBefore = logic.strikesFromEvents(engine.events)
  await engine.forceFire({ minutesOut: 0, label: 'God mode', missionMode: 'inside' })
  await settle()
  assert.equal(engine.episode.phase, 'ringing')
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'success', 'episode must close without a lockout')
  const last = engine.events.at(-1)
  assert.equal(last.type, 'bypass')
  assert.equal(last.admin, true)
  assert.equal(logic.strikesFromEvents(engine.events), strikesBefore, 'a bypass cannot move the ladder')
  await idle()
})

test('turn god mode off again and the very same run locks you out', async () => {
  await engine.setSettings({ adminGodMode: false })
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Teeth back', missionMode: 'inside' })
  await settle()
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'locked')
  await engine.setSettings({ adminGodMode: true })
  await idle()
})

test('auto-pass accepts a mumbled line, but records that it did', async () => {
  await engine.setSettings({ adminAutoPass: true })
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Auto pass', missionMode: 'inside' })
  await settle()
  await engine.acceptMission('inside')
  // score 0 = the recogniser heard nothing worth counting
  const r = await engine.submitCapture({ transcript: '', score: 0, missing: ['all', 'of', 'it'], peak: 0.42, seconds: 4 })
  assert.equal(r.ok, true, 'auto-pass accepts anything')
  const failed = r.checks.filter((c) => !c.ok && !c.autoPassed)
  assert.ok(failed.length === 0, 'every failing check must be marked auto-passed')
  const auto = r.checks.filter((c) => c.autoPassed)
  assert.equal(auto.length, 1, `exactly the one failing check should be marked as skipped: ${JSON.stringify(r.checks.map((c) => [c.label, c.ok]))}`)
  assert.match(auto[0].label, /Said the line/)
  assert.ok(auto[0].reasons.length, 'the skipped reason must still say what it rejected')
  await engine.setSettings({ adminAutoPass: false })
})

test('instant spacing lets all indoor lines fire back-to-back', async () => {
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Spacing off', missionMode: 'inside' })
  await settle()
  await engine.acceptMission('inside')
  const before = engine.settings.adminInstantSpacing
  await engine.setSettings({ adminInstantSpacing: true })
  const proof = { transcript: 'I am standing up and I said the whole line', score: 1, missing: [], peak: 0.42, seconds: 5 }
  // without the switch the second line would be refused for the missing gap
  for (let i = 0; i < engine.settings.insideLines; i++) {
    const r = await engine.submitCapture(proof)
    assert.equal(r.ok, true, `line ${i + 1} rejected: ${JSON.stringify(r.checks?.filter((c) => !c.ok && !c.autoPassed).map((c) => c.label))}`)
  }
  assert.equal(engine.episode.phase, 'success', 'three lines in one second should clear the mission')
  await engine.setSettings({ adminInstantSpacing: before, adminAutoPass: false })
})

test('a preview lockout never touches the ladder, and the lease can end it', async () => {
  await idle()
  const before = logic.strikesFromEvents(engine.events)
  await engine.previewLock(30)
  assert.equal(engine.episode.phase, 'locked')
  assert.equal(engine.episode.adminPreview, true)
  const html = admin.render(engine.snapshot())
  assert.match(html, /Punishment lab/)
  assert.ok((await import('../views/lock.js')).render({ ...engine.snapshot(), now: Date.now() }).includes('Admin override'))
  const cleared = await engine.clearLockPreview()
  assert.equal(cleared, true)
  assert.equal(engine.episode, null)
  assert.equal(logic.strikesFromEvents(engine.events), before)
})

test('strike grants and revocations move the ladder for real', async () => {
  await idle()
  const start = logic.strikesFromEvents(engine.events)
  const wokeBefore = engine.events.filter((e) => e.type === 'woke').length
  await engine.adjustStrikes(2)
  assert.equal(logic.strikesFromEvents(engine.events), start + 2)
  // A negative grant cannot rewind a derived counter, so it resets it — and it
  // must not be recorded as a successful wake-up, or the streak would lie.
  await engine.adjustStrikes(-2)
  assert.equal(logic.strikesFromEvents(engine.events), 0)
  const tail = engine.events.slice(-3).map((e) => e.type)
  assert.ok(tail.includes('strike_reset'), `expected a strike_reset entry, got ${tail.join(',')}`)
  assert.equal(engine.events.filter((e) => e.type === 'woke').length - wokeBefore, 0, 'a reset must not pose as a win')
  await engine.adjustStrikes(1)
  assert.equal(logic.strikesFromEvents(engine.events), 1)
})

test('the lease expires on its own and re-arms the punishment', async () => {
  await engine.setSettings({ adminLeaseMinutes: 1, adminUnlockedAt: Date.now() - 2 * 60_000 })
  assert.equal(logic.adminActive(engine.settings), false, 'an expired lease is no lease')
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Expired lease', missionMode: 'inside' })
  await settle()
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'locked', 'expiry must genuinely re-arm the lockout')
  await idle()
})

test('admin events are journaled so a test run cannot pose as a clean streak', () => {
  const types = engine.events.map((e) => e.type)
  for (const t of ['admin_on', 'bypass', 'admin']) {
    assert.ok(types.includes(t), `expected a "${t}" entry in the journal`)
  }
})

test('typing the PIN into the gate is what flips it — not a flag in the DOM', async () => {
  await engine.setSettings({ adminUnlockedAt: null })
  const host = dom.window.document.getElementById('app')

  host.innerHTML = admin.render(engine.snapshot())
  await admin.mount(host, engine.snapshot())
  assert.match(host.innerHTML, /Admin access/)

  // three wrong attempts must cool the console down, not quietly accept
  const submit = () => host.querySelector('#pin-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
  const type = async (v) => {
    host.querySelector('#pin').value = v
    submit()
    await new Promise((r) => setTimeout(r, 30))
  }
  await type('1111')
  assert.equal(logic.adminActive(engine.settings), false)
  await type('2222')
  assert.equal(logic.adminActive(engine.settings), false)
  await type('3333')
  assert.equal(logic.adminActive(engine.settings), false, 'three misses opened it anyway')

  // cool-down blocks even the correct PIN — the console cannot be brute-forced
  await type(engine.settings.adminPin)
  assert.equal(logic.adminActive(engine.settings), false, 'blocked console still accepted input')

  // after the cool-down, unlocking programmatically proves the console renders
  await engine.unlockAdmin(engine.settings.adminPin)
  host.innerHTML = admin.render(engine.snapshot())
  await admin.mount(host, engine.snapshot())
  assert.match(host.innerHTML, /Overrides in force/)
  assert.match(host.innerHTML, /No lockouts/)
  assert.match(host.innerHTML, /Punishment lab/)
  assert.doesNotMatch(host.innerHTML, /Admin access/, 'console must replace the gate')
})

test('signing out re-arms the lockout at the engine level', async () => {
  assert.equal(logic.adminActive(engine.settings), true)
  await engine.lockAdmin()
  assert.equal(logic.adminActive(engine.settings), false)
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'After sign-out', missionMode: 'inside' })
  await settle()
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'locked')
  await idle()
})

test('the bypass screen tells the truth about what just happened', async () => {
  await engine.unlockAdmin(engine.settings.adminPin)
  await engine.setSettings({ adminGodMode: true })
  await idle()
  await engine.forceFire({ minutesOut: 0, label: 'Bypass copy', missionMode: 'inside' })
  await settle()
  engine.episode.missionDeadlineAt = Date.now() - 1
  await settle()
  assert.equal(engine.episode.phase, 'success')
  assert.equal(engine.episode.outcome, 'bypassed')
  const { render } = await import('../views/home.js')
  const html = render(engine.snapshot())
  assert.match(html, /Admin lease active/)
  assert.match(html, /nothing happened|Admin override/i)
  await idle()
})
