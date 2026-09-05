import * as logic from '../src/logic.js'
import { engine } from '../src/engine.js'
import { esc, toast, patchTimers, confirmSheet } from '../src/ui.js'
import { openCamera, waitForStream, grabSmall, sceneStatsOf, sceneMotionOf, currentLocation } from '../src/camera.js'
import { sayLine, speechSupport } from '../src/speech.js'
import { alarmSound, enterFullscreen, acquireWakeLock } from '../src/audio.js'

// ---------------------------------------------------------------------------
// The takeover screens. Two of them, and neither can be dismissed:
//   ring    — it is screaming, one button, and it starts the mission
//   mission — either "say this line" or "show me the room", plus the deadline
//
// Everything here is deliberately cheap to paint: one rAF loop, a 160px
// analysis canvas at 5 Hz, and text patched in place. A laggy wake-up screen is
// a screen you can beat by just waiting for the frame to catch up.
// ---------------------------------------------------------------------------

const VIEW = { cam: null, raf: 0, timer: 0, meter: null, destroyed: false, scene: null, holdFrom: 0, busy: false }

// ══ ringing ════════════════════════════════════════════════════════════════

export function renderRing(state) {
  const ep = state.episode
  const s = state.settings
  if (!ep) return `<div class="card"><div class="small">The alarm is not ringing any more.</div></div>`
  const t = new Date(ep.firedAt)
  const hh = String(t.getHours()).padStart(2, '0')
  const mm = String(t.getMinutes()).padStart(2, '0')
  const mode = ep.mode
  return `
  <div class="ring">
    <div class="ring-top">
      <div class="ring-label">${esc(ep.label || 'Alarm')}</div>
      <div class="ring-time" id="ring-time">${hh}:${mm}</div>
      <div class="ring-sub">${mode ? esc(logic.missionTitle(mode, s)) : 'No snooze. No swipe-away. Pick your mission.'}</div>
    </div>

    ${mode
      ? `<div class="mission-card">
           <div class="mc-k">YOUR MISSION</div>
           <div class="mc-v">${esc(logic.missionTitle(mode, s))}</div>
           <button class="btn primary block big" data-start data-awake>I'M AWAKE — START MISSION</button>
           <button class="linklike" data-switch>change mission</button>
         </div>`
      : `<div class="mission-card">
           <div class="mc-k">NO SNOOZE, NO SWIPE-AWAY</div>
           <div class="mc-v">${esc(s.missionWindowMinutes)} minutes to prove you are up</div>
           <button class="btn primary block big" data-awake>I'M AWAKE — START MISSION</button>
         </div>`}

    <div class="ring-bottom">
      <div class="deadline">
        <div class="dl-k">LOCKED IN</div>
        <div class="dl-v mono" data-cd-deadline>—</div>
      </div>
      <div class="cost">Miss this and <b>${esc(logic.lockLabel((state.strikes ?? 0) + 1, s))}</b> of phone access is gone.${
        ep.neverWoke ? ' You have not even tapped awake — that is the 20-hour one.' : ''
      }</div>
    </div>
  </div>`
}

export async function mountRing(root) {
  root.addEventListener('click', async (e) => {
    const mode = e.target.closest('[data-mode]')?.dataset.mode
    if (mode) {
      await engine.acceptMission(mode)
      return
    }
    if (e.target.closest('[data-start], [data-awake]')) {
      // One tap only acknowledges that you are awake; it does not stop anything.
      const fixed = engine.episode?.mode
      await engine.acceptMission(fixed === 'inside' || fixed === 'outside' ? fixed : null)
      return
    }
    if (e.target.closest('[data-switch]')) {
      engine.episode.mode = null
      await engine._saveEpisode()
      engine._emit()
    }
  })
  // The buzz is loud and the screen must stay lit; both are best-effort.
  await alarmSound.arm()
  acquireWakeLock()
}

// ══ mission ════════════════════════════════════════════════════════════════

/**
 * The chooser. It lives on the mission screen rather than the ringing screen on
 * purpose: the ringing screen must offer exactly one button — "I'M AWAKE" — so
 * there is nothing to fat-finger into a dismiss.
 */
function chooseHtml(ep, s) {
  const left = Math.max(0, ep.missionDeadlineAt - Date.now())
  const insideNeeds = (s.insideLines - 1) * logic.spacingMs(s)
  const insideOpen = left >= insideNeeds
  return `
  <div class="mission mission--choose">
    <header class="m-head">
      <div>
        <div class="m-kicker">${esc(ep.label || 'Alarm')} · PICK YOUR MISSION</div>
        <div class="m-instr">Both of these take longer than hitting a button. That is the whole design.</div>
      </div>
      <div class="m-clock">
        <div class="m-clock-k">LOCKED IN</div>
        <div class="m-clock-v mono" data-cd-deadline>—</div>
      </div>
    </header>
    <div class="m-body">
      <div class="mode-grid">
        <button class="mode-card ${insideOpen ? 'primary' : ''}" data-mode="inside" ${insideOpen ? '' : 'disabled'}>
          <div class="mode-ico">🎙️</div>
          <div class="mode-t">Stay inside</div>
          <div class="mode-sub">Say ${s.insideLines} lines, ${s.insideLineGapMinutes} min apart, out loud. ${
            insideOpen ? '' : `Too late — that needs ${logic.formatDuration(insideNeeds)} and you have ${logic.formatDuration(left)}.`
          }</div>
        </button>
        <button class="mode-card" data-mode="outside">
          <div class="mode-ico">🚪</div>
          <div class="mode-t">Go outside</div>
          <div class="mode-sub">Hold the camera on your surroundings for ${s.outsideSceneSeconds} s — it has to move, and it has to look like outside — then say ${
            s.outsideLines
          } line${s.outsideLines > 1 ? 's' : ''}.</div>
        </button>
      </div>
      <div class="tiny muted center">No photographs. No recordings kept. The mic listens for the words and the app keeps a score.</div>
    </div>
    <footer class="m-foot">
      <div class="tiny muted center">Pick one. There is no third option, and the clock is not stopping.</div>
    </footer>
  </div>`
}

export function signature(state) {
  const ep = state.episode
  if (!ep) return 'none'
  return `${ep.phase}:${ep.mode}:${ep.captures.length}:${Math.ceil((ep.missionDeadlineAt - state.now) / 5000)}`
}

export function render(state) {
  const ep = state.episode
  const s = state.settings
  // The router paints from a snapshot; if the episode was cleared between the
  // snapshot and this call, say so instead of throwing inside the takeover.
  if (!ep) return `<div class="card"><div class="small" style="font-weight:700">No mission running</div><div class="tiny muted" style="margin-top:5px">Nothing to prove right now.</div></div>`
  if (!ep.mode) return chooseHtml(ep, s)
  const steps = logic.missionSteps(ep.mode, s)
  const idx = Math.min(ep.captures.length, steps.length - 1)
  const step = steps[idx]
  const line = step?.kind === 'voice' ? logic.lineForStep(logic.episodeSeed(ep), idx) : null
  const sup = speechSupport()
  const blocked = !sup.recognize
  return `
  <div class="mission">
    <header class="m-head">
      <div>
        <div class="m-kicker">${esc(ep.label || 'Alarm')} · ${ep.mode === 'outside' ? 'OUTSIDE' : 'INSIDE'}</div>
        <div class="m-steps">${steps.map((st, i) => `<i class="${i < ep.captures.length ? 'done' : i === idx ? 'now' : ''}">${st.kind === 'scene' ? '◉' : '🎙'}</i>`).join('')}</div>
      </div>
      <div class="m-clock">
        <div class="m-clock-k">LOCKED IN</div>
        <div class="m-clock-v mono" data-cd-deadline>—</div>
      </div>
    </header>

    ${blocked ? `<div class="warn-strip">This device gave the app no speech recogniser. ${sup.mic ? '' : 'There is no microphone either.'} Enable it or you will be locked out — see Settings → Voice &amp; sensors.</div>` : ''}

    <div class="m-body" id="m-body">${step?.kind === 'scene' ? sceneHtml(s) : voiceHtml(line, s, sup)}</div>

    <footer class="m-foot">
      <div class="m-progress" id="m-progress" style="--p:0"></div>
      <div class="m-result" id="m-result"></div>
      <div class="tiny muted center">Nothing is recorded. The mic listens, the words are compared, and only the score is kept.</div>
    </footer>
  </div>`
}

function sceneHtml(s) {
  return `
    <div class="stage">
      <video id="cam" playsinline muted autoplay></video>
      <div class="stage-hint">Point it at the room or the street, then <b>turn around slowly</b></div>
      <div class="stage-ring" id="scene-ring"><span id="scene-left">0.0</span></div>
      <canvas id="scene-spark" width="120" height="28"></canvas>
      <div id="scene-msg"></div>
    </div>
    <div class="m-instr">
      <div class="mi-k">STEP 1 · SHOW SURROUNDINGS</div>
      <div class="mi-v">Hold the button for ${s.outsideSceneSeconds} seconds while the camera sees you move. A still wall is not a scene.</div>
    </div>
    <button class="btn primary block big" id="scene-btn">HOLD TO SHOW THE ROOM</button>`
}

function voiceHtml(line, s, sup) {
  return `
    ${line ? `
    <div class="line-card">
      <div class="lc-k">SAY THIS OUT LOUD</div>
      <blockquote class="lc-v" id="line-text">${esc(line.text)}</blockquote>
      <div class="lc-heard" id="heard"><span class="mono muted">nothing yet</span></div>
      <div class="meter" id="meter">${'<i></i>'.repeat(18)}</div>
    </div>` : ''}
    <button class="btn primary block big" id="mic-btn">HOLD TO SPEAK</button>
    <div class="tiny muted center" style="margin-top:8px">${sup.recognize === 'native' ? 'System speech recogniser (offline-capable)' : sup.recognize === 'web' ? 'Browser speech recognition' : 'no recogniser'} · needs you to actually talk, ${sup.mic ? 'the mic shows the level' : 'mic unavailable'}</div>`
}

export async function mount(root) {
  VIEW.destroyed = false
  VIEW.root = root
  VIEW.video = root.querySelector('#cam')
  VIEW.meterEl = root.querySelector('#meter')
  VIEW.heardEl = root.querySelector('#heard')
  VIEW.progress = root.querySelector('#m-progress')
  VIEW.result = root.querySelector('#m-result')

  engine.__switchMission = switchPrompt
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-scene-retry]')) {
      const msg = root.querySelector('#scene-msg')
      if (msg) msg.innerHTML = '<div class="tiny muted">Starting the camera…</div>'
      await startScene()
      const b = root.querySelector('#scene-btn')
      if (b && !root.querySelector('#scene-msg')?.textContent.trim()) b.textContent = 'HOLD TO SHOW THE ROOM'
      return
    }
    if (e.target.closest('[data-switch-mission]')) {
      await switchPrompt()
    }
  })
  if (!engine.episode?.mode) {
    // chooser state: only the two mode buttons are live
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-mode]')
      if (!btn || btn.disabled) return
      await engine.acceptMission(btn.dataset.mode)
    })
    VIEW.timer = setInterval(() => paint(), 1000)
    paint()
    return
  }
  const step = currentStep()
  if (step?.kind === 'scene') await startScene()
  else await stopScene()

  bindControls(root)
  VIEW.timer = setInterval(() => paint(), 1000)
  paint()
}

export function unmount() {
  VIEW.destroyed = true
  cancelAnimationFrame(VIEW.raf)
  clearInterval(VIEW.timer)
  VIEW.timer = 0
  stopScene()
  VIEW.meter?.stop?.()
  VIEW.meter = null
  VIEW.busy = false
}

export function tick(root) {
  paint()
}

// -- scene (outside proof) ----------------------------------------------------

function currentStep() {
  const ep = engine.episode
  if (!ep) return null
  const steps = logic.missionSteps(ep.mode, engine.settings)
  return steps[Math.min(ep.captures.length, steps.length - 1)]
}

async function startScene() {
  const cam = await openCamera({ facing: 'environment' })
  if (cam.error) {
    // A permission you can grant mid-mission must not be a dead end: the step
    // says what failed, offers the retry, and offers the other mission. What it
    // does NOT offer is a way to skip the proof.
    paintSceneError(cam)
    return
  }
  VIEW.cam = cam
  if (VIEW.video) {
    VIEW.video.srcObject = cam.stream
    VIEW.video.style.display = 'block'
    await waitForStream(VIEW.video)
  }
  // One 160×120 canvas at 5 Hz is the whole budget. Full-resolution reads every
  // frame is exactly what makes this kind of screen stutter.
  VIEW.scene = { acc: 0, prev: null, last: 0, frames: 0, samples: [], holdStart: 0, holding: false, done: false }
  loopScene()
}

/** Paint the failure inside the stage, with the two honest options. */
function paintSceneError(cam) {
  const host = VIEW.root?.querySelector('#scene-msg')
  const denied = cam.denied || cam.error === 'denied'
  const why = denied
    ? 'The camera was denied. This mission needs to see the room you are standing in.'
    : cam.error === 'unsupported'
      ? 'This browser has no camera access at all (no getUserMedia).'
      : `The camera did not start (${esc(cam.error ?? 'unknown')}).`
  const html = `<div class="stage-error">
      <div class="se-t">${why}</div>
      <div class="se-row">
        <button class="btn sm" data-scene-retry>Try again</button>
        <button class="btn sm ghost" data-switch-mission>Do the inside mission instead</button>
      </div>
      <div class="tiny muted">The lines still need the microphone, and the deadline keeps running either way.</div>
    </div>`
  if (host) host.innerHTML = html
  const btn = VIEW.root?.querySelector('#scene-btn')
  if (btn) btn.textContent = 'CAMERA UNAVAILABLE'
  toast(denied ? 'Grant the camera in system settings, then hit Try again' : 'No camera: the outside mission cannot be proven here', 'bad', 5000)
}

function stopScene() {
  VIEW.cam?.stop?.()
  VIEW.cam = null
  cancelAnimationFrame(VIEW.raf)
  VIEW.raf = 0
  VIEW.scene = null
}

function loopScene() {
  if (VIEW.destroyed || !VIEW.scene) return
  VIEW.raf = requestAnimationFrame(loopScene)
  const sc = VIEW.scene
  const now = performance.now()
  if (now - sc.last < 200) return // 5 Hz
  sc.last = now
  if (!VIEW.video || VIEW.video.readyState < 2) return
  const small = grabSmall(VIEW.video, 160)
  const stats = sceneStatsOf(small)
  if (sc.prev) {
    const d = sceneMotionOf(sc.prev, small)
    if (sc.holding) {
      sc.acc += d
      sc.frames++
      sc.samples.push(d)
      if (sc.samples.length > 24) sc.samples.shift()
      paintSpark(sc.samples)
      const need = logic.sceneHoldMs(engine.settings)
      const held = Date.now() - sc.holdStart
      VIEW.progress?.style.setProperty('--p', String(Math.min(1, held / need)))
      const left = Math.max(0, (need - held) / 1000)
      const el = VIEW.root?.querySelector('#scene-left')
      if (el) el.textContent = left.toFixed(1)
      if (held >= need) finishScene(stats)
    }
  }
  sc.prev = small
  sc.stats = stats
}

async function finishScene(stats) {
  const sc = VIEW.scene
  if (!sc || sc.done) return
  sc.done = true
  const motion = { integral: sc.acc, frames: sc.frames }
  const loc = engine.settings.useLocation !== false ? await currentLocation().catch(() => null) : null
  const res = await engine.submitProof({
    sceneStats: stats,
    sceneMotion: motion,
    location: loc,
    sleepLocation: engine.settings.sleepLocation ?? null,
  })
  showResult(res)
  if (res.ok) {
    stopScene()
    VIEW.video?.style.setProperty('display', 'none')
    setTimeout(() => !VIEW.destroyed && remountBody(), 900)
  } else {
    sc.holding = false
    sc.holdStart = 0
    sc.acc = 0
    sc.prev = null
    sc.done = false
    const btn = VIEW.root?.querySelector('#scene-btn')
    btn?.removeAttribute('disabled')
    if (btn) btn.textContent = 'HOLD AGAIN — THAT WAS NOT A SCENE'
  }
}

function paintSpark(samples) {
  const cv = VIEW.root?.querySelector('#scene-spark')
  if (!cv) return
  const ctx = cv.getContext('2d')
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.fillStyle = 'rgba(255,94,79,.85)'
  const n = samples.length || 1
  for (let i = 0; i < n; i++) {
    const h = Math.max(2, Math.min(cv.height, (samples[i] / 18) * cv.height))
    ctx.fillRect((i * cv.width) / n, cv.height - h, Math.max(2, cv.width / n - 1), h)
  }
}

// -- voice steps --------------------------------------------------------------

function bindControls(root) {
  const micBtn = root.querySelector('#mic-btn')
  const sceneBtn = root.querySelector('#scene-btn')

  if (sceneBtn) {
    const down = (e) => {
      e.preventDefault()
      if (!VIEW.scene || VIEW.scene.done) return
      VIEW.scene.holding = true
      VIEW.scene.holdStart = Date.now()
      VIEW.scene.prev = null
      VIEW.scene.acc = 0
      sceneBtn.classList.add('holding')
      sceneBtn.textContent = 'KEEP HOLDING — TURN AROUND'
    }
    const up = () => {
      if (!VIEW.scene) return
      if (!VIEW.scene.done) {
        VIEW.scene.holding = false
        VIEW.progress?.style.setProperty('--p', '0')
        sceneBtn.classList.remove('holding')
        sceneBtn.textContent = 'HOLD TO SHOW THE ROOM'
      }
    }
    sceneBtn.addEventListener('pointerdown', down)
    sceneBtn.addEventListener('pointerup', up)
    sceneBtn.addEventListener('pointercancel', up)
    sceneBtn.addEventListener('pointerleave', up)
  }

  if (micBtn) {
    let session = null
    const start = async (e) => {
      e.preventDefault()
      if (VIEW.busy) return
      const step = currentStep()
      if (!step || step.kind !== 'voice') return
      const line = logic.lineForStep(logic.episodeSeed(engine.episode), engine.episode.captures.length)
      VIEW.busy = true
      micBtn.classList.add('holding')
      micBtn.textContent = 'LISTENING — SPEAK NOW'
      const bars = [...(VIEW.meterEl?.children ?? [])]
      const ctrl = { stop: null }
      session = { cancelled: false }
      const p = sayLine({
        required: line.text,
        maxSeconds: 12,
        minLevel: engine.settings.micLevelMin ?? 0.03,
        onPartial: (v) => {
          if (VIEW.destroyed) return ctrl.stop?.()
          if (typeof v.level === 'number') {
            const lit = Math.round(v.level * bars.length)
            bars.forEach((b, i) => b.classList.toggle('on', i < lit))
          }
          if (v.transcript || v.interim) {
            VIEW.heardEl.innerHTML = `<b>${esc(v.transcript || '')}</b> <span class="muted">${esc(v.interim || '')}</span>`
          }
        },
      })
      ctrl.stop = () => {
        session.cancelled = true
      }
      const res = await p
      bars.forEach((b) => b.classList.remove('on'))
      micBtn.classList.remove('holding')
      VIEW.busy = false
      if (session?.cancelled) {
        micBtn.textContent = 'HOLD TO SPEAK'
        return
      }
      micBtn.textContent = 'HOLD TO SPEAK'
      const need = engine.settings.speechMatch ?? 0.6
      // No recogniser at all + test mode on → the line is simulated and the
      // result says so out loud. Without test mode this is a rejection instead,
      // because "the app could not hear me" must never be a way out of a mission.
      const simmed = res.error === 'no-speech-recogniser' && engine.settings.testMode
      if (simmed) toast('No recogniser on this device — proof simulated by test mode.', 'bad', 4000)
      const out = await engine.submitProof({
        transcript: res.transcript ?? (simmed ? line.text : ''),
        simulated: Boolean(res.simulated) || simmed,
        score: res.score ?? (simmed ? 1 : res.simulated ? 1 : 0),
        missing: res.missing,
        peak: res.peak,
        seconds: res.seconds,
        simulated: res.simulated,
      })
      if (!out.ok && out.checks) {
        const scoreLine = out.checks.find((c) => !c.ok)
        toast(scoreLine?.reasons?.[0] ?? 'Not enough of the line was heard', 'bad', 4000)
      }
      showResult(out)
      if (out.ok) setTimeout(() => !VIEW.destroyed && remountBody(), 900)
      else if (res.error) toast(`Speech: ${res.error === 'no-speech-recogniser' ? 'no recogniser on this device — see Settings' : esc(res.error)}`, 'bad', 5000)
    }
    micBtn.addEventListener('pointerdown', start)
  }
}

function showResult(res) {
  if (!VIEW.result) return
  const checks = res.checks ?? []
  VIEW.result.innerHTML = checks.length
    ? `<div class="checks">${checks
        .map((c) => `<div class="check ${c.ok ? 'pass' : 'fail'}"><div>${c.ok ? '✓' : '✗'}</div><div class="grow"><b>${esc(c.label)}</b><div class="tiny muted">${esc((c.reasons ?? []).join(' '))}</div></div></div>`)
        .join('')}</div>`
    : `<div class="checks"><div class="check fail"><div>✗</div><div class="grow"><b>${esc(res.error ?? 'Rejected')}</b></div></div></div>`
  VIEW.result.scrollIntoView({ block: 'end', behavior: 'smooth' })
}

/** Re-render just the body when a step completes (no full remount, no flicker). */
function remountBody() {
  const host = VIEW.root?.querySelector('#m-body')
  if (!host) return
  const ep = engine.episode
  if (!ep) return
  const steps = logic.missionSteps(ep.mode, engine.settings)
  const step = steps[Math.min(ep.captures.length, steps.length - 1)]
  const wait = logic.earliestNextCaptureAt(ep, engine.settings) - Date.now()
  if (wait > 0) {
    host.innerHTML = gapHtml(wait)
    startGapCountdown(host, wait)
    VIEW.result.innerHTML = ''
    return
  }
  host.innerHTML = step?.kind === 'scene' ? sceneHtml(engine.settings) : voiceHtml(logic.lineForStep(logic.episodeSeed(ep), ep.captures.length), engine.settings, speechSupport())
  VIEW.video = host.querySelector('#cam')
  bindControls(host)
  if (step?.kind === 'scene') startScene()
  else stopScene()
  VIEW.result.innerHTML = ''
}

function gapHtml(ms) {
  return `
    <div class="gap-card">
      <div class="gap-k">NEXT LINE IN</div>
      <div class="gap-v mono" data-gap>—</div>
      <div class="tiny muted">The gap is the mission. Stay up, keep the screen lit, and do not sit back down — if the alarm deadline passes while you wait, the phone is gone.</div>
    </div>`
}

function startGapCountdown(host, ms) {
  const el = host.querySelector('[data-gap]')
  const until = Date.now() + ms
  const t = setInterval(() => {
    const left = until - Date.now()
    if (el) el.textContent = logic.formatCountdown(left)
    if (left <= 0) {
      clearInterval(t)
      remountBody()
    }
  }, 250)
  setTimeout(() => clearInterval(t), ms + 1500)
}

function paint() {
  const ep = engine.episode
  if (!ep || !VIEW.root) return
  patchTimers(VIEW.root, Date.now(), engine.settings)
  const step = currentStep()
  const btn = VIEW.root.querySelector('#mic-btn')
  const earliest = logic.earliestNextCaptureAt(ep, engine.settings)
  if (btn && step?.kind === 'voice') {
    const waiting = Date.now() < earliest
    btn.disabled = waiting || VIEW.busy
    if (waiting) btn.textContent = `WAIT ${logic.formatCountdown(earliest - Date.now())}`
  }
}

/** Small entry point the ring screen uses when the mode changes. */
export async function switchPrompt() {
  const s = engine.settings
  const yes = await confirmSheet({
    title: 'Change mission',
    body: `Inside is ${(s.insideLines - 1) * s.insideLineGapMinutes} minutes of waiting inside a ${s.missionWindowMinutes}-minute window. Outside is ${s.outsideSceneSeconds} s of camera and ${s.outsideLines} line${s.outsideLines > 1 ? 's' : ''}.`,
    confirmLabel: 'Back to the chooser',
  })
  if (!yes) return
  engine.episode.mode = null
  engine.episode.captures = []
  await engine._saveEpisode()
  engine._emit()
}
