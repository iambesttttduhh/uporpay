// ---------------------------------------------------------------------------
// camera.js — live-only capture.
//
// The anti-cheat principle: there is no file input anywhere in the mission
// flow. A shot only exists if it was drawn from a live getUserMedia stream in
// this second, which kills the "upload a photo from last Tuesday" exploit.
// In `testMode` we additionally allow a synthetic shot so the whole loop is
// demoable in environments where the camera is blocked (e.g. an iframe).
// ---------------------------------------------------------------------------

const CAPTURE_MAX_W = 1280
const CAPTURE_QUALITY = 0.72

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
 * @param {{facing?: 'user'|'environment'}} opts
 * @returns {Promise<{stream: MediaStream, stop: () => void}>}
 */
export async function openCamera({ facing = 'user' } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('camera-unsupported'), { code: 'unsupported' })
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    })
  } catch (err) {
    // Some devices ignore facingMode and hard-fail; retry without it.
    if (err?.name === 'OverconstrainedError' || err?.name === 'NotReadableError') {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    } else {
      throw Object.assign(new Error(err?.name === 'NotAllowedError' ? 'camera-denied' : 'camera-error'), {
        code: err?.name === 'NotAllowedError' ? 'denied' : 'error',
        cause: err,
      })
    }
  }
  const stop = () => {
    for (const t of stream.getTracks()) t.stop()
  }
  return { stream, stop, track: stream.getVideoTracks()[0] }
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

/**
 * Draw the current video frame into an offscreen canvas and return
 * a data URL + a pixel sample used by the verifiers.
 */
export function grabFrame(video) {
  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 480
  const scale = Math.min(1, CAPTURE_MAX_W / vw)
  const w = Math.max(16, Math.round(vw * scale))
  const h = Math.max(16, Math.round(vh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', CAPTURE_QUALITY),
    imageData,
    width: w,
    height: h,
    live: true,
  }
}

/**
 * Synthetic capture for environments where the camera is unavailable and the
 * user has explicitly opted into test mode. It stamps the frame with the pose
 * and clock so screenshots of it are still evidence in the history log.
 */
export function simulateFrame({ label = 'SIMULATED', pose = '', w = 640, h = 480 }) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const g = ctx.createLinearGradient(0, 0, 0, h)
  const bright = label.toLowerCase().includes('outside')
  g.addColorStop(0, bright ? '#7ec8ff' : '#20242e')
  g.addColorStop(1, bright ? '#d9f0c0' : '#0c0e13')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = bright ? '#04121f' : '#e8ecf5'
  ctx.font = 'bold 30px system-ui, sans-serif'
  ctx.fillText('SIMULATED CAPTURE', 24, 52)
  ctx.font = '20px system-ui, sans-serif'
  ctx.fillText(label, 24, 90)
  ctx.fillText(pose || 'no pose', 24, 122)
  ctx.fillText(new Date().toLocaleTimeString(), 24, h - 28)
  return {
    dataUrl: canvas.toDataURL('image/jpeg', CAPTURE_QUALITY),
    imageData: ctx.getImageData(0, 0, w, h),
    width: w,
    height: h,
    live: false,
    simulated: true,
  }
}

// ---------------------------------------------------------------------------
// Motion probe. The inside mission requires a real gap between shots; we also
// ask for evidence you got out of bed and *moved* between them.
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
