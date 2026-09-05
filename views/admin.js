import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, confirmSheet, openSheet, patchTimers } from '../src/ui.js'

// ---------------------------------------------------------------------------
// Admin console — the tester's account.
//
// It is a *session lease* on a PIN, not a login: there is no server here and a
// web app cannot keep a secret from its own user, so the design goal is
// "accidentally leaving god mode off/on is impossible", not "attacker-proof".
// What makes it real instead of decorative: the no-lockout decision lives in
// engine._fail() via logic.shouldLockOut(), and every override is journaled.
// ---------------------------------------------------------------------------

export function render(state) {
  const s = state.settings
  const active = logic.adminActive(s)
  if (!active) return gate(state)
  return console_(state)
}

function gate(state) {
  const defaultPin = String(state.settings.adminPin) === '0000'
  return `
  <div class="card" style="margin-top:6vh">
    <div class="center">
      <div style="font-size:40px">🔐</div>
      <div style="font-size:19px;font-weight:750;margin-top:8px">Admin access</div>
      <div class="tiny muted" style="margin-top:6px;line-height:1.55">
        Unlock a test lease: no lockouts, no strike ladder, full sandbox over the mission timers.
        It re-arms itself when the lease expires so you never wake up to a neutered alarm clock.
      </div>
      <form id="pin-form" style="margin-top:18px">
        <input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="8"
               style="text-align:center;font-family:var(--mono);font-size:24px;letter-spacing:.4em;padding:14px" />
        <button class="btn primary block lg" type="submit" style="margin-top:12px">Unlock lease</button>
      </form>
      ${defaultPin ? `<div class="tiny" style="margin-top:12px;color:var(--warn)">This build still ships the factory PIN: <b class="mono">0000</b>. Change it once you're in.</div>` : ''}
      <div class="tiny muted" style="margin-top:10px">3 wrong attempts locks the console for a minute.</div>
    </div>
  </div>
  ${
    // Debug door: never let a tester get stuck outside their own console.
    state.episode
      ? `<div class="card card--flat" style="margin-top:12px">
           <div class="tiny muted">An episode is live (<b>${esc(state.episode.phase)}</b>). Unlock above to disarm it.</div>
         </div>`
      : ''
  }`
}

function console_(state) {
  const s = state.settings
  const ep = state.episode
  const lease = logic.adminLeaseLeft(s, state.now)
  const flags = logic.adminActiveFlags(s)
  const row = (key, title, sub) => `
    <div class="toggle-row">
      <div class="txt">${title}<small>${sub}</small></div>
      <button class="switch ${s[key] ? 'on' : ''}" data-admin="${key}"></button>
    </div>`

  return `
  <div class="spread" style="margin:2px 2px 12px">
    <div>
      <div style="font-size:20px;font-weight:700">🔓 Admin lease</div>
      <div class="tiny muted">${
        Number.isFinite(lease)
          ? `<b class="mono" data-cd="${state.now + lease}"></b> left, then the app punishes you again`
          : 'no expiry — <b style="color:var(--warn)">this alarm clock is currently decorative</b>'
      }</div>
    </div>
    <button class="btn sm" data-signout>Sign out</button>
  </div>

  <div class="card card--danger">
    <div class="tiny" style="font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--hot-2)">Overrides in force</div>
    <div class="chips" style="margin-top:9px">
      ${flags.length ? flags.map((f) => `<span class="chip mode">${esc(f)}</span>`).join('') : '<span class="chip">none — you are fully exposed</span>'}
      <span class="chip">${state.strikes} strikes</span>
      <span class="chip">${state.streak} streak</span>
    </div>
    <hr class="sep" />
    ${row('adminGodMode', 'No lockouts', 'The important one. A blown mission closes as <b>bypassed</b> — no strike, no lock screen, ring stops. Enforced in engine._fail(), not in the view.')}
    ${row('adminAutoPass', 'Auto-pass captures', 'Any frame is accepted. The checks still run and their reasons are still recorded, marked auto-passed, so you can see what you skipped.')}
    ${row('adminInstantSpacing', 'Ignore line gaps', 'Say all three lines back-to-back instead of a minute apart.')}
    ${row('adminQuietRing', 'Silent ring', 'Full takeover UI, no siren, no vibration.')}
    <div class="btn-grid one" style="margin-top:12px">
      <button class="btn" data-lease="60">+1 h lease</button>
      <button class="btn" data-lease="forever">${s.adminLeaseMinutes === 0 ? 'Expiry re-armed off — click to require a PIN again' : 'Never expire (until I sign out)'}</button>
    </div>
  </div>

  <div class="section-title">Punishment lab</div>
  <div class="card">
    <div class="tiny muted">Nothing on this screen changes your record unless it says <b>real</b>. Previews are journaled as admin events.</div>
    <div class="btn-grid" style="margin-top:11px">
      <button class="btn" data-preview-lock="0.5">🔒 Preview lock 30 s</button>
      <button class="btn" data-preview-lock="2">🔒 Preview lock 2 min</button>
      <button class="btn" data-strike="+1">⬆ Strike +1 (real)</button>
      <button class="btn" data-strike="-1">⬇ Reset the ladder (real)</button>
    </div>
    <hr class="sep" />
    <div class="field">
      <label>Ladder editor — hours per strike</label>
      <input data-txt="lockHoursCurve" value="${esc(s.lockHoursCurve.join(', '))}" inputmode="numeric" />
      <div class="tiny muted">Live preview: <b>${esc(s.lockHoursCurve.map((h, i) => `${i + 1}→${h}h`).join('  '))}</b></div>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn sm grow" data-reset-curve>Reset to 1,2,4,6,9,12,18,24</button>
      <button class="btn sm grow" data-zero-strikes>Zero my strikes</button>
    </div>
  </div>

  <div class="section-title">Episode sandbox</div>
  <div class="card">
    ${
      ep
        ? `<div class="small" style="font-weight:700">${esc(ep.label)} · <span class="mono">${esc(ep.phase)}</span>${ep.mode ? ` · ${esc(ep.mode)}` : ''}</div>
           <div class="tiny muted" style="margin-top:5px">${ep.captures.length} shot(s) · deadline in <span data-cd="${ep.missionDeadlineAt}"></span> · lock would be at <span data-cd="${ep.lockUntil ?? ep.missionDeadlineAt}"></span></div>
           <div class="btn-grid" style="margin-top:11px">
             <button class="btn" data-ff="ring">⏩ Skip the buzz</button>
             <button class="btn" data-ff="deadline">⏩ Blow the deadline now</button>
             <button class="btn" data-ff="lock">⏩ Finish any lockout</button>
             <button class="btn" data-ff="abort"> Abort episode</button>
           </div>`
        : `<div class="tiny muted">No live episode. Start one:</div>
           <div class="btn-grid" style="margin-top:10px">
             <button class="btn primary" data-fire="instant">🔔 Ring now (silent)</button>
             <button class="btn" data-fire="choose">Ring now, I pick the mission</button>
             <button class="btn" data-fire="inside">Ring now, indoor mission</button>
             <button class="btn" data-fire="outside">Ring now, outside mission</button>
           </div>`
    }
    <hr class="sep" />
    <div class="tiny muted">Next poses this episode would demand — deterministic, so you can predict them but a refresh cannot reroll them:</div>
    <div class="checks" style="margin-top:8px">
      ${[0, 1, 2]
        .map((i) => {
          const p = logic.lineForStep(ep ? logic.episodeSeed(ep) : 'preview', i)
          return `<div class="check"><div>🗣</div><div class="grow"><b>${esc(p.text)}</b><div class="tiny muted">step ${i + 1}${ep ? '' : ' (fresh seed)'}</div></div></div>`
        })
        .join('')}
    </div>
  </div>

  <div class="section-title">Instrumentation</div>
  <div class="card">
    <div class="btn-grid">
      <button class="btn" data-dump>🧾 Inspect state</button>
      <button class="btn" data-export>⬇ Export everything</button>
      <button class="btn" data-test-camera>📷 Camera report</button>
      <button class="btn" data-test-sensors>📈 Sensors</button>
    </div>
    <div class="tiny muted" style="margin-top:10px">Journal so far: ${state.events.length} entries${
      state.shots.length ? `, ${state.shots.length} captures` : ''
    }. Admin actions are journaled too — a test run can never masquerade as a clean streak.</div>
  </div>

  <div class="section-title">Credentials</div>
  <div class="card">
    <div class="grid-2">
      <div class="field">
        <label>New PIN</label>
        <input id="new-pin" type="text" inputmode="numeric" maxlength="8" placeholder="${esc(s.adminPin)}" />
      </div>
      <div class="field">
        <label>Lease minutes (0 = until sign-out)</label>
        <input id="lease-min" type="number" min="0" max="10080" value="${s.adminLeaseMinutes}" />
      </div>
    </div>
    <button class="btn block" data-save-creds style="margin-top:12px">Save credentials</button>
    <div class="note" style="margin-top:11px">This PIN gates convenience, not an attacker. Anyone with the phone can read it out of IndexedDB — there is no server here and no keychain in a web app. The native build moves it behind Android Keystore + BiometricPrompt, which is what actually stops the 7 a.m. you.</div>
  </div>
  `
}

let attempts = 0
let blockedUntil = 0

export async function mount(root, state) {
  const s = state.settings
  if (!logic.adminActive(s)) {
    const form = root.querySelector('#pin-form')
    form?.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (Date.now() < blockedUntil) return toast('Console cooling down — wait it out.', 'bad')
      const pin = root.querySelector('#pin').value
      const ok = await engine.unlockAdmin(pin)
      if (ok) {
        attempts = 0
        toast('Admin lease active. The app will not lock you out.', 'good')
        engine._emit()
      } else {
        attempts++
        if (attempts >= 3) {
          blockedUntil = Date.now() + 60_000
          attempts = 0
          toast('3 misses — console blocked for 60 s.', 'bad', 5000)
        } else {
          toast(`Wrong PIN (${attempts}/3).`, 'bad')
        }
        root.querySelector('#pin').select()
      }
    })
    return
  }

  root.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-admin]')
    if (sw) {
      const key = sw.dataset.admin
      const next = !engine.settings[key]
      sw.classList.toggle('on', next)
      await engine.adminFlags({ [key]: next })
      toast(adminFlagToast(key, next), next && key === 'adminGodMode' ? 'good' : '')
      return
    }

    const lease = e.target.closest('[data-lease]')
    if (lease) {
      if (lease.dataset.lease === 'forever') {
        const nowExempt = engine.settings.adminLeaseMinutes === 0
        if (nowExempt) {
          await engine.adminFlags({ adminLeaseMinutes: 240 })
          toast('Lease expiry re-armed: 240 min.', 'good')
        } else {
          const ok = await confirmSheet({
            title: 'Never expire this lease?',
            body: 'With no expiry, <b>god mode is on forever</b> — the alarm stops having teeth until you remember to sign out. The header will keep shouting ADMIN at you.',
            confirmLabel: 'Yes, leave it open',
          })
          if (ok) await engine.adminFlags({ adminLeaseMinutes: 0 })
        }
      } else {
        const add = Number(lease.dataset.lease)
        const cur = engine.settings
        if (cur.adminLeaseMinutes === 0) return toast('This lease already never expires.', '')
        const remain = Math.max(0, cur.adminUnlockedAt + cur.adminLeaseMinutes * 60_000 - Date.now()) / 60_000
        await engine.adminFlags({ adminUnlockedAt: Date.now(), adminLeaseMinutes: Math.ceil(remain) + add })
        toast(`Lease now ${Math.ceil(remain) + add} min from now.`, 'good')
      }
      engine._emit()
      return
    }

    const preview = e.target.closest('[data-preview-lock]')
    if (preview) {
      await engine.previewLock(Number(preview.dataset.previewLock))
      toast('Lock screen preview — one tap gets you out, and it is not a real strike.', '', 4500)
      return
    }

    const strike = e.target.closest('[data-strike]')
    if (strike) {
      await engine.adjustStrikes(Number(strike.dataset.strike))
      const n = logic.strikesFromEvents(engine.events)
      toast(`Strikes: ${n}. Next failure costs ${esc(logic.lockLabel(n + 1, engine.settings))}.`, 'bad', 4200)
      return
    }

    if (e.target.closest('[data-reset-curve]')) {
      await engine.setSettings({ lockHoursCurve: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })
      return toast('Ladder restored', 'good')
    }

    if (e.target.closest('[data-zero-strikes]')) {
      await engine.resetStrikes('admin console')
      return toast('Ladder reset to zero — journaled as admin, not as a win.', 'good')
    }

    const ff = e.target.closest('[data-ff]')
    if (ff) return fastForward(ff.dataset.ff)

    const fire = e.target.closest('[data-fire]')
    if (fire) {
      const kind = fire.dataset.fire
      await engine.setSettings({ adminQuietRing: kind === 'instant' ? true : engine.settings.adminQuietRing })
      await engine.forceFire({
        minutesOut: 0,
        label: `Admin: ${kind}`,
        missionMode: kind === 'inside' || kind === 'outside' ? kind : 'choose',
      })
      toast('Episode armed. Takeover screen should be up now.', 'good')
      return
    }

    if (e.target.closest('[data-signout]')) {
      const ok = await confirmSheet({
        title: 'Sign out and re-arm the punishment?',
        body: 'From this moment a blown mission locks your phone for ' + esc(logic.lockLabel(logic.strikesFromEvents(engine.events) + 1, engine.settings)) + '.',
        confirmLabel: 'Sign out',
      })
      if (ok) {
        await engine.lockAdmin()
        toast('Signed out. The alarm clock has teeth again.', 'bad')
      }
      return
    }

    if (e.target.closest('[data-dump]')) return dump()
    if (e.target.closest('[data-export]')) return exportAll()
    if (e.target.closest('[data-test-camera]')) return camReport()
    if (e.target.closest('[data-test-sensors]')) return sensors()
  })

  root.addEventListener('input', (e) => {
    const txt = e.target.closest('[data-txt]')
    if (!txt || txt.dataset.txt !== 'lockHoursCurve') return
    const parsed = txt.value.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
    if (parsed.length >= 3) engine.setSettings({ lockHoursCurve: parsed })
  })

  root.querySelector('[data-save-creds]')?.addEventListener('click', async () => {
    const pin = logic.normalizePin(root.querySelector('#new-pin').value)
    const lease = Number(root.querySelector('#lease-min').value)
    const patch = {}
    if (pin) patch.adminPin = pin
    if (Number.isFinite(lease) && lease >= 0) patch.adminLeaseMinutes = Math.min(10080, Math.round(lease))
    if (!Object.keys(patch).length) return toast('Nothing to save', 'bad')
    await engine.adminFlags(patch)
    toast(pin ? `Credentials saved${lease === 0 ? ' — lease never expires' : ''}` : 'Lease updated', 'good')
    engine._emit()
  })
}

export function tick(root, state) {
  patchTimers(root, Date.now(), state.settings)
  // auto-flip back to the gate the moment the lease runs out, mid-screen
  if (!logic.adminActive(state.settings, Date.now()) && root.querySelector('[data-admin]')) {
    engine._emit()
    toast('Admin lease expired — punishment re-armed.', 'bad', 5000)
  }
}

function adminFlagToast(key, on) {
  if (key === 'adminGodMode') return on ? 'God mode ON. Failing a mission now logs a bypass, nothing else.' : 'God mode OFF. Missions bite again.'
  if (key === 'adminAutoPass') return on ? 'Any capture will be accepted (checks still recorded).' : 'Verification enforced again.'
  if (key === 'adminInstantSpacing') return on ? 'Photo spacing ignored.' : 'Spacing enforced.'
  if (key === 'adminQuietRing') return on ? 'Ring will be silent.' : 'Ring will be loud.'
  return `${key} → ${on}`
}

async function fastForward(what) {
  const ep = engine.episode
  if (!ep) return toast('No live episode', 'bad')
  const now = Date.now()
  if (what === 'ring') {
    ep.ringDeadlineAt = now - 1
    toast('Buzz ended — nag loop only.')
  } else if (what === 'deadline') {
    ep.missionDeadlineAt = now - 1
    toast(ep.mode ? 'Deadline blown — see what the engine does.' : 'Blown before you even picked a mission.')
  } else if (what === 'lock') {
    if (ep.phase !== 'locked') return toast('Not locked right now', 'bad')
    ep.lockUntil = now - 1
    toast('Lockout released on the next tick.')
  } else if (what === 'abort') {
    const ok = await confirmSheet({
      title: 'Abort this episode?',
      body: 'Closes it with no event written — neither a win nor a loss. Use it to get out of a half-finished test run.',
      confirmLabel: 'Abort',
      danger: false,
    })
    if (!ok) return
    await engine.adminAbort()
    return toast('Episode aborted (journaled as admin).', 'good')
  }
  engine.tick()
  engine._emit()
}

async function dump() {
  const e = engine
  const payload = {
    at: new Date().toISOString(),
    admin: {
      active: logic.adminActive(e.settings),
      flags: logic.adminActiveFlags(e.settings),
      leaseLeftMs: logic.adminLeaseLeft(e.settings),
    },
    settings: Object.fromEntries(Object.entries(e.settings).filter(([k]) => k !== 'adminPin')),
    alarms: e.alarms,
    episode: e.episode,
    strikes: logic.strikesFromEvents(e.events),
    events: e.events.slice(-15),
    shotCount: e.shots.length,
    storage: (await import('../src/db.js')).isFallback() ? 'localStorage fallback' : 'IndexedDB',
  }
  openSheet(
    `<h3>State</h3><pre style="white-space:pre-wrap;font-size:11px;line-height:1.5;font-family:var(--mono);color:var(--dim)">${esc(
      JSON.stringify(payload, null, 2)
    ).slice(0, 6000)}</pre>`
  )
}

async function exportAll() {
  const payload = {
    exportedAt: new Date().toISOString(),
    admin: true,
    settings: engine.settings,
    alarms: engine.alarms,
    events: engine.events,
    episode: engine.episode,
    shots: engine.shots,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `wake-or-lock-admin-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast('Export includes capture frames — that is the evidence, not just the log', 'good', 4200)
}

async function camReport() {
  const { cameraReport } = await import('../src/camera.js')
  const r = await cameraReport()
  openSheet(`<h3>Camera</h3><pre style="font-size:12px;font-family:var(--mono);color:var(--dim)">${esc(JSON.stringify(r, null, 2))}</pre>`)
}

async function sensors() {
  const { motionProbe } = await import('../src/engine.js')
  motionProbe.start()
  openSheet(
    `<h3>Sensors</h3>
     <div class="tiny muted" style="line-height:1.6">Shake or tilt the phone — the indoor mission needs movement between shots, so this tells you whether the device is even delivering <code>devicemotion</code> to this browser.<br/><br/><span id="sensor-live" class="mono" style="color:var(--txt);font-size:14px">…</span></div>`,
    (sheet) => {
      const out = sheet.querySelector('#sensor-live')
      const iv = setInterval(() => {
        if (!document.body.contains(sheet)) return clearInterval(iv)
        const s = motionProbe.snapshot
        out.textContent = `movement ${Math.round(s.movement)} · tilt ${(s.tilt ?? 0).toFixed(0)}° · supported ${s.supported}`
      }, 250)
    }
  )
}
