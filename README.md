# Wake or Lock

An alarm clock that does not negotiate. It buzzes, you do a mission, and if you don't — your phone is gone for hours. The longer you keep oversleeping, the longer it stays gone.

Built as a phone-first installable web app (PWA). No build step, no framework, no backend — `node serve.js` and it runs.

## The rules

```
alarm fires
   │
   ├── buzzes CONTINUOUSLY for 5 min ── no snooze button exists in the DOM
   │       │
   │       └── after that it nag-bursts until the deadline (silence never means you got away)
   │
   ├── you tap "I'M AWAKE" → mission starts (30 min hard deadline, from the FIRST BUZZ)
   │       │
   │       ├── OUTSIDE ── 1 photo of where you are + 1 pose selfie
   │       │
   │       └── INDOORS ── 3 photos, ≥10 min apart, each a different random pose
   │                      (start it late and the maths makes it impossible: 2 gaps
   │                       of 10 min don't fit in the 8 minutes you left yourself)
   │
   └── deadline hit, mission incomplete
           │
           └──  LOCKED OUT — strike 1: 1 h · strike 2: 2 h · 3: 4 h · 4: 6 h
                              5: 9 h · 6: 12 h · 7: 18 h · 8+: 24 h. Capped, yours to edit.
                              Only a phone call gets through. Nothing unlocks it early.
```

Succeed once and the ladder resets to strike 1. Every strike is a doubling lesson; you can't grind the punishment away by failing twice in a week.

### Why the mission is shaped like that

- **Random pose, chosen by the app, held for 1.5 s.** A pose you pick yourself is a pose you can do half-asleep with the phone on the nightstand. The app picks it from 18 options (`src/logic.js → POSES`), deterministically seeded per episode+step — so refreshing the page does not reroll a pose you didn't want.
- **3 indoor photos spaced 10 minutes apart.** This is the part Alarmy doesn't do. One photo proves you stood up; three, ten minutes apart, proves you stayed up. The accelerometer must also register movement between shots, so you can't prop the phone against the pillow and wave your hand at it.
- **Outside: 1 scenery + 1 pose selfie.** Faster than the indoor route on purpose — going outside is the behaviour we actually want, so the app should make it the cheap option.
- **Photos must come off the live camera.** There is no `<input type="file">` anywhere in the mission flow; a gallery photo from Tuesday does not exist as a code path.
- **No dismiss, no snooze, no back button.** While the ring or the lock is up, the takeover screen swallows `popstate`, blocks `Escape`, keeps a wake lock, and asks for fullscreen.

## Run it

```bash
node serve.js 5173          # → http://localhost:5173
npm test                    # 31 tests: rules engine + full headless mission flows + no-way-out invariants
node tools/make-icons.mjs   # regenerate the PNG icons from the SDF drawing code
```

Then on a phone: open it over **https**, `⋮ → Add to Home screen`. Camera, geolocation and the vibration API all need a secure context, which is why `serve.js` sends a `Permissions-Policy` header and refuses nothing else.

**Try the loop without waiting a night:** Home → `⏱ 90-second trial`, or `💀 Fail on purpose` to experience the lockout. `Demo timing` (on by default) divides every duration by 60 so a 1-hour lockout takes 1 minute and a 10-minute photo gap takes 10 seconds. Flip it off in Settings and the app is genuinely at your throat again.

## Layout

```
index.html            shell
styles.css            mobile-first dark UI
serve.js              static server + Permissions-Policy, no deps
sw.js                 offline shell; a push handler that explains why push isn't enough
src/
  logic.js            ⬅ PURE. Timings, mission shape, pose picks, lock ladder. No DOM.
  engine.js           state machine: idle → ringing → mission → success | locked → idle
  db.js               IndexedDB (+ localStorage fallback). Episode is persisted on every
                      transition, so a reload resumes the same episode — or locks you out
                      if the deadline blew while the tab was closed.
  audio.js            synthesized siren (ramps 45%→100% over 8 s), vibration, wake lock
  camera.js           live-only capture, motion probe, geolocation
  verify.js           checks: subject-in-frame, pose-held-steady, outdoors, movement
  ui.js               render helpers, hold-to-confirm, bottom sheets
  app.js              router + overlay priority (lock > ring > mission)
views/                home · alarms · mission (ring + capture) · lock · journal · settings
tests/
  logic.test.mjs      the rules, in isolation
  app.test.mjs        jsdom: fire → accept → capture → pass/fail → lock → release
docs/NATIVE.md        what has to change to make the lockout actually inescapable
```

Verification is deliberately transparent: every check returns `{ ok, label, reasons[] }` and the reasons are printed on screen, so a rejection tells you *why* ("sky 0%, green 2%", "held 0.9 s, needed 1.5 s") instead of gaslighting you at 7 a.m.

The pose check is heuristics (frame-diff steadiness + skin/edge signature), not real keypoint ML — offline, zero dependencies, and swappable: `registerPoseVerifier({ name: 'mediapipe', verify() {...} })` in `src/verify.js` replaces it without touching the state machine.

## Honest limits of a browser build

This is a faithful prototype, not a hard lock. Read these before you trust it with your job:

1. **A page cannot lock the OS.** The lockout covers the browser window; you can close the tab, or clear site data, and the record is gone. Real inescapability needs Android Device Owner + `setLockTask` + `DISABLE_KEYGUARD` — see `docs/NATIVE.md`.
2. **Alarms only fire while the app is alive.** Chrome throttles background timers; there is no web API for an exact scheduled wake-up. Native `AlarmManager.setAlarmClock` is the fix. A browser can approximate it only if the tab/PWA stays open with the screen on (which is why the ring screen holds a wake lock).
3. **iOS Safari** gives no vibration API, no geolocation background access, and kills web audio unless the tab is foregrounded. Fine for testing the flow, unreliable as an actual alarm clock.
4. **`testMode` (Test mode in Settings) relaxes the pose, movement and outdoors checks** so the loop is drivable from a laptop or an iframe with no camera. Every shot taken in that mode is flagged `simulated` in your journal, and if you want the honest version: turn it off and test on a phone.
5. **`Panic release` is off by default.** Turning it on adds a 5-second hold on the lock screen that frees you — and logs a strike against you, because "I needed my phone" and "I wanted my phone" look identical at 7 a.m. Turn it on if you have kids, a medical need, or a job that cannot wait an hour.

Everything is stored on-device. There is no server, no account, and no analytics; photos never leave IndexedDB.

## Settings that change the shape of the morning

| Setting | Default | What it does |
| --- | --- | --- |
| `ringMinutes` | 5 | continuous buzz before it switches to nag-bursts |
| `missionWindowMinutes` | 30 | hard deadline from the first buzz |
| `insidePhotos` / `insideSpacingMinutes` | 3 / 10 | indoor mission size and photo spacing |
| `outsidePoseSelfies` | 1 | pose selfies required after the outdoor proof shot |
| `lockHoursCurve` | 1,2,4,6,9,12,18,24 | hours locked, indexed by consecutive strikes |
| `maxLockHours` | 24 | ceiling |
| `escalationNagAfterRing` | on | keep bursting after the 5-minute buzz |
| `panicReleaseEnabled` | off | the hold-to-release escape hatch |
| `demoTiming` | on | ÷60 on every timer, including lockouts |
