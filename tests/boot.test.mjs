// Boots the real app entrypoint (src/app.js) inside jsdom and checks the shell
// comes up clean: no thrown exceptions, nav present, a seeded alarm, and the
// full takeover sequence — ring → chooser → lock — painting into #screen.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(
  '<!doctype html><html><body><div id="app" class="app"></div><div id="toasts" class="toasts"></div></body></html>',
  { url: 'https://localhost/', pretendToBeVisual: true }
)

const define = (k, v) => {
  try {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
  } catch {
    globalThis[k] = v
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

const errors = []
dom.window.addEventListener('error', (e) => errors.push(String(e.message)))
const origError = console.error
console.error = (...a) => {
  errors.push(a.map(String).join(' '))
  origError(...a)
}

const { engine } = await import('../src/engine.js')
await import('../src/app.js')

after(async () => {
  engine.stop()
  await new Promise((r) => setTimeout(r, 50))
  dom.window.close()
})

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setTimeout(r, 20))
    engine.tick()
  }
}

test('shell boots with nav, brand and a screen', async () => {
  await tick(10)
  const html = dom.window.document.getElementById('app').innerHTML
  assert.match(html, /Wake or Lock/)
  assert.match(html, /class="nav"/)
  const links = [...dom.window.document.querySelectorAll('.nav a')]
  assert.deepEqual(
    links.map((a) => a.textContent.trim()),
    ['⏰Home', '🔔Alarms', '📖Journal', '⚙️Settings', '🔐Admin'],
    'nav is the four app tabs plus the admin door'
  )
  assert.equal(errors.length, 0, `boot errors: ${errors.join(' | ')}`)
})

test('first run seeds a weekday 07:00 alarm', async () => {
  const alarm = engine.alarms.find((a) => a.days.join() === '1,2,3,4,5')
  assert.ok(alarm, 'a default alarm should exist on a clean install')
  assert.equal(alarm.time, '07:00')
})

test('the ring takeover replaces the shell UI and holds exactly one button', async () => {
  await engine.forceFire({ minutesOut: 0, label: 'Boot test', missionMode: 'choose' })
  await tick()
  const doc = dom.window.document
  const ring = doc.querySelector('.overlay--ring')
  assert.ok(ring, 'ringing must take the screen over')
  assert.equal(ring.id, 'screen', 'the takeover is the screen itself, not a card inside it')
  assert.match(ring.innerHTML, /I'M AWAKE — START MISSION/)
  assert.equal(ring.querySelectorAll('button').length, 1, 'the ring screen must offer one action')
  assert.equal(doc.querySelector('.nav').style.display, 'none', 'nav is hidden during a takeover')
})

test('tapping awake swaps into the mission chooser, then into the capture screen', async () => {
  const doc = dom.window.document
  doc.querySelector('[data-awake]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await tick(8)
  assert.equal(engine.episode.phase, 'mission')
  assert.ok(engine.episode.mode === null || engine.episode.mode === 'choose', 'mode must still be pending')

  assert.ok(doc.querySelector('.overlay--mission') ?? doc.body.innerHTML.includes('Pick your escape'))

  const outside = [...doc.querySelectorAll('[data-mode]')].find((b) => b.dataset.mode === 'outside')
  assert.ok(outside, 'outside option rendered')
  outside.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await tick(10)
  assert.equal(engine.episode.mode, 'outside')
  assert.ok(doc.querySelector('#cam'), 'the mission screen mounts a live camera element')
  assert.ok(doc.querySelector('#scene-btn'), 'the scene hold button is present')
  // The proof is a hold, not a shutter: there is no capture button anywhere.
  assert.equal(doc.querySelector('#shutter'), null, 'no shutter may exist — nothing is photographed')
  assert.doesNotMatch(doc.querySelector('.mission').innerHTML, /type=["']file["']/)
  assert.match(doc.querySelector('.m-body').innerHTML, /Point it at the room or the street/)
})

test('a blown deadline repaints into the lock screen without a reload', async () => {
  engine.episode.missionDeadlineAt = Date.now() - 1
  await tick(10)
  assert.equal(engine.episode.phase, 'locked')
  const lock = dom.window.document.querySelector('.overlay--lock')
  assert.ok(lock, 'lock overlay must mount by itself')
  assert.match(lock.innerHTML, /Phone locked/)
  const cd = lock.querySelector('[data-cd]')
  // demo timing prints sub-minute remainders as "59.8s", real timing as MM:SS
  assert.ok(
    /^\d{2}:\d{2}$|^\d+(\.\d)?s$/.test(cd.textContent.trim()),
    `countdown text not patched: "${cd.textContent}"`
  )
  assert.match(lock.innerHTML, /Strike 1/)
  assert.equal(errors.length, 0, `runtime errors: ${errors.join(' | ')}`)
})

test('the lock counts down to release and hands the shell back', async () => {
  engine.episode.lockUntil = Date.now() - 1
  await tick(10)
  assert.equal(engine.episode, null)
  const doc = dom.window.document
  assert.equal(doc.querySelector('.overlay--lock'), null, 'lock overlay must be gone')
  assert.notEqual(doc.querySelector('.nav').style.display, 'none', 'nav returns')
})

test('the staged bundle and the APK both say which commit they are', async () => {
  // A build is handed around over chat and installed over itself, so it has to be
  // identifiable from inside the app — a filename in Downloads is not a version,
  // and `versionCode 1` forever eventually makes Android refuse the new build.
  const { readFile } = await import('node:fs/promises')
  const json = JSON.parse(await readFile(new URL('../www/native.json', import.meta.url), 'utf8'))
  assert.equal(json.native, true, 'the marker only ships in the staged bundle')
  assert.match(json.rev, /^[0-9a-f]{7,40}$/, 'the bundle carries the commit it was built from')
  assert.equal(typeof json.builtAt, 'string')

  const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8')
  assert.match(gradle, /GITHUB_RUN_NUMBER/, 'versionCode comes from CI, not from a hand-edit')
  assert.match(gradle, /versionName "1\.0\." \+/, 'versionName is derived too')
  assert.doesNotMatch(gradle, /^\s*versionCode 1\s*$/m, 'no frozen versionCode')

  // and the settings sheet reads it back out
  const { nativeInfo } = await import('../src/native.js')
  assert.ok('rev' in nativeInfo(), 'the bridge surfaces the stamp even where the native plugin is absent')
})
