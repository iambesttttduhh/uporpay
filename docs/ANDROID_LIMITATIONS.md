# WakeLock — Genuine Android Limitations

This document states plainly what WakeLock can and cannot do. Nothing here is worked around
with exploits, root, hidden device-admin escalation or AccessibilityService abuse.

## 1. An ordinary APK cannot take over the device

On a normal, personally-owned Android phone, no installed app can:

- prevent the user pressing Home or Recents and leaving
- block the power menu, shutdown or reboot
- block emergency calling
- prevent factory reset or recovery mode
- prevent its own uninstall
- guarantee it is always the foreground app

WakeLock does **not** attempt any of these. Claims to the contrary by other "unstoppable alarm"
apps are either using Device Owner provisioning or abusing accessibility permissions.

### What WakeLock actually does in NORMAL MODE

| Mechanism | Effect |
|---|---|
| `setAlarmClock()` | Highest-priority exact alarm; survives Doze; shows the system alarm icon |
| Full-screen intent + `showWhenLocked` / `turnScreenOn` | Alarm UI appears over the lock screen |
| Foreground service | Owns sound, vibration and the timer; survives the Activity being destroyed |
| Persisted session (Room) | Lines, index and deadline survive process death and app restart |
| Deadline timestamps | Remaining time is computed from wall clock, so backgrounding does not pause the timer |
| No dismiss affordance | There is no in-app button that ends the challenge |
| Re-entry | Returning to the app resumes the same challenge; reopening never counts as completion |

This is the strongest legitimate behaviour available. A determined, awake user can still leave
the app — and that is an Android security property, not a WakeLock bug.

## 2. MAXIMUM LOCKDOWN requires Device Owner

Real kiosk restriction uses Android **Lock Task Mode**, which requires the app to be a
**Device Owner**. This can only be provisioned on a device with no configured account,
normally straight after a factory reset:

```bash
adb shell dpm set-device-owner com.wakelock/.lockdown.WakeLockDeviceAdminReceiver
```

WakeLock detects this at runtime (`Settings → Lockdown → Current mode`) and only calls
`startLockTask()` when it genuinely holds the privilege. It never attempts silent provisioning.

Even in Lock Task Mode, Android still permits emergency calls and the physical power button.

## 3. Exact alarms and battery optimisation

- Android 12+ requires `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`. If it is not granted,
  WakeLock degrades honestly to `setAndAllowWhileIdle()` and tells the user the alarm may be delayed.
- Manufacturer battery managers (Xiaomi, Oppo, Vivo, Huawei, Samsung) can kill background apps.
  WakeLock cannot change these settings programmatically; the Help screen opens the relevant
  system settings via legitimate intents so the user can allow it manually.

## 4. Reboot

Alarms are rescheduled from Room on `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED` / `MY_PACKAGE_REPLACED`
/ `TIME_SET` / `TIMEZONE_CHANGED`. An alarm that was *due* while the device was powered off cannot
fire retroactively — Android does not queue missed alarms across a power cycle.

## 5. Speech recognition

WakeLock requests on-device recognition (`EXTRA_PREFER_OFFLINE` on API 33+), but **some devices
have no offline speech model** and will require a network connection. That is a device/OEM
limitation. When recognition is unavailable the app says so and offers a recovery path rather
than trapping the user.

No raw audio is ever written to disk.

## 6. Outside Mode

GPS alone does not prove someone is outdoors. WakeLock fuses ambient light, accelerometer
movement and location displacement, and requires **two available signals to agree**. On devices
missing a light sensor or location permission the confidence is lower and the app says which
signals were unavailable. It will not permanently trap a user because a sensor failed.

## 7. Test exit code

`0000` is a development convenience that ends **test** challenges only. It is explicitly not a
security mechanism, it cannot end a real alarm, and it is gated behind the `TEST_TOOLS` build
flag so release builds can exclude it.
