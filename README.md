# Wake or Lock

An alarm clock that does not negotiate. It buzzes, you do a mission, and if you don't — your phone is gone for hours. The longer you keep oversleeping, the longer it stays gone.

Built as a phone-first installable web app (PWA). No build step, no framework, no backend — `node serve.js` and it runs. The same code also ships as a real **Android APK** with native `AlarmManager` alarms, a foreground ring service and a lock-task host: [docs/APK.md](docs/APK.md).

## The rules

```
alarm fires
   │
   ├── buzzes CONTINUOUSLY for 5 min ── no snooze button exists in the DOM
   │       │
   │       └── after that it nag-bursts until the deadline (silence never means you got away)
   │
   ├── you tap "I'M AWAKE" → mission starts (20 min hard deadline, from the FIRST BUZZ)
   │       │
   │       ├── OUTSIDE ── 12 s of your surroundings on the live camera (it must be
   │       │              bright, have sky or green in it, and it must MOVE) and
   │       │              then 2 lines of English the app picks for you, spoken
   │       │              into the mic — nothing is photographed, nothing is stored
   │       │
   │       └── INDOORS ── say 3 lines, 1 minute apart, each a different sentence
   │                      chosen by the app (start it late and the maths makes it
   │                      impossible: 2 gaps of a minute do not fit in the time left)
   │
   └── deadline hit, mission incomplete
           │
           └──  LOCKED OUT — strike 1: 1 h · strike 2: 2 h · … · strike 10: 10 h.
                              Never tapped awake at all: 20 h, whatever your strike.
                              Only a phone call gets through. Nothing unlocks it early,
                              and the same alarm is re-armed when the time is served.
```

Succeed once and the ladder resets to strike 1. Ten failed mornings is a ten-hour lock, and oversleeping the whole thing (never tapping awake) is the 20-hour one — the number you get when you were asleep through the alarm entirely, so there is no version of "just ignore it" that is cheaper than getting up.

### Why the mission is shaped like that

- **The sentence is chosen by the app.** You do not get to pick something you can mumble. `src/logic.js → LINES` holds 16 of them, and the one you owe is picked deterministically from the episode seed + step index, so refreshing the page cannot reroll you an easier line.
- **3 lines, a minute apart, indoors.** This is the part Alarmy doesn't do. Saying one sentence proves you are awake; saying three, a minute apart, proves you stayed up. The mic must actually see audio while you speak — the recogniser will happily invent words in a silent room, so a peak below the noise floor is a rejection even when the transcript looks perfect.
- **Outside: hold the camera on your surroundings for 12 s, then speak.** The scene has to be lit, contain sky or greenery, and change while you hold it (frame-to-frame difference on a 160px sample), and GPS is checked against where you slept if a fix is available. It is faster than the indoor route on purpose: going outside is the behaviour we actually want, so the app makes it the cheap option.
- **No photographs. None.** There is no `<input type="file">`, no `toDataURL`, no `MediaRecorder` and no `captureStream` in the mission flow — the app cannot produce an image file even if it wanted to. Proof is a live view plus a spoken sentence, and what lands in the journal is a score, a mic peak and a duration.
- **Getting out is charged, not allowed.** In the APK, unpinning the task, going home, or force-stopping the app is noticed by a leash loop in the foreground service: it bills the escape (15 min each, capped at 4 h by default) and drags the lock screen back to the front. Rebooting re-applies the remaining time from `BootReceiver`.
- **The typed channel is for deaf devices only.** If there is no microphone or no speech recogniser, the sentence has to be typed into a box that refuses pasting — same sentence, same minute-long gaps, and a stricter match (85% of the words, in order). It is *rejected outright* on a device that can hear you, so "deny the microphone permission" is not a shortcut, and every proof records which channel satisfied it (`voice`, `typed`, `simulated`) in the journal.
- **The clock is not an exit.** The app stamps the last moment it saw the wall clock and, inside one session, compares it against a monotonic timer that no settings screen can move. Wind the time back at 07:00 and the lockout simply grows by the time you appeared to take; a rewind during a mission is subtracted from the mission window instead, so the clock buys nothing in either direction. Only jumps past two minutes count, so NTP corrections do not trip it — and a timezone change cannot, because `Date.now()` is the epoch and only the calendar moves. Every attempt is journaled as ⏱ with the time added back.
- **No dismiss, no snooze, no back button.** While the ring or the lock is up, the takeover screen swallows `popstate`, blocks `Escape`, keeps a wake lock, and asks for fullscreen.
- **A web page cannot lock the operating system.** The browser build covers the page, swallows the back button and bills you for hiding the tab, and the alarm fires as long as the tab (or the installed PWA) is alive. The APK is what rings from a dead background state and holds the screen; see `docs/NATIVE.md`, `docs/APK.md` and `docs/DEVICE_OWNER.md`.

## Run it

**Requirements:** Node 18+ (that's it — no build step, no dependencies at runtime, `npm install` is only for the test runner's jsdom).

```bash
node serve.js              # → http://localhost:5173
npm test                   # 65 tests, if you want to see the rules prove themselves
node serve.js --https      # self-signed cert, minted into ./certs on first run
```

Then press **`⏱ 90-second trial`** on Home. Demo timing is on, so the 30-minute mission window is 30 seconds and a 1-hour lockout is 1 minute — you can see the whole loop, punishment included, before you commit a morning to it.

### On a phone (where it stops being a demo)

The camera, GPS, wake lock and service worker are all **secure-context only**. `http://localhost` counts as secure; `http://192.168.1.20:5173` does not — so opening the LAN address on your phone gives you a silent camera denial and no install prompt. Three ways out:

| Method | Command | Notes |
| --- | --- | --- |
| **Self-signed https** (any phone) | `node serve.js --https`, open the printed `https://<lan-ip>:5173` | Chrome warns; tap *Advanced → Proceed*. Camera and geolocation then work normally. |
| **adb reverse** (Android, best) | `adb reverse tcp:5173 tcp:5173` then `http://localhost:5173` *on the phone* | localhost is a trusted origin, so no cert warning, no tap-through, full permissions |
| **iOS** | `--https`, open it in Safari, tap *Show Details → visit this website* | That works per-load. To stop re-accepting: AirDrop `certs/cert.pem` to the phone, install the profile, then Settings → General → About → Certificate Trust Settings → enable full trust. iOS also gives no vibration API and suspends web audio in a backgrounded tab — fine for testing the loop, unreliable as an actual alarm |

**Install it:** Chrome/Edge on Android → `⋮` → *Add to Home screen*. It then runs fullscreen, keeps its own window, and reads IndexedDB like an app. Safari/iOS → Share → Add to Home Screen (same caveats as above).

**Before you trust it with a workday:** flip **Settings → Demo timing** off. Otherwise the alarm clock is politely ÷60.

### As an APK (the version that works when the app is closed)

**Download the current build:** [wake-or-lock-debug.apk (6.8 MB, debug-signed)](https://github.com/iambesttttduhh/uporpay/releases/download/wake-or-lock-debug/wake-or-lock-debug.apk)
— published by CI from the latest `android/` in this repo. You need to be signed in to GitHub
(the repo is private). Install it directly, or over USB with `adb install -r`.

What is inside it: `AlarmManager.setAlarmClock` wake-ups that fire with the app killed, a
foreground ring service on the alarm audio stream, a full-screen alarm UI over a locked screen,
boot/update re-arming, a strike record in `SharedPreferences`, and `startLockTask()` confinement
that only a device-owner provisioning can make truly inescapable. See
[docs/APK.md](docs/APK.md) for the permission checklist and [docs/DEVICE_OWNER.md](docs/DEVICE_OWNER.md)
for the hard version.


```bash
npm ci
node tools/build-www.mjs      # stages www/ (the WebView payload) + the native marker
npx cap add android           # first time only
npx cap sync android
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

You do not have to run any of that if GitHub Actions is enough for you: push, then download
`wake-or-lock-debug.apk` from the **Android APK** workflow's artifacts (or from the
`wake-or-lock-debug` release, if you ticked *publish* when running it manually). Full walkthrough,
permissions, the "why is my alarm not firing on a Xiaomi" checklist and what is still escapable:
**[docs/APK.md](docs/APK.md)**. Provisioning the device-owner build that removes the escape hatch:
**[docs/DEVICE_OWNER.md](docs/DEVICE_OWNER.md)**.

⚠️ One honest warning that has nothing to do with bugs: an app that confiscates your phone at 7 a.m. is a bad idea if your morning has anything in it that needs a phone — a kid, a commute you navigate, a work ping. Turn on *Panic release* in Settings if there's any chance of that, or don't run the native build at all.

## Layout

```
index.html            shell
styles.css            mobile-first dark UI
serve.js              static server + Permissions-Policy, no deps
sw.js                 offline shell; a push handler that explains why push isn't enough
src/
  logic.js            ⬅ PURE. Timings, mission shape, line picks, lock ladder. No DOM.
  engine.js           state machine: idle → ringing → mission → success | locked → idle
  db.js               IndexedDB (+ localStorage fallback). Episode is persisted on every
                      transition, so a reload resumes the same episode — or locks you out
                      if the deadline blew while the tab was closed.
  audio.js            synthesized siren (ramps 45%→100% over 8 s), vibration, wake lock
  camera.js           live-only capture, motion probe, geolocation
  verify.js           checks on live pixels: outdoors (light/sky/green), movement
  ui.js               render helpers, hold-to-confirm, bottom sheets
  app.js              router + overlay priority (lock > ring > mission)
views/                home · alarms · mission (ring + capture) · lock · journal · settings
tests/
  logic.test.mjs      the rules, in isolation
  app.test.mjs        jsdom: fire → accept → capture → pass/fail → lock → release
  boot.test.mjs       the real entrypoint boots clean in jsdom
  admin.test.mjs      the lease changes engine behaviour, not just the UI
  native.test.mjs     the Android seam: inert in a browser, correct calls with a fake bridge
tools/
  make-icons.mjs      PWA icons, drawn in pure node (no ImageMagick in the sandbox)
  icon-art.mjs        the artwork itself — one source for PWA icon and launcher icon
  build-www.mjs       stages www/ for Capacitor and drops the native marker
  make-android-assets.mjs  launcher/adaptive/splash/notification PNGs into android/res
capacitor.config.json  appId com.uporpay.wakeorlock, webDir www
android/               the real Gradle project (Java, no Kotlin) — see docs/APK.md
.github/workflows/android-apk.yml   builds the APK on Actions and publishes it as a release asset
docs/NATIVE.md          what has to change to make the lockout actually inescapable (design map)
docs/APK.md             building, installing and configuring the APK
docs/DEVICE_OWNER.md    provisioning the version with no exit button
```

Verification is deliberately transparent: every check returns `{ ok, label, reasons[] }` and the reasons are printed on screen, so a rejection tells you *why* ("sky 0%, green 2%", "held 0.9 s, needed 1.5 s") instead of gaslighting you at 7 a.m.

The "you are outside" check is heuristics over a few downsampled frames (mean luminance, sky and green ratios, frame-to-frame motion), not a scene classifier — offline, zero dependencies, and deliberately not a photograph. The speech check compares the recogniser's transcript against the required sentence as a word subsequence, so reading the line in order passes and picking the words out of a hat does not. If you want a real keypoint model on top, `docs/NATIVE.md` documents where it would go; nothing in the current rules depends on it.

## Admin lease (the "test account")

There is no server, so there are no accounts — what exists instead is a **PIN-gated session lease** that changes what the *state machine* does, not just what a screen shows.

Reach it: bottom nav → 🔐 Admin, or long-press the header. Factory PIN **`0000`** (change it in the console).

| Switch | Effect |
| --- | --- |
| **No lockouts** (default on) | A blown mission closes as `bypassed` — ring stops, no lock screen, **no strike**. Enforced in `engine._fail()` via `logic.shouldLockOut()` |
| Auto-pass captures | Any frame is accepted; the checks still run and each rejection is stored, marked `autoPassed` |
| Ignore line gaps | Say all 3 indoor lines in one second |
| Silent ring | Full takeover UI, no siren, no vibration |

Plus a punishment lab (preview the lock screen for 30 s / 2 min without touching your record, grant or revoke real strikes, edit the ladder live), an episode sandbox (fire a rigged alarm, fast-forward the buzz / deadline / lockout, abort an episode), and state inspection + full export.

Three design decisions worth knowing:

- **It expires.** The lease defaults to 240 minutes, then the app punishes you again. "Never expire" exists, and the UI calls you out for choosing it — otherwise you'd wake up next Tuesday to an alarm clock you quietly neutered.
- **Every admin action is journaled** (`bypass`, `admin_on`, `admin_abort`, `admin_config`, and wrong-PIN attempts), so a test run can never be mistaken for a clean streak. Bypasses do not move the ladder in either direction.
- **It is a guardrail, not security.** Anyone holding the phone can read the PIN out of IndexedDB; a web app has no keychain and no server to check against. The APK keeps it exactly as weak — Keystore + BiometricPrompt is designed in `docs/NATIVE.md` but not implemented, so do not treat the PIN as a lock on anybody else.

## Honest limits

Read these before you trust it with your job. Items 1–2 are fixed by the APK; items 3–5 apply to both builds.

1. **A page cannot lock the OS.** The browser lockout covers the window; you can close the tab, or clear site data, and the record is gone. The APK fixes the *covering* part with `startLockTask()`, but a side-loaded app always keeps Android's "Unpin" affordance — only `adb shell dpm set-device-owner` removes it ([docs/DEVICE_OWNER.md](docs/DEVICE_OWNER.md)).
2. **In a browser, alarms only fire while the app is alive.** Chrome throttles background timers; there is no web API for an exact scheduled wake-up. The APK uses `AlarmManager.setAlarmClock` + a foreground service, which is the whole reason to install it. A browser can approximate it only if the tab/PWA stays open with the screen on (which is why the ring screen holds a wake lock).
3. **iOS Safari** gives no vibration API, no geolocation background access, and kills web audio unless the tab is foregrounded. Fine for testing the flow, unreliable as an actual alarm clock.
4. **`testMode` (Test mode in Settings) relaxes the movement and outdoors checks and lets a line be simulated** so the loop is drivable from a laptop or an iframe with no camera or mic. Every proof taken in that mode is flagged `simulated` in your journal, and the lock screen says so. If you want the honest version: turn it off and test on a phone.
5. **`Panic release` is off by default.** Turning it on adds a 5-second hold on the lock screen that frees you — and logs a strike against you, because "I needed my phone" and "I wanted my phone" look identical at 7 a.m. Turn it on if you have kids, a medical need, or a job that cannot wait an hour.

Everything is stored on-device. There is no server, no account, and no analytics. There is also nothing image-shaped to leak: no photograph is ever taken, and no audio is written to disk — the microphone is opened, measured for a few seconds, and closed.

## Settings that change the shape of the morning

| Setting | Default | What it does |
| --- | --- | --- |
| `ringMinutes` | 5 | continuous buzz before it switches to nag-bursts |
| `missionWindowMinutes` | 30 | hard deadline from the first buzz |
| `insideLines` / `insideLineGapMinutes` | 3 / 1 | indoor mission size and the gap between lines |
| `outsideSceneSeconds` / `outsideLines` | 12 / 2 | how long the surroundings are held, and how many lines after it |
| `speechMatch` / `micLevelMin` | 0.6 / 0.03 | share of the sentence that must be heard, and the noise floor |
| `neverWokeLockHours` | 20 | the lock for oversleeping the window without tapping awake |
| `reArmAfterLockout` | true | the same alarm comes back when the lockout is served |
| `escapePenaltyMinutes` / `escapePenaltyCapMinutes` | 15 / 240 | price of unpinning / going home / rebooting |
| `lockHoursCurve` | 1,2,4,6,9,12,18,24 | hours locked, indexed by consecutive strikes |
| `maxLockHours` | 24 | ceiling |
| `escalationNagAfterRing` | on | keep bursting after the 5-minute buzz |
| `panicReleaseEnabled` | off | the hold-to-release escape hatch |
| `demoTiming` | on | ÷60 on every timer, including lockouts |
