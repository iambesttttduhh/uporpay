# WAKELOCK — SINGLE MASTER BUILD PROMPT (v3, all-inclusive)

> Copy everything between the two `====` markers into your AI app builder / coding agent as one prompt.
> It contains the product spec, architecture, state machine, brand + icon generation, QA plan and acceptance criteria.

============================================================

## ROLE

You are a senior Android product team compressed into one agent:
staff-level Android engineer, mobile architect, product designer, brand/identity designer, and QA lead.

You do not explain how to build this. **You build it.** You create the project, write the code, generate the brand assets, compile it, fix the errors, and hand back a buildable Android Studio project plus APK instructions.

## THE PRODUCT

Build a complete, production-quality Android application called:

**WAKELOCK**
Tagline: **WAKE UP. TAKE CONTROL.**
Promise: **You don't dismiss the alarm. You earn your way out.**

WakeLock is an alarm + morning-discipline app. The user voluntarily configures an alarm that cannot be casually dismissed: to stop it they must complete a randomized **spoken challenge** (say N required lines out loud, verified by speech recognition) inside a configurable time limit, optionally after proving they physically went outside, optionally under a consented lockdown.

This is a **real functional Android application**, not a UI prototype, not a mockup, not a slide deck of screens. Every screen shown must be backed by working logic and real persistence.

---

## 0. NON-NEGOTIABLE GROUND RULES (read before writing any code)

1. **No fake functionality.** If a button exists, it works. If a stat is shown, it is computed from stored data. If a feature is blocked by Android, show an honest explanation instead of a fake success.
2. **Consent first.** Nothing that restricts device usage may be enabled silently. Every restrictive feature requires an explicit, informed opt-in dialog.
3. **Legitimate APIs only.** No exploits, no root, no hidden device-admin escalation, no AccessibilityService abuse, no self-hiding, no blocking emergency calls / shutdown / recovery / factory reset.
4. **No false claims.** Never advertise "impossible to escape." Say: *"WakeLock applies the strongest restrictions your device legitimately allows."*
5. **Reliability beats feature count.** A rock-solid alarm + challenge loop is worth more than 40 half-built screens.
6. **Ship the build, not the plan.** Compile it. Run the unit tests. Fix every compilation and runtime error before you report done.
7. **Original identity.** Do not copy Alarmy, Digital Detox, or any competitor's UI, icon, copy, or assets.

---

## 1. PRODUCT VISION & PERSONALITY

Problem: people kill the alarm half-asleep and go straight back to bed.
Solution: the user pre-commits, while awake and rational the night before, to a wake-up condition their half-asleep self cannot shortcut.

Emotional design contract:
- **Outside the alarm:** calm, premium, quiet, confident. Feels like a well-designed productivity tool.
- **During the alarm:** urgent, high-contrast, commanding, slightly intimidating — but never chaotic, never insulting, always readable by a disoriented person at 05:00.

Brand adjectives: powerful, modern, premium, disciplined, focused, energetic.
Anti-adjectives: childish, cutesy, meme-y, cluttered, generic-motivational.

---

## 2. BRAND IDENTITY & APP ICON — **GENERATE THE ASSETS, DO NOT JUST DESCRIBE THEM**

If your environment can generate images/vectors, **produce the actual files as part of the build.** If it cannot rasterize, produce hand-authored **Android vector drawables (XML paths)** for every mark — those are code, and you can always write them.

### 2.1 Concept

A bold, minimalist, geometric symbol that fuses:
- a **modern alarm clock** (abstracted circular body — no cute bells, no ticking face, no cartoon feet)
- a **rising sun / light burst** emerging from behind it
- a **subtle lock or shield** silhouette (the shackle arc can double as the clock's bell arc — that pun is the brand)
- a sense of **upward motion / awakening**

Message: *Wake up. Take control.* / *"You are awake, and you're in control."*

Explicitly forbidden: generic stock alarm clock, emoji look, cartoon style, photorealism, tiny detail, text or letters inside the launcher icon, gradients that vanish at 48 px, any competitor mark.

### 2.2 Internal variation process (mandatory)

Produce **at least 4 distinct concepts** before choosing, e.g.:
- A. Lock shackle = clock bells arc, sun rays fanning from behind the body
- B. Shield outline containing a clock hand pointing up like a sunrise beam
- C. Keyhole negative space inside a sun disc, horizon line cutting the lower third
- D. Upward chevron/arrow formed by clock hands breaking through a horizon line

Score each 1–5 on: recognition at 48 px, distinctiveness, brand relevance, simplicity, adaptive-icon safety, app-store shelf appeal, dark/light compatibility, monochrome survivability. Document the scoring table in `docs/BRAND.md`, then **pick one winner** and use it everywhere. The winner is the official WakeLock mark.

### 2.3 Required assets

| Asset | Format / location |
|---|---|
| Adaptive foreground | `res/drawable/ic_launcher_foreground.xml` (vector) |
| Adaptive background | `res/drawable/ic_launcher_background.xml` (vector, flat/near-flat) |
| Monochrome layer (Android 13+ themed icons) | `res/drawable/ic_launcher_monochrome.xml` |
| Adaptive icon config | `res/mipmap-anydpi-v26/ic_launcher.xml` + `ic_launcher_round.xml` |
| Legacy PNG launcher icons | mipmap mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi (48/72/96/144/192 px) |
| Play Store icon | `store/ic_wakelock_512.png` (512×512) |
| Splash logo | `res/drawable/ic_splash_logo.xml` (Android 12+ SplashScreen API) |
| In-app logo | `res/drawable/ic_wakelock_logo.xml` |
| Notification icon | `res/drawable/ic_notification.xml` — **pure white silhouette on transparent**, no color, simplified |
| Horizontal lockup `[ICON] WAKELOCK` | `res/drawable/ic_logo_lockup.xml` + `store/lockup.png` |
| Feature graphic concept | `store/feature_graphic_1024x500.png` |

### 2.4 Technical icon rules

- Adaptive icon canvas 108×108 dp; keep the mark inside the **66 dp safe circle**; nothing critical outside 72 dp. Verify it survives circle, squircle, rounded-square and teardrop masks.
- Strong single silhouette — it must read as one shape, not three glued shapes.
- Must look correct in: full color, pure white on dark, pure black on light, monochrome/themed.
- Stroke weights heavy enough to survive 48 px. No stroke thinner than ~2 dp at 48 px equivalent.
- Vector first; PNGs are exports of the vector, not redraws.

### 2.5 Color direction

Deep dark base + energetic sunrise accent. Do not overuse colors — 2 accents maximum in the mark.

```
Ink / base        #0B0D12   (near-black, cool)
Surface           #14171F
Sunrise Amber     #FFB020   (primary accent)
Sunrise Orange    #FF7A18   (secondary accent / gradient partner)
Urgency Red       #FF3B30   (alarm state, timer <10%, failure only)
Neutral Light     #F5F6F8
Success           #34C77B   (verified line only, used sparingly)
```

Expose these as Compose design tokens (`WakeLockColors`, `WakeLockTypography`, `WakeLockShapes`, `WakeLockSpacing`) in a single theme package. No hard-coded hex values anywhere else in the codebase.

### 2.6 Wordmark

A modern, tight, geometric-sans wordmark: `WAKELOCK` in uppercase, slightly condensed, generous letter-spacing, "WAKE" in light neutral and "LOCK" in amber (or one weight step heavier) so the compound reads instantly. Ship the lockup as a vector. The symbol must stand alone without the word.

### 2.7 Splash

Android 12+ `SplashScreen` API. Dark base, centered mark, brief (≤ ~900 ms perceived) entrance: mark scales 0.92 → 1.0 with a light sweep across the sunrise element, then `WAKE UP. TAKE CONTROL.` fades in under it. No long animation, no forced delay, no "loading" theatre.

---

## 3. TECH STACK

Kotlin • Jetpack Compose • Material 3 • AndroidX • Room • DataStore (Preferences + Proto where useful) • WorkManager (housekeeping only, never for alarm firing) • AlarmManager (`setAlarmClock`/exact) • Foreground Service (type `mediaPlayback`/`specialUse` as appropriate) • `SpeechRecognizer` (with on-device `EXTRA_PREFER_OFFLINE` when available) • DevicePolicyManager + Lock Task where legitimately applicable • Hilt for DI • kotlinx-coroutines + Flow • Compose Navigation.

- `minSdk 26` preferred (28 acceptable), `targetSdk` = latest stable, Java 17, Gradle Kotlin DSL, version catalog (`libs.versions.toml`).
- Handle SDK-gated APIs (POST_NOTIFICATIONS 33+, SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM 31+/33+, FGS types 34+, monochrome icons 33+) with proper version checks.

---

## 4. ARCHITECTURE

Clean-ish layered architecture, multi-package, no God classes. Nothing meaningful lives in `MainActivity`.

```
com.wakelock/
├── core/            design system, theme, tokens, common ui, haptics, time utils
├── data/
│   ├── db/          Room entities, DAOs, database, migrations, seeding
│   ├── prefs/       DataStore settings repositories
│   ├── repo/        AlarmRepository, ChallengeRepository, StatsRepository, LineRepository
│   └── seed/        challenge line seed data (assets/json) + importer
├── domain/
│   ├── model/       pure Kotlin models
│   └── usecase/     ScheduleAlarm, GenerateChallenge, VerifySpeech, RecommendTime,
│                    EvaluateOutside, UpdateStreak, ApplyFailureAction, ...
├── alarm/           AlarmScheduler, AlarmReceiver, BootReceiver, TimeChangeReceiver
├── service/         AlarmForegroundService, AudioController, VibrationController
├── challenge/       ChallengeEngine, ChallengeStateMachine, timer, persistence
├── speech/          SpeechRecognizerClient, SpeechMatcher (fuzzy), availability probes
├── outside/         sensor fusion: location, activity, light, optional camera
├── lockdown/        NormalLockdownController, DeviceOwnerLockdownController, consent
├── notifications/   channels, builders
├── statistics/      aggregation, achievements engine
├── ui/
│   ├── onboarding/ home/ alarmedit/ alarmscreen/ stats/ history/ settings/
│   ├── help/ achievements/ devpanel/
│   └── navigation/
└── di/              Hilt modules
```

Rules: ViewModels expose a single immutable `UiState` via `StateFlow`; UI is stateless and driven by state; all IO in repositories; use cases hold business rules; the challenge state machine is **pure and unit-testable**, with persistence as an adapter.

---

## 5. DATA MODEL (Room)

```kotlin
Alarm(
  id, name, hour, minute, repeatDays: Set<DayOfWeek>, enabled,
  soundUri, soundVolume, vibrationEnabled, vibrationPattern,
  challengeType, lineCount, lineCategories: Set<Category>,
  timeLimitSeconds, adaptiveTimeEnabled, adaptiveMinSeconds, adaptiveMaxSeconds,
  adaptiveDifficultyEnabled, speechSensitivity,
  lockdownEnabled, lockdownConsentedAt, failureAction, lockdownDurationMinutes,
  outsideModeEnabled, outsideSignals: Set<Signal>,
  snoozeEnabled, snoozeMinutes, maxSnoozes,
  createdAt, updatedAt, lastConfirmedAt
)

ChallengeSession(
  id, alarmId, occurrenceEpoch, state, lineIds: List<Long>, currentIndex,
  startedAt, deadlineAt, pausedRemainingMs, completedAt, completionMs,
  attempts, failedAttempts, snoozesUsed, outsideVerifiedAt, result
)

ChallengeLine(id, text, category, difficulty, lastUsedAt, useCount)

WakeEvent(  // history row, one per alarm occurrence
  id, alarmId, date, scheduledAt, firedAt, resolvedAt, result,
  challengeType, lineCount, completionMs, snoozes, outsideUsed, failureActionApplied
)

Achievement(id, key, unlockedAt, progress, target)

LockdownState(id, active, startedAt, endsAt, reason, mode)  // survives process death
```

DataStore holds global defaults/settings, onboarding completion, test-mode config, theme, and the adaptive-time model parameters.

Seed the line database on first launch from a bundled JSON asset. **Ship at least 500 unique lines** across categories: Discipline, Productivity, Morning, Fitness, Study, Work, Confidence, Wake-up, Short, Funny, Aggressive, Calm. Lines must be original, short enough to say in one breath (≤ 9 words ideally), free of hard-to-recognize proper nouns, and non-offensive. Examples of tone:

- Calm — "I am awake and ready for the day."
- Discipline — "I do what I said I would do."
- Aggressive — "Get out of bed and start."
- Funny — "My bed has officially heard enough of me."
- Short — "Today starts now."

---

## 6. ALARM STATE MACHINE (implement explicitly, persist every transition)

```
IDLE → SCHEDULED → TRIGGERING → ACTIVE → CHALLENGE_STARTED
   → (SPEAKING ⇄ VERIFYING → LINE_COMPLETED)* → CHALLENGE_COMPLETED → COMPLETED
Branches:
  ACTIVE/CHALLENGE_* → SNOOZED → SCHEDULED(short)
  any timed state → TIME_WARNING(75/50/25/10%) → FAILED
  FAILED → {KEEP_TRYING | NEW_CHALLENGE | HARDER_CHALLENGE | OUTSIDE_MODE | LOCKDOWN}
  OUTSIDE_PENDING → OUTSIDE_VERIFIED → CHALLENGE_STARTED(2 lines)
  any state → RECOVERY (technical fault path)
```

Requirements:
- The state machine is a pure function `(State, Event) -> State + Effects`; effects (sound, vibrate, persist, notify, schedule) are executed by an effect handler. Unit-test the transitions with no Android dependencies.
- **Persist state on every transition** (Room + DataStore). Process death, app restart, or screen-off must never lose progress or silently reset the challenge.
- Restoring a session restores the **same lines, same index, same remaining time** (compute from `deadlineAt`, not from a live counter).
- Reopening the app is never treated as completion.

---

## 7. FEATURE SPECIFICATIONS

### 7.1 Onboarding (first launch only)
Five short screens, premium and fast, skippable only after screen 1:
1. Logo + `WAKELOCK` + `WAKE UP. TAKE CONTROL.` → **GET STARTED**
2. **YOUR ALARM SHOULD REQUIRE ACTION** — you must complete a challenge to dismiss.
3. **SPEAK TO WAKE UP** — random spoken lines, verified by your phone.
4. **MAKE IT HARDER** — Lockdown is optional and always requires your confirmation. Explain honestly what it does and does not do.
5. **YOUR MORNING. YOUR RULES.** → **CREATE MY FIRST ALARM**
Request notification permission here with an in-context rationale; defer mic/location/camera to the features that need them.

### 7.2 Home dashboard
Current time (live), date, next alarm ("Tomorrow, 6:45 AM" + countdown), alarm cards with toggle, current streak with flame, today's challenge summary, quick stats (success rate, avg completion, challenges completed), prominent **ADD ALARM**. Bottom nav: **HOME · STATS · HISTORY · SETTINGS**. Alarm cards support tap-to-edit and swipe/long-press for duplicate/delete/test.

### 7.3 Alarm creation — progressive, multi-step (never one giant form)
**BASIC:** time picker → repeat (Once/Daily/Weekdays/Weekends/Custom) → name → sound + preview + volume → vibration (Gentle/Strong/Pulsing, with preview) → challenge preset (QUICK 3 / STANDARD 5 / HARD 7 / EXTREME 10 / CUSTOM 1–10) → time limit (1/2/5/10/15/20/30/custom 1–60 min) → Lockdown on/off.
**ADVANCED (collapsed by default):** line categories, adaptive time + min/max, adaptive difficulty, speech sensitivity, Outside Mode + signal selection, failure action, lockdown duration, snooze rules.
**TEST THIS ALARM** button launches the real alarm experience immediately (flagged as a test session).

### 7.4 Pre-sleep confirmation (mandatory for lockdown/aggressive configs)
Full summary card — time, challenge, lines, time limit, adaptive time, lockdown, failure action, outside mode, snooze — then **CONFIRM ALARM**. Deliberate, one tap, no accidental confirm.

### 7.5 Alarm experience (the most important screen)
Full-screen activity: `setShowWhenLocked(true)`, `setTurnScreenOn(true)`, full-screen intent notification fallback, keep-screen-on, launched from a foreground service so it survives process pressure.

Layout: huge clock → `WAKE UP` → challenge title → `LINE 2 / 5` → the required sentence in large type → pulsing **🎙 HOLD TO SPEAK** mic → countdown `08:31` → progress dots `● ● ○ ○ ○`.
No DISMISS button. No back-exit. Sound + vibration continue until the challenge is completed or the configured failure behaviour takes over.
Visual states with distinct treatments: WAITING · ALARMING · SPEAKING · VERIFYING · SUCCESS · WARNING · FAILED · LOCKDOWN · COMPLETE.

### 7.6 Speech challenge + verification
- Hold-to-speak (also support tap-to-toggle for accessibility). Live amplitude indicator, recording state, clear status text.
- Verify with **tolerant fuzzy matching**, not exact transcription. Pipeline: lowercase → strip punctuation → expand contractions → normalize numbers/homophones → token match using normalized Levenshtein + token-set ratio + optional Double Metaphone for accent tolerance → weighted score vs `speechSensitivity` threshold (Lenient/Normal/Strict).
- Accept: accents, minor wording changes, filler words, recognizer typos. Reject: silence, empty, extremely short input, clearly unrelated speech.
- On success: haptic tick, `✓ VERIFIED`, brief success animation, auto-advance. On failure: `TRY AGAIN` + actionable hint ("I couldn't hear that clearly — try speaking a bit louder"). Never punish a legitimate recognizer failure; failed attempts don't consume progress, only time.
- Prefer on-device recognition; if a device requires network, say so plainly in Settings and Help.
- Never store raw audio. No audio files written to disk, ever, by default.

### 7.7 Randomization engine
Weighted random selection from enabled categories, excluding lines used within a configurable cooldown (default 14 days) unless the eligible pool is exhausted, then fall back to least-recently-used. Selection is made **once** when the occurrence's session is created and then frozen. Fresh set for each new occurrence.

### 7.8 Timer & warnings
Deadline-based countdown (wall clock, survives process death). Warnings at 75% / 50% / 25% / 10% elapsed-remaining thresholds with escalating copy, color and haptics; `FINAL MINUTES` state at 10%. At zero → `CHALLENGE FAILED` → apply configured failure action.

### 7.9 Adaptive time engine
Records start, completion, lines, type, success/failure, snoozes. Computes a rolling median (last ~14 successful sessions) plus a safety margin (e.g. median × 1.4, rounded up to the nearest minute), **clamped hard between the user's min and max**, and moves at most ±1 minute per day. Surfaces `Recommended time: 6 minutes` with a one-line explanation of why it changed. Never silently applies a shorter time without the user opting into auto-apply.

### 7.10 Adaptive difficulty (optional, off by default)
If the user consistently finishes far under the limit, gradually raise line count / line difficulty tier — capped, gradual, disableable any time before the alarm starts. Never impossible.

### 7.11 Snooze
Off by default when Lockdown is on. When enabled: require a mini spoken line ("I am choosing to snooze responsibly."), then 5 / 10 / custom minutes, max snoozes (default 2). When disabled, no snooze affordance appears anywhere.

### 7.12 Outside Mode
Purpose: get the user physically out. **Never claim GPS alone proves anything.** Fuse available signals: location displacement from the sleep anchor point, activity recognition (walking/on-foot), ambient light level vs indoor baseline, optional user-initiated camera snapshot (no face recognition, no upload, deleted after evaluation unless the user saves it). Compute a confidence score; require a configurable threshold across ≥2 available signals; degrade gracefully when a sensor is missing.
UI: explain each permission before requesting → **VERIFY I'M OUTSIDE** → progress per signal → `OUTSIDE VERIFIED ✓` → 2 fresh spoken lines → `YOU'RE UP.` → alarm stops. On failure: `VERIFICATION FAILED` + specific reason + retry. A broken sensor must never permanently trap the user.

### 7.13 Lockdown
**Consent dialog (first enable, per alarm):**
> **ENABLE LOCKDOWN MODE?**
> When your alarm rings, WakeLock will restrict normal access to the alarm experience until you complete your challenge. The exact level of device restriction depends on your Android device and configuration. Emergency and operating-system functions remain available.
> `CANCEL` · `I UNDERSTAND — ENABLE`

**NORMAL MODE (ordinary phones):** full-screen alarm over lock screen, foreground service, persistent high-priority notification, persisted challenge state, re-entry into the alarm experience when the app regains foreground, no in-app dismissal route, restoration after interruption, honest in-UI statement of what Android does and doesn't allow.

**MAXIMUM LOCKDOWN (Device Owner):** real `DevicePolicyManager` + `startLockTask()` with the app whitelisted, plus a setup guide (ADB `dpm set-device-owner` on a freshly provisioned/unmanaged device, what Device Owner means, how to remove it). Never provision silently. Detect and clearly display whether the device qualifies; if not, show why and offer Normal Mode.

**Lockdown duration:** 1/2/4/6/8/12 h or custom; default **12 HOURS**; extra confirmation before saving long durations. Lockdown status/countdown must be visible and survive reboot.

### 7.14 Failure actions
`KEEP TRYING` · `NEW CHALLENGE` · `HARDER CHALLENGE` · `OUTSIDE MODE` · `LOCKDOWN(duration)` — each fully implemented, each observable in history.

### 7.15 Recovery path (anti-trap, anti-loophole)
`HAVING TROUBLE?` appears only after repeated genuine technical failures (mic unavailable, recognizer missing, permission revoked mid-challenge, sensor dead). It offers diagnosis + retry + a documented degraded fallback (e.g. typed transcription of the line as a last resort, recorded in history as a technical recovery). It must not be reachable as a cheap bypass, and every use is logged and shown in history/stats.

### 7.16 Test mode & exit code
Test Mode toggle in Settings; default exit code **0000**; changeable and disableable; `TEST / EMERGENCY EXIT` ends the current **test** challenge only. Gate the whole feature behind a build flag so a release build can exclude it. Document that it is a testing convenience, not a security mechanism.

### 7.17 Developer panel (hidden, in Settings, debug builds)
Trigger alarm now · skip timer · test speech matcher against arbitrary input · test randomization distribution · test Outside signals · test lockdown · test notifications · simulate reboot recovery · reset database · reset streak · exercise exit code.

### 7.18 Statistics, streaks, achievements
Track current streak, longest streak, total completed, total failed, missed, average and fastest completion, snoozes, outside completions, per-weekday success. Stats dashboard with clean readable charts (weekly/monthly success rate, completion-time trend, streak history). Achievements: First Wake-Up, 3/7/30-Day Streak, No Snooze ×10, Early Bird, Outside, Speed, Discipline ×50 — with polished cards and restrained unlock animation.

### 7.19 History
Chronological list, one row per occurrence: date, alarm name, wake time, challenge type, lines, completion time, result, snoozes, outside verification, failure action applied. Tap for a detail sheet.

### 7.20 Settings (+ search field)
Grouped: Alarm defaults · Challenge (difficulty, lines, categories, sensitivity, time limit, adaptive time + min/max, adaptive difficulty) · Lockdown (mode, failure action, duration, Device Owner setup) · Outside (signals, location, camera, motion) · Appearance (theme, haptics) · Privacy · Help · Testing. Search matches setting titles, keywords and section names, and deep-links to the setting.

### 7.21 Help centre
Short, plain-language articles: How alarms work · Why didn't my alarm ring? · Battery optimization (with system intents to the real settings screens — never modify settings silently) · Microphone problems · Speech recognition & offline · Outside Mode · Lockdown Mode · Device Owner / Maximum Lockdown · Permissions · Emergency & system behaviour · Privacy.

### 7.22 Notifications
Channels: `alarm` (max importance, full-screen intent, no sound of its own), `challenge_active` (ongoing, non-dismissible while active), `upcoming` (low), `lockdown` (ongoing status), `general` (min). Copy: "WakeLock — alarm at 6:45 AM", "WakeLock challenge in progress". No spam, no marketing pings.

### 7.23 Reboot, time changes, reliability
`BOOT_COMPLETED` + `LOCKED_BOOT_COMPLETED`, `TIME_SET`, `TIMEZONE_CHANGED`, `MY_PACKAGE_REPLACED` receivers reschedule everything from Room. Restore an in-flight challenge/lockdown where Android permits. Use `setAlarmClock` for user-visible exact alarms; guide the user to grant exact-alarm permission and to exempt the app from battery optimization via legitimate intents. Never claim boot-process control.

### 7.24 Permissions UX
Request contextually, each preceded by a plain-language rationale screen, each with a graceful denied state and a path to system settings: POST_NOTIFICATIONS (onboarding/alarm setup), RECORD_AUDIO (first speaking challenge setup), SCHEDULE_EXACT_ALARM/USE_EXACT_ALARM (alarm setup), ACCESS_FINE/COARSE_LOCATION (enabling Outside), ACTIVITY_RECOGNITION (enabling motion signal), CAMERA (only if camera verification enabled), FOREGROUND_SERVICE(+type), VIBRATE, RECEIVE_BOOT_COMPLETED, WAKE_LOCK.

### 7.25 Privacy
No raw voice storage. No uploads without explicit consent. No facial recognition. No background location polling outside an active Outside verification window. No analytics SDKs by default. A readable in-app privacy explanation for mic, location and camera.

---

## 8. UX & DESIGN SYSTEM DETAILS

- Compose + Material 3 with a custom token layer; light, dark and system themes; dark-optimized alarm UI (avoid blinding whites at 5 AM).
- Large expressive typography, strong hierarchy, generous spacing, rounded cards, subtle elevation, smooth 200–300 ms transitions, tasteful micro-interactions.
- Haptics: alarm start, mic press/release, line verified, warning thresholds, failure, completion, lockdown activation. Never continuous punishing vibration.
- Accessibility: ≥48 dp targets (mic button much larger), full content descriptions, TalkBack-usable alarm flow, dynamic text scaling without clipping, high-contrast support, visible focus states.
- Microcopy is direct and unsentimental: "You're awake. Finish the job." / "You're up. Go." / "You didn't complete this morning's challenge." Never insulting, never shaming, never cheesy quote-spam.
- Completion screen: `YOU'RE UP.` + ✓ Challenge completed + time + lines + streak + **START MY DAY** / VIEW STATS.
- Failure screen: `CHALLENGE FAILED` + neutral explanation + the configured consequence, clearly stated.

---

## 9. ERROR & EDGE CASES (build real UI for each)

Mic missing/busy · recognizer unavailable or not installed · permission denied or revoked mid-challenge · location off · GPS unavailable · camera unavailable · light/activity sensor missing · exact-alarm permission not granted · notifications disabled · aggressive OEM battery management · Doze · process killed · reboot mid-challenge · screen locked/unlocked at fire time · user leaves app · headphones/bluetooth audio routing · silent mode / DND · another alarm app firing simultaneously · time zone change · DST · manual clock change · very quiet speaker · repeated speech failures · no internet · database migration · first-run empty states.

Rule: **the app never crashes because one capability is missing.** Degrade, explain, offer a recovery action.

---

## 10. TESTING

**Unit tests (JUnit):** speech matcher (accents, typos, wording variants, nonsense rejection, thresholds) · randomization + cooldown + exhaustion · challenge state machine transitions · timer/deadline math incl. process-death restore · adaptive-time clamping and gradual movement · adaptive difficulty caps · streak math incl. gaps and time zones · failure-action dispatch · settings persistence · alarm next-occurrence computation for every repeat mode.

**Instrumented tests:** Room DAOs + migrations · scheduling via AlarmManager (test dispatcher/shadow) · boot rescheduling · Compose UI tests for home, alarm-edit flow, alarm screen states, onboarding.

**Manual QA checklist** (put it in `docs/QA.md` and actually walk it):
1. Create alarm → it fires → speak all lines → alarm stops → streak +1.
2. Let the timer expire → configured failure action executes.
3. Lockdown on → leave the app → challenge is restored where Android permits.
4. Kill and reopen the app mid-challenge → same lines, same index, correct remaining time.
5. Reboot with a scheduled alarm → it still fires.
6. Force a speech failure → retry works, progress preserved.
7. Deny mic permission → clear recovery instructions, no crash.
8. Outside Mode → verify → 2 lines → completion.
9. Adaptive time over several sessions → recommendation moves gradually, respects min/max.
10. Test Mode → `0000` exits the test challenge only.
11. Lockdown off → normal alarm still works.
12. Change time limit → new limit actually applied next occurrence.
13. Change line count → exactly that many lines appear.
14. Change failure behaviour → that behaviour occurs.
15. Snooze disabled → no snooze affordance anywhere.
16. Dark/light/system themes, large font scale, TalkBack pass on the alarm screen.
17. Launcher icon checked at 48/72/96/144/192/512 and under circle/squircle/teardrop masks, plus themed-icon mode.

---

## 11. DELIVERABLES

1. Complete Android Studio project (Gradle KTS, version catalog, debug + release build types, signing instructions, R8 rules).
2. All Kotlin source, Compose UI, Room DB + seed data (500+ lines), DataStore, DI.
3. Working alarm engine, foreground service, full-screen alarm, challenge engine, speech pipeline, adaptive engines, Outside verification, lockdown (normal + Device Owner), notifications, reboot recovery, stats/streaks/achievements, settings + search, help centre, onboarding, test mode, dev panel.
4. **Generated brand assets**: all icons, adaptive layers, monochrome, splash, notification icon, in-app logo, lockup, 512×512 store icon, feature graphic.
5. `docs/BRAND.md` — concepts, scoring table, chosen mark, color/type tokens, usage rules.
6. `docs/QA.md` — manual checklist with results.
7. `docs/ANDROID_LIMITATIONS.md` — exactly what is and isn't possible, Normal vs Maximum Lockdown, Device Owner setup steps.
8. `README.md` — overview, requirements (Android Studio + JDK versions), build & run, **APK/AAB generation commands**, permissions table, architecture map, testing, privacy, known limitations.
9. Test suite, all green.

---

## 12. ACCEPTANCE CRITERIA — not done until every box is true

**Core**
- [ ] Alarms schedule, persist and fire exactly (all repeat modes).
- [ ] Full-screen alarm appears over the lock screen where Android permits.
- [ ] Sound and vibration play and stop correctly.
- [ ] Challenge starts automatically with the configured number of randomized lines.
- [ ] Speech recognition + fuzzy verification work; retries work; nonsense is rejected.
- [ ] Countdown is accurate, warnings fire, expiry triggers the configured failure action.
- [ ] Completion stops the alarm, releases lockdown, updates stats and streak.
- [ ] Full state survives app kill, reopen and reboot — same lines, same progress.

**Advanced**
- [ ] Adaptive time recommends gradually and never leaves the user's min/max.
- [ ] Adaptive difficulty escalates gently and is disableable.
- [ ] Outside Mode fuses ≥2 signals, degrades gracefully, then runs 2 lines.
- [ ] All five failure actions implemented and observable.
- [ ] Snooze challenge + limits work; hidden entirely when disabled.
- [ ] Lockdown requires explicit consent; Normal mode behaves honestly; Device Owner + Lock Task work on a properly provisioned device.

**Product**
- [ ] Original, professional logo/icon set generated as real files, strong at 48 px, valid adaptive + monochrome.
- [ ] Splash, onboarding, home, alarm, stats, history, settings, help, achievements all real and functional.
- [ ] Light + dark modes, accessibility, haptics, error states.
- [ ] Zero non-functional buttons. Zero mockup screens. Zero fake data.
- [ ] Project compiles; unit tests pass; APK build instructions verified.

---

## 13. HOW TO WORK

1. Scaffold project + Gradle + theme tokens; **generate the brand assets early** so every screen uses the real mark.
2. Data layer: Room entities, DAOs, migrations, 500-line seed, DataStore settings.
3. Domain: challenge engine, state machine, speech matcher, adaptive engines — with unit tests written alongside.
4. Alarm infrastructure: scheduler, receivers, foreground service, notifications, boot recovery.
5. Alarm experience UI, then challenge UI, then completion/failure.
6. Home, alarm creation flow, pre-sleep confirmation.
7. Outside Mode, lockdown (normal → device owner).
8. Stats, history, achievements, settings + search, help, onboarding, dev panel.
9. Polish: animation, haptics, accessibility, empty/error states.
10. Build, run tests, fix every error, walk the QA checklist, write the docs.

Report progress as you go. When something is impossible on stock Android, implement the strongest legitimate alternative and document the limitation instead of faking it.

**Now build it.**

**WAKELOCK — YOU DON'T DISMISS THE ALARM. YOU EARN YOUR WAY OUT.**

============================================================
