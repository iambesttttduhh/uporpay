# The APK

The same JavaScript, inside a real Android app. Capacitor hosts `www/` in a WebView, and a
small hand-written Java layer owns the four things a browser cannot do:

| Concern | Native implementation | Why it matters here |
| --- | --- | --- |
| Waking you at 07:00:00 | `AlarmScheduler.setAlarmClock()` + `USE_EXACT_ALARM` | Doze-throttled `setTimeout` is not an alarm clock |
| Ringing while nothing is open | `RingService` (foreground service, `mediaPlayback`), looping the default alarm tone on `USAGE_ALARM` + vibration + a `PARTIAL_WAKE_LOCK` | The buzz must outlive the UI |
| Showing the lock screen over a locked phone | `setFullScreenIntent` notification + `showWhenLocked`/`turnScreenOn` on the activity | You should not have to unlock to be told you failed |
| Surviving reboot/update/clock changes | `BootReceiver` + `AlarmStore` (SharedPreferences) | Re-arms every schedule, and records anything that fired while the app was dead |

Plus the punishment: `LockGuard` keeps the lockout deadline in prefs, re-applies it on every
launch (including a launch after a reboot), and calls `startLockTask()`.

## Build it

The sandbox this project was written in has no JDK and no route to Google's Maven, so builds
happen on GitHub's runner:

1. **Push to `arena/01a06c90-uporpay`** (or `main`) — `.github/workflows/android-apk.yml` runs on
   every push that touches the app, and always on `workflow_dispatch`.
2. Open **Actions → Android APK → Build debug APK → … → Artifacts → `wake-or-lock-debug-apk`**.
   That is a permanent link tied to the run; the APK inside is debug-signed and side-loadable.
3. For a link that survives forever, run the workflow manually with **"Also attach the APK to the
   rolling wake-or-lock-debug release"** ticked, and the artifact is uploaded to the
   `wake-or-lock-debug` prerelease on the Releases page.

Locally, on any machine with a JDK 17 and the Android SDK:

```bash
npm ci                      # capacitor cli + camera + geolocation
node tools/build-www.mjs    # stages www/ (the WebView payload) — git-ignored, always generated
npx cap sync android         # copies www/ into assets/ and wires the plugins
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

`node tools/make-android-assets.mjs` regenerates the launcher icon, adaptive foreground and
splash from `tools/icon-art.mjs` — the same pixel maths as the PWA icon, so the APK never ships
the Capacitor logo. It is idempotent; run it after `cap add` if you recreate the project.

## Install it

```bash
adb install -r wake-or-lock-debug.apk
```

or copy the file to the phone and open it (allow *install unknown apps* for your file manager).
Installing over an earlier debug build keeps your strike history: same signature, same
`applicationId`, no uninstall dance.

Debug builds are fine forever for personal use. If you want a smaller, upgrade-stable release
build, drop a `keystore.properties` in `android/` (see `android/keystore.properties.example`) —
`app/build.gradle` picks it up and `assembleRelease` signs itself. Never commit the keystore.

## First run checklist (this is what makes it behave like Alarmy)

Settings → **Android engine** shows what the OS actually granted you:

1. **Allow alerts** — without notifications you get no full-screen wake UI (Android 13+ asks).
2. **Exact-alarm access** — denied by default on some Android 12+/13 ROMs; the app cannot flip
   it, only open the switch for you. If this is off, alarms degrade to inexact windows, which
   silently destroys the 5-minute-buzz rule.
3. **Unrestricted battery** — the single most common reason a 07:00 alarm does not fire on
   Xiaomi/Oppo/Vivo/Samsung ROMs. Autostart / "allow background activity" is a separate switch on
   those skins.
4. Lock enforcement will read **lock task (best effort)**. That is honest: a side-loaded app
   pins itself with `startLockTask()`, and Android shows a system "Unpin" affordance. See
   [`DEVICE_OWNER.md`](DEVICE_OWNER.md) for the version that has no exit button.

## What the APK adds to the rules

- **Missed while closed**: an alarm that fired with the app dead is recorded natively. On the
  next launch you either get the mission with only the time you have left, or — if the 30-minute
  window already ran out — a strike and a lockout, computed from the moment it rang. Toggle
  `lockOnMissedWhileClosed` in Settings if you want that forgiven.
- **The buzz keeps going during the mission** on Android (the service owns audio, so the ring is
  not stopped when you accept — the web build degrades to nag bursts instead). Completing the
  mission stops the service.
- **Camera**: the live pose preview uses the WebView's `getUserMedia` when Android lets it work.
  If it does not, the app silently switches each shot to the native CameraX shutter — real
  pixels, no gallery path, and test mode stays *off*. The one thing that path cannot check is
  hold-steadiness between frames, so pose geometry, subject, motion-free and the outdoor
  signature still apply, and the 10-minute spacing rule is enforced by the clock.
- **GPS** for the outdoor check comes from the OS location client, so it works with the screen off.

## Release notes / versioning

`android/app/build.gradle` holds `versionCode` / `versionName`. Bump `versionCode` for anything
you intend to install over a previous build; Android refuses a downgrade.

## Files

```
capacitor.config.json                        appId com.uporpay.wakeorlock, webDir www
tools/build-www.mjs                          stages www/ + writes www/native.json (the APK marker)
tools/make-android-assets.mjs                launcher/splash/notification art from icon-art.mjs
src/native.js                                the whole JS↔Android seam; inert in a browser
android/app/src/main/java/com/uporpay/wakeorlock/
  MainActivity.java     — reads the alarm that launched us, re-applies the lock
  WakeOrLockPlugin.java — the 16 methods JS calls
  AlarmScheduler.java   — setAlarmClock with inexact fallbacks
  AlarmStore.java       — alarms + "fired but never acknowledged" in prefs
  AlarmReceiver.java    — records the firing, posts the full-screen notification, starts the service
  RingService.java      — looping tone, vibration, wake lock
  Channels.java         — ALARM (high, bypass DND) + RING channels
  LockGuard.java        — lockout deadline, lock task, device-owner path
  BootReceiver.java     — reboot/update/clock-change re-arm
  AppDeviceReceiver.java — needed for device-owner lock-task policy
tests/native.test.mjs   — proves the seam degrades safely and drives Java with the right args
```

`MainActivity` is Java, not Kotlin — the Capacitor template ships no Kotlin plugin, and adding one
buys nothing here.
