import * as logic from '../src/logic.js'
import { engine, startMotionProbe, motionProbe } from '../src/engine.js'
import { esc, toast, patchTimers, attachHold } from '../src/ui.js'
import { openCamera, waitForStream, grabFrame, simulateFrame, nativeStill, cameraReport } from '../src/camera.js'
import { native } from '../src/native.js'
import { frameDiff } from '../src/verify.js'
import { currentLocation } from '../src/camera.js'
import { alarmSound, enterFullscreen, acquireWakeLock } from '../src/audio.js'

// ---------------------------------------------------------------------------
// mission.js — the two takeover screens.
//
//  • RINGING: no dismiss affordance exists in this DOM. Not "snooze", not
//    "stop". One button, and it starts a mission.
//  • MISSION: live camera only. There is no <input type=file> in this file —
//    you cannot pick a gallery photo, because that would end the whole idea.
// ---------------------------------------------------------------------------

export function renderRing(state) {
  const ep = state.episode
  const s = state.settings
  return `
  <div class="overlay overlay--ring">
    <div class="ring-clock"><span data-clock-sec=""></span></div>
    <div class="ring-label">${esc(ep.label)}</div>

    <div class="pulse">
      <div class="pulse-ring"></div><div class="pulse-ring"></div><div class="pulse-ring"></div>
      <div class="pulse-core">⏰</div>
    </div>

    <div style="text-align:center;margin-top:6px">
      <div class="tiny" style="color:rgba(255,255,255,.72)">
        ${Date.now() < ep.ringDeadlineAt
          ? `Buzzing for <b>${logic.formatCountdown(ep.ringDeadlineAt - Date.now())}</b>, then it nag-bursts until the deadline`
          : `Still going. It does not stop on its own.`}
      </div>
    </div>

    <div class="deadline">
      <div class="tiny muted" style="letter-spacing:.14em;text-transform:uppercase;font-weight:800">Locked out in</div>
      <div class="deadline-num" data-cd="${ep.missionDeadlineAt}"></div>
      <div class="bar"><i data-cdbar="${ep.firedAt} ${ep.missionDeadlineAt}"></i></div>
      <div class="tiny muted" style="margin-top:14px">
        ${esc(logic.nextStrikeCost(state.strikes, s))} without your phone if this timer hits zero.
      </div>
    </div>

    <button class="btn lg block ok" data-awake style="margin-top:16px">I'M AWAKE — START MISSION</button>
    <div class="tiny muted center" style="margin-top:9px">
      There is no snooze button. Tapping this does not dismiss the alarm — it commits you to the mission.
      <span data-silent style="display:block;margin-top:6px;color:var(--warn)"></span>
    </div>
  </div>`
}

export async function mountRing(root, state) {
  const ep = state.episode
  if (!ep) return
  enterFullscreen()
  acquireWakeLock()
  // Audio may still be gated behind a gesture; the "awake" tap fixes that.
  const silent = root.querySelector('[data-silent]')
  if (silent && engine.settings.soundOn) {
    silent.textContent = 'Silent? Tap once more to force the siren.'
  }
  const btn = root.querySelector('[data-awake]')
  btn?.addEventListener('click', async () => {
    await alarmSound.arm()
    if (ep.phase === 'ringing' && Date.now() > ep.ringDeadlineAt) alarmSound.start(ep.profile ?? 'siren')
    const forced = engine.episode?.forcedMode ?? null
    await engine.acceptMission(forced)
    startMotionProbe()
  })
}

// ---------------------------------------------------------------------------

/**
 * Structural signature used by the router. Deliberately coarse: re-rendering the
 * mission screen would tear down the live camera stream, so per-capture changes
 * are patched in place by MissionScreen.updatePanels() instead.
 */
export function signature(state) {
  const ep = state.episode
  if (!ep) return 'none'
  return ep.mode ? 'capture' : 'chooser'
}

export function render(state) {
  const ep = state.episode
  const s = state.settings
  if (!ep) return `<div class="empty"><div class="big">😌</div><div class="small">No live alarm. Set one, or run a trial from Home.</div></div>`

  if (ep.phase !== 'mission') {
    return `<div class="card"><div class="small" style="font-weight:700">Mission closed</div><div class="tiny muted" style="margin-top:5px">Phase: ${esc(ep.phase)}. Nothing to do here.</div></div>`
  }

  if (!ep.mode) return chooser(state)
  return `<div class="overlay overlay--mission">
            <div class="cam-wrap" id="camwrap">
              <video id="cam-video" playsinline autoplay muted></video>
              <div class="cam-top" id="pose-area"></div>
              <div class="cam-strip">
                <button class="icon-btn" data-flip title="Flip camera">🔄</button>
                <button class="icon-btn" data-sim title="No camera here? simulate a capture">🧪</button>
              </div>
              <div class="cam-bottom" id="control-area"></div>
            </div>
          </div>`
}

function chooser(state) {
  const ep = state.episode
  const s = state.settings
  const now = Date.now()
  const insideOk = logic.insideMissionPossible(now, ep, s)
  const stepsInside = logic.missionSteps('inside', s)
  const stepsOutside = logic.missionSteps('outside', s)
  const left = ep.missionDeadlineAt - now
  return `
  <div class="section-title" style="margin-top:2px">Pick your escape</div>
  <div class="card">
    <div class="spread">
      <div class="small" style="font-weight:700">Deadline</div>
      <div class="mono" style="font-size:20px;font-weight:700;color:var(--hot-2)" data-cd="${ep.missionDeadlineAt}"></div>
    </div>
    <div class="bar" style="margin-top:8px"><i data-cdbar="${ep.startedMissionAt ?? ep.firedAt} ${ep.missionDeadlineAt}"></i></div>
    <div class="tiny muted" style="margin-top:9px">The clock started when the alarm fired, not when you tapped awake. ${logic.formatDuration(left)} left.</div>
  </div>

  <div class="section-title">Choose a mission</div>

  <div class="card" style="margin-bottom:10px">
    <div class="spread">
      <div>
        <div style="font-size:16px;font-weight:750">🌳 Go outside</div>
        <div class="tiny muted" style="margin-top:4px">${stepsOutside.length} photo${stepsOutside.length > 1 ? 's' : ''}, right now: 1 of where you are + ${s.outsidePoseSelfies} pose selfie${s.outsidePoseSelfies > 1 ? 's' : ''}.</div>
      </div>
      <span class="pill ok">always possible</span>
    </div>
    <div class="checks" style="margin-top:10px">
      <div class="check">✅ verified by daylight/sky signature${s.useLocation === false ? '' : ' and GPS distance from your sleeping spot'}</div>
      <div class="check">✅ pose selfie must show you, in the pose the app picks</div>
    </div>
    <button class="btn primary block" data-mode="outside" style="margin-top:12px">I'm heading out</button>
  </div>

  <div class="card ${insideOk ? '' : 'card--danger'}">
    <div class="spread">
      <div>
        <div style="font-size:16px;font-weight:750">🏠 Stay inside</div>
        <div class="tiny muted" style="margin-top:4px">${stepsInside.length} photos, minimum ${logic.formatDuration(logic.spacingMs(s))} apart, each a new random pose.</div>
      </div>
      <span class="pill ${insideOk ? 'demo' : 'hot'}">${insideOk ? 'tight but doable' : 'no longer possible'}</span>
    </div>
    ${
      insideOk
        ? `<div class="checks" style="margin-top:10px">
             <div class="check">⏳ needs ${logic.formatDuration((s.insidePhotos - 1) * logic.spacingMs(s))} of pure waiting — you have ${logic.formatDuration(left)}</div>
             <div class="check">🚶 accelerometer must see you move between shots (no lying in bed selfie-ing)</div>
           </div>`
        : `<div class="note" style="margin-top:10px">${esc(logic.insideMissionBlockedReason(now, ep, s))}</div>`
    }
    <button class="btn block" data-mode="inside" ${insideOk ? '' : 'disabled'} style="margin-top:12px">${insideOk ? 'Do it from indoors' : 'Unavailable'}</button>
  </div>

  <div class="tiny muted center" style="margin-top:14px">Switching mode later wipes your submitted photos. The deadline never moves.</div>
  `
}

// ---------------------------------------------------------------------------
// MissionScreen owns the camera and the shutter. The overlay DOM around the
// video is re-painted by updatePanels() so the stream is never interrupted.
// ---------------------------------------------------------------------------

let screen = null

export async function mount(root, state) {
  const ep = state.episode
  if (!ep) return
  if (ep.mode) {
    screen = new MissionScreen(root, ep)
    await screen.init()
  } else {
    wireChooser(root)
  }
}

export function unmount() {
  screen?.destroy()
  screen = null
}

export function tick(root, state) {
  patchTimers(root, Date.now(), state.settings)
  screen?.tick(state)
}

function wireChooser(root) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mode]')
    if (!btn || btn.disabled) return
    await engine.switchMode(btn.dataset.mode)
    toast(`Mission: ${btn.dataset.mode === 'outside' ? 'go outside and prove it' : `${engine.settings.insidePhotos} poses, spaced apart`}`, 'good')
  })
}

class MissionScreen {
  constructor(root, ep) {
    this.root = root
    this.ep = ep
    this.video = root.querySelector('#cam-video')
    this.poseArea = root.querySelector('#pose-area')
    this.control = root.querySelector('#control-area')
    this.cam = null
    this.facing = null
    this.simulate = false
    this.lastResult = null
    this.holdStart = null
    this.holdFrames = null
    this.panelSig = null
    this.unbind = []
    this.destroyed = false
  }

  async init() {
    startMotionProbe()
    enterFullscreen()
    acquireWakeLock()
    this.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-flip]')) this.openCamera(this.facing === 'user' ? 'environment' : 'user', true)
      if (e.target.closest('[data-sim]')) this.enableSimulation()
    })
    await this.openCamera(this.facingFor(this.stepKind()))
    this.updatePanels(true)
  }

  stepKind() {
    const steps = logic.missionSteps(this.ep.mode, engine.settings)
    return steps[this.ep.captures.length]?.kind ?? null
  }

  facingFor(kind) {
    return kind === 'outside-scenery' ? 'environment' : 'user'
  }

  enableSimulation() {
    this.simulate = true
    this.cam?.stop()
    this.cam = null
    this.video.style.display = 'none'
    if (!engine.settings.testMode) engine.setSettings({ testMode: true })
    toast('Simulation capture on. Shots are marked <b>simulated</b> in your log — real verification needs a real camera.', 'bad', 5000)
    this.updatePanels(true)
  }

  async openCamera(facing) {
    if (this.simulate) return
    const report = await cameraReport()
    if (!report.api || !report.secureContext) {
      this.video.insertAdjacentHTML('afterend', '')
      return this.failCamera(`Camera needs a secure context (https). ${report.api ? '' : 'getUserMedia unavailable here.'}`)
    }
    try {
      this.cam?.stop()
      this.cam = await openCamera({ facing })
      this.facing = facing
      this.video.srcObject = this.cam.stream
      this.video.classList.toggle('mirror', facing === 'user')
      const ok = await waitForStream(this.video)
      if (!ok) return this.failCamera('Camera stream never started.')
      this.nativeShutter = false
      this.video.style.display = 'block'
    } catch (err) {
      this.failCamera(
        err?.code === 'denied'
          ? 'Camera permission denied. Grant it in your browser settings and pull down, or switch to simulation.'
          : 'No camera here — switch to simulation to test the loop.'
      )
    }
  }

  failCamera(message) {
    // In the APK a dead WebView preview is not a licence to fake a photo: the
    // native CameraX shutter still produces real pixels, so take that path and
    // leave test mode off. Only a browser falls back to simulation.
    if (native.available) {
      this.nativeShutter = true
      this.simulate = false
      this.video.style.display = 'none'
      toast(`${esc(message)} Using the app camera for each shot instead.`, '', 5000)
      this.updatePanels(true)
      return
    }
    this.simulate = true
    this.video.style.display = 'none'
    if (!engine.settings.testMode) engine.setSettings({ testMode: true })
    toast(esc(message) + ' Falling back to simulated capture.', 'bad', 6000)
    this.updatePanels(true)
  }

  // -- panels ---------------------------------------------------------------

  updatePanels(force = false) {
    if (this.destroyed) return
    const ep = engine.episode
    if (!ep) return
    this.ep = ep
    const s = engine.settings
    const steps = logic.missionSteps(ep.mode, s)
    const idx = ep.captures.length
    const step = steps[idx]
    const now = Date.now()
    const earliest = logic.earliestNextCaptureAt(ep, s)
    const waiting = now < earliest
    const { pose } = engine.requiredPoseFor(idx) ?? {}

    const sig = [ep.mode, idx, waiting, this.simulate, ep.failedAttempts ?? 0, this.lastResult ? 'r' : ''].join('|')
    if (!force && sig === this.panelSig) return
    this.panelSig = sig

    if (pose) {
      this.poseArea.innerHTML = `
        <div class="pose-card">
          <div class="tiny" style="letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--dim);margin-bottom:6px">
            Step ${idx + 1} of ${steps.length} · ${esc(step.kind === 'outside-scenery' ? 'proof of outdoors' : 'pose selfie')}
            ${this.simulate ? '<span class="pill demo" style="margin-left:6px">simulated</span>' : ''}
          </div>
          <div class="pose-emoji">${pose.emoji}</div>
          <div class="pose-name">${esc(pose.label)}</div>
          <div class="pose-hint">Hold it steady while the shutter counts down — the app compares the first and last frame.</div>
        </div>`
    } else {
      this.poseArea.innerHTML = `<div class="pose-card"><div class="pose-emoji">✅</div><div class="pose-name">Mission complete</div></div>`
    }

    this.control.innerHTML = `
      ${steps
        .map((st, i) => {
          const cap = ep.captures[i]
          const cls = cap ? 'done' : i === idx ? 'now' : ''
          const p = logic.poseForStep(logic.episodeSeed(ep), i)
          return `<div class="step ${cls}">
            <div class="dot">${cap ? '✓' : i + 1}</div>
            <div class="grow">${esc(st.label)}${st.kind === 'pose-selfie' ? ` <span class="muted">— ${p.emoji} ${esc(p.label)}</span>` : ''}</div>
            <div class="tiny mono muted">${cap ? logic.formatClockAt(cap.at) : waiting && i === idx ? 'wait ' + logic.formatCountdown(earliest - now) : ''}</div>
          </div>`
        })
        .join('')}

      <div class="checks" id="result-area">${this.lastResult ? checksHtml(this.lastResult) : ep.failedAttempts ? `<div class="check fail"><b>${ep.failedAttempts}</b> rejected attempt(s) logged.</div>` : ''}</div>

      ${
        idx >= steps.length
          ? `<div class="center tiny muted" style="margin-top:12px">Releasing you out of here…</div>`
          : waiting
          ? `
            <div class="center" style="margin-top:12px">
              <div class="tiny muted" style="letter-spacing:.14em;text-transform:uppercase;font-weight:800">Next photo unlocks in</div>
              <div class="deadline-num" data-cd="${earliest}"></div>
              <div class="bar"><i data-cdbar="${now} ${earliest}"></i></div>
              <div class="tiny muted" style="margin-top:8px">${esc(movementHint())} · deadline in <span data-cd="${ep.missionDeadlineAt}"></span></div>
              ${s.demoTiming ? `<button class="btn sm" data-skip style="margin-top:10px">⏩ skip the wait (demo)</button>` : ''}
            </div>`
          : `
            <div class="spread" style="margin:14px 0 6px">
              <div class="tiny muted">Deadline <b class="mono" data-cd="${ep.missionDeadlineAt}"></b></div>
              <div class="tiny muted">${ep.mode === 'outside' ? 'outside proof required' : 'movement ' + Math.round(motionProbe.snapshot.movement)} / 40</div>
            </div>
            <div style="position:relative">
              <button class="shutter" id="shutter" aria-label="Hold to capture">
                <div class="hold-ring"></div>
                <div class="shutter-inner">${this.simulate ? '🧪' : '📸'}</div>
              </button>
              <div class="tiny muted center" style="margin-top:10px">Press and hold for ${(logic.POSE_HOLD_MS / 1000).toFixed(1)} s</div>
            </div>`
      }
    `

    const skip = this.control.querySelector('[data-skip]')
    if (skip) skip.addEventListener('click', () => engine.rewindSpacingForDemo())

    const shutter = this.control.querySelector('#shutter')
    if (shutter) {
      this.unbind.forEach((f) => f())
      this.unbind = [
        attachHold(
          shutter,
          logic.POSE_HOLD_MS,
          () => this.capture(),
          (p) => {
            shutter.style.setProperty('--p', (p * 100).toFixed(0))
            shutter.classList.toggle('holding', p > 0.02)
            if (p > 0 && !this.holdStart && !this.simulate && this.video?.readyState >= 2) {
              // baseline frame, sampled the instant the finger lands
              this.holdStart = grabFrame(this.video).imageData
            }
            if (p === 0) this.holdStart = null // released early → not a hold
          }
        ),
      ]
    }
    patchTimers(this.root, Date.now(), s)
  }

  async capture() {
    const s = engine.settings
    const shutter = this.control.querySelector('#shutter')
    if (!this.simulate && !this.nativeShutter && (!this.video || this.video.readyState < 2)) {
      toast('Camera is not ready yet', 'bad')
      return
    }
    if (this.nativeShutter) {
      toast('Hold still — the app camera is opening…', '', 1200)
    }
    let final = this.nativeShutter
      ? await nativeStill({
          facing: this.facing,
          poseOverlay: engine.requiredPoseFor(engine.episode.captures.length)?.pose ?? null,
        })
      : null
    if (final?.error) {
      shutter?.removeAttribute('disabled')
      if (final.error !== 'cancelled') toast(`App camera: ${esc(final.error)}`, 'bad')
      return
    }
    final = final ?? (this.simulate
      ? simulateFrame({
          label: this.stepKind() === 'outside-scenery' ? 'outside proof' : 'pose selfie',
          pose: engine.requiredPoseFor(engine.episode.captures.length)?.pose?.label ?? '',
        })
      : grabFrame(this.video))
    const heldFrom = this.holdStart ?? final.imageData
    // A single native still has no "before" frame to diff against — the shutter
    // press itself is the hold — so skip the steadiness comparison, not the pose.
    const diff = this.simulate || this.nativeShutter ? 0 : frameDiff(heldFrom, final.imageData)
    this.holdStart = null

    shutter?.setAttribute('disabled', 'true')
    const location =
      engine.settings.useLocation !== false && this.stepKind() === 'outside-scenery' ? await currentLocation() : null

    const result = await engine.submitCapture({
      imageData: final.imageData,
      dataUrl: final.dataUrl,
      live: !this.simulate,
      simulated: this.simulate,
      holdDiff: diff,
      holdMs: logic.POSE_HOLD_MS,
      requiredHoldMs: logic.POSE_HOLD_MS,
      location,
      sleepLocation: engine.settings.sleepLocation ?? null,
    })

    this.lastResult = result
    if (result.ok) {
      await alarmSound.success()
      navigator.vibrate?.([40, 60, 40])
      this.lastResult = null
      toast(result.done ? 'Done. You kept your phone.' : `Accepted — ${esc(nextStepText())}`, 'good')
      if (result.done) return
      const nextKind = this.stepKind()
      if (nextKind && this.facingFor(nextKind) !== this.facing) await this.openCamera(this.facingFor(nextKind))
    } else if (result.error) {
      toast(esc(result.error), 'bad')
    } else {
      navigator.vibrate?.([120, 60, 120])
      this.control.querySelector('#result-area')?.insertAdjacentHTML('afterbegin', checksHtml(result))
      this.control.querySelector('#result-area')?.scrollIntoView({ block: 'end', behavior: 'smooth' })
      toast('Rejected. Read the reasons.', 'bad')
    }
    shutter?.removeAttribute('disabled')
    this.updatePanels(true)
  }

  tick() {
    if (this.destroyed) return
    if (!engine.episode || engine.episode.phase !== 'mission') return
    // re-paint when a wait ends so the shutter comes back without a reload
    const now = Date.now()
    const earliest = logic.earliestNextCaptureAt(engine.episode, engine.settings)
    if (this.wasWaiting === undefined) this.wasWaiting = now < earliest
    if (this.wasWaiting !== now < earliest) {
      this.wasWaiting = now < earliest
      this.lastResult = null
    }
    this.updatePanels(false)
    patchTimers(this.root, now, engine.settings)
  }

  destroy() {
    this.destroyed = true
    this.cam?.stop()
    this.cam = null
    this.unbind.forEach((f) => f())
    this.unbind = []
  }
}

function movementHint() {
  const snap = motionProbe.snapshot
  if (!snap.supported) return 'motion sensor unavailable'
  return `move the phone to prove you're up`
}

function nextStepText() {
  const ep = engine.episode
  if (!ep) return ''
  const steps = logic.missionSteps(ep.mode, engine.settings)
  const next = steps[ep.captures.length]
  if (!next) return 'final step'
  const pose = logic.poseForStep(logic.episodeSeed(ep), ep.captures.length)
  return `${pose.emoji} ${pose.label}${ep.mode === 'inside' ? ` — in ${engine.settings.insideSpacingMinutes} minutes` : ''}`
}

function checksHtml(result) {
  const checks = result.checks ?? []
  if (!checks.length) return ''
  return checks
    .map(
      (c) => `
      <div class="check ${c.ok ? 'pass' : 'fail'}">
        <div>${c.ok ? '✅' : '⛔'}</div>
        <div class="grow">
          <b>${esc(c.label)}</b>
          ${(c.reasons ?? []).map((r) => `<div class="tiny muted">${esc(r)}</div>`).join('')}
        </div>
      </div>`
    )
    .join('')
}
