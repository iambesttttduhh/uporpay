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
import { verifyOutside, verifyMovementBetweenShots, analyzeImageData, verifyShot } from './verify.js'
import { motionProbe, currentLocation } from './camera.js'

const TICK_MS = 400
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
    this._resumeEpisode()
    this._timer = setInterval(() => this.tick(), TICK_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tick()
    })
    window.addEventListener('focus', () => this.tick())
    // First real gesture unlocks audio; needed because we may have to ring loud.
    const arm = () => alarmSound.arm()
    window.addEventListener('pointerdown', arm, { once: true })
    window.addEventListener('keydown', arm, { once: true })
    this._emit()
  }

  async _load() {
    const [settings, alarms, events, shots, episode] = await Promise.all([
      db.get('settings', SETTINGS_ID),
      db.getAll('alarms'),
      db.getAll('events'),
      db.getAll('shots'),
      db.get('episodes', ACTIVE_EPISODE),
    ])
    if (settings) this.settings = { ...logic.DEFAULT_SETTINGS, ...settings }
    this.alarms = alarms.sort((a, b) => a.time.localeCompare(b.time))
    this.events = events.sort((a, b) => a.at - b.at)
    this.shots = shots
    this.episode = episode ?? null
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
    this._emit()
    return rec
  }

  async toggleAlarm(id, enabled) {
    const a = this.alarms.find((x) => x.id === id)
    if (!a) return
    a.enabled = enabled
    await db.put('alarms', { ...a })
    this._emit()
  }

  async deleteAlarm(id) {
    this.cancelTrials(id)
    this.alarms = this.alarms.filter((a) => a.id !== id)
    await db.del('alarms', id)
    this._emit()
  }

  async setSettings(patch) {
    this.settings = { ...this.settings, ...patch }
    alarmSound.enabled = this.settings.soundOn
    alarmSound.vibrate = this.settings.vibrateOn
    await this._saveSettings()
    this._emit()
  }

  // -- the loop -------------------------------------------------------------

  tick() {
    const now = Date.now()
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
        const quiet = logic.adminActive(this.settings) && this.settings.adminQuietRing
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
   * Submit a capture attempt. Runs every check, stores the image, and if it is
   * the final required step, ends the episode as a success.
   */
  async submitCapture({ imageData, dataUrl, live, simulated, holdDiff, holdMs, requiredHoldMs, location, sleepLocation }) {
    const ep = this.episode
    if (!ep || ep.phase !== PHASE.MISSION) {
      return { ok: false, error: 'No live mission right now.' }
    }
    const s = this.settings
    const steps = logic.missionSteps(ep.mode, s)
    const stepIndex = ep.captures.length
    const step = steps[stepIndex]
    if (!step) return { ok: false, error: 'Mission already complete.' }

    const pose = logic.poseForStep(logic.episodeSeed(ep), stepIndex)
    const stats = analyzeImageData(imageData)
    const checks = []

    // 1) spacing — the core of the 3-shots/10-minutes rule
    const earliest = logic.earliestNextCaptureAt(ep, s)
    const at = Date.now()
    const admin = logic.adminActive(this.settings)
    const early = at < earliest && !(admin && this.settings.adminInstantSpacing)
    checks.push({
      ok: !early,
      label:
        ep.mode === 'inside'
          ? `${s.insideSpacingMinutes} min since previous shot`
          : 'First shot of the sequence',
      reasons: early
        ? [`Wait ${logic.formatCountdown(earliest - at)} before the next photo — the ${s.insideSpacingMinutes} min spacing is enforced.`]
        : [`Gap since last accepted shot: ${logic.formatDuration(Math.max(0, at - (ep.captures.at(-1)?.at ?? ep.firedAt)))}`],
    })

    // 2) movement between shots
    const motion = motionProbe.consume()
    checks.push(verifyMovementBetweenShots({ ...motion, required: 40, testMode: Boolean(s.testMode) }))

    // 3) pose + subject + hold
    checks.push(...(await verifyShot({ verifier: s.poseVerifier ?? 'heuristic', pose, imageData, stats, holdDiff, holdMs, requiredHoldMs, testMode: Boolean(s.testMode) })))

    // 4) outdoors proof, only for the scenery shot
    if (step.kind === 'outside-scenery') {
      checks.push(verifyOutside({ stats, location, sleepLocation, testMode: Boolean(s.testMode) }))
    }

    const verdict = logic.evaluateStep(checks)
    if (!verdict.ok && admin && this.settings.adminAutoPass) {
      verdict.ok = true
      verdict.autoPassed = true
      checks.forEach((c) => {
        if (!c.ok) c.autoPassed = true
      })
    }
    const shotId = logic.uid('shot')
    const shot = { id: shotId, episodeId: ACTIVE_EPISODE, at, stepIndex, kind: step.kind, poseId: pose.id, dataUrl, live, simulated }
    this.shots = [...this.shots, shot]
    await db.put('shots', shot)

    if (!verdict.ok) {
      // Record the attempt so cheating is visible, but don't advance the step.
      // (Auto-pass lands here never — it flips verdict.ok above.)
      ep.failedAttempts = (ep.failedAttempts ?? 0) + 1
      await this._saveEpisode()
      this._emit()
      return { ok: false, checks, pose, step, shotId, at: earliest }
    }

    ep.captures = [...ep.captures, { at, stepIndex, kind: step.kind, poseId: pose.id, shotId, checks }]
    await this._saveEpisode()

    if (ep.captures.length >= steps.length) {
      await this._succeed()
      return { ok: true, done: true, checks, pose, step }
    }
    this._emit()
    const waitMs = logic.spacingMs(s)
    return { ok: true, done: false, checks, pose, step, waitMs }
  }

  async _succeed() {
    const ep = this.episode
    if (!ep) return
    ep.phase = PHASE.SUCCESS
    ep.outcome = 'woke'
    ep.clearAt = Date.now() + (this.settings.demoTiming ? 6000 : 12_000)
    alarmSound.stop()
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
    const minutes = logic.lockMinutesFor(strikes, this.settings)
    ep.phase = PHASE.LOCKED
    ep.outcome = 'locked'
    ep.strike = strikes
    ep.lockMinutes = minutes
    ep.lockUntil = restored ? Math.max(ep.lockUntil ?? 0, Date.now() + minutes * 60_000) : Date.now() + minutes * 60_000
    if (!restored) {
      ep.reason =
        ep.acceptedAt == null
          ? 'Never tapped "I\'m awake" — you let it ring out'
          : 'Mission started but never completed in time'
    }
    alarmSound.stop()
    releaseWakeLock()
    await this._logEvent({
      type: 'locked',
      episodeId: ACTIVE_EPISODE,
      alarmId: ep.alarmId,
      label: ep.label,
      strike: strikes,
      lockMinutes: minutes,
      mode: ep.mode,
      shots: ep.captures.length,
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
    if (ep.oneShot && ep.alarmId) this._disableAlarm(ep.alarmId)
    this.lastOutcome = { kind: 'released', at: Date.now(), strike: ep.strike, lockMinutes: ep.lockMinutes }
    this.episode = null
    await this._saveEpisode()
    this._emit()
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
    } else {
      for (let i = 0; i < -delta; i++) {
        await this._logEvent({ type: 'woke', mode: 'admin', completionMs: 0, shots: 0, admin: true })
      }
    }
    this._emit()
  }

  /** Show the lock screen on demand — it never counts against you. */
  async previewLock(minutes = 1) {
    await this.recordManualLock(minutes, { preview: true })
  }

  /** Full reset. Only offered on the settings screen, logged before it happens. */
  async resetAll() {
    await this._logEvent({ type: 'reset', reason: 'User wiped all app data from settings' })
    await db.wipeEverything()
    this.alarms = []
    this.events = []
    this.shots = []
    this.episode = null
    this.settings = { ...logic.DEFAULT_SETTINGS }
    await db.dbReady
    await this._saveSettings()
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
