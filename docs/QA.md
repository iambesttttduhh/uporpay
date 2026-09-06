# WakeLock — QA

## Automated (run in CI on every push)

### Unit tests — 26, all passing
| Area | Covers |
|---|---|
| `SpeechMatcherTest` | exact match, punctuation/case, contractions, recogniser typos, filler words, missing small word, unrelated speech rejected, empty rejected, too-short rejected, sensitivity ordering, score bounds |
| `AdaptiveTimeTest` | insufficient data, median (odd/even), never exceeds max, never below min, ±1 min gradual steps, safety margin |
| `ScheduleMathTest` | one-shot today/tomorrow, weekday & weekend repeats, labels, duration formatting, CSV round-trip |
| `StatsTest` | consecutive-day streaks, gap breaking, stale streak, test events excluded, success rate & averages, achievement unlocking |

### Instrumented tests — run on a real Android emulator (API 30, google_apis, x86_64)
| Test | Verifies |
|---|---|
| `database_seeds_at_least_500_lines` | 555 lines seeded from bundled assets |
| `alarm_can_be_created_and_scheduled` | real `AlarmManager` scheduling, future trigger time |
| `challenge_lines_are_frozen_and_restored` | same lines/index/deadline after simulated restart |
| `completing_all_lines_records_success_and_stats` | success event written, completion time recorded |
| `failure_is_recorded_with_action` | failure + configured action persisted to history |
| `outside_mode_appends_two_extra_lines` | 2 → 4 lines, verification timestamp set |
| `randomisation_avoids_immediate_repeats` | no duplicates within a challenge |
| `restart_with_generates_new_lines_and_deadline` | failure-action regeneration works |
| `LaunchSmokeTest` (×2) | app process launches, renders, onboarding navigates without crashing |

## Manual checklist (on a physical device)

These require real hardware (microphone, sensors, lock screen) and are for the beta tester.

**Alarm**
- [ ] Create an alarm 2 minutes out → it fires
- [ ] Sound plays; vibration occurs
- [ ] Full-screen UI appears over the lock screen
- [ ] Repeating alarm reschedules for the next occurrence

**Challenge**
- [ ] Configured number of lines appears
- [ ] Lines differ from the previous morning
- [ ] Hold-to-speak listens; status shows LISTENING → CHECKING → VERIFIED
- [ ] A slightly misspoken line is still accepted
- [ ] Random unrelated speech is rejected
- [ ] Progress dots and LINE n / N advance
- [ ] Completing the last line stops the alarm

**Timer**
- [ ] Countdown matches the configured limit
- [ ] Warnings at 50% / 25% / 10%
- [ ] Expiry triggers the configured failure action

**Persistence**
- [ ] Kill the app mid-challenge → same lines, same index, correct remaining time
- [ ] Reboot with an alarm scheduled → it still fires

**Failure & lockdown**
- [ ] Each failure action behaves as configured
- [ ] Lockdown consent dialog is required before enabling
- [ ] Settings → Lockdown reports the correct mode for the device

**Outside**
- [ ] Permission rationale precedes the request
- [ ] Signal results are shown individually
- [ ] Two extra lines follow a successful verification

**Data & UI**
- [ ] History and Statistics update after each wake-up
- [ ] Streak increments on consecutive days
- [ ] Light / dark / system themes all render correctly
- [ ] Large font scale does not clip text
- [ ] Launcher icon looks correct on the home screen and in themed-icon mode

## Known gaps in this beta

- Snooze is configurable and persisted, but the mini snooze challenge UI is not yet wired into the
  alarm screen (snooze is off by default, and hidden entirely when disabled).
- Camera verification for Outside Mode is not implemented; light + motion + location are.
- Custom alarm sound picking uses the system default alarm tone; per-alarm sound selection UI is pending.
