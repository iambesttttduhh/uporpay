import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, confirmSheet, openSheet } from '../src/ui.js'

import { alarmSound } from '../src/audio.js'
import { cameraReport, currentLocation } from '../src/camera.js'
import { native, nativeInfo } from '../src/native.js'

// ---------------------------------------------------------------------------
// Settings — every knob that decides how bad your morning is, plus the honest
// limitations panel. Nothing here can shorten a lockout in progress.
// ---------------------------------------------------------------------------

// A deliberate refresh hook: settings does not auto-re-render (a re-render would
// drop your thumb mid-slider), so the native panel re-renders only when we say so.
let nativeStamp = 0
function bumpNative() {
  nativeStamp += 1
  engine._emit()
}

export function render(state) {
  const s = state.settings
  const info = nativeInfo()
  // `pct` renders a 0–1 setting as 0–100 so your thumb works in whole numbers,
  // and the handler scales it back before it touches the settings.
  const n = (label, key, value, min, max, step, unit, hint, pct = false) => {
    const sc = pct ? 100 : 1
    const shown = Math.round(value * sc)
    return `
    <div class="field" style="margin-bottom:13px">
      <label>${label}</label>
      <div class="row">
        <input type="range" data-num="${key}" ${pct ? 'data-num-pct="1"' : ''} min="${min * sc}" max="${max * sc}" step="${
          step * sc
        }" value="${shown}" class="grow" />
        <div class="mono" data-num-out="${key}" style="min-width:74px;text-align:right;font-weight:700">${shown}${unit}</div>
      </div>
      ${hint ? `<div class="tiny muted">${hint}</div>` : ''}
    </div>`
  }

  return `
  <div class="spread" style="margin:2px 2px 12px">
    <div style="font-size:20px;font-weight:700">Settings</div>
    <button class="btn sm ghost" data-rescue>🛟 Data</button>
  </div>

  <div class="section-title">The rules</div>
  <div class="card">
    ${n('Continuous buzz before it starts nag-bursting', 'ringMinutes', s.ringMinutes, 1, 20, 1, ' min', 'It keeps nagging after this until the deadline. It never just stops.')}
    ${n('Mission window (hard deadline)', 'missionWindowMinutes', s.missionWindowMinutes, 5, 120, 5, ' min', 'Time from the first buzz to "prove you are awake or lose the phone".')}
    ${n('Inside mission: lines you must say', 'insideLines', s.insideLines, 2, 6, 1, '', 'More lines × the gap below is what makes starting late impossible.')}
    ${n('Inside mission: gap between lines', 'insideLineGapMinutes', s.insideLineGapMinutes, 1, 10, 1, ' min')}
    ${n('Outside mission: lines after the scenery', 'outsideLines', s.outsideLines, 1, 4, 1, '', 'Random English sentences the app picks for you — the mic has to hear you say them.')}
    ${n('Outside mission: hold the camera on your surroundings', 'outsideSceneSeconds', s.outsideSceneSeconds, 5, 30, 5, ' s', 'It checks the view is lit, has sky or greenery, and actually moved while you held it.')}
    <div class="tiny muted" style="margin-top:4px"><b>No photographs.</b> Nothing is captured, stored or uploaded — the preview runs for a few seconds and only summary statistics are kept.</div>
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
    ${n('Cap (ten strikes land here)', 'maxLockHours', s.maxLockHours, 1, 72, 1, ' h')}
    ${n('Locked if you never tapped awake', 'neverWokeLockHours', s.neverWokeLockHours, 1, 48, 1, ' h', 'Let the whole window run out without starting a mission and you get this instead of the ladder value.')}
    <div class="toggle-row">
      <div class="txt">Re-arm the same alarm afterwards<small>When the lockout expires the alarm comes back for that day — you still owe the wake-up.</small></div>
      <button class="switch ${s.reArmAfterLockout ? 'on' : ''}" data-bool="reArmAfterLockout"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Charge escape attempts<small>Unpinning the task, going home or rebooting adds time per attempt up to the cap. Off = leaving is free.</small></div>
      <button class="switch ${s.chargeEscapes ? 'on' : ''}" data-bool="chargeEscapes"></button>
    </div>
    ${n('Penalty per escape attempt', 'escapePenaltyMinutes', s.escapePenaltyMinutes ?? 15, 1, 60, 1, ' min')}
    <div class="toggle-row">
      <div class="txt">Keep nagging after the buzz<small>Short bursts every 30 s until the deadline, so silence never means you got away with it</small></div>
      <button class="switch ${s.escalationNagAfterRing ? 'on' : ''}" data-bool="escalationNagAfterRing"></button>
    </div>
    <div class="toggle-row">
      <div class="txt">Panic release on the lock screen<small>5-second hold-to-confirm. Costs an extra strike. <b>Off = no way out.</b> Only enable if you have kids, a medical need, or a job that can't wait an hour.</small></div>
      <button class="switch ${s.panicReleaseEnabled ? 'on' : ''}" data-bool="panicReleaseEnabled"></button>
    </div>
  </div>

  <div class="section-title">Voice</div>
  <div class="card">
    ${n('How clearly you must speak', 'speechMatch', s.speechMatch, 0.3, 0.95, 0.05, '%', 'Share of the sentence the recogniser has to hear. Under this the line does not count — raise it if you are getting away with mumbles.', true)}
    ${n('How loud', 'micLevelMin', s.micLevelMin, 0.01, 0.2, 0.01, '', 'Peak microphone level while you speak. A silent room recognises nothing, and nothing never counts.', true)}
    <div class="tiny muted">No microphone or no speech recogniser on this device? The line is then <b>typed</b> into a box that refuses pasting — same sentence, same minute between lines, and it is refused outright on a device that can hear you.</div>
    <button class="btn sm block ghost" data-voice-test>🎙️ Test mic with one line</button>
    <div class="tiny muted" style="margin-top:6px" data-voice-out>Web builds read the browser meter; on Android the system recogniser is used. Nothing is recorded.</div>
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

  <div class="section-title">Android engine</div>
  <div class="card">
    ${
      info.available
        ? `<div class="checks">
             ${[
               ['AlarmManager exact alarm', info.status?.exactAlarmsAllowed !== false, 'setAlarmClock — survives Doze'],
               ['Full-screen wake', true, 'lights the lock screen without unlocking it'],
               ['Foreground ring service', true, 'audio + vibration owned by the OS, not the WebView'],
               ['Boot / update restore', true, 're-arms every schedule, records anything that fired while dead'],
               ['Lock enforcement', info.status?.deviceOwner ? 'device owner' : 'lock task (best effort)', info.status?.deviceOwner ? 'Home/Recents suppressed for real' : 'side-loaded: needs screen pinning or Device Owner to be inescapable'],
               ['Notifications', info.status?.notificationsGranted !== false, 'the alarm still shows if the app is backgrounded'],
             ]
               .map(([label, ok, hint]) => `<div class="check ${ok ? 'pass' : 'fail'}"><div>${ok === 'device owner' || ok === true ? '✅' : '⚠️'}</div><div class="grow"><b>${esc(label)}</b><div class="tiny muted">${esc(String(hint))}</div></div></div>`)
               .join('')}
           </div>
           <div class="btn-grid" style="margin-top:12px">
             <button class="btn" data-native-notify>🔔 Allow alerts</button>
             <button class="btn" data-native-alarm>⏰ Exact-alarm access</button>
             <button class="btn" data-native-battery>🔋 Unrestricted battery</button>
             <button class="btn" data-native-recheck>↻ Re-check</button>
           </div>
           <div class="tiny muted" style="margin-top:9px">Battery optimisation is the usual reason a 07:00 alarm does not fire on Chinese ROMs. Nothing in this app can turn it off for you — Android requires a tap in system settings.</div>`
        : `<div class="note">You are in the <b>browser build</b>: alarms are JS timers, and closing the tab cancels them. <code>docs/APK.md</code> builds the same code into an installable <code>.apk</code> with real <code>AlarmManager</code> scheduling, a foreground ring service and a lock-task host.</div>`
    }
  </div>

  <div class="section-title">What this build cannot do</div>
  <div class="card">
    <div class="rules">
      <div class="rule"><div class="n"></div><div>A browser cannot lock the operating system. This screen covers your whole window, keeps the screen awake, and swallows the back button — but <b>you can still close the tab</b>.</div></div>
      <div class="rule"><div class="n"></div><div>Clearing site data erases the lockout record. The native build in <b>docs/NATIVE.md</b> (Device Owner + lock task) closes that hole; that is the only way "normal calls still work, nothing else does" is actually true.</div></div>
      <div class="rule"><div class="n"></div><div>${native.available ? 'In the APK, alarms are real <b>AlarmManager</b> clocks and the ring runs in a foreground service, so they fire with the app closed. What the APK still cannot do is force the OS to keep the screen pinned unless it was provisioned as <b>device owner</b>.' : 'Alarms only fire while this tab is alive (installed PWA with the screen on, or the tab in the foreground). Background timer throttling is why a real alarm clock needs a native <b>AlarmManager</b> — see <b>docs/APK.md</b>.'}</div></div>
      <div class="rule"><div class="n"></div><div>The "you are outside" check is heuristics over a few downsampled frames (brightness, sky/green ratio, frame-to-frame motion) — <b>not</b> a scene classifier, and deliberately not a photograph. Say so to yourself: it is there to stop the phone-on-the-pillow case, not to out-think a determined person with a tripod.</div></div>
      ${native.available ? `<div class="rule"><div class="n"></div><div>Native: ${info.status?.overlay ? 'overlay granted' : '<b>no overlay permission</b> — the leash can only re-open the task, not sit on top of yours'} · mic ${info.status?.microphoneGranted ? 'granted' : 'not granted'} · ${info.status?.deviceOwner ? 'device owner' : 'pinning only'} · ${(info.status?.escapeCount ?? 0)} escape(s) billed.</div></div>` : ''}
    </div>
  </div>
  `
}

export function mount(root) {
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-voice-test]')) return
    const out = root.querySelector('[data-voice-out]')
    if (out) out.textContent = 'Say the line out loud…'
    const speech = await import('../src/speech.js')
    const line = logic.lineForStep('settings-test', 0)
    const s = engine.settings
    if (out) out.innerHTML = `Say this out loud: <b>${esc(line.text)}</b>`
    try {
      const r = await speech.sayLine({
        required: line.text,
        maxSeconds: 12,
        minLevel: s.micLevelMin ?? 0.03,
        onPartial: (v) => {
          if (out && (v.transcript || v.interim)) out.textContent = `Hearing: ${v.transcript || v.interim}`
        },
      })
      if (out)
        out.innerHTML = `Heard “${esc(r.transcript || r.error || 'nothing')}” — match <b>${Math.round((r.score ?? 0) * 100)}%</b> vs needed <b>${Math.round(
          s.speechMatch * 100
        )}%</b>, mic peak <b>${Math.round((r.peak ?? 0) * 100)}</b>. ${
          r.error ? `(${esc(r.error)}) ` : ''
        }${(r.score ?? 0) >= s.speechMatch && r.peak >= (s.micLevelMin ?? 0.03) ? 'That would count.' : 'That would not count.'}`
    } catch (err) {
      if (out) out.textContent = `Mic failed: ${err?.message ?? err}`
    }
  })
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-native-notify]')) {
      const r = await native.requestNotifications()
      toast(r?.granted === false ? 'Still denied — allow it in system settings' : 'Alerts allowed', r?.granted === false ? 'bad' : 'good')
      return bumpNative()
    }
    if (e.target.closest('[data-native-alarm]')) return void native.openAlarmSettings()
    if (e.target.closest('[data-native-battery]')) return void native.openBatterySettings()
    if (e.target.closest('[data-native-recheck]')) {
      await native.refresh()
      if (native.available) await engine.resume()
      toast(native.available ? 'Native engine live — AlarmManager owns your alarms' : 'No native bridge — browser fallback', native.available ? 'good' : '')
      return bumpNative()
    }

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
      if (out) {
        const txt = out.textContent.trim()
        out.textContent =
          num.value +
          (num.dataset.numPct ? '%' : txt.endsWith('h') ? ' h' : txt.endsWith('min') ? ' min' : txt.endsWith('s') ? ' s' : '')
      }
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
    const value = num.dataset.numPct ? Number(num.value) / 100 : Number(num.value)
    if (value === was) return
    engine.setSettings({ [key]: value })
    if (['ringMinutes', 'missionWindowMinutes'].includes(key)) {
      toast(`${esc(key)} → ${num.value} min${engine.settings.demoTiming ? ' (demo: ÷60)' : ''}`)
    }
  })
}

/** Settings never auto-re-render: it owns its own DOM while you drag. */
export function signature() {
  return `settings:${nativeInfo().available ? 1 : 0}:${nativeStamp}`
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
