import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, confirmSheet, openSheet } from '../src/ui.js'
import { alarmSound } from '../src/audio.js'
import { cameraReport, currentLocation } from '../src/camera.js'

// ---------------------------------------------------------------------------
// Settings — every knob that decides how bad your morning is, plus the honest
// limitations panel. Nothing here can shorten a lockout in progress.
// ---------------------------------------------------------------------------

export function render(state) {
  const s = state.settings
  const n = (label, key, value, min, max, step, unit, hint) => `
    <div class="field" style="margin-bottom:13px">
      <label>${label}</label>
      <div class="row">
        <input type="range" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${value}" class="grow" />
        <div class="mono" data-num-out="${key}" style="min-width:74px;text-align:right;font-weight:700">${value}${unit}</div>
      </div>
      ${hint ? `<div class="tiny muted">${hint}</div>` : ''}
    </div>`

  return `
  <div class="spread" style="margin:2px 2px 12px">
    <div style="font-size:20px;font-weight:700">Settings</div>
    <button class="btn sm ghost" data-rescue>🛟 Data</button>
  </div>

  <div class="section-title">The rules</div>
  <div class="card">
    ${n('Continuous buzz before it starts nag-bursting', 'ringMinutes', s.ringMinutes, 1, 20, 1, ' min', 'It keeps nagging after this until the deadline. It never just stops.')}
    ${n('Mission window (hard deadline)', 'missionWindowMinutes', s.missionWindowMinutes, 5, 120, 5, ' min', 'Time from the first buzz to "prove you are awake or lose the phone".')}
    ${n('Indoor mission: number of photos', 'insidePhotos', s.insidePhotos, 2, 8, 1, '', 'More photos × the spacing below = the point at which the indoor option becomes impossible.')}
    ${n('Indoor mission: spacing between photos', 'insideSpacingMinutes', s.insideSpacingMinutes, 1, 30, 1, ' min')}
    ${n('Outside mission: pose selfies after the scenery shot', 'outsidePoseSelfies', s.outsidePoseSelfies, 1, 4, 1, '')}
  </div>

  <div class="section-title">The punishment</div>
  <div class="card">
    <div class="field">
      <label>Lock hours per consecutive strike</label>
      <input data-txt="lockHoursCurve" value="${esc(s.lockHoursCurve.join(', '))}" inputmode="numeric" />
      <div class="tiny muted">Comma-separated ladder. Longer than the list = the last value. Preview: <b>${esc(
        s.lockHoursCurve.map((h, i) => `${i + 1}→${h}h`).join('  ')
      )}</b></div>
    </div>
    ${n('Cap', 'maxLockHours', s.maxLockHours, 1, 72, 1, ' h')}
    <div class="toggle-row">
      <div class="txt">Keep nagging after the buzz<small>Short bursts every 30 s until the deadline, so silence never means you got away with it</small></div>
      <button class="switch ${s.escalationNagAfterRing ? 'on' : ''}" data-bool="escalationNagAfterRing"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Panic release on the lock screen<small>5-second hold-to-confirm. Costs an extra strike. <b>Off = no way out.</b> Only enable if you have kids, a medical need, or a job that can't wait an hour.</small></div>
      <button class="switch ${s.panicReleaseEnabled ? 'on' : ''}" data-bool="panicReleaseEnabled"></button>
    </div>
  </div>

  <div class="section-title">Sound, sensors, proof</div>
  <div class="card">
    <div class="toggle-row">
      <div class="txt">Sound<small>Synthesized siren, ramps 45% → 100% over 8 s</small></div>
      <button class="switch ${s.soundOn ? 'on' : ''}" data-bool="soundOn"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Vibrate<small>Needs Android/Chrome — iOS Safari ignores the vibration API</small></div>
      <button class="switch ${s.vibrateOn ? 'on' : ''}" data-bool="vibrateOn"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Use GPS for the outdoor check<small>Only queried while a mission is live, never logged beyond one coordinate pair</small></div>
      <button class="switch ${s.useLocation !== false ? 'on' : ''}" data-bool="useLocation"></button>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn sm grow" data-test-sound>🔊 Test siren</button>
      <button class="btn sm grow" data-test-camera>📷 Test camera</button>
      <button class="btn sm grow" data-register-spot>📍 Set bed spot</button>
    </div>
    <div class="tiny muted" style="margin-top:9px">${
      s.sleepLocation
        ? `Bed spot stored: ${s.sleepLocation.lat.toFixed(4)}, ${s.sleepLocation.lon.toFixed(4)} (±${Math.round(s.sleepLocation.accuracy ?? 0)} m). Outdoor proof needs &gt;25 m of movement or a daylight sky signature.`
        : 'No bed spot stored — the outdoor check will rely on the daylight/sky signature alone.'
    }</div>
  </div>

  <div class="section-title">Demo & self-testing</div>
  <div class="note" style="margin-bottom:10px">The full sandbox lives in <b>Admin</b> (<code>#/admin</code>, or long-press the header) — god mode there is what disables lockouts at the engine level. These two switches only loosen <i>verification</i>, and real lockouts still land.</div>
  <div class="card">
    <div class="toggle-row">
      <div class="txt">Demo timing (÷60)<small>5 min → 5 s, 30 min → 30 s, 1 h lock → 1 min. Everything in the app, including the lockout.</small></div>
      <button class="switch ${s.demoTiming ? 'on' : ''}" data-bool="demoTiming"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Test mode (loose verification)<small>Skips the pose-steady, movement and outdoors checks so you can drive the flow from a laptop. Every shot is flagged simulated.</small></div>
      <button class="switch ${s.testMode ? 'on' : ''}" data-bool="testMode"></button>
    </div>
    <div class="btn-grid" style="margin-top:12px">
      <button class="btn" data-trial="90">⏱ 90 s trial</button>
      <button class="btn" data-trial="0">🔔 Ring now</button>
      <button class="btn" data-lock-now>🔒 Lock me now</button>
      <button class="btn" data-outside-now>🌳 Outside trial</button>
    </div>
  </div>

  <div class="section-title">What this build cannot do</div>
  <div class="card">
    <div class="rules">
      <div class="rule"><div class="n"></div><div>A browser cannot lock the operating system. This screen covers your whole window, keeps the screen awake, and swallows the back button — but <b>you can still close the tab</b>.</div></div>
      <div class="rule"><div class="n"></div><div>Clearing site data erases the lockout record. The native build in <b>docs/NATIVE.md</b> (Device Owner + lock task) closes that hole; that is the only way "normal calls still work, nothing else does" is actually true.</div></div>
      <div class="rule"><div class="n"></div><div>Alarms only fire while this tab is alive (installed PWA with the screen on, or the tab in the foreground). Background timer throttling is why a real alarm clock needs a native <b>AlarmManager</b>.</div></div>
      <div class="rule"><div class="n"></div><div>Pose verification is heuristics (frame-diff steadiness, skin/edge signature), not real keypoint ML. The verifier seam in <b>src/verify.js</b> is where MediaPipe drops in.</div></div>
    </div>
  </div>
  `
}

export function mount(root) {
  root.addEventListener('click', async (e) => {
    const bool = e.target.closest('[data-bool]')
    if (bool) {
      // The settings screen never auto-re-renders (it would fight your finger
      // mid-drag), so flip the switch here and let the engine persist it.
      const next = !engine.settings[bool.dataset.bool]
      bool.classList.toggle('on', next)
      bool.setAttribute('aria-checked', String(next))
      await engine.setSettings({ [bool.dataset.bool]: next })
      if (bool.dataset.bool === 'demoTiming') toast(next ? 'Demo timing ON — everything ÷60' : 'Real timings armed', next ? '' : 'good')
      if (bool.dataset.bool === 'testMode') toast(next ? 'Test mode ON — verification checks are relaxed and every shot is flagged simulated' : 'Test mode OFF — real checks apply', next ? 'bad' : 'good')
      return
    }

    if (e.target.closest('[data-test-sound]')) {
      await alarmSound.arm()
      const was = engine.settings.soundOn
      engine.settings.soundOn = true
      alarmSound.enabled = true
      await alarmSound.start('siren')
      toast('Siren running — stops in 3 s', '', 2800)
      setTimeout(() => {
        alarmSound.stop()
        engine.settings.soundOn = was
        alarmSound.enabled = was
      }, 3000)
      return
    }

    if (e.target.closest('[data-test-camera]')) {
      const r = await cameraReport()
      openSheet(
        `<h3>Camera capability</h3>
         <div class="checks">
           ${[
             ['Secure context (https)', r.secureContext],
             ['getUserMedia available', r.api],
             ['Permission state', r.permission === 'granted' || r.permission === 'prompt'],
             ['Video inputs found', r.videoInputs > 0],
           ]
             .map(([label, ok]) => `<div class="check ${ok ? 'pass' : 'fail'}"><div>${ok ? '✅' : '⛔'}</div><div class="grow"><b>${esc(label)}</b></div></div>`)
             .join('')}
         </div>
         <div class="note" style="margin-top:12px">Embedded in an iframe with no <code>allow="camera"</code> attribute, permission is denied by the parent page — not by you. That is why the trial flow offers simulated capture in here.</div>`
      )
      return
    }

    if (e.target.closest('[data-register-spot]')) {
      toast('Reading GPS…')
      const loc = await currentLocation({ timeoutMs: 8000 })
      if (!loc) return toast('No GPS fix. Do it next to a window, or leave the light check on.', 'bad')
      await engine.setSettings({ sleepLocation: loc })
      toast(`Bed spot stored (±${Math.round(loc.accuracy)} m)`, 'good')
      return
    }

    if (e.target.closest('[data-trial]')) {
      const out = Number(e.target.closest('[data-trial]').dataset.trial)
      await engine.forceFire({ minutesOut: out / 60, label: out ? 'Trial run' : 'Trial — ring now' })
      if (out) toast('Armed. Go put the phone across the room.', 'good')
      return
    }

    if (e.target.closest('[data-outside-now]')) {
      await engine.forceFire({ minutesOut: 0, label: 'Outside trial', missionMode: 'outside' })
      return
    }

    if (e.target.closest('[data-lock-now]')) {
      const mins = engine.settings.demoTiming ? 1 : 2
      await engine.recordManualLock(mins)
      toast(`Manual lockout for ${logic.formatDuration(mins * 60_000)} — press nothing, watch it.`, 'bad', 5000)
      return
    }

    if (e.target.closest('[data-rescue]')) return dataSheet()
  })

  root.addEventListener('input', (e) => {
    const num = e.target.closest('[data-num]')
    if (num) {
      // Patch the read-out by hand and let the value settle on 'change' — a
      // re-render mid-drag would drop the slider under your thumb.
      const out = root.querySelector(`[data-num-out="${num.dataset.num}"]`)
      if (out) out.textContent = num.value + (out.textContent.trim().endsWith('h') ? ' h' : out.textContent.trim().endsWith('min') ? ' min' : '')
      return
    }
    const txt = e.target.closest('[data-txt]')
    if (txt && txt.dataset.txt === 'lockHoursCurve') {
      const parsed = txt.value
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0)
      if (parsed.length) engine.setSettings({ lockHoursCurve: parsed })
    }
  })

  root.addEventListener('change', (e) => {
    const num = e.target.closest('[data-num]')
    if (!num) return
    const key = num.dataset.num
    const was = engine.settings[key]
    if (Number(num.value) === was) return
    engine.setSettings({ [key]: Number(num.value) })
    if (['ringMinutes', 'missionWindowMinutes'].includes(key)) {
      toast(`${esc(key)} → ${num.value} min${engine.settings.demoTiming ? ' (demo: ÷60)' : ''}`)
    }
  })
}

/** Settings never auto-re-render: it owns its own DOM while you drag. */
export function signature() {
  return 'settings'
}

async function dataSheet() {
  openSheet(
    `<h3>Data on this device</h3>
     <div class="tiny muted" style="line-height:1.6">
       Alarms, strike history and captured photos live in IndexedDB on this phone. Nothing is uploaded — there is no server in this project.<br/><br/>
       Deleting the data also deletes your strikes. That is the one honest escape route in this build, and it is why a real version needs the native lock.
     </div>
     <div class="btn-grid" style="margin-top:14px">
       <button class="btn" data-export>⬇ Export log</button>
       <button class="btn" data-wipe style="background:linear-gradient(180deg,#ff5a4f,#c81c12)">🧹 Wipe everything</button>
     </div>`,
    (sheet, close) => {
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-export]')) {
          const payload = {
            exportedAt: new Date().toISOString(),
            settings: engine.settings,
            alarms: engine.alarms,
            events: engine.events,
            shots: engine.shots.map(({ dataUrl, ...rest }) => rest),
          }
          const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
          const a = document.createElement('a')
          a.href = url
          a.download = `wake-or-lock-${Date.now()}.json`
          a.click()
          URL.revokeObjectURL(url)
          toast('Log exported', 'good')
          return
        }
        if (e.target.closest('[data-wipe]')) {
          close()
          const ok = await confirmSheet({
            title: 'Wipe strikes, history and photos?',
            body: 'Your punishment ladder resets to zero. This is the "clever" way out, and it is logged as a <b>reset</b> in the export you just declined.',
            confirmLabel: 'Wipe it all',
          })
          if (!ok) return
          await engine.resetAll()
          toast('Wiped', 'bad')
        }
      })
    }
  )
}
