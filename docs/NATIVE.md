# Making the lockout actually inescapable

> This page is the design map, and it is now implemented: see
> [`APK.md`](APK.md) for the buildable Capacitor project (`android/app/src/main/java/…`,
> hand-written Java) and [`DEVICE_OWNER.md`](DEVICE_OWNER.md) for the provisioning step that
> removes the escape hatch. The snippets below stay in Kotlin because that is what the APIs
> look like in the docs; the shipped code is Java for the same calls.

The web build proves the *rules* (mission → verification → escalating lockout) and the
*interaction design* (no dismiss, one button that only acknowledges being awake, spaced
spoken lines, a live camera hold that is never saved). Two things it cannot do,
by construction of the platform:

1. wake the phone at an exact time from a dead background state, and
2. prevent you from closing/quitting the app or clearing its data during a lockout.

Both are solved on Android with four APIs. This is the migration map.

## 1. Exact alarm that survives reboot and doze

```kotlin
// Fire at the wall-clock minute, not when the OS feels like it.
am.setAlarmClock(
  AlarmManager.AlarmClockInfo(nextFireAt, showIntent),
  PendingIntent.getBroadcast(ctx, reqCode, intent,
    PendingIntent.FLAG_ALLOW_LOCK_WHILE_SCREEN_OFF or PendingIntent.FLAG_UPDATE_CURRENT)
)
```

- `Manifest`: `SCHEDULE_EXACT_ALARM` (or `USE_EXACT_ALARM` for alarm-clock apps, which
  Android grants without a settings dance — this app legitimately qualifies).
- `BOOT_COMPLETED` + `MY_TIME_ZONE_CHANGED`/`TIME_SET` receivers to re-arm every stored alarm.
- The ring is a **foreground service**. Play would prefer `foregroundServiceType="specialUse"` with
  the `alarm-clock` subtype justified at upload time; the shipped side-loaded build uses
  `mediaPlayback`, the type an audio-playing service can actually run under without store review.
  Either way: `setShowWhenLocked(true)`, `setTurnScreenOn(true)`, and a full-screen intent
  notification. That is what lets it
  light the screen and blast audio while the phone is in your pocket, locked, at 07:00:00.

The web equivalent (`setTimeout` + a live tab + `navigator.wakeLock`) is only good enough to
demo the loop.

## 2. The lockout itself

`Screen pinning` is user-defeatable (three-button combo, and the notification shade works).
What you actually want, in ascending order of seriousness:

| Approach | Survives | Cost |
| --- | --- | --- |
| `Activity.setLockTask()` + `startLockTask()` | alt-tab, back, home | user can stop pinning from the system UI |
| `DevicePolicyManager.startLockTask` + `setLockTaskPackages(self)` | alt-tab, home, most settings | needs **device owner** |
| device owner + `addUserRestriction(DISALLOW_SAFE_BOOT, DISALLOW_FACTORY_RESET, DISALLOW_UNINSTALL)` + `DISABLE_KEYGUARD` off | everything except uninstall-via-adb or recovery | needs `adb shell dpm set-device-owner` on a freshly provisioned device (must have no accounts) |
| device owner + `setProfileName` + a companion MDM | remote un-install | you are building an MDM |

```kotlin
// Only the launcher and the dialer are reachable while locked out.
dpm.setLockTaskPackages(cn, arrayOf(ctx.packageName, "com.android.dialer"))
dpm.addUserRestriction(cn, UserManager.DISALLOW_UNINSTALL_APPS)
dpm.setUserRestriction(cn, UserManager.DISALLOW_SAFE_BOOT, true)
activity.recreate()
dpm.startLockTask(activity)          // no "exit" affordance in the system UI
```

`setLockTaskPackages` including the dialer is what makes "only normal calls work" true. On iOS
the equivalent honest answer is Guided Access (`Accessibility → Guided Access`, triple-click to
start/stop) — there is no App Store path to a truly inescapable lock; MDM Supervised Mode is
the only real one.

### Persistence that can't be cleared

Store the lockout deadline in `EncryptedSharedPreferences`, and mirror it into the app's
`DeviceProtectedStorage` credential-encrypted context so deleting app data while the device is
locked still leaves the record. Additionally:

- stamp the deadline with a monotonic clock **and** wall clock, and
- reject any unlock where `SystemClock.elapsedRealtime()` moved less than the remaining time,
  so setting the device clock backwards does not shorten a lockout.
- optional: a cheap server receipt (deadline hash + UTC expiry) for people who would otherwise
  wipe and reinstall. If you add that, it must be opt-in — an app that phones home about your
  sleeping is a different product.

## 3. Optional upgrade: real pose verification

The shipped rules do **not** involve a photograph, and this section is deliberately left as an
option rather than a requirement: the outside proof is a few seconds of live camera measured for
brightness, sky/green ratio and frame-to-frame motion (`src/verify.js`), and the rest of the
mission is spoken. If you want a *pose* step on top of that, the native build is where it belongs
— ~2 ms/frame on-device:

```kotlin
val opts = PoseLandmarker.GraphOptions.builder()
  .setBaseOptions(BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task")
    .setDelegate(GPU).build())
  .setRunningMode(RunningMode.LIVE_STREAM)
  .build()
```

- **Pose:** compare landmark topology against the requested pose — for `superhero` you want
  both wrists below the elbows and elbows wider than the shoulders; for `double-flex`,
  wrist-above-elbow-above-shoulder on both sides. Score 12 keypoint relations, require ≥9.
- **Not a scene of a scene:** moiré/flicker detection plus a challenge-response — the app can
  ask for a random micro-action mid-hold ("now turn all the way to the left") and require the
  motion integral to show it. Cheap, and it kills the tablet-playing-a-video-of-a-window attack.
- **Outside:** `FusedLocationProviderClient` + geofence around the registered bed spot;
  `inside/outside` classification from `TYPE_LIGHT` ambient sensor + `STATUS_FIX` accuracy, and
  (best) `ActivityRecognitionClient` for `IN_VEHICLE / ON_FOOT / STILL` — you must be moving.
- Camera must be `CameraX` with `ImageAnalysis` only — never the gallery — and drop
  `READ_MEDIA_IMAGES` from the manifest entirely so "pick a photo" is not even a capability —
  which is already true here: the manifest asks for `CAMERA` and `RECORD_AUDIO` and nothing that
  could read or write media.

## 4. What to keep from this repo

`src/logic.js` is DOM-free and ports to Kotlin almost line for line: the fire-time search, the
"indoor mission became impossible because you started too late" arithmetic, the line seed
(episode + step index, so a restart cannot reroll you an easier sentence), and the lock ladder.
That module
is the product; the rest is chrome.
