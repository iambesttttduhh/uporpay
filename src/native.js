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
  // Which commit this bundle was staged from (www/native.json). Declared up front
  // so the key always exists: a settings screen that prints `undefined` next to
  // "Build" is how you end up unable to tell a dev server from a shipped APK.
  rev: null,
  builtAt: null,
  described: null,
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
      // The stamp is worth reading even in a build where the bridge is missing,
      // so the settings sheet can always answer "which commit am I looking at".
      state.rev = info?.rev ?? null
      state.builtAt = info?.builtAt ?? null
      state.described = info?.described ?? null
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

  /** System speech recogniser. The WebView has no Web Speech API, so the APK
   * has to borrow the platform one; both paths return { transcript }. */
  recognizeSpeech({ lang = 'en-US', maxSeconds = 12 } = {}) {
    return call('listen', { language: lang, timeoutMs: maxSeconds * 1000 }, { error: 'no-native' })
  },

  /** Keep the app pinned while a lockout runs (APK only, no-op in a browser). */
  startLeash(penaltyMs) {
    return call('startLeash', { penaltyMs: penaltyMs ?? 0 }, null)
  },

  stopLeash() {
    return call('stopLeash', {}, null)
  },

  /**
   * Admin exit key. The native side drops the ring service, the leash loop and the
   * lock-task before it closes, so this is a real close and not a page hide. It does
   * not cancel anything in AlarmManager: closing the app tonight still lets 06:40
   * happen tomorrow, which is the difference between an exit hatch and sabotage.
   */
  exitApp() {
    return call('exitApp', {}, { closed: false, reason: 'no-native' })
  },

  requestMic() {
    return call('requestMicrophone', {}, { granted: false })
  },

  /**
   * "Display over other apps". With it, the leash can put the lock screen back on
   * top of whatever you just opened; without it Android only lets us re-open the
   * task when a background activity start is allowed. Either way the attempt is
   * billed, so this is about how annoying escape *is*, not whether it is possible.
   */
  requestOverlay() {
    return call('requestOverlay', {}, { granted: false })
  },

  startRing(label) {
    return call('startRing', { label }, null)
  },

  stopRing() {
    return call('stopRing', {}, null)
  },

  engageLock(untilEpochMs, reason, escapePenaltyMs) {
    return call('engageLock', { until: untilEpochMs, reason: reason ?? '', escapePenaltyMs: escapePenaltyMs ?? 0 }, null)
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

