# WakeLock

**WAKE UP. TAKE CONTROL.**
*You don't dismiss the alarm. You earn your way out.*

WakeLock is an Android alarm and morning-discipline app. You pre-commit — while awake and
rational the night before — to a wake-up condition your half-asleep self cannot shortcut:
to stop the alarm you must **say a set of randomised lines out loud**, verified by on-device
speech recognition, inside a time limit you chose.

> **Status: BETA (0.9.0-beta, versionCode 1).** Real, working build — not a production release.

---

## Download / Build

Prebuilt APKs from the last CI run are committed in [`dist/`](dist/):

| File | Notes |
|---|---|
| `dist/app-debug.apk` | Installable directly; includes test tools & diagnostics |
| `dist/app-release-unsigned.apk` | R8-shrunk; must be signed before installing |

Install the debug build:

```bash
adb install -r dist/app-debug.apk
```

### Building from source

Requirements: **JDK 17**, Android SDK (compileSdk 35, build-tools 35), Android Studio Ladybug+.

```bash
./gradlew :app:assembleDebug        # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease      # -> app/build/outputs/apk/release/app-release-unsigned.apk
./gradlew :app:testDebugUnitTest    # 26 unit tests
./gradlew :app:connectedDebugAndroidTest   # instrumented tests (needs a device/emulator)
```

Signing a release APK:

```bash
keytool -genkey -v -keystore wakelock.jks -keyalg RSA -keysize 2048 -validity 10000 -alias wakelock
apksigner sign --ks wakelock.jks --out app-release.apk app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## What actually works

Every feature listed below is implemented with real logic and persistence — no placeholder screens.

**Alarm engine** — create/edit/delete/enable multiple alarms, repeat modes (once/daily/weekdays/
weekends/custom days), exact scheduling via `setAlarmClock()`, honest degradation to
`setAndAllowWhileIdle()` when exact alarms aren't permitted, reschedule on boot/time/timezone change,
real alarm audio (looping, `USAGE_ALARM`) and three vibration patterns.

**Challenge engine** — 555 bundled lines across 12 categories, weighted random selection with a
14-day reuse cooldown and least-recently-used fallback when the pool is exhausted. Lines are frozen
per session: restarting the app restores the *same* lines, index and deadline.

**Speech verification** — real `SpeechRecognizer` (prefers on-device), with a tolerant matcher:
normalisation → contraction expansion → homophone/filler handling → token-set ratio + Levenshtein.
Three sensitivity levels. Accepts accents and recogniser typos; rejects silence and unrelated speech.

**Deadline-based timer** — remaining time is computed from a persisted wall-clock deadline, never a
per-second counter, so backgrounding, recomposition or process death cannot cheat or break it.
Warnings at 50% / 25% / 10%.

**Failure actions** — Keep trying · New challenge · Harder challenge · Outside mode · Lockdown,
each fully implemented and recorded in history.

**Adaptive time** — rolling median of recent completions × 1.4 safety margin, hard-clamped to the
user's min/max, moving at most ±1 minute per recalculation, with a plain-English explanation.

**Outside Mode** — fuses ambient light, accelerometer movement and location displacement; requires
two available signals to agree; degrades gracefully with missing sensors; then two extra spoken lines.

**Lockdown** — explicit informed consent dialog; NORMAL mode uses full-screen-over-lockscreen +
foreground service + persisted state + no dismiss route; MAXIMUM mode uses genuine
`DevicePolicyManager` Lock Task when the device is provisioned as Device Owner.

**Stats / streaks / achievements / history** — computed from a real event log, with charts.

**Test tooling** — “Test this alarm now” and the developer diagnostics panel drive the **real**
pipeline (`AlarmReceiver → foreground service → challenge`), never a mock UI. Exit code `0000`
ends test challenges only and is gated behind the `TEST_TOOLS` build flag.

---

## Architecture

```
com.wakelock/
├── domain/       speech matcher, adaptive engine, models   (pure Kotlin, unit-tested)
├── data/         Room entities/DAOs, repositories, DataStore settings
├── alarm/        AlarmScheduler, AlarmReceiver, BootReceiver
├── service/      AlarmForegroundService (state machine owner), AlarmAudio
├── speech/       SpeechRecognizer wrapper
├── outside/      multi-signal verifier
├── lockdown/     normal + Device Owner / Lock Task
├── notifications/ channels & builders
└── ui/           Compose screens (onboarding, home, edit, alarm, stats, history, settings, help, dev)
```

The **foreground service is the single source of truth**. The UI observes its `StateFlow` and pushes
user actions in; it never drives alarm state directly. State transitions persist to Room on every step.

Stack: Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Coroutines/Flow · AlarmManager ·
minSdk 26 · targetSdk 35.

---

## Permissions

| Permission | When it is requested | Why |
|---|---|---|
| `POST_NOTIFICATIONS` | Onboarding | Alarm and challenge notifications |
| `RECORD_AUDIO` | First speaking challenge | Verify spoken lines |
| `SCHEDULE_EXACT_ALARM` | Alarm setup | Fire alarms at the exact time |
| `ACCESS_*_LOCATION` | Enabling Outside Mode | Detect that you moved away |
| `ACTIVITY_RECOGNITION` | Enabling Outside Mode | Detect walking |
| `FOREGROUND_SERVICE` | While an alarm rings | Keep sound/timer alive |

**Privacy:** no raw voice recordings are stored, nothing is uploaded, no facial recognition,
no background location outside an active Outside verification, no analytics SDKs.

---

## Testing

- **26 unit tests** — speech matching (accents, typos, nonsense rejection), adaptive clamping and
  gradual movement, schedule maths for every repeat mode, streak/stats/achievement logic.
- **10 instrumented tests** on an emulator — DB seeding (≥500 lines), real alarm scheduling,
  session freeze/restore, completion recording, failure + action recording, Outside line appending,
  plus a UI smoke test that launches the app and walks onboarding.

See [`docs/QA.md`](docs/QA.md) for the manual checklist and [`docs/ANDROID_LIMITATIONS.md`](docs/ANDROID_LIMITATIONS.md)
for exactly what Android does and does not permit.

## Device Owner (Maximum Lockdown) setup

On a factory-reset device with no accounts configured:

```bash
adb shell dpm set-device-owner com.wakelock/.lockdown.WakeLockDeviceAdminReceiver
```

WakeLock detects this at runtime and shows the active mode in Settings → Lockdown.
It never provisions itself silently. Emergency calling always remains available.
