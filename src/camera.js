// ---------------------------------------------------------------------------
// camera.js — live preview + tiny scene analysis. No photographs: the mission
// reads a 160px slice of the stream a few times a second and drops it straight
// away. There is no data URL, no blob, no file input and no recorder in here,
// so there is nothing to upload and nothing to keep.
//
// Why it is built this way: the point of the outside mission is that you are
// standing in the room holding the phone up, not that you own a JPEG. The
// checks therefore run on live pixels (brightness, sky/green, movement) and on
// the microphone, and only the summary numbers are journalled.
// ---------------------------------------------------------------------------

import { native } from './native.js'
import { analyzeImageData } from './verify.js'

export async function cameraReport() {
  const secure = typeof window !== 'undefined' && window.isSecureContext
  const api = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  let devices = []
  let permission = 'unknown'
  try {
    if (navigator.permissions?.query) {
      permission = (await navigator.permissions.query({ name: 'camera' })).state
    }
  } catch {
    /* not supported */
  }
  try {
    if (api) devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    /* blocked */
  }
  return {
    secureContext: secure,
    api,
    permission,
    videoInputs: devices.filter((d) => d.kind === 'videoinput').length,
  }
}

/**
 * Never throws. A mission screen that crashes because a permission is missing is
 * a mission screen you can escape by denying the permission, so failure is data:
 * { stream, stop } on success, { error, denied } on not.
 *
 * The constraint is deliberately small (640×480). Nothing here needs 1280: the
 * scene checks look at luminance, sky/green ratios and frame-to-frame movement,
 * all of which survive a 160px sample — and a phone WebView decodes a fifth of
 * the pixels, which is the difference between smooth and stuttery.
 */
export async function openCamera({ facing = 'user', ideal = { w: 640, h: 480 } } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return { error: 'unsupported' }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: ideal.w }, height: { ideal: ideal.h } },
      audio: false,
    })
  } catch (err) {
    if (err?.name === 'OverconstrainedError' || err?.name === 'NotReadableError') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      } catch (err2) {
        return { error: err2?.name === 'NotAllowedError' ? 'denied' : 'camera-error', denied: err2?.name === 'NotAllowedError' }
      }
    } else {
      return {
        error: err?.name === 'NotAllowedError' ? 'denied' : err?.name === 'NotFoundError' ? 'no-camera' : 'camera-error',
        denied: err?.name === 'NotAllowedError',
      }
    }
  }
  const stop = () => {
    for (const t of stream.getTracks()) t.stop()
  }
  return { stream, stop, track: stream.getVideoTracks()[0] }
}

/** The analysis canvas: one reusable 160×120 read, sized to whatever the stream is. */
let smallCv = null
export function grabSmall(video, w = 160) {
  const vw = video.videoWidth || w
  const vh = video.videoHeight || Math.round((w * 3) / 4)
  const h = Math.max(16, Math.round((w * vh) / vw))
  if (!smallCv) smallCv = document.createElement('canvas')
  smallCv.width = w
  smallCv.height = h
  const ctx = smallCv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** Scene statistics for the "show me where you are" step (same maths, no photo). */
export function sceneStatsOf(imageData) {
  return analyzeImageData(imageData)
}

/** Frame-to-frame difference as a movement signal for the scene hold. */
export function sceneMotionOf(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return 0
  const x = a.data
  const y = b.data
  let sum = 0
  const stride = 4 * 4 // sample every 4th pixel: 160×120 → ~1200 reads per sample
  const n = Math.min(x.length, y.length)
  let count = 0
  for (let i = 0; i < n; i += stride) {
    sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2])
    count++
  }
  return count ? (sum / count) * (4 / 3) : 0
}

/** Wait until the video element is actually delivering frames. */
export function waitForStream(video, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(toy)
      resolve(ok)
    }
    const toy = setTimeout(() => finish(false), timeoutMs)
    video.onloadeddata = () => finish(true)
    if (video.readyState >= 2) finish(true)
  })
}

// ---------------------------------------------------------------------------
// Motion probe. The mission wants evidence you got out of bed and *moved*:
// gravity vector + tilt over the whole window, not just the last few frames.
// ---------------------------------------------------------------------------

export class MotionProbe {
  constructor() {
    this.samples = []
    this.lastTotal = null
    this.movedSince = 0
    this.orientation = null
    this._onMotion = this._onMotion.bind(this)
    this._onOrient = this._onOrient.bind(this)
    this.supported = typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  }

  start() {
    if (!this.supported) return false
    window.addEventListener('devicemotion', this._onMotion, { passive: true })
    window.addEventListener('deviceorientation', this._onOrient, { passive: true })
    return true
  }

  stop() {
    window.removeEventListener('devicemotion', this._onMotion)
    window.removeEventListener('deviceorientation', this._onOrient)
  }

  _onMotion(e) {
    const a = e.accelerationIncludingGravity
    if (!a) return
    const total = Math.abs(a.x ?? 0) + Math.abs(a.y ?? 0) + Math.abs(a.z ?? 0)
    if (this.lastTotal != null) {
      const delta = Math.abs(total - this.lastTotal)
      if (delta > 2.6) this.movedSince += delta
    }
    this.lastTotal = total
    if (this.samples.length > 400) this.samples.shift()
    this.samples.push(total)
  }

  _onOrient(e) {
    // A phone tilted from nightstand-flat to held-up is a strong "got up" cue.
    if (e.beta == null) return
    const tilt = Math.abs(e.beta)
    if (this.orientation != null) this.orientationDelta = Math.abs(tilt - this.orientation)
    this.orientation = tilt
  }

  /** Consume accumulated movement (called after each accepted shot). */
  consume() {
    const value = this.movedSince
    this.movedSince = 0
    const tilt = this.orientationDelta ?? 0
    this.orientationDelta = null
    return { movement: value, tilt }
  }

  get snapshot() {
    return { movement: this.movedSince, tilt: this.orientationDelta ?? 0, supported: this.supported }
  }
}

export const motionProbe = new MotionProbe()

// ---------------------------------------------------------------------------
// Geolocation (optional — used to prove "outside" when the user opts in)
// ---------------------------------------------------------------------------

export function currentLocation({ timeoutMs = 6000, highAccuracy = true } = {}) {
  return new Promise((resolve) => {
    // In the APK the GPS fix comes from the OS location client, which works with
    // the screen off and the app backgrounded; navigator.geolocation does not.
    if (native.available) {
      native.position({ timeoutMs }).then((fix) => resolve(fix && Number.isFinite(fix.lat) ? fix : null))
      return
    }
    if (!navigator.geolocation) return resolve(null)
    const t = setTimeout(() => resolve(null), timeoutMs + 800)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(t)
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: pos.timestamp,
        })
      },
      () => {
        clearTimeout(t)
        resolve(null)
      },
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 }
    )
  })
}
