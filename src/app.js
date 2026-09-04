// ---------------------------------------------------------------------------
// app.js — shell, router, and the escalation of overlays.
//
// Overlay priority is absolute: a lockout outranks everything, then the ring,
// then the mission. There is no navigation affordance rendered inside an
// overlay, and while one is up the browser back button is re-pushed. That is
// as close to "you cannot leave this screen" as a web app can honestly get —
// see docs/NATIVE.md for the version that is truly inescapable.
// ---------------------------------------------------------------------------

import * as logic from './logic.js'
import { engine, PHASE } from './engine.js'
import { esc, patchTimers, toast } from './ui.js'
import { alarmSound } from './audio.js'
import * as Home from '../views/home.js'
import * as Alarms from '../views/alarms.js'
import * as Mission from '../views/mission.js'
import * as Lock from '../views/lock.js'
import * as Journal from '../views/journal.js'
import * as Settings from '../views/settings.js'
import * as Admin from '../views/admin.js'

const ROUTES = {
  '': { view: Home, label: 'Home', icon: '⏰' },
  '#/alarms': { view: Alarms, label: 'Alarms', icon: '🔔' },
  '#/journal': { view: Journal, label: 'Journal', icon: '📖' },
  '#/settings': { view: Settings, label: 'Settings', icon: '⚙️' },
}

// Mission is reachable by hash while an episode is live; otherwise it's a card.
const MISSION_ROUTE = '#/mission'
const ADMIN_ROUTE = '#/admin'

const app = document.getElementById('app')
let current = null // { key, view, mountPromise }
let lastSig = null

/**
 * Screen identity. Kept coarse on purpose: a re-render tears down the DOM, and
 * the mission screen holds a live camera stream — so per-capture changes must
 * be patched inside the view (Mission.tick → updatePanels), not re-mounted.
 */
function overlayFor(state) {
  const ep = state.episode
  if (!ep) return null
  if (ep.phase === PHASE.LOCKED) return { key: 'lock', view: Lock }
  if (ep.phase === PHASE.RINGING) return { key: 'ring', view: { render: Mission.renderRing, mount: Mission.mountRing } }
  if (ep.phase === PHASE.MISSION) return { key: `mission:${ep.mode ?? 'nomode'}`, view: Mission }
  if (ep.phase === PHASE.SUCCESS) return { key: `success:${ep.clearAt}`, view: Success }
  return null
}

function shell(activeRoute, state) {
  const admin = logic.adminActive(state.settings)
  const items = [
    ...Object.entries(ROUTES).map(([hash, r]) => ({ ...r, hash })),
    { hash: ADMIN_ROUTE, label: 'Admin', icon: admin ? '🔓' : '🔐', view: Admin, admin: true },
  ]
  const nav = items
    .map((r) => {
      const isHome = r.hash === ''
      const href = isHome ? '#/' : r.hash
      const active = isHome ? activeRoute === '' || !ROUTES[activeRoute] : activeRoute === r.hash
      return `<a href="${href}" class="${active ? 'active' : ''} ${r.admin && admin ? 'alert' : ''}" ${
        r.admin ? 'data-nav-admin' : ''
      }><span class="ico">${r.icon}</span>${r.label}</a>`
    })
    .join('')
  const cols = items.length

  return `
    <div class="brand">
      <div class="brand-mark" data-brand-hold>🔒</div>
      <div class="grow">
        <h1>Wake or Lock</h1>
        <small>no snooze · no gallery · no early release</small>
      </div>
      ${admin ? `<span class="pill demo" data-brand-hold title="Admin lease active">🔓 admin</span>` : ''}
      ${state.strikes ? `<span class="pill hot" data-brand-hold>${state.strikes} strike${state.strikes > 1 ? 's' : ''}</span>` : admin ? '' : '<span class="pill" data-brand-hold>clean</span>'}
    </div>
    <main id="screen"></main>
    <nav class="nav" style="grid-template-columns:repeat(${cols},1fr)">${nav}</nav>
  `
}

/** Shown for a few seconds after a mission is completed, then it's just your day. */
const Success = {
  render(state) {
    const ep = state.episode
    if (ep.outcome === 'bypassed') {
      return `
      <div class="overlay" style="background:linear-gradient(180deg,#171006,#08070a);justify-content:center">
        <div class="center">
          <div style="font-size:56px">🛡</div>
          <div style="font-size:22px;font-weight:800;margin-top:8px">Admin bypass</div>
          <div class="small muted" style="margin-top:8px">The deadline passed and the engine let you go.<br/>Logged as <b>bypass</b> — no strike, no lockout, and this run does not count as a win.</div>
          <div class="card" style="margin-top:20px;text-align:left">
            <div class="tiny muted">Turn the teeth back on in <a href="#/admin" style="color:var(--warn)">Admin</a> → sign out, or flip <b>No lockouts</b> off. A lease that never expires is a hobby, not an alarm clock.</div>
          </div>
        </div>
      </div>`
    }
    return `
    <div class="overlay" style="background:radial-gradient(700px 520px at 50% 20%, rgba(48,209,88,.28), transparent 62%), linear-gradient(180deg,#04140a,#05070a);justify-content:center">
      <div class="center">
        <div style="font-size:64px">🌅</div>
        <div style="font-size:24px;font-weight:800;margin-top:10px">You're up.</div>
        <div class="small muted" style="margin-top:8px">${ep.captures.length} proof photo(s) · ${logic.formatDuration(Date.now() - ep.firedAt)} from first buzz to done.</div>
        <div class="card" style="margin-top:22px;text-align:left">
          <div class="tiny muted">Streaks are cheap and strikes are not. You reset the ladder to zero${
            state.strikes === 0 ? ' — it is now empty.' : '.'
          }</div>
        </div>
        <div class="tiny muted" style="margin-top:16px">Closing this screen in a moment…</div>
      </div>
    </div>`
  },
  mount() {},
  unmount() {},
}

async function render(force = false) {
  const state = engine.snapshot()
  const overlay = overlayFor(state)
  const route = location.hash === '#/' || !location.hash ? '' : location.hash
  const routeDef =
    ROUTES[route] ??
    (route === MISSION_ROUTE ? { view: Mission, label: 'Mission' } : route === ADMIN_ROUTE ? { view: Admin, label: 'Admin' } : Home)

  const key = overlay ? overlay.key : `route:${route}`
  const view = overlay ? overlay.view : routeDef.view
  const stableSig = `${key}|${state.strikes}|${state.streak}|${state.events.length}|${state.lastOutcome?.at ?? 0}|${route}|${fingerprint(state)}`
  const dynSig = view.signature ? view.signature(state) : String(state.nextAlarmAt ?? 0)
  const sig = `${stableSig}|${dynSig}`

  if (!force && sig === lastSig && current) {
    const root = current.root
    patchTimers(root, state.now, state.settings)
    current.view?.tick?.(root, state)
    return
  }
  lastSig = sig

  current?.view?.unmount?.()
  app.innerHTML = shell(route, state)
  const root = app.querySelector('#screen') ?? app
  current = { key, view, root, overlay }
  root.innerHTML = view.render(state)
  await view.mount?.(root, state)
  patchTimers(root, state.now, state.settings)
  view.tick?.(root, state)

  const nav = app.querySelector('.nav')
  if (nav) nav.style.display = overlay ? 'none' : 'grid'

  document.title = overlay
    ? overlay.key === 'lock'
      ? `🔒 LOCKED — ${logic.formatCountdown(Math.max(0, state.episode.lockUntil - Date.now()))}`
      : `⏰ ${state.episode.phase === 'ringing' ? 'WAKE UP!' : 'MISSION LIVE'} — Wake or Lock`
    : 'Wake or Lock'
}

// ---------------------------------------------------------------------------
// Hardening: single owner across tabs, back-button trap, leave-a-warning.
// ---------------------------------------------------------------------------

/** Anything the screens print verbatim: alarms, settings, episode progress. */
function fingerprint(state) {
  const ep = state.episode
  return [
    state.alarms.map((a) => `${a.id}:${a.enabled ? 1 : 0}:${a.time}:${a.missionMode}:${a.label}`).join(','),
    JSON.stringify(state.settings),
    ep ? `${ep.phase}:${ep.mode ?? '-'}:${ep.captures.length}:${ep.failedAttempts ?? 0}` : '-',
  ].join('|')
}

async function claimSingleton() {
  if (!navigator.locks?.request) return true
  let owner = false
  navigator.locks.request({ name: 'wake-or-lock', mode: 'exclusive' }, () => {
    owner = true
    return new Promise(() => {}) // hold forever
  })
  await new Promise((r) => setTimeout(r, 220))
  return owner
}

/** Hold the brand mark ~0.7 s → admin door. Also reachable from the nav. */
function brandDoor() {
  let timer = null
  const fire = () => {
    clearTimeout(timer)
    timer = null
    location.hash = ADMIN_ROUTE
  }
  app.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-brand-hold]')) return
    timer = setTimeout(fire, 700)
  })
  const cancel = () => timer && clearTimeout(timer)
  app.addEventListener('pointerup', cancel)
  app.addEventListener('pointercancel', cancel)
  app.addEventListener('pointermove', (e) => {
    if (!timer) return
    if (e.pointerType === 'mouse') return
    cancel()
  })
}

function traps() {
  window.addEventListener('popstate', () => {
    const st = engine.snapshot()
    const overlay = overlayFor(st)
    if (overlay && overlay.key !== 'mission:normal') history.pushState({ wol: overlay.key }, '')
  })

  window.addEventListener('beforeunload', (e) => {
    const ep = engine.episode
    if (ep && (ep.phase === PHASE.RINGING || ep.phase === PHASE.MISSION)) {
      e.preventDefault()
      e.returnValue = ''
    }
    alarmSound.stop()
  })

  document.addEventListener('visibilitychange', () => {
    // resume(), not tick(): in the APK an alarm can go off while the WebView is
    // suspended, and the receipt for that lives on the Android side.
    if (document.visibilityState === 'visible') engine.resume()
  })

  document.addEventListener('keydown', (e) => {
    // Esc must never close a takeover screen.
    const ep = engine.episode
    if (e.key === 'Escape' && ep && (ep.phase === PHASE.RINGING || ep.phase === PHASE.LOCKED)) {
      e.preventDefault()
      toast(ep.phase === 'locked' ? 'There is nothing to escape to.' : 'Tap the green button and do the mission.', 'bad', 1600)
    }
  })
}

// ---------------------------------------------------------------------------

async function boot() {
  app.innerHTML = `<div class="empty" style="padding-top:22vh"><div class="big">⏰</div><div class="small muted">Loading your consequences…</div></div>`
  const owner = await claimSingleton()
  await engine.start()
  await engine.setSettings({}) // normalise + hydrate audio flags
  if (engine.settings.soundOn !== false) {
    alarmSound.enabled = engine.settings.soundOn
    alarmSound.vibrate = engine.settings.vibrateOn
  }
  engine.subscribe(() => render())
  window.addEventListener('hashchange', () => {
    lastSig = null
    render(true)
  })
  traps()
  brandDoor()
  await render(true)

  if (!owner) {
    toast('Another tab already owns the alarm clock. Close it or this one will not ring.', 'bad', 9000)
  }
  if (engine.settings.demoTiming) {
    toast('Demo timing is ON — every duration is ÷60. Turn it off in Settings for the real thing.', '', 7000)
  }
  if (!engine.alarms.length) seed()
}

async function seed() {
  await engine.upsertAlarm({
    label: 'Weekday reality',
    time: '07:00',
    days: [1, 2, 3, 4, 5],
    missionMode: 'choose',
    profile: 'siren',
    enabled: true,
  })
  toast('Created a 07:00 weekday alarm. Change it or delete it on the Alarms tab.', 'good', 5000)
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

boot()
