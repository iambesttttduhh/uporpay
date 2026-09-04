// ---------------------------------------------------------------------------
// native.js — the seam between the state machine (all JS, all tested) and the
// Android host (exact alarms, foreground ringing, OS-level confinement).
//
// Contract: every method is safe to call in a plain browser. If there is no
// Capacitor bridge, `available` stays false, each call resolves to a harmless
// default, and the web fallbacks in audio.js / camera.js / engine.js keep doing
// what they were already doing. No `if (isNative)` branching scattered through
// the rules — the rules do not care what platform enforces them.
// ---------------------------------------------------------------------------

import { nextAlarmAt } from './logic.js'

const state = {
  probed: false,
  available: false,
  plugin: null,
  Camera: null,
  Geolocation: null,
  status: {},
}

function bridge() {
  const Cap = globalThis.Capacitor
  if (!Cap?.Plugins) return null
  return Cap.Plugins
}

/**
 * Detect the host. `native.json` is written by tools/build-www.mjs and only
 * ships inside the APK, so a dev server on localhost never half-believes it is
 * native (which would silently disable the browser audio path you are testing).
 */
export async function detect(force = false) {
  if (state.probed && !force) return state
  state.probed = true
  try {
    const res = await fetch('/native.json', { cache: 'no-store' })
    if (res.ok) {
      const info = await res.json()
      if (info?.native) {
        const plugins = bridge()
        state.plugin = plugins?.WakeOrLock ?? null
        state.Camera = plugins?.Camera ?? null
        state.Geolocation = plugins?.Geolocation ?? null
        state.available = Boolean(state.plugin)
      }
    }
  } catch {
    /* not native */
  }
  if (state.available) {
    try {
      state.status = (await state.plugin.status()) ?? {}
    } catch (err) {
      state.available = false
      state.status = { error: String(err?.message ?? err) }
    }
  }
  return state
}

export function nativeInfo() {
  return { ...state, probed: true }
}

/** call(plugin, 'method', args) with a permanent fallback — never throws at the caller. */
async function call(method, args = {}, fallback = null) {
  if (!state.available || !state.plugin?.[method]) return fallback
  try {
    return await state.plugin[method](args)
  } catch (err) {
    console.warn(`[native] ${method} failed`, err)
    return fallback
  }
}

export const native = {
  get available() {
    return state.available
  },
  get status() {
    return state.status
  },

  refresh: () => detect(true),

  /** true when the APK can genuinely pin the app (device owner). */
  get hardLock() {
    return Boolean(state.status.deviceOwner)
  },

  async scheduleAlarm(alarm) {
    if (!alarm?.id || !alarm?.at) return { scheduled: false, reason: 'invalid' }
    if (!state.available) return { scheduled: false, reason: 'no-native' }
    const r = await call('setAlarm', {
      id: alarm.id,
      at: alarm.at,
      label: alarm.label ?? '',
      mode: alarm.mode ?? 'choose',
    }, { exact: false })
    return { scheduled: true, ...r }
  },

  cancelAlarm(id) {
    return call('cancelAlarm', { id }, null)
  },

  /** After install/update/reboot: push every future alarm back into AlarmManager. */
  rescheduleAll(alarms) {
    const now = Date.now()
    const next = []
    for (const a of alarms ?? []) {
      const at = nextAlarmAt(a, now)
      if (at) next.push({ id: a.id, at, label: a.label ?? '', mode: a.missionMode ?? 'choose' })
    }
    for (const entry of next) void call('setAlarm', entry, null)
    // Also let the native side re-arm whatever it already had stored.
    return call('rescheduleAll', {}, { rearmed: 0 }).then((r) => ({ ...(r ?? {}), pushed: next.length }))
  },

  dueAlarms() {
    return call('dueAlarms', {}, { items: [] }).then((r) => r?.items ?? [])
  },

  acknowledge(id) {
    return call('acknowledgeAlarm', { id }, null)
  },

  consumeLaunch() {
    return call('consumeLaunch', {}, { alarmId: null }).then((r) => r?.alarmId ?? null)
  },

  startRing(label) {
    return call('startRing', { label }, null)
  },

  stopRing() {
    return call('stopRing', {}, null)
  },

  engageLock(untilEpochMs, reason) {
    return call('engageLock', { until: untilEpochMs, reason: reason ?? '' }, null)
  },

  releaseLock() {
    return call('releaseLock', {}, null)
  },

  lockState() {
    return call('lockState', {}, { locked: false, remainingMs: 0, reason: '', deviceOwner: false })
  },

  requestNotifications() {
    return call('requestNotificationPermission', {}, { granted: false })
  },

  openBatterySettings() {
    return call('openBatterySettings', {}, null)
  },

  openAlarmSettings() {
    return call('openAlarmSettings', {}, null)
  },

  openNotificationSettings() {
    return call('openNotificationSettings', {}, null)
  },

  /** Live-only photo through CameraX. No gallery path exists in this call set. */
  async capturePhoto({ facing = 'user', quality = 72 } = {}) {
    const Cam = bridge()?.Camera ?? state.Camera
    if (!Cam?.getPhoto) return { ok: false, error: 'no-native-camera' }
    try {
      const perms = Cam.checkPermissions ? await Cam.checkPermissions() : { camera: 'granted' }
      if (perms?.camera && perms.camera !== 'granted' && Cam.requestPermissions) {
        const asked = await Cam.requestPermissions()
        if (asked?.camera !== 'granted') return { ok: false, error: 'camera-denied' }
      }
      const photo = await Cam.getPhoto({
        quality,
        allowEditing: false,
        resultType: 'dataUrl',
        saveToGallery: false, // evidence must not litter the gallery, and the
                               // gallery must not be a source of evidence
        direction: facing === 'environment' ? 1 : 0, // CameraSource: 0=rear? see README note
        correctOrientation: true,
      })
      if (!photo?.dataUrl) return { ok: false, error: 'no-data' }
      return { ok: true, dataUrl: photo.dataUrl, width: photo.width, height: photo.height, exif: photo.exif ?? null }
    } catch (err) {
      // user cancelled the shutter → not an error worth a toast
      if (err?.message?.toLowerCase?.().includes('cancel')) return { ok: false, error: 'cancelled' }
      return { ok: false, error: String(err?.message ?? err) }
    }
  },

  async position({ timeoutMs = 6000 } = {}) {
    const Geo = bridge()?.Geolocation ?? state.Geolocation
    if (!Geo?.getCurrentPosition) return null
    try {
      const p = await Geo.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      })
      return { lat: p?.coords?.latitude, lon: p?.coords?.longitude, accuracy: p?.coords?.accuracy, at: p?.timestamp ?? Date.now() }
    } catch {
      return null
    }
  },
}

