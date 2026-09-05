// ---------------------------------------------------------------------------
// engine.js — the state machine.
//
//   idle ──(alarm fires)──▶ ringing ──(tap "I'M AWAKE")──▶ mission ──▶ success
//                              │                              │
//                              └──────── deadline (30 min) ────┴──▶ LOCKED
//                                                                     │
//                                                       timer expires ┴▶ idle
//
// Invariants the UI is not allowed to violate:
//   • There is no "dismiss" and no "snooze". Only mission success ends a ring.
//   • Every transition is persisted before it takes effect, so reloading the
//     page resumes the same episode (and a deadlined-out episode locks on boot).
//   • Strikes are derived from the event log, not a counter, so clearing state
//     is the only way to reset the ladder — and that shows up in history.
// ---------------------------------------------------------------------------

import * as logic from './logic.js'
import * as db from './db.js'
import { alarmSound, acquireWakeLock, releaseWakeLock, enterFullscreen, exitFullscreen } from './audio.js'
import { verifyOutside, verifyMovementBetweenShots, analyzeImageData } from './verify.js'
import { motionProbe, currentLocation } from './camera.js'
import { speechSupport } from './speech.js'
import { native, detect as detectNative } from './native.js'

const TICK_MS = 400
const CLOCK_ID = 'clock'
const CLOCK_SAMPLE_MS = 15_000
// A monotonic reading only means something next to another reading from the same
// app session, so stamps carry the session they were taken in.
const BOOT_ID = logic.uid('boot')
const ACTIVE_EPISODE = 'active'
const SETTINGS_ID = 'app'
const NAG_INTERVAL_MS = 30_000

export const PHASE = {
  IDLE: 'idle',
  RINGING: 'ringing',
  MISSION: 'mission',
  SUCCESS: 'success',
  LOCKED: 'locked',
}

class Engine {
  constructor() {
    this.listeners = new Set()
    this.settings = { ...logic.DEFAULT_SETTINGS }
    this.alarms = []
    this.events = []
    this.episode = null
    this.shots = []
    this.now = Date.now()
    this.lastOutcome = null
    this._timer = null
    this._started = false
    this._nagAt = 0
    this._waking = false
  }

  // -- lifecycle ------------------------------------------------------------

  async start() {
    if (this._started) return
    this._started = true
    await db.dbReady
    await this._load()
    // Before the resumed episode is judged: a lockout that only looks finished
    // because the clock was wound back must not be released.
    await this._guardClock({ force: true })
    await detectNative()
    this._resumeEpisode()
    await this._reconcileNative()
    if (native.available) {
      void native.rescheduleAll(this.alarms)
      // Android 13+ needs an explicit yes before an alarm is allowed to shout.
      void native.requestNotifications()
    }
    this._timer = setInterval(() => this.tick(), TICK_MS)
    // Returning to the app is the moment a native alarm may have fired with the
    // WebView frozen, so both handlers reconcile before they render.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.resume()
    })
    window.addEventListener('focus', () => this.resume())
    // In the browser build, leaving the lockout is billed the same way the APK
    // bills an unpin. A web page genuinely cannot stop you from closing a tab —
    // what it can do is make sure that closing it bought you nothing, and that
    // the attempt is in the journal. Only while locked: while ringing, a phone
    // call or a notification steals focus and that is not your fault.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.noteEscape('hid the tab during a lockout')
    })
    window.addEventListener('blur', () => void this.noteEscape('left the window during a lockout'))
    // First real gesture unlocks audio; needed because we may have to ring loud.
    const arm = () => alarmSound.arm()
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    this._emit()
  }

  async _load() {
    const [settings, alarms, events, shots, episode, clockRow] = await Promise.all([
      db.get('settings', SETTINGS_ID),
      db.getAll('alarms'),
      db.getAll('events'),
      db.getAll('shots'),
      db.get('episodes', ACTIVE_EPISODE),
      db.get('meta', CLOCK_ID),
    ])
    if (settings) this.settings = { ...logic.DEFAULT_SETTINGS, ...settings }
    this.alarms = alarms.sort((a, b) => a.time.localeCompare(b.time))
    this.events = events.sort((a, b) => a.at - b.at)
    this.shots = shots
    this.episode = episode ?? null
    // Last moment this app saw the wall clock, from the previous session. Read
    // during start(), before anything is allowed to decide a lock has expired.
    this.clockStamp = clockRow ?? null
    this._clockAt = 0
  }

  /**
   * Clock guard. Setting the time backwards is the oldest way out of a punishment,
   * so the app compares the clock against its own last stamp and against the
   * monotonic timer: a jump big enough not to be NTP is treated as an escape
   * attempt and the time it appeared to buy is added back onto the sentence. A
   * rewind during a mission is taken off the mission deadline too, so moving the
   * clock never buys you a longer window.
   */
  async _guardClock({ force = false } = {}) {
    const now = Date.now()
    if (!force && this._clockAt && now - this._clockAt < CLOCK_SAMPLE_MS) return null
    this._clockAt = now
    const mono =
      typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : null
    const prev = this.clockStamp
    const sk = logic.clockSkew({
      prevWall: prev?.wall,
      prevMono: prev?.mono,
      wall: now,
      mono,
      sameBoot: prev?.bootId === BOOT_ID,
    })
    const stamp = { id: CLOCK_ID, wall: now, mono, bootId: BOOT_ID, updatedAt: now }
    this.clockStamp = stamp
    await db.put('meta', stamp)
    if (!sk.jumped) return null
    const ep = this.episode
    if (ep) {
      if (ep.phase === PHASE.LOCKED) ep.lockUntil = (ep.lockUntil ?? now) + sk.gained
      if (ep.missionDeadlineAt && sk.back > 0) ep.missionDeadlineAt = Math.max(now + 30_000, ep.missionDeadlineAt - sk.back)
      await this._saveEpisode()
    }
    await this._logEvent({
      type: 'clock',
      episodeId: ep?.id ?? null,
      alarmId: ep?.alarmId ?? null,
      label: ep?.label ?? null,
      backMs: Math.round(sk.back),
      forwardMs: Math.round(sk.forward),
      addedMs: Math.round(sk.gained),
      lockUntil: ep?.phase === PHASE.LOCKED ? ep.lockUntil : null,
    })
    this._emit()
    return sk
  }

  /**
   * On boot, an episode that blew its deadline while the tab was closed locks
   * immediately. No grace period, no "the app wasn't open" excuse.
   */
  _resumeEpisode() {
    const ep = this.episode
    if (!ep) return
    const now = Date.now()
    if (ep.phase === PHASE.LOCKED) {
      if (now >= ep.lockUntil) return this._releaseLock({ restored: true })
      this._startLockSoundLoop()
      return
    }
    if (ep.phase === PHASE.RINGING || ep.phase === PHASE.MISSION) {
      if (now >= ep.missionDeadlineAt) return this._fail({ restored: true })
      // Re-arm the buzz if we came back mid-ring.
      if (ep.phase === PHASE.RINGING) this._beginRinging()
      else alarmSound.pulse({ duration: 0.7, freq: 660 })
    }
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /**
   * Coming back to the foreground. In the APK this is where an alarm that fired
   * while the WebView was frozen gets picked up; in a browser it is just a tick.
   */
  async resume() {
    await this._guardClock({ force: true })
    if (native.available) {
      try {
        await this._reconcileNative()
        await this._syncNativeLock()
      } catch (err) {
        console.warn('[native] reconcile failed', err)
      }
    }
    this.tick()
  }

  /**
   * The OS counts the ways you tried to get out — Home, Recents, unpinning —
   * because it is the only thing awake when you do it. Each attempt already
   * extended the deadline natively; here we adopt that longer deadline and
   * journal it, so the lock screen and the history agree.
   */
  async _syncNativeLock() {
    if (!native.available) return
    const st = await native.lockState()
    const ep = this.episode
    if (!st?.locked || !ep || ep.phase !== PHASE.LOCKED) return
    const escapes = Number(st.escapeCount ?? 0)
    const seen = Number(ep.escapeCount ?? 0)
    if (escapes <= seen) return
    ep.escapeCount = escapes
    ep.lockUntil = Math.max(ep.lockUntil ?? 0, Number(st.until ?? 0) || Date.now() + logic.escapePenaltyMs(this.settings))
    for (let i = 0; i < escapes - seen; i++) {
      await this._logEvent({
        type: 'escape_attempt',
        episodeId: ACTIVE_EPISODE,
        alarmId: ep.alarmId,
        label: ep.label,
        strike: ep.strike,
        penaltyMinutes: Math.round((st.penaltyMs ?? logic.escapePenaltyMs(this.settings)) / 60000),
        lockUntil: ep.lockUntil,
        reason: 'Tried to leave the lockout while it was running',
      })
    }
    await this._saveEpisode()
  }

  _emit() {
    this.now = Date.now()
    for (const fn of this.listeners) fn(this.snapshot())
  }

  snapshot() {
    const strikes = logic.strikesFromEvents(this.events)
    return {
      now: this.now,
      settings: this.settings,
      alarms: this.alarms,
      events: this.events,
      shots: this.shots,
      strikes,
      streak: logic.summarizeEvents(this.events).streak,
      nextStrikeCost: logic.nextStrikeCost(strikes, this.settings),
      stats: logic.summarizeEvents(this.events),
      episode: this.episode,
      lastOutcome: this.lastOutcome,
      nextAlarmAt: this._nextAlarmAt(),
    }
  }

  _nextAlarmAt() {
    let best = null
    for (const a of this.alarms) {
      const t = logic.nextAlarmAt(a, Date.now())
      if (t && (best === null || t < best)) best = t
    }
    return best
  }

  // -- persistence ----------------------------------------------------------

  async _saveEpisode() {
    if (!this.episode) {
      await db.del('episodes', ACTIVE_EPISODE)
      return
    }
    await db.put('episodes', { ...this.episode, id: ACTIVE_EPISODE })
  }

  async _saveSettings() {
    await db.put('settings', { ...this.settings, id: SETTINGS_ID })
  }

  async _logEvent(event) {
    const rec = { id: logic.uid('ev'), at: Date.now(), ...event }
    this.events = [...this.events, rec]
    await db.put('events', rec)
    return rec
  }

  /**
   * Reconcile what the device recorded while the app was not running.
   *
   * This is the honest answer to "my phone didn't go off": it did go off, and
   * Android kept the receipt. Either you get the mission with the time you have
   * left, or — if the window already closed while you were asleep — the lockout
   * engages on launch. Controlled by `lockOnMissedWhileClosed`.
   */
  async _reconcileNative() {
    if (!native.available) return
    const launched = await native.consumeLaunch()
    let due = await native.dueAlarms()
    if (launched && !due.some((d) => d.id === launched)) {
      due = [{ id: launched, firedAt: Date.now(), label: 'Alarm', mode: 'choose' }, ...due]
    }
    if (!due.length) {
      // Re-apply an OS lockout that outlived the WebView.
      const st = await native.lockState()
      if (st?.locked && !this.episode) {
        await this._adoptNativeLock(st)
      }
      return
    }
    for (const record of due) {
      if (this.episode?.alarmId === record.id) {
        void native.acknowledge(record.id)
        continue
      }
      if (this.episode) continue // one episode at a time; the rest stay due
      const firedAt = Number(record.firedAt) || Date.now()
      const deadline = firedAt + logic.missionWindowMs(this.settings)
      if (Date.now() >= deadline) {
        if (this.settings.lockOnMissedWhileClosed === false) {
          void native.acknowledge(record.id)
          await this._logEvent({
            type: 'missed',
            alarmId: record.id,
            label: record.label ?? '',
            firedAt,
            reason: 'Missed while the app was closed — grace setting on',
          })
          this.lastOutcome = { kind: 'missed', at: Date.now(), firedAt, grace: true }
          continue
        }
        await this._lockFromMissed(record, firedAt)
        continue
      }
      await this._catchUpEpisode(record, firedAt, deadline)
    }
  }

  /** Open the episode the alarm would have opened, with its original clock. */
  async _catchUpEpisode(record, firedAt, deadline) {
    const alarm = this.alarms.find((a) => a.id === record.id)
    this.episode = {
      id: ACTIVE_EPISODE,
      alarmId: record.id,
      label: record.label || alarm?.label || 'Missed alarm',
      profile: alarm?.profile ?? 'siren',
      oneShot: alarm?.oneShot ?? false,
      forcedMode: alarm?.missionMode && alarm.missionMode !== 'choose' ? alarm.missionMode : null,
      firedAt,
      phase: PHASE.RINGING,
      ringDeadlineAt: firedAt + logic.ringMs(this.settings),
      missionDeadlineAt: deadline,
      acceptedAt: null,
      startedMissionAt: null,
      mode: alarm?.missionMode && alarm.missionMode !== 'choose' ? alarm.missionMode : null,
      captures: [],
      outcome: null,
      clearAt: null,
      lockUntil: null,
      lockMinutes: null,
      reason: null,
      failedAttempts: 0,
      caughtUp: true,
    }
    void native.acknowledge(record.id)
    if (alarm) {
      const local = this.alarms.find((a) => a.id === alarm.id)
      if (local) local.lastFiredAt = firedAt
      await db.put('alarms', { ...alarm, lastFiredAt: firedAt })
    }
    await this._saveEpisode()
    this._beginRinging()
    this._emit()
  }

  /** Past the window already: strike now, lock now. */
  async _lockFromMissed(record, firedAt) {
    this.episode = {
      id: ACTIVE_EPISODE,
      alarmId: record.id,
      label: record.label || 'Missed alarm',
      firedAt,
      phase: PHASE.RINGING,
      ringDeadlineAt: firedAt,
      missionDeadlineAt: firedAt,
      acceptedAt: null,
      startedMissionAt: null,
      mode: null,
      captures: [],
      clearAt: null,
      lockUntil: null,
      lockMinutes: null,
      reason: null,
      failedAttempts: 0,
      reason: 'The alarm fired while the app was closed, and the window ran out',
      neverWoke: true,
    }
    void native.acknowledge(record.id)
    await this._saveEpisode()
    await this._fail()
    this._emit()
  }

  async _adoptNativeLock(st) {
    this.episode = {
      id: ACTIVE_EPISODE,
      alarmId: null,
      label: 'Lockout',
      firedAt: Date.now() - (st.remainingMs ?? 0),
      phase: PHASE.LOCKED,
      ringDeadlineAt: Date.now(),
      missionDeadlineAt: Date.now(),
      acceptedAt: Date.now(),
      startedMissionAt: Date.now(),
      mode: null,
      captures: [],
      clearAt: null,
      lockMinutes: Math.max(1, Math.round((st.remainingMs ?? 0) / 60000)),
      lockUntil: Date.now() + (st.remainingMs ?? 60000),
      escapeCount: Number(st.escapeCount ?? 0),
      neverWoke: true,
      reason: st.reason || 'Lockout carried across an app restart',
      failedAttempts: 0,
    }
    await this._saveEpisode()
    this._emit()
  }

  // -- alarms ---------------------------------------------------------------

  async upsertAlarm(alarm) {
    const rec = {
      id: alarm.id ?? logic.uid('al'),
      label: alarm.label?.trim() || 'Wake up',
      time: alarm.time,
      days: alarm.days ?? [],
      enabled: alarm.enabled !== false,
      profile: alarm.profile ?? 'siren',
      missionMode: alarm.missionMode ?? 'choose', // 'choose' | 'inside' | 'outside'
      oneShot: Boolean(alarm.oneShot),
      lastFiredAt: alarm.lastFiredAt ?? null,
      createdAt: alarm.createdAt ?? Date.now(),
    }
    const i = this.alarms.findIndex((a) => a.id === rec.id)
    if (i >= 0) this.alarms[i] = rec
    else this.alarms.push(rec)
    this.alarms.sort((a, b) => a.time.localeCompare(b.time))
    await db.put('alarms', rec)
    await this._syncNativeSchedule()
    this._emit()
    return rec
  }

  async toggleAlarm(id, enabled) {
    const a = this.alarms.find((x) => x.id === id)
    if (!a) return
    a.enabled = enabled
    await db.put('alarms', { ...a })
    await this._syncNativeSchedule()
    this._emit()
  }

  async deleteAlarm(id) {
    this.cancelTrials(id)
    this.alarms = this.alarms.filter((a) => a.id !== id)
    await db.del('alarms', id)
    if (native.available) void native.cancelAlarm(id)
    await this._syncNativeSchedule()
    this._emit()
  }

  async setSettings(patch) {
    this.settings = { ...this.settings, ...patch }
    alarmSound.enabled = this.settings.soundOn
    alarmSound.vibrate = this.settings.vibrateOn
    await this._saveSettings()
    await this._syncNativeSchedule()
    this._emit()
  }

  /**
   * Push the JS schedule into AlarmManager. Native alarms are what make the app
   * a real alarm clock: the WebView's setTimeout only runs while the process is
   * alive, and "I'll just close the app" is the single most common way an alarm
   * app fails at 07:00.
   */
  async _syncNativeSchedule() {
    if (!native.available) return
    for (const a of this.alarms) void native.cancelAlarm(a.id)
    void native.rescheduleAll(this.alarms, this.settings)
  }

  // -- the loop -------------------------------------------------------------

  tick() {
    const now = Date.now()
    void this._guardClock()
    const ep = this.episode

    if (!ep) {
      const due = logic.dueAlarm(this.alarms, now)
      if (due) this._beginEpisode(due.alarm, due.firedAt)
      this._emit()
      return
    }

    if (ep.phase === PHASE.RINGING) {
      // continuous buzz until ringDeadlineAt, then escalating nag bursts
      if (now > ep.ringDeadlineAt) {
        const quiet = (logic.adminActive(this.settings) && this.settings.adminQuietRing) || native.available
        if (this.settings.escalationNagAfterRing && !quiet && now - this._nagAt > this._nagInterval()) {
          this._nagAt = now
          alarmSound.pulse({ duration: 2.2, freq: 1046 })
        }
      }
    }

    if ((ep.phase === PHASE.RINGING || ep.phase === PHASE.MISSION) && now >= ep.missionDeadlineAt) {
      this._fail()
      return
    }

    if (ep.phase === PHASE.LOCKED && now >= ep.lockUntil) {
      this._releaseLock()
      return
    }

    if (ep.phase === PHASE.SUCCESS && now >= ep.clearAt) {
      this.episode = null
      // one-shot alarms switch themselves off once survived
      if (ep.oneShot && ep.alarmId) this._disableAlarm(ep.alarmId)
      this._saveEpisode()
    }

    this._emit()
  }

  _nagInterval() {
    return this.settings.demoTiming ? 4000 : NAG_INTERVAL_MS
  }

  async _beginEpisode(alarm, firedAt) {
    if (this.episode) return // exactly one episode at a time
    const s = this.settings
    // State first, persistence after: `tick()` can legitimately call this while
    // an await is in flight, and a double-created episode loses the mission.
    this.episode = {
      id: ACTIVE_EPISODE,
      alarmId: alarm.id,
      label: alarm.label,
      profile: alarm.profile,
      oneShot: alarm.oneShot,
      forcedMode: alarm.missionMode !== 'choose' ? alarm.missionMode : null,
      firedAt,
      phase: PHASE.RINGING,
      ringDeadlineAt: firedAt + logic.ringMs(s),
      missionDeadlineAt: firedAt + logic.missionWindowMs(s),
      acceptedAt: null,
      startedMissionAt: null,
      mode: alarm.missionMode !== 'choose' ? alarm.missionMode : null,
      captures: [],
      outcome: null,
      clearAt: null,
      lockUntil: null,
      lockMinutes: null,
      reason: null,
      failedAttempts: 0,
    }
    this._nagAt = 0
    {
      // Mark this fire time as consumed for EVERY alarm, not just one-shots:
      // dueAlarm() looks 60 s back, so a daily alarm left unmarked would re-fire
      // the instant its mission finished.
      const local = this.alarms.find((a) => a.id === alarm.id)
      if (local) local.lastFiredAt = firedAt
      await db.put('alarms', { ...alarm, lastFiredAt: firedAt })
    }
    await this._saveEpisode()
    this._beginRinging()
    this._emit()
    if (navigator.vibrate && s.vibrateOn) navigator.vibrate([400, 120, 400])
  }

  _beginRinging() {
    const quiet = logic.adminActive(this.settings) && this.settings.adminQuietRing
    if (native.available) {
      // The foreground service owns audio+vibration while the app is backgrounded
      // or the tab is frozen. Starting it again while it is already ringing is a
      // no-op by design, so a catch-up launch and a live tick cannot double up.
      if (!quiet) void native.startRing(this.episode?.label ?? 'Wake up')
      acquireWakeLock()
      return
    }
    alarmSound.enabled = this.settings.soundOn && !quiet
    alarmSound.vibrate = this.settings.vibrateOn && !quiet
    alarmSound.start(this.episode?.profile ?? 'siren')
    acquireWakeLock()
  }

  _startLockSoundLoop() {
    // Silence while locked: the punishment is the lockout, not the noise.
    alarmSound.stop()
    releaseWakeLock()
  }

  // -- mission --------------------------------------------------------------

  /** The one and only way out of a ringing alarm. */
  async acceptMission(mode) {
    const ep = this.episode
    if (!ep || (ep.phase !== PHASE.RINGING && ep.phase !== PHASE.MISSION)) return
    ep.phase = PHASE.MISSION
    if (!native.available) alarmSound.stop() // native keeps buzzing through the mission
    ep.acceptedAt = ep.acceptedAt ?? Date.now()
    ep.startedMissionAt = ep.startedMissionAt ?? Date.now()
    // A 'choose' alarm stays mode-less until the user picks — defaulting here
    // would quietly skip the chooser screen.
    if (mode) ep.mode = mode
    alarmSound.stop()
    await this._saveEpisode()
    this._emit()
  }

  async switchMode(mode) {
    const ep = this.episode
    if (!ep || ep.mode === mode) return
    ep.mode = mode
    ep.captures = [] // changing the deal voids the evidence already submitted
    await this._saveEpisode()
    this._emit()
  }

  /** The pose required for the next shot (deterministic per episode+step). */
  requiredPoseFor(stepIndex) {
    const ep = this.episode
    if (!ep) return null
    const steps = logic.missionSteps(ep.mode, this.settings)
    const step = steps[stepIndex]
    if (!step) return null
    return { step, pose: logic.poseForStep(logic.episodeSeed(ep), stepIndex) }
  }

  /**
   * Submit a proof — a spoken line, or the result of holding the camera on your
   * surroundings. Nothing here stores media: the pixels and the audio are
   * analysed in memory and thrown away, and only the numbers survive in the
   * journal. That is what makes the mission feel instant instead of laggy.
   */
  /**
   * One proof, in the order the mission asked for it. `typed: true` is the
   * no-microphone channel: near-exact sentence, same gaps, and refused outright
   * on a device that can hear you.
   */
  async submitProof({ transcript, score, missing, peak, seconds, simulated, typed, sceneStats, sceneMotion, location, sleepLocation }) {
    const ep = this.episode
    if (!ep || ep.phase !== PHASE.MISSION) return { ok: false, error: 'No live mission right now.' }
    const s = this.settings
    const steps = logic.missionSteps(ep.mode, s)
    const stepIndex = ep.captures.length
    const step = steps[stepIndex]
    if (!step) return { ok: false, error: 'Mission already complete.' }

    const line = step.kind === 'voice' ? logic.lineForStep(logic.episodeSeed(ep), stepIndex) : null
    const admin = logic.adminActive(this.settings)
    const checks = []

    // 1) spacing — "3 lines, a minute apart" is enforced by the clock, not by luck
    const earliest = logic.earliestNextCaptureAt(ep, s)
    const at = Date.now()
    const early = at < earliest && !(admin && this.settings.adminInstantSpacing)
    checks.push({
      ok: !early,
      label: logic.stepNeedsGap(step, stepIndex)
        ? `${s.insideLineGapMinutes ?? 1} min since your last line`
        : 'First proof of the sequence',
      reasons: early
        ? [`Wait ${logic.formatCountdown(earliest - at)} — the gap between lines is the exercise.`]
        : [`Gap since last accepted proof: ${logic.formatDuration(Math.max(0, at - (ep.captures.at(-1)?.at ?? ep.firedAt)))}`],
    })

    if (step.kind === 'voice') {
      const sup = speechSupport()
      const typedPath = Boolean(typed)
      // 2) did the words actually happen — out loud, or (only where the device
      //    cannot hear at all) typed almost exactly
      const need = typedPath ? Math.max(0.85, s.speechMatch ?? 0.6) : s.speechMatch ?? 0.6
      const scored = typedPath ? logic.scoreTranscript(line.text, transcript ?? '') : null
      const got = typedPath ? scored.score : Number(score ?? 0)
      const lacking = typedPath ? scored.missing : missing ?? []
      checks.push({
        ok: got >= need,
        label: `${typedPath ? 'Typed the line' : 'Said the line'} (${Math.round(got * 100)}% of ${Math.round(need * 100)}% needed)`,
        reasons: got >= need
          ? [`${typedPath ? 'Typed: ' : 'Heard: '}"${transcript ?? ''}"`]
          : [
              `Missing: ${lacking.slice(0, 6).join(', ') || (typedPath ? '' : 'the recogniser heard nothing')}`,
              typedPath
                ? 'Type the whole sentence, in order, exactly as written.'
                : 'Say the whole sentence out loud — not mumbled into a pillow.',
            ],
      })
      if (typedPath) {
        // The typing channel exists only where speaking is impossible. Otherwise
        // "deny the microphone" would itself be a way out of the mission.
        const allowed = !sup.mic || !sup.recognize || Boolean(s.testMode)
        checks.push({
          ok: allowed,
          label: 'Typed because this device cannot hear',
          reasons: allowed
            ? [`recogniser: ${sup.recognize ?? 'none'} · microphone: ${sup.mic ? 'available' : 'not available'}`]
            : ['This device has a microphone and a speech recogniser, so speak the line. Typing is not the shortcut here.'],
        })
      } else {
        // 3) was there audio at all: recognition happily hallucinates in silence
        const minLevel = s.micLevelMin ?? 0.03
        // Measured, not claimed: a proof cannot declare itself "simulated" to get
        // out of the audio check. The one exception is the explicit test-mode
        // switch, which is labelled as simulating proofs and is off by default —
        // without it there is no way to demo the app on a device with neither a
        // recogniser nor a microphone (a blocked iframe, an old browser).
        const excused = Boolean(simulated) && Boolean(s.testMode)
        const quiet = !(Number.isFinite(peak) && peak >= minLevel) && !excused
        checks.push({
          ok: !quiet,
          label: quiet ? 'Room was silent' : 'Voice detected on the mic',
          reasons: quiet
            ? [`Peak level ${Number.isFinite(peak) ? (peak * 100).toFixed(1) + '%' : 'not measured'} — say it loudly into the mic (needs > ${(minLevel * 100).toFixed(0)}%).`]
            : [`Peak ${(Number(peak || 0) * 100).toFixed(0)}% over ${(seconds ?? 0).toFixed(1)} s`],
        })
      }
    } else {
      // 4) surroundings: it has to look like a real scene and it has to move
      const stats = sceneStats ?? {}
      const moved = Number(sceneMotion?.integral ?? sceneMotion ?? 0)
      const required = s.sceneMotionMin ?? 25
      checks.push({
        ok: Boolean(s.testMode) || moved >= required,
        label: 'You moved the phone around',
        reasons: s.testMode
          ? ['test mode: movement not enforced']
          : moved >= required
            ? [`Scene movement ${Math.round(moved)} (needed ${required})`]
            : [`Scene barely moved (${Math.round(moved)} of ${required}). Turn around with the phone — a still frame of a wall is not a scene.`],
      })
      if (ep.mode === 'outside') {
        checks.push(verifyOutside({ stats, location, sleepLocation, testMode: Boolean(s.testMode) }))
      } else {
        checks.push({
          ok: true,
          label: 'Camera saw something',
          reasons: [`Frame luminance ${(stats.meanLum ?? 0).toFixed(0)}, edges ${(stats.edgeEnergy ?? 0).toFixed(1)}`],
        })
      }
    }

    const verdict = logic.evaluateStep(checks)
    if (!verdict.ok && admin && this.settings.adminAutoPass) {
      verdict.ok = true
      verdict.autoPassed = true
      checks.forEach((c) => {
        if (!c.ok) c.autoPassed = true
      })
    }

    if (!verdict.ok) {
      ep.failedAttempts = (ep.failedAttempts ?? 0) + 1
      await this._saveEpisode()
      await this._logEvent({
        type: 'proof_rejected',
        episodeId: ACTIVE_EPISODE,
        stepIndex,
        kind: step.kind,
        lineId: line?.id ?? null,
        channel: step.kind === 'voice' ? (typed ? 'typed' : 'voice') : 'scene',
        score: Number(score ?? 0),
        attempts: ep.failedAttempts,
      })
      this._emit()
      return { ok: false, checks, line, step, at: earliest }
    }

    ep.captures = [
      ...ep.captures,
      {
        at,
        stepIndex,
        kind: step.kind,
        lineId: line?.id ?? null,
        lineText: line?.text ?? null,
        channel: step.kind === 'voice' ? (typed ? 'typed' : simulated ? 'simulated' : 'voice') : 'scene',
        score: typed ? logic.scoreTranscript(line.text, transcript ?? '').score : Number(score ?? 1),
        peak: Number(peak ?? 0),
        seconds: Number(seconds ?? 0),
        simulated: Boolean(simulated),
        checks,
      },
    ]
    await this._saveEpisode()

    if (ep.captures.length >= steps.length) {
      await this._succeed()
      return { ok: true, done: true, checks, line, step }
    }
    this._emit()
    return { ok: true, done: false, checks, line, step, waitMs: logic.spacingMs(s), nextAt: logic.earliestNextCaptureAt(ep, s) }
  }

  /** Old name, kept so the admin console and stored episodes still work. */
  submitCapture(args) {
    return this.submitProof(args)
  }

  async _succeed() {
    const ep = this.episode
    if (!ep) return
    await this._clearDebt(ep.alarmId)
    ep.phase = PHASE.SUCCESS
    ep.outcome = 'woke'
    ep.clearAt = Date.now() + (this.settings.demoTiming ? 6000 : 12_000)
    alarmSound.stop()
    if (native.available) {
      void native.stopRing()
      void native.acknowledge(ep.alarmId)
    }
    releaseWakeLock()
    exitFullscreen()
    await this._logEvent({
      type: 'woke',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      mode: ep.mode,
      acceptLatencyMs: ep.acceptedAt - ep.firedAt,
      completionMs: Date.now() - ep.firedAt,
      shots: ep.captures.length,
    })
    this.lastOutcome = {
      kind: 'woke',
      at: Date.now(),
      mode: ep.mode,
      completionMs: Date.now() - ep.firedAt,
      shots: ep.captures.length,
    }
    await this._saveEpisode()
    await alarmSound.success()
    this._emit()
  }

  /**
   * Deadline blown → the phone goes away. UNLESS an admin lease says otherwise:
   * that check lives here, in the state machine, so "no lockout" cannot be
   * undone by the UI, a reload, or a half-configured screen.
   */
  async _fail({ restored = false } = {}) {
    const ep = this.episode
    if (!ep || ep.phase === PHASE.LOCKED) return
    if (!logic.shouldLockOut(this.settings)) return this._bypass('mission deadline reached')
    const strikes = logic.strikesFromEvents(this.events) + 1
    // Two punishments: you tried and blew the deadline (the ladder), versus never
    // even tapping "I'M AWAKE" (asleep through it → the 20-hour one).
    const neverWoke = ep.neverWoke ?? !ep.acceptedAt
    ep.neverWoke = neverWoke
    const minutes = logic.lockMinutesFor(strikes, this.settings, { neverWoke })
    ep.phase = PHASE.LOCKED
    ep.outcome = 'locked'
    ep.strike = strikes
    ep.lockMinutes = minutes
    ep.lockUntil = restored ? Math.max(ep.lockUntil ?? 0, Date.now() + minutes * 60_000) : Date.now() + minutes * 60_000
    if (!restored && !ep.reason) {
      ep.reason =
        ep.acceptedAt == null
          ? 'Never tapped "I\'m awake" — you let it ring out'
          : 'Mission started but never completed in time'
    }
    alarmSound.stop()
    releaseWakeLock()
    if (native.available) {
      void native.stopRing()
      void native.acknowledge(ep.alarmId)
      // The OS pins us, not just the overlay — and it is handed the escape
      // penalty too, so the extension survives even if this WebView never runs
      // again (force-stop, crash, reboot).
      void native.engageLock(ep.lockUntil, ep.reason, logic.escapePenaltyMs(this.settings))
      void native.startLeash(logic.escapePenaltyMs(this.settings))
    }
    await this._logEvent({
      type: 'locked',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      strike: strikes,
      lockMinutes: minutes,
      mode: ep.mode,
      proofs: ep.captures.length,
      neverWoke: Boolean(ep.neverWoke),
      escapes: ep.escapeCount ?? 0,
      reason: ep.reason,
    })
    await this._saveEpisode()
    await alarmSound.failure()
    await enterFullscreen()
    if ('wakeLock' in navigator) acquireWakeLock() // keep the lock screen on top
    this._emit()
  }

  /** Admin override: close the episode, change nothing about your record. */
  async _bypass(reason) {
    const ep = this.episode
    if (!ep) return
    alarmSound.stop()
    releaseWakeLock()
    exitFullscreen()
    if (native.available) {
      void native.stopRing()
      void native.acknowledge(ep.alarmId)
    }
    ep.phase = PHASE.SUCCESS
    ep.outcome = 'bypassed'
    ep.clearAt = Date.now() + (this.settings.demoTiming ? 4000 : 8000)
    await this._logEvent({
      type: 'bypass',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      mode: ep.mode,
      shots: ep.captures.length,
      reason,
      admin: true,
    })
    this.lastOutcome = { kind: 'bypassed', at: Date.now(), reason, admin: true }
    await this._saveEpisode()
    this._emit()
  }

  async _releaseLock({ restored = false } = {}) {
    const ep = this.episode
    if (!ep) return
    await this._logEvent({
      type: 'released',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      strike: ep.strike,
      lockMinutes: ep.lockMinutes,
      served: true,
      restored,
    })
    if (native.available) {
      void native.releaseLock()
      void native.stopLeash()
    }
    if (ep.oneShot && ep.alarmId && !this.settings.reArmAfterLockout) this._disableAlarm(ep.alarmId)
    await this._rearmDebt(ep)
    this.lastOutcome = { kind: 'released', at: Date.now(), strike: ep.strike, lockMinutes: ep.lockMinutes }
    this.episode = null
    await this._saveEpisode()
    this._emit()
  }

  /**
   * "The same alarm will be set again": after a lockout expires, the alarm you
   * failed is re-armed for the next wake-up and flagged as a debt. Serving the
   * time is not the same as waking up, so the obligation carries over.
   */
  async _rearmDebt(ep) {
    if (!this.settings.reArmAfterLockout || !ep?.alarmId) return
    const a = this.alarms.find((x) => x.id === ep.alarmId)
    if (!a) return
    a.oneShot = false // a one-shot you failed stays armed — that is the point
    a.enabled = true
    a.debt = true
    a.debtSince = a.debtSince ?? Date.now()
    a.debtStrikes = (a.debtStrikes ?? 0) + 1
    await db.put('alarms', { ...a })
    await this._syncNativeSchedule()
    await this._logEvent({
      type: 'debt',
      alarmId: a.id,
      label: a.label,
      strike: ep.strike,
      lockMinutes: ep.lockMinutes,
      time: a.time,
      reason: 'Alarm re-armed for the next wake-up — you have not woken up yet',
    })
  }

  async _clearDebt(alarmId) {
    const a = this.alarms.find((x) => x.id === alarmId)
    if (!a || !a.debt) return
    a.debt = false
    a.debtSince = null
    a.debtStrikes = 0
    await db.put('alarms', { ...a })
  }

  async _disableAlarm(alarmId) {
    const a = this.alarms.find((x) => x.id === alarmId)
    if (!a) return
    a.enabled = false
    await db.put('alarms', { ...a })
  }

  /**
   * Optional escape hatch, OFF by default. Taking it is logged as an extra
   * strike so "I needed my phone for a real reason" still has a cost.
   */
  async panicRelease() {
    const ep = this.episode
    if (!ep || ep.phase !== PHASE.LOCKED || !this.settings.panicReleaseEnabled) return
    if (this.settings.panicReleaseCostsStrike) {
      await this._logEvent({ type: 'panic', episodeId: ACTIVE_EPISODE, alarmId: ep.alarmId, label: ep.label, strike: ep.strike, penalty: 'next-strike-added' })
      await this._logEvent({ type: 'locked', episodeId: `${ACTIVE_EPISODE}:panic`, alarmId: ep.alarmId, label: ep.label, strike: (ep.strike ?? 1) + 1, lockMinutes: 0, reason: 'Panic release taken — strike added' })
    }
    this.episode = null
    await this._saveEpisode()
    this._emit()
  }

  // -- dev / demo helpers ---------------------------------------------------

  /**
   * Fire an episode — now, or after `minutesOut`. Delayed trials use a
   * setTimeout rather than the minute-granular scheduler so "90-second trial"
   * means 90 seconds instead of "whenever the next minute boundary lands".
   */
  async forceFire({ minutesOut = 0, label = 'Trial run', missionMode = 'choose', profile = 'siren' } = {}) {
    const at = Date.now() + minutesOut * 60_000
    if (minutesOut > 0) return this._armDelayedTest(at, { label, missionMode, profile })
    const test = {
      id: logic.uid('al'),
      label,
      time: new Date(at).toTimeString().slice(0, 5),
      days: [],
      enabled: true,
      profile,
      missionMode,
      oneShot: true,
      lastFiredAt: null,
      createdAt: Date.now(),
    }
    await db.put('alarms', test)
    this.alarms.push(test)
    this._emit()
    await this._beginEpisode(test, Date.now())
    return test
  }

  _trials = []

  async _armDelayedTest(targetAt, opts) {
    const rounded = new Date(targetAt)
    const test = {
      id: logic.uid('al'),
      label: opts.label,
      time: `${String(rounded.getHours()).padStart(2, '0')}:${String(rounded.getMinutes()).padStart(2, '0')}`,
      days: [],
      enabled: true,
      profile: opts.profile,
      missionMode: opts.missionMode,
      oneShot: true,
      lastFiredAt: null,
      createdAt: Date.now(),
    }
    await db.put('alarms', test)
    this.alarms.push(test)
    const rec = { test, at: targetAt, timer: null }
    rec.timer = setTimeout(() => {
      if (!this.alarms.some((a) => a.id === test.id)) return clearTimeout(rec.timer)
      if (!this.episode) this._beginEpisode(test, Date.now())
      this._trials = this._trials.filter((t) => t !== rec)
    }, Math.max(0, targetAt - Date.now()))
    this._trials.push(rec)
    this._emit()
    return test
  }

  /** Cancel any armed trial (used when its alarm row is deleted). */
  cancelTrials(alarmId) {
    for (const t of this._trials) {
      if (!alarmId || t.test.id === alarmId) clearTimeout(t.timer)
    }
    this._trials = this._trials.filter((t) => alarmId && t.test.id !== alarmId)
  }

  /** Skip the wait in a demo: make the next shot eligible immediately. */
  async rewindSpacingForDemo() {
    const ep = this.episode
    if (!ep?.captures.length) return
    const s = this.settings
    ep.captures = ep.captures.map((c, i) => ({ ...c, at: c.at - logic.spacingMs(s) }))
    await this._saveEpisode()
    this._emit()
  }

  // -- admin console --------------------------------------------------------

  /** PIN check. Returns false and leaves the lease untouched on a miss. */
  async unlockAdmin(pin) {
    if (String(pin ?? '').trim() !== String(this.settings.adminPin ?? '').trim()) {
      await this._logEvent({ type: 'admin_denied', at: Date.now(), reason: 'bad pin' })
      return false
    }
    await this.setSettings({ adminUnlockedAt: Date.now() })
    await this._logEvent({ type: 'admin_on', reason: 'PIN accepted', leaseMinutes: this.settings.adminLeaseMinutes })
    return true
  }

  /** Re-arm the alarm clock. After this the app punishes you again. */
  async lockAdmin() {
    await this.setSettings({ adminUnlockedAt: null })
    await this._logEvent({ type: 'admin_off', reason: 'lease ended by user' })
  }

  async adminFlags(patch) {
    await this.setSettings({ ...patch })
    await this._logEvent({ type: 'admin_config', ...patch })
  }

  /** Close a live episode with no win and no punishment — purely a test tool. */
  async adminAbort() {
    const ep = this.episode
    if (!ep) return false
    alarmSound.stop()
    releaseWakeLock()
    exitFullscreen()
    await this._logEvent({
      type: 'admin_abort',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      phase: ep.phase,
      shots: ep.captures.length,
      admin: true,
    })
    this.lastOutcome = { kind: 'aborted', at: Date.now(), admin: true }
    this.episode = null
    await this._saveEpisode()
    this._emit()
    return true
  }

  /** +1 / -1 on the ladder, written as real log entries so it stays coherent. */
  async adjustStrikes(delta) {
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        await this._logEvent({ type: 'locked', strike: null, lockMinutes: 0, reason: 'strike granted by admin', admin: true })
      }
    } else if (delta < 0) {
      // Strikes are derived from the log, so they cannot be "subtracted" — the
      // honest version is a reset, journaled as an admin act rather than faked
      // as a successful wake-up (which would also inflate the streak).
      await this.resetStrikes('admin console')
    }
    this._emit()
  }

  /**
   * Bill an escape attempt on the lock screen. The native layer keeps its own
   * ledger (LockGuard, in prefs, because the WebView may be gone) and the JS side
   * mirrors it, so this only adds time when there is no native service doing it.
   */
  async noteEscape(reason = 'left the lock screen') {
    const ep = this.episode
    if (!ep || ep.phase !== PHASE.LOCKED || ep.adminPreview) return { ok: false, reason: 'not-locked' }
    const now = Date.now()
    if (now - (ep.lastEscapeAt ?? 0) < 10_000) return { ok: false, reason: 'debounced' }
    ep.lastEscapeAt = now
    ep.escapeCount = (ep.escapeCount ?? 0) + 1
    const penalty = logic.escapePenaltyMs(this.settings)
    const budget = (this.settings.escapePenaltyCapMinutes ?? 240) * 60_000
    const already = ep.escapePenaltyMs ?? 0
    const chargeable =
      this.settings.chargeEscapes && !native.available && penalty > 0 && already < budget
        ? Math.min(penalty, budget - already)
        : 0
    if (chargeable) {
      ep.lockUntil += chargeable
      ep.escapePenaltyMs = already + chargeable
    }
    await this._saveEpisode()
    await this._logEvent({
      type: 'escape_attempt',
      episodeId: ACTIVE_EPISODE,
      reason,
      count: ep.escapeCount,
      penaltyMinutes: Math.round(chargeable / 60_000),
    })
    this._emit()
    return { ok: true, penaltyMinutes: Math.round(chargeable / 60_000), count: ep.escapeCount }
  }

  async resetStrikes(reason = 'admin console') {
    await this._logEvent({ type: 'strike_reset', to: 0, reason, admin: true })
    this._emit()
    return { ok: true }
  }

  /** Show the lock screen on demand — it never counts against you. */
  async previewLock(minutes = 1) {
    await this.recordManualLock(minutes, { preview: true })
  }

  /** Full reset. Only offered on the settings screen, logged before it happens. */
  async resetAll() {
    await db.wipeEverything()
    this.alarms = []
    this.events = []
    this.shots = []
    this.episode = null
    this.clockStamp = null
    this.settings = { ...logic.DEFAULT_SETTINGS }
    await db.dbReady
    await this._saveSettings()
    // Logged *after* the wipe, not before it: a journal that is deleted along with
    // your strikes is not a record. The settings sheet tells the user the reset is
    // kept on file, and now that sentence is true — the empty journal starts with
    // the row proving it was emptied.
    await this._logEvent({ type: 'reset', reason: 'User wiped all app data from settings' })
    this._emit()
  }

  async recordManualLock(minutes, { preview = false } = {}) {
    const strikes = logic.strikesFromEvents(this.events) + 1
    this.episode = {
      id: ACTIVE_EPISODE,
      alarmId: null,
      label: 'Manual lockdown',
      firedAt: Date.now(),
      phase: PHASE.LOCKED,
      ringDeadlineAt: Date.now(),
      missionDeadlineAt: Date.now(),
      acceptedAt: Date.now(),
      mode: null,
      captures: [],
      strike: strikes,
      lockMinutes: minutes,
      lockUntil: Date.now() + minutes * 60_000,
      adminPreview: preview,
      reason: preview ? 'Admin preview of the lock screen — not a real punishment' : 'Triggered from settings (testing the lock screen)',
      outcome: 'locked',
      oneShot: true,
      clearAt: null,
    }
    await this._saveEpisode()
    await enterFullscreen()
    await alarmSound.failure()
    this._emit()
  }

  /** End an admin preview lock without touching the log's punishment totals. */
  async clearLockPreview() {
    const ep = this.episode
    if (!ep?.adminPreview) return false
    this.episode = null
    await this._saveEpisode()
    await this._logEvent({ type: 'admin', reason: 'lock preview ended early', admin: true })
    this._emit()
    return true
  }

  stop() {
    clearInterval(this._timer)
    this._timer = null
    alarmSound.stop()
    motionProbe.stop()
  }
}

export const engine = new Engine()

// motion probe is owned by the mission screen but started once here so the
// accelerometer is warm before the first photo matters
export function startMotionProbe() {
  motionProbe.start()
}

export { currentLocation, motionProbe }
