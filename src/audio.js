// ---------------------------------------------------------------------------
// audio.js — the sound of consequences. Fully synthesized in WebAudio so the
// app ships with zero audio assets and still works offline.
//
// Design notes:
//  • A rising two-tone siren + noise burst is intentionally unpleasant and
//    hard to ignore, unlike a marimba loop.
//  • Volume ramps from 45% → 100% over ~8 s: loud enough to wake a heavy
//    sleeper in the next room, without a jump-scare at second zero.
//  • Browsers block audio until a gesture, so `arm()` must be called from a
//    tap handler (we do it on first interaction and on "test sound").
// ---------------------------------------------------------------------------

class AlarmSound {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null
    this.nodes = null
    this.timer = null
    this.vibeTimer = null
    this.ringStart = 0
    this.enabled = true
    this.vibrate = true
    this.maxOut = true
    this.out = null // AudioNode sink (destination or loopback for meters)
  }

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
  }

  async arm() {
    if (!this.supported) return false
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      this.ctx = new Ctor()
      this.out = this.ctx.createGain()
      this.out.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume()
      } catch {
        return false
      }
    }
    return this.ctx.state === 'running'
  }

  /** Master bus gain (0..1) — used by the settings slider. */
  setVolume(v) {
    if (this.out) this.out.gain.value = Math.max(0, Math.min(1, v))
  }

  _noiseBuffer() {
    const ctx = this.ctx
    const len = Math.floor(ctx.sampleRate * 1.2)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      // slightly brown-ish noise: harsher than white, less fatiguing than raw white
      const white = Math.random() * 2 - 1
      last = (last + 0.03 * white) / 1.03
      data[i] = last * 3.5
    }
    return buf
  }

  /**
   * Start the continuous 5-minute buzz.
   * @param {'siren'|'jackhammer'|'chime'} profile
   */
  async start(profile = 'siren') {
    if (!this.enabled) return
    const ready = await this.arm()
    if (!ready || !this.ctx) return
    this.stop()
    const ctx = this.ctx
    const now = ctx.currentTime

    const bus = ctx.createGain()
    bus.gain.setValueAtTime(0.0001, now)
    bus.connect(this.out)

    // --- oscillators: detuned pair swept by an LFO -------------------------
    const oscA = ctx.createOscillator()
    const oscB = ctx.createOscillator()
    oscA.type = 'sawtooth'
    oscB.type = profile === 'jackhammer' ? 'square' : 'triangle'
    oscA.frequency.value = 660
    oscB.frequency.value = 663
    oscB.detune.value = profile === 'chime' ? 700 : 12

    const sweep = ctx.createOscillator()
    sweep.type = 'sine'
    sweep.frequency.value = profile === 'chime' ? 0.35 : 3.1
    const sweepDepth = ctx.createGain()
    sweepDepth.gain.value = profile === 'chime' ? 120 : 300
    sweep.connect(sweepDepth)
    sweepDepth.connect(oscA.frequency)
    sweepDepth.connect(oscB.frequency)

    const toneGain = ctx.createGain()
    toneGain.gain.value = 0.55
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = profile === 'jackhammer' ? 380 : 1400
    filter.Q.value = 0.8
    oscA.connect(toneGain)
    oscB.connect(toneGain)
    toneGain.connect(filter)
    filter.connect(bus)

    // --- noise layer for grit ---------------------------------------------
    const noise = ctx.createBufferSource()
    noise.buffer = this._noiseBuffer()
    noise.loop = true
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = profile === 'chime' ? 0.015 : 0.09
    noise.connect(noiseGain)
    noiseGain.connect(bus)

    oscA.start()
    oscB.start()
    sweep.start()
    noise.start()

    // ramp up so the neighbours notice by second 8
    bus.gain.linearRampToValueAtTime(1.0, now + 8)
    this.ringStart = now
    this.nodes = { bus, oscA, oscB, sweep, noise }

    this._startVibration()
  }

  /** Short burst used by the post-ring nag loop and the final warning. */
  async pulse({ duration = 1.4, freq = 880 } = {}) {
    if (!this.enabled) return
    const ready = await this.arm()
    if (!ready || !this.ctx) return
    const ctx = this.ctx
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, now)
    osc.frequency.linearRampToValueAtTime(freq * 0.6, now + duration)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.9, now + 0.05)
    gain.gain.setValueAtTime(0.9, now + duration - 0.15)
    gain.gain.linearRampToValueAtTime(0.0001, now + duration)
    osc.connect(gain)
    gain.connect(this.out)
    osc.start()
    osc.stop(now + duration + 0.05)
    if (this.vibrate && navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300])
  }

  /** Positive confirmation blip — the only pleasant sound in this app. */
  async success() {
    const wasEnabled = this.enabled
    this.enabled = true
    if (!(await this.arm()) || !this.ctx) {
      this.enabled = wasEnabled
      return
    }
    const ctx = this.ctx
    const now = ctx.currentTime
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = now + i * 0.09
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.5, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g)
      g.connect(this.out)
      o.start(t)
      o.stop(t + 0.55)
    })
    if (navigator.vibrate && this.vibrate) navigator.vibrate([60, 40, 60])
    this.enabled = wasEnabled
  }

  /** Descending buzz = the lockout engaging. */
  async failure() {
    const wasEnabled = this.enabled
    this.enabled = true
    if (!(await this.arm()) || !this.ctx) {
      this.enabled = wasEnabled
      return
    }
    const ctx = this.ctx
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(300, now)
    o.frequency.exponentialRampToValueAtTime(60, now + 1.6)
    g.gain.setValueAtTime(0.7, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8)
    o.connect(g)
    g.connect(this.out)
    o.start()
    o.stop(now + 1.9)
    if (navigator.vibrate && this.vibrate) navigator.vibrate([900, 200, 900])
    this.enabled = wasEnabled
  }

  _startVibration() {
    if (!this.vibrate || typeof navigator === 'undefined' || !navigator.vibrate) return
    const pattern = [500, 150, 500, 150, 900, 300]
    navigator.vibrate(pattern)
    this.vibeTimer = setInterval(() => navigator.vibrate(pattern), 2100)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.vibeTimer) {
      clearInterval(this.vibeTimer)
      this.vibeTimer = null
      if (navigator.vibrate) navigator.vibrate(0)
    }
    if (!this.nodes || !this.ctx) return
    const { bus, oscA, oscB, sweep, noise } = this.nodes
    const now = this.ctx.currentTime
    try {
      bus.gain.cancelScheduledValues(now)
      bus.gain.setValueAtTime(bus.gain.value, now)
      bus.gain.linearRampToValueAtTime(0.0001, now + 0.25)
      setTimeout(() => {
        try {
          oscA.stop()
          oscB.stop()
          sweep.stop()
          noise.stop()
          bus.disconnect()
        } catch {
          /* already stopped */
        }
      }, 300)
    } catch {
      /* context gone */
    }
    this.nodes = null
  }
}

export const alarmSound = new AlarmSound()

// ---------------------------------------------------------------------------
// Wake lock: while an alarm is ringing or a mission is live, the screen must
// not sleep. Without this, phones silence/defer everything on lock.
// ---------------------------------------------------------------------------
let wakeLock = null
let sentinel = null
let wakeLockWanted = false

export async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return false
  wakeLockWanted = true
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    sentinel = new AbortController()
    // Chrome drops wake locks when the tab hides — re-acquire on return.
    document.addEventListener(
      'visibilitychange',
      async () => {
        if (!wakeLockWanted || document.visibilityState !== 'visible') return
        if (wakeLock && !wakeLock.released) return
        try {
          wakeLock = await navigator.wakeLock.request('screen')
        } catch {
          /* best effort */
        }
      },
      { signal: sentinel.signal }
    )
    return true
  } catch {
    return false
  }
}

export function releaseWakeLock() {
  wakeLockWanted = false
  sentinel?.abort()
  sentinel = null
  try {
    wakeLock?.release()
  } catch {
    /* noop */
  }
  wakeLock = null
}

/**
 * Fullscreen request — must be called from a user gesture. We ask for it during
 * the "I'm awake" tap so the ringing UI already owns the screen, making the
 * mission impossible to swipe away casually.
 */
export async function enterFullscreen() {
  try {
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      await document.documentElement.requestFullscreen()
      return true
    }
  } catch {
    /* denied */
  }
  return false
}

export async function exitFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
  } catch {
    /* noop */
  }
}
